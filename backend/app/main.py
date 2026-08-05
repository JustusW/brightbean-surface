"""The HTTP surface.

Small on purpose. Three endpoints: what the site IS, what it has
PUBLISHED, and what a static page SAYS. Everything else is the frontend's
problem, and everything that differs between deployments is in
surface.toml.

READ ONLY, ENFORCED AT THE DATABASE. There is no POST, PUT, PATCH or
DELETE anywhere in this file, and the connection underneath it is opened
read_only so PostgreSQL would refuse one anyway. See backend/app/db.py.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from . import auth
from . import config as config_module
from . import db

app = FastAPI(
    title="brightbean-surface",
    # No interactive docs on a public website. There is nothing here worth
    # a request builder, and it is one more surface to think about.
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@lru_cache(maxsize=1)
def config() -> config_module.Config:
    """The configuration, read once.

    Cached because it is read on every request and does not change while
    the process runs — a deployment changes it and restarts, which is the
    same shape every other configuration on these machines has.
    """
    return config_module.load()


@app.get("/api/site")
def site() -> dict:
    """What this site is, and what pages it has.

    The frontend builds its navigation from this rather than from a list
    compiled into the bundle, so adding a page is a config change and a
    restart — not a rebuild and a redeploy.
    """
    cfg = config()
    return {
        "title": cfg.title,
        "locale": cfg.locale,
        "tagline": cfg.tagline,
        # `kind` travels with each entry so the frontend knows which
        # pages are Markdown and which are the gallery, without a route
        # table compiled into the bundle that has to be kept in step
        # with the configuration by hand.
        "nav": [
            {"slug": p.slug, "title": p.title, "kind": p.kind}
            for p in cfg.pages if p.nav
        ],
        "footer": [
            {"slug": p.slug, "title": p.title, "kind": p.kind}
            for p in cfg.pages if p.footer
        ],
    }


@app.get("/api/feed")
def feed(limit: int | None = None) -> dict:
    """What the club has published, newest first."""
    cfg = config()
    # BOUNDED HERE AS WELL AS IN THE CONFIG. `?limit=` is a query
    # parameter on a public endpoint, and an unbounded one is an
    # invitation to ask for every post in the database repeatedly.
    wanted = min(int(limit or cfg.limit), 100)

    try:
        items = db.feed(
            workspace=cfg.workspace,
            platforms=cfg.platforms,
            accounts=cfg.accounts,
            limit=wanted,
        )
    except Exception as exc:
        # SAY THAT IT FAILED, NOT WHY. A stack trace or a DSN on a public
        # page tells a stranger about the inside of the machine; the
        # operator's copy is in the process log where it belongs.
        raise HTTPException(
            status_code=503,
            detail="The feed is temporarily unavailable.",
        ) from exc

    return {
        "items": [
            {
                "id": item.id,
                "published_at": (item.published_at.isoformat()
                                 if item.published_at else None),
                "title": item.title,
                "text": item.text,
                "tags": item.tags,
                "platform": item.platform,
                "account": {
                    "name": item.account_name,
                    "handle": item.account_handle,
                },
                "media": [
                    {
                        "url": cfg.media_url(m.path),
                        "thumbnail": cfg.media_url(m.thumbnail),
                        "kind": m.kind,
                        "width": m.width,
                        "height": m.height,
                        "alt": m.alt,
                    }
                    for m in item.media
                ],
            }
            for item in items
        ],
    }


@app.get("/api/gallery")
def gallery() -> dict:
    """Every picture the club has published.

    NOT the media library. See the comment on _GALLERY_SQL: the library
    holds drafts, rejects and unused uploads, and a public gallery
    reading from it would put those on the internet in a way that looked
    like a feature.
    """
    cfg = config()
    try:
        media = db.gallery(
            workspace=cfg.workspace,
            platforms=cfg.platforms,
            accounts=cfg.accounts,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="The gallery is temporarily unavailable.",
        ) from exc

    return {
        "images": [
            {
                "url": cfg.media_url(m.path),
                "thumbnail": cfg.media_url(m.thumbnail),
                "width": m.width,
                "height": m.height,
                "alt": m.alt,
            }
            for m in media
        ],
    }


@app.get("/api/page/{slug}")
def page(slug: str) -> dict:
    """One static page's Markdown."""
    found = config().page(slug)
    if found is None:
        raise HTTPException(status_code=404, detail="No such page.")
    return {"slug": found.slug, "title": found.title, "body": found.body}


@app.get("/api/healthz")
def healthz_impl() -> JSONResponse:
    """Liveness, and the invariant.

    It reports whether the connection is REALLY read only, asked of
    PostgreSQL rather than asserted here. An invariant nothing ever
    checks is a hope, and this one is the whole basis on which pointing a
    public website at somebody's production database is defensible.
    """
    try:
        state = db.health()
    except Exception:
        return JSONResponse(status_code=503,
                            content={"ok": False, "database": False})
    return JSONResponse(content={"ok": True, **state})


# ---------------------------------------------------------------------------
# Members
# ---------------------------------------------------------------------------
#
# THE SESSION MIDDLEWARE IS AUTHLIB'S REQUIREMENT, not a design choice
# of ours. Its documentation, on the FastAPI page: "we need this to save
# temporary code & state in session". That is where authorize_redirect
# puts the state, the nonce and the PKCE verifier, and where
# authorize_access_token reads them back to compare.
#
# IT IS NOT THE LOGIN SESSION. That is a row in our own database and a
# separate cookie carrying only its id. This one lives for the length of
# one round trip to Google and then stops mattering, which is why
# max_age is ten minutes rather than thirty days: a cookie that only
# needs to survive a redirect should not outlive it.
if auth.google_configured():
    app.add_middleware(
        SessionMiddleware,
        secret_key=auth.SESSION_SECRET,
        session_cookie="vfm_oauth",
        max_age=600,
        same_site="lax",
        https_only=auth.HTTPS,
    )

# INCLUDED AFTER THE PUBLIC ENDPOINTS AND BEFORE THE CATCH-ALL, and the
# position is load-bearing rather than tidy. Starlette matches routes in
# the order they are added, so a router registered after the SPA
# fallback below would never be reached: every /api/auth call would be
# answered with index.html, and the members area would fail by rendering
# a perfectly good web page.
app.include_router(auth.router)


# ---------------------------------------------------------------------------
# The built frontend, served by this same process
# ---------------------------------------------------------------------------
#
# ONE UPSTREAM. nginx proxies everything for this hostname here, so
# splitting static files onto a second server would mean a second thing
# to deploy, a second thing to keep in step with the first, and an nginx
# change every time either moved.
#
# DECLARED AFTER EVERY /api ROUTE, DELIBERATELY. Starlette matches routes
# in the order they are added, so a catch-all registered earlier would
# swallow the API and every endpoint above would answer with index.html —
# which looks like the backend having silently died rather than like a
# routing mistake.

STATIC = Path(__file__).resolve().parents[1] / "static"

if (STATIC / "index.html").is_file():
    # Hashed asset filenames, so they can be cached hard and for ever:
    # a changed file gets a changed name, which is what the hash is for.
    app.mount("/assets", StaticFiles(directory=STATIC / "assets"),
              name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        """Serve a real file if there is one, otherwise the app.

        THE FALLBACK IS THE POINT. /platz and /impressum are routes owned
        by the browser-side router; they are not files, and a plain
        static server answers 404 for them. That breaks exactly the cases
        that matter — somebody following a link to the Impressum, or
        reloading a page that is already open — while the site appears to
        work perfectly if you only ever click from the front page.
        """
        candidate = (STATIC / path).resolve()
        # Confined to STATIC: `path` comes from the URL, and without this
        # a request for ../../etc/passwd would be served happily.
        if (path and candidate.is_file()
                and candidate.is_relative_to(STATIC)):
            return FileResponse(candidate)
        return FileResponse(STATIC / "index.html")

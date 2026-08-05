"""The one file that decides what this surface shows.

A second site is a second surface.toml, not a fork. Everything that
differs between deployments lives here: which workspace, which platforms
count as the front page, where the media is served from, and what the
other pages say.

NO SECRETS. The database URL arrives through the environment, so this
file can be committed, read and reviewed by anybody without handing them
the instance.
"""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

#: Where to look, in order. The environment variable wins so a container
#: can mount the real one anywhere.
CONFIG_ENV = "SURFACE_CONFIG"
DEFAULT_NAMES = ("surface.toml", "surface.example.toml")


@dataclass(frozen=True)
class Page:
    """One static page.

    The body is loaded from a Markdown FILE rather than inlined in the
    config: German prose with headings does not belong on one TOML line,
    and a file can be edited by somebody who has never seen TOML.
    """

    slug: str
    title: str
    body: str
    nav: bool = False
    footer: bool = False


@dataclass(frozen=True)
class Config:
    root: Path
    title: str
    locale: str
    tagline: str
    workspace: str
    platforms: list[str]
    accounts: list[str]
    limit: int
    media_base: str
    media_prefix: str
    pages: list[Page] = field(default_factory=list)

    def media_url(self, path: str) -> str:
        """A public URL for a stored media path.

        Brightbean keeps a location relative to its MEDIA_ROOT
        (`media_library/2026/08/foo.jpg`); this is the only place that
        turns one into an address, so the deployment fact of WHERE media
        is served lives in exactly one line of configuration.
        """
        if not path:
            return ""
        # Already absolute - a deployment on S3-style storage stores full
        # URLs, and rewriting one would break it.
        if path.startswith("http://") or path.startswith("https://"):
            return path
        base = self.media_base.rstrip("/")
        prefix = "/" + self.media_prefix.strip("/") + "/"
        return f"{base}{prefix}{path.lstrip('/')}"

    def page(self, slug: str) -> Page | None:
        return next((p for p in self.pages if p.slug == slug), None)


def _find(explicit: str | None = None) -> Path:
    if explicit:
        return Path(explicit)
    named = os.environ.get(CONFIG_ENV)
    if named:
        return Path(named)
    here = Path(__file__).resolve().parents[2]
    for name in DEFAULT_NAMES:
        candidate = here / name
        if candidate.is_file():
            return candidate
    # NAME BOTH, so the error says what to create rather than only what
    # is missing.
    raise RuntimeError(
        f"no configuration found. Looked for {', '.join(DEFAULT_NAMES)} "
        f"in {here}, and at ${CONFIG_ENV}. Copy surface.example.toml to "
        f"surface.toml and fill it in."
    )


def load(path: str | None = None) -> Config:
    """Read the configuration, and REFUSE a broken one loudly.

    Every missing value below is something whose absence would otherwise
    produce a page that renders perfectly and shows the wrong thing - an
    empty workspace matches no posts and looks like a club that has never
    posted; an empty platform list does the same. Those are the failures
    worth being noisy about, because they do not look like failures.
    """
    file = _find(path)
    with file.open("rb") as handle:
        raw = tomllib.load(handle)

    root = file.parent
    site = raw.get("site") or {}
    feed = raw.get("feed") or {}
    media = raw.get("media") or {}

    workspace = str(feed.get("workspace", "")).strip()
    if not workspace:
        raise RuntimeError(
            f"{file}: [feed] workspace is required. Without it nothing "
            "matches and the site renders as a club that has never "
            "posted, which looks like working software."
        )

    platforms = [str(p) for p in (feed.get("platforms") or []) if str(p)]
    if not platforms:
        raise RuntimeError(
            f"{file}: [feed] platforms is required. An empty list shows "
            "nothing, silently."
        )

    pages: list[Page] = []
    for entry in raw.get("pages") or []:
        slug = str(entry.get("slug", "")).strip()
        if not slug:
            raise RuntimeError(f"{file}: a [[pages]] entry has no slug")
        rel = str(entry.get("file", "")).strip()
        body = ""
        if rel:
            source = root / rel
            if not source.is_file():
                # A MISSING PAGE FILE IS A REFUSAL, not an empty page.
                # Rendering a legally required Impressum as a blank page
                # because somebody mistyped a filename is exactly the
                # failure that looks fine until it matters.
                raise RuntimeError(
                    f"{file}: page '{slug}' names {rel}, which is not "
                    f"there (looked at {source})"
                )
            body = source.read_text(encoding="utf-8")
        pages.append(Page(
            slug=slug,
            title=str(entry.get("title", slug)),
            body=body,
            nav=bool(entry.get("nav", False)),
            footer=bool(entry.get("footer", False)),
        ))

    return Config(
        root=root,
        title=str(site.get("title", "")),
        locale=str(site.get("locale", "en")),
        tagline=str(site.get("tagline", "")),
        workspace=workspace,
        platforms=platforms,
        accounts=[str(a) for a in (feed.get("accounts") or []) if str(a)],
        limit=int(feed.get("limit", 30)),
        media_base=str(media.get("base", "")),
        media_prefix=str(media.get("prefix", "/media/")),
        pages=pages,
    )

"""Everything this application knows how to ask Brightbean's database.

ONE FILE, AND EVERY TABLE AND COLUMN NAMED EXPLICITLY. Reading another
application's schema directly is a real coupling and pretending otherwise
would be the mistake — so the coupling is concentrated here, in plain
SQL, where a Brightbean migration that renames something breaks in one
obvious place rather than in six subtle ones.

The names below were read out of Brightbean's own models, not guessed:

    composer_post                    apps/composer/models.py, Post
    composer_platform_post           PlatformPost  (Meta.db_table)
    composer_post_media              PostMedia
    media_library_media_asset        apps/media_library/models.py
    social_accounts_social_account   apps/social_accounts/models.py

Note that none of those is Django's default `<app>_<model>` name. Every
one of these models sets db_table explicitly, so guessing would have
produced `composer_platformpost` and a relation-does-not-exist error at
the first request — which is the lucky outcome. The unlucky one is a name
that happens to exist and holds something else.

NOTHING HERE WRITES, and that is enforced by PostgreSQL rather than by
this comment. See connect().
"""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass, field
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

#: THE ONE ENVIRONMENT VARIABLE. It never appears in the config file,
#: because that file is committed and this is a credential.
DSN_ENV = "SURFACE_DATABASE_URL"


def _configure(conn: psycopg.Connection) -> None:
    """Make every connection READ ONLY, at the server, and PROVE it.

    A bug in this repository then becomes an error rather than a change
    to somebody's published history. The alternative — only ever writing
    SELECTs and being careful — is not a property anything can rely on
    six months and three contributors from now.

    SETTING conn.read_only WAS NOT ENOUGH, and that is measured rather
    than theorised. psycopg applies that attribute to the NEXT
    transaction; with autocommit on there is no explicit transaction for
    it to attach to, and the first deployment answered

        {"ok":true,"reachable":true,"read_only":false}

    from a health check that asked PostgreSQL instead of trusting the
    attribute. A public website had a WRITABLE connection to the database
    holding every OAuth token, and nothing but that check would have said
    so.

    So the statement is issued explicitly, and then READ BACK. If the
    server does not agree the connection is read only, this raises and
    the pool hands out nothing — refusing to serve is the correct
    outcome, because the alternative is serving with the one property
    this whole design rests on quietly absent.
    """
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
        cur.execute("SELECT current_setting('transaction_read_only')")
        row = cur.fetchone()
        if not row or row[0] != "on":
            raise RuntimeError(
                "refusing to use a connection that is not READ ONLY: "
                f"transaction_read_only is {row[0] if row else 'unknown'}. "
                "This process must never be able to write to Brightbean's "
                "database."
            )
    # Belt as well as braces: keeps psycopg's own view in step, so
    # anything that inspects the connection sees the same answer the
    # server would give.
    conn.read_only = True


_pool: ConnectionPool | None = None


def pool() -> ConnectionPool:
    """The connection pool, opened on first use.

    Small on purpose: this serves a club website, and a pool sized for
    load that will never arrive is just idle connections against somebody
    else's managed database.
    """
    global _pool
    if _pool is None:
        dsn = os.environ.get(DSN_ENV, "")
        if not dsn:
            raise RuntimeError(
                f"{DSN_ENV} is not set, so there is no database to read. "
                "It is deliberately not in surface.toml — that file is "
                "committed and this is a credential."
            )
        _pool = ConnectionPool(
            dsn,
            min_size=1,
            max_size=4,
            configure=_configure,
            open=True,
            # A public page must fail fast rather than hang: a visitor
            # would rather see an error than a spinner that never ends.
            timeout=10.0,
        )
    return _pool


# ---------------------------------------------------------------------------
# what a caller gets back
# ---------------------------------------------------------------------------


@dataclass
class Media:
    """One image or video attached to a post.

    `path` is what Brightbean stored: a location relative to its
    MEDIA_ROOT, like `media_library/2026/08/foo.jpg`. Turning that into a
    URL is the caller's job, because the origin serving it is a
    deployment fact rather than a database one.
    """

    path: str
    kind: str
    width: int
    height: int
    alt: str
    thumbnail: str


@dataclass
class Item:
    """One published post, as the front page shows it."""

    id: str
    #: The PARENT post's id. Carried because media hangs off the parent
    #: rather than off the per-platform child - one photograph attached
    #: to a post that went to four accounts is one row, used four times.
    post_id: str
    published_at: Any
    title: str
    text: str
    tags: list[str]
    platform: str
    account_name: str
    account_handle: str
    #: The post's id ON THE PLATFORM. Kept so a future version can link
    #: out to the original; empty when the platform gave us nothing back.
    remote_id: str
    media: list[Media] = field(default_factory=list)


# ---------------------------------------------------------------------------
# the queries
# ---------------------------------------------------------------------------

#: WHY IT MATCHES ON THE PLATFORM POST AND NOT THE PARENT.
#:
#: A composer_post aimed at four accounts has four composer_platform_post
#: children, EACH WITH ITS OWN STATUS. One can be published while another
#: is still a draft. Brightbean derives an aggregate status on the parent
#: for its own listings, but that aggregate is computed in Python and does
#: not exist as a column - so the only honest question the database can
#: answer is "which platform posts are published", and that is what this
#: asks.
_FEED_SQL = """
SELECT
    pp.id                        AS platform_post_id,
    pp.published_at              AS published_at,
    pp.platform_post_id          AS remote_id,
    pp.platform_specific_caption AS override_caption,
    pp.platform_specific_title   AS override_title,
    p.id                         AS post_id,
    p.title                      AS title,
    p.caption                    AS caption,
    p.tags                       AS tags,
    sa.platform                  AS platform,
    sa.account_name              AS account_name,
    sa.account_handle            AS account_handle
FROM composer_platform_post pp
JOIN composer_post p
  ON p.id = pp.post_id
JOIN social_accounts_social_account sa
  ON sa.id = pp.social_account_id
WHERE pp.status = 'published'
  AND p.workspace_id = %(workspace)s
  AND sa.platform = ANY(%(platforms)s)
  AND (%(accounts)s::uuid[] IS NULL
       OR cardinality(%(accounts)s::uuid[]) = 0
       OR sa.id = ANY(%(accounts)s::uuid[]))
  -- AND BY NAME, which is what lets the front page come from a channel
  -- that publishes NOWHERE rather than being a mirror of Instagram.
  -- `accounts` pins by UUID and keeps a second brand off this site;
  -- this pins by the name a person reads in Brightbean. Empty means
  -- every account on the platforms above, which is the old behaviour.
  AND (%(channels)s::text[] IS NULL
       OR cardinality(%(channels)s::text[]) = 0
       OR sa.account_name = ANY(%(channels)s::text[]))
-- NULLS LAST because published_at is nullable: a row published before
-- that column was populated must not sort to the top of the page as if
-- it were the newest thing the club has done.
ORDER BY pp.published_at DESC NULLS LAST, p.created_at DESC
LIMIT %(limit)s
"""

#: ONE QUERY FOR EVERY POST'S MEDIA, not one per post. Thirty posts on a
#: front page would otherwise be thirty-one round trips to a database that
#: is across a network.
_MEDIA_SQL = """
SELECT
    pm.post_id    AS post_id,
    pm.position   AS position,
    pm.alt_text   AS alt_text,
    ma.file       AS path,
    ma.media_type AS kind,
    ma.width      AS width,
    ma.height     AS height,
    ma.thumbnail  AS thumbnail
FROM composer_post_media pm
JOIN media_library_media_asset ma
  ON ma.id = pm.media_asset_id
WHERE pm.post_id = ANY(%(post_ids)s::uuid[])
ORDER BY pm.post_id, pm.position
"""


def feed(*, workspace: str, platforms: list[str], accounts: list[str],
         limit: int, channels: list[str] | None = None) -> list[Item]:
    """Published posts for the front page, newest first.

    `channels` pins by the NAME a person reads in Brightbean, which is
    what lets the front page come from a channel that publishes NOWHERE
    instead of being a mirror of Instagram. Empty means every account on
    the platforms above, so a caller that does not pass it behaves
    exactly as this did before named channels existed.
    """
    with pool().connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(_FEED_SQL, {
            "workspace": uuid.UUID(workspace),
            "platforms": platforms,
            "accounts": [uuid.UUID(a) for a in accounts],
            # LIST(...) RATHER THAN THE ARGUMENT ITSELF, and not for
            # tidiness: _FEED_SQL names %(channels)s, so a missing key
            # here is not a silently unfiltered query - it is psycopg
            # refusing to execute at all. This parameter was left out
            # when the SQL gained the filter, which would have taken the
            # front page down at the first request after deploying.
            "channels": list(channels or []),
            "limit": limit,
        })
        rows = cur.fetchall()

        items: list[Item] = []
        for row in rows:
            # THE SAME FALLBACK BRIGHTBEAN'S OWN effective_caption USES:
            # a per-platform override wins, and NULL means "no override".
            # An empty string is a deliberate override to nothing, so the
            # test is `is not None` rather than truthiness - `or` here
            # would silently show the base caption on a post whose
            # Instagram text had been intentionally cleared.
            text = row["caption"]
            if row["override_caption"] is not None:
                text = row["override_caption"]
            title = row["title"]
            if row["override_title"] is not None:
                title = row["override_title"]

            items.append(Item(
                id=str(row["platform_post_id"]),
                post_id=str(row["post_id"]),
                published_at=row["published_at"],
                title=title or "",
                text=text or "",
                tags=list(row["tags"] or []),
                platform=row["platform"],
                account_name=row["account_name"] or "",
                account_handle=row["account_handle"] or "",
                remote_id=row["remote_id"] or "",
            ))

        if not items:
            return []

        # ONE MORE QUERY, NOT ONE PER POST. And deduplicated first: a
        # crosspost is the SAME parent aimed at several accounts, so
        # thirty rows on the page can easily be eight distinct posts.
        post_ids = sorted({item.post_id for item in items})
        cur.execute(_MEDIA_SQL,
                    {"post_ids": [uuid.UUID(p) for p in post_ids]})
        by_post: dict[str, list[Media]] = {}
        for row in cur.fetchall():
            by_post.setdefault(str(row["post_id"]), []).append(Media(
                path=row["path"] or "",
                kind=row["kind"] or "",
                width=row["width"] or 0,
                height=row["height"] or 0,
                alt=row["alt_text"] or "",
                thumbnail=row["thumbnail"] or "",
            ))

        for item in items:
            item.media = by_post.get(item.post_id, [])

        return items


#: EVERY PICTURE THE CLUB HAS PUBLISHED — and deliberately NOT every
#: picture in the media library.
#:
#: The library is the workspace's whole store: drafts nobody approved,
#: rejected takes, things uploaded and never used. A public gallery
#: reading from it would quietly put all of that on the internet, and it
#: would look like a feature rather than a leak. So this walks the same
#: path the feed does - published platform posts, on the configured
#: accounts - and collects what those posts actually SHOWED.
#:
#: DISTINCT ON because one photograph attached to a post that went to
#: several accounts appears once per account, and a gallery that repeats
#: the same aeroplane four times looks broken.
_GALLERY_SQL = """
SELECT DISTINCT ON (ma.id)
    ma.id         AS asset_id,
    ma.file       AS path,
    ma.media_type AS kind,
    ma.width      AS width,
    ma.height     AS height,
    ma.thumbnail  AS thumbnail,
    pm.alt_text   AS alt_text,
    pp.published_at AS published_at
FROM composer_platform_post pp
JOIN composer_post p
  ON p.id = pp.post_id
JOIN social_accounts_social_account sa
  ON sa.id = pp.social_account_id
JOIN composer_post_media pm
  ON pm.post_id = p.id
JOIN media_library_media_asset ma
  ON ma.id = pm.media_asset_id
WHERE pp.status = 'published'
  AND p.workspace_id = %(workspace)s
  -- TWO KINDS OF SOURCE, and the difference is who else could be on the
  -- platform.
  --
  -- A SHARED platform is pinned to named accounts, because this workspace
  -- holds more than one brand: without the pin, SkyMasters' Instagram
  -- would appear on the club's own wall.
  --
  -- An OPEN platform is one that publishes nowhere, so it cannot be a
  -- second brand's account by accident the way a shared platform can.
  -- `impressionen` is the club's own picture wall.
  --
  -- IT USED TO NEED NO FURTHER PIN AT ALL, because that provider
  -- reported a CONSTANT account id and SocialAccount is unique on
  -- (workspace, platform, account_platform_id) - so there was exactly
  -- one such account per workspace, for ever, by construction.
  --
  -- THAT GUARANTEE IS GONE: channels on it can now be named freely, and
  -- the name is the identity. So several may exist, and a staging
  -- channel appearing on the club's public wall because it happens to
  -- sit on the same platform would be a leak rather than a feature.
  --
  -- PINNED BY NAME AND NOT BY UUID, deliberately. The name is what a
  -- person reads in Brightbean, so the configuration can be written and
  -- checked by somebody who is not going to look a UUID up. Renaming a
  -- channel there means editing it here, which is the cost of that and
  -- is worth paying.
  --
  -- An EMPTY name list means every channel on those platforms, which is
  -- how this behaved before there was more than one.
  AND (
        (
          sa.platform = ANY(%(platforms)s)
          AND (%(accounts)s::uuid[] IS NULL
               OR cardinality(%(accounts)s::uuid[]) = 0
               OR sa.id = ANY(%(accounts)s::uuid[]))
          -- The same name pin the feed uses, and needed here for the
          -- same reason: once the feed itself comes from a named
          -- channel on a publishes-nowhere platform, an unpinned branch
          -- would sweep every other channel on that platform onto the
          -- wall.
          AND (%(channels)s::text[] IS NULL
               OR cardinality(%(channels)s::text[]) = 0
               OR sa.account_name = ANY(%(channels)s::text[]))
        )
        OR (
          sa.platform = ANY(%(open_platforms)s)
          AND (%(open_channels)s::text[] IS NULL
               OR cardinality(%(open_channels)s::text[]) = 0
               OR sa.account_name = ANY(%(open_channels)s::text[]))
        )
      )
  -- Stills only. A video in a photo grid is a black rectangle.
  AND ma.media_type IN ('image', 'gif')
-- DISTINCT ON requires the distinct key to lead the ordering; the useful
-- order is applied after the rows come back.
ORDER BY ma.id, pp.published_at DESC NULLS LAST
"""


def gallery(*, workspace: str, platforms: list[str], accounts: list[str],
            channels: list[str] | None = None,
            open_platforms: list[str] | None = None,
            open_channels: list[str] | None = None) -> list[Media]:
    """Every published picture, newest first.

    `open_platforms` are platforms that publish nowhere; `open_channels`
    narrows those to named channels, because such a platform can now hold
    more than one and they are not all meant to be public. Both default
    to empty, so the feed's own call and any older caller behave exactly
    as before.
    """
    with pool().connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(_GALLERY_SQL, {
            "workspace": uuid.UUID(workspace),
            "platforms": platforms,
            "accounts": [uuid.UUID(a) for a in accounts],
            "channels": list(channels or []),
            "open_platforms": list(open_platforms or []),
            "open_channels": list(open_channels or []),
        })
        rows = cur.fetchall()

    # Newest first, done HERE because the query's ORDER BY belongs to
    # DISTINCT ON. None sorts last rather than raising on the comparison.
    rows.sort(key=lambda r: (r["published_at"] is not None,
                             r["published_at"]), reverse=True)

    return [
        Media(
            path=row["path"] or "",
            kind=row["kind"] or "",
            width=row["width"] or 0,
            height=row["height"] or 0,
            alt=row["alt_text"] or "",
            thumbnail=row["thumbnail"] or "",
        )
        for row in rows
    ]


def health() -> dict[str, Any]:
    """Can the database be reached, and is the connection really read only?

    THE SECOND HALF IS THE POINT. "The database answers" is worth
    knowing; "and it will refuse a write" is the invariant this whole
    application rests on, and an invariant nothing ever checks is a
    hope. This asks PostgreSQL rather than asserting it.
    """
    with pool().connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT current_setting('transaction_read_only')")
        row = cur.fetchone()
        return {"reachable": True, "read_only": bool(row and row[0] == "on")}

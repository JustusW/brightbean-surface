# brightbean-surface

A **public, read-only website** driven by what a Brightbean instance has
already published.

Brightbean is where a club or a business composes, approves and publishes
social media posts. This turns that same content into a website, so the
site stops being a separate thing somebody has to remember to update. You
post to Instagram; the website shows it.

- **Frontend** — Vite + React, a static bundle.
- **Backend** — FastAPI, reading Brightbean's PostgreSQL directly.
- **Configuration** — one file decides what is shown: which accounts feed
  the front page, and what the other pages contain.

## The invariant

**It never writes.** Not to the database, not to the media, not to
anything Brightbean owns.

That is enforced rather than promised: the connection is opened
`read_only`, so PostgreSQL itself refuses an `INSERT`, `UPDATE` or
`DELETE` — a mistake in this repository becomes an error rather than a
change to somebody's published history. The alternative, "I was careful",
is not a property you can rely on at three in the morning six months from
now.

The credential should be a database user with `SELECT` and nothing else.
The read-only transaction is the second lock, not the first.

## Why it reads the database rather than an API

Brightbean has a REST API, and using it would be the obvious choice for a
third party. This is not a third party: it is deployed beside the
instance, by the same person, and the content it renders is that
instance's own.

Reading the database directly means no API key to issue, rotate or leak,
no rate limit on a public website's front page, and no new surface on the
Brightbean side to keep secure. The cost is that this repository is
coupled to Brightbean's schema — so `backend/app/db.py` names every table
and column it touches explicitly, in one file, where a schema change
breaks loudly and in one place.

## What "published" means

More precisely than it sounds, and it is worth being exact because
getting it wrong shows the visitor the wrong things:

- A `composer_post` is the piece of content.
- A `composer_platform_post` is that content aimed at ONE social account,
  and it carries its own status. `published` is the terminal state.
- So a post published to Instagram and still a draft for Facebook is
  **published** — for Instagram. The feed matches on the platform post,
  never on the parent.

**Instagram arrives under two platform names.** `instagram` is an account
reached through a Facebook Page; `instagram_login` is Instagram Direct,
for a Professional account with no Page attached. They are different
OAuth flows with different credentials, and an installation can easily
have both. A configuration that lists only one silently shows half the
feed — which looks like posts going missing rather than a filter being
wrong, so `platforms` is a list and the example lists both.

## Media

Media assets are rows in `media_library_media_asset` whose `file` column
holds a path relative to Brightbean's `MEDIA_ROOT`, like
`media_library/2026/08/foo.jpg`.

The surface does not serve those bytes. It builds a URL from the
configured `media.base` and lets whatever already serves Brightbean's
media serve them — which on a deployment that publishes to Instagram or
Facebook must be publicly reachable anyway, because those platforms fetch
each image with their own servers rather than being handed the bytes.

## Configuration

See `surface.example.toml`. One file, one deployment. A second site is a
second config, not a fork.

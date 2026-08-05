"""The surface's OWN database — the read-WRITE one.

DELIBERATELY A SECOND FILE, and deliberately not called `db`. This
process holds two database connections and they have opposite rules:

    app/db.py     BRIGHTBEAN'S. Read-only, enforced by PostgreSQL,
                  raw SQL, somebody else's schema.
    app/store.py  OURS. Read-write, SQLAlchemy, our own models and
                  our own migrations.

A single module holding both, or a generic name like `DATABASE_URL`
shared between them, is how the wrong one eventually gets picked up —
and the direction that mistake runs in is a public website writing to
the database that holds every OAuth token. So the names are different,
the environment variables are different, and there is no code path from
one to the other.

The variable is `SURFACE_OWN_DATABASE_URL`, which is the same name
migrations/env.py already insists on, for the same reason it gives
there.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

DSN_ENV = "SURFACE_OWN_DATABASE_URL"

_engine = None
_Session: sessionmaker[Session] | None = None


def engine():
    """The engine, made on first use.

    Lazy because importing this module must not require a database — the
    public half of the site works perfectly without one, and a missing
    members database should take down the members area rather than the
    front page.
    """
    global _engine, _Session
    if _engine is None:
        dsn = os.environ.get(DSN_ENV, "")
        if not dsn:
            raise RuntimeError(
                f"{DSN_ENV} is not set, so there is nowhere to keep "
                "members. It is deliberately absent from surface.toml, "
                "which is committed — this URL carries a password."
            )
        _engine = create_engine(
            dsn,
            # Small: this serves a club. A pool sized for load that will
            # never arrive is idle connections against a managed server
            # somebody else pays for.
            pool_size=2,
            max_overflow=3,
            # A connection that has been sitting idle for hours is
            # exactly the one the far end has already dropped, and the
            # symptom is a single mysterious failure after a quiet night.
            pool_pre_ping=True,
            pool_recycle=1800,
        )
        _Session = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def session() -> Iterator[Session]:
    """A session per request, closed afterwards. A FastAPI dependency."""
    engine()
    assert _Session is not None
    with _Session() as s:
        yield s


def healthy() -> bool:
    """Can the members database be reached at all?

    Separate from the Brightbean health check on purpose: those two can
    fail independently, and reporting one number for both would hide
    whichever half is still working.
    """
    try:
        with engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False

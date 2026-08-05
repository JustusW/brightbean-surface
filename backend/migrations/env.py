"""Alembic's entry point, wired to the models and to the environment.

TWO THINGS THIS FILE EXISTS TO GET RIGHT:

1. target_metadata IS OUR Base.metadata AND NOTHING ELSE. Autogenerate
   emits a DROP for every table it sees in the database and does not see
   in the metadata. Brightbean's tables live in a DIFFERENT database, so
   they are not at risk here — but this is the line that would put them
   at risk if anyone ever pointed this at the wrong DSN, which is why the
   URL comes from a variable named for THIS database rather than a
   generic one.

2. THE URL IS NEVER READ FROM alembic.ini. That file is committed and the
   URL carries a password. There is no sqlalchemy.url key to fill in, so
   the obvious wrong thing is not available.
"""

from __future__ import annotations

import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# The application package sits beside this directory; Alembic runs with
# the backend/ directory as cwd, and prepend_sys_path in alembic.ini
# covers the normal case. This makes it work regardless of where it is
# invoked from, because a migration that only runs from one directory is
# a migration somebody will fail to run at the wrong moment.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models import Base  # noqa: E402

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

#: NAMED FOR THIS DATABASE, not DATABASE_URL. The process also holds a
#: connection to Brightbean's database, and a generic name is how the
#: wrong one gets picked up by a migration runner one evening.
DSN_ENV = "SURFACE_OWN_DATABASE_URL"


def _url() -> str:
    dsn = os.environ.get(DSN_ENV, "")
    if not dsn:
        raise RuntimeError(
            f"{DSN_ENV} is not set. It is deliberately absent from "
            f"alembic.ini, which is committed — the URL carries a "
            f"password. This is the surface's OWN database (members and "
            f"sessions), never Brightbean's."
        )
    return dsn


def run_migrations_offline() -> None:
    context.configure(
        url=_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    section = config.get_section(config.config_ini_section) or {}
    section["sqlalchemy.url"] = _url()

    connectable = engine_from_config(
        section, prefix="sqlalchemy.", poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # compare_type catches a column whose TYPE changed, which the
            # default misses entirely — a String(120) widened to
            # String(320) would otherwise autogenerate an empty revision
            # and look like there was nothing to do.
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

# One image, one process, one port.
#
# The API and the built frontend are served by the SAME uvicorn: nginx
# already proxies everything for this hostname to a single upstream, so
# splitting static files into a second server would mean a second thing
# to deploy, a second thing to keep in step, and a config change on the
# nginx side every time either moved. FastAPI serving its own bundle is
# one artefact that either works or does not.

# ---- build the frontend ----------------------------------------------
FROM node:22-alpine AS frontend

WORKDIR /build
# package.json and the lockfile ALONE first, so `npm ci` is cached and a
# change to a .tsx file does not reinstall 75 packages.
COPY frontend/package.json frontend/package-lock.json ./
# `ci`, not `install`: it installs exactly the lockfile and fails if the
# two disagree, so a deployed bundle is the one that was tested rather
# than whatever resolved today.
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build


# ---- the application -------------------------------------------------
FROM python:3.13-slim AS app

# NOT ROOT INSIDE THE CONTAINER EITHER. The host runs this under a
# rootless daemon owned by an unprivileged user, which is the isolation
# that matters — this is the second layer, and it costs two lines.
RUN useradd --create-home --uid 10001 surface

WORKDIR /app

# psycopg[binary] ships its own libpq, so there is no build toolchain and
# no libpq-dev to install and then patch for ever.
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY --from=frontend /build/dist ./static

# The pages and the configuration are MOUNTED at run time rather than
# baked in: editing a page or pointing the feed at a different account
# should be a file change and a restart, not a rebuild and a redeploy.

USER surface

# WHERE libpq LOOKS FOR A CLIENT CERTIFICATE.
#
# With TLS on, libpq tries $HOME/.postgresql/postgresql.crt before every
# connection. There is no client certificate here - the server is
# authenticated by password - and a MISSING file is skipped happily. An
# UNREADABLE one is fatal:
#
#   connection to server at "78.47.199.88", port 5432 failed: could not
#   open certificate file "/home/surface/.postgresql/postgresql.crt":
#   Permission denied
#
# which is what this container did, under a rootless daemon where the
# home directory's ownership does not survive the uid mapping the way
# the image intended. Pointing the lookup at /tmp makes it miss cleanly
# rather than being refused, and changes nothing about how the SERVER is
# verified - sslmode is still require, and the connection is still
# encrypted.
ENV PGSSLCERT=/tmp/postgresql.crt \
    PGSSLKEY=/tmp/postgresql.key

EXPOSE 8000

# --proxy-headers because nginx terminates TLS and the application has to
# know: without it every URL it builds says http, and an OAuth
# redirect_uri that says http where Google was told https is refused with
# a mismatch that names neither side.
#
# ONE WORKER, AND THAT IS A CORRECTNESS REQUIREMENT RATHER THAN THRIFT.
#
# It was 2, and the rate limiter in app/auth.py keeps its state in a
# module-level dict — so each worker had its OWN table. A caller got two
# buckets instead of one, and the "5 seconds after 3 failures" escalation
# only counted the failures that happened to land on the same process.
#
# MEASURED, not reasoned about: the identical pair of requests answered
# 401 then 429 on one run and 401 then 401 on the next, which is exactly
# what round-robin across two independent limiters looks like. The
# comment beside the limiter predicted this ("if it ever runs as two
# processes this becomes a per-process limit") and I did not check what
# the Dockerfile actually said until the numbers disagreed with me.
#
# The alternative — shared state — means Redis or a database round trip
# on every auth request, for a club site that serves a few dozen people
# and has deliberately kept both out. One process makes the stated
# property TRUE, and one process is ample here.
#
# --forwarded-allow-ips "*" IS SAFE ONLY BECAUSE OF WHERE THIS LISTENS.
# The previous comment claimed the gateway address was used and the code
# said "*", which is worse than either: it read as a considered choice
# that had not been made. The container's port is published to
# 127.0.0.1 on the host and nginx is the only thing that can reach it,
# so the X-Forwarded-For this trusts is written by our own proxy. If
# that port is ever exposed more widely, this must become the proxy's
# address — otherwise any caller can pick their own rate-limit bucket by
# forging the header.
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips", "*", \
     "--workers", "1"]

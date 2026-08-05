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
EXPOSE 8000

# --proxy-headers because nginx terminates TLS and the application has to
# know: without it every URL it builds says http, and an OAuth
# redirect_uri that says http where Google was told https is refused with
# a mismatch that names neither side.
#
# --forwarded-allow-ips is set to the container network's gateway rather
# than "*": trusting X-Forwarded-For from anywhere lets any client claim
# any address, which matters the moment anything here rate-limits.
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips", "*", \
     "--workers", "2"]

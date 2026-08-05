"""Signing in: with a password, with Google, or with both.

BOTH, NOT EITHER. The shepherd's rule — "the or for the signup/login is
inclusive, so both are supported" — means the same person must not end
up holding two accounts because they pressed a different button on a
different day. Two things enforce that: `Member.email` is unique and
lowercased, and `Identity` is a separate table, so attaching Google to
an account that already exists is an INSERT rather than a second member.

THE SESSION IS A ROW, AND THE COOKIE CARRIES ONLY ITS ID. Signing out
is therefore a DELETE that takes effect immediately, which is exactly
the property you want on the day an account turns out to be
compromised. A self-contained token cannot be revoked before it expires.

WHAT IS STORED IS WHAT SIGNING IN REQUIRES AND NOTHING ELSE. No name,
no last-login, no user agent, no "where am I signed in" list. See the
comments in models.py, which record the three fields that were removed
after failing exactly that test.

THE GOOGLE LEG GOES THROUGH THE GATE, and that is not decoration.
Google refuses a redirect URI that is not https and exempts only
localhost. This site IS https, so it could in principle register its
own — but the club's existing Google client is the one that "just
works", and its authorised redirect URI is on login.wingert.dev:

    browser -> accounts.google.com
            -> https://login.wingert.dev/accounts/google/login/vfm/   (302)
            -> https://preview.modellflug-stutensee.de/api/auth/google/callback

The gate is a redirector that holds no session and stores nothing; the
final hop is a top-level GET navigation to this origin, so a SameSite=Lax
cookie set before the round trip is still sent when the browser arrives.

THE REDIRECT URI MUST BE BYTE-IDENTICAL IN BOTH REQUESTS — the one sent
to the authorize endpoint and the one sent to the token endpoint —
because Google compares them. It is therefore one constant, read from
the environment, and never rebuilt from the incoming request.
"""

from __future__ import annotations

import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from authlib.jose import JsonWebKey, jwt
from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .models import Identity, Member, Session as SessionRow
from .store import session

router = APIRouter(prefix="/api/auth", tags=["auth"])

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

COOKIE = "vfm_session"
SESSION_DAYS = 30

#: The public half of the club's Google client. It travels in the address
#: bar in front of the person signing in, so it is not a secret and lives
#: in params.conf; the SECRET is read server-side into .env and never
#: appears in a request body, a plan preview or a transcript.
GOOGLE_CLIENT_ID = os.environ.get("SURFACE_GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("SURFACE_GOOGLE_CLIENT_SECRET", "")
#: The gate. Registered with Google as an authorised redirect URI.
GOOGLE_REDIRECT_URI = os.environ.get("SURFACE_GOOGLE_REDIRECT_URI", "")

#: Google's own endpoints, from its discovery document at
#: https://accounts.google.com/.well-known/openid-configuration. Stated
#: rather than fetched: they have not moved in a decade, and a discovery
#: request on every sign-in is a third-party round trip that can fail.
GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"]

#: Where the browser is sent when the round trip is over, win or lose.
MEMBERS_PAGE = "/mitglieder"

hasher = PasswordHasher()

#: Verified against when no member matches, so that "no such address" and
#: "wrong password" take about the same time. Without it the response
#: time answers "does this person have an account here", which is a
#: question a login form should not be willing to answer.
DUMMY_HASH = hasher.hash("a password that is not anybody's")


def _google_configured() -> bool:
    return bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
                and GOOGLE_REDIRECT_URI)


# ---------------------------------------------------------------------------
# Cookies
# ---------------------------------------------------------------------------


def _secure(request: Request) -> bool:
    """Should cookies be marked Secure?

    Read from the proxy's own header rather than from `request.url`,
    which is only trustworthy when uvicorn is started with --proxy-headers
    and would silently be `http` otherwise — marking nothing Secure on a
    site that is entirely https. nginx sets X-Forwarded-Proto for this
    host; see the gate's configuration.

    It stays False in development, where the Vite proxy serves plain
    http on localhost and a Secure cookie would simply never be stored,
    producing a login that appears to succeed and then does nothing.
    """
    return request.headers.get("x-forwarded-proto", "").lower() == "https"


def _set_cookie(response: Response, request: Request, name: str, value: str,
                *, seconds: int) -> None:
    response.set_cookie(
        name,
        value,
        max_age=seconds,
        path="/",
        # No JavaScript on this site has any business reading these, and
        # HttpOnly is what turns a cross-site scripting bug from "every
        # session is stolen" into "a page looked wrong".
        httponly=True,
        secure=_secure(request),
        # Lax rather than Strict, and that is required rather than
        # relaxed: the Google round trip comes BACK to this origin as a
        # top-level navigation from another site, and Strict would
        # withhold the cookie at exactly that moment.
        samesite="lax",
    )


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


def _new_session(db: DbSession, member: Member) -> SessionRow:
    row = SessionRow(
        # 256 bits from the OS CSPRNG. This value IS the credential, so
        # it is generated here rather than by any scheme whose output can
        # be derived from another one — which is also why Session.id is
        # a string column with no UUID default.
        id=secrets.token_urlsafe(32),
        member_id=member.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS),
    )
    db.add(row)
    db.commit()
    return row


def current_member(request: Request,
                   db: DbSession = Depends(session)) -> Member | None:
    """Whoever this browser is, or None. Never raises."""
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    row = db.get(SessionRow, token)
    if row is None:
        return None

    # EXPIRY IS CHECKED HERE, not only by a sweep. A row that outlives
    # its expires_at because nothing has run recently must not still let
    # somebody in — the sweep is housekeeping, this is the rule.
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires <= datetime.now(timezone.utc):
        db.delete(row)
        db.commit()
        return None

    member = db.get(Member, row.member_id)
    # An account switched off must stop working immediately, without
    # anybody having to hunt down its sessions.
    if member is None or not member.is_active:
        return None
    return member


def _account(member: Member) -> dict:
    """What the browser is told. Deliberately thin — see api.ts."""
    return {"email": member.email, "approved": member.is_approved}


# ---------------------------------------------------------------------------
# Email and password
# ---------------------------------------------------------------------------


def _clean_email(raw: str) -> str:
    """Lowercased and trimmed, or a refusal.

    LOWERCASING IS THE WHOLE POINT. Justus@example.org and
    justus@example.org are one mailbox, and if the database disagrees
    then signing in with Google after signing up with a password creates
    a second account for the same person — silently, and looking exactly
    like a feature.
    """
    email = (raw or "").strip().lower()
    if not email or "@" not in email or len(email) > 320:
        raise HTTPException(status_code=400,
                            detail="Bitte gib eine gültige E-Mail-Adresse an.")
    return email


def _check_password(raw: str) -> str:
    # Eight is the frontend's own minLength, restated here because a
    # browser control is a convenience and never a constraint.
    if not raw or len(raw) < 8:
        raise HTTPException(
            status_code=400,
            detail="Das Passwort muss mindestens 8 Zeichen lang sein.")
    if len(raw) > 1024:
        # argon2 will happily hash a megabyte, on our CPU, at the request
        # of anybody with a form.
        raise HTTPException(status_code=400, detail="Das Passwort ist zu lang.")
    return raw


@router.post("/signup")
def signup(request: Request, payload: dict = Body(default={}),
           db: DbSession = Depends(session)) -> JSONResponse:
    email = _clean_email(payload.get("email", ""))
    password = _check_password(payload.get("password", ""))

    existing = db.scalar(select(Member).where(Member.email == email))
    if existing is not None:
        # REFUSED, and NOT quietly turned into "set a password on that
        # account". A member who arrived through Google has no password,
        # and letting a stranger who knows their address choose one would
        # be a takeover with a friendly form in front of it. Adding a
        # password to an existing account is a job for somebody already
        # signed in, and it is not built yet.
        #
        # This does tell an anonymous visitor that an address has an
        # account here. That is a real trade-off and it is taken
        # deliberately: the alternative is a signup that silently does
        # nothing, on a club site with a few dozen members.
        raise HTTPException(
            status_code=409,
            detail="Für diese E-Mail-Adresse gibt es bereits ein Konto. "
                   "Bitte melde Dich an.")

    member = Member(email=email, password_hash=hasher.hash(password))
    db.add(member)
    db.commit()

    row = _new_session(db, member)
    response = JSONResponse(_account(member))
    _set_cookie(response, request, COOKIE, row.id,
                seconds=SESSION_DAYS * 86400)
    return response


@router.post("/login")
def login(request: Request, payload: dict = Body(default={}),
          db: DbSession = Depends(session)) -> JSONResponse:
    email = _clean_email(payload.get("email", ""))
    password = payload.get("password", "") or ""

    member = db.scalar(select(Member).where(Member.email == email))

    if member is None:
        # Same work, same time. See DUMMY_HASH.
        try:
            hasher.verify(DUMMY_HASH, password)
        except Exception:
            pass
        raise HTTPException(
            status_code=401,
            detail="E-Mail-Adresse oder Passwort ist falsch.")

    if member.password_hash is None:
        # SAYING SO IS THE KIND THING AND COSTS NOTHING EXTRA: signup
        # already reveals that this address has an account, so the only
        # new information is which button to press. The generic message
        # here would send a Google member round the same wrong loop for
        # ever.
        raise HTTPException(
            status_code=409,
            detail="Dieses Konto wurde mit Google angelegt. Bitte melde "
                   "Dich mit Google an.")

    try:
        hasher.verify(member.password_hash, password)
    except (VerifyMismatchError, InvalidHashError, Exception):
        raise HTTPException(
            status_code=401,
            detail="E-Mail-Adresse oder Passwort ist falsch.")

    if not member.is_active:
        raise HTTPException(
            status_code=403,
            detail="Dieses Konto ist deaktiviert. Bitte wende Dich an den "
                   "Vorstand.")

    # argon2 publishes its parameters inside the hash, so a stored one can
    # be recognised as weaker than today's default and quietly upgraded
    # while we legitimately hold the plaintext — which is here and nowhere
    # else.
    if hasher.check_needs_rehash(member.password_hash):
        member.password_hash = hasher.hash(password)
        db.commit()

    row = _new_session(db, member)
    response = JSONResponse(_account(member))
    _set_cookie(response, request, COOKIE, row.id,
                seconds=SESSION_DAYS * 86400)
    return response


@router.post("/logout", status_code=204)
def logout(request: Request, db: DbSession = Depends(session)) -> Response:
    token = request.cookies.get(COOKIE)
    if token:
        row = db.get(SessionRow, token)
        if row is not None:
            # THE ROW GOES. Not a flag, not an expiry brought forward —
            # deleted, so the credential in that cookie refers to nothing.
            db.delete(row)
            db.commit()
    response = Response(status_code=204)
    response.delete_cookie(COOKIE, path="/")
    return response


@router.get("/me")
def me(member: Member | None = Depends(current_member)) -> JSONResponse:
    if member is None:
        # The ORDINARY state of a visitor who has not signed in. The
        # frontend treats it as such and reports nothing.
        raise HTTPException(status_code=401, detail="Nicht angemeldet.")
    return JSONResponse(_account(member))


# ---------------------------------------------------------------------------
# Google
# ---------------------------------------------------------------------------

STATE_COOKIE = "vfm_oauth_state"
NONCE_COOKIE = "vfm_oauth_nonce"
ROUND_TRIP_SECONDS = 600

_jwks_cache: tuple[float, object] | None = None


def _jwks():
    """Google's signing keys, cached for an hour.

    Cached because it is a third-party request in the middle of somebody
    signing in; re-fetched rather than pinned because Google rotates
    these, and a pinned key means every login fails on the day it turns
    over.
    """
    global _jwks_cache
    now = time.time()
    if _jwks_cache and now - _jwks_cache[0] < 3600:
        return _jwks_cache[1]
    with httpx.Client(timeout=10) as client:
        keys = JsonWebKey.import_key_set(client.get(GOOGLE_JWKS).json())
    _jwks_cache = (now, keys)
    return keys


@router.get("/google/start")
def google_start(request: Request) -> RedirectResponse:
    """Send the browser to Google."""
    if not _google_configured():
        raise HTTPException(
            status_code=503,
            detail="Die Anmeldung mit Google ist auf diesem Server nicht "
                   "eingerichtet.")

    # state protects against a callback nobody here started — CSRF on the
    # login endpoint. nonce binds the ID token to THIS request, so one
    # obtained elsewhere cannot be replayed into it. Both are compared
    # against a cookie this server set moments ago.
    state = secrets.token_urlsafe(24)
    nonce = secrets.token_urlsafe(24)

    query = urlencode({
        "client_id": GOOGLE_CLIENT_ID,
        # Byte-identical to the one sent at the token exchange. Google
        # compares them, and a mismatch is reported in a way that names
        # neither side.
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        # openid and email ONLY. `profile` would bring a name and a
        # picture we have decided not to store, and asking for what we
        # will discard is both a worse consent screen and a lie about
        # what the club wants.
        "scope": "openid email",
        "state": state,
        "nonce": nonce,
        # No refresh token: this signs somebody in once. There is nothing
        # to do on their behalf later, so there is nothing to keep.
        "access_type": "online",
        "prompt": "select_account",
    })

    response = RedirectResponse(f"{GOOGLE_AUTHORIZE}?{query}", status_code=302)
    _set_cookie(response, request, STATE_COOKIE, state,
                seconds=ROUND_TRIP_SECONDS)
    _set_cookie(response, request, NONCE_COOKIE, nonce,
                seconds=ROUND_TRIP_SECONDS)
    return response


def _fail(request: Request, why: str) -> RedirectResponse:
    """Back to the members page, saying what went wrong.

    A REDIRECT AND NOT AN ERROR PAGE, because the person is a club member
    who pressed a button, not an API client. The reason travels as a
    short code the page turns into German — the browser has left this
    origin and come back, so there is nowhere else to put it.
    """
    response = RedirectResponse(f"{MEMBERS_PAGE}?fehler={why}", status_code=302)
    response.delete_cookie(STATE_COOKIE, path="/")
    response.delete_cookie(NONCE_COOKIE, path="/")
    return response


@router.get("/google/callback")
def google_callback(request: Request, code: str = "", state: str = "",
                    error: str = "",
                    db: DbSession = Depends(session)) -> RedirectResponse:
    """Where the gate forwards Google's answer."""
    if not _google_configured():
        return _fail(request, "nicht-eingerichtet")
    if error or not code:
        # The person pressed "cancel" on Google's own screen, which is
        # not a fault and should not read like one.
        return _fail(request, "abgebrochen")

    expected = request.cookies.get(STATE_COOKIE, "")
    if not expected or not secrets.compare_digest(state, expected):
        return _fail(request, "state")

    nonce = request.cookies.get(NONCE_COOKIE, "")

    try:
        with httpx.Client(timeout=15) as client:
            answer = client.post(GOOGLE_TOKEN, data={
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                # THE SAME STRING AS AT /start. Google validates it.
                "redirect_uri": GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            })
        if answer.status_code != 200:
            return _fail(request, "token")
        id_token = answer.json().get("id_token", "")
        if not id_token:
            return _fail(request, "token")

        # THE SIGNATURE CHECK IS THE WHOLE SECURITY PROPERTY. Without it
        # "sign in with Google" degrades to "tell me who you are and I
        # will believe you" — an unsigned JWT is a base64 string anybody
        # can type. authlib verifies it against Google's published keys
        # and checks the issuer and audience; validate() does exp/iat.
        claims = jwt.decode(id_token, _jwks(), claims_options={
            "iss": {"essential": True, "values": GOOGLE_ISSUERS},
            "aud": {"essential": True, "values": [GOOGLE_CLIENT_ID]},
        })
        claims.validate(leeway=60)
    except Exception:
        # Deliberately one branch: a network failure, a forged token and
        # a rotated key are all "we could not establish who this is", and
        # telling a visitor which would be telling an attacker too.
        return _fail(request, "google")

    if nonce and claims.get("nonce") != nonce:
        return _fail(request, "nonce")

    subject = str(claims.get("sub", ""))
    email = str(claims.get("email", "")).strip().lower()
    verified = bool(claims.get("email_verified", False))
    if not subject or not email:
        return _fail(request, "google")

    member = _member_for_google(db, subject, email, verified)
    if member is None:
        return _fail(request, "unbestaetigt")
    if not member.is_active:
        return _fail(request, "deaktiviert")

    row = _new_session(db, member)
    response = RedirectResponse(MEMBERS_PAGE, status_code=302)
    _set_cookie(response, request, COOKIE, row.id,
                seconds=SESSION_DAYS * 86400)
    response.delete_cookie(STATE_COOKIE, path="/")
    response.delete_cookie(NONCE_COOKIE, path="/")
    return response


def _member_for_google(db: DbSession, subject: str, email: str,
                       verified: bool) -> Member | None:
    """Find or make the member this Google account belongs to.

    THREE CASES, AND THE MIDDLE ONE IS THE WHOLE REASON `Identity` IS A
    SEPARATE TABLE:

      1. We have seen this Google account before -> its member.
      2. We have not, but the address already has an account -> ATTACH,
         so the person who signed up with a password in March and
         pressed the Google button in June is one member, not two.
      3. Neither -> a new member, with no password.

    KEYED ON `sub`, NOT ON THE EMAIL. Google documents `sub` as the
    stable identifier; an address can be changed by its owner, and
    keying on it would make a member who renames their Google account a
    stranger to us.
    """
    identity = db.scalar(
        select(Identity).where(Identity.provider == "google",
                               Identity.subject == subject))
    if identity is not None:
        return db.get(Member, identity.member_id)

    member = db.scalar(select(Member).where(Member.email == email))

    if member is None:
        # A NEW ACCOUNT NEEDS A PROVEN ADDRESS. Google says whether it
        # has verified it, and an unverified one could be anybody's —
        # accepting it would let somebody claim an address they do not
        # own and, worse, be waiting when its real owner arrives.
        if not verified:
            return None
        member = Member(email=email, password_hash=None, email_verified=True)
        db.add(member)
        db.flush()
    elif verified and not member.email_verified:
        # Google has proven what we had only been told.
        member.email_verified = True

    # ATTACHING TO AN EXISTING ACCOUNT ALSO REQUIRES THE PROOF, and for a
    # sharper reason than creating one: an unverified Google account
    # claiming an address that already has a member here would be a
    # takeover of that member.
    if member.password_hash is not None and not verified:
        return None

    db.add(Identity(member_id=member.id, provider="google", subject=subject))
    db.commit()
    return member

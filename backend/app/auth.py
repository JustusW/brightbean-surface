"""Signing in: with a password, or with Google. Both, inclusively.

BOTH, NOT EITHER. The shepherd's rule — "the or for the signup/login is
inclusive, so both are supported" — means the same person must not end
up holding two accounts because they pressed a different button on a
different day. Two things enforce that: `Member.email` is unique and
lowercased, and `Identity` is a separate table, so attaching Google to
an account that already exists is an INSERT rather than a second member.

THE OAUTH FLOW IS AUTHLIB'S. NOT ONE LINE OF IT IS OURS.

The first attempt at this file used authlib only to check the ID token
and hand-wrote everything around it — the authorize URL through
urlencode, state and nonce in cookies of my own, the code exchange as a
raw httpx POST, and Google's three endpoints as constants. It was
deleted rather than repaired, on instruction, and the instruction was
right:

    "did you just fucking handroll oauth instead of using a fucking
     python package?"
    "first you fucking delete everything you wrote because if you don't
     you'll just fucking sneak your dangerous dog doodoo back in"

WRITTEN AGAINST notes/authlib-client-api.txt, which is 79 kB of the
library's published documentation on disk — there for the same reason
notes/swiper-api.txt is, and read before this file was written rather
than after it broke. What the client does for us, in their words:

    "Authlib has called .parse_id_token automatically, we can get
     userinfo in the token"                     — Starlette Integration

So `authorize_redirect` builds the URL from Google's discovery document
and stores the state and the nonce; `authorize_access_token` compares
the state, exchanges the code with the identical redirect_uri, verifies
the ID token's signature against Google's published keys, and checks
the issuer, audience, expiry and nonce. All of that is theirs, and it
is the half with the footguns.

WHAT IS LEFT HERE IS THE HALF THAT IS GENUINELY OURS: which member a
verified Google identity corresponds to, and how a password is stored.

WE KEEP NO GOOGLE TOKEN, and their documentation says so plainly:
"If your application ONLY needs login via 3rd party services like
Google, Facebook and GitHub to login, you DON'T need to create the
token database." There is nothing to do on a member's behalf at Google,
so there is nothing worth the risk of storing.

    browser -> accounts.google.com
            -> https://login.wingert.dev/accounts/google/login/vfm/  (302)
            -> /api/auth/google/callback on this site

The gate is a redirector that holds no session and stores nothing. The
final hop is a top-level GET navigation to this origin, so the
SameSite=Lax session cookie set before the round trip is still sent.
"""

from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from authlib.integrations.starlette_client import OAuth, OAuthError
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

#: The gate, registered with Google as an authorised redirect URI. Not
#: built from the incoming request: Google compares this string between
#: the authorize call and the token call, and authlib only keeps them
#: identical if it is handed the same one.
GOOGLE_REDIRECT_URI = os.environ.get("SURFACE_GOOGLE_REDIRECT_URI", "")

#: DISCOVERY, rather than three endpoints written down here. authlib
#: reads the authorize, token and JWKS URLs, the issuer and the
#: supported algorithms out of this — so a rotated key or a moved
#: endpoint is not something this repository has to be edited for.
GOOGLE_METADATA = "https://accounts.google.com/.well-known/openid-configuration"

#: Signs the SHORT-LIVED Starlette session that authlib keeps the OAuth
#: state and nonce in. Not the login session, which is a database row —
#: this cookie exists for the length of one round trip to Google.
SESSION_SECRET = os.environ.get("SURFACE_SESSION_SECRET", "")

#: False only for local development over plain http, where a Secure
#: cookie is simply never stored and the login silently does nothing.
HTTPS = os.environ.get("SURFACE_HTTPS", "1") != "0"

#: Where the browser is sent when the round trip is over, win or lose.
MEMBERS_PAGE = "/mitglieder"

hasher = PasswordHasher()

#: Verified against when no member matches, so that "no such address" and
#: "wrong password" take about the same time. Without it the response
#: time answers "does this person have an account here", which is a
#: question a login form should not be willing to answer.
DUMMY_HASH = hasher.hash("a password that is not anybody's")


def google_configured() -> bool:
    return bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
                and GOOGLE_REDIRECT_URI and SESSION_SECRET)


#: THE CLIENT. Registered once at import.
oauth = OAuth()
if google_configured():
    oauth.register(
        name="google",
        server_metadata_url=GOOGLE_METADATA,
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        client_kwargs={
            # openid and email ONLY — NOT `profile`, which the library's
            # own examples use. profile brings a name and a picture that
            # models.py deliberately has no column for, and asking for
            # what we would discard is both a worse consent screen and a
            # lie about what the club wants.
            "scope": "openid email",
            # PKCE. Documented as: "You register your remote app with a
            # code_challenge_method in client_kwargs... the only
            # supported code_challenge_method is S256." This client has
            # a secret and does not strictly need it; it costs one line
            # and closes code interception on the redirect back.
            "code_challenge_method": "S256",
        },
    )


# ---------------------------------------------------------------------------
# Cookies and sessions
# ---------------------------------------------------------------------------


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE,
        token,
        max_age=SESSION_DAYS * 86400,
        path="/",
        # No JavaScript on this site has any business reading this, and
        # HttpOnly is what turns a cross-site scripting bug from "every
        # session is stolen" into "a page looked wrong".
        httponly=True,
        secure=HTTPS,
        # Lax rather than Strict, and that is required rather than
        # relaxed: the Google round trip comes BACK to this origin as a
        # top-level navigation from another site, and Strict would
        # withhold the cookie at exactly that moment.
        samesite="lax",
    )


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
    # somebody in — a sweep is housekeeping, this is the rule.
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
def signup(payload: dict = Body(default={}),
           db: DbSession = Depends(session)) -> JSONResponse:
    email = _clean_email(payload.get("email", ""))
    password = _check_password(payload.get("password", ""))

    if db.scalar(select(Member).where(Member.email == email)) is not None:
        # REFUSED, and NOT quietly turned into "set a password on that
        # account". A member who arrived through Google has no password,
        # and letting a stranger who knows their address choose one would
        # be a takeover with a friendly form in front of it. Adding a
        # password to an existing account is a job for somebody already
        # signed in, and it is not built.
        #
        # This does tell an anonymous visitor that an address has an
        # account here. A real trade-off, taken deliberately: the
        # alternative is a signup that silently does nothing, on a club
        # site with a few dozen members.
        raise HTTPException(
            status_code=409,
            detail="Für diese E-Mail-Adresse gibt es bereits ein Konto. "
                   "Bitte melde Dich an.")

    member = Member(email=email, password_hash=hasher.hash(password))
    db.add(member)
    db.commit()

    row = _new_session(db, member)
    response = JSONResponse(_account(member))
    _set_session_cookie(response, row.id)
    return response


@router.post("/login")
def login(payload: dict = Body(default={}),
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
        # would send a Google member round the same wrong loop for ever.
        raise HTTPException(
            status_code=409,
            detail="Dieses Konto wurde mit Google angelegt. Bitte melde "
                   "Dich mit Google an.")

    try:
        hasher.verify(member.password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        raise HTTPException(
            status_code=401,
            detail="E-Mail-Adresse oder Passwort ist falsch.")

    if not member.is_active:
        raise HTTPException(
            status_code=403,
            detail="Dieses Konto ist deaktiviert. Bitte wende Dich an den "
                   "Vorstand.")

    # argon2 publishes its parameters inside the hash, so a stored one
    # can be recognised as weaker than today's default and upgraded
    # while we legitimately hold the plaintext — which is here and
    # nowhere else.
    if hasher.check_needs_rehash(member.password_hash):
        member.password_hash = hasher.hash(password)
        db.commit()

    row = _new_session(db, member)
    response = JSONResponse(_account(member))
    _set_session_cookie(response, row.id)
    return response


@router.post("/logout", status_code=204)
def logout(request: Request, db: DbSession = Depends(session)) -> Response:
    token = request.cookies.get(COOKIE)
    if token:
        row = db.get(SessionRow, token)
        if row is not None:
            # THE ROW GOES. Not a flag, not an expiry brought forward —
            # deleted, so the credential in that cookie refers to
            # nothing. That is the property a self-contained token
            # cannot have.
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


def _fail(why: str) -> RedirectResponse:
    """Back to the members page, saying what went wrong.

    A REDIRECT AND NOT AN ERROR PAGE, because the person is a club
    member who pressed a button, not an API client. The reason travels
    as a short code the page turns into German — the browser has left
    this origin and come back, so there is nowhere else to put it.
    """
    return RedirectResponse(f"{MEMBERS_PAGE}?fehler={why}", status_code=302)


@router.get("/google/start")
async def google_start(request: Request):
    """Send the browser to Google. One call, and it is authlib's."""
    if not google_configured():
        raise HTTPException(
            status_code=503,
            detail="Die Anmeldung mit Google ist auf diesem Server nicht "
                   "eingerichtet.")
    return await oauth.google.authorize_redirect(
        request,
        GOOGLE_REDIRECT_URI,
        # Somebody signing in to a club site is quite likely to hold
        # several Google accounts. Offering the chooser is kinder than
        # silently using whichever they last used. Extra parameters go
        # straight onto the authorization URL.
        prompt="select_account",
    )


@router.get("/google/callback")
async def google_callback(request: Request,
                          db: DbSession = Depends(session)):
    """Where the gate forwards Google's answer."""
    if not google_configured():
        return _fail("nicht-eingerichtet")
    if request.query_params.get("error"):
        # The person pressed "cancel" on Google's own screen. Not a
        # fault, and it should not read like one.
        return _fail("abgebrochen")

    try:
        # THE WHOLE EXCHANGE, and every part of it is the library's:
        # state compared against the session, PKCE verifier presented,
        # code POSTed with the identical redirect_uri, the ID token's
        # signature checked against Google's published keys, and the
        # issuer, audience, expiry and nonce validated.
        token = await oauth.google.authorize_access_token(request)
    except OAuthError:
        return _fail("google")
    except Exception:
        # A network failure, a rotated key, a mangled query. All of them
        # mean "we could not establish who this is", and telling a
        # visitor which would be telling an attacker too.
        return _fail("google")

    # parse_id_token has already run — see the module docstring.
    claims = token.get("userinfo") or {}
    subject = str(claims.get("sub", ""))
    email = str(claims.get("email", "")).strip().lower()
    verified = bool(claims.get("email_verified", False))
    if not subject or not email:
        return _fail("google")

    member = _member_for_google(db, subject, email, verified)
    if member is None:
        return _fail("unbestaetigt")
    if not member.is_active:
        return _fail("deaktiviert")

    row = _new_session(db, member)
    response = RedirectResponse(MEMBERS_PAGE, status_code=302)
    _set_session_cookie(response, row.id)
    return response


def _member_for_google(db: DbSession, subject: str, email: str,
                       verified: bool) -> Member | None:
    """Find or make the member this Google account belongs to.

    THIS is the part that is genuinely ours. authlib can prove who
    Google says this is; nothing outside the club can decide which
    member that corresponds to.

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

    # ATTACHING TO AN EXISTING ACCOUNT ALSO REQUIRES THE PROOF, for a
    # sharper reason than creating one: an unverified Google account
    # claiming an address that already has a member here would be a
    # takeover of that member.
    if member.password_hash is not None and not verified:
        return None

    db.add(Identity(member_id=member.id, provider="google", subject=subject))
    db.commit()
    return member

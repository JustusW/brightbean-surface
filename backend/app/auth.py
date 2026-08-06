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

import hashlib
import os
import secrets
import time
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from authlib.integrations.starlette_client import OAuth, OAuthError
from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from . import mail
from .models import Identity, Member, Session as SessionRow, Token
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
    return {
        "email": member.email,
        "approved": member.is_approved,
        # So the members area knows whether to offer the registrations
        # list. It is NOT what authorises anything: every admin endpoint
        # below checks the column again, server-side, because a flag the
        # browser holds is a flag the browser can edit.
        "admin": member.is_admin,
        # And whether to offer the enquiries console. Same caveat, same
        # reason: app/enquiry.py asks the column again on every call and
        # answers 404 to anybody without it.
        "can_answer": member.can_answer,
    }


def require_admin(member: Member | None = Depends(current_member)) -> Member:
    """Refuse anybody who is not on the board.

    ONE DEPENDENCY, USED BY EVERY ADMIN ROUTE, so "is this person
    allowed" is answered in exactly one place. Scattering the check
    through the handlers is how one of them eventually gets written
    without it.

    404 AND NOT 403 for a signed-in non-admin: an ordinary member has no
    business learning that a members-administration API exists at all.
    Somebody who is not signed in gets the usual 401, because that is
    simply the state they are in.
    """
    if member is None:
        raise HTTPException(status_code=401, detail="Nicht angemeldet.")
    if not member.is_admin:
        raise HTTPException(status_code=404, detail="Nicht gefunden.")
    return member


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------
#
# "Everything is nailed to a static 1s and after 3 failed attempts it
# becomes 5s."
#
# FLAT, AND DELIBERATELY NOT A TOKEN BUCKET. There is no burst allowance,
# no sliding window and no per-endpoint tuning to get wrong: one attempt
# per second, and one per five seconds once somebody has got it wrong
# three times. A club of a few dozen people never notices; a script
# trying passwords gets 720 attempts an hour instead of as many as the
# CPU will bear.
#
# THE argon2 COST IS WHY THIS MATTERS IN BOTH DIRECTIONS. It makes each
# guess expensive for an attacker, which is the point — and it makes each
# guess expensive for OUR server, which is the danger: without a floor,
# a single machine hammering /login is a CPU exhaustion attack that we
# built ourselves.
#
# IN MEMORY, IN ONE PROCESS, AND THAT IS HONEST HERE. The surface runs as
# a single uvicorn in a single container, so this dictionary IS the whole
# state. If it ever runs as two processes this becomes a per-process
# limit and the numbers double; that is a thing to fix when it happens
# rather than a reason to put a cache server on a club website today.

#: Seconds between attempts, before and after the patience runs out.
FLOOR = 1.0
PENALTY = 5.0
AFTER = 3

#: caller -> (when we last answered them, how many failures in a row)
_SEEN: dict[str, tuple[float, int]] = {}

#: Nothing here is worth remembering for long, and an unbounded dict on a
#: public endpoint is its own denial of service. Entries idle for longer
#: than this are dropped when the table is next swept.
_FORGET_AFTER = 3600.0
_SWEEP_AT = 4096


def _who(request: Request) -> str:
    """Who is asking, as well as we can tell.

    X-Forwarded-For FROM OUR OWN nginx, which is the only thing that can
    reach this process — it listens on loopback and nothing else is
    proxied to it. Trusting that header from an arbitrary source would
    let anybody pick their own rate-limit bucket by forging it; here the
    hop in front of us sets it.

    The left-most entry is the original client. On a NAT — a whole club
    behind one connection at the field — several people share a bucket,
    and at one second that is a cost nobody will feel.
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    first = forwarded.split(",")[0].strip()
    if first:
        return first
    return request.client.host if request.client else "unknown"


def _sweep(now: float) -> None:
    if len(_SEEN) < _SWEEP_AT:
        return
    for key, (last, _) in list(_SEEN.items()):
        if now - last > _FORGET_AFTER:
            del _SEEN[key]


def throttle(request: Request) -> str:
    """Refuse anybody who is asking again too soon. Returns their key.

    A DEPENDENCY, so it runs BEFORE the handler and therefore before
    argon2 does any work — a limiter that only takes effect after the
    expensive part has run does not limit the expense.
    """
    key = _who(request)
    now = time.monotonic()
    _sweep(now)

    last, failures = _SEEN.get(key, (0.0, 0))
    wait = PENALTY if failures >= AFTER else FLOOR
    if now - last < wait:
        raise HTTPException(
            status_code=429,
            detail=f"Zu viele Versuche. Bitte warte {int(wait)} Sekunden "
                   f"und versuche es dann noch einmal.",
            # SO A CLIENT CAN DO THE RIGHT THING WITHOUT GUESSING. It is
            # also what a well-behaved script honours, which is the
            # difference between a mistake and an attack.
            headers={"Retry-After": str(int(wait))},
        )

    # The clock advances on every ATTEMPT, not only on failures: the
    # floor is a rate limit, not a punishment.
    _SEEN[key] = (now, failures)
    return key


def _failed(key: str) -> None:
    """Record a refusal, which is what escalates 1s to 5s."""
    last, failures = _SEEN.get(key, (time.monotonic(), 0))
    _SEEN[key] = (last, failures + 1)


def _cleared(key: str) -> None:
    """Forget the failures. Called when somebody actually gets in.

    Otherwise a member who mistypes three times and then succeeds keeps
    the five-second penalty for the rest of the hour, which punishes the
    person the limit exists to protect.
    """
    last, _ = _SEEN.get(key, (time.monotonic(), 0))
    _SEEN[key] = (last, 0)


# ---------------------------------------------------------------------------
# One-time links: proving an address, and resetting a password
# ---------------------------------------------------------------------------
#
# BOTH ARE THE SAME MECHANISM. Put a secret in somebody's mailbox and let
# whoever can read that mailbox present it back. What differs is only
# what presenting it entitles you to, and how long it lasts.

VERIFY = "verify"
RESET = "reset"

#: Three days to click a confirmation, one hour to reset a password.
#:
#: DIFFERENT BECAUSE THE STAKES ARE DIFFERENT. A confirmation link proves
#: an address and grants nothing; somebody who reads it a day later has
#: lost nothing. A reset link is a full account takeover in one click, so
#: it should be dead by the time a forwarded mail or a shared screenshot
#: has travelled anywhere.
LIFETIME_HOURS = {VERIFY: 72, RESET: 1}

#: Where the links point. The public address of this site, declared in
#: params.conf and written into .env — deliberately NOT built from the
#: incoming request's Host header, which an attacker controls and which
#: is the standard way reset links get poisoned into pointing at
#: somebody else's server.
PUBLIC_BASE = os.environ.get("SURFACE_PUBLIC_BASE", "").rstrip("/")


def _fingerprint(secret: str) -> str:
    """What gets STORED for a secret that was sent.

    sha256 and not argon2, and the difference from a password is the
    point: this value has 256 bits of CSPRNG behind it, so there is no
    dictionary to attack and no work factor worth paying. A password is
    slow to hash because people choose weak ones.
    """
    return hashlib.sha256(secret.encode()).hexdigest()


def _issue(db: DbSession, member: Member, purpose: str) -> str:
    """Mint a one-time link for this member and return the SECRET.

    The secret is returned and never stored — only its fingerprint goes
    in the table. It exists in exactly one other place, the message we
    are about to send, which is why a lost one can be reissued but never
    re-sent.

    ANY EARLIER LINK OF THE SAME PURPOSE IS DELETED FIRST. Otherwise
    every press of "forgot my password" leaves another working key to
    the same account lying in a mailbox, and the oldest of them stays
    valid for its full hour. One live link per purpose, and the newest
    wins.
    """
    for old in db.scalars(select(Token).where(
            Token.member_id == member.id, Token.purpose == purpose)).all():
        db.delete(old)

    secret = secrets.token_urlsafe(32)
    db.add(Token(
        id=_fingerprint(secret),
        member_id=member.id,
        purpose=purpose,
        expires_at=datetime.now(timezone.utc)
        + timedelta(hours=LIFETIME_HOURS[purpose]),
    ))
    db.commit()
    return secret


def _spend(db: DbSession, secret: str, purpose: str) -> Member | None:
    """Redeem a link, exactly once. None if it is not good.

    ONE ANSWER FOR EVERY WAY OF BEING NOT GOOD — unknown, wrong purpose,
    expired, or attached to an account that has since gone. The caller
    says "this link is no longer valid", which is all a person can act
    on anyway, and telling them WHICH would tell somebody guessing which
    of their guesses was closest.
    """
    row = db.get(Token, _fingerprint(secret))
    if row is None or row.purpose != purpose:
        return None

    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires <= datetime.now(timezone.utc):
        # Spent by expiry: the row goes, so a link that has run out
        # cannot sit in the table waiting for a clock to be wrong.
        db.delete(row)
        db.commit()
        return None

    member = db.get(Member, row.member_id)
    # DELETED WHETHER OR NOT THE MEMBER IS STILL THERE. One use is one
    # use, and a token whose account has gone is simply litter.
    db.delete(row)
    db.commit()
    return member


def _send_already_registered(member: Member) -> None:
    """Somebody tried to register an address that already has an account.

    THE ONLY PLACE THAT DIFFERENCE IS ALLOWED TO SHOW. The HTTP answer is
    the same 204 either way, so this note is the whole of what
    distinguishes the two cases — and it goes to the mailbox, where only
    its owner can read it.

    IT IS ALSO USEFUL RATHER THAN MERELY SAFE: if it was not them, they
    have just learned that somebody else is typing their address into a
    club's signup form, which is worth knowing.

    NO LINK AND NO TOKEN. This message is sent to whoever owns the
    address without anybody having proved anything, so it must not carry
    anything that can be acted on. If they want back in, the login form
    and "Passwort vergessen?" are where they already were.
    """
    if not mail.configured() or not PUBLIC_BASE:
        return
    mail.send(
        member.email,
        "Es gibt bereits ein Konto für diese Adresse",
        "Hallo,\n\n"
        "mit dieser E-Mail-Adresse wurde gerade versucht, ein Konto im "
        "Mitgliederbereich des Vereins für Modellflug Stutensee "
        "anzulegen. Ein Konto für diese Adresse gibt es aber schon.\n\n"
        "Wenn Du das warst: Du kannst Dich direkt anmelden.\n\n"
        f"{PUBLIC_BASE}{MEMBERS_PAGE}\n\n"
        "Falls Du Dein Passwort nicht mehr weißt, benutze dort "
        "\"Passwort vergessen?\". Wenn Du Dich seinerzeit mit Google "
        "angemeldet hast, nimm den Google-Knopf.\n\n"
        "Wenn Du das nicht warst, ist nichts passiert — es wurde kein "
        "zweites Konto angelegt und an Deinem bestehenden hat sich "
        "nichts geändert.\n",
    )


def _send_verification(db: DbSession, member: Member) -> None:
    """Ask somebody to prove the address they just typed.

    NEVER RAISES, and the account exists either way. Signing up is not
    conditional on our relay being reachable — the board approves by
    hand, so an unproven address is inspected by a person before it is
    let anywhere.
    """
    if not mail.configured() or not PUBLIC_BASE:
        return
    secret = _issue(db, member, VERIFY)
    mail.send(
        member.email,
        "Bitte bestätige Deine E-Mail-Adresse",
        f"Hallo,\n\n"
        f"für diese E-Mail-Adresse wurde ein Konto im Mitgliederbereich "
        f"des Vereins für Modellflug Stutensee angelegt.\n\n"
        f"Bitte bestätige die Adresse mit diesem Link:\n\n"
        f"{PUBLIC_BASE}{MEMBERS_PAGE}?bestaetigen={secret}\n\n"
        f"Der Link gilt {LIFETIME_HOURS[VERIFY]} Stunden.\n\n"
        f"Wenn Du Dich nicht registriert hast, kannst Du diese Nachricht "
        f"einfach ignorieren — ohne Bestätigung passiert nichts, und ein "
        f"Konto wird ohnehin erst von einem Administrator freigeschaltet.\n",
    )


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


@router.post("/signup", status_code=204)
def signup(payload: dict = Body(default={}),
           db: DbSession = Depends(session),
           _key: str = Depends(throttle)) -> Response:
    """Register — and say the same thing whether or not we know you.

    THIS USED TO BE A MEMBERSHIP ORACLE, AND I DEFENDED IT IN WRITING.
    It answered 409 "Für diese E-Mail-Adresse gibt es bereits ein Konto"
    for an address that had one, and 200 for one that did not, so anybody
    could walk a list of addresses through this form and learn which
    people belong to this club. I called that "a real trade-off, taken
    deliberately" and then cited it as precedent in the reset route.

        "We are NOT doxing people."

    Membership of a named association, tied to a named person's email
    address, is exactly the sort of personal data a public form must not
    hand out — and unlike a password, the people exposed never chose to
    take the risk.

    SO THE ANSWER IS ALWAYS 204, and the difference goes where only the
    address's owner can see it: into the mailbox. A new address gets a
    confirmation link. An address that already has an account gets a note
    saying so — which is useful to its owner (somebody just tried to
    register with your address) and invisible to everybody else.

    THE CONSEQUENCE IS THAT SIGNING UP NO LONGER SIGNS YOU IN, and that
    is not a side effect to be worked around: if a new account got a
    session and an existing one did not, the two would still be
    distinguishable and the leak would simply have moved. Everyone gets
    the same page telling them to check their mail.

    STILL NEVER "set a password on the existing account". A member who
    arrived through Google has none, and letting a stranger who knows
    their address choose one would be a takeover with a friendly form in
    front of it.
    """
    email = _clean_email(payload.get("email", ""))
    password = _check_password(payload.get("password", ""))

    # HASHED BEFORE THE LOOKUP, ALWAYS, and thrown away on the branch
    # that does not need it. argon2 is deliberately expensive, so doing
    # it in one branch and not the other would leave the answer legible
    # in the response TIME — the same disclosure, measured with a stop
    # watch instead of read off the screen.
    fresh_hash = hasher.hash(password)

    existing = db.scalar(select(Member).where(Member.email == email))
    if existing is not None:
        _send_already_registered(existing)
        return Response(status_code=204)

    member = Member(email=email, password_hash=fresh_hash)
    db.add(member)
    db.commit()

    # PROVE THE ADDRESS. Until this file existed, email_verified was
    # never set for a password signup at all, so anybody could register
    # an address they did not own and simply be waiting when its real
    # owner arrived. The board approving by hand was the only thing in
    # the way, and that is a person's attention rather than a control.
    #
    # It does not gate signing in, and deliberately: the club's gate is
    # approval, and locking somebody out of a page that only says "wait
    # for the board" because our relay was down would be punishing them
    # for our outage. What verification does is tell the board which
    # addresses are real.
    _send_verification(db, member)

    # THE SAME 204 THE OTHER BRANCH RETURNS. No session, no body, nothing
    # that differs by so much as a byte — see the docstring. Signing the
    # new account in here is exactly what would put the oracle back.
    return Response(status_code=204)


@router.post("/login")
def login(payload: dict = Body(default={}),
          db: DbSession = Depends(session),
          key: str = Depends(throttle)) -> JSONResponse:
    email = _clean_email(payload.get("email", ""))
    password = payload.get("password", "") or ""

    member = db.scalar(select(Member).where(Member.email == email))

    if member is None:
        # Same work, same time. See DUMMY_HASH.
        try:
            hasher.verify(DUMMY_HASH, password)
        except Exception:
            pass
        _failed(key)
        raise HTTPException(
            status_code=401,
            detail="E-Mail-Adresse oder Passwort ist falsch.")

    if member.password_hash is None:
        # THE SAME REFUSAL AS A WRONG PASSWORD, and the comment that used
        # to be here is worth recording as evidence: it argued that
        # saying "this account uses Google" costs nothing extra BECAUSE
        # signup already revealed that the address has an account. That
        # is one leak being used to justify a second, which is how a
        # policy rots from the inside. Signup no longer reveals it, and
        # neither does this.
        #
        # A GOOGLE MEMBER IS NOT LEFT STRANDED. The Google button sits on
        # the same form, and "Passwort vergessen?" sends them a message —
        # to their own mailbox — saying which button to press.
        #
        # The dummy verify keeps the timing alongside the other two
        # refusals: an account with no password would otherwise answer
        # noticeably faster than one with a wrong password, which is the
        # same disclosure read off a clock.
        try:
            hasher.verify(DUMMY_HASH, password)
        except Exception:
            pass
        _failed(key)
        raise HTTPException(
            status_code=401,
            detail="E-Mail-Adresse oder Passwort ist falsch.")

    try:
        hasher.verify(member.password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        _failed(key)
        raise HTTPException(
            status_code=401,
            detail="E-Mail-Adresse oder Passwort ist falsch.")

    if not member.is_active:
        raise HTTPException(
            status_code=403,
            detail="Dieses Konto ist deaktiviert. Bitte wende Dich an einen "
                   "Administrator.")

    # argon2 publishes its parameters inside the hash, so a stored one
    # can be recognised as weaker than today's default and upgraded
    # while we legitimately hold the plaintext — which is here and
    # nowhere else.
    if hasher.check_needs_rehash(member.password_hash):
        member.password_hash = hasher.hash(password)
        db.commit()

    # THEY GOT IN, so the failures are forgotten. Otherwise a member who
    # mistypes three times and then succeeds carries the five-second
    # penalty around for the rest of the hour — punishing exactly the
    # person the limit exists to protect.
    _cleared(key)

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


@router.post("/verify")
def verify(payload: dict = Body(default={}),
           db: DbSession = Depends(session),
           key: str = Depends(throttle)) -> JSONResponse:
    """Redeem a confirmation link.

    A POST rather than a GET, even though it arrives as a link. Mail
    clients and corporate scanners FETCH links to preview them, and a
    GET that changes state gets spent by a robot before the member has
    read the message. So the link opens the members page, and the page
    posts the token.
    """
    secret = (payload.get("token", "") or "").strip()
    member = _spend(db, secret, VERIFY) if secret else None
    if member is None:
        # A BAD TOKEN COUNTS AS A FAILED ATTEMPT, so guessing at 256-bit
        # secrets slows to one attempt per five seconds like everything
        # else. Guessing was never going to work; being able to try
        # thousands of times a second is still not something to offer.
        _failed(key)
        raise HTTPException(
            status_code=400,
            detail="Dieser Bestätigungslink ist nicht mehr gültig. Bitte "
                   "fordere einen neuen an.")

    member.email_verified = True
    db.commit()
    # NOT SIGNED IN by this. Proving an address says the mailbox is
    # theirs, not that the person at this browser is them — and an
    # unattended mail client fetching a link should never end up holding
    # a session.
    return JSONResponse({"email": member.email, "verified": True})


@router.post("/reset/request", status_code=204)
def reset_request(payload: dict = Body(default={}),
                  db: DbSession = Depends(session),
                  _key: str = Depends(throttle)) -> Response:
    """Ask for a password reset link.

    ALWAYS 204, whatever is true. Answering differently for an address
    that has an account turns this into a membership oracle that anybody
    can query — and a club's membership list is exactly the sort of
    thing that should not be assembled from a public form.

    This paragraph used to end by noting that /signup revealed it anyway,
    "deliberately", as though that made it acceptable here. It did not:
    it made /signup the leak and this route's care pointless, since an
    attacker only needs one door. Both are shut now, and the rule is
    flat — NO endpoint on this site tells an unauthenticated caller
    whether a given person has an account.
    """
    email = (payload.get("email", "") or "").strip().lower()
    member = (db.scalar(select(Member).where(Member.email == email))
              if email and "@" in email else None)

    if member is not None and member.is_active and mail.configured() \
            and PUBLIC_BASE:
        if member.password_hash is None:
            # A GOOGLE-ONLY ACCOUNT. Sending a reset link would let
            # somebody who has the mailbox ADD a password to an account
            # that deliberately has none — so instead the mailbox's
            # owner is simply told which button to press. This reveals
            # nothing to anybody else: it goes to the address itself,
            # and the HTTP answer is 204 either way.
            mail.send(
                member.email,
                "Anmeldung im Mitgliederbereich",
                "Hallo,\n\n"
                "für diese Adresse wurde ein neues Passwort angefordert.\n\n"
                "Dieses Konto wurde mit Google angelegt und hat kein "
                "Passwort. Bitte melde Dich mit \"Mit Google anmelden\" an:\n\n"
                f"{PUBLIC_BASE}{MEMBERS_PAGE}\n",
            )
        else:
            secret = _issue(db, member, RESET)
            mail.send(
                member.email,
                "Neues Passwort für den Mitgliederbereich",
                "Hallo,\n\n"
                "für Dein Konto im Mitgliederbereich wurde ein neues "
                "Passwort angefordert.\n\n"
                "Mit diesem Link kannst Du eines setzen:\n\n"
                f"{PUBLIC_BASE}{MEMBERS_PAGE}?zuruecksetzen={secret}\n\n"
                f"Der Link gilt {LIFETIME_HOURS[RESET]} Stunde und kann "
                "nur einmal verwendet werden.\n\n"
                "Wenn Du das nicht warst, ist nichts passiert — solange "
                "der Link nicht benutzt wird, bleibt Dein bisheriges "
                "Passwort gültig.\n",
            )

    return Response(status_code=204)


@router.post("/reset/confirm")
def reset_confirm(payload: dict = Body(default={}),
                  db: DbSession = Depends(session),
                  key: str = Depends(throttle)) -> JSONResponse:
    """Set a new password with a reset link."""
    secret = (payload.get("token", "") or "").strip()
    password = _check_password(payload.get("password", ""))

    member = _spend(db, secret, RESET) if secret else None
    if member is None:
        _failed(key)
        raise HTTPException(
            status_code=400,
            detail="Dieser Link ist nicht mehr gültig. Bitte fordere einen "
                   "neuen an.")
    if not member.is_active:
        raise HTTPException(
            status_code=403,
            detail="Dieses Konto ist deaktiviert. Bitte wende Dich an einen "
                   "Administrator.")

    member.password_hash = hasher.hash(password)
    # THEY PROVED THE MAILBOX. Anybody arriving here read a message we
    # sent to that address, which is the same evidence a confirmation
    # link carries — so recording it is honest rather than generous.
    member.email_verified = True

    # EVERY OTHER SESSION ENDS. A password reset is what somebody does
    # when they think their account is compromised, and leaving the
    # intruder's session alive would make it ceremony. This is the
    # property a server-side session table exists to give: the rows go,
    # and the cookies holding their ids refer to nothing.
    for row in db.scalars(select(SessionRow).where(
            SessionRow.member_id == member.id)).all():
        db.delete(row)
    db.commit()

    # And then signed in, on this browser, with a fresh session — they
    # have just proved the mailbox and chosen the password.
    _cleared(key)
    row = _new_session(db, member)
    response = JSONResponse(_account(member))
    _set_session_cookie(response, row.id)
    return response


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


# ---------------------------------------------------------------------------
# The board: seeing who has registered, and letting them in
# ---------------------------------------------------------------------------
#
# WHY THIS IS ON THE WEBSITE AND NOT ONLY IN THE CONTROL PLANE. Approving
# a member is a CLUB decision, made by people who will never open a
# terminal or a tailnet. members.py and Vogelwarte's button remain — they
# are how the FIRST admin is made, and how somebody with the server
# recovers if this ever breaks — but the routine act belongs where the
# board already is.


@router.get("/registrations")
def registrations(_: Member = Depends(require_admin),
                  db: DbSession = Depends(session)) -> JSONResponse:
    """Everybody who has signed up, newest first.

    THE WHOLE LIST, not only those awaiting a decision. An approval
    screen that hides what it has already done gives no way to notice a
    mistake, and "who is in this club" is the question actually being
    asked.
    """
    members = db.scalars(
        select(Member).order_by(Member.created_at.desc())).all()

    # ONE QUERY FOR THE PROVIDERS, not one per member. A club list is
    # short, and it will still be short in ten years — but the habit of
    # asking per row is how a page gets slow somewhere it matters.
    ways: dict[str, list[str]] = {}
    for member_id, provider in db.execute(
            select(Identity.member_id, Identity.provider)).all():
        ways.setdefault(str(member_id), []).append(provider)

    return JSONResponse({"members": [
        {
            "email": m.email,
            "approved": m.is_approved,
            "active": m.is_active,
            "admin": m.is_admin,
            # WHETHER THEY MAY DEAL WITH ENQUIRIES from the contact
            # bubble. A separate question from `admin`, and deliberately
            # so: administering accounts and answering the public are
            # different jobs, and access to the second is for the
            # Vorstand and their Erfüllungsgehilfen — which is neither
            # the set of admins nor any elected body.
            "can_answer": m.can_answer,
            # WHETHER THE ADDRESS WAS EVER PROVEN, which is exactly the
            # question the board is answering when it approves somebody.
            # An unverified address is not a reason to refuse — the club
            # knows its own members, and somebody may simply not have
            # clicked — but it is a reason to look twice.
            "verified": m.email_verified,
            "created": m.created_at.date().isoformat(),
            # How they get in, which is the useful thing to see beside a
            # name: "google" or "password", or both.
            "how": sorted(
                (["password"] if m.password_hash is not None else [])
                + ways.get(str(m.id), [])),
        }
        for m in members
    ]})


@router.post("/registrations/decide")
def decide(payload: dict = Body(default={}),
           admin: Member = Depends(require_admin),
           db: DbSession = Depends(session)) -> JSONResponse:
    """Let somebody in, or put them back out.

    DELIBERATELY NOT A DELETE. Refusing a registration sets approved
    false; it does not remove the account. Somebody who signed up in
    good faith and was declined by a mis-click should still be there to
    be approved a minute later, and an account that vanishes gives the
    person no way to tell whether they ever registered.
    """
    email = (payload.get("email", "") or "").strip().lower()
    verb = (payload.get("what", "") or "").strip().lower()
    if verb not in ("approve", "revoke", "delete", "answer", "unanswer"):
        raise HTTPException(
            status_code=400,
            detail="what muss approve, revoke, delete, answer oder "
                   "unanswer sein.")

    member = db.scalar(select(Member).where(Member.email == email))
    if member is None:
        raise HTTPException(status_code=404,
                            detail="Dieses Konto gibt es nicht.")

    # AN ADMIN CANNOT REVOKE THEMSELVES. Not squeamishness: this is the
    # only privilege that can remove the ability to grant privileges,
    # and a club with no usable admin has to be repaired from the server
    # — which is exactly the situation the website version exists to
    # avoid. Somebody else's admin can still be taken away, on the
    # server, with members.py.
    if member.id == admin.id and verb in ("revoke", "delete"):
        raise HTTPException(
            status_code=409,
            detail="Du kannst Dein eigenes Konto hier nicht sperren oder "
                   "löschen.")

    if verb == "delete":
        # DELETING IS REAL, AND IT IS SUPPOSED TO BE. I had written that
        # "refusing is not deleting" and left no way to remove an account
        # at all — which is not caution, it is a gap: Art. 17 DSGVO gives
        # a person the right to have their data erased, and a club that
        # cannot honour that has a problem no amount of carefulness
        # fixes. The shepherd: "an admin CAN delete an account."
        #
        # The Member goes and takes its identities and sessions with it —
        # models.py declares cascade="all, delete-orphan" on both — so a
        # deleted person leaves nothing behind pointing at them, which is
        # the whole point of erasure.
        db.delete(member)
        db.commit()
        return JSONResponse({"email": email, "deleted": True})

    if verb in ("answer", "unanswer"):
        member.can_answer = verb == "answer"
        # GRANTING IT ALSO LETS THEM IN, mirroring what members.py does
        # for the admin flag and for the same reason: somebody who may
        # deal with enquiries but cannot sign in holds a permission they
        # can never reach, which reads as a broken button rather than as
        # a half-finished decision.
        if member.can_answer:
            member.is_approved = True
        db.commit()
        return JSONResponse({"email": member.email,
                             "can_answer": member.can_answer,
                             "approved": member.is_approved})

    member.is_approved = verb == "approve"
    # TAKING SOMEBODY'S ACCESS AWAY TAKES THIS WITH IT. Leaving the flag
    # set on a revoked account would be a permission lying in wait for
    # the day somebody is approved again for an unrelated reason.
    if verb == "revoke":
        member.can_answer = False
    db.commit()
    return JSONResponse({"email": member.email,
                         "approved": member.is_approved,
                         "can_answer": member.can_answer})

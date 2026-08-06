"""DiscourseConnect: the forum outsources login to THIS site.

WHAT THIS IS FOR, AND WHY IT IS THE POINT RATHER THAN A FEATURE.

The forum was proposed on the promise that members would use the club's
existing authentication. Without this file that promise is broken: the
forum has its own local accounts, its own passwords, its own signup form
— the second account system the whole proposal existed to abolish. The
shepherd, on being asked to register an administrator by hand: "you
proposed using our existing authentication and yet I am asked to fucking
setup an admin account..."

So Discourse stops deciding who anybody is. It sends the browser here,
this site says who they are and whether they are allowed, and the forum
takes our word for it — because the word is signed with a secret only
the two of us hold.

THE PROTOCOL, in the order it actually happens:

  1. Somebody presses "Anmelden" on the forum. Discourse builds
     `nonce=...&return_sso_url=...`, urlencodes it, base64s it, and
     signs THE BASE64 STRING with HMAC-SHA256. It sends the browser to
     SURFACE/api/auth/discourse/sso?sso=<base64>&sig=<hex>.

  2. We verify the signature FIRST, before believing one byte of it.

  3. If nobody is signed in here, we send them to the members page with
     the original request stored, and it brings them back afterwards.

  4. If somebody IS signed in, and the club has approved them, we build
     our own payload — their nonce, their email, and an external_id that
     is OUR member id — base64 it, sign it the same way, and send the
     browser back to Discourse.

  5. Discourse verifies OUR signature, finds or creates the account
     matching that external_id, and logs them in.

THE APPROVAL GATE IS PRESERVED BY REFUSING TO SIGN. That is the whole
of the authorisation model and it is worth stating plainly: there is no
"deny" message to Discourse in this protocol, no rejection payload. The
only way to say no is to not sign, so an unapproved member is bounced
back to the members page and the forum never hears about them. A member
the board later revokes stops being signable the moment the column
flips — they keep whatever Discourse session they already have until it
expires, which is why revoking somebody who matters should also be
followed by looking at the forum.

WEBADMINS ARE FORUM ADMINS. The shepherd's instruction, in those words,
and it closes a real gap rather than adding a convenience: without it,
an administrator of this website signs in to the forum through SSO as an
ordinary member, while the local `user1` account made during the install
remains the only administrator. That is one person holding two forum
identities — precisely the second-account-system this piece exists to
abolish, reintroduced at the far end.

So `Member.is_admin` is sent as both `admin` and `moderator`, and it is
sent on EVERY login rather than only at creation, which makes this site
the source of truth: somebody promoted by hand inside the forum is
demoted again at their next sign-in, and somebody whose admin is taken
away here loses it there without anybody having to remember. That is the
behaviour worth having, and it is worth knowing about before being
surprised by it.

WHAT IS STILL DELIBERATELY NOT SENT:

  A name. models.py has no column for one, on purpose, and inventing a
  display name here would be storing personal data by the back door.

WHAT IS SENT, AND WHY EACH ONE HAS TO BE:

  nonce           Discourse's own, echoed exactly. It is what ties this
                  answer to that question and stops a captured payload
                  being replayed at a later login.
  external_id     OUR member id, a UUID. NOT the email: an address can
                  be changed by its owner, and keying on it would make a
                  member who renames their mailbox a stranger to the
                  forum — losing their posts' authorship. This is the
                  same reasoning that keys Identity on Google's `sub`.
  email           so the forum can reach them.
  email_verified  honestly, from our own column. False means Discourse
                  asks them to confirm, which is correct rather than
                  inconvenient — we are not going to assert something we
                  have not established.
  username        a SUGGESTION only. Discourse rejects usernames it
                  cannot accept, so this is sanitised down to what it
                  will take, and `discourse_connect_overrides_username`
                  is left off so a member can change it afterwards.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import os
import re
import secrets
from urllib.parse import parse_qs, urlencode, urlsplit

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session as DbSession

from .auth import MEMBERS_PAGE, current_member
from .models import Member
from .store import session

router = APIRouter(prefix="/api/auth/discourse", tags=["discourse"])

#: THE SHARED SECRET. Held by exactly two parties — this process and the
#: forum — and by nothing else. Read from the environment, which the
#: installer fills from a root-only file on the server; it never enters
#: this repository, a request body, a plan preview or a job log.
SECRET = os.environ.get("SURFACE_DISCOURSE_CONNECT_SECRET", "")

#: WHERE THE FORUM IS, declared rather than taken from the request.
#:
#: `return_sso_url` arrives inside Discourse's signed payload, so it is
#: not attacker-controlled while the secret holds — but "while the
#: secret holds" is exactly the assumption worth not resting a redirect
#: on. A leaked or mis-shared secret would otherwise turn this endpoint
#: into an open redirector that sends members, mid-login, anywhere at
#: all. So the origin is checked against this, and a mismatch is a
#: refusal rather than a redirect.
FORUM_ORIGIN = os.environ.get("SURFACE_FORUM_ORIGIN", "").rstrip("/")


def configured() -> bool:
    """Is there a forum to sign for, and something to sign with?

    Checked rather than assumed. A development machine has neither, and
    the endpoint must answer plainly instead of signing with an empty
    key — an HMAC with a zero-length secret is a perfectly valid HMAC
    that anybody can forge.
    """
    return bool(SECRET and FORUM_ORIGIN)


def _sign(payload: bytes) -> str:
    """HMAC-SHA256 of the base64 text, hex, as the protocol specifies.

    NOTE WHAT IS SIGNED: the BASE64 STRING, not the querystring inside
    it. Signing the decoded form instead is the classic way to get an
    implementation that works against itself and fails against
    Discourse.
    """
    return hmac.new(SECRET.encode(), payload,
                    hashlib.sha256).hexdigest()


def _verify(sso: str, sig: str) -> dict[str, str] | None:
    """Decode Discourse's request, or None if it is not really theirs.

    ONE ANSWER FOR EVERY WAY OF BEING WRONG — bad signature, bad base64,
    bad encoding, missing nonce. The caller says "that login attempt is
    not valid", which is all anybody can act on, and telling them WHICH
    would help somebody probing at the signature.
    """
    if not sso or not sig:
        return None

    # compare_digest, NOT ==. String equality returns as soon as two
    # bytes differ, so its timing leaks how much of a forged signature
    # was correct — which is enough to build one byte at a time.
    if not hmac.compare_digest(_sign(sso.encode()), sig.strip().lower()):
        return None

    try:
        raw = base64.b64decode(sso, validate=True).decode()
    except (binascii.Error, ValueError, UnicodeDecodeError):
        return None

    fields = {k: v[0] for k, v in parse_qs(raw, keep_blank_values=True).items()}
    if not fields.get("nonce"):
        return None
    return fields


def _return_url(fields: dict[str, str]) -> str | None:
    """Where Discourse wants the browser sent back to. Checked.

    Confined to the declared forum origin — see FORUM_ORIGIN. Falls
    back to Discourse's own documented endpoint when the payload names
    nothing, so a slightly unusual Discourse still works.
    """
    wanted = (fields.get("return_sso_url") or "").strip()
    if not wanted:
        return f"{FORUM_ORIGIN}/session/sso_login"
    parts = urlsplit(wanted)
    origin = f"{parts.scheme}://{parts.netloc}"
    if origin.rstrip("/") != FORUM_ORIGIN:
        return None
    return wanted


#: What Discourse will accept as a username: letters, numbers, and
#: `_ . -` between them. Anything else is stripped rather than sent and
#: refused.
_USERNAME_STRIP = re.compile(r"[^A-Za-z0-9._-]+")


def _username(email: str) -> str:
    """A username Discourse will take, suggested from the address.

    A SUGGESTION, not an identity. external_id is what actually
    identifies the member; this is only what appears beside their posts
    until they change it. Discourse requires at least three characters
    and rejects names that are all punctuation, so a degenerate address
    falls back to something random rather than to a refusal nobody can
    diagnose from the forum's side.
    """
    local = email.split("@", 1)[0]
    cleaned = _USERNAME_STRIP.sub("", local).strip("._-")
    if len(cleaned) < 3:
        return f"mitglied_{secrets.token_hex(3)}"
    return cleaned[:20]


def _bounce(request: Request) -> RedirectResponse:
    """Send them to the members page, remembering where they were going.

    THE RETURN TRIP IS THE WHOLE POINT. Somebody who presses "Anmelden"
    on the forum and is dropped on a login page with no way back has not
    been helped — they have been interrupted. `weiter` carries this
    request, verbatim, and the members page follows it once they are in.

    IT IS SAFE TO CARRY because it is a path on THIS origin with the
    query string Discourse signed. The members page refuses to follow
    anything that is not exactly this endpoint, so it cannot be turned
    into a general open redirect by handing somebody a crafted link.
    """
    target = f"/api/auth/discourse/sso?{request.url.query}"
    return RedirectResponse(
        f"{MEMBERS_PAGE}?weiter={urlencode({'x': target})[2:]}",
        status_code=302)


@router.get("/sso")
def sso(request: Request,
        member: Member | None = Depends(current_member),
        db: DbSession = Depends(session)) -> RedirectResponse:
    """Where the forum sends somebody who wants to log in.

    Answers a redirect in every case, because the caller is a member's
    browser mid-journey rather than an API client — there is nowhere to
    render an error and nobody to read a JSON body.
    """
    if not configured():
        # NOT an exception. A site without the forum wired up should say
        # so on the members page, not present a stack trace to somebody
        # who merely clicked a button.
        return RedirectResponse(f"{MEMBERS_PAGE}?fehler=forum-nicht-eingerichtet",
                                status_code=302)

    fields = _verify(request.query_params.get("sso", ""),
                     request.query_params.get("sig", ""))
    if fields is None:
        # Either somebody is probing this endpoint by hand, or the two
        # secrets have drifted apart — which is what happens if one side
        # is reconfigured and the other is not.
        return RedirectResponse(f"{MEMBERS_PAGE}?fehler=forum-signatur",
                                status_code=302)

    back = _return_url(fields)
    if back is None:
        return RedirectResponse(f"{MEMBERS_PAGE}?fehler=forum-ziel",
                                status_code=302)

    if member is None:
        return _bounce(request)

    # THE GATE. Not signing IS the refusal — see the module docstring.
    # Both halves are checked here even though current_member() already
    # drops inactive accounts, because this is the one place where being
    # wrong hands somebody a forum account.
    if not member.is_active or not member.is_approved:
        return RedirectResponse(f"{MEMBERS_PAGE}?fehler=forum-nicht-freigeschaltet",
                                status_code=302)

    payload = {
        "nonce": fields["nonce"],
        # OURS, and stable across an email change. See the docstring.
        "external_id": str(member.id),
        "email": member.email,
        "username": _username(member.email),
        # Honest, from our own column. If it is false Discourse asks
        # them to confirm, which is the correct outcome rather than an
        # inconvenience to route around.
        "email_verified": "true" if member.email_verified else "false",
        # The club approves members HERE. Telling Discourse to approve
        # them too is not a second decision — it is the same one, and
        # without it a member sits waiting for an approval nobody in the
        # forum is watching for.
        "require_activation": "false" if member.email_verified else "true",
        # WEBADMINS ARE FORUM ADMINS. Sent on every login, both ways —
        # see the module docstring. "false" is as meaningful as "true"
        # here: it is what makes this site authoritative rather than
        # merely initial, so an admin taken away on the members page is
        # taken away in the forum at the next sign-in without anybody
        # having to remember the second half.
        "admin": "true" if member.is_admin else "false",
        "moderator": "true" if member.is_admin else "false",
    }

    encoded = base64.b64encode(urlencode(payload).encode())
    return RedirectResponse(
        f"{back}?" + urlencode({"sso": encoded.decode(),
                                "sig": _sign(encoded)}),
        status_code=302)

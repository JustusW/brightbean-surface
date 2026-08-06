"""The contact bubble: somebody who is not a member, reaching the club.

WHAT IT IS, AND WHAT IT DELIBERATELY IS NOT. A visitor opens a speech
bubble, types whatever they like, and is told — truthfully — that the
message arrived and that somebody will get back to them. It is not a
live chat. Nothing here has a presence indicator, a typing dot or an
"agent is online" badge, because a volunteer club cannot staff one and a
blinking cursor nobody is watching is worse than no bubble at all.

    "these land in our database, a member with the appropriate role can
     see it and answer. period."

So there are no notifications, no mail and no webhook. Storage IS the
delivery, and `app/mail.py` is deliberately not imported.

IN DATA-PROTECTION TERMS THIS IS THE KONTAKTFORMULAR the club's
Datenschutzerklärung already describes — the same data, the same purpose
("zwecks Bearbeitung der Anfrage"), the same basis and the same
retention, with a faster transport. Two properties keep that true, and
both are enforced here rather than promised:

  NOTHING REACHES A THIRD PARTY. Everything is same-origin; this module
  makes no outbound request of any kind.

  NOTHING IS COLLECTED THAT THE FORM WOULD NOT HAVE COLLECTED. There is
  no name field, no address field, no stored IP, no fingerprint and no
  cookie set by this code. Whatever somebody chooses to tell us arrives
  as a MESSAGE and is stored as exactly that.

THE PUBLIC ENDPOINT IS THE ONLY ANONYMOUS WRITE ON THIS SITE, which
makes it the only thing here a bored scanner can fill a table with. It is
bounded three independent ways — MAX_CHARS, MAX_MESSAGES, and the same
throttle the login form uses — because one of them will eventually turn
out to be the wrong one.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from .auth import current_member, throttle
from .models import Enquiry, EnquiryMessage, Member
from .store import session

router = APIRouter(prefix="/api/enquiry", tags=["enquiry"])

#: One message. Long enough for somebody to explain what they want, short
#: enough that this table is not a place to store a novel.
#:
#: REFUSED AT THE DOOR RATHER THAN TRUNCATED. A silent truncation loses
#: the end of a question, and nobody finds out until the club answers
#: half of it.
MAX_CHARS = 2000

#: Messages in one thread. The flow needs two; the input stays open
#: afterwards so somebody can add "sorry, forgot to say —", and this is
#: the point past which a thread has stopped being an enquiry.
MAX_MESSAGES = 20

#: What the console shows at once. A club will never reach it; it is here
#: so an unbounded query cannot become the way this page gets slow.
MAX_LISTED = 200


def _clean(raw: str) -> str:
    """The message as typed, minus the ways it is not a message."""
    body = (raw or "").strip()
    if not body:
        raise HTTPException(status_code=400,
                            detail="Bitte schreiben Sie uns kurz, worum es geht.")
    if len(body) > MAX_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Die Nachricht ist zu lang ({len(body)} Zeichen, "
                   f"höchstens {MAX_CHARS}). Bitte kürzen Sie sie etwas.")
    return body


def _find(db: DbSession, raw: str) -> Enquiry:
    """One enquiry by id, or a clean 404.

    THE ID IS PARSED RATHER THAN PASSED THROUGH. `db.get` with a string
    where the primary key is a uuid raises a database error on anything
    malformed, which surfaces as a 500 — an operator reading the log
    would be looking for a fault in the console when somebody had merely
    sent nonsense.
    """
    try:
        ident = uuid.UUID(raw)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404,
                            detail="Diese Anfrage gibt es nicht.")
    enquiry = db.get(Enquiry, ident)
    if enquiry is None:
        raise HTTPException(status_code=404,
                            detail="Diese Anfrage gibt es nicht.")
    return enquiry


def answering(member: Member | None = Depends(current_member)) -> Member:
    """Refuse anybody who may not deal with enquiries.

    THE CAPABILITY, NOT THE OFFICE. Access is for the Vorstand and their
    Erfüllungsgehilfen — which is neither the set of admins nor any
    elected body — so this asks `can_answer` and nothing else.

    404 AND NOT 403 to a signed-in member without it, exactly as the
    registrations board does: an ordinary member has no business learning
    that an enquiries console exists at all.
    """
    if member is None:
        raise HTTPException(status_code=401, detail="Nicht angemeldet.")
    if not member.can_answer:
        raise HTTPException(status_code=404, detail="Nicht gefunden.")
    return member


@router.post("")
def send(payload: dict = Body(default={}),
         db: DbSession = Depends(session),
         _key: str = Depends(throttle)) -> dict:
    """Leave a message, or add to one already left. NO ACCOUNT REQUIRED.

    Answers `{token, count}`. The token is what the browser presents to
    add to the same thread — the second message is usually the contact
    details, and without it the club is left holding a telephone number
    attached to nothing.

    `count` is how many messages the thread now holds, and the page picks
    its canned reply from it. Returning it rather than letting the page
    count for itself means a reload mid-flow cannot desynchronise the
    script from the record.
    """
    body = _clean(payload.get("message", ""))
    presented = (payload.get("token", "") or "").strip()

    enquiry: Enquiry | None = None
    if presented:
        enquiry = db.scalar(select(Enquiry).where(Enquiry.token == presented))
        # AN UNKNOWN TOKEN STARTS A NEW THREAD rather than being an
        # error. Both alternatives are worse: refusing throws away the
        # message somebody has just typed, and answering "no such
        # thread" tells a stranger which tokens exist.
        if enquiry is not None:
            held = db.scalar(
                select(func.count()).select_from(EnquiryMessage)
                .where(EnquiryMessage.enquiry_id == enquiry.id)) or 0
            if held >= MAX_MESSAGES:
                raise HTTPException(
                    status_code=429,
                    detail="Für diese Unterhaltung haben wir genug "
                           "Nachrichten. Wir melden uns bei Ihnen.")

    if enquiry is None:
        enquiry = Enquiry(token=secrets.token_urlsafe(32))
        db.add(enquiry)
        db.flush()

    db.add(EnquiryMessage(enquiry_id=enquiry.id, body=body))
    db.commit()

    count = db.scalar(
        select(func.count()).select_from(EnquiryMessage)
        .where(EnquiryMessage.enquiry_id == enquiry.id)) or 0

    return {"token": enquiry.token, "count": int(count)}


@router.get("/list")
def listing(_: Member = Depends(answering),
            db: DbSession = Depends(session)) -> dict:
    """Every enquiry, unhandled first, newest first within that.

    THE WHOLE LIST, not only the open ones — the same judgement the
    registrations board makes. A console that hides what it has already
    done gives nobody a way to notice a mistake.
    """
    rows = db.scalars(
        select(Enquiry).order_by(Enquiry.created_at.desc()).limit(MAX_LISTED)
    ).all()

    # One query for the names rather than one per row. A club list is
    # short and will still be short in ten years, but asking per row is
    # the habit that makes a page slow somewhere it matters.
    who = {str(member_id): email
           for member_id, email in db.execute(
               select(Member.id, Member.email)).all()}

    # Open ones first. Python's sort is stable, so the newest-first order
    # the query already established survives inside each group.
    ordered = sorted(rows, key=lambda e: e.handled_at is not None)

    return {
        "enquiries": [
            {
                "id": str(e.id),
                "created": e.created_at.isoformat(timespec="seconds"),
                "handled": (e.handled_at.isoformat(timespec="seconds")
                            if e.handled_at else None),
                "handled_by": (who.get(str(e.handled_by_id), "")
                               if e.handled_by_id else ""),
                "messages": [
                    {"body": m.body,
                     "at": m.created_at.isoformat(timespec="seconds")}
                    for m in e.messages
                ],
            }
            for e in ordered
        ],
        "open": sum(1 for e in rows if e.handled_at is None),
    }


@router.post("/handle")
def handle(payload: dict = Body(default={}),
           member: Member = Depends(answering),
           db: DbSession = Depends(session)) -> dict:
    """Mark an enquiry dealt with, or put it back.

    THE ANSWER ITSELF HAPPENS OUTSIDE THIS SYSTEM, by mail or telephone,
    because that is what the visitor was promised. All the software has
    to do is stop two people answering the same enquiry and stop any of
    them being quietly forgotten.
    """
    enquiry = _find(db, (payload.get("id", "") or "").strip())

    if bool(payload.get("done", True)):
        enquiry.handled_at = datetime.now(timezone.utc)
        enquiry.handled_by_id = member.id
    else:
        enquiry.handled_at = None
        enquiry.handled_by_id = None
    db.commit()

    return {"id": str(enquiry.id), "handled": enquiry.handled_at is not None}


@router.post("/delete")
def delete(payload: dict = Body(default={}),
           _: Member = Depends(answering),
           db: DbSession = Depends(session)) -> dict:
    """Bin an enquiry and everything in it.

    REQUIRED RATHER THAN CONVENIENT. The Datenschutzerklärung promises
    that what somebody sends stays with us only "bis der Zweck für die
    Datenspeicherung entfällt" — so there has to be a way to make it
    actually go once the enquiry is dealt with. It is also the answer to
    the spam this endpoint will eventually attract.

    The messages go with it: models.py declares
    cascade="all, delete-orphan" on the relationship.
    """
    enquiry = _find(db, (payload.get("id", "") or "").strip())
    ident = str(enquiry.id)
    db.delete(enquiry)
    db.commit()
    return {"id": ident, "deleted": True}

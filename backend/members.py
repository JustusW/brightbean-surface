"""List, approve and block members. Run inside the container.

    docker compose exec web python members.py list
    docker compose exec web python members.py approve somebody@example.org
    docker compose exec web python members.py block  somebody@example.org

WHY THIS EXISTS. Signing up creates an ACCOUNT; the club decides whether
that is a MEMBERSHIP. `Member.is_approved` defaults to false and the
members area says so politely — "Dein Konto ist angelegt, aber noch
nicht freigegeben" — which is correct and was, until this file, a dead
end: nothing anywhere could set that column, so the first person to
sign in was told to wait for a board that had no button to press.

WHY IT IS A COMMAND AND NOT A WEB PAGE. An admin UI on a public site is
a second authentication surface, a permission model and a whole class of
mistakes, for a club that approves perhaps six people a year. This runs
where only somebody who already has the server has any reach at all, and
Vogelwarte gives it a button so it does not need a terminal either.

IT NEVER CREATES ANYBODY. Approving is a change to an account that
already exists because a person signed up; there is no path here that
invents a member, which keeps "who is allowed in" a decision about
somebody who actually asked.
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy import select

from app import mail
from app.models import Identity, Member
from app.models import Session as SessionRow
from app.store import engine


def _rows(session):
    return session.scalars(
        select(Member).order_by(Member.created_at)).all()


def show(session) -> int:
    members = _rows(session)
    if not members:
        print("no members yet")
        return 0
    print(f"{len(members)} member(s), oldest first\n")
    print(f"  {'approved':8s} {'active':6s} {'admin':5s} {'how':16s} "
          f"{'created':10s} email")
    for m in members:
        ways = session.scalars(
            select(Identity.provider).where(Identity.member_id == m.id)).all()
        how = ",".join(sorted(ways)) or ""
        if m.password_hash is not None:
            how = ("password," + how).rstrip(",")
        print(f"  {'yes' if m.is_approved else 'NO':8s} "
              f"{'yes' if m.is_active else 'NO':6s} "
              f"{'YES' if m.is_admin else '-':5s} "
              f"{how or '?':16s} "
              f"{m.created_at.date().isoformat():10s} {m.email}")
    return 0


def sessions(session) -> int:
    """Every signed-in browser, and when it was signed in.

    HERE TO ANSWER ONE QUESTION WITH EVIDENCE: does restarting the site
    log people out? It does not, and this is how to see that rather than
    be told it — a session is a ROW, and a row does not care that the
    container it was created by has been replaced four times since.

    What DOES end a session: it expiring, somebody signing out (the row
    is deleted), or the account being deactivated (current_member
    refuses it on the next request).
    """
    rows = session.scalars(
        select(SessionRow).order_by(SessionRow.created_at)).all()
    if not rows:
        print("no sessions — nobody is signed in")
        return 0
    print(f"{len(rows)} session(s), oldest first\n")
    print(f"  {'created':20s} {'expires':20s} email")
    for s in rows:
        member = session.get(Member, s.member_id)
        print(f"  {s.created_at.isoformat(timespec='seconds'):20s} "
              f"{s.expires_at.isoformat(timespec='seconds'):20s} "
              f"{member.email if member else '(deleted member)'}")
    return 0


#: RFC 2606 reserves .invalid so that a name can never resolve and can
#: never be anybody's. It is the only domain this file will delete, and
#: that is what makes `purge` safe to have at all.
TEST_DOMAIN = "@example.invalid"


def purge(session) -> int:
    """Delete the accounts an end-to-end run left behind.

    THIS IS THE ONLY DELETE IN THIS FILE, and it exists because a test
    that writes to a live database and cannot clean up is a test that
    litters. The board's registrations list had three of them in it
    within twenty minutes — "your tests are leaking" — each one a real
    row that would have sat in front of the club for ever.

    IT CANNOT TOUCH A MEMBER. The only addresses it will delete end in
    @example.invalid, which RFC 2606 reserves precisely so that it can
    never resolve and can never belong to anyone. A real member cannot
    have one, so this cannot reach them however it is called.

    Deleting the Member takes its identities and sessions with it —
    models.py declares cascade="all, delete-orphan" on both — so nothing
    is left pointing at a row that has gone.
    """
    doomed = session.scalars(
        select(Member).where(Member.email.endswith(TEST_DOMAIN))).all()
    if not doomed:
        print(f"no {TEST_DOMAIN} accounts — nothing to purge")
        return 0
    for m in doomed:
        print(f"  deleting {m.email}")
        session.delete(m)
    session.commit()
    print(f"{len(doomed)} test account(s) deleted")
    return 0


def set_flag(session, email: str, *, approved: bool | None = None,
             active: bool | None = None, admin: bool | None = None) -> int:
    # LOWERCASED, because that is how it is stored — see _clean_email in
    # app/auth.py. Looking one up with the capitals somebody typed would
    # report "no such member" about an account sitting right there.
    email = email.strip().lower()
    member = session.scalar(select(Member).where(Member.email == email))
    if member is None:
        print(f"no member with the address {email!r}", file=sys.stderr)
        print("run `members.py list` to see what is there", file=sys.stderr)
        return 1
    if approved is not None:
        member.is_approved = approved
    if active is not None:
        member.is_active = active
    if admin is not None:
        member.is_admin = admin
        # An admin who cannot get in is not an admin. Granting the board
        # flag to somebody still waiting for approval would be a button
        # they can see and not reach.
        if admin:
            member.is_approved = True
    session.commit()
    print(f"{email}: approved={member.is_approved} "
          f"active={member.is_active} admin={member.is_admin}")
    # NO SESSIONS ARE TOUCHED ON APPROVAL, deliberately: /api/auth/me
    # reads is_approved live, so somebody already signed in sees the
    # members area on their next page load rather than being logged out
    # and made to sign in again to receive good news.
    #
    # Blocking is different and is handled by current_member(), which
    # refuses an inactive member's session on the very next request.
    return 0


def testmail(to: str) -> int:
    """Send ONE message, and say plainly whether the relay took it.

    THE SMOKE TEST, and it exists before anything depends on it. The
    next two features — verifying an address at signup, and resetting a
    forgotten password — are both a token in a database plus a link in
    an email, and if the email half does not work then both of them
    fail in the one way that is hardest to see: silently, at the moment
    a member is waiting for a message that will never come.

    So the pipe gets proven on its own first, with nothing else in the
    way. It reports the configuration it is about to use — never the
    password — because "it did not send" and "it was never configured"
    are different faults with the same symptom.
    """
    print(f"  host      {mail.SMTP_HOST or '(not set)'}:{mail.SMTP_PORT}")
    print(f"  user      {mail.SMTP_USER or '(not set)'}")
    print(f"  from      {mail.MAIL_FROM or '(not set)'}")
    # The presence of the secret, never the secret. An operator needs to
    # know whether it arrived; nobody needs it printed into a job log.
    print(f"  password  {'set' if mail.SMTP_PASSWORD else 'NOT SET'}")
    print(f"  to        {to}\n")

    if not mail.configured():
        print("mail is not configured — nothing was sent.", file=sys.stderr)
        print("The install action writes SURFACE_SMTP_* into .env, read "
              "out of the machine's own /etc/msmtprc.", file=sys.stderr)
        return 1

    ok = mail.send(
        to,
        "Testnachricht vom Mitgliederbereich",
        "Diese Nachricht bestätigt, dass der Mitgliederbereich der "
        "Vereinswebsite E-Mails versenden kann.\n\n"
        "Sie wurde von Hand ausgelöst und erfordert keine Reaktion.\n",
    )
    print("the relay accepted it" if ok else "the relay did NOT accept it")
    # AN EXIT CODE, so the Vogelwarte action that runs this fails loudly
    # rather than printing a cheerful line and returning success — which
    # is the exact shape of four separate faults in this project already.
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="what", required=True)
    sub.add_parser("list")
    sub.add_parser("sessions")
    sub.add_parser("purge")
    for name in ("approve", "revoke", "block", "unblock",
                 "admin", "unadmin"):
        one = sub.add_parser(name)
        one.add_argument("email")
    # ITS OWN PARSER, because the address is a RECIPIENT and not a
    # member: every verb above looks an account up by it, and this one
    # deliberately does not require the address to belong to anybody.
    sub.add_parser("testmail").add_argument("to")
    args = parser.parse_args()

    # ANSWERED BEFORE THE DATABASE IS EVER OPENED, deliberately. This
    # verb tests the mail relay; making it need a working database too
    # would mean a mail fault and a database fault produce the same
    # error, which is how an evening gets spent debugging the wrong
    # half.
    if args.what == "testmail":
        return testmail(args.to)

    from sqlalchemy.orm import Session
    with Session(engine()) as session:
        if args.what == "list":
            return show(session)
        if args.what == "sessions":
            return sessions(session)
        if args.what == "purge":
            return purge(session)
        if args.what == "approve":
            return set_flag(session, args.email, approved=True)
        if args.what == "revoke":
            return set_flag(session, args.email, approved=False)
        if args.what == "block":
            return set_flag(session, args.email, active=False)
        if args.what == "unblock":
            return set_flag(session, args.email, active=True)
        if args.what == "admin":
            return set_flag(session, args.email, admin=True)
        if args.what == "unadmin":
            return set_flag(session, args.email, admin=False)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

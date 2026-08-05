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

from app.models import Identity, Member
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
    print(f"  {'approved':8s} {'active':6s} {'how':16s} {'created':10s} email")
    for m in members:
        ways = session.scalars(
            select(Identity.provider).where(Identity.member_id == m.id)).all()
        how = ",".join(sorted(ways)) or ""
        if m.password_hash is not None:
            how = ("password," + how).rstrip(",")
        print(f"  {'yes' if m.is_approved else 'NO':8s} "
              f"{'yes' if m.is_active else 'NO':6s} "
              f"{how or '?':16s} "
              f"{m.created_at.date().isoformat():10s} {m.email}")
    return 0


def set_flag(session, email: str, *, approved: bool | None = None,
             active: bool | None = None) -> int:
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
    session.commit()
    print(f"{email}: approved={member.is_approved} active={member.is_active}")
    # NO SESSIONS ARE TOUCHED ON APPROVAL, deliberately: /api/auth/me
    # reads is_approved live, so somebody already signed in sees the
    # members area on their next page load rather than being logged out
    # and made to sign in again to receive good news.
    #
    # Blocking is different and is handled by current_member(), which
    # refuses an inactive member's session on the very next request.
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="what", required=True)
    sub.add_parser("list")
    for name in ("approve", "revoke", "block", "unblock"):
        one = sub.add_parser(name)
        one.add_argument("email")
    args = parser.parse_args()

    from sqlalchemy.orm import Session
    with Session(engine()) as session:
        if args.what == "list":
            return show(session)
        if args.what == "approve":
            return set_flag(session, args.email, approved=True)
        if args.what == "revoke":
            return set_flag(session, args.email, approved=False)
        if args.what == "block":
            return set_flag(session, args.email, active=False)
        if args.what == "unblock":
            return set_flag(session, args.email, active=True)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

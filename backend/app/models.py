"""The surface's OWN schema — members and how they sign in.

DECLARED ONCE, HERE. Alembic derives the migrations from these models
with --autogenerate, so the DDL is never typed a second time and cannot
disagree with the code that uses it.

NOTHING IS STORED THAT IS NOT TECHNICALLY REQUIRED. The shepherd's rule,
and it is stricter than "we have a lawful basis" — the question each
column has to answer is not *may* we keep this, but does the thing stop
working without it.

The first version of this file failed that test three times, and the
comments are the evidence: it stored a truncated user agent on every
session while the comment beside it said "we have no use for it", it
copied the provider's email onto the Identity row "for display only"
when Member.email already held it, and it kept last_login_at, which is
behaviour rather than identity. Each was defensible and none was
required. They are gone.

What is left, and why each one has to be:

    email          the identifier somebody signs in with
    password_hash  only for accounts that use a password; NULL otherwise
    is_active      whether the account may be used at all
    is_approved    whether the club has let them in
    email_verified whether the address has been proven
    created_at     which account is older, when two collide; and the
                   basis for deleting dormant ones
    provider/subject  which federated account this is
    session id/member/expires  the session, and when it stops

NOTHING BRIGHTBEAN OWNS IS MAPPED HERE. Its tables are read with raw SQL
in app/db.py, over a connection PostgreSQL itself holds read-only. That
is not squeamishness: an ORM model of somebody else's table is a second
declaration of it, and the two drift apart silently the first time they
migrate something. This file is only the things we own and may change.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """The declarative base Alembic's autogenerate compares against.

    Anything not reachable from this metadata is invisible to
    --autogenerate, which is why every model in this file inherits from
    it and why there is exactly one Base.
    """


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(PgUUID(as_uuid=True), primary_key=True,
                         default=uuid.uuid4)


class Member(Base):
    """Somebody with an account on the club's website.

    A member may have arrived by SIGNING UP with an email and password,
    by SIGNING IN WITH GOOGLE, or both — the two are not alternatives and
    the same person must not end up with two accounts because they used a
    different button on a different day. That is what `email` being
    unique and `Identity` being a separate table is for.
    """

    __tablename__ = "member"

    id: Mapped[uuid.UUID] = _uuid_pk()

    # LOWERCASED BEFORE IT GETS HERE, and unique. Two accounts for
    # Justus@example.org and justus@example.org is the classic way a
    # "sign in with Google" button silently creates a duplicate of an
    # account somebody already had - the addresses are the same mailbox,
    # and the database has to agree.
    email: Mapped[str] = mapped_column(String(320), unique=True,
                                       nullable=False, index=True)

    # NO display_name. It is pleasant to greet somebody by name and it is
    # not required for anything to work - the members area can address
    # people by the address they signed in with. Google offers one; that
    # is a reason it is AVAILABLE, not a reason to keep it. If a purpose
    # appears later it is one column and one generated migration.

    # NULLABLE ON PURPOSE. A member who only ever signs in with Google has
    # no password, and storing a placeholder hash would be a credential
    # that exists and can be attacked for an account that never had one.
    # NULL means "this account has no password", which is a different and
    # honest thing from "the password is empty".
    password_hash: Mapped[str | None] = mapped_column(String(255),
                                                      nullable=True)

    # An account exists before it is allowed in. Signup does not itself
    # grant membership of the club.
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False,
                                            default=True)
    is_approved: Mapped[bool] = mapped_column(Boolean, nullable=False,
                                              default=False)

    # WHO MAY LET SOMEBODY ELSE IN. The board, in practice.
    #
    # A FLAG AND NOT A ROLE TABLE. There is exactly one privilege here —
    # seeing who has registered and approving them — and a roles-and-
    # permissions model for a single boolean is machinery that has to be
    # understood by whoever inherits this in order to express nothing
    # extra. If a second privilege ever appears, THAT is when the shape
    # should change, and a generated migration will make it cheap.
    #
    # DEFAULTS FALSE, and there is no way to grant it from the website.
    # The first admin is made with members.py on the server, which means
    # the bootstrap requires reaching the machine rather than being the
    # first person to find the signup form.
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False,
                                           default=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False,
                                                 default=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now())

    # NO last_login_at. It is behaviour, not identity: knowing WHEN a
    # member last signed in is a record of what they did, and nothing
    # here needs it. Dormant-account cleanup can work from created_at
    # and the absence of sessions.

    identities: Mapped[list["Identity"]] = relationship(
        back_populates="member", cascade="all, delete-orphan")
    sessions: Mapped[list["Session"]] = relationship(
        back_populates="member", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<Member {self.email}>"


class Identity(Base):
    """A federated sign-in attached to a member.

    Separate from Member so one person can hold several — Google today,
    something else later — without the member row growing a column per
    provider, and so that connecting a second provider to an existing
    account is an INSERT rather than a schema change.
    """

    __tablename__ = "identity"
    __table_args__ = (
        # THE SAME GOOGLE ACCOUNT MUST NOT ATTACH TO TWO MEMBERS. Without
        # this, a race between two signups - or a bug in the callback -
        # silently splits one person across two accounts, and which one
        # they land in becomes a matter of timing.
        UniqueConstraint("provider", "subject", name="uq_identity_provider_subject"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    member_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("member.id", ondelete="CASCADE"),
        nullable=False, index=True)

    provider: Mapped[str] = mapped_column(String(32), nullable=False)

    # GOOGLE'S `sub` CLAIM, NOT THE EMAIL ADDRESS. Google documents `sub`
    # as the stable identifier for an account; an email can be changed by
    # its owner, and keying on it means a member who renames their Google
    # address becomes a stranger to us.
    subject: Mapped[str] = mapped_column(String(255), nullable=False)

    # NO email here. The first version kept what the provider last told
    # us "for display only" — a second copy of an address Member.email
    # already holds, on a row that exists to answer one question: which
    # Google account is this. A duplicate of somebody's personal data,
    # stored for a purpose that was already served.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now())

    member: Mapped[Member] = relationship(back_populates="identities")

    def __repr__(self) -> str:
        return f"<Identity {self.provider}:{self.subject}>"


class Session(Base):
    """A signed-in browser.

    SERVER-SIDE, DELIBERATELY. The cookie carries this row's id and
    nothing else, so signing somebody out is a DELETE that takes effect
    immediately. A self-contained token cannot be revoked before it
    expires — which is exactly the property you want on the day an
    account turns out to be compromised.
    """

    __tablename__ = "session"

    # NOT a UUID default: this value IS the credential in the cookie, so
    # it is generated with secrets.token_urlsafe at creation rather than
    # by a scheme whose output is guessable from another one.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)

    member_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("member.id", ondelete="CASCADE"),
        nullable=False, index=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now())
    # Read on every authenticated request, so it is indexed: expiring
    # sessions are swept by a query on this column.
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True)

    # NO user_agent. The first version stored a truncated one "for the
    # member's own 'where am I signed in' list later", and the comment
    # beside it said in as many words that it is fingerprint material
    # and we have no use for it. Writing both of those and keeping the
    # column anyway is the whole failure mode this rule exists to stop:
    # a field justified by a feature nobody has asked for.

    member: Mapped[Member] = relationship(back_populates="sessions")

    def __repr__(self) -> str:
        return f"<Session {self.id[:8]}… member={self.member_id}>"

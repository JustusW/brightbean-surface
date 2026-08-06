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
    Text,
    UniqueConstraint,
    func,
    text,
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
    # server_default, AND NOT ONLY default=False. THIS IS WHY:
    #
    # `default=` is applied by SQLAlchemy when IT inserts a row. It emits
    # no DDL, so `alembic revision --autogenerate` produced
    #
    #     op.add_column('member',
    #                   sa.Column('is_admin', sa.Boolean(), nullable=False))
    #
    # and PostgreSQL refused: "column is_admin of relation member
    # contains null values". Adding a NOT NULL column to a table that
    # already has rows needs a value for those rows, and only a
    # server_default puts one in the ALTER.
    #
    # The three booleans above have the same shape and never hit it,
    # because they were created WITH the table, when it was empty. That
    # is luck rather than design, and the first person to add a column
    # to a live table pays for it — which was me, on the members page,
    # while the shepherd was looking at it.
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False,
                                           server_default=text("false"),
                                           default=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False,
                                                 default=False)

    # MAY READ AND ANSWER ENQUIRIES from the public contact bubble.
    #
    # A CAPABILITY, NOT AN OFFICE, and the distinction is the shepherd's:
    # "I'm an Admin, not part of the Vorstand." Access is for the Vorstand
    # AND their Erfüllungsgehilfen — people acting on the board's behalf who
    # hold no office at all — so a column called `is_vorstand` would become
    # a lie the first time a Gehilfe answers a message. It says what the
    # holder may DO, which is the only thing this code needs to know.
    #
    # Separate from `is_admin` for the same reason: administering accounts
    # and answering the public are different jobs, and one person having
    # both is a fact about that person rather than about the model.
    #
    # server_default, like is_admin above and for the identical reason —
    # `member` has rows, and PostgreSQL refuses a NOT NULL column added to
    # a populated table with no value for the rows already there.
    can_answer: Mapped[bool] = mapped_column(Boolean, nullable=False,
                                             server_default=text("false"),
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
    tokens: Mapped[list["Token"]] = relationship(
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


class Token(Base):
    """A one-time link sent to somebody's mailbox.

    TWO PURPOSES, ONE TABLE, and that is a judgement rather than
    laziness: proving an address and resetting a password are the same
    mechanism — put a secret in a mailbox, and let whoever can read that
    mailbox present it back. Two tables would be the same five columns
    twice, and the second copy is where they drift.

    STORED AS A HASH, WHICH IS THE ONE PLACE THIS DIFFERS FROM Session.
    A session id is stored raw, because it is compared against a cookie
    on every request and the database holding it is the same database
    that would be lost anyway. These are different in a way that
    matters: a token TRAVELS THROUGH EMAIL, so it comes to rest in
    mailboxes and mail logs, and a reset token is a full account
    takeover — it can set a password on an account that never had one.
    Keeping only sha256 of it means a copy of this table is not a set of
    working links.

    Which also means the secret exists exactly once, in the message. We
    cannot re-send a lost one, only issue another. That is correct.

    NO `used_at`. A spent token is DELETED, so it refers to nothing —
    the same reason signing out deletes the session row rather than
    flagging it. A flag is a thing that can be read wrongly; a missing
    row cannot be.
    """

    __tablename__ = "token"

    #: sha256, hex, of the secret that travelled in the link. 64
    #: characters exactly, and never the secret itself.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)

    member_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("member.id", ondelete="CASCADE"),
        nullable=False, index=True)

    #: "verify" or "reset". A short string rather than an enum type,
    #: because adding a third purpose should not need a migration that
    #: alters a type in PostgreSQL — and the set of valid values is
    #: enforced where they are issued, in one function.
    purpose: Mapped[str] = mapped_column(String(16), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now())
    #: Indexed because expired tokens are swept by a query on it — and
    #: checked on use as well, since a sweep is housekeeping and this is
    #: the rule.
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True)

    member: Mapped[Member] = relationship(back_populates="tokens")

    def __repr__(self) -> str:
        # The stored value is already a hash, so this leaks nothing that
        # could be presented back — but it is still half a credential's
        # fingerprint, so only the front of it appears.
        return f"<Token {self.purpose} {self.id[:8]}…>"


class Enquiry(Base):
    """Somebody who is NOT a member, asking the club something.

    THE CONTACT BUBBLE, bottom right of every page. A visitor types a
    message, it is stored, and a member holding `can_answer` reads it and
    gets back to them. There is no live chat behind it and the page never
    claims there is — the canned reply says somebody will be in touch,
    which is a promise a volunteer club can actually keep. A blinking
    cursor nobody is watching is worse than no bubble at all.

    IN DATA-PROTECTION TERMS THIS IS THE KONTAKTFORMULAR THE
    DATENSCHUTZERKLÄRUNG ALREADY DESCRIBES: the same data, the same
    purpose ("zwecks Bearbeitung der Anfrage"), the same legal basis and
    the same retention rule, with a faster transport. That equivalence is
    what lets it exist under the club's current notice, and it is only
    true while two things hold — nothing here reaches a third party, and
    nothing is collected that the form would not have collected.

    WHICH IS WHY THIS TABLE HAS NO NAME COLUMN, NO ADDRESS COLUMN AND NO
    IDENTIFIER OF THE VISITOR. Whatever contact details somebody chooses
    to give arrive as a MESSAGE, in their own words, and are stored as
    exactly that. Parsing an address out into a column of its own would
    be a second copy of the same personal data, kept for a purpose the
    first copy already serves.

    NO NOTIFICATIONS, on instruction: "these land in our database, a
    member with the appropriate role can see it and answer. period."
    """

    __tablename__ = "enquiry"

    id: Mapped[uuid.UUID] = _uuid_pk()

    #: WHAT THE VISITOR'S BROWSER PRESENTS IN ORDER TO ADD TO THIS THREAD.
    #:
    #: The second message is the contact details, and it has to land on
    #: the same enquiry or the club is left holding a telephone number
    #: attached to nothing. The visitor has no account and no session, so
    #: the thread carries its own credential.
    #:
    #: Minted with secrets.token_urlsafe, like Session.id and NOT by a
    #: uuid default: this value is what authorises an append, so it comes
    #: from the one scheme here whose output cannot be derived from
    #: anything else.
    #:
    #: Stored raw rather than hashed, and the difference from Token is
    #: deliberate — a Token travels through EMAIL and comes to rest in
    #: mailboxes and mail logs, whereas this never leaves the browser
    #: that created it.
    token: Mapped[str] = mapped_column(String(64), unique=True,
                                       nullable=False, index=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now())

    #: WHEN SOMEBODY DEALT WITH IT, AND WHO. Null means nobody has yet.
    #:
    #: This is the whole of "and answer". The answer itself happens
    #: OUTSIDE this system, by mail or telephone, because that is what
    #: the visitor was promised — "wird sich dann bald bei Ihnen melden".
    #: What the club needs from the software is only that two people do
    #: not answer the same enquiry and that none is quietly forgotten.
    handled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    handled_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("member.id", ondelete="SET NULL"),
        nullable=True)

    #: SET NULL rather than CASCADE, and the choice matters: a member
    #: leaving the club must not delete the record of the enquiries they
    #: once dealt with. The enquiry is the club's, not theirs.
    handled_by: Mapped["Member | None"] = relationship()

    messages: Mapped[list["EnquiryMessage"]] = relationship(
        back_populates="enquiry", cascade="all, delete-orphan",
        order_by="EnquiryMessage.created_at")

    def __repr__(self) -> str:
        return f"<Enquiry {self.id} handled={self.handled_at is not None}>"


class EnquiryMessage(Base):
    """One thing a visitor typed, stored as they typed it.

    ONLY THE VISITOR'S WORDS. The two canned replies are constants in the
    frontend, not rows — writing our own fixed strings into the database
    would be keeping a copy of something we already know, once per
    enquiry, and it would make the stored record look like a
    conversation that never happened.

    NO `from_staff` COLUMN. Nothing in this version writes a reply back
    into the thread, and a column for a feature nobody has asked for is
    precisely what this module's docstring lists three past examples of.
    """

    __tablename__ = "enquiry_message"

    id: Mapped[uuid.UUID] = _uuid_pk()
    enquiry_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("enquiry.id", ondelete="CASCADE"),
        nullable=False, index=True)

    #: Text rather than a bounded String. The length limit belongs at the
    #: door, where it can refuse politely and say so; a column that
    #: truncates somebody's question silently is worse than one that
    #: does not bound it at all.
    body: Mapped[str] = mapped_column(Text, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now())

    enquiry: Mapped[Enquiry] = relationship(back_populates="messages")

    def __repr__(self) -> str:
        return f"<EnquiryMessage {self.id} {len(self.body)} chars>"

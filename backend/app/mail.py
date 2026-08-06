"""Sending mail, through the relay this machine already uses.

IT SENDS AS THE CLUB, NOT AS THE MACHINE, and that distinction is the
whole of this paragraph. The server has relayed its OWN mail for months
— cron, mdadm and unattended-upgrades all reach a human through msmtp —
and the first version of this borrowed that identity, on the argument
that credentials already proven to send were the ones to use. The
argument was right about the RELAY and wrong about the IDENTITY: the
machine's mailbox is spatzengamingserver@kw-it.info, so a member asked
to confirm their address was written to by a machine account at a
domain they have never heard of. That is indistinguishable from spam,
and it is not the club writing to them.

So the club has its own mailbox and everything member-facing sends as
that. The machine's operations mail is deliberately unchanged and still
reaches whoever runs the box: one of those failing must not silence the
other, and neither should ever be mistaken for the other.

WHAT THIS FILE DOES NOT DO IS SHELL OUT TO msmtp. It cannot: the
surface runs in its own rootless container, as its own unprivileged
user, and /usr/bin/msmtp and every credential file are on the HOST. A
container that could read a host 0600 file would be a container that
has defeated the isolation it was given.

So it speaks SMTP to the same relay, and the credentials arrive the way
every other server-side secret already does — read out of the machine
at install time and written into the surface's .env, exactly as both
PostgreSQL passwords are.

    SURFACE_SMTP_HOST      mail.your-server.de  (params: club_mail_host)
    SURFACE_SMTP_PORT      587                  (params: club_mail_port)
    SURFACE_SMTP_USER      the club's mailbox   (params: club_mail_user)
    SURFACE_MAIL_FROM      the same address     (params: club_mail_from)
    SURFACE_SMTP_PASSWORD  read ON THE SERVER out of the root-only file
                           that club_mail_password_file names

WHY THE SURFACE NEEDS TO SEND AT ALL. Two things, and they are
different failures rather than one feature:

  VERIFYING AN ADDRESS ON SIGNUP. Without it, anybody can register an
  address they do not own. Today the only thing standing between that
  and a member's mailbox is the board approving every account by hand.

  A PASSWORD RESET. There is none. A member who forgets is simply
  stuck — members.py cannot set a password either, so the answer today
  is "ask somebody with the server to delete your account and start
  again", which is not an answer.

A MAIL FAILURE MUST NEVER TAKE A REQUEST DOWN WITH IT. Signing up
creates the account; the message is a courtesy on top. If the relay is
slow, unreachable, or refuses us, the person is still registered and
the board can still approve them — so every send here is bounded by a
timeout and reports its outcome rather than raising into a handler.
"""

from __future__ import annotations

import logging
import os
import smtplib
import ssl
from email.message import EmailMessage

log = logging.getLogger("surface.mail")

SMTP_HOST = os.environ.get("SURFACE_SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SURFACE_SMTP_PORT", "587") or "587")
SMTP_USER = os.environ.get("SURFACE_SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SURFACE_SMTP_PASSWORD", "")

#: WHAT THE CLUB SENDS AS. Falls back to the authenticating mailbox,
#: because a From: that the relay has not authorised is the fastest way
#: to have everything silently rejected or filed as spam — providers
#: check that the envelope sender matches the account that logged in.
MAIL_FROM = os.environ.get("SURFACE_MAIL_FROM", "") or SMTP_USER

#: Seconds. A web request is waiting behind this, and a relay that has
#: stopped answering must fail rather than hold a worker open. msmtp on
#: the host reaches this provider in well under a second.
TIMEOUT = 10.0


def configured() -> bool:
    """Is there anywhere to send, and something to send as?

    Checked rather than assumed, and checked by the CALLERS too: a
    development machine has none of these, and a signup there must
    still work — it simply does not send.
    """
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD and MAIL_FROM)


def send(to: str, subject: str, body: str) -> bool:
    """Send one plain-text message. True if the relay accepted it.

    NEVER RAISES. Every caller is a request handler doing something
    more important than this — creating an account, starting a reset —
    and none of them should turn a mail outage into a 500 for somebody
    who did nothing wrong. The outcome is the return value, and the
    reason goes to the process log where an operator can find it.

    PLAIN TEXT, NOT HTML. The two messages this sends are a link and a
    sentence explaining it. HTML would add a second body to keep in
    step, a reason for a client to render it as a suspicious rich
    message, and nothing a member wants.
    """
    if not configured():
        # NOT AN ERROR, AND SAID CLEARLY. This is the state on a
        # development machine and on any deployment before the install
        # action has wired the relay in. Silence here would look like a
        # message that was sent and lost.
        log.warning("mail is not configured; not sending %r to %s",
                    subject, to)
        return False

    message = EmailMessage()
    message["From"] = MAIL_FROM
    message["To"] = to
    message["Subject"] = subject
    # UTF-8 explicitly: every one of these messages is in German, and a
    # 7-bit default turns "Bestätigung" into mojibake in the subject
    # line, which is the first thing the member sees.
    message.set_content(body, charset="utf-8")

    try:
        # PORT DECIDES THE SHAPE OF THE CONNECTION. 465 is implicit TLS
        # from the first byte; 587 is submission, which opens in clear
        # and is upgraded with STARTTLS. Getting this backwards does not
        # fail politely — it either hangs or sends credentials in clear,
        # which is exactly what msmtprc.rules forbids on the host.
        if SMTP_PORT == 465:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=TIMEOUT,
                                  context=ssl.create_default_context()) as s:
                s.login(SMTP_USER, SMTP_PASSWORD)
                s.send_message(message)
        else:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=TIMEOUT) as s:
                s.ehlo()
                # DEFAULT CONTEXT, so certificates and hostnames are
                # actually verified. ssl._create_unverified_context is
                # the usual copy-paste "fix" for a TLS error and it
                # turns an encrypted channel into a decorated one.
                s.starttls(context=ssl.create_default_context())
                # A second EHLO after STARTTLS is required, not
                # ceremony: the server's advertised capabilities —
                # including which AUTH mechanisms it will accept — are
                # only trustworthy once the channel is encrypted.
                s.ehlo()
                s.login(SMTP_USER, SMTP_PASSWORD)
                s.send_message(message)
    except Exception as exc:  # noqa: BLE001 — the caller must not care
        # THE PASSWORD IS NEVER IN HERE. smtplib's exceptions carry the
        # server's reply, not our credentials, and nothing below
        # formats SMTP_PASSWORD into a string.
        log.error("could not send %r to %s: %s: %s",
                  subject, to, type(exc).__name__, exc)
        return False

    log.info("sent %r to %s", subject, to)
    return True

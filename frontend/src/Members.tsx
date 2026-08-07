import { useEffect, useState } from "react";
import type { FormEvent } from "react";
/* THE ROLE CONTROLS ARE ICONS. Spelled out in German they ran past
   400px on a single row and pushed the member's own address into a
   wrap — see .regs button.icon in index.css. Each keeps its full
   sentence in title and aria-label, so nothing is lost to anybody
   reading with a screen reader or hovering with a pointer.
   
   THE PAIRS ARE DIFFERENT GLYPHS, not one glyph in two colours. The
   shepherd is red-blind; a control whose state is carried by hue alone
   is a control they cannot read. Held and not-held differ in SHAPE.

   AND THE GLYPH SHOWS THE STATE, NOT THE ACTION. That was wrong here
   once and it inverted the whole page: the icons were picked for what
   pressing would DO, so an approved member was drawn with a bold UserX
   and somebody holding the Social Media role got a struck-through
   megaphone. Read down the list it said nobody was cleared for
   anything. What pressing does is in the tooltip and the accessible
   name — where an action belongs — and the glyph answers "do they have
   it": plain for yes, struck through for no. */
import {
  ExternalLink,
  LogOut,
  Megaphone,
  MegaphoneOff,
  MessageSquare,
  MessageSquareOff,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react";
import { ApiError, api } from "./api";
import type { Enquiry, MemberAccount, Registration } from "./api";

/** The board's view: who has signed up, and letting them in.
 *
 *  ONLY RENDERED FOR AN ADMIN, and that is a convenience rather than a
 *  control — both endpoints check the column server-side and answer 404
 *  to anybody else, because a flag the browser holds is a flag the
 *  browser can edit.
 *
 *  IT SHOWS EVERYBODY, not only those still waiting. An approval screen
 *  that hides what it has already done gives no way to notice a
 *  mistake, and "who is in this club" is the question actually being
 *  asked. Those waiting are simply listed first.
 */
function Board({
  me,
  onChanged,
}: {
  me: MemberAccount;
  /** Tell the page to re-read WHO IT IS. Granting yourself the
   *  enquiries role changes what this very screen should render, and
   *  the account object it is holding was fetched before that. Without
   *  this the console appears only after a reload, which looks like the
   *  button not having worked. */
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<Registration[] | null>(null);
  const [failed, setFailed] = useState("");
  const [busy, setBusy] = useState("");
  /** Which row has asked "really?". Deleting cannot be undone, so it
   *  takes two deliberate clicks — and the second one is labelled with
   *  what it will do rather than "OK", so a stray return key on a
   *  browser dialog cannot do it either. */
  const [confirming, setConfirming] = useState("");

  const load = () =>
    api
      .registrations()
      .then((r) => setRows(r.members))
      .catch((e) =>
        setFailed(
          e instanceof ApiError
            ? e.message
            : "Die Liste lässt sich gerade nicht laden.",
        ),
      );

  useEffect(() => {
    load();
  }, []);

  const decide = async (
    email: string,
    what:
      | "approve"
      | "revoke"
      | "delete"
      | "answer"
      | "unanswer"
      | "social"
      | "unsocial",
  ) => {
    setBusy(email);
    setFailed("");
    try {
      await api.decide(email, what);
      setConfirming("");
      await load();
      // The row list is not the only thing that may have changed: if
      // that was your own account, what this page should be showing has
      // changed too.
      onChanged();
    } catch (e) {
      setFailed(
        e instanceof ApiError ? e.message : "Das hat nicht geklappt.",
      );
    } finally {
      setBusy("");
    }
  };

  if (failed && rows === null) {
    return (
      <div className="board">
        <h2>Registrierungen</h2>
        <p className="membererror" role="alert">
          {failed}
        </p>
      </div>
    );
  }
  if (rows === null) {
    return (
      <div className="board">
        <h2>Registrierungen</h2>
        <p className="empty">Lädt…</p>
      </div>
    );
  }

  // Waiting first — that is the list somebody opened this page to act
  // on. Within each group, newest first, as the backend sent them.
  const sorted = [...rows].sort(
    (a, b) => Number(a.approved) - Number(b.approved),
  );
  const waiting = rows.filter((r) => !r.approved).length;

  return (
    <div className="board">
      <h2>
        Registrierungen
        {waiting > 0 && <span className="wartet">{waiting} wartet</span>}
      </h2>

      {failed && (
        <p className="membererror" role="alert">
          {failed}
        </p>
      )}

      {rows.length === 0 && (
        <p className="empty">Es hat sich noch niemand registriert.</p>
      )}

      <ul className="regs">
        {sorted.map((r) => (
          <li key={r.email} className={r.approved ? "" : "offen"}>
            <div className="who">
              <strong>{r.email}</strong>
              <span className="wie">
                {r.created} · {r.how.join(" + ") || "?"}
                {/* ADMIN, NOT "Vorstand". Being able to approve accounts
                    on this website is a technical permission; the
                    Vorstand is an elected office of the club. Calling
                    the flag by the office's name told every reader that
                    whoever holds it sits on the board, which is not
                    true and is not ours to imply. */}
                {r.admin && " · Admin"}
                {/* A DIFFERENT PERMISSION FROM Admin, and shown
                    separately for that reason: this one is for the
                    Vorstand and their Erfüllungsgehilfen, who need not
                    be admins and, in the second case, hold no office
                    at all. */}
                {r.can_answer && " · Anfragen"}
                {/* THE HEAVIEST OF THE THREE, so it is named on the
                    row: whoever holds it can post as the club on every
                    channel Brightbean is connected to. */}
                {r.can_social && " · Social Media"}
                {!r.active && " · gesperrt"}
                {/* Said only when it is NOT true. A verified address is
                    the ordinary case and does not need announcing; an
                    unverified one is the thing to look at twice before
                    letting somebody in. */}
                {!r.verified && " · E-Mail unbestätigt"}
              </span>
            </div>
            {/* THE ONE CASE WITH NO BUTTON: an admin cannot revoke
                themselves. It is the only privilege that can remove the
                ability to grant privileges, and a club with no usable
                admin has to be repaired from the server — which is
                exactly what this page exists to avoid. The server
                refuses it too; this only avoids offering it. */}
            {r.email === me.email ? (
              <>
                <span className="selbst">Du</span>
                {/* AN ADMIN MUST BE ABLE TO GIVE THEMSELVES THIS ONE.
                    The self row offered nothing at all, so the first
                    admin could not grant the enquiries role to anybody
                    — including themselves — and with one member in the
                    club nobody could ever hold it: "there is no fucking
                    menu I can see for granting shit."

                    Refusing self-revoke of ACCESS is still right: that
                    is the privilege which can remove the ability to
                    grant privileges, and a club with no usable admin
                    has to be repaired from the server. This is a
                    different permission and taking it from yourself
                    strands nobody. */}
                <button
                  className={`icon ${r.can_answer ? "granted" : "ungranted"}`}
                  disabled={busy === r.email}
                  title={
                    r.can_answer ? "Anfragen entziehen" : "Anfragen zuweisen"
                  }
                  aria-label={
                    r.can_answer ? "Anfragen entziehen" : "Anfragen zuweisen"
                  }
                  onClick={() =>
                    decide(r.email, r.can_answer ? "unanswer" : "answer")
                  }
                >
                  {r.can_answer ? (
                    <MessageSquare aria-hidden="true" />
                  ) : (
                    <MessageSquareOff aria-hidden="true" />
                  )}
                </button>
                {/* AND THE SOCIAL MEDIA ROLE, on the same terms and for
                    the same reason the enquiries one is here: with one
                    member in the club, a role nobody can grant to
                    themselves is a role nobody can ever hold. Taking it
                    from yourself strands nobody — unlike admin, which
                    is the privilege that grants privileges. */}
                <button
                  className={`icon ${r.can_social ? "granted" : "ungranted"}`}
                  disabled={busy === r.email}
                  title={
                    r.can_social
                      ? "Social Media entziehen"
                      : "Social Media zuweisen"
                  }
                  aria-label={
                    r.can_social
                      ? "Social Media entziehen"
                      : "Social Media zuweisen"
                  }
                  onClick={() =>
                    decide(r.email, r.can_social ? "unsocial" : "social")
                  }
                >
                  {r.can_social ? (
                    <Megaphone aria-hidden="true" />
                  ) : (
                    <MegaphoneOff aria-hidden="true" />
                  )}
                </button>
              </>
            ) : confirming === r.email ? (
              /* THE SECOND CLICK SAYS WHAT IT DOES. Not "OK" in a
                 browser dialog, which a stray return key answers. */
              <>
                <button
                  className="regdelete"
                  disabled={busy === r.email}
                  onClick={() => decide(r.email, "delete")}
                >
                  Endgültig löschen
                </button>
                <button
                  className="regcancel"
                  onClick={() => setConfirming("")}
                >
                  Abbrechen
                </button>
              </>
            ) : (
              <>
                {r.approved ? (
                  <button
                    className="icon granted"
                    disabled={busy === r.email}
                    title="Zugang entziehen"
                    aria-label={`Zugang für ${r.email} entziehen`}
                    onClick={() => decide(r.email, "revoke")}
                  >
                    <UserCheck aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    className="icon ungranted"
                    disabled={busy === r.email}
                    title="Freischalten"
                    aria-label={`${r.email} freischalten`}
                    onClick={() => decide(r.email, "approve")}
                  >
                    <UserX aria-hidden="true" />
                  </button>
                )}
                {/* WHO MAY DEAL WITH THE PUBLIC. Offered only to
                    somebody already approved: a permission that cannot
                    be reached is a button that reads as broken rather
                    than as a decision half made. Granting it on the
                    server approves them anyway, so this only avoids
                    offering the odd order. */}
                {r.approved && (
                  <button
                    className={`icon ${r.can_answer ? "granted" : "ungranted"}`}
                    disabled={busy === r.email}
                    title={
                      r.can_answer
                        ? "Anfragen entziehen"
                        : "Anfragen zuweisen"
                    }
                    aria-label={
                      r.can_answer
                        ? `Anfragen für ${r.email} entziehen`
                        : `Anfragen für ${r.email} zuweisen`
                    }
                    onClick={() =>
                      decide(r.email, r.can_answer ? "unanswer" : "answer")
                    }
                  >
                    {r.can_answer ? (
                      <MessageSquare aria-hidden="true" />
                    ) : (
                      <MessageSquareOff aria-hidden="true" />
                    )}
                  </button>
                )}
                {/* THE SOCIAL MEDIA ROLE. Offered only to somebody
                    already approved, like the enquiries one — and it
                    matters more here: this is not a menu item but a
                    door. nginx asks the server for this flag before it
                    will forward a single request to Brightbean, so
                    taking it away shuts them out on their very next
                    click rather than at their next login. */}
                {r.approved && (
                  <button
                    className={`icon ${r.can_social ? "granted" : "ungranted"}`}
                    disabled={busy === r.email}
                    title={
                      r.can_social
                        ? "Social Media entziehen"
                        : "Social Media zuweisen"
                    }
                    aria-label={
                      r.can_social
                        ? `Social Media für ${r.email} entziehen`
                        : `Social Media für ${r.email} zuweisen`
                    }
                    onClick={() =>
                      decide(r.email, r.can_social ? "unsocial" : "social")
                    }
                  >
                    {r.can_social ? (
                      <Megaphone aria-hidden="true" />
                    ) : (
                      <MegaphoneOff aria-hidden="true" />
                    )}
                  </button>
                )}
                {/* DELETE IS ALWAYS OFFERED, approved or not — Art. 17
                    DSGVO is a right the person has whether or not the
                    club ever let them in. */}
                <button
                  className="icon regask"
                  disabled={busy === r.email}
                  onClick={() => setConfirming(r.email)}
                  title="Löschen"
                  aria-label={`Konto ${r.email} löschen`}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      <p className="membernote">
        Freischalten macht aus einem Konto eine Mitgliedschaft. Wer
        freigeschaltet ist, sieht den internen Bereich beim nächsten
        Seitenaufruf — niemand wird dafür abgemeldet.
      </p>
    </div>
  );
}

/** WHEN, compactly and unambiguously.
 *
 *  Pinned to de-DE and 24 hours rather than left to the browser's
 *  locale: this is read by the club, and a console that renders
 *  "8/6/2026, 5:14 PM" to somebody whose machine reports en-US is
 *  month-first nonsense with an am/pm on the end. */
const WHEN = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : WHEN.format(d);
}

/** What people have sent through the contact bubble.
 *
 *  ONLY FOR MEMBERS HOLDING `can_answer` — the Vorstand and their
 *  Erfüllungsgehilfen. Rendering it is a convenience; the endpoints
 *  check the column again server-side and answer 404, not 403, to
 *  anybody else, because an ordinary member has no business learning
 *  that this console exists.
 *
 *  THE ANSWER HAPPENS OUTSIDE THIS SCREEN, by mail or telephone,
 *  because that is what the visitor was promised — "wird sich dann bald
 *  bei Ihnen melden". All this does is stop two people answering the
 *  same enquiry and stop any of them being quietly forgotten.
 */
function Enquiries() {
  const [rows, setRows] = useState<Enquiry[] | null>(null);
  const [open, setOpen] = useState(0);
  const [failed, setFailed] = useState("");
  const [busy, setBusy] = useState("");
  /** Which one has asked "really?". Deleting cannot be undone, so it
   *  takes two deliberate clicks and the second says what it will do. */
  const [confirming, setConfirming] = useState("");

  const load = () =>
    api
      .enquiries()
      .then((r) => {
        setRows(r.enquiries);
        setOpen(r.open);
      })
      .catch((e) =>
        setFailed(
          e instanceof ApiError
            ? e.message
            : "Die Anfragen lassen sich gerade nicht laden.",
        ),
      );

  useEffect(() => {
    load();
  }, []);

  const act = async (fn: Promise<unknown>, id: string) => {
    setBusy(id);
    setFailed("");
    try {
      await fn;
      setConfirming("");
      await load();
    } catch (e) {
      setFailed(e instanceof ApiError ? e.message : "Das hat nicht geklappt.");
    } finally {
      setBusy("");
    }
  };

  if (rows === null && !failed) {
    return (
      <div className="enquiries">
        <h2>Anfragen</h2>
        <p className="empty">Lädt…</p>
      </div>
    );
  }

  return (
    <div className="enquiries">
      <h2>
        Anfragen
        {open > 0 && <span className="wartet">{open} offen</span>}
      </h2>

      {failed && (
        <p className="membererror" role="alert">
          {failed}
        </p>
      )}

      {rows !== null && rows.length === 0 && (
        <p className="empty">Es hat noch niemand geschrieben.</p>
      )}

      {(rows ?? []).map((e) => (
        <div key={e.id} className={`enq${e.handled ? "" : " offen"}`}>
          <div className="enqhead">
            <span className="wann">{when(e.created)}</span>
            {e.handled ? (
              <span>
                erledigt {when(e.handled)}
                {e.handled_by && ` · ${e.handled_by}`}
              </span>
            ) : (
              <span>offen</span>
            )}
          </div>

          {/* AS WRITTEN. React escapes it, so there is no path from what
              somebody typed into the bubble to markup that runs here. */}
          <div className="enqmsgs">
            {e.messages.map((m, i) => (
              <p key={i}>{m.body}</p>
            ))}
          </div>

          <div className="enqacts">
            {confirming === e.id ? (
              <>
                <button
                  className="enqdel"
                  disabled={busy === e.id}
                  onClick={() => act(api.enquiryDelete(e.id), e.id)}
                >
                  Endgültig löschen
                </button>
                <button onClick={() => setConfirming("")}>Abbrechen</button>
              </>
            ) : (
              <>
                <button
                  className={e.handled ? "" : "enqdone"}
                  disabled={busy === e.id}
                  onClick={() => act(api.enquiryHandle(e.id, !e.handled), e.id)}
                >
                  {e.handled ? "Wieder öffnen" : "Erledigt"}
                </button>
                <button
                  className="enqask"
                  disabled={busy === e.id}
                  onClick={() => setConfirming(e.id)}
                >
                  Löschen
                </button>
              </>
            )}
          </div>
        </div>
      ))}

      <p className="membernote">
        Die Antwort selbst geht per E-Mail oder Telefon hinaus — genau
        das haben wir der Person versprochen. „Erledigt“ hält hier nur
        fest, dass sich jemand darum gekümmert hat.
      </p>
    </div>
  );
}

/** The members area: sign up, sign in, and the welcome page.
 *
 *  BOTH WAYS IN, NOT EITHER. The shepherd's rule — "the or for the
 *  signup/login is inclusive, so both are supported" — means a member may
 *  arrive with an email and a password, with Google, or with both, and
 *  the same person must not end up holding two accounts because they
 *  pressed a different button on a different day. That is what the
 *  backend's unique lowercased email and its separate Identity table are
 *  for; this page simply offers both doors.
 *
 *  IT HOLDS NO TOKEN. The session is a row in our own database and the
 *  cookie carries only its id, so signing out is a DELETE that takes
 *  effect immediately.
 *
 *  IT COLLECTS NOTHING ELSE. No name, no "where am I signed in" list, no
 *  last-login. Nothing is stored that is not technically required, and a
 *  field on this form is a field in that database.
 *
 *  ERRORS ARE SHOWN. Brightbean renders a page identical to the login
 *  form when it refuses a password — no message, nothing — and that cost
 *  an hour of looking at cookies and proxies for a wrong password. Every
 *  refusal here is printed, in the backend's own words.
 */

type Mode = "login" | "signup";

export default function Members() {
  const [member, setMember] = useState<MemberAccount | null>(null);
  const [asked, setAsked] = useState(false);
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** A GOOD thing to report, deliberately separate from `error` so the
   *  two cannot be confused: a confirmation is not a failure and must
   *  not be painted like one. */
  const [notice, setNotice] = useState("");
  /** Set when a password-reset link has been opened. While it holds a
   *  value the page shows "choose a new password" rather than the login
   *  form — the person is here to do one specific thing. */
  const [resetToken, setResetToken] = useState("");
  /** Whether the "I have forgotten my password" form is showing. */
  const [forgot, setForgot] = useState(false);
  /** True once the reset request has been sent, so the page can stop
   *  offering the button and say what happens next. */
  const [asked2, setAsked2] = useState(false);
  /** Where to go once there is somebody to be — set only when the
   *  visitor arrived here from the forum's login.
   *
   *  app/discourse.py bounces anybody who is not signed in back to this
   *  page, carrying the signed login request the forum handed it. This
   *  is the other half of that: without it, somebody who presses
   *  "Anmelden" on the forum lands on a login form and is then simply
   *  stranded — which is not helping them, it is interrupting them. */
  const [weiter, setWeiter] = useState("");
  /** Where the members' forum lives, read from /api/site.
   *
   *  EMPTY UNTIL IT ANSWERS, and empty for good on a deployment with no
   *  forum wired up — the link then simply does not appear, rather than
   *  sitting there pointing nowhere. A dead link on the one page a
   *  member is meant to trust is worse than no link. */
  const [forum, setForum] = useState("");

  useEffect(() => {
    api
      .site()
      .then((s) => setForum(s.forum))
      .catch(() => setForum(""));
  }, []);

  // WHO IS THIS, IF ANYBODY. A 401 here is the ordinary state of a
  // visitor who has not signed in, not a failure worth reporting — so it
  // sets "asked" and says nothing.
  useEffect(() => {
    api
      .me()
      .then((m) => setMember(m))
      .catch(() => setMember(null))
      .finally(() => setAsked(true));
  }, []);

  /** WHAT WENT WRONG ON THE WAY BACK FROM GOOGLE.
   *
   *  The browser leaves this origin entirely and returns as a fresh
   *  navigation, so there is no promise to catch and no state that
   *  survived — the only channel left is the URL. The callback puts a
   *  short code there and this turns it into German.
   *
   *  WITHOUT THIS, A REFUSED GOOGLE LOGIN LANDS ON A PERFECTLY ORDINARY
   *  LOGIN FORM with no explanation, which is precisely the failure
   *  this page was written to avoid: Brightbean does exactly that when
   *  it refuses a password, and it cost an hour of looking at cookies
   *  and proxies for what was a typo. */
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);

    /* TAKEN OUT OF THE ADDRESS BAR IMMEDIATELY, in every branch below.
       A token on the URL is a live credential: it goes into history, it
       is offered as a Referer to anything the page later loads, and it
       is what somebody copies when they paste "the link that didn't
       work" into a message. Reading it once and removing it is the
       whole of the mitigation. */
    const clean = () =>
      window.history.replaceState({}, "", window.location.pathname);

    /* ARRIVED FROM THE FORUM, not signed in. This is what carries them
       back to the login they actually asked for.

       ONLY THAT ONE ENDPOINT IS EVER FOLLOWED. `weiter` sits on the
       URL, so anybody can put anything in it — and a page that follows
       an arbitrary URL from its own query string is an open redirect,
       which is precisely the shape that makes a phishing link look as
       though it came from the club. A path on this origin, and that
       path only. */
    /* TWO DESTINATIONS ARE FOLLOWED, AND ONLY TWO.
     *
     * The forum's signed login, and Brightbean behind the wrapper —
     * nginx refuses an unauthenticated request to /brightbean and sends
     * them here, and without carrying the destination they arrive on
     * this page with nothing to click and no explanation of why they
     * left the tool.
     *
     * BOTH TESTS ARE PREFIX MATCHES ON A PATH OF THIS ORIGIN, which is
     * what stops `weiter` becoming an open redirect: it sits on the URL
     * where anybody can write anything, and a page that follows an
     * arbitrary value is a phishing link wearing the club's name. Note
     * that "/brightbean/" must keep its trailing slash — "//evil.example"
     * is a protocol-relative URL that a laxer test would happily
     * follow. */
    const back = query.get("weiter");
    if (
      back &&
      (back.startsWith("/api/auth/discourse/sso?") ||
        back.startsWith("/brightbean/"))
    ) {
      clean();
      setWeiter(back);
    }

    const confirming = query.get("bestaetigen");
    if (confirming) {
      clean();
      api
        .verify(confirming)
        .then(() =>
          setNotice(
            "Danke — Deine E-Mail-Adresse ist bestätigt. Sobald der " +
              "Vorstand Dein Konto freischaltet, kannst Du den internen " +
              "Bereich sehen.",
          ),
        )
        .catch((err) =>
          setError(
            err instanceof ApiError
              ? err.message
              : "Dieser Bestätigungslink ist nicht mehr gültig.",
          ),
        );
      return;
    }

    const resetting = query.get("zuruecksetzen");
    if (resetting) {
      clean();
      // NOT SPENT YET. The token is only redeemed when a new password is
      // actually submitted, so opening the link in a mail preview does
      // not burn it.
      setResetToken(resetting);
      return;
    }

    const code = query.get("fehler");
    if (!code) return;
    const said: Record<string, string> = {
      abgebrochen: "Die Anmeldung mit Google wurde abgebrochen.",
      "nicht-eingerichtet":
        "Die Anmeldung mit Google ist auf diesem Server nicht eingerichtet.",
      unbestaetigt:
        "Google hat diese E-Mail-Adresse nicht bestätigt. Bitte bestätige " +
        "sie bei Google oder lege ein Konto mit Passwort an.",
      deaktiviert:
        "Dieses Konto ist deaktiviert. Bitte wende Dich an den Vorstand.",

      /* THE FORUM'S OWN REFUSALS. These four were shipped without any
         German at all, so a member who hit one got the generic fallback
         below — which, until this was noticed, told them their GOOGLE
         sign-in had failed when they had never touched Google. A code
         with no message is a message that lies. */
      "forum-nicht-eingerichtet":
        "Das Vereinsforum ist auf diesem Server noch nicht eingerichtet.",
      "forum-signatur":
        "Die Anmeldung am Vereinsforum konnte nicht bestätigt werden. " +
        "Bitte versuche es noch einmal. Wenn es weiterhin nicht klappt, " +
        "sag bitte einem Administrator Bescheid.",
      "forum-ziel":
        "Die Anmeldung am Vereinsforum wurde abgebrochen, weil das Ziel " +
        "nicht zum Forum des Vereins gehört.",
      /* Sent by nginx when somebody signed in reaches /brightbean
         without the Social Media role. A code with no message here
         would fall through to the generic line, which is true but
         says nothing about what to do. */
      "brightbean-kein-zugriff":
        "Für den Social-Media-Bereich fehlt Dir die Berechtigung. Wenn " +
        "Du dort mitarbeiten möchtest, wende Dich bitte an einen " +
        "Administrator.",
      "forum-nicht-freigeschaltet":
        "Dein Konto ist noch nicht freigeschaltet. Sobald ein " +
        "Administrator es freigibt, kannst Du auch das Vereinsforum " +
        "nutzen.",
    };
    setError(
      said[code] ??
        // Everything else — a failed state check, a rotated key, a
        // network fault — means the same thing to the person reading
        // it: we could not establish who they are. Which of them it was
        // is a fact about an attack or an outage, and naming it here
        // would tell an attacker as much as a member.
        /* PROVIDER-NEUTRAL, because this is no longer only Google's
           fallback: the forum sends codes through the same channel, and
           telling somebody their Google sign-in failed when they were
           logging in to the forum is a confident wrong answer. */
        "Die Anmeldung hat nicht geklappt. Bitte versuche es noch einmal.",
    );
    // Take it back out of the address bar, so a reload or a shared link
    // does not resurrect an error that has been read and dealt with.
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  /** BACK TO THE FORUM, the moment there is somebody to be.
   *
   *  Fires for a fresh login and for somebody who was already signed in
   *  on this browser, because both end with `member` set.
   *
   *  DELIBERATELY CONDITIONAL ON `approved`. The signing endpoint
   *  refuses to sign for anybody the club has not let in — that refusal
   *  IS the authorisation, there being no "deny" in the protocol — so
   *  sending an unapproved member back would bounce them straight here
   *  again. That is a loop, and a loop reads as a broken button rather
   *  than as a decision. They stay and read why instead.
   *
   *  A full navigation rather than a router push: the destination is a
   *  server endpoint that answers a redirect, not a page this app
   *  renders. */
  useEffect(() => {
    if (weiter && member && member.approved) {
      window.location.assign(weiter);
    }
  }, [weiter, member]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "signup") {
        // NO SESSION AND NOTHING TO READ. The route answers 204 whether
        // or not that address already has an account, so there is no
        // outcome here to branch on — and branching would be the leak.
        // What differs goes to the mailbox: a confirmation link, or a
        // note saying an account already exists.
        await api.signup(email, password);
        setPassword("");
        setNotice(
          "Fast geschafft — wir haben Dir eine E-Mail geschickt. Bitte " +
            "bestätige damit Deine Adresse. Danach kannst Du Dich hier " +
            "anmelden; freigeschaltet wird Dein Konto von einem " +
            "Administrator.",
        );
        setMode("login");
      } else {
        setMember(await api.login(email, password));
        setPassword("");
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Die Anmeldung ist gerade nicht möglich. Bitte später erneut " +
            "versuchen.",
      );
    } finally {
      setBusy(false);
    }
  };

  /** "I have forgotten my password." */
  const askReset = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.resetRequest(email);
    } catch {
      /* NOTHING IS REPORTED, AND THAT IS THE DESIGN. The route answers
         204 whatever is true, so there is nothing here to read — and
         reporting a transport failure differently from success would
         start rebuilding the very oracle the 204 exists to prevent.
         The message below is the same either way. */
    } finally {
      setBusy(false);
      setAsked2(true);
    }
  };

  /** Choosing a new password, having arrived with a reset link. */
  const setNewPassword = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      setMember(await api.resetConfirm(resetToken, password));
      // The token is spent; drop it so a reload cannot try again.
      setResetToken("");
      setPassword("");
      setNotice(
        "Dein neues Passwort ist gesetzt und Du bist angemeldet. Andere " +
          "Geräte wurden abgemeldet.",
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Das hat nicht geklappt. Bitte fordere einen neuen Link an.",
      );
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await api.logout();
      setMember(null);
    } catch {
      /* The session may already be gone at the server, which is the
         outcome we wanted anyway. */
      setMember(null);
    } finally {
      setBusy(false);
    }
  };

  if (!asked) {
    return (
      <section className="members">
        <div className="memberbox schmal">
          <p className="empty">Lädt…</p>
        </div>
      </section>
    );
  }

  // ---- signed in ------------------------------------------------------
  if (member) {
    return (
      <section className="members">
        {/* A SUBMENU BAR, and this time actually one.
         *
         * The first attempt was three filled buttons in a row inside the
         * welcome card — a toolbar wearing a bar's name. "That is NOT a
         * submenu bar", and it was not: a bar is chrome, and those were
         * the three loudest objects on the page.
         *
         * So it is now what this site's own header already is: text
         * links on a rule, OUTSIDE the card, spanning the column.
         * Destinations on the left, who you are and the way out on the
         * right. Nothing in it competes with the content below it, which
         * is the whole difference between a bar and three buttons. */}
        <nav className="membernav">
              {/* THE VEREINSFORUM, for members the club has let in.
                  Hidden from everybody else rather than shown and
                  refused: the forum turns away anyone unapproved, so
                  offering it to somebody still waiting is offering them
                  a closed door.

                  IT POINTS AT /session/sso, NOT THE FRONT PAGE. Whoever
                  reads this is already signed in here, so that path
                  takes them straight through. */}
              {member.approved && forum && (
                <a href={`${forum}/session/sso`}>
                  Zum Vereinsforum
                  <ExternalLink aria-hidden="true" />
                </a>
              )}

              {/* BRIGHTBEAN. A path on THIS host rather than a host of
                  its own, which is what lets the session cookie be sent
                  with it — nginx asks this site who you are before
                  forwarding anything. Shown on can_social alone:
                  approval is implied, because granting the role
                  approves the member. */}
              {member.can_social && (
                <a href="/brightbean/">
                  Social Media verwalten
                  <ExternalLink aria-hidden="true" />
                </a>
              )}

              {/* Who you are, and then the way out. Both pushed right,
                  which is what makes this read as a bar rather than as
                  a list of links. */}
              <span className="membernavwho">{member.email}</span>

              {/* A GLYPH, like the role controls below. Signing out is
                  the one thing on this page nobody needs prompting
                  about, and as a full-width button it was the loudest
                  element on a page whose point is everything else. */}
              <button
                className="membernavout"
                onClick={signOut}
                disabled={busy}
                title="Abmelden"
                aria-label="Abmelden"
              >
                <LogOut aria-hidden="true" />
              </button>
        </nav>

        <div className="memberbox">
          <h1>Willkommen</h1>

          {/* Good news, announced rather than merely drawn — somebody
              who has just confirmed an address or set a password needs
              telling that it worked. */}
          {notice && (
            <p className="membernotice" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="membererror" role="alert">
              {error}
            </p>
          )}

          {member.approved ? (
            <p>
              Schön, dass Du da bist. Hier entsteht der interne Bereich für
              Mitglieder.
            </p>
          ) : (
            /* AN ACCOUNT IS NOT A MEMBERSHIP. Saying so plainly beats a
               members area that looks empty and broken to somebody the
               club has not let in yet. */
            <p className="memberwait">
              Dein Konto ist angelegt, aber noch nicht freigegeben. Ein
              Administrator schaltet es frei — bis dahin ist der interne
              Bereich noch nicht sichtbar.
            </p>
          )}

        </div>

        {/* THE BOARD'S WORK, below the welcome and only for the board.
            Outside .memberbox because it is a list that grows, and the
            440px card was measured for a login form. */}
        {/* THE DAILY WORK FIRST, the administration after it. Answering
            the public is what somebody signs in to do; approving a new
            account happens a few times a year. */}
        {member.can_answer && <Enquiries />}
        {member.admin && (
          <Board
            me={member}
            onChanged={() => {
              api.me().then(setMember).catch(() => {
                /* Still signed in as far as this page is concerned; the
                   next action or a reload will correct it. */
              });
            }}
          />
        )}
      </section>
    );
  }

  // ---- arrived with a password-reset link ------------------------------
  //
  // A PAGE OF ITS OWN, not a field bolted onto the login form. Somebody
  // here has come from their mailbox to do exactly one thing, and
  // offering them the ordinary login as well would invite them to try
  // the password they have already forgotten.
  if (resetToken) {
    return (
      <section className="members">
        <div className="memberbox schmal">
          <h1>Neues Passwort</h1>
          <p className="memberwho">
            Wähle ein neues Passwort für Dein Konto.
          </p>

          {error && (
            <p className="membererror" role="alert">
              {error}
            </p>
          )}

          <form onSubmit={setNewPassword}>
            <label htmlFor="member-newpassword">Neues Passwort</label>
            <input
              id="member-newpassword"
              type="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={8}
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button className="memberdo" type="submit" disabled={busy}>
              {busy ? "Einen Moment…" : "Passwort setzen"}
            </button>
          </form>

          <p className="membernote">
            Mindestens 8 Zeichen. Nach dem Setzen bist Du auf diesem Gerät
            angemeldet; alle anderen Anmeldungen werden beendet.
          </p>
        </div>
      </section>
    );
  }

  // ---- asked for a reset link ------------------------------------------
  if (forgot) {
    return (
      <section className="members">
        <div className="memberbox schmal">
          <h1>Passwort vergessen</h1>

          {asked2 ? (
            /* THE SAME ANSWER WHATEVER IS TRUE. It deliberately does not
               say whether an account exists — that question is not one a
               public form should answer about the club's members. */
            <>
              <p className="membernotice" role="status">
                Wenn es für diese Adresse ein Konto gibt, ist eine E-Mail
                mit einem Link unterwegs. Der Link gilt eine Stunde.
              </p>
              <button
                className="memberout"
                onClick={() => {
                  setForgot(false);
                  setAsked2(false);
                }}
              >
                Zurück zur Anmeldung
              </button>
            </>
          ) : (
            <>
              <p className="memberwho">
                Wir schicken Dir einen Link, mit dem Du ein neues Passwort
                setzen kannst.
              </p>
              <form onSubmit={askReset}>
                <label htmlFor="member-forgot">E-Mail-Adresse</label>
                <input
                  id="member-forgot"
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button className="memberdo" type="submit" disabled={busy}>
                  {busy ? "Einen Moment…" : "Link anfordern"}
                </button>
              </form>
              <button
                className="memberout"
                onClick={() => setForgot(false)}
                disabled={busy}
              >
                Zurück zur Anmeldung
              </button>
            </>
          )}
        </div>
      </section>
    );
  }

  // ---- signed out -----------------------------------------------------
  return (
    <section className="members">
      <div className="memberbox schmal">
        <h1>Mitgliederbereich</h1>

        {/* A confirmation link lands here while nobody is signed in, so
            the good news has to be sayable in this state too. */}
        {notice && (
          <p className="membernotice" role="status">
            {notice}
          </p>
        )}

        {/* Real buttons with aria-pressed, not styled divs: this is a
            control, it has a state, and a screen reader has to be able to
            say which one it is in. */}
        <div className="membertabs" role="group" aria-label="Anmelden oder registrieren">
          <button
            type="button"
            aria-pressed={mode === "login"}
            onClick={() => {
              setMode("login");
              setError("");
            }}
          >
            Anmelden
          </button>
          <button
            type="button"
            aria-pressed={mode === "signup"}
            onClick={() => {
              setMode("signup");
              setError("");
            }}
          >
            Registrieren
          </button>
        </div>

        <form onSubmit={submit}>
          <label htmlFor="member-email">E-Mail-Adresse</label>
          <input
            id="member-email"
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label htmlFor="member-password">Passwort</label>
          <input
            id="member-password"
            type="password"
            name="password"
            /* Tells a password manager which of the two this is, so it
               offers to save a new one rather than filling an old one. */
            autoComplete={
              mode === "signup" ? "new-password" : "current-password"
            }
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {/* role="alert" so it is ANNOUNCED rather than merely drawn —
              a refusal nobody is told about is the failure this page
              exists to avoid. */}
          {error && (
            <p className="membererror" role="alert">
              {error}
            </p>
          )}

          <button className="memberdo" type="submit" disabled={busy}>
            {busy
              ? "Einen Moment…"
              : mode === "signup"
                ? "Konto anlegen"
                : "Anmelden"}
          </button>
        </form>

        {/* ONLY WHEN SIGNING IN. On the registration tab it would be
            nonsense — there is nothing yet to have forgotten. A real
            button rather than a link: it goes nowhere, it changes what
            this page is showing. */}
        {mode === "login" && (
          <button
            className="memberforgot"
            type="button"
            onClick={() => {
              setForgot(true);
              setError("");
              setPassword("");
            }}
          >
            Passwort vergessen?
          </button>
        )}

        <p className="memberor">oder</p>

        {/* A LINK, NOT A FETCH. The browser has to leave for Google and
            come back with a code on the query string; an XHR cannot do
            that. No third-party script is loaded — the whole exchange
            happens between our server and Google's, so a visitor's
            browser still talks to this origin and nothing else. */}
        <a className="membergoogle" href={api.googleStart}>
          Mit Google anmelden
        </a>

        <p className="membernote">
          Ein Konto ist noch keine Mitgliedschaft. Wenn Du dem Verein
          beitreten möchtest, findest Du alles unter{" "}
          <a href="/mitgliedschaft">Mitgliedschaft</a>.
        </p>
      </div>
    </section>
  );
}

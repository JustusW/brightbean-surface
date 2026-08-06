import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, api } from "./api";
import type { MemberAccount, Registration } from "./api";

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
function Board({ me }: { me: MemberAccount }) {
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
    what: "approve" | "revoke" | "delete",
  ) => {
    setBusy(email);
    setFailed("");
    try {
      await api.decide(email, what);
      setConfirming("");
      await load();
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
              <span className="selbst">Du</span>
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
                    className="regrevoke"
                    disabled={busy === r.email}
                    onClick={() => decide(r.email, "revoke")}
                  >
                    Zugang entziehen
                  </button>
                ) : (
                  <button
                    className="regok"
                    disabled={busy === r.email}
                    onClick={() => decide(r.email, "approve")}
                  >
                    Freischalten
                  </button>
                )}
                {/* DELETE IS ALWAYS OFFERED, approved or not — Art. 17
                    DSGVO is a right the person has whether or not the
                    club ever let them in. */}
                <button
                  className="regask"
                  disabled={busy === r.email}
                  onClick={() => setConfirming(r.email)}
                  aria-label={`Konto ${r.email} löschen`}
                >
                  Löschen
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
    };
    setError(
      said[code] ??
        // Everything else — a failed state check, a rotated key, a
        // network fault — means the same thing to the person reading
        // it: we could not establish who they are. Which of them it was
        // is a fact about an attack or an outage, and naming it here
        // would tell an attacker as much as a member.
        "Die Anmeldung mit Google hat nicht geklappt. Bitte versuche es " +
          "noch einmal.",
    );
    // Take it back out of the address bar, so a reload or a shared link
    // does not resurrect an error that has been read and dealt with.
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

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
        <div className="memberbox">
          <p className="empty">Lädt…</p>
        </div>
      </section>
    );
  }

  // ---- signed in ------------------------------------------------------
  if (member) {
    return (
      <section className="members">
        <div className="memberbox">
          <h1>Willkommen</h1>
          <p className="memberwho">{member.email}</p>

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

          <button className="memberout" onClick={signOut} disabled={busy}>
            Abmelden
          </button>
        </div>

        {/* THE BOARD'S WORK, below the welcome and only for the board.
            Outside .memberbox because it is a list that grows, and the
            440px card was measured for a login form. */}
        {member.admin && <Board me={member} />}
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
        <div className="memberbox">
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
        <div className="memberbox">
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
      <div className="memberbox">
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

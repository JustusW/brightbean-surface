import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, api } from "./api";
import type { MemberAccount } from "./api";

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
    const code = new URLSearchParams(window.location.search).get("fehler");
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
        // state, nonce, token and google all mean the same thing to the
        // person reading it: we could not establish who they are. Which
        // of them it was is a fact about an attack or an outage, and
        // naming it here would tell an attacker as much as a member.
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
      const call = mode === "signup" ? api.signup : api.login;
      setMember(await call(email, password));
      setPassword("");
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
              Dein Konto ist angelegt, aber noch nicht freigegeben. Der
              Vorstand schaltet es frei — bis dahin ist der interne Bereich
              noch nicht sichtbar.
            </p>
          )}

          <button className="memberout" onClick={signOut} disabled={busy}>
            Abmelden
          </button>
        </div>
      </section>
    );
  }

  // ---- signed out -----------------------------------------------------
  return (
    <section className="members">
      <div className="memberbox">
        <h1>Mitgliederbereich</h1>

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

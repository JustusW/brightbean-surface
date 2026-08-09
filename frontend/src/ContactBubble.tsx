import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { MessageSquare, X } from "lucide-react";
import { ApiError, api } from "./api";

/** The speech bubble, bottom right: somebody reaching the club.
 *
 *  IT LOOKS LIKE A CHAT AND NEVER PRETENDS TO BE ONE. There is no
 *  presence dot, no "wir sind online", no typing indicator. The visitor
 *  types, sees their own words, and is told that somebody will get back
 *  to them — which is a promise a volunteer club can keep. A blinking
 *  cursor nobody is watching is worse than no bubble at all.
 *
 *  THE TWO REPLIES ARE CONSTANTS, not messages from a person and not
 *  rows in the database. Storing our own fixed strings back would be
 *  keeping a copy of something we already know, once per enquiry, and
 *  would make the stored record look like a conversation that never
 *  happened.
 *
 *  WHICH REPLY TO SHOW COMES FROM THE SERVER'S COUNT, not from a step
 *  this component increments. The count is how many messages the thread
 *  actually holds, so a reload mid-flow cannot desynchronise the script
 *  from the record.
 *
 *  NOTHING IS COLLECTED THAT A CONTACT FORM WOULD NOT COLLECT: no name
 *  field, no address field, no account, and no cookie. Whatever somebody
 *  chooses to give arrives as a message in their own words. That
 *  equivalence is what lets this exist under the club's current
 *  Datenschutzerklärung, which already describes the Kontaktformular —
 *  so it must not quietly acquire a tracker later.
 */

/** The club's own words, corrected only for spelling and a comma. */
const ASK_FOR_CONTACT =
  "Dankeschön! Wir haben Ihre Nachricht erhalten. Wenn Sie eine " +
  "Antwort möchten, hinterlassen Sie uns bitte eine E-Mail-Adresse " +
  "oder Telefonnummer.";

const WE_WILL_BE_IN_TOUCH =
  "Ein Mitglied unserer ehrenamtlichen Teams wird sich dann bald bei " +
  "Ihnen melden!";

/** Where the thread's token lives while the tab is open.
 *
 *  sessionStorage RATHER THAN A COOKIE OR localStorage, and it is the
 *  most privacy-minimal thing that still works. A cookie would travel on
 *  every request to this origin for no reason; localStorage would
 *  outlive the visit and quietly turn into a way of recognising somebody
 *  who came back. The flow needs it for one visit — message, then
 *  contact details — and then never again, because the answer comes by
 *  mail or telephone.
 */
const KEY = "vfm_enquiry";

/** How tall the message box is allowed to grow, in pixels.
 *
 *  It MUST match max-height on .bubbleform textarea. Past this the box
 *  scrolls instead of growing — otherwise a long enquiry eats the
 *  thread above it and then pushes the whole panel off the bottom of a
 *  phone, taking the Senden button with it. */
const GROW_TO = 220;

interface Line {
  /** "them" is the visitor's own words; "us" is one of the two
   *  constants above. Never mixed up, because what the visitor typed is
   *  shown exactly as typed. */
  who: "them" | "us";
  text: string;
}

export default function ContactBubble() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const thread = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // ESCAPE CLOSES IT. The page underneath is deliberately NOT frozen the
  // way the gallery viewer freezes it: this is a panel in the corner,
  // not a modal, and somebody should be able to keep reading the page
  // they were asking about.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Keep the newest line in view, and put the cursor where somebody can
  // simply start typing.
  useEffect(() => {
    if (!open) return;
    thread.current?.scrollTo({ top: thread.current.scrollHeight });
    input.current?.focus();
  }, [open, lines]);

  /** THE BOX GROWS WITH WHAT IS BEING WRITTEN, and shrinks back when
   *  the message has gone.
   *
   *  height is set to "auto" FIRST on purpose. scrollHeight can only
   *  report content taller than the box, never shorter — so measuring
   *  without releasing the height means the box ratchets upwards and
   *  never comes back down after a send, or after somebody deletes a
   *  paragraph.
   *
   *  Driven off `draft` rather than off the keystroke, so it is also
   *  right for the text put BACK after a failed send. */
  useEffect(() => {
    const box = input.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, GROW_TO)}px`;
  }, [draft, open]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;

    setBusy(true);
    setError("");
    // Shown immediately and AS WRITTEN. React escapes it, so there is no
    // path from what somebody types to markup that runs.
    setLines((prev) => [...prev, { who: "them", text }]);
    setDraft("");

    try {
      const token = sessionStorage.getItem(KEY) ?? undefined;
      const answer = await api.enquire(text, token);
      sessionStorage.setItem(KEY, answer.token);

      // THE COUNT DECIDES, not a step counter of our own.
      if (answer.count === 1) {
        setLines((prev) => [...prev, { who: "us", text: ASK_FOR_CONTACT }]);
      } else if (answer.count === 2) {
        setLines((prev) => [
          ...prev,
          { who: "us", text: WE_WILL_BE_IN_TOUCH },
        ]);
      }
      // Past two, nothing. Repeating either line would read as broken,
      // and the input stays open so somebody can add "sorry, forgot to
      // say —" without being told the same thing again.
    } catch (err) {
      // THE MESSAGE MUST NOT VANISH SILENTLY. It is already on screen as
      // theirs, so saying nothing would look like it had been sent. The
      // draft is put back so they can try again without retyping it.
      setLines((prev) => prev.slice(0, -1));
      setDraft(text);
      setError(
        err instanceof ApiError
          ? err.message
          : "Die Nachricht konnte gerade nicht gesendet werden. Bitte " +
            "versuchen Sie es noch einmal.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* A REAL BUTTON. It has to be reachable and operable from a
          keyboard, and aria-expanded is what tells a screen reader
          whether the panel is open.

          AND IT IS A SPEECH BUBBLE, which is what was asked for. The
          first version was an envelope glyph inside a blue disc — "I
          asked for a speech bubble, not a tiny mail envelope in a blue
          circle" — and an envelope means mail, which is precisely what
          this is not: nothing here sends anything.

          FROM A LIBRARY, NOT DRAWN BY HAND. The version after the
          envelope was an SVG path I wrote myself, which is the same
          mistake in a better costume: "use bloody standard libraries".
          lucide-react is bundled by Vite into our own assets like every
          other dependency here, so the single-origin rule holds and it
          tree-shakes to the two icons actually used.

          WHITE GLYPH ON A BRIGHT BLOCK, which is what the club's own
          previous site did — the chat button on www.vfm-stutensee.de is
          a cyan square with a white filled bubble in it, and the colour
          in index.css is sampled from that screenshot rather than
          chosen. The version between the envelope and this one had no
          container at all and used the club's darkest blue over a
          photograph of a field: "a dark and badly observable call to
          action button". A CTA has to win against what is behind it. */}
      <button
        className={`bubblebtn${open ? " on" : ""}`}
        aria-expanded={open}
        aria-label={open ? "Kontakt schließen" : "Kontakt aufnehmen"}
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <X aria-hidden="true" />
        ) : (
          /* Filled, so it has presence in the corner rather than being
             a thin outline somebody has to look for. */
          <MessageSquare aria-hidden="true" fill="currentColor" />
        )}
      </button>

      {open && (
        <section className="bubble" aria-label="Kontakt">
          <header className="bubblehead">
            <strong>Schreiben Sie uns</strong>
            <span>Wir sind ein ehrenamtlicher Verein — wir antworten,
              sobald jemand Zeit hat.</span>
          </header>

          {/* role="log" with aria-live: the canned replies appear
              without anybody pressing anything, so a screen reader has
              to be told they arrived. */}
          <div className="bubblethread" ref={thread} role="log"
               aria-live="polite">
            {lines.map((l, i) => (
              <p key={i} className={l.who === "us" ? "fromus" : "fromthem"}>
                {l.text}
              </p>
            ))}
          </div>

          {error && (
            <p className="bubbleerror" role="alert">
              {error}
            </p>
          )}

          <form className="bubbleform" onSubmit={send}>
            <label className="sr" htmlFor="bubble-input">
              Ihre Nachricht
            </label>
            {/* rows is the floor before any JavaScript has run — what
                the box is worth on its own. The real minimum is
                min-height in the stylesheet, and it grows from there as
                somebody types. */}
            <textarea
              id="bubble-input"
              ref={input}
              rows={4}
              value={draft}
              placeholder="Ihre Nachricht an uns…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter starts a new line — what
                // everybody expects of a box shaped like this.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(e as unknown as FormEvent);
                }
              }}
            />
            <button type="submit" disabled={busy || !draft.trim()}>
              {busy ? "…" : "Senden"}
            </button>
          </form>
        </section>
      )}
    </>
  );
}

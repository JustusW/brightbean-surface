import { CircleUserRound, Mail } from "lucide-react";

/** The Vorstand's calling cards on the Kontakt page.
 *
 *  FOUR OF THEM, filled in on 31/08/2026 from the club's own Microsoft
 *  365 user list. Until then this was three empty slots reading "Name
 *  folgt", because nothing here may be invented: a card carrying a
 *  plausible made-up name is a lie that renders perfectly.
 *
 *  TWO ACROSS, NOT FOUR, and that is forced by the addresses rather than
 *  chosen. .vkartengrid was `auto-fit, minmax(210px, 1fr)`; a 210px card
 *  has about 174px of inner width, and these mailboxes run to 55
 *  characters, so `overflow-wrap: anywhere` broke them mid-token across
 *  three lines — "stutensee.onmicrosof / t.com" — which reads as
 *  corruption rather than as an address. It went live like that. The
 *  minimum is 380px now, which yields two columns at 900 and puts the
 *  longest address on one line.
 *
 *  THE ADDRESSES ARE THE TENANT'S OWN onmicrosoft.com DOMAIN, WHICH IS A
 *  DECISION AND NOT AN UNFINISHED JOB. Measured 31/08/2026:
 *
 *      modellflug-stutensee.de  MX   dedi3819.your-server.de
 *      modellflug-stutensee.de  TXT  v=spf1 +a +mx ?all
 *
 *  Hetzner mail, with no Microsoft record anywhere in it — the club's own
 *  domain is NOT attached to that Microsoft tenant. So the tidier-looking
 *  Erster-Vorstand@modellflug-stutensee.de would not reach these
 *  mailboxes at all: it would go to Hetzner and bounce, or land somewhere
 *  nobody reads. Mail to the Vorstand silently going nowhere is far worse
 *  than an address that reads as provisional. If the domain is ever added
 *  to the tenant, these four change here — and the MX above is how to
 *  check it really moved before changing them.
 *
 *  NO TELEPHONE NUMBER ON ANY CARD. There was a `phone` field with a
 *  fallback to the club's shared number, which meant four cards drawing
 *  the SAME number — four identical lines that read as a bug rather than
 *  as four ways to reach four people. The field, the `dial()` helper and
 *  the Phone icon are all gone rather than left unused; a card is an
 *  address and a face. The one number the club publishes is in the prose
 *  above these cards, in pages/kontakt.md.
 *
 *  WOLFGANG MÜLLER HAS NO PHOTOGRAPH, so his card keeps the placeholder
 *  icon beside three real faces. Visibly incomplete is the honest state;
 *  it is not a defect to route around.
 *
 *  THE PHOTOGRAPHS ARE CROPPED SQUARE AT BUILD TIME, by
 *  notes/crop_faces.py, and that is load-bearing rather than tidy. The
 *  avatar is 84x84 with border-radius 50% and object-fit: cover, and
 *  `cover` on the 1067x1600 studio originals shows the MIDDLE of the frame
 *  — which on these portraits is chest, with the top of the head cut off.
 *  That script holds the measured face positions so the crop is not judged
 *  by eye a second time.
 *
 *  TO CHANGE THIS: edit PEOPLE. An empty `email` falls back to the club's
 *  shared address, so a half-filled card is still a usable one.
 */

interface Person {
  /** What they do for the club — "1. Vorsitzender", "Kassenwart", … */
  role: string;
  name: string;
  /** Leave empty to fall back to the club's shared address. */
  email: string;
  /** A vendored photograph in public/, when there is one. Until then
   *  the card draws the placeholder icon. */
  photo?: string;
}

/** The club's own, already on the Kontakt page and in the Impressum.
 *
 *  IT IS THE 1. VORSTAND'S MAILBOX NOW, not vfm-stutensee@gmx.de. The
 *  club moved off gmx on 31/08/2026 and all four places the old address
 *  appeared — here, kontakt.md, impressum.md and the verantwortliche
 *  Stelle in datenschutz.md — were changed together, because leaving it
 *  in some and not others is how a website ends up publishing two
 *  different contact addresses and meaning neither.
 *
 *  NOTHING RENDERS THIS TODAY. Every entry in PEOPLE carries an explicit
 *  address, so the `|| CLUB_EMAIL` fallback never fires. It is kept
 *  because a half-filled card should still be usable — and it is kept
 *  CORRECT for the same reason a dead branch is still worth not lying
 *  in. */
const CLUB_EMAIL = "Erster-Vorstand@modellflugstutensee.onmicrosoft.com";

const PEOPLE: Person[] = [
  {
    role: "1. Vorstand",
    name: "Christian Reger",
    email: "Erster-Vorstand@modellflugstutensee.onmicrosoft.com",
    photo: "/vorstand-christian.jpg",
  },
  {
    role: "2. Vorstand",
    name: "Wolfgang Müller",
    email: "Zweiter-Vorstand@modellflugstutensee.onmicrosoft.com",
    // NO PHOTOGRAPH SUPPLIED for this one, so the card draws the lucide
    // placeholder beside three real faces. That is the honest state and
    // not a bug to work around — see the note above about inventing
    // people. One more file in public/ and one line here fixes it.
  },
  {
    role: "Vorstand Finanzen",
    name: "Benjamin van Hauten",
    email: "Vorstand-Finanzen@modellflugstutensee.onmicrosoft.com",
    photo: "/vorstand-benjamin.jpg",
  },
  {
    role: "Vorstand Verwaltung",
    name: "Marco Löber",
    email: "Vorstand-Verwaltung@modellflugstutensee.onmicrosoft.com",
    photo: "/vorstand-marco.jpg",
  },
];

export default function Visitenkarten() {
  return (
    <section className="vkarten">
      <h2>Ansprechpartner</h2>

      <div className="vkartengrid">
        {PEOPLE.map((p, i) => {
          const email = p.email || CLUB_EMAIL;
          return (
            <article className="vkarte" key={i}>
              {p.photo ? (
                <img
                  className="vkartebild"
                  src={p.photo}
                  alt={p.name ? `Foto von ${p.name}` : ""}
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                /* aria-hidden: it is a placeholder for a face, not
                   information. The name below is what a screen reader
                   should read, and when there is no name it says so. */
                <CircleUserRound
                  className="vkartebild platzhalter"
                  aria-hidden="true"
                  strokeWidth={1.25}
                />
              )}

              <h3 className={p.name ? "" : "offen"}>
                {p.name || "Name folgt"}
              </h3>
              <p className={`vkarterolle${p.role ? "" : " offen"}`}>
                {p.role || "Funktion folgt"}
              </p>

              <p className="vkartekontakt">
                {/* 44px of hit area, like every other control here: this
                    is tapped on a phone, often outdoors. */}
                <a href={`mailto:${email}`}>
                  <Mail aria-hidden="true" size={17} />
                  {email}
                </a>
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

import { CircleUserRound, Mail, Phone } from "lucide-react";

/** The Vorstand's calling cards on the Kontakt page.
 *
 *  FOUR OF THEM, filled in on 31/08/2026 from the club's own Microsoft
 *  365 user list. Until then this was three empty slots reading "Name
 *  folgt", because nothing here may be invented: a card carrying a
 *  plausible made-up name is a lie that renders perfectly.
 *
 *  THE GRID TOOK FOUR WITHOUT BEING TOLD. .vkartengrid is
 *  `auto-fit, minmax(210px, 1fr)`, so four sit across the 900px column
 *  and fold to 2+2 and then to one on the way down to a phone. The
 *  original brief said three; the club has four officers, and the layout
 *  needed no change for it.
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
 *  WOLFGANG MÜLLER HAS NO PHOTOGRAPH, so his card keeps the placeholder
 *  icon beside three real faces. Visibly incomplete is the honest state;
 *  it is not a defect to route around.
 *
 *  THE PHOTOGRAPHS ARE CROPPED SQUARE AT BUILD TIME, by
 *  notes/crop_faces.py, and that is load-bearing rather than tidy. The
 *  avatar is 84x84 with border-radius 50% and object-fit: cover, and
 *  `cover` on the 1067x1600 originals shows the MIDDLE of the frame —
 *  which on these studio portraits is chest, with the top of the head cut
 *  off. That script holds the measured face positions so the crop is not
 *  judged by eye a second time.
 *
 *  THE IMPRESSUM ALREADY PUBLISHES ONE NAME — Christian Reger, as
 *  vertretungsberechtigter Vorstand — and the Datenschutzerklärung
 *  carries a personal telephone number for him. THAT NUMBER IS STILL NOT
 *  COPIED HERE: every card leaves `phone` empty and falls back to the
 *  club's own shared number. Putting somebody's personal number on a more
 *  prominent page is a decision for the club, not a tidy-up for whoever
 *  is editing this file.
 *
 *  TO CHANGE THIS: edit PEOPLE. Anything left empty falls back to the
 *  club's own shared address and number, so a half-filled card is still
 *  a usable one.
 */

interface Person {
  /** What they do for the club — "1. Vorsitzender", "Kassenwart", … */
  role: string;
  name: string;
  /** Leave empty to fall back to the club's shared address. */
  email: string;
  /** Leave empty to fall back to the club's shared number. */
  phone: string;
  /** A vendored photograph in public/, when there is one. Until then
   *  the card draws the placeholder icon. */
  photo?: string;
}

/** The club's own, already on the Kontakt page and in the Impressum. */
const CLUB_EMAIL = "vfm-stutensee@gmx.de";
const CLUB_PHONE = "+49 721 68023416";

const PEOPLE: Person[] = [
  {
    role: "1. Vorsitzender",
    name: "Christian Reger",
    email: "Erster-Vorstand@modellflugstutensee.onmicrosoft.com",
    phone: "",
    photo: "/vorstand-christian.jpg",
  },
  {
    role: "2. Vorsitzender",
    name: "Wolfgang Müller",
    email: "Zweiter-Vorstand@modellflugstutensee.onmicrosoft.com",
    phone: "",
    // NO PHOTOGRAPH SUPPLIED for this one, so the card draws the lucide
    // placeholder beside three real faces. That is the honest state and
    // not a bug to work around - see the note above about inventing
    // people. One more file in public/ and one line here fixes it.
  },
  {
    role: "Vorstand Finanzen",
    name: "Benjamin van Hauten",
    email: "Vorstand-Finanzen@modellflugstutensee.onmicrosoft.com",
    phone: "",
    photo: "/vorstand-benjamin.jpg",
  },
  {
    role: "Vorstand Verwaltung",
    name: "Marco Löber",
    email: "Vorstand-Verwaltung@modellflugstutensee.onmicrosoft.com",
    phone: "",
    photo: "/vorstand-marco.jpg",
  },
];

/** A telephone number as `tel:` wants it: no spaces, no punctuation. */
function dial(number: string): string {
  return number.replace(/[^\d+]/g, "");
}

export default function Visitenkarten() {
  return (
    <section className="vkarten">
      <h2>Ansprechpartner</h2>

      <div className="vkartengrid">
        {PEOPLE.map((p, i) => {
          const email = p.email || CLUB_EMAIL;
          const phone = p.phone || CLUB_PHONE;
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
                {/* 44px of hit area on each, like every other control
                    here: this is tapped on a phone, often outdoors. */}
                <a href={`mailto:${email}`}>
                  <Mail aria-hidden="true" size={17} />
                  {email}
                </a>
                <a href={`tel:${dial(phone)}`}>
                  <Phone aria-hidden="true" size={17} />
                  {phone}
                </a>
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

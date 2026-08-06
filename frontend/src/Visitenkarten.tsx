import { CircleUserRound, Mail, Phone } from "lucide-react";

/** Three calling cards on the Kontakt page.
 *
 *  WHO THESE PEOPLE ARE IS NOT DECIDED HERE. The club has not supplied
 *  the names or the photographs yet — "I don't have the pictures and
 *  names that go in there" — so every card renders as an obviously
 *  unfilled slot rather than as somebody invented. Three cards reading
 *  "Name folgt" are honest; three cards carrying plausible-looking made
 *  up names would be a lie that renders perfectly.
 *
 *  THE IMPRESSUM ALREADY PUBLISHES ONE NAME — Christian Reger, as
 *  vertretungsberechtigter Vorstand — and the Datenschutzerklärung
 *  carries a personal telephone number for him. Neither is copied here.
 *  Putting somebody's number on a more prominent page is a decision for
 *  the club, not a tidy-up for whoever is editing this file.
 *
 *  THE PLACEHOLDER IS A lucide ICON, at avatar scale rather than as a
 *  small glyph. When real photographs arrive they replace the icon in
 *  one place: see the `photo` field below.
 *
 *  TO FILL THIS IN: edit PEOPLE. Anything left empty falls back to the
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
  { role: "", name: "", email: "", phone: "" },
  { role: "", name: "", email: "", phone: "" },
  { role: "", name: "", email: "", phone: "" },
];

/** A telephone number as `tel:` wants it: no spaces, no punctuation. */
function dial(number: string): string {
  return number.replace(/[^\d+]/g, "");
}

export default function Visitenkarten() {
  return (
    <section className="karten">
      <h2>Ansprechpartner</h2>

      <div className="kartengrid">
        {PEOPLE.map((p, i) => {
          const email = p.email || CLUB_EMAIL;
          const phone = p.phone || CLUB_PHONE;
          return (
            <article className="karte" key={i}>
              {p.photo ? (
                <img
                  className="kartebild"
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
                  className="kartebild platzhalter"
                  aria-hidden="true"
                  strokeWidth={1.25}
                />
              )}

              <h3 className={p.name ? "" : "offen"}>
                {p.name || "Name folgt"}
              </h3>
              <p className={`karterolle${p.role ? "" : " offen"}`}>
                {p.role || "Funktion folgt"}
              </p>

              <p className="kartekontakt">
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

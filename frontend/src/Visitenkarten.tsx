import { CircleUserRound, Mail } from "lucide-react";

/** The club's Ansprechpartner, as calling cards on the Kontakt page.
 *
 *  SIX OF THEM: the four Vorstand, the Jugendleiter and the
 *  Ehrenvorsitzender. It said "the Vorstand's cards" until Stefan Fies
 *  arrived, which was true then and would have been a small lie the
 *  moment it stopped being — and the section is called "Ansprechpartner"
 *  precisely so it can hold all three kinds.
 *
 *  TWO ACROSS, NOT THREE OR FOUR, AND THAT IS STILL FORCED BY THE
 *  ADDRESSES even though they got much shorter. See .vkartengrid in
 *  index.css for the arithmetic: three columns give a 289px card, about
 *  228px of usable text width, against a 36-character longest address
 *  that needs roughly 241px at 13.5px. It only fits by dropping the type
 *  to 12.5 and leaves five pixels in hand — which is exactly the sort of
 *  "just barely" that produced two separate wrapping defects on this page
 *  already. Two across gives 442px cards and 140px of slack.
 *
 *  Six cards in two columns is three full rows. Five left the last card
 *  alone in the left-hand column, which read as an odd one out; the sixth
 *  closes it, by arithmetic rather than by design.
 *
 *  THE ADDRESSES ARE ON vfm-stutensee.de, AND THAT DOMAIN IS REALLY ON
 *  MICROSOFT — measured 01/09/2026 before changing a single one of them,
 *  because the previous comment here recorded the opposite situation and
 *  said to check the MX had actually moved first:
 *
 *      vfm-stutensee.de  MX     vfmstutensee-de0i.mail.protection.outlook.com
 *      vfm-stutensee.de  TXT    v=spf1 include:_spf-eu.ionos.com
 *                                 include:spf.protection.outlook.com ~all
 *      autodiscover.vfm-stutensee.de  CNAME  autodiscover.outlook.com
 *
 *  Microsoft MX at preference 0, Microsoft in the SPF, and the standard
 *  M365 autodiscover record. These deliver.
 *
 *  WHAT THEY REPLACED, and why it is worth remembering: the addresses
 *  were @modellflugstutensee.onmicrosoft.com — the tenant's own default
 *  domain, which is ugly on a public page and was used anyway because
 *  modellflug-stutensee.de was NOT attached to the tenant (its MX is
 *  dedi3819.your-server.de, Hetzner, and it still is). The club has since
 *  put vfm-stutensee.de on the tenant instead. If the addresses ever look
 *  wrong again, the three records above are how to check before editing.
 *
 *  A CARD MAY PUBLISH NO CONTACT DETAILS AT ALL, and the Ehrenvorsitzender
 *  is why. "Kontaktdaten erfassen wir keine." So `email` is optional and
 *  the contact line is simply not rendered when there is none.
 *
 *  THE SHARED-ADDRESS FALLBACK IS GONE BECAUSE OF THAT. It used to read
 *  `p.email || CLUB_EMAIL`, which would have quietly printed the 1.
 *  Vorstand's mailbox under Joachim Ruf's name — turning "we publish no
 *  contact details for him" into "write to Christian about him", which is
 *  not the same statement and was not anybody's decision. A missing
 *  address now shows nothing, which is the honest rendering of a missing
 *  address.
 *
 *  WOLFGANG MÜLLER HAS NO PHOTOGRAPH, so his card keeps the placeholder
 *  icon beside five real faces. Visibly incomplete is the honest state;
 *  it is not a defect to route around.
 *
 *  NO TELEPHONE NUMBER ON ANY CARD. There was a `phone` field with a
 *  fallback to the club's shared number, which meant every card drew the
 *  SAME number — identical lines that read as a bug rather than as ways
 *  to reach different people. The field, the `dial()` helper and the
 *  Phone icon are gone rather than left unused. The one number the club
 *  publishes is in the prose above these cards, in pages/kontakt.md.
 *
 *  THE PHOTOGRAPHS ARE CROPPED SQUARE AT BUILD TIME, by
 *  notes/crop_faces.py, and that is load-bearing rather than tidy. The
 *  avatar is 168x168 with border-radius 50% and object-fit: cover, and
 *  `cover` on the 1066x1600 studio originals shows the MIDDLE of the frame
 *  — which on these portraits is chest, with the top of the head cut off.
 *  That script holds the measured face positions, and the box sizes that
 *  keep every head the same fraction of its circle.
 *
 *  TO CHANGE THIS: edit PEOPLE. Omit `email` entirely for somebody who
 *  publishes none; there is no fallback and that is deliberate.
 */

interface Person {
  /** What they do for the club — "1. Vorstand", "Jugendleiter", … */
  role: string;
  name: string;
  /** OMIT IT ENTIRELY for somebody who publishes no contact details.
   *  There is no fallback: an absent address renders no contact line at
   *  all, rather than printing somebody else's. */
  email?: string;
  /** A vendored photograph in public/, when there is one. Until then
   *  the card draws the placeholder icon. */
  photo?: string;
}

/* THE LOCAL PARTS ARE THE TENANT'S AND THE CLUB RENAMES THEM. These were
   Erster-Vorstand@ and Zweiter-Vorstand@ until 02/09/2026, when they
   became 1-Vorstand@ and 2-Vorstand@ - the other three were left alone.
   Nothing about that is guessable, and a renamed mailbox does not
   necessarily keep the old name as an alias, so a stale one here is a
   contact address on a public page that silently goes nowhere.

   COPY THEM FROM THE MICROSOFT USER LIST, verbatim, rather than deriving
   them from a pattern: the pattern has already changed once. */
const PEOPLE: Person[] = [
  {
    role: "1. Vorstand",
    name: "Christian Reger",
    email: "1-Vorstand@vfm-stutensee.de",
    photo: "/vorstand-christian.jpg",
  },
  {
    role: "2. Vorstand",
    name: "Wolfgang Müller",
    email: "2-Vorstand@vfm-stutensee.de",
    // NO PHOTOGRAPH SUPPLIED for this one, so the card draws the lucide
    // placeholder beside five real faces. That is the honest state and
    // not a bug to work around — see the note above about inventing
    // people. One more file in public/ and one line here fixes it.
  },
  {
    role: "Vorstand Finanzen",
    name: "Benjamin van Hauten",
    email: "Vorstand-Finanzen@vfm-stutensee.de",
    photo: "/vorstand-benjamin.jpg",
  },
  {
    role: "Vorstand Verwaltung",
    name: "Marco Löber",
    email: "Vorstand-Verwaltung@vfm-stutensee.de",
    photo: "/vorstand-marco.jpg",
  },
  {
    // NOT VORSTAND, which is why his photograph is jugendleiter-*.jpg
    // rather than vorstand-*.jpg: the filename prefix is the role class,
    // and this section is "Ansprechpartner" rather than "Vorstand"
    // precisely so it can hold both.
    role: "Jugendleiter",
    name: "Stefan Fies",
    email: "Jugendleiter@vfm-stutensee.de",
    photo: "/jugendleiter-stefan.jpg",
  },
  {
    // NO `email`, ON INSTRUCTION: "Kontaktdaten erfassen wir keine." The
    // card shows his name, his title and his face, and no way to write to
    // him — which is exactly what was asked for. Before this, an omitted
    // address fell back to the club's shared mailbox, so leaving it out
    // would have published the 1. Vorstand's address under his name.
    //
    // LAST, because the list runs in order of who to contact and he is
    // explicitly not a contact. It is not a ranking.
    role: "Ehrenvorsitzender",
    name: "Joachim Ruf",
    photo: "/ehrenvorsitzender-joachim.jpg",
  },
];

export default function Visitenkarten() {
  return (
    <section className="vkarten">
      <h2>Ansprechpartner</h2>

      <div className="vkartengrid">
        {PEOPLE.map((p, i) => (
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

            {/* NOTHING AT ALL when there is no address — not a blank line
                and not a fallback. See the note on Person.email. */}
            {p.email && (
              <p className="vkartekontakt">
                {/* 44px of hit area, like every other control here: this
                    is tapped on a phone, often outdoors. */}
                <a href={`mailto:${p.email}`}>
                  <Mail aria-hidden="true" size={17} />
                  {p.email}
                </a>
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

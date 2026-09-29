/** The sponsors' logos, as the sponsoring agreement requires them.
 *
 *  WHAT THE AGREEMENT ACTUALLY DEMANDS, in the sponsor's own words: "Das
 *  Kortpress sowie das let's dev Logo müssen mit aktivem Link zur
 *  jeweiligen Website (www.letsdev.de und www.kortpress.io) auf Ihrer
 *  Vereinswebsite platziert werden." Two logos, two ACTIVE links, on the
 *  club's website. The club gets Kortpress free in exchange, so this
 *  block is not decoration — it is the consideration.
 *
 *  WHY IT IS A COMPONENT AND NOT MARKDOWN. The prose around it lives in
 *  pages/mitgliedschaft.md and renders through `marked`, which would
 *  handle a link perfectly well — but the logos have to swap with the
 *  theme, and Markdown cannot do that. Same division as Anfahrt on
 *  /platz and Visitenkarten on /kontakt: the words are Markdown, the
 *  thing with behaviour is a component.
 *
 *  WHY NOT IN THE FEED. It was tried there and failed twice over, and
 *  both failures were structural rather than sloppy: `Post` renders a
 *  caption as PLAIN TEXT on purpose, so a feed item can never carry a
 *  clickable link at all — and feed pictures go through PhotoGallery at
 *  up to 720px tall, which is why the logos came out enormous. A post
 *  cannot satisfy this agreement no matter how it is written.
 *
 *  WHY NOT IN THE FOOTER, which is where sponsor logos usually go. The
 *  dock is translucent over the panning airfield photograph, and the
 *  guidelines forbid exactly that: "Das Logo muss sich vom Hintergrund
 *  erkennbar abheben und darf nicht auf unruhigen Fotos platziert
 *  werden." It is also pinned to one slim height by standing
 *  instruction. A solid surface on the page is both compliant and
 *  calmer.
 *
 *  THE RULES THIS MARKUP AND ITS CSS ARE HELD TO — from
 *  notes/kortpress/assets/DE/01_hinweis/hinweis.pdf, which is the
 *  contractual document and not a style suggestion:
 *
 *    FARBEN   Black on a white background, white on a black one. This
 *             site has a dark theme, so BOTH are shipped and swapped on
 *             the data-theme attribute. That is the rule, not a taste.
 *    ABSTAND  Clear space of 1/3 of the side length, into which no other
 *             object may intrude. See .sponsoren in index.css.
 *    NUTZUNG  No rotation, no distortion, no disproportionate scaling,
 *             NO EFFECTS AT ALL — no shadows, no reflections — no font
 *             changes, no recolouring.
 *
 *  That last one is why nothing here has a filter, a transform or a
 *  box-shadow on the image, and why the hover state touches only the
 *  link's background and never the logo.
 *
 *  THE HORIZONTAL LET'S DEV LOCKUP is used although the guidelines
 *  prefer the vertical one, because they also say "Bei schmalen Flächen
 *  wird die horizontale Version genutzt" — a row beside another logo is
 *  a narrow area, and it matches heights with Kortpress, which has no
 *  vertical form (its wordmark is always right of the visual).
 *
 *  The assets are prepared by notes/prepare_sponsor_logos.py, which
 *  records which supplied file each came from and that scaling is the
 *  only thing done to them.
 */

interface Sponsor {
  name: string;
  href: string;
  /** Black lockup, for the light design. */
  hell: string;
  /** White lockup, for the dark design. */
  dunkel: string;
}

/** THE ADDRESSES ARE THE ONES THE AGREEMENT NAMES — www.letsdev.de and
 *  www.kortpress.io — rather than the bare domains Marco's draft used.
 *  Both resolve, but the contract names these and this is the clause
 *  being performed. */
const SPONSOREN: Sponsor[] = [
  {
    name: "let's dev",
    href: "https://www.letsdev.de",
    hell: "/sponsoren/letsdev-schwarz.png",
    dunkel: "/sponsoren/letsdev-weiss.png",
  },
  {
    name: "Kortpress",
    href: "https://www.kortpress.io",
    hell: "/sponsoren/kortpress-schwarz.png",
    dunkel: "/sponsoren/kortpress-weiss.png",
  },
];

export default function Sponsoren() {
  return (
    <section className="sponsoren">
      <h2>Mit freundlicher Unterstützung</h2>

      <div className="sponsorenreihe">
        {SPONSOREN.map((s) => (
          <a
            key={s.name}
            className="sponsorlogo"
            href={s.href}
            target="_blank"
            rel="noreferrer noopener"
          >
            {/* BOTH VARIANTS ARE IN THE MARKUP and the stylesheet shows
                one. A display:none image is not announced, so a screen
                reader hears the name once rather than twice — and the
                alt text is the company's name, which is what the link
                is for. */}
            <img
              className="hell"
              src={s.hell}
              alt={s.name}
              width={s.name === "Kortpress" ? 815 : 721}
              height={132}
              loading="lazy"
              decoding="async"
            />
            <img
              className="dunkel"
              src={s.dunkel}
              alt={s.name}
              width={s.name === "Kortpress" ? 815 : 721}
              height={132}
              loading="lazy"
              decoding="async"
            />
          </a>
        ))}
      </div>
    </section>
  );
}

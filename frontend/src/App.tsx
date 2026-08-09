import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useParams,
} from "react-router-dom";
import { marked } from "marked";
/* Vendored with everything else — lucide-react is already a dependency
   of this bundle (the contact bubble, the calling cards and the members'
   role controls all draw from it), so the switch costs two more glyphs
   rather than a new package. */
import { Moon, Sun } from "lucide-react";
/* LOADED ONLY BY THE PAGE THAT USES IT. Leaflet and its stylesheet are
   about 150 kB, they are needed on ONE page out of eight, and putting
   them in the main bundle took it from 339 kB to 492 — past the warning
   limit this project set on purpose, because the site is read on a rural
   mobile connection at a flying field. A dynamic import lets Vite split
   it into its own chunk that only Platz und Anfahrt ever fetches.

   Raising the limit was the other option. The build told me the bundle
   had grown by half and that would have been answering it by turning
   off the alarm. */
const Anfahrt = lazy(() => import("./Anfahrt"));
import Backdrop from "./Backdrop";
import ContactBubble from "./ContactBubble";
import Hero from "./Hero";
import Members from "./Members";
import PhotoGallery from "./PhotoGallery";
import Visitenkarten from "./Visitenkarten";
import { api } from "./api";
import type { FeedItem, FeedMedia, PageContent, Site } from "./api";

/** THE DATE, PINNED. `toLocaleDateString()` follows whatever locale the
 *  visitor's browser reports, and a German club's page rendering
 *  "8/5/2026" to somebody on a US-configured phone is month-first
 *  nonsense. The format is stated rather than left defaultable. */
const DATE = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : DATE.format(d);
}

/** A heading for a post that has none: THE FIRST FEW WORDS, then an
 *  ellipsis. That is the whole rule.
 *
 *  Social captions almost never carry a title — the composer's title
 *  field is for platforms that want one, and Instagram does not — so
 *  without this every card opens with a wall of body text and there is
 *  nothing to scan.
 *
 *  AN EARLIER VERSION CUT AT THE FIRST SENTENCE INSTEAD, which produced
 *  a lovely "Wir feiern!" on the one post that happened to open with a
 *  short exclamation, and would have produced nonsense on the next one.
 *  That is not a rule, it is a coincidence with a function wrapped round
 *  it — and a heading generator has to be judged on the captions nobody
 *  has written yet. This one behaves identically whatever the
 *  punctuation does.
 *
 *  The body is left WHOLE. The heading is a truncation of it rather than
 *  a piece removed from it, so cutting the words out below would start
 *  every post mid-sentence. */
const LEAD_WORDS = 6;
const LEAD_CHARS = 56;

function leadIn(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";

  const taken: string[] = [];
  for (const w of words.slice(0, LEAD_WORDS)) {
    // Bounded by characters as well as by words, because six words of
    // German compounds is a different length from six words of anything
    // else, and a heading that wraps to three lines is not a heading.
    if (taken.length && taken.join(" ").length + 1 + w.length > LEAD_CHARS) {
      break;
    }
    taken.push(w);
  }
  return taken.join(" ") + "…";
}

function Post({ item }: { item: FeedItem }) {
  const [open, setOpen] = useState(false);

  const heading = item.title || leadIn(item.text);
  const body = item.text;

  const long = body.length > 340;
  const text = open || !long ? body : body.slice(0, 340) + "…";

  return (
    <article className="post">
      {/* THE HEADING GOES ABOVE THE PICTURES. It was under them, which
          made the gallery the first thing on every card and left the
          reader scrolling past an image to find out what it was of — a
          headline exists to be read BEFORE the thing it introduces. */}
      {heading && (
        <div className="head">
          <h3>{heading}</h3>
          <p className="meta">
            <time dateTime={item.published_at ?? undefined}>
              {when(item.published_at)}
            </time>
            {item.account.handle && <span>@{item.account.handle}</span>}
          </p>
        </div>
      )}

      {/* ONE picture at a time here, filling the card in at least one
          dimension. A post is about ITS photograph, and three abreast in
          a 704px card makes all three small. */}
      <PhotoGallery media={item.media} perView={1} />

      <div className="body">
        {/* Captions are plain text and rendered as such — deliberately
            NOT through the Markdown renderer. They come from social
            posts, and a stray underscore in a hashtag should not turn
            half a caption into italics. */}
        <p className="text">{text}</p>
        {long && (
          <button className="more" onClick={() => setOpen(!open)}>
            {open ? "weniger anzeigen" : "weiterlesen"}
          </button>
        )}
        {/* The date and the account moved UP into the head with the
            heading — a post's byline belongs with its title, not
            stranded at the foot of the card. Rendered here only when
            there is no heading to carry them. */}
        {!heading && (
          <p className="meta">
            <time dateTime={item.published_at ?? undefined}>
              {when(item.published_at)}
            </time>
            {item.account.handle && <span>@{item.account.handle}</span>}
          </p>
        )}
      </div>
    </article>
  );
}

/** The front page: the film, then what the club has published.
 *
 *  NOTE THE SHAPE — the hero is a SIBLING of <main>, not a child of it.
 *  That is the whole fix for the horizontal scrollbars: a top-level
 *  element is the width of the page for nothing, where the previous
 *  version reached out of the centred column with `width: 100vw`, which
 *  includes the vertical scrollbar and is therefore always about fifteen
 *  pixels too wide. It is also why this hero and Impressionen's now
 *  behave identically: neither depends on the box it happens to sit in. */
function Feed({ site }: { site: Site | null }) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .feed()
      .then((r) => setItems(r.items))
      .catch(() => setFailed(true));
  }, []);

  return (
    <>
      {/* THE CLUB'S NAME IS NOT REPEATED HERE. It is in the header,
          which is sticky and therefore on screen at every scroll
          position — printing it again immediately underneath, at three
          times the size, said the same thing twice and made the hero
          shout. The tagline carries the page's one h1. */}
      <Hero
        title={site?.tagline || site?.title || "RC-Modellflug in Stutensee"}
        video="/vfm-hero.mp4"
        poster="/vfm-hero.jpg"
      />
      <main>
        <section className="feed">
          <h2>Aktuelles</h2>

          {/* THREE STATES, AND THEY ARE DIFFERENT. "still loading",
              "nothing to show" and "it broke" say different things to a
              visitor, and collapsing them into one empty page is how a
              failure gets mistaken for a quiet club. */}
          {failed && (
            <p className="empty">
              Die Beiträge lassen sich gerade nicht laden. Bitte versuchen
              Sie es später noch einmal.
            </p>
          )}
          {!failed && items === null && <p className="empty">Lädt…</p>}
          {!failed && items !== null && items.length === 0 && (
            <p className="empty">Hier erscheinen bald unsere Beiträge.</p>
          )}
          {items?.map((item) => (
            <Post key={item.id} item={item} />
          ))}
        </section>
      </main>
    </>
  );
}

/** Impressionen — every picture the club has published.
 *
 *  THE SAME PARTS AS THE FRONT PAGE, and that is the point: the same
 *  <Hero> and the same <PhotoGallery>, given a different picture and the
 *  whole window instead of a card. There were briefly two of each,
 *  drifting into different sizes and different behaviour, which is how a
 *  site stops looking like one site.
 *
 *  Both of them are top-level, for the reason written above Feed. The
 *  only thing that differs from a post is `perView`, which is "auto"
 *  here — so as many pictures stand side by side as fit. */
function GalleryPage({ title }: { title: string }) {
  const [images, setImages] = useState<FeedMedia[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .gallery()
      .then((r) => setImages(r.images))
      .catch(() => setFailed(true));
  }, []);

  return (
    <>
      {/* The club's own photograph — members watching something fly,
          which is what this page is about — cut down to thirty pixels
          above the first hat so the frame opens on the people rather
          than on empty sky. Vendored into our own assets rather than
          linked from where it was found. */}
      <Hero title={title} image="/impressionen-hero.jpg" />

      {/* THREE STATES, AND THEY SAY DIFFERENT THINGS. */}
      {(failed || images === null || images.length === 0) && (
        <main>
          {failed && (
            <p className="empty">
              Die Bilder lassen sich gerade nicht laden. Bitte versuchen Sie
              es später noch einmal.
            </p>
          )}
          {!failed && images === null && <p className="empty">Lädt…</p>}
          {!failed && images !== null && images.length === 0 && (
            <p className="empty">Hier erscheinen bald unsere Bilder.</p>
          )}
        </main>
      )}

      {images && images.length > 0 && (
        <section className="gallery">
          <PhotoGallery media={images} />
        </section>
      )}
    </>
  );
}

function StaticPage({ site }: { site: Site | null }) {
  const { slug = "" } = useParams();
  const [page, setPage] = useState<PageContent | null>(null);
  const [missing, setMissing] = useState(false);

  // WHICH KIND OF PAGE THIS IS COMES FROM THE CONFIGURATION, carried on
  // the nav entry — so adding a gallery is a config change and a
  // restart rather than a new route compiled into this bundle.
  const entry = [...(site?.nav ?? []), ...(site?.footer ?? [])].find(
    (l) => l.slug === slug,
  );
  const isGallery = entry?.kind === "gallery";

  useEffect(() => {
    setPage(null);
    setMissing(false);
    // A gallery has no Markdown to fetch; asking for it would 404 and
    // render "Seite nicht gefunden" over a perfectly good wall.
    if (!isGallery) {
      api
        .page(slug)
        .then(setPage)
        .catch(() => setMissing(true));
    }
    window.scrollTo(0, 0);
  }, [slug, isGallery]);

  if (isGallery) {
    return <GalleryPage title={entry?.title ?? "Impressionen"} />;
  }

  // PLATZ UND ANFAHRT GETS A MAP AND THE CLUB'S OWN SKETCH.
  //
  // It was prose and a Google link, with no picture at all — "Platz und
  // Anfahrt still has no images, no OSM, nothing." The map cannot live in
  // the Markdown, because Markdown renders to HTML and a Leaflet map is a
  // component that has to be given an element and torn down again. So the
  // page keeps its prose from the backend and this is appended to it.
  const withAnfahrt = slug === "platz";

  // AND KONTAKT GETS THE CALLING CARDS, for the same reason and by the
  // same route: Markdown renders to HTML, and three cards with icons and
  // mailto links are a component. Not lazy-loaded the way Anfahrt is —
  // that defers 150 kB of Leaflet, and this is two icons out of a
  // package the bubble already pulls in.
  const withKarten = slug === "kontakt";

  return (
    <main>
      <section className="page">
        {missing ? (
          <div className="prose">
            <h1>Seite nicht gefunden</h1>
            <p>
              Diese Seite gibt es nicht (mehr).{" "}
              <Link to="/">Zur Startseite</Link>
            </p>
          </div>
        ) : !page ? (
          <div className="prose">
            <p>Lädt…</p>
          </div>
        ) : (
          /* THE MARKDOWN IS OURS. These files are committed to this
             repository and rendered by the backend from disk — they are
             never user input, so there is no injection path here. If a
             page ever becomes editable by a member, this line needs
             sanitising and this comment needs deleting. */
          <div
            className="prose"
            dangerouslySetInnerHTML={{
              __html: marked.parse(page.body) as string,
            }}
          />
        )}
        {withAnfahrt && page && (
          <Suspense fallback={<p className="empty">Karte lädt…</p>}>
            <Anfahrt />
          </Suspense>
        )}
        {withKarten && page && <Visitenkarten />}
      </section>
    </main>
  );
}

function Shell({ site }: { site: Site | null }) {
  const [open, setOpen] = useState(false);
  const head = useRef<HTMLElement>(null);

  /** LIGHT OR DARK, and the answer is already on the page.
   *
   *  index.html resolves it before the first paint and writes it onto
   *  <html>, so this reads that rather than deciding again — two places
   *  deciding the same thing is how the button ends up disagreeing with
   *  what is on screen. */
  const [dark, setDark] = useState(
    () => document.documentElement.dataset.theme === "dark",
  );

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    // The colour a phone paints its own chrome with. Left alone it keeps
    // the light value and puts a pale bar above a dark page.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#0d151d" : "#ffffff");
  }, [dark]);

  /** NOTHING IS WRITTEN DOWN UNTIL SOMEBODY PRESSES THE BUTTON.
   *
   *  Saving on mount instead would look identical and quietly destroy
   *  the next behaviour: a visitor who has never chosen would then have
   *  a stored preference anyway, and the site would stop following
   *  their system when it switches at sunset. Only a deliberate press
   *  is a choice. */
  const flip = () => {
    setDark((was) => {
      const next = !was;
      try {
        localStorage.setItem("vfm-theme", next ? "dark" : "light");
      } catch {
        /* Storage refused — the switch still works for this visit, it
           simply will not be remembered. Not worth telling anybody. */
      }
      return next;
    });
  };

  /** FOLLOW THE SYSTEM, UNTIL TOLD OTHERWISE. Somebody whose phone goes
   *  dark in the evening should see this page go dark with everything
   *  else — but never over the top of a choice they made by hand. */
  useEffect(() => {
    const ask = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = (e: MediaQueryListEvent) => {
      let chosen: string | null = null;
      try {
        chosen = localStorage.getItem("vfm-theme");
      } catch {
        chosen = null;
      }
      if (!chosen) setDark(e.matches);
    };
    ask.addEventListener("change", follow);
    return () => ask.removeEventListener("change", follow);
  }, []);

  /** HOW TALL THE HEADER IS, measured rather than assumed, and published
   *  as --header-h for the hero to hang beneath.
   *
   *  The hero is position: fixed at the top of the window, and the header
   *  is sticky and paints OVER it — so the hero's first 56 pixels were
   *  hidden behind the header on every page. Invisible at 300px and
   *  glaring at 100: "the 100px there are counted against the header, not
   *  top of screen." Correct, and the arithmetic should not be a constant
   *  somebody has to remember to keep in step with the header's padding.
   *
   *  NOT MEASURED WHILE THE MENU IS OPEN. On a phone the burger expands
   *  the header to the height of the whole nav, and pinning the hero
   *  below THAT would shove it off the screen while somebody is choosing
   *  a page. The collapsed height is the one that matters. */
  useEffect(() => {
    const measure = () => {
      const el = head.current;
      if (!el || open) return;
      document.documentElement.style.setProperty(
        "--header-h", `${Math.round(el.getBoundingClientRect().height)}px`);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open]);

  return (
    <>
      {/* The airfield, behind everything, panning as you scroll. Fixed
          and pointer-events: none, so it is scenery and nothing else. */}
      <Backdrop />

      <header className="top" ref={head}>
        <div className="topinner">
          <Link className="brand" to="/" onClick={() => setOpen(false)}>
            {site?.title ?? "VFM Stutensee"}
          </Link>
          {/* LIGHT OR DARK. Outside the nav on purpose — the nav folds
              behind the burger on a phone, and a reading-comfort control
              you have to open a menu to reach is one nobody finds.

              aria-pressed, so a screen reader announces it as the toggle
              it is rather than as a button that might do anything. The
              GLYPH shows the state (sun = this page is light) and the
              accessible name states the action, which is the rule the
              members' role controls already follow. */}
          <button
            className="design"
            type="button"
            aria-pressed={dark}
            title={
              dark ? "Helles Design einschalten" : "Dunkles Design einschalten"
            }
            aria-label={
              dark ? "Helles Design einschalten" : "Dunkles Design einschalten"
            }
            onClick={flip}
          >
            {dark ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
          </button>

          {/* A real <button>, not a styled div: it must be reachable and
              operable from a keyboard, and aria-expanded is what tells a
              screen reader whether the menu is currently open. */}
          <button
            className="burger"
            aria-expanded={open}
            aria-label="Menü"
            onClick={() => setOpen(!open)}
          >
            ☰
          </button>
          <nav className={open ? "open" : ""}>
            {(site?.nav ?? []).map((l) => (
              <Link
                key={l.slug}
                to={`/${l.slug}`}
                onClick={() => setOpen(false)}
              >
                {l.title}
              </Link>
            ))}
            {/* THE WAY IN, and it has to be here rather than in the
                config-driven list above.

                This used to carry a comment saying the members area was
                "reachable by address until the club decides to link
                it", which was a decision dressed up as a principle: a
                sign-in page you can only reach by being told its URL is
                not a sign-in page. Asked how to sign in, the only
                honest answer was to quote a path.

                It cannot come from /api/site like the others, because
                those are Markdown pages fetched by slug and this is a
                browser-side route with no /api/page behind it — putting
                it in that list would render "Seite nicht gefunden". */}
            <Link
              className="anmelden"
              to="/mitglieder"
              onClick={() => setOpen(false)}
            >
              Mitglieder
            </Link>
          </nav>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<Feed site={site} />} />
        {/* THE MEMBERS AREA AND ITS TWO SUBPAGES.
 
            Not built from /api/site like the others: those are Markdown
            pages fetched by slug, and these are browser-side routes with
            no /api/page behind them. Putting them in that list would
            render "Seite nicht gefunden".

            ONE COMPONENT, THREE ADDRESSES. Members reads :unterseite and
            renders the overview, the enquiries console or the user
            administration — because all three need the same answer to
            "who is this", and three routes fetching /api/me separately
            would ask three times and could disagree.

            THE ADDRESSES ARE REAL, which is the point of doing it with
            routes rather than a tab: /mitglieder/anfragen can be
            bookmarked, reloaded, and sent to the other person who holds
            the role. What it CANNOT do is grant anything — the role is
            checked here to decide what to draw, and again on the server
            for every request, which is the check that counts. */}
        <Route path="/mitglieder" element={<Members />} />
        <Route path="/mitglieder/:unterseite" element={<Members />} />
        <Route path="/:slug" element={<StaticPage site={site} />} />
      </Routes>

      <Dock site={site} />

      {/* THE CONTACT BUBBLE, on every page, at the top level like the
          hero and the backdrop. It sits above the dock and BELOW the
          full-screen gallery viewer — which needs no coordination at
          all, only a z-index between the two, so opening a photograph
          covers it rather than leaving a button floating over somebody's
          picture. */}
      <ContactBubble />
    </>
  );
}

/** The footer, always there and ALWAYS THE SAME SIZE.
 *
 *  A slim bar pinned to the bottom. It used to open out when you reached
 *  the end of the page; the shepherd's instruction is "make the footer
 *  always the slim size", so the whole expanding apparatus is gone — the
 *  state, the scroll listener, the resize listener and the second set of
 *  sizes. It measured the document's height on every scroll, which is
 *  exactly the sort of thing that has been making short pages behave
 *  oddly, and it is no loss.
 *
 *  §5 TMG wants the Impressum reachable within two clicks from every
 *  page. Pinned, it is reachable from every SCROLL POSITION of every
 *  page — which is a stronger promise and costs 46 pixels. */
function Dock({ site }: { site: Site | null }) {
  return (
    <footer className="dock">
      <div className="footinner">
        <nav>
          {(site?.footer ?? []).map((l) => (
            <Link key={l.slug} to={`/${l.slug}`}>
              {l.title}
            </Link>
          ))}
        </nav>
        <p>
          © {new Date().getFullYear()} {site?.title ?? "VFM Stutensee"}
        </p>
      </div>
    </footer>
  );
}

export default function App() {
  const [site, setSite] = useState<Site | null>(null);

  useEffect(() => {
    api.site().then((s) => {
      setSite(s);
      // The language of the document decides how a screen reader
      // PRONOUNCES it. Set from the configuration rather than
      // hard-coded, so a second deployment in another language does not
      // announce itself in German.
      if (s.locale) document.documentElement.lang = s.locale;
      if (s.title) document.title = s.title;
    });
  }, []);

  return (
    <BrowserRouter>
      <Shell site={site} />
    </BrowserRouter>
  );
}

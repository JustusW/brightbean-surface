import { useEffect, useRef, useState } from "react";
import {
  Link,
  Route,
  BrowserRouter,
  Routes,
  useParams,
} from "react-router-dom";
import { marked } from "marked";
import Carousel from "./Carousel";
import { api, type FeedItem, type PageContent, type Site } from "./api";

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

      <Carousel media={item.media} />

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

/** The hero: the club's own film, with a play button in front of it.
 *
 *  MADE BY THE CLUB'S 1. VORSITZENDER, and used as it is — not
 *  re-encoded, not shortened, not muted into a decorative loop behind
 *  text. It is somebody's work, so it gets played rather than used as
 *  wallpaper.
 *
 *  CLICK TO PLAY, AND THE BUTTON WAITS UNTIL IT CAN ACTUALLY PLAY. A
 *  play control that is pressable before the video is ready gives you a
 *  frozen frame and no explanation; this one says it is loading and
 *  becomes pressable at `canplaythrough`, so pressing it always does
 *  what it looks like it will do.
 *
 *  The poster frame is a still from the film itself, so the hero is
 *  never empty while 15 MB arrives. */
function Hero({ site }: { site: Site | null }) {
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);

  const start = () => {
    const el = video.current;
    if (!el) return;
    // play() returns a promise that REJECTS if the browser refuses —
    // which it does, with sound, in more situations than the spec makes
    // obvious. Swallowing it silently would leave the overlay gone and
    // nothing playing, so the overlay only goes once playback started.
    el.play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  };

  return (
    <section className={playing ? "hero playing" : "hero"}>
      <video
        ref={video}
        className="film"
        src="/vfm-hero.mp4"
        poster="/vfm-hero.jpg"
        // Eager: the shepherd's call, and the reason the button can
        // promise to work when it lights up.
        preload="auto"
        // playsInline stops iOS taking the video fullscreen on play,
        // which would throw the visitor out of the page entirely.
        playsInline
        controls={playing}
        onCanPlayThrough={() => setReady(true)}
        onEnded={() => setPlaying(false)}
      />

      <div className="scrim" aria-hidden={playing} />

      {!playing && (
        <div className="heroinner">
          <h1>{site?.title ?? "Verein für Modellflug Stutensee"}</h1>
          {site?.tagline && <p className="tagline">{site.tagline}</p>}

          <button
            className="play"
            onClick={start}
            disabled={!ready}
            aria-label={
              ready ? "Video abspielen" : "Video wird geladen"
            }
          >
            <span className="glyph" aria-hidden="true">
              {ready ? "▶" : "…"}
            </span>
            <span>{ready ? "Film ansehen" : "Lädt…"}</span>
          </button>
        </div>
      )}
    </section>
  );
}

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
      <Hero site={site} />
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

function StaticPage() {
  const { slug = "" } = useParams();
  const [page, setPage] = useState<PageContent | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setPage(null);
    setMissing(false);
    api
      .page(slug)
      .then(setPage)
      .catch(() => setMissing(true));
    window.scrollTo(0, 0);
  }, [slug]);

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
      </section>
    </main>
  );
}

function Shell({ site }: { site: Site | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <header className="top">
        <div className="topinner">
          <Link className="brand" to="/" onClick={() => setOpen(false)}>
            {site?.title ?? "VFM Stutensee"}
          </Link>
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
          </nav>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<Feed site={site} />} />
        <Route path="/:slug" element={<StaticPage />} />
      </Routes>

      <Dock site={site} />
    </>
  );
}

/** The footer, always there.
 *
 *  A SLIM BAR PINNED TO THE BOTTOM that opens out when you reach the end
 *  of the page. Two reasons beyond looking better than a slab of dark
 *  blue you only meet after scrolling:
 *
 *  §5 TMG wants the Impressum reachable within two clicks from every
 *  page. Pinned, it is reachable from every SCROLL POSITION of every
 *  page — which is a stronger promise and costs 46 pixels.
 *
 *  And the links are in the DOM identically in both states: collapsing
 *  is padding and type size, never removing a control. A footer that
 *  hid its legal links until you scrolled would satisfy the letter of
 *  the requirement and defeat its point. */
function Dock({ site }: { site: Site | null }) {
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    const check = () => {
      const doc = document.documentElement;

      // A PAGE WITH NOTHING TO SCROLL HAS NO BOTTOM TO REACH, and this
      // is the bug that shipped: on first load the feed has not arrived,
      // the page is shorter than the window, so "you are at the end" was
      // trivially true and the footer opened tall before the visitor had
      // seen anything. Asking whether the page is scrollable AT ALL
      // first is the whole fix.
      const scrollable = doc.scrollHeight > window.innerHeight + 4;

      // 24px of slack: a page height that is a fraction of a pixel out —
      // which happens constantly as images settle — would otherwise
      // never quite register as the bottom, and the footer would refuse
      // to open for reasons nobody could see.
      const bottom =
        window.innerHeight + window.scrollY >= doc.scrollHeight - 24;

      setAtEnd(scrollable && bottom);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  });

  return (
    <footer className={atEnd ? "dock open" : "dock"}>
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

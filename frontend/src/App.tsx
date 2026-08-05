import { useEffect, useState } from "react";
import {
  Link,
  Route,
  BrowserRouter,
  Routes,
  useParams,
} from "react-router-dom";
import { marked } from "marked";
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

function Post({ item }: { item: FeedItem }) {
  const images = item.media.filter((m) => m.kind !== "video");
  const [open, setOpen] = useState(false);
  const long = item.text.length > 320;
  const text = open || !long ? item.text : item.text.slice(0, 320) + "…";

  return (
    <article className="post">
      {images.length > 0 && (
        <div className={`shots n${Math.min(images.length, 4)}`}>
          {images.map((m, i) => (
            <img
              key={i}
              src={m.url}
              /* ALT TEXT COMES FROM THE MEDIA LIBRARY where somebody
                 wrote one. An empty alt is correct for a decorative
                 image and far better than inventing a description of a
                 photograph nobody here has seen. */
              alt={m.alt}
              loading="lazy"
              decoding="async"
              width={m.width || undefined}
              height={m.height || undefined}
            />
          ))}
        </div>
      )}

      <div className="body">
        {item.title && <h3>{item.title}</h3>}
        {/* Captions are plain text and rendered as such - deliberately
            NOT through the Markdown renderer. They come from social
            posts, and a stray underscore in a hashtag should not turn
            half a caption into italics. */}
        <p className="text">{text}</p>
        {long && (
          <button className="more" onClick={() => setOpen(!open)}>
            {open ? "weniger" : "weiterlesen"}
          </button>
        )}
        <p className="meta">
          <time dateTime={item.published_at ?? undefined}>
            {when(item.published_at)}
          </time>
          {item.account.handle && <span> · @{item.account.handle}</span>}
        </p>
      </div>
    </article>
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
      <section className="hero">
        <h1>{site?.title ?? "Verein für Modellflug Stutensee"}</h1>
        {site?.tagline && <p className="tagline">{site.tagline}</p>}
      </section>

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
  }, [slug]);

  if (missing) {
    return (
      <section className="page">
        <h1>Seite nicht gefunden</h1>
        <p>
          Diese Seite gibt es nicht (mehr). <Link to="/">Zur Startseite</Link>
        </p>
      </section>
    );
  }
  if (!page) return <section className="page">Lädt…</section>;

  return (
    <section className="page">
      {/* THE MARKDOWN IS OURS. These files are committed to this
          repository and rendered by the backend from disk - they are
          never user input, so there is no injection path here. If a page
          ever becomes editable by a member, this line needs sanitising
          and this comment needs deleting. */}
      <div
        className="prose"
        dangerouslySetInnerHTML={{ __html: marked.parse(page.body) as string }}
      />
    </section>
  );
}

function Shell({ site }: { site: Site | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <header className="top">
        <Link className="brand" to="/" onClick={() => setOpen(false)}>
          {site?.title ?? "VFM Stutensee"}
        </Link>
        {/* A real <button>, not a styled div: it has to be reachable and
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
            <Link key={l.slug} to={`/${l.slug}`} onClick={() => setOpen(false)}>
              {l.title}
            </Link>
          ))}
        </nav>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<Feed site={site} />} />
          <Route path="/:slug" element={<StaticPage />} />
        </Routes>
      </main>

      <footer>
        {/* Impressum, Datenschutz and AGB live here rather than in the
            main navigation because §5 TMG requires them reachable within
            two clicks from EVERY page - a footer is the only place that
            is true of. */}
        <nav>
          {(site?.footer ?? []).map((l) => (
            <Link key={l.slug} to={`/${l.slug}`}>
              {l.title}
            </Link>
          ))}
        </nav>
        <p>© {new Date().getFullYear()} {site?.title ?? "VFM Stutensee"}</p>
      </footer>
    </>
  );
}

export default function App() {
  const [site, setSite] = useState<Site | null>(null);

  useEffect(() => {
    api.site().then((s) => {
      setSite(s);
      // The language of the document decides how a screen reader
      // PRONOUNCES it. It is set from the configuration rather than
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

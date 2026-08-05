# Requirements, and what is currently implemented

The requirements below are the shepherd's, extracted verbatim from the
console record. **Do not edit them** — they are the specification, and
rewording a requirement to match what got built is how a specification
stops being one.

Everything after them describes the tree **as it now stands**, and is
maintained. It was materially false for a while: it described a
`Gallery.tsx` that had been deleted, called two built components
unbuilt, and said the backdrop was not wired in.

---

## The combined requirements

**Site-wide**
- Vite/React SPA + FastAPI over Brightbean's DB, read-only; one config file decides what is shown.
- Served under `preview.modellflug-stutensee.de` via nginx.
- No CDNs — vendor everything. A visitor's browser contacts this origin and the club's media host, nothing else.
- Store nothing that is not technically required.
- SQLAlchemy with *generated* migrations.
- Commit and deploy continuously so it can be watched; `#autoreload`.
- Good modern font everywhere; the headline must not look like default WordPress bold.
- Faint height-dependent background gradient — pure white is garbage.
- No horizontal scrollbars.
- Members area: signup **and** Google sign-in, both.

**Hero — one implementation, every page**
- Front page: the chairman's film, used as-is. No play button; starts on a click anywhere in it or three seconds of hover.
- Club name appears once, not dominant, integrated into the picture: shadow on the individual letters, letters slightly transparent.
- Starts **twice** its resting height, shrinking to it as you scroll.
- **Fixed** against scrolling — `position: fixed`, the CSS keyword. "I specifically did NOT use static. because that would have been wrong."
- 600 shrinking to 150 on desktop, 400 shrinking to 100 on a phone, and the small height is counted against the **header**, not the top of the screen.
- Impressionen: the club photo of members watching, cropped to ~30px above the first hat, showing whatever fits.

**Gallery — one component, both places**
- It **is** a gallery on the page, with its own controls — not a flat display that opens one on click.
- A proper plugin, not hand-written. One package; remove any others.
- Zoom, navigable *while* zoomed — plus a full-screen zoomed navigable view.
- Over an out-of-focus copy of the current picture.
- Front page: one image visible, filling at least one dimension, ~700-something tall, stepping picture by picture — the arrows must not jump end to end.
- Impressionen: full window width, as many images side by side as fit, same height.
- Horizontal growth only, never vertical.
- Never crop a poster.

**Feed**
- Front page shows what is currently published on VFM's Instagram (that account only).
- Title from the first few words of the post, above the gallery, by a generic rule — no per-word special-casing.
- Footer permanently present, **always the slim size**.
- Centre column at least 900.

**Pages**
- Nav: Platz und Anfahrt, Mitgliedschaft, Impressionen, Kontakt. Footer: Impressum, Datenschutz, Rechtliches.
- Datenschutzerklärung used **verbatim** — may be styled, nothing changed, with the single exception of the mail address.
- Platz und Anfahrt gets a real map, built properly with OSM and easy to use, unlike the one on the original WordPress. "It is already picked exactly like that. No dithering" — the Datenschutzerklärung already names OpenStreetMap, so the decision is made.

**The old site**
- Scrape it all, keeping as good a correlation of text and image as possible, and assess case by case.
- Backport the posts into Brightbean while making sure they are **never** posted to Instagram.

---

## What changed since the first version of this document

| Then | Now |
|---|---|
| `Gallery.tsx` held the Impressionen page | Deleted. Pages live in `App.tsx`, which is where the feed and the static pages already were. |
| The hero was held against scrolling by a per-frame `--pan` translate | `position: fixed`. The word was always a CSS keyword and was read as a metaphor for five attempts. `--pan` is deleted, not tuned. |
| Coverflow, with a 3D transform | Removed on instruction — "the transformation flickers". It also took a whole class of defect with it: the transform moved a slide's **hit box** away from where it was drawn, which is what stopped pictures two and three opening. |
| `field-backdrop.jpg` referenced by nothing | `Backdrop.tsx`, mounted once for the whole site, panning 560px on scroll, gaussian baked at 2. |
| `Members.tsx` not built | Built, **and its backend exists**: `/api/auth/*`, password and Google inclusively, with admins, a registrations board and account deletion. Live, and signed into with a real Google account. |
| No map anywhere | `Anfahrt.tsx`: Leaflet through npm, lazy-loaded, plus the club's own Anfahrtsskizze vendored. |
| The old WordPress not touched | Scraped, judged and imported. 20 feed items and 45 gallery pictures live. |
| The OAuth flow hand-rolled *around* authlib | Deleted rather than repaired, on instruction, and rebuilt on `authorize_redirect` / `authorize_access_token` with nothing of ours between them. Written against `notes/authlib-client-api.txt` — 79 kB of the library's own documentation, read first. PKCE is on. |
| Dependencies pinned exactly, at versions 18 months old | `>=` floors read off PyPI. An exact pin on a public endpoint is a decision to keep running known-vulnerable code until somebody remembers to edit a file, and nobody was going to. |
| Three Alembic revisions existing only on the server | Brought home and verified as one chain by reading `down_revision`: `a5801cef0ec3` → `dbc9ad33aa51` → `1586cb2b805f`. Still generated, never handwritten. |
| A `Rechtliches` page of AGB boilerplate | Gone — "the AGB are out, they simply are meaningless for our usecase. the DSE is all we really need". The Impressum and the Datenschutzerklärung, which *are* required, stay. |
| Nothing tested end to end | `notes/e2e_stack.py`: a throwaway PostgreSQL from `initdb`, the real app, the real migrations, a real browser. 9 assertions, ~45 s, nothing left behind. **Members flow only.** |

---

## The current frontend tree

```
brightbean-surface/frontend/
├── index.html
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
├── public/
│   ├── vfm-hero.mp4            15.7 MB, the chairman's film, as-is
│   ├── vfm-hero.jpg            its own first frame, as the poster
│   ├── impressionen-hero.jpg   the members photo, cropped 194px off the top
│   ├── field-backdrop.jpg      the panorama, downscaled and blurred at build time
│   └── anfahrtskizze.jpg       the club's own hand-drawn approach map
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── Backdrop.tsx
    ├── Hero.tsx
    ├── PhotoGallery.tsx
    ├── Anfahrt.tsx
    ├── Members.tsx
    ├── api.ts
    ├── autoreload.ts
    └── index.css
```

| File | What belongs in it |
|---|---|
| `index.html` | The shell: `lang`, charset, viewport, the title used before the first API answer, `#root`. The real title and `lang` are set at runtime from `/api/site`. No third-party `<link>` — that would break the single-origin rule outright. |
| `package.json` / lock | react, react-router-dom, marked, swiper, leaflet, and the two self-hosted font packages. Everything is bundled by Vite into our own assets; nothing is fetched at run time. |
| `vite.config.ts` | Build config and the dev proxy to `127.0.0.1:8082`, so development has the same single origin production does. `chunkSizeWarningLimit: 400` — this is read on a rural mobile connection, and the limit is there to be obeyed rather than raised. |
| `public/vfm-hero.mp4/.jpg` | The film and its poster frame. **Used as is** — not re-encoded, not trimmed. `preload="auto"` on 15.7 MB means the network on that page never goes idle, which is why every Playwright probe here waits for `load` and never `networkidle`. |
| `public/impressionen-hero.jpg` | 1600×1006, cut 194px from the top — thirty pixels above the first hat, whose brim is at y=224. `notes/crop_hero.py` holds the arithmetic. |
| `public/field-backdrop.jpg` | 1800×379, gaussian **2**, 26 kB. Blurred at build time because a CSS filter on a full-window image is recomposited on every frame it pans. `notes/bake_backdrop.py`. |
| `public/anfahrtskizze.jpg` | The club's own drawing, vendored rather than hotlinked from a WordPress that is going away. `notes/fetch_anfahrt.py`. |
| `src/main.tsx` | Boot: mounts `App`, imports the two font families once, arms `#autoreload`. |
| `src/App.tsx` | Routing and page furniture — the sticky header (which measures itself into `--header-h`), `Feed`, `Post`, `StaticPage`, the Impressionen page, and `Dock`. **The hero and the full-width gallery are rendered OUTSIDE `<main>`**, at the top level: that is the structural fix for the horizontal scrollbars, because `100vw` includes the scrollbar and any element sized with it is about fifteen pixels too wide. |
| `src/Backdrop.tsx` | The airfield behind the whole site, fixed, `pointer-events: none`, panning 560px **sideways** as a fraction of the whole document — so the far edge is reached at the foot of the page whatever the page's length. |
| `src/Hero.tsx` | **The** hero. `position: fixed` inside a constant-height `.heroslot`, so the document's height cannot depend on it and the scroll-clamp feedback loop is gone by construction. Writes one number, `--grow`. Hangs at `top: var(--header-h)` because a sticky header paints over a lower-z-index fixed element. |
| `src/PhotoGallery.tsx` | **The** gallery, two layers, one package. Inline on the page with arrows, pagination, keyboard and drag over a blurred copy of the current picture; full-screen for the zoom, because Swiper zooms *inside* a slide and a slide on a post card is 432px. |
| `src/Anfahrt.tsx` | The OSM map. Leaflet via npm, **never a CDN**, lazy-loaded via `React.lazy` so 150 kB stays out of the main bundle. Its marker icons are imported as modules — `L.Icon.Default` computes them from its stylesheet's location at runtime, which a bundler breaks. |
| `src/Members.tsx` | Sign up, sign in, Google, the welcome page, and — for an admin only — the registrations board: approve, revoke, and a two-stage delete whose second button says what it does. Holds no token: the session is a row in our own database and the cookie carries only its id. Rendering the board is a convenience, not a control; every admin endpoint checks the column again server-side, because a flag the browser holds is a flag the browser can edit. |
| `src/api.ts` | Every backend call and the shape of every answer, in one file, so a contract change breaks compilation instead of a page. |
| `src/autoreload.ts` | `#autoreload` only, inert without it. Compares the hashed bundle filename the page is running against the one the server is serving. |
| `src/index.css` | All styling, with the reasoning beside anything non-obvious. `--grow`, `--chrome`, `--header-h`, the hero's heights, the gallery's sizing, the prose measure the Datenschutzerklärung needs. |

## What is measured, and how

`notes/probe_hero.py` reports horizontal overflow and the hero's height
at rest and scrolled, in **four** browsers: ordinary, reduced-motion, a
short window and a phone. The reduced-motion pass exists because a
`prefers-reduced-motion` early return silently disabled the hero and the
backdrop for days while an ordinary browser measured them working.

`notes/probe_zoom.py` hit-tests with `elementFromPoint` — which is what
finally identified the coverflow hit-box defect after four wrong
hypotheses, each of which cost a deploy.

`notes/probe_anfahrt.py` reads the map marker's `naturalWidth` and counts
failed requests. A broken image is neither a type error nor a build
error, so nothing else catches it.

`notes/e2e_stack.py` stands the whole thing up from nothing: `initdb` a
throwaway PostgreSQL cluster on a free port, run the real Alembic
migrations against it, serve the real application, drive it with a real
browser through `notes/e2e_members.py`, and tear all of it down. 45.6 s,
9 passed, 0 failed, nothing left behind.

**It uses the PostgreSQL already installed on the machine, and there is
no container anywhere in it.** An earlier version was a Docker compose
and nearly got built on the shepherd's own PC unasked; it was deleted
entirely.

Three rules came out of that harness the hard way, and they are written
into it beside the code they govern:

- **Run it piecewise.** Nine steps executed at once cannot tell you
  which one hung, and four separate Windows defects fell out in minutes
  once each layer was probed on its own.
- **Probes are seconds, not minutes.** A long blocking call you are
  attached to is time spent blind while somebody waits.
- **Point the test at something that should FAIL.** Running
  `e2e_members.py` against the old WordPress site is what exposed a
  false pass: Playwright matches accessible names by *substring*, so
  "Mitglieder" matched WordPress's "Mitgliederbereich" and
  `"/mitglieder" in url` matched `/mitgliederbereich/`. Fixed with
  `exact=True` and a parsed path comparison. A test that has only ever
  passed is a claim, not evidence.

**An end-to-end test must never write to production.** It did, three
times, and the board's own registrations list showed the leaked accounts
to the shepherd before anybody else noticed. `e2e_members.py` now
refuses the live site unless `E2E_WRITE_LIVE=yes` is set deliberately,
and `members.py purge` removes `@example.invalid` accounts and nothing
else.

## Not done

- **The surface can send no email at all**, and that blocks two separate
  things. `email_verified` is never set for a password signup, so
  somebody can register an address they do not own — mitigated only by
  the board approving every account by hand. And there is no password
  reset: a member who forgets is stuck, and `members.py` cannot set one
  either. The server has msmtp for system mail; this container has
  nothing.
- **No rate limiting on `/api/auth/login`.** argon2 makes each attempt
  expensive, which is the point against a guesser and also a cheap way
  for one to burn the server's CPU.
- **There is nothing behind the door.** An approved member signs in and
  reads a welcome message. Nobody has yet said what the internal area
  should actually hold.
- **`/api/gallery` reports width 0 height 0**, because Brightbean never
  populated those columns. Nothing in the layout may depend on knowing a
  picture's size in advance, and nothing does.
- **The end-to-end stack covers the members flow only.** Nothing covers
  the feed, the gallery, the Anfahrt map or the WordPress import.

# Requirements, and what is currently implemented

Extracted verbatim from the console record.

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
- Fixed against scrolling.
- Impressionen: the club photo of members watching, cropped to ~30px above the first hat, showing whatever fits.

**Gallery — one component, both places**
- It **is** a gallery on the page, with its own controls — not a flat display that opens one on click.
- A proper plugin, not hand-written. One package; remove any others.
- Zoom, navigable *while* zoomed — plus a full-screen zoomed navigable view.
- Coverflow effect, over an out-of-focus copy of the current picture.
- Front page: one image visible, filling at least one dimension, ~700-something tall, stepping picture by picture — the arrows must not jump end to end.
- Impressionen: full window width, as many images side by side as fit, same height.
- Horizontal growth only, never vertical.
- Never crop a poster.

**Feed**
- Front page shows what is currently published on VFM's Instagram (that account only).
- Title from the first few words of the post, above the gallery, by a generic rule — no per-word special-casing.
- Footer permanently present, flat until it expands at the bottom.

**Pages**
- Nav: Platz und Anfahrt, Mitgliedschaft, Impressionen, Kontakt. Footer: Impressum, Datenschutz, Rechtliches.
- Datenschutzerklärung used **verbatim** — may be styled, nothing changed, with the single exception of the mail address.

**Outstanding, not built**
- The ultrawide field panorama as a strongly blurred, transparent backdrop panning on scroll (image fetched and baked, not yet wired in).
- Scrape the old site and backport its posts into Brightbean, never publishable to Instagram.

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
│   ├── vfm-hero.mp4            15.7 MB
│   ├── vfm-hero.jpg            56 KB
│   ├── impressionen-hero.jpg   300 KB
│   └── field-backdrop.jpg      13.6 KB
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── Hero.tsx
    ├── PhotoGallery.tsx
    ├── Gallery.tsx
    ├── api.ts
    ├── autoreload.ts
    └── index.css
```

| File | What belongs in it |
|---|---|
| `index.html` | The single page shell: `<title>`, description, `theme-color`, the `#root` div. Nothing dynamic. |
| `package.json` / lock | The dependency list. Currently: react, react-router-dom, marked, swiper, the two self-hosted font packages. Anything added here must be bundled, never fetched at run time. |
| `vite.config.ts` | Build config and the dev proxy to `127.0.0.1:8082`, so development has the same single origin production does. |
| `public/vfm-hero.mp4/.jpg` | The chairman's film and its poster frame — front page hero. Committed as-is, not re-encoded. |
| `public/impressionen-hero.jpg` | The members-watching photograph, cropped 194px off the top. Impressionen hero. |
| `public/field-backdrop.jpg` | The panorama, downscaled and blurred at build time. **Not wired in yet.** |
| `src/main.tsx` | Boot: mounts `App`, imports the fonts and `index.css`, arms `#autoreload`. |
| `src/App.tsx` | Routing and page furniture — header/nav, `Post` (heading rule, caption, read-more), `Feed`, `StaticPage` (Markdown), `Dock` (the footer). Decides which page gets which hero and which gallery. |
| `src/Hero.tsx` | **The** hero. Video or image, full width, twice-height-shrinking-on-scroll, held still against scrolling, the heading inside it. Used by both pages. |
| `src/PhotoGallery.tsx` | **The** gallery. Swiper: coverflow, arrows, pagination, keyboard, drag, blurred backdrop, zoom, and the full-screen zoomable view. `perView` is the only thing that differs between the two pages. |
| `src/Gallery.tsx` | The Impressionen *page*. Fetches `/api/gallery`, handles loading/empty/failed, arranges `Hero` + `PhotoGallery`. Draws nothing itself. |
| `src/api.ts` | Every call to the backend and the shape of every answer. One file, so the API contract breaks compilation rather than a page. |
| `src/autoreload.ts` | `#autoreload` only: polls the served bundle's hashed filename and reloads when it changes. Inert without the fragment. |
| `src/index.css` | All styling. Colours and fonts as variables, header, hero, gallery, post cards, static-page prose, the dock, the responsive rules. |

The two files that should not exist as they are: `index.css` carries dead `.galhero` rules from before the hero was unified, and `field-backdrop.jpg` is an asset nothing references.

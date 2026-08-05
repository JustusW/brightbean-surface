# Execution plan — EXECUTED

This plan has been carried out. It is kept because the per-file
specification below is still the standard each file is held to, and
because the reasoning is worth more than the outcome.

**Where it was wrong, it says so.** Three rows described mechanisms that
did not survive contact with the running page: the hero was to be held
against the scroll by translating its media every frame, the gallery was
to use coverflow, and two components were listed as unbuilt. All three
are corrected in place and the correction is signed, because a plan
quietly rewritten to match what happened teaches nobody anything.

---

## The reduced tree — only what the requirements immediately need

```
brightbean-surface/frontend/
├── index.html
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
├── public/
│   ├── vfm-hero.mp4          the chairman's film
│   ├── vfm-hero.jpg          its poster frame
│   ├── impressionen-hero.jpg the cropped members photo
│   └── field-backdrop.jpg    the blurred panorama
└── src/
    ├── main.tsx          boot, fonts, autoreload
    ├── App.tsx           routes, header, feed, posts, static pages, Impressionen page, dock
    ├── Hero.tsx          the one hero
    ├── PhotoGallery.tsx  the one gallery, inline + full screen
    ├── api.ts            the backend contract
    ├── autoreload.ts     #autoreload
    └── index.css         all styling
```

Removed against what was there then:

| Gone | Why |
|---|---|
| `src/Gallery.tsx` | It fetches, renders three states, and arranges a `Hero` and a `PhotoGallery`. `App.tsx` already does exactly that for the feed and the static pages. It is a page, and the pages live in `App.tsx`. |
| `tsconfig.tsbuildinfo` | Build artefact, committed by accident. Belongs in `.gitignore`. |
| `dist/`, `node_modules/` | Outputs, not source. |
| the `.galhero*` rules inside `index.css` | Dead since the hero was unified. |

`field-backdrop.jpg` was the one judgement call — nothing referenced it,
so it was only required if the panning blurred backdrop was still
wanted. **It was.** `Backdrop.tsx` is built and the file is in use.

---

## The target tree — ALL required features

```
brightbean-surface/frontend/
├── index.html
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
├── public/
│   ├── vfm-hero.mp4          the chairman's film
│   ├── vfm-hero.jpg          its poster frame
│   ├── impressionen-hero.jpg the cropped members photo
│   ├── field-backdrop.jpg    the panorama, downscaled and pre-blurred
│   └── anfahrtskizze.jpg     the club's own approach map
└── src/
    ├── main.tsx          boot, self-hosted fonts, #autoreload
    ├── App.tsx           routes · header · feed · posts · static pages · Impressionen page · dock
    ├── Backdrop.tsx      the blurred field behind the whole site, panning on scroll
    ├── Hero.tsx          the one hero — video or image, fixed, shrinking on scroll
    ├── PhotoGallery.tsx  the one gallery — inline, and the full-screen zoom view
    ├── Anfahrt.tsx       the OSM map and the club's sketch, on Platz und Anfahrt
    ├── Members.tsx       sign in, sign up, Google, and the members' welcome page
    ├── api.ts            every backend call and its shape, including auth
    ├── autoreload.ts     #autoreload
    └── index.css         all styling
```

| Requirement | Lives in | State |
|---|---|---|
| Instagram feed on the front page, generic first-few-words heading | `App.tsx` | done |
| Static pages (Platz, Mitgliedschaft, Kontakt, Impressum, Datenschutz) | `App.tsx` + backend Markdown | done. **Rechtliches is gone** — "the AGB are out, they simply are meaningless for our usecase. the DSE is all we really need". Nothing is sold here and no contract is formed, so there is nothing for AGB to govern; the Impressum (§5 TMG) and the Datenschutzerklärung (Art. 13 DSGVO) are the two that are actually required, and both are real. |
| Perma-present footer, **always slim** | `App.tsx` | done |
| Hero: film, click/3s-hover, name once with glyph shadow, `position: fixed`, 600→150 and 400→100 | `Hero.tsx` | done |
| Impressionen hero: cropped photo | `Hero.tsx` + `public/impressionen-hero.jpg` | done |
| Gallery: arrows step by one, no vertical growth, no cropping, blurred backdrop | `PhotoGallery.tsx` | done |
| One image on a post, many side by side on Impressionen | `PhotoGallery.tsx` (`perView`) | done |
| Zoom, navigable while zoomed, full-screen view | `PhotoGallery.tsx` | done |
| Blurred transparent panorama panning on scroll | `Backdrop.tsx` + `public/field-backdrop.jpg` | done |
| A real OSM map on Platz und Anfahrt | `Anfahrt.tsx` | done |
| Members: signup *and* Google, welcome page | `Members.tsx` + `api.ts` + `backend/app/auth.py` | done, live, and signed into with a real Google account. Admins, a registrations board and account deletion came with it. |
| Faint height-dependent gradient, no pure white, no horizontal scrollbars | `index.css` | done, 0px overflow measured on both pages |
| Vendored everything, one origin | `package.json` — bundled, never fetched | done |
| Watchable deploys | `autoreload.ts` | done |

---

## Per-file specification

| File | What belongs in it, and what it must satisfy |
|---|---|
| **`index.html`** | The shell and nothing else: `lang="de"`, charset, viewport, the `<title>` and description used before the first API answer, `theme-color`, and `<div id="root">`. The real title and `lang` are set at runtime from `/api/site`, so a second deployment in another language announces itself correctly — this file only holds the value seen for the first few hundred milliseconds. No script tags beyond Vite's module entry, no analytics, no font links; a `<link>` to any third party breaks the single-origin rule outright. |
| **`package.json` / `package-lock.json`** | The dependency list, and it is a security surface, not bookkeeping. Everything here is bundled by Vite into our own assets — nothing may be fetched at run time. Current legitimate set: `react`, `react-dom`, `react-router-dom`, `marked` (static pages are Markdown), `swiper` (the gallery and its zoom), `leaflet` (the map), `@fontsource-variable/inter` and `@fontsource-variable/space-grotesk` (self-hosted, so no visitor's browser tells Google they looked at a model aeroplane club). Adding a package means one more thing to patch on a site nobody watches: prefer dependency-free ones, and never add a second package that does a job an existing one already does — that was the PhotoSwipe/Splide mistake. `npm ci` in the Dockerfile means the lockfile is the build, so it must be committed and must agree with `package.json`. |
| **`vite.config.ts`** | Build configuration and the development proxy. `/api` proxies to `127.0.0.1:8082` so development runs on the same single origin production does — no CORS in dev that production does not have, because a dev setup needing configuration production does not is a dev setup that lies. `chunkSizeWarningLimit` is 400 and is **not** to be raised to silence a warning: when Leaflet took the bundle to 492 kB the answer was `React.lazy`, not turning off the alarm. Main bundle 340 kB, map chunk 158 kB. |
| **`tsconfig.json`** | Strictness, including `noUnusedLocals` — which is what caught the dangling `useRef` import when the hero moved out of `App.tsx`, and the `EffectCoverflow` left in the modules array when coverflow was removed. Do not relax it to make a build pass; the unused symbol is telling you something did not get cleaned up. `"types": ["vite/client"]` is what lets an asset be imported as a module, which is how Leaflet's marker icons are resolved. |
| **`public/vfm-hero.mp4`, `vfm-hero.jpg`** | The 1. Vorsitzender's film — 848×480 h264, 115.75 s, 15.7 MB, with an audio track — and a still taken from the film itself as the poster. Used **as-is**: not re-encoded, not trimmed, not muted into wallpaper. It is somebody's work. The poster must be the film's own first frame so that starting playback is the picture coming to life rather than a layout event. Note the size: `preload="auto"` on this file means the network never goes idle, which will hang any Playwright `wait_until="networkidle"`. |
| **`public/impressionen-hero.jpg`** | The club photograph of four members watching the sky, 1600×1200 originally, cropped to 1600×1006 by removing 194px from the top — thirty pixels above the top of the first hat, which sits at y=224 on the original. Vendored deliberately: it came from a Wix URL and hotlinking it would break the single-origin rule. If it is ever re-cropped, `notes/crop_hero.py` holds the arithmetic and should be edited rather than the number being guessed again. |
| **`public/field-backdrop.jpg`** | The airfield panorama, 3660×771 (4.75:1), downscaled to 1800×379 and Gaussian-blurred **at build time**, currently at radius 2 and 26 kB. The blur is baked in on purpose: this image sits behind the whole page and pans while scrolling, and a CSS `filter` on a full-window image is recomposited every frame it moves — the most expensive thing you can ask a phone to do during a scroll. The radius has been 26, then 3, then 2, and every one of those was decided by the shepherd looking at the rendered page; it cannot be judged from the file, because the backdrop sits at 0.5 opacity underneath text. |
| **`public/anfahrtskizze.jpg`** | The club's own hand-drawn approach map — the blue route in from Blankenloch over the L 560, the red one down past the Fußgängerampel. Fetched once and committed by `notes/fetch_anfahrt.py`, resized to 1200 at quality 82: thin hand-drawn ink turns to mush lower than that, and the ink is the whole content. It is better than any generated map at the one thing that matters on arrival — *which* approach to take. |
| **`src/main.tsx`** | Boot, and nothing that thinks. Mounts `App` in `StrictMode`, imports the two font packages and `index.css`, and calls `armAutoReload()`. The font imports live here rather than in a component so that Vite bundles the woff2 files once. |
| **`src/App.tsx`** | Routing and every piece of page furniture. Contains: the sticky header with the brand roundel and the nav built from `/api/site` (so adding a page is a config change and a restart, not a rebuild), which **measures its own height into `--header-h`** because the fixed hero hangs below it and a hard-coded 56 would drift the moment the header's padding changed; `Feed`, which must distinguish **three** states — loading, empty, failed — because collapsing them makes a broken backend look like a quiet club; `Post`, whose heading rule is the first six words / 56 characters and must stay generic (an earlier version cut at the first sentence, which produced one lucky "Wir feiern!" and would produce nonsense on the next caption), with that heading and the byline **above** the pictures and the caption rendered as plain text, never through Markdown; `StaticPage`, which renders backend Markdown through `marked` — the Datenschutzerklärung is used verbatim and nests four heading levels, so nothing here may transform it — and which appends `Anfahrt` on `/platz` behind `Suspense`; the Impressionen page; and `Dock`, the footer, which is permanently present, **always the slim size**, and keeps its legal links in the DOM at every scroll position (§5 TMG wants the Impressum within two clicks of every page; pinned, it is within reach from every scroll position, which is a stronger promise and costs 46 pixels). **Neither the hero nor the full-width gallery may be nested inside the centred `<main>`**, because escaping it needs `100vw`, and `100vw` includes the vertical scrollbar's width — that is what put horizontal scrollbars on the site, and rendering them at the top level is the fix that cannot regress. |
| **`src/Backdrop.tsx`** | One element, mounted once for the whole site, holding `field-backdrop.jpg` behind everything: fixed to the viewport, covering it, at 0.5 opacity, panning horizontally as the page scrolls. It writes a single CSS custom property inside `requestAnimationFrame` — scroll fires far more often than the screen redraws — and the stylesheet owns the arithmetic. It pans **sideways**, never down: a backdrop moving vertically with a vertical scroll either travels with the content (invisible) or fights it (nauseating). The travel is a fraction of the **whole document**, so the far edge is reached at the foot of the page whether that page is the front page or the Impressum. `pointer-events: none`, `aria-hidden`, and sized in percentages rather than `100vw`. **It has no `prefers-reduced-motion` branch, deliberately** — see the note under `Hero.tsx`. |
| **`src/Hero.tsx`** | **The** hero, used by every page that has one — there must never be a second. Props: a title, and either a `video` (with `poster`) or an `image`. It is **`position: fixed`**, inside a `.heroslot` of constant full height. That single decision does four jobs: it stays put, which is the requirement; nothing below it moves as it shrinks (in flow, content rose by 300px *over and above* the distance scrolled — content moving at 1.7× the wheel, which is what "severe motion jitter" was); the document's height cannot depend on it, so the scroll-clamp feedback loop is gone by construction rather than by arithmetic; and the media needs no holding, so the per-frame translate that caused "the jitter is in the repositioning of the video/picture as the scrolls land" is **deleted, not tuned**. It hangs at `top: var(--header-h)` because a sticky header paints over a lower-z-index fixed element and would otherwise hide its first ~56px. It writes exactly one number, `--grow`; the heights live in the stylesheet, 600→150 desktop and 400→100 phone. The video plays on a click anywhere in the hero or three seconds of hover, is muted (a hover is not a user gesture, so an unmuted `play()` is simply refused), loops, and is `playsInline`. **The `prefers-reduced-motion` early return that used to open this file is gone and must not come back.** It pinned the hero small and returned, so on any machine asking for reduced motion — which Windows does whenever "Show animations" is off, and the shepherd has it on — the hero never reached its full height and the backdrop never panned, while an ordinary browser measured everything working perfectly. The shrink is a direct response to the reader's own scrolling; what stays behind the preference is the film starting *itself* on hover, which is motion nobody asked for. |
| **`src/PhotoGallery.tsx`** | **The** gallery, in two layers, one package (Swiper), used by both pages. The inline layer is a real gallery on the page — centred slides, arrows, pagination, keyboard, drag — over an out-of-focus copy of the picture in front of you. The full-screen layer opens on a click and is the zoomable, navigable view; it must exist separately because Swiper zooms *inside* a slide and a slide on a post card measures 432px, so magnifying a 1707px poster there is reading it through a slot. **There is no coverflow.** It was removed on instruction — "the transformation flickers" — and it took a whole class of defect with it: a 3D transform moves a slide's hit box away from where it is drawn, which is why clicking pictures two and three did nothing, and why four attempts at the click handler all failed. Parameters that are not optional, every one of them a documented default that was wrong here: `slidesPerGroup: 1` and **no** `slidesPerGroupAuto`, which skips every slide already in view and made the arrows jump end to end; `lazyPreloadPrevNext: 3` with `observer` and `observeSlideChildren`, all off by default, because an unloaded lazy image gives an auto-width slide no width at all; `snapToSlideEdge` for `slidesPerView: "auto"`; `panOnMouseMove` and `limitToOriginalSize`, both `false` by default, without which a zoomed picture cannot be moved with a mouse and magnifies past the real pixels into a blur; `dynamicBullets`; `mousewheel` with `forceToAxis`; German `a11y` strings. `.swiper-button-disabled` must keep its pointer events, or a click on a dead arrow falls through onto the picture and opens the viewer. Growth is horizontal only. Nothing is ever cropped: for these posts the poster *is* the content. Brightbean records `0×0` for these assets, so no layout may depend on knowing dimensions in advance. **Read `notes/swiper-api.txt` before changing anything here** — it is 94 kB of the published API on disk, fetched precisely so nobody guesses, and every defect listed above was answered by a default that was never looked up. |
| **`src/Anfahrt.tsx`** | The map, on Platz und Anfahrt, and the club's own sketch beneath it. OpenStreetMap, which is settled rather than preferred: the Datenschutzerklärung already names the OSMF in its own text, so a visitor has been told, in the document that governs this site, that the map talks to them. It is the one third party this site has and it is the one the paperwork covers. **Leaflet comes through npm, never a CDN** — most Leaflet examples reach for unpkg, which would hand a visitor's address to somebody the privacy policy does *not* mention. Lazy-loaded via `React.lazy` so ~150 kB stays out of the main bundle for the seven pages that have no map. `scrollWheelZoom: false`, or the map swallows the wheel and traps somebody halfway down the page. The marker's three icon files are **imported as modules**: `L.Icon.Default` computes its URLs at runtime from its own stylesheet's location, an assumption a bundler breaks, and the symptom is a pin that 404s while the map, tiles, popup and attribution all work perfectly. |
| **`src/Members.tsx`** | Sign up with email and password, sign in with Google, and the members' welcome page — the two are inclusive, not alternatives, and the same person must not end up with two accounts for using a different button on a different day. It posts to the auth routes and holds no token itself: the session is a server-side row and the cookie carries only its id, so signing out is a `DELETE` that takes effect immediately. It must collect nothing beyond what signing in requires — no name, no "where am I signed in" list, no last-login display — under the standing rule that nothing is stored that is not technically required. Errors must be shown: Brightbean renders a page identical to the login form when it refuses a password, which cost an hour of debugging — including the way back from Google, whose only channel is a `?fehler=` code on the URL, because the browser left this origin and returned as a fresh navigation. **The backend routes exist** (`backend/app/auth.py`) and the page is linked from the header: a sign-in page reachable only by being told its URL is not a sign-in page. For an admin it also renders the registrations board — a convenience only, since every admin endpoint re-checks the column server-side and answers 404, not 403, to an ordinary member. |
| **`src/api.ts`** | Every call to the backend and the shape of every answer, in one file, so a contract change breaks compilation instead of a page. Relative paths only — nginx serves the bundle and proxies `/api` on the same hostname, so there is no base URL to configure and nothing to get wrong between staging and production. `credentials: "same-origin"` throughout. On a non-OK response it throws the backend's own `detail` and nothing else: the backend deliberately answers a bland 503 rather than a stack trace, so inventing a friendlier explanation here would be inventing a diagnosis. |
| **`src/autoreload.ts`** | Opt-in via `#autoreload` and completely inert without it, so no visitor ever polls anything. It compares the hashed bundle filename the page is running against the one in a freshly fetched `/index.html` (`cache: "no-store"`, or the browser answers from its own cache for the whole session), and reloads when they differ. The hash *is* the build identity, so there is no version constant to remember to bump and it cannot false-positive. An empty answer is ignored — the service is down for a few seconds during every deploy, which is exactly when somebody is watching. It shows a small badge, because a page that reloads itself with no explanation reads as a bug. |
| **`src/index.css`** | All styling, with the reasoning for anything non-obvious kept beside it. Holds: the colour and font variables (Inter for reading, Space Grotesk for display); the sticky header; `--grow` and the hero's heights; `--chrome`, the sum of header + resting hero + dock, against which **anything that must fit on screen is measured** — guessing it is what put the gallery's pictures under the hero twice; Swiper's custom properties; post cards; the static-page prose, including `h3`/`h4` sizes without which the Datenschutzerklärung's four heading levels invert, and a 66-character measure for the mandatory all-caps Art. 21 passages; the dock; the responsive rules. Constraints: **never `100vw`** for a full-bleed element — it includes the scrollbar and produces horizontal overflow; the page background is a faint vertical gradient on `<html>` (not `<body>`, or it paints over the backdrop at z-index -1), never flat white; the centre column is at least 900; focus must remain visible everywhere; and tap targets stay at 44px, because this is read on a phone, in sunlight, by people whose eyes are not what they were. |

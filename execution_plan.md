# Execution plan

Extracted verbatim from the console record.

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

Removed against what is there now:

| Gone | Why |
|---|---|
| `src/Gallery.tsx` | It fetches, renders three states, and arranges a `Hero` and a `PhotoGallery`. `App.tsx` already does exactly that for the feed and the static pages. It is a page, and the pages live in `App.tsx`. |
| `tsconfig.tsbuildinfo` | Build artefact, committed by accident. Belongs in `.gitignore`. |
| `dist/`, `node_modules/` | Outputs, not source. |
| the `.galhero*` rules inside `index.css` | Dead since the hero was unified. |

`field-backdrop.jpg` is the one judgement call: nothing references it yet, so it is only required if the panning blurred backdrop is still wanted. If it is not, that file and `notes/bake_backdrop.py` go too.

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
│   └── field-backdrop.jpg    the panorama, downscaled and pre-blurred
└── src/
    ├── main.tsx          boot, self-hosted fonts, #autoreload
    ├── App.tsx           routes · header · feed · posts · static pages · Impressionen page · dock
    ├── Backdrop.tsx      the blurred field behind the whole site, panning on scroll
    ├── Hero.tsx          the one hero — video or image, grows/shrinks, held against scroll
    ├── PhotoGallery.tsx  the one gallery — coverflow inline, and the full-screen zoom view
    ├── Members.tsx       sign in, sign up, Google, and the members' welcome page
    ├── api.ts            every backend call and its shape, including auth
    ├── autoreload.ts     #autoreload
    └── index.css         all styling
```

| Requirement | Lives in |
|---|---|
| Instagram feed on the front page, generic first-few-words heading | `App.tsx` |
| Static pages (Platz, Mitgliedschaft, Kontakt, Impressum, Datenschutz, Rechtliches) | `App.tsx` + backend Markdown |
| Perma-present footer, flat until the end of the page | `App.tsx` |
| Hero: film, click/3s-hover, name once with glyph shadow, double height shrinking, fixed | `Hero.tsx` |
| Impressionen hero: cropped photo | `Hero.tsx` + `public/impressionen-hero.jpg` |
| Gallery: coverflow, blurred backdrop, arrows step by one, no vertical growth, no cropping | `PhotoGallery.tsx` |
| One image ~700 tall on the front page, many side by side full width on Impressionen | `PhotoGallery.tsx` (`perView`) |
| Zoom, navigable while zoomed, full-screen view | `PhotoGallery.tsx` |
| **Blurred transparent panorama panning on scroll** | `Backdrop.tsx` + `public/field-backdrop.jpg` |
| **Members: signup *and* Google, welcome page** | `Members.tsx` + `api.ts` |
| Faint height-dependent gradient, no pure white, no horizontal scrollbars | `index.css` |
| Vendored everything, one origin | `package.json` — bundled, never fetched |
| Watchable deploys | `autoreload.ts` |

Two of those rows are not built: `Backdrop.tsx` and `Members.tsx`. Everything else exists today, in the files named.

---

## Per-file specification

| File | What belongs in it, and what it must satisfy |
|---|---|
| **`index.html`** | The shell and nothing else: `lang="de"`, charset, viewport, the `<title>` and description used before the first API answer, `theme-color`, and `<div id="root">`. The real title and `lang` are set at runtime from `/api/site`, so a second deployment in another language announces itself correctly — this file only holds the value seen for the first few hundred milliseconds. No script tags beyond Vite's module entry, no analytics, no font links; a `<link>` to any third party breaks the single-origin rule outright. |
| **`package.json` / `package-lock.json`** | The dependency list, and it is a security surface, not bookkeeping. Everything here is bundled by Vite into our own assets — nothing may be fetched at run time. Current legitimate set: `react`, `react-dom`, `react-router-dom`, `marked` (static pages are Markdown), `swiper` (the gallery, its effects and its zoom), `@fontsource-variable/inter` and `@fontsource-variable/space-grotesk` (self-hosted, so no visitor's browser tells Google they looked at a model aeroplane club). Adding a package means one more thing to patch on a site nobody watches: prefer dependency-free ones, and never add a second package that does a job an existing one already does — that was the PhotoSwipe/Splide mistake. `npm ci` in the Dockerfile means the lockfile is the build, so it must be committed and must agree with `package.json`. |
| **`vite.config.ts`** | Build configuration and the development proxy. `/api` proxies to `127.0.0.1:8082` so development runs on the same single origin production does — no CORS in dev that production does not have, because a dev setup needing configuration production does not is a dev setup that lies. Keep `chunkSizeWarningLimit` low enough to notice bloat: this is read on a rural mobile connection at a flying field, and the bundle is already ~338 KB with Swiper in it. |
| **`tsconfig.json`** | Strictness, including `noUnusedLocals` — which is what caught the dangling `useRef` import when the hero moved out of `App.tsx`. Do not relax it to make a build pass; the unused symbol is telling you something did not get cleaned up. `tsconfig.tsbuildinfo` is an artefact and belongs in `.gitignore`, not in the repository. |
| **`public/vfm-hero.mp4`, `vfm-hero.jpg`** | The 1. Vorsitzender's film — 848×480 h264, 115.75 s, 15.7 MB, with an audio track — and a still taken from the film itself as the poster. Used **as-is**: not re-encoded, not trimmed, not muted into wallpaper. It is somebody's work. The poster must be the film's own first frame so that starting playback is the picture coming to life rather than a layout event. Note the size: `preload="auto"` on this file means the network never goes idle, which will hang any Playwright `wait_until="networkidle"`. |
| **`public/impressionen-hero.jpg`** | The club photograph of four members watching the sky, 1600×1200 originally, cropped to 1600×1006 by removing 194px from the top — thirty pixels above the top of the first hat, which sits at y=224 on the original. Vendored deliberately: it came from a Wix URL and hotlinking it would break the single-origin rule. If it is ever re-cropped, `notes/crop_hero.py` holds the arithmetic and should be edited rather than the number being guessed again. |
| **`public/field-backdrop.jpg`** | The airfield panorama, 3660×771 (4.75:1), downscaled to 1800×379 and Gaussian-blurred at radius 26 **at build time**, 13.6 KB. The blur is baked in on purpose: this image sits behind the whole page and pans while scrolling, and a CSS `filter` on a full-window image is recomposited every frame it moves — the most expensive thing you can ask a phone to do during a scroll. It is also downscaled because a heavy blur destroys the detail you would otherwise pay to download. |
| **`src/main.tsx`** | Boot, and nothing that thinks. Mounts `App` in `StrictMode`, imports the two font packages and `index.css`, and calls `armAutoReload()`. The font imports live here rather than in a component so that Vite bundles the woff2 files once. |
| **`src/App.tsx`** | Routing and every piece of page furniture. Contains: the sticky header with the brand roundel and the nav built from `/api/site` (so adding a page is a config change and a restart, not a rebuild); `Feed`, which fetches `/api/feed` and must distinguish **three** states — loading, empty, failed — because collapsing them makes a broken backend look like a quiet club; `Post`, which derives a heading from the first six words / 56 characters of the caption by a rule that must stay generic (an earlier version cut at the first sentence, which produced one lucky "Wir feiern!" and would produce nonsense on the next caption), places that heading and the byline **above** the pictures, renders the caption as plain text with `white-space: pre-wrap` and never through Markdown; `StaticPage`, which renders backend Markdown through `marked` — the Datenschutzerklärung is used verbatim and nests four heading levels, so nothing here may transform it; the Impressionen page, which fetches `/api/gallery`, handles the same three states, and arranges `Hero` + `PhotoGallery`; and `Dock`, the footer, which is permanently present, flat until you reach the bottom, and must keep its legal links in the DOM identically in both states (§5 TMG wants the Impressum within two clicks of every page — pinned, it is within reach from every scroll position, and hiding it until you scroll would defeat that). Two traps: the "at the bottom" test must first ask whether the page is scrollable at all, or an unloaded page is trivially "at the end" and the footer opens tall on arrival; and neither the hero nor the gallery may be nested inside the centred `<main>` column, because escaping it needs `100vw`, and `100vw` includes the vertical scrollbar's width — that is what put horizontal scrollbars on the site. |
| **`src/Backdrop.tsx`** | *Not built.* One element, mounted once for the whole site, holding `field-backdrop.jpg` behind everything: fixed to the viewport, covering it, semi-transparent, panning horizontally as the page scrolls. It must write a single CSS custom property (a translation, or a `background-position-x`) inside `requestAnimationFrame` — scroll fires far more often than the screen redraws — and the stylesheet must own the arithmetic. It must not create a stacking or containing context that traps the hero's own positioning, must be `pointer-events: none`, must be hidden from assistive technology, and must be static under `prefers-reduced-motion: reduce`. It must never introduce horizontal overflow: size it with percentages of the viewport, not `100vw`. |
| **`src/Hero.tsx`** | **The** hero, used by every page that has one — there must never be a second. Props: a title, and either a `video` (with `poster`) or an `image`. Behaviour, identical wherever it is used: full window width; **twice** its resting height at the top of the page, settling to the resting height over the first ~420px of scroll; held still against scrolling; the page's single `h1` inside it, slightly transparent with the shadow on the glyphs rather than a panel behind them. The "held still" is done by pinning the media at the large height and pushing it **down** by exactly how far the hero's top edge has travelled up — `background-attachment: fixed` cannot be used because it does not work for a `<video>` and is ignored on iOS. It writes only `--grow` and `--pan`, inside `requestAnimationFrame`; the heights live in the stylesheet. The video plays on a click anywhere in the hero or three seconds of hover, is muted (a hover is not a user gesture, so an unmuted `play()` is simply refused), loops, is `playsInline` so iOS does not go fullscreen, and is hidden from assistive technology with `tabIndex={-1}`. Nothing may move, resize or appear when playback starts. Under `prefers-reduced-motion` it renders small and still. |
| **`src/PhotoGallery.tsx`** | **The** gallery, in two layers, one package (Swiper), used by both pages. The inline layer is a real gallery on the page — coverflow with centred slides, arrows, pagination, keyboard, drag — over an out-of-focus copy of the picture in front of you. The full-screen layer opens on a click and is the zoomable, navigable view: zoom to the picture's real pixels, pan, and the arrows and keyboard keep working **while zoomed**; Escape closes it and the page behind must not scroll while it is open. Parameters that are not optional, all of them read from the API rather than assumed: `slidesPerView` is `1` on a post (one picture filling at least one dimension) and `"auto"` on Impressionen (as many as fit); `snapToSlideEdge` exists specifically for `"auto"` and stops a partial slide sitting misaligned at the end; `slidesPerGroup: 1` and **no** `slidesPerGroupAuto` — that parameter skips every slide already in view, which is what made the arrows jump end to end; `panOnMouseMove: true` and `limitToOriginalSize: true`, both `false` by default, without which a zoomed picture cannot be moved with a mouse and magnifies past the real pixels into a blur; `dynamicBullets` because forty photographs would otherwise be forty bullets; `mousewheel` with `forceToAxis` so a horizontal gesture moves the gallery and ordinary scrolling still scrolls the page; German `a11y` strings. Growth is horizontal only — the height is fixed and identical on both pages. Nothing is ever cropped: for these posts the poster *is* the content, and a crop deletes the date and the venue. Note that Brightbean records `0×0` for these assets, so no layout may depend on knowing dimensions in advance. |
| **`src/Members.tsx`** | *Not built.* Sign up with email and password, sign in with Google, and the members' welcome page — the two are inclusive, not alternatives, and the same person must not end up with two accounts for using a different button on a different day. It posts to the auth routes and holds no token itself: the session is a server-side row and the cookie carries only its id, so signing out is a `DELETE` that takes effect immediately. It must collect nothing beyond what signing in requires — no name, no "where am I signed in" list, no last-login display — under the standing rule that nothing is stored that is not technically required. Errors must be shown: this build renders a page identical to the login form when it refuses a password, which cost an hour of debugging on the Brightbean side. |
| **`src/api.ts`** | Every call to the backend and the shape of every answer, in one file, so a contract change breaks compilation instead of a page. Relative paths only — nginx serves the bundle and proxies `/api` on the same hostname, so there is no base URL to configure and nothing to get wrong between staging and production. `credentials: "same-origin"` throughout, so the members calls need no second fetch wrapper. On a non-OK response it throws the status and nothing else: the backend deliberately answers a bland 503 rather than a stack trace, so inventing a friendlier explanation here would be inventing a diagnosis. |
| **`src/autoreload.ts`** | Opt-in via `#autoreload` and completely inert without it, so no visitor ever polls anything. It compares the hashed bundle filename the page is running against the one in a freshly fetched `/index.html` (`cache: "no-store"`, or the browser answers from its own cache for the whole session), and reloads when they differ. The hash *is* the build identity, so there is no version constant to remember to bump and it cannot false-positive. An empty answer is ignored — the service is down for a few seconds during every deploy, which is exactly when somebody is watching. It shows a small badge, because a page that reloads itself with no explanation reads as a bug. |
| **`src/index.css`** | All styling, with the reasoning for anything non-obvious kept beside it. Holds: the colour and font variables (Inter for reading, Space Grotesk for display); the sticky header; the hero's heights and the `--grow`/`--pan` arithmetic; the gallery's sizing and Swiper's custom properties; post cards; the static-page prose, including `h3`/`h4` sizes without which the Datenschutzerklärung's four heading levels invert, and a 66-character measure for the mandatory all-caps Art. 21 passages; the dock; the responsive rules. Constraints: never `100vw` for a full-bleed element — it includes the scrollbar and produces horizontal overflow; the page background is a faint vertical gradient across the document, never flat white; focus must remain visible everywhere; every animation needs a `prefers-reduced-motion` answer; and tap targets stay at 44px, because this is read on a phone, in sunlight, by people whose eyes are not what they were. |

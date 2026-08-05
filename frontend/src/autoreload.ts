/** Reload the page when a new build is deployed. Opt-in, via #autoreload.
 *
 *  FOR WATCHING WORK HAPPEN. Open the site with `#autoreload` on the end
 *  and leave it on a second screen; each deploy replaces the page by
 *  itself. Without the fragment this file does nothing at all, so no
 *  visitor ever polls anything.
 *
 *  IT WATCHES THE BUNDLE'S FILENAME, NOT A VERSION NUMBER WE MAINTAIN.
 *  Vite hashes the built assets from their contents — index-C0wHkb_N.js
 *  becomes a different name the moment a byte changes — so the filename
 *  in the served index.html IS the build identity, exactly, with nothing
 *  to remember to bump. A version constant would be a second source of
 *  truth that eventually disagrees with the code beside it.
 *
 *  It is also why this cannot false-positive: the name only changes when
 *  the contents do.
 */

const MARKER = "autoreload";
const EVERY_MS = 4000;

/** The hashed bundle this page is currently RUNNING. */
function currentBundle(): string {
  const el = document.querySelector<HTMLScriptElement>(
    'script[type="module"][src*="/assets/"]',
  );
  return el?.getAttribute("src") ?? "";
}

/** The hashed bundle the server is currently SERVING. */
async function servedBundle(): Promise<string> {
  // cache: "no-store" matters more than it looks. index.html is served
  // by the same process that serves the bundle, and without this the
  // browser would happily answer from its own cache for the whole
  // session - the page would poll faithfully and never notice anything.
  const res = await fetch("/index.html", { cache: "no-store" });
  if (!res.ok) return "";
  const html = await res.text();
  const found = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
  return found ? found[1] : "";
}

function badge(): HTMLElement {
  const el = document.createElement("div");
  el.textContent = "autoreload";
  el.setAttribute("role", "status");
  // A VISIBLE SIGN THAT IT IS ARMED. A page that reloads itself with no
  // explanation is a page that has apparently lost your scroll position
  // for no reason - and the first suspicion is a bug, not a feature you
  // switched on twenty minutes ago.
  el.style.cssText = [
    "position:fixed", "left:12px", "bottom:12px", "z-index:9999",
    "padding:5px 11px", "border-radius:999px",
    "background:rgba(12,24,33,.78)", "color:#fff",
    "font:600 12px/1.2 ui-sans-serif,system-ui,sans-serif",
    "letter-spacing:.06em", "text-transform:uppercase",
    "pointer-events:none", "backdrop-filter:blur(6px)",
  ].join(";");
  return el;
}

export function armAutoReload(): void {
  if (!location.hash.toLowerCase().includes(MARKER)) return;

  const mine = currentBundle();
  document.body.appendChild(badge());

  window.setInterval(async () => {
    try {
      const theirs = await servedBundle();
      // An empty answer means the request failed or the markup changed
      // shape. Reloading on that would put the page into a loop during
      // the few seconds a deploy has the service down, which is exactly
      // when somebody is watching.
      if (!theirs || !mine || theirs === mine) return;
      location.reload();
    } catch {
      // The service goes away and comes back during a deploy. That is
      // the expected state here, not an error worth acting on.
    }
  }, EVERY_MS);
}

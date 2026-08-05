import { useEffect, useRef } from "react";

/** The airfield, behind the whole site, panning as you scroll.
 *
 *  One element, mounted once, sitting behind every page. The photograph
 *  is the club's own panorama of its own field — 3660x771, an ultrawide
 *  strip of grass, sky and a line of people watching something fly.
 *
 *  THE BLUR IS BAKED INTO THE FILE, NOT APPLIED HERE. notes/bake_backdrop.py
 *  downscales it to 1800px and Gaussian-blurs it at build time, which is
 *  why it is 13.6 kB. A CSS `filter` on a full-window image is
 *  recomposited on every frame the image moves, and this one moves on
 *  every scroll event — that is the single most expensive thing you can
 *  ask a phone to do while somebody is reading. Blurred in advance it is
 *  an ordinary picture and costs nothing to translate.
 *
 *  IT PANS SIDEWAYS, NOT DOWN. Scrolling a page is vertical, so a
 *  backdrop that moved vertically with it would either travel with the
 *  content (invisible) or fight it (nauseating). Moving it horizontally
 *  makes the page feel as though it is passing along the field.
 */

/** How far it travels, end to end. The stylesheet guarantees the picture
 *  is at least this much wider than the window (min-width: 100% + 240px),
 *  so there is always exactly this much slack to move within and an edge
 *  can never come into view. Measuring the real overflow instead would
 *  mean reading layout back on every resize to learn a number we are
 *  already free to choose. */
const PAN = 240;

export default function Backdrop() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;

    // MOTION IS A PREFERENCE, and this is decoration. Somebody who has
    // asked their system for reduced motion gets the picture, standing
    // still.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.setProperty("--pan", "0px");
      return;
    }

    let frame = 0;
    const apply = () => {
      frame = 0;
      const doc = document.documentElement;
      // AS A FRACTION OF THE WHOLE DOCUMENT, not of a fixed number of
      // pixels: the front page and the Impressum are wildly different
      // lengths, and panning by absolute scroll distance would run the
      // picture to its stop halfway down one and barely move on the
      // other. Reaching the far edge exactly at the foot of the page is
      // the same gesture whatever the page is.
      const travel = Math.max(1, doc.scrollHeight - window.innerHeight);
      const progress = Math.min(1, Math.max(0, window.scrollY / travel));
      const shift = -(progress * PAN);
      el.style.setProperty("--pan", `${shift.toFixed(1)}px`);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    apply();
    // Written inside requestAnimationFrame: scroll fires far more often
    // than the screen redraws, and setting a style on every event is how
    // a page starts to feel heavy.
    window.addEventListener("scroll", onScroll, { passive: true });
    // The document's height changes as the feed's pictures arrive, which
    // changes what "the foot of the page" means.
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    /* aria-hidden and pointer-events: none in the stylesheet — it is
       scenery, and it must never intercept a click meant for the page
       lying over it. */
    <div className="backdrop" ref={root} aria-hidden="true">
      <img
        className="backdropimg"
        src="/field-backdrop.jpg"
        alt=""
        decoding="async"
      />
    </div>
  );
}

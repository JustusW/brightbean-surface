import { useEffect, useRef } from "react";
import PhotoSwipeLightbox from "photoswipe/lightbox";
import "photoswipe/style.css";
import type { FeedMedia } from "./api";

/** THE gallery. One component, used on the front page and on Impressionen.
 *
 *  A PLUGIN RATHER THAN OUR OWN CAROUSEL, on instruction: "you can't
 *  navigate when zoomed and the display should show as many images side
 *  by side as are possible. How about you find a proper gallery plugin
 *  and simple use that."
 *
 *  Both halves of that were real defects in the hand-written one. Its
 *  lightbox was a single <img> in a fixed overlay — no pan, no pinch, and
 *  no way to reach the next picture without closing it first. And it
 *  showed exactly ONE picture at a time in a 16:10 frame, so seeing
 *  forty of them cost forty clicks.
 *
 *  PHOTOSWIPE, and it is not a CDN. It arrives through npm and Vite
 *  bundles it into our own assets, exactly as the fonts are — see
 *  main.tsx. A visitor's browser still contacts this origin and the
 *  club's media host, and nothing else. It is also one package with zero
 *  dependencies, which is the reason it was chosen over the React
 *  wrappers: fewer things to patch on a site nobody is watching.
 *
 *  WHAT IT BUYS: pinch and wheel zoom, drag to pan, arrows and the
 *  keyboard that keep working WHILE zoomed, swipe between pictures, an
 *  Escape that closes, and focus handling that does not trap somebody
 *  using a keyboard. Every one of those is a thing the hand-rolled
 *  version either lacked or would have had to grow.
 */

/** WHY THE DIMENSIONS ARE READ OFF THE LOADED IMAGE.
 *
 *  PhotoSwipe needs each picture's real width and height to size its zoom
 *  — it is a viewer, so it has to know how big the thing is before it
 *  opens it. Brightbean's media_library_media_asset rows carry 0 for both
 *  on these assets, so /api/gallery answers 0x0 and there is nothing
 *  useful to hand over.
 *
 *  Rather than guess, the browser is asked. Once a thumbnail has painted
 *  it knows its own naturalWidth, and that is written onto the anchor
 *  where PhotoSwipe looks. A picture you can click is a picture that has
 *  loaded, so by the time the answer is needed it is there.
 *
 *  The fallback below is only used if that has somehow not happened; it
 *  is a shape, not a claim, and PhotoSwipe corrects itself once the full
 *  image arrives.
 */
const FALLBACK_W = 1600;
const FALLBACK_H = 1200;

export default function PhotoGrid({ media }: { media: FeedMedia[] }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!root.current || media.length === 0) return;
    const lightbox = new PhotoSwipeLightbox({
      // The ELEMENT, not a selector. A selector would need an id, and an
      // id has to be unique across a page that renders one of these per
      // post — a class of bug that does not exist if it is never named.
      gallery: root.current,
      children: "a",
      // Dynamically imported, so the viewer itself is a separate chunk
      // that is only fetched when somebody actually opens a picture.
      pswpModule: () => import("photoswipe"),
      // Both of these are what the complaint was about: they stay
      // available while zoomed, so you can move through the pictures at
      // the magnification you chose rather than starting again.
      arrowKeys: true,
      loop: false,
      bgOpacity: 0.94,
      // German, because the page is German. These are read aloud.
      closeTitle: "Schließen",
      zoomTitle: "Vergrößern",
      arrowPrevTitle: "Vorheriges Bild",
      arrowNextTitle: "Nächstes Bild",
      errorMsg: "Das Bild konnte nicht geladen werden.",
    });
    lightbox.init();
    return () => lightbox.destroy();
  }, [media]);

  if (media.length === 0) return null;

  return (
    <div className="pics" ref={root}>
      {media.map((m, i) => (
        <a
          key={i}
          className="pic"
          href={m.url}
          target="_blank"
          rel="noreferrer"
          data-pswp-width={m.width || FALLBACK_W}
          data-pswp-height={m.height || FALLBACK_H}
          aria-label={m.alt || `Bild ${i + 1} von ${media.length} vergrößern`}
        >
          <img
            src={m.url}
            /* Alt text comes from the media library, where somebody wrote
               one. An empty alt is correct for a decorative image and far
               better than inventing a description of a photograph nobody
               here has seen. */
            alt={m.alt}
            /* The first few are what somebody came to see; the rest can
               wait until they are approached. A club with two hundred
               photographs should not send all two hundred to somebody who
               looks at four. */
            loading={i < 6 ? "eager" : "lazy"}
            decoding="async"
            onLoad={(e) => {
              const img = e.currentTarget;
              const anchor = img.closest("a");
              if (!anchor || !img.naturalWidth) return;
              anchor.dataset.pswpWidth = String(img.naturalWidth);
              anchor.dataset.pswpHeight = String(img.naturalHeight);
            }}
          />
        </a>
      ))}
    </div>
  );
}

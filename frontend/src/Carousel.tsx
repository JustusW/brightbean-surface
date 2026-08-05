import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedMedia } from "./api";

/** The image carousel.
 *
 *  WRITTEN HERE RATHER THAN INSTALLED. Not because a library would be a
 *  CDN — everything this project uses is bundled into our own JavaScript
 *  and no third party is contacted — but because carousel libraries are
 *  large, and every one of them has opinions about focus, gestures and
 *  ARIA that then have to be fought. This is about a hundred lines and
 *  does exactly what the club needs.
 *
 *  THE SWIPING IS CSS, NOT JAVASCRIPT. `scroll-snap-type: x mandatory`
 *  on the track means a touchscreen, a trackpad, a mouse wheel and the
 *  keyboard all work before a single line of this file runs — so the
 *  pictures remain browsable if the script fails, and the momentum feels
 *  native because it IS native. The JavaScript adds the buttons and the
 *  dots on top of a thing that already works.
 *
 *  NOTHING IS CROPPED. Event posters are the commonest thing this club
 *  publishes, and for those the picture IS the content: a crop to fit a
 *  frame deletes the date or the venue. Each slide shows the whole image
 *  with object-fit: contain, over a blurred, darkened copy of itself —
 *  which fills the frame, never invents a shape the photograph does not
 *  have, and looks deliberate rather than like letterboxing.
 */
export default function Carousel({ media }: { media: FeedMedia[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  const scrollTo = useCallback((i: number) => {
    const el = track.current;
    if (!el) return;
    const target = Math.max(0, Math.min(media.length - 1, i));
    el.scrollTo({ left: target * el.clientWidth, behavior: "smooth" });
  }, [media.length]);

  // WHICH SLIDE IS SHOWING IS READ OFF THE SCROLL POSITION, not tracked
  // in state by the buttons. The track can be scrolled by a finger, a
  // trackpad, a wheel or the arrow keys without this component being
  // told — so the dots must follow the DOM rather than a variable that
  // only the buttons update, or they drift out of step the first time
  // somebody swipes.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const w = el.clientWidth || 1;
        setIndex(Math.round(el.scrollLeft / w));
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  if (media.length === 0) return null;

  const many = media.length > 1;

  return (
    <div
      className="carousel"
      // aria-roledescription tells a screen reader what KIND of region
      // this is, in German, because the page is German.
      role="group"
      aria-roledescription="Bildergalerie"
      aria-label={`${media.length} Bild${media.length === 1 ? "" : "er"}`}
    >
      <div
        className="track"
        ref={track}
        // tabIndex makes the track focusable, which is what gives the
        // arrow keys their native scrolling for free.
        tabIndex={0}
      >
        {media.map((m, i) => (
          <div
            className="slide"
            key={i}
            role="group"
            aria-roledescription="Bild"
            aria-label={`${i + 1} von ${media.length}`}
          >
            {/* The blurred backdrop is DECORATIVE and hidden from
                assistive technology: it is the same picture again, and
                announcing it twice is noise. */}
            <div
              className="slidebg"
              aria-hidden="true"
              style={{ backgroundImage: `url(${m.url})` }}
            />
            <img
              src={m.url}
              /* Alt text comes from the media library, where somebody
                 wrote one. An empty alt is correct for a decorative
                 image and far better than inventing a description of a
                 photograph nobody here has seen. */
              alt={m.alt}
              width={m.width || undefined}
              height={m.height || undefined}
              /* The first image of the first post is usually the largest
                 thing on the page; lazy-loading it delays the only thing
                 the visitor came to see. The rest can wait. */
              loading={i === 0 ? "eager" : "lazy"}
              decoding="async"
            />
          </div>
        ))}
      </div>

      {many && (
        <>
          <button
            className="cbtn prev"
            aria-label="Vorheriges Bild"
            onClick={() => scrollTo(index - 1)}
            disabled={index === 0}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            className="cbtn next"
            aria-label="Nächstes Bild"
            onClick={() => scrollTo(index + 1)}
            disabled={index >= media.length - 1}
          >
            <span aria-hidden="true">›</span>
          </button>

          <div className="dots">
            {media.map((_, i) => (
              <button
                key={i}
                className={i === index ? "dot on" : "dot"}
                aria-label={`Bild ${i + 1} von ${media.length}`}
                aria-current={i === index}
                onClick={() => scrollTo(i)}
              />
            ))}
          </div>

          <div className="count" aria-hidden="true">
            {index + 1}/{media.length}
          </div>
        </>
      )}
    </div>
  );
}

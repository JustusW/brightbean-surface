import { useEffect, useRef, useState } from "react";
import PhotoGallery from "./PhotoGallery";
import { api, type FeedMedia } from "./api";

/** How far you scroll before the hero has finished shrinking, in pixels.
 *  Long enough that it is a slow settle rather than a snap, short enough
 *  that it is done before the first pictures are on screen. */
const SHRINK_OVER = 420;

/** Impressionen — every picture the club has published.
 *
 *  THE SAME GALLERY AS THE FRONT PAGE, given the full page width. The
 *  shepherd's instruction, after seeing the two side by side: "please use
 *  the same gallery in both places just with one being granted the full
 *  width."
 *
 *  What was here before was a second implementation — a CSS multi-column
 *  wall of raw tiles — and it did not look like the same website. It also
 *  reproduced the thing that had already been rejected: three event
 *  posters standing up as tall portrait slabs, which is the vertical
 *  format the reference site was criticised for.
 *
 *  So this file no longer draws anything. It fetches, handles the three
 *  states, and hands the pictures to PhotoGrid. The width comes from
 *  <main className="wide"> in App.tsx, and the pictures are simply taller
 *  there — same component, more room.
 */
export default function Gallery({ title }: { title: string }) {
  const [images, setImages] = useState<FeedMedia[] | null>(null);
  const [failed, setFailed] = useState(false);
  const hero = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .gallery()
      .then((r) => setImages(r.images))
      .catch(() => setFailed(true));
  }, []);

  /** THE HERO SHRINKS AS YOU SCROLL: twice its height at the top of the
   *  page, settling to its normal size by the time you have scrolled
   *  past it.
   *
   *  It writes ONE custom property and the stylesheet does the
   *  arithmetic, so the shape of the thing stays in the CSS where it can
   *  be read. And it writes it inside requestAnimationFrame rather than
   *  on every scroll event: a scroll fires far more often than the screen
   *  redraws, and setting a style each time is how a page starts to feel
   *  heavy on a phone.
   *
   *  Somebody who has asked their system for reduced motion gets the
   *  small hero and no movement at all. */
  useEffect(() => {
    const el = hero.current;
    if (!el) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      el.style.setProperty("--grow", "0");
      return;
    }

    let frame = 0;
    const apply = () => {
      frame = 0;
      const t = 1 - Math.min(1, Math.max(0, window.scrollY / SHRINK_OVER));
      el.style.setProperty("--grow", t.toFixed(3));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section className="gallery">
      {/* THE HERO. The club's own photograph — members watching something
          fly, which is what this page is about — cut down to thirty
          pixels above the first hat so the frame opens on the people
          rather than on empty sky. Vendored into our own assets rather
          than linked from where it was found: a visitor's browser talks
          to this origin and the club's media host, and nothing else.

          alt is empty on purpose. It is decoration behind the page's own
          heading, and describing it again would make a screen reader read
          the same thing twice. */}
      <div className="galhero" ref={hero}>
        <div className="galheroin">
          <h1>{title}</h1>
        </div>
      </div>

      {/* THREE STATES, AND THEY SAY DIFFERENT THINGS. "still loading",
          "nothing to show" and "it broke" are not the same news, and
          collapsing them into one empty page is how a failure gets
          mistaken for a club that has not posted anything. */}
      {failed && (
        <p className="empty">
          Die Bilder lassen sich gerade nicht laden. Bitte versuchen Sie es
          später noch einmal.
        </p>
      )}
      {!failed && images === null && <p className="empty">Lädt…</p>}
      {!failed && images !== null && images.length === 0 && (
        <p className="empty">Hier erscheinen bald unsere Bilder.</p>
      )}

      {images && images.length > 0 && <PhotoGallery media={images} />}
    </section>
  );
}

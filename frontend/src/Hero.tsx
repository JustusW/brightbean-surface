import { useEffect, useRef } from "react";

/** THE hero. One implementation, every page that has one.
 *
 *  IT IS PINNED TO THE TOP OF THE WINDOW AND STAYS THERE. The shepherd,
 *  after three attempts that all scrolled away: "it's supposed to shrink
 *  to 300 in height and then REMAIN WHERE IT IS."
 *
 *  So it is `position: fixed`, and a slot of the FULL height holds its
 *  place in the document. That single change fixes three things at once:
 *
 *    IT REMAINS. Six hundred pixels at the top of the page, shrinking to
 *    three hundred as you scroll, and then it simply stays — the page
 *    travels underneath it.
 *
 *    THE JITTER GOES. It used to shrink IN THE FLOW, so everything below
 *    it rose by 300px OVER AND ABOVE the distance scrolled — content
 *    moving at 1.7x the speed of the wheel, which is exactly what
 *    "severe motion jitter" describes. Out of flow, nothing below it
 *    moves at all except by scrolling.
 *
 *    THE DOCUMENT'S HEIGHT IS CONSTANT BY CONSTRUCTION. The slot is a
 *    plain 600px box that never changes, so there is no longer any way
 *    for the hero's size to feed back into how far the page can scroll.
 *    The body-padding compensation that used to do that job by
 *    arithmetic is gone, and so is the class of bug it was patching.
 *
 *    AND THERE IS NOTHING LEFT TO HOLD AGAINST THE SCROLL. --pan is gone
 *    with it: a fixed element does not move, so the picture inside it
 *    does not either. That was thirty lines and a translate per frame,
 *    emulating what `position: fixed` does for nothing.
 *
 *  THE MEDIA CAN BE EITHER, and that is the only thing that varies: the
 *  club's own film on the front page, a photograph on Impressionen. It
 *  is held at the full 600 and anchored to the TOP, so as the hero
 *  shrinks it is the BOTTOM of the picture that is clipped away — which
 *  is the whole point of the Impressionen crop, where the faces are near
 *  the top and it is the grass that can go.
 */

/** How far you scroll before it has finished shrinking. Long enough to be
 *  a settle rather than a snap; short enough to be over before the first
 *  content is on screen. */
const SHRINK_OVER = 420;

interface HeroProps {
  title: string;
  /** A still photograph, or the club's film with a poster frame. */
  image?: string;
  video?: string;
  poster?: string;
}

export default function Hero({ title, image, video, poster }: HeroProps) {
  const film = useRef<HTMLVideoElement>(null);
  const timer = useRef<number | undefined>(undefined);

  /** ONE NUMBER, WRITTEN ON THE DOCUMENT.
   *
   *  --grow is 1 at the top of the page and 0 once you have scrolled
   *  past SHRINK_OVER. The stylesheet turns it into a height; nothing
   *  here knows what 600 or 300 are, which is why they can be argued
   *  about in one place.
   *
   *  Written inside requestAnimationFrame: scroll fires far more often
   *  than the screen redraws, and setting a style on every event is how
   *  a page starts to feel heavy on a phone.
   *
   *  NO prefers-reduced-motion BRANCH, AND THAT WAS THE BUG THAT COST
   *  DAYS. There was one, and it pinned --grow to 0 and returned — so on
   *  any machine asking for reduced motion, which Windows does whenever
   *  "Show animations in Windows" is off, the hero sat at its SMALL
   *  height for ever and never reached its full one. Measured with
   *  Playwright's reduced_motion="reduce": 300 at rest, 300 scrolled,
   *  ratio 1.00, against 600/300/2.00 in an ordinary browser on the same
   *  build. Every earlier round of "the size is STILL not what I told
   *  you" was that branch, and I kept measuring in the one browser that
   *  could not see it.
   *
   *  The shrink is a direct response to the reader's own scrolling —
   *  nothing moves unless they move it. What stays behind the preference
   *  is the film starting ITSELF on hover, which is motion nobody asked
   *  for. See hoverIn. */
  useEffect(() => {
    const docEl = document.documentElement;

    let frame = 0;
    const apply = () => {
      frame = 0;
      const grow =
        1 - Math.min(1, Math.max(0, window.scrollY / SHRINK_OVER));
      docEl.style.setProperty("--grow", grow.toFixed(3));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
      // Back to 1 — "nothing has shrunk" — because --grow lives on the
      // document and would otherwise outlive this hero onto a page that
      // has none.
      docEl.style.setProperty("--grow", "1");
    };
  }, []);

  /** THE FILM STARTS ON A CLICK ANYWHERE, or three seconds of hover.
   *  Nothing moves, resizes or appears when it does: the poster is the
   *  film's own first frame, so it is the picture coming to life.
   *
   *  MUTED, and that is not timidity. A hover is not a user gesture as
   *  far as a browser is concerned, so an unmuted play() on hover is
   *  simply refused; and a page that starts talking because a cursor
   *  rested on it is a page people close. */
  const start = () => {
    const el = film.current;
    if (!el || !el.paused) return;
    el.play().catch(() => {
      /* Refused — the poster frame stays, which is a perfectly good hero.
         Nothing to report and nothing the visitor can do. */
    });
  };
  const hoverIn = () => {
    if (!video) return;
    // THIS is what the reduced-motion preference properly governs: a film
    // that starts ITSELF because a cursor came to rest. A click still
    // starts it, because a click is somebody asking.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(start, 3000);
  };
  const hoverOut = () => window.clearTimeout(timer.current);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    /* THE SLOT holds the hero's place in the document, at the full height,
       for ever. It is what everything below the hero is positioned
       against, and it never changes size — which is why the page's
       scrollable length no longer depends on the hero at all. */
    <div className="heroslot">
      <section
        className="hero"
        onClick={video ? start : undefined}
        onMouseEnter={hoverIn}
        onMouseLeave={hoverOut}
      >
        {video ? (
          <video
            ref={film}
            className="heromedia"
            src={video}
            poster={poster}
            /* preload="auto" on a 15.7 MB file means the network never
               goes idle on this page. That is deliberate — the film
               should be ready when somebody clicks — but it is also why
               any Playwright probe here must wait for "load" and never
               "networkidle". */
            preload="auto"
            muted
            loop
            /* playsInline stops iOS taking the video fullscreen the
               instant it plays, which would throw the visitor out of the
               page. */
            playsInline
            /* It is scenery. Announcing it, or letting the tab key land
               on it, offers a control that does nothing anybody needs. */
            aria-hidden="true"
            tabIndex={-1}
          />
        ) : (
          <div
            className="heromedia"
            aria-hidden="true"
            style={{ backgroundImage: `url(${image})` }}
          />
        )}

        <div className="scrim" aria-hidden="true" />

        <div className="heroinner">
          <h1>{title}</h1>
        </div>
      </section>
    </div>
  );
}

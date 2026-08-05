import { useEffect, useRef } from "react";

/** THE hero. One implementation, every page that has one.
 *
 *  There were two — the front page's video banner and a separate one
 *  written for Impressionen — and they had already drifted into different
 *  sizes, different behaviour and different markup. "why the fuck are
 *  those two separate implementations?" There is no answer to that; a
 *  hero is a hero.
 *
 *  WHAT IT DOES, identically wherever it is used:
 *
 *    Full window width, whatever measure the page is set in.
 *    TWICE AS HIGH at the top, settling to its normal size as you scroll.
 *    FIXED AGAINST SCROLLING — the picture stays put and the page travels
 *    over it.
 *    The page's heading sits IN it, slightly transparent with the shadow
 *    on the glyphs.
 *
 *  THE MEDIA CAN BE EITHER, and that is the only thing that varies: the
 *  club's own film on the front page, a photograph on Impressionen.
 *
 *  IT IS RENDERED OUTSIDE <main>, ALWAYS. That is not a detail of taste:
 *  the previous version reached full width with `width: 100vw` and a
 *  negative margin, and 100vw INCLUDES the vertical scrollbar — so the
 *  hero was some fifteen pixels wider than the page and put a horizontal
 *  scrollbar on the whole site. Worse, `calc(50% - 50vw)` resolves
 *  against whatever box it happens to sit in, so nested inside the
 *  Impressionen column it behaved differently from the front page's,
 *  which is how the same component came to look like two. A top-level
 *  element is full width for nothing, on both pages, with no arithmetic
 *  to get wrong.
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
  const root = useRef<HTMLElement>(null);
  const film = useRef<HTMLVideoElement>(null);
  const timer = useRef<number | undefined>(undefined);

  /** SHRINK, AND STAY PUT.
   *
   *  Two numbers, both written as custom properties so the stylesheet
   *  keeps the arithmetic:
   *
   *    --grow  1 at the top of the page, 0 once you have scrolled past.
   *            The height is interpolated from it, and because the large
   *            height is stated as exactly twice the small one, "twice as
   *            high at the top" is a property of the stylesheet rather
   *            than of a number somebody typed here.
   *    --pan   how far to push the media DOWN. The hero's top edge is
   *            travelling up by exactly scrollY, so pushing the media
   *            down by the same amount leaves it standing still in the
   *            window — which is what "fixed against scrolling" means,
   *            and unlike background-attachment: fixed it also works on
   *            iOS and works for a <video>.
   *
   *  Written inside requestAnimationFrame: scroll fires far more often
   *  than the screen redraws, and setting styles on every event is how a
   *  page starts to feel heavy on a phone.
   *
   *  Reduced motion gets the small hero, standing still, no movement. */
  useEffect(() => {
    const el = root.current;
    if (!el) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.setProperty("--grow", "0");
      el.style.setProperty("--pan", "0px");
      return;
    }

    let frame = 0;
    const apply = () => {
      frame = 0;
      const y = window.scrollY;
      const grow = 1 - Math.min(1, Math.max(0, y / SHRINK_OVER));
      el.style.setProperty("--grow", grow.toFixed(3));
      // Only while the hero is still on screen; past that it is clipped
      // away and there is nothing to hold still.
      el.style.setProperty("--pan", `${Math.min(y, el.offsetHeight)}px`);
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
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(start, 3000);
  };
  const hoverOut = () => window.clearTimeout(timer.current);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <section
      className="hero"
      ref={root}
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
          /* preload="auto" on a 15.7 MB file means the network never goes
             idle on this page. That is deliberate — the film should be
             ready when somebody clicks — but it is also why any Playwright
             probe here must wait for "load" and never "networkidle". */
          preload="auto"
          muted
          loop
          /* playsInline stops iOS taking the video fullscreen the instant
             it plays, which would throw the visitor out of the page. */
          playsInline
          /* It is scenery. Announcing it, or letting the tab key land on
             it, offers a control that does nothing anybody needs. */
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
  );
}

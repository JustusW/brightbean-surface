import { Swiper, SwiperSlide } from "swiper/react";
import {
  A11y,
  Keyboard,
  Mousewheel,
  Navigation,
  Pagination,
  Zoom,
} from "swiper/modules";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";
import "swiper/css/zoom";
import type { FeedMedia } from "./api";

/** THE gallery. It is a gallery ON THE PAGE, not a row that opens one.
 *
 *  "the posts on the mainpage are supposed to be in a gallery. not in a
 *  flat bullshit display that opens a gallery on click. the same fucking
 *  thing for impressionen. except there the gallery flows out to full
 *  width and may display multiple images at the same time as they fit."
 *
 *  ONE PACKAGE. Swiper does the gallery AND the zoom, so there is no
 *  slider-plus-lightbox pair to patch, style and keep agreeing with each
 *  other. It arrives through npm and Vite bundles it into our own assets,
 *  exactly as the fonts are: this origin and the club's media host, and
 *  nothing else.
 *
 *  EVERY PARAMETER BELOW WAS READ, NOT ASSUMED. The first version set
 *  maxRatio and left everything else on its default, which is how a
 *  gallery ends up with a zoom that cannot be panned and a row whose last
 *  picture sits half off the edge. The whole of swiperjs.com/swiper-api
 *  is why each line is here; the ones that matter say so.
 */
export default function PhotoGallery({ media }: { media: FeedMedia[] }) {
  if (media.length === 0) return null;

  const many = media.length > 1;

  return (
    <Swiper
      className="gal"
      modules={[Navigation, Pagination, Keyboard, Mousewheel, Zoom, A11y]}
      /* Natural width per slide at a shared height, so AS MANY AS FIT
         stand side by side. This is the line that lets one component
         serve both places: the page decides the room, the gallery fills
         it — a post card shows a couple, Impressionen shows several, and
         nothing here is told which it is in. */
      slidesPerView="auto"
      spaceBetween={8}
      /* EXISTS FOR slidesPerView: 'auto', and the documentation says so:
         "prevents partial slides from appearing misaligned at the end of
         the swiper". Without it the row stops at an arbitrary position
         and the last picture sits half cut off, which reads as breakage
         rather than as more to come. */
      snapToSlideEdge
      /* Move by a viewful rather than by one picture. slidesPerGroupAuto
         is documented as being for exactly this pair — slidesPerView
         'auto' with slidesPerGroup 1 — and it skips only the slides
         already IN VIEW, so nothing is stepped over unseen. */
      slidesPerGroup={1}
      slidesPerGroupAuto
      /* When there are fewer pictures than fit — three posters across a
         1600px page — centre them instead of leaving them pinned left
         with a hole on the right. */
      centerInsufficientSlides
      /* Says it can be dragged, on a desktop, where there is no other
         hint. Default is false. */
      grabCursor
      /* Click a picture that is only half in view and it comes fully in.
         Double-click is the zoom, so the two do not fight. */
      slideToClickedSlide
      navigation={many}
      /* DYNAMIC BULLETS, because this club will have forty photographs
         before long and forty bullets is a smear. The documentation:
         "Good to enable if you use bullets pagination with a lot of
         slides." */
      pagination={
        many ? { clickable: true, dynamicBullets: true, dynamicMainBullets: 3 } : false
      }
      /* onlyInViewport stays at its default true: a page can hold several
         of these, and the arrow keys should drive the one being looked
         at rather than all of them at once. */
      keyboard={{ enabled: true }}
      /* forceToAxis is what makes this polite: only a HORIZONTAL wheel or
         trackpad gesture moves the gallery, so ordinary vertical
         scrolling still scrolls the page. releaseOnEdges hands the page
         back once the row has run out. */
      mousewheel={{ forceToAxis: true, releaseOnEdges: true }}
      /* READ OFF THE ZOOM MODULE'S OWN PARAMETERS.
       *
       *   panOnMouseMove defaults to FALSE, so a zoomed picture could not
       *   be moved with a mouse at all — on a desktop that is most of
       *   what zooming a poster is for.
       *
       *   limitToOriginalSize defaults to FALSE, so it would magnify past
       *   the real pixels into a blur. Measured: these posters are
       *   1707x2560 and render 432 wide, so just under 4x IS their
       *   original size — past that there is nothing more to see.
       *
       *   toggle stays true: double-click and double-tap.
       */
      zoom={{ maxRatio: 4, panOnMouseMove: true, limitToOriginalSize: true }}
      /* Read aloud, and in German, because the page is German. */
      a11y={{
        prevSlideMessage: "Vorheriges Bild",
        nextSlideMessage: "Nächstes Bild",
        firstSlideMessage: "Erstes Bild",
        lastSlideMessage: "Letztes Bild",
        paginationBulletMessage: "Zu Bild {{index}} springen",
        containerRoleDescriptionMessage: "Bildergalerie",
        itemRoleDescriptionMessage: "Bild",
        slideLabelMessage: "Bild {{index}} von {{slidesLength}}",
      }}
      /* No looping. A gallery that wraps round silently means you cannot
         tell whether you have seen everything. */
      loop={false}
    >
      {media.map((m, i) => (
        <SwiperSlide key={i}>
          {/* swiper-zoom-container is what the Zoom module looks for.
              Without it the picture shows and never magnifies. */}
          <div className="swiper-zoom-container">
            <img
              src={m.url}
              /* Alt text comes from the media library, where somebody
                 wrote one. An empty alt is correct for a decorative
                 image and far better than inventing a description of a
                 photograph nobody here has seen. */
              alt={m.alt}
              /* Since Swiper 9 lazy loading IS the browser's own, with
                 the preloader element below as the spinner. */
              loading={i < 4 ? "eager" : "lazy"}
              decoding="async"
            />
          </div>
          <div className="swiper-lazy-preloader" />
        </SwiperSlide>
      ))}
    </Swiper>
  );
}

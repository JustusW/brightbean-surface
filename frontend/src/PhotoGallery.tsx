import { useEffect, useState } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import {
  A11y,
  EffectCoverflow,
  Keyboard,
  Mousewheel,
  Navigation,
  Pagination,
  Zoom,
} from "swiper/modules";
import "swiper/css";
import "swiper/css/effect-coverflow";
import "swiper/css/navigation";
import "swiper/css/pagination";
import "swiper/css/zoom";
import type { FeedMedia } from "./api";

/** The gallery, in two layers.
 *
 *  ON THE PAGE: a coverflow gallery with its own arrows, pagination,
 *  keyboard and drag, over an out-of-focus copy of the picture you are
 *  looking at.
 *
 *  FULL SCREEN: click any picture and it opens filling the window, where
 *  it can be zoomed to its real pixels AND still navigated — arrows,
 *  keyboard and swipe all keep working while zoomed in. That is the layer
 *  the inline gallery cannot be: zoom happens inside a slide, and a slide
 *  on a post card is 307px wide, so magnifying a 1707px poster there is
 *  reading it through a slot.
 *
 *  ONE PACKAGE for both layers. Swiper does the gallery, the 3D effect,
 *  the zoom and the panning; there is no second library to patch or keep
 *  in step. npm, bundled by Vite into our own assets — this origin and
 *  the club's media host, nothing else.
 */

/** Shared by both layers, so the zoom behaves identically in each.
 *  panOnMouseMove and limitToOriginalSize are both FALSE by default:
 *  without the first a zoomed picture cannot be moved with a mouse, and
 *  without the second it magnifies past the real pixels into a blur. */
const ZOOM = { maxRatio: 4, panOnMouseMove: true, limitToOriginalSize: true };

const A11Y = {
  prevSlideMessage: "Vorheriges Bild",
  nextSlideMessage: "Nächstes Bild",
  firstSlideMessage: "Erstes Bild",
  lastSlideMessage: "Letztes Bild",
  paginationBulletMessage: "Zu Bild {{index}} springen",
  containerRoleDescriptionMessage: "Bildergalerie",
  itemRoleDescriptionMessage: "Bild",
  slideLabelMessage: "Bild {{index}} von {{slidesLength}}",
};

export default function PhotoGallery({ media }: { media: FeedMedia[] }) {
  // Which picture the backdrop shows. An index rather than the object, so
  // it survives the feed reloading with different media.
  const [active, setActive] = useState(0);
  // Which picture the full-screen view is open on; null means closed.
  const [open, setOpen] = useState<number | null>(null);

  // ESCAPE CLOSES IT, and the page underneath does not scroll while it is
  // open — a full-screen viewer you can scroll the page behind is a
  // viewer that loses your place.
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (media.length === 0) return null;

  const many = media.length > 1;
  const behind = media[Math.min(active, media.length - 1)];

  return (
    <>
      <Swiper
        className="gal"
        modules={[
          Navigation,
          Pagination,
          Keyboard,
          Mousewheel,
          Zoom,
          EffectCoverflow,
          A11y,
        ]}
        effect="coverflow"
        /* Coverflow turns the slides around the one it is centred on, so
           it needs one to be centred. */
        centeredSlides
        coverflowEffect={{
          rotate: 32,
          stretch: 0,
          depth: 140,
          modifier: 1,
          slideShadows: true,
        }}
        /* Natural width per slide at a shared height, so as many as fit
           are shown. It is what lets one component serve both places: the
           page decides the room and the gallery fills it. */
        slidesPerView="auto"
        spaceBetween={8}
        /* Exists for slidesPerView 'auto': stops a partial slide sitting
           misaligned at the end of the row. */
        snapToSlideEdge
        slidesPerGroup={1}
        slidesPerGroupAuto
        grabCursor
        navigation={many}
        pagination={
          many
            ? { clickable: true, dynamicBullets: true, dynamicMainBullets: 3 }
            : false
        }
        keyboard={{ enabled: true }}
        /* forceToAxis: a horizontal trackpad gesture moves the gallery,
           and ordinary vertical scrolling still scrolls the page. */
        mousewheel={{ forceToAxis: true, releaseOnEdges: true }}
        a11y={A11Y}
        loop={false}
        onSlideChange={(s) => setActive(s.activeIndex)}
        /* CLICK OPENS THE FULL-SCREEN VIEW. clickedIndex is Swiper's own
           record of which slide was hit, so clicking a picture that is
           only half in view opens THAT one rather than the centred one. */
        onClick={(s) => {
          if (typeof s.clickedIndex === "number") setOpen(s.clickedIndex);
        }}
      >
        {/* The out-of-focus background: the picture in front of you,
            blurred and darkened, filling everything the slides do not.
            slot="container-start" is Swiper's own way of putting an
            element inside the container rather than among the slides.
            Decorative — it is the same photograph again. */}
        <div
          slot="container-start"
          className="galbg"
          aria-hidden="true"
          style={{ backgroundImage: `url(${behind.url})` }}
        />

        {media.map((m, i) => (
          <SwiperSlide key={i}>
            <img
              src={m.url}
              /* Alt text comes from the media library, where somebody
                 wrote one. An empty alt is correct for a decorative image
                 and better than inventing a description of a photograph
                 nobody here has seen. */
              alt={m.alt}
              loading={i < 4 ? "eager" : "lazy"}
              decoding="async"
            />
            <div className="swiper-lazy-preloader" />
          </SwiperSlide>
        ))}
      </Swiper>

      {open !== null && (
        <div className="galfull" role="dialog" aria-modal="true" aria-label="Bilder">
          <button
            className="galclose"
            onClick={() => setOpen(null)}
            aria-label="Schließen"
          >
            ✕
          </button>

          <Swiper
            className="galfullswiper"
            modules={[Navigation, Pagination, Keyboard, Zoom, A11y]}
            initialSlide={open}
            slidesPerView={1}
            centeredSlides
            spaceBetween={24}
            navigation={many}
            pagination={many ? { type: "fraction" } : false}
            /* onlyInViewport false: this fills the window, and the arrow
               keys must drive it wherever the focus happens to be. */
            keyboard={{ enabled: true, onlyInViewport: false }}
            /* THE POINT OF THIS LAYER. The slide is now the whole window,
               so zooming to the poster's real pixels shows a readable
               piece of it rather than a slot — and navigation stays live
               while zoomed. */
            zoom={ZOOM}
            a11y={A11Y}
            loop={false}
          >
            {media.map((m, i) => (
              <SwiperSlide key={i}>
                {/* swiper-zoom-container is what the Zoom module looks
                    for. Without it the picture shows and never
                    magnifies. */}
                <div className="swiper-zoom-container">
                  <img src={m.url} alt={m.alt} decoding="async" />
                </div>
              </SwiperSlide>
            ))}
          </Swiper>
        </div>
      )}
    </>
  );
}

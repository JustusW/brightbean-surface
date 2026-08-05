import { Swiper, SwiperSlide } from "swiper/react";
import { A11y, Keyboard, Navigation, Pagination, Zoom } from "swiper/modules";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";
import "swiper/css/zoom";
import type { FeedMedia } from "./api";

/** THE gallery. It is a gallery ON THE PAGE, not a row that opens one.
 *
 *  THAT DISTINCTION IS THE WHOLE INSTRUCTION, and it took being spelled
 *  out before I built it: "the posts on the mainpage are supposed to be
 *  in a gallery. not in a flat bullshit display that opens a gallery on
 *  click. the same fucking thing for impressionen. except there the
 *  gallery flows out to full width and may display multiple images at
 *  the same time as they fit."
 *
 *  ONE PACKAGE, NOT TWO. There were briefly two — a slider for the page
 *  and a lightbox for the zooming — and that is two things to patch, two
 *  stylesheets and two ideas of what a gallery is, for one job. Swiper
 *  does both: the gallery with its arrows, pagination, keyboard and drag,
 *  AND the zoom, with the navigation still working while zoomed, which
 *  was the defect that started all this.
 *
 *  NOT A CDN. It arrives through npm and Vite bundles it into our own
 *  assets, exactly as the fonts are — a visitor's browser contacts this
 *  origin and the club's media host, and nothing else.
 *
 *  ONE COMPONENT SERVES BOTH PLACES. slidesPerView="auto" means every
 *  picture keeps its own width at a shared height and as many as fit are
 *  shown — so the same code shows a couple on a post card and five
 *  across the full width of Impressionen, with no branching here. The
 *  page decides the room; the gallery fills it.
 */
export default function PhotoGallery({ media }: { media: FeedMedia[] }) {
  if (media.length === 0) return null;

  const many = media.length > 1;

  return (
    <Swiper
      className="gal"
      modules={[Navigation, Pagination, Keyboard, Zoom, A11y]}
      // Natural width per slide at a shared height, and as many as fit.
      slidesPerView="auto"
      spaceBetween={8}
      // Step by ONE picture. A screenful is a different number of
      // pictures at every page width, and stepping by it skips things.
      slidesPerGroup={1}
      navigation={many}
      pagination={many ? { clickable: true } : false}
      keyboard={{ enabled: true }}
      // DOUBLE-TAP, PINCH AND WHEEL, and the arrows keep working while
      // zoomed — which is the whole reason a plugin is doing this rather
      // than the overlay I hand-wrote.
      zoom={{ maxRatio: 4 }}
      a11y={{
        prevSlideMessage: "Vorheriges Bild",
        nextSlideMessage: "Nächstes Bild",
        firstSlideMessage: "Erstes Bild",
        lastSlideMessage: "Letztes Bild",
        paginationBulletMessage: "Zu Bild {{index}} springen",
        containerRoleDescriptionMessage: "Bildergalerie",
        itemRoleDescriptionMessage: "Bild",
      }}
      // No looping. A gallery that wraps round silently means you cannot
      // tell whether you have seen everything.
      loop={false}
    >
      {media.map((m, i) => (
        <SwiperSlide key={i}>
          {/* swiper-zoom-container is what Swiper's Zoom module looks
              for. Without it the picture shows and never magnifies. */}
          <div className="swiper-zoom-container">
            <img
              src={m.url}
              /* Alt text comes from the media library, where somebody
                 wrote one. An empty alt is correct for a decorative
                 image and far better than inventing a description of a
                 photograph nobody here has seen. */
              alt={m.alt}
              loading={i < 4 ? "eager" : "lazy"}
              decoding="async"
            />
          </div>
        </SwiperSlide>
      ))}
    </Swiper>
  );
}

import { useEffect, useState } from "react";
import Hero from "./Hero";
import PhotoGallery from "./PhotoGallery";
import { api, type FeedMedia } from "./api";

/** Impressionen — every picture the club has published.
 *
 *  THE SAME PARTS AS THE FRONT PAGE, and that is the point: the same
 *  <Hero> and the same <PhotoGallery>, given a different picture and a
 *  wider measure. There were briefly two of each, drifting apart into
 *  different sizes and different behaviour, which is how a site stops
 *  looking like one site.
 *
 *  This file fetches, handles its three states, and arranges those two
 *  components. It draws nothing itself.
 */
export default function Gallery({ title }: { title: string }) {
  const [images, setImages] = useState<FeedMedia[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .gallery()
      .then((r) => setImages(r.images))
      .catch(() => setFailed(true));
  }, []);

  return (
    <section className="gallery">
      {/* The club's own photograph — members watching something fly,
          which is what this page is about — cut down to thirty pixels
          above the first hat so the frame opens on the people rather
          than on empty sky. Vendored into our own assets rather than
          linked from where it was found. */}
      <Hero title={title} image="/impressionen-hero.jpg" />

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

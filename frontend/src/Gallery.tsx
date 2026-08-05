import { useEffect, useState } from "react";
import Carousel from "./Carousel";
import { api, type FeedMedia } from "./api";

/** Impressionen — every picture the club has published.
 *
 *  THE SAME GALLERY AS THE FRONT PAGE, given the full page width. The
 *  shepherd's instruction, after seeing the two side by side: "please use
 *  the same gallery in both places just with one being granted the full
 *  width."
 *
 *  What was here before was a second implementation — a CSS multi-column
 *  wall of raw tiles — and it did not look like the same website. Worse,
 *  it reproduced the thing that was thrown out in the first place: three
 *  event posters standing up as tall portrait slabs, which is exactly the
 *  vertical format the reference site was criticised for.
 *
 *  So this file no longer draws anything. It fetches, handles the three
 *  states, and hands the pictures to Carousel. The width comes from
 *  <main className="wide"> in App.tsx, and the slide is given a viewport
 *  height there rather than a 16:10 box — at 1600px wide that ratio would
 *  be a thousand pixels tall and you would scroll to see one picture.
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
      <h1>{title}</h1>

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

      {images && images.length > 0 && <Carousel media={images} />}
    </section>
  );
}

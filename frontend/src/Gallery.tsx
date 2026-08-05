import { useEffect, useState } from "react";
import { api, type FeedMedia } from "./api";

/** Impressionen — every picture the club has published.
 *
 *  FULL PAGE WIDTH, AND NOT A CAROUSEL. The reference site put its
 *  gallery in one, which means seeing forty pictures costs forty
 *  clicks and you can never see two at once. A grid shows the lot; a
 *  carousel shows one and hides the rest behind an arrow.
 *
 *  MASONRY BY COLUMNS, so nothing is cropped. CSS multi-column fills
 *  top to bottom rather than left to right, which reads slightly oddly
 *  for a list and is exactly right for a picture wall — each image keeps
 *  its own shape and the columns simply come out different lengths.
 */
export default function Gallery({ title }: { title: string }) {
  const [images, setImages] = useState<FeedMedia[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<FeedMedia | null>(null);

  useEffect(() => {
    api
      .gallery()
      .then((r) => setImages(r.images))
      .catch(() => setFailed(true));
  }, []);

  // ESCAPE CLOSES THE VIEWER. A full-screen overlay with no keyboard way
  // out is a trap for anybody not using a mouse.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <section className="gallery">
      <h1>{title}</h1>

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

      {images && images.length > 0 && (
        <div className="wall">
          {images.map((m, i) => (
            <button
              className="tile"
              key={i}
              onClick={() => setOpen(m)}
              aria-label={m.alt || `Bild ${i + 1} vergrößern`}
            >
              <img
                src={m.url}
                alt={m.alt}
                width={m.width || undefined}
                height={m.height || undefined}
                /* The first screenful eagerly, the rest on approach: a
                   club with two hundred photographs should not send all
                   two hundred to somebody who looks at four. */
                loading={i < 6 ? "eager" : "lazy"}
                decoding="async"
              />
            </button>
          ))}
        </div>
      )}

      {open && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Bild"
          onClick={() => setOpen(null)}
        >
          <img src={open.url} alt={open.alt} />
          <button className="close" aria-label="Schließen">
            ✕
          </button>
        </div>
      )}
    </section>
  );
}

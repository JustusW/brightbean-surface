import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
/* THE MARKER'S OWN PICTURES, IMPORTED SO THE BUNDLER CAN SEE THEM.
 *
 * Without these the pin is a broken image and the browser asks for
 * /marker-icon.png, which does not exist. Leaflet's default icon builds
 * its URLs AT RUNTIME by finding its own stylesheet and walking to
 * ../images/ beside it — an assumption that holds when leaflet.css is
 * served from node_modules and fails the moment a bundler rewrites the
 * CSS into a hashed asset, which is exactly what Vite does.
 *
 * Imported as modules, Vite emits all three into our own /assets with
 * content-hashed names and hands back the real URLs. That keeps the
 * single-origin rule intact: OSM serves the map TILES and nothing else
 * — no unpkg, no cdnjs, no third party for a 1.5 kB pin. */
import pinUrl from "leaflet/dist/images/marker-icon.png";
import pinRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import pinShadowUrl from "leaflet/dist/images/marker-shadow.png";

/** Where the field is, and how to get to it.
 *
 *  THE OLD SITE HAD A MAP AND WE HAD NOTHING — Platz und Anfahrt was a
 *  page of prose with a Google Maps link at the bottom and not one
 *  picture. "Platz und Anfahrt still has no images, no OSM, nothing."
 *
 *  OpenStreetMap, and that is a settled decision rather than a
 *  preference: the club's Datenschutzerklärung already declares OSM by
 *  name — "Bei der Nutzung der OpenStreetMap-Karten wird eine Verbindung
 *  zu den Servern der OpenStreetMap-Foundation hergestellt" — so a
 *  visitor has been told, in the document that governs this site, that
 *  the map talks to the OSMF. It is the one third party this site has,
 *  and it is the one the paperwork covers.
 *
 *  LEAFLET COMES THROUGH npm, NOT A CDN. The standing rule is that
 *  everything is vendored: unpkg is where most Leaflet examples get it,
 *  and using one would hand a visitor's address to a third party that
 *  the privacy policy does NOT mention. Vite bundles the library and its
 *  stylesheet into our own assets; only the map tiles come from OSM.
 *
 *  EASIER TO USE THAN THE ONE IT REPLACES, which was the brief. The old
 *  plugin dropped you at a fixed zoom with no marker and no way to get
 *  directions. This one names the field, marks it, and hands off to
 *  routing that already knows where you are.
 */

/** The field, from the club's own page: 49.0797790185139, 8.474364846239842
 *  — a kilometre north of Blankenloch, between the L560 and the L559. */
const FIELD: [number, number] = [49.07977901851, 8.47436484623];

/** The pin, built explicitly rather than left to L.Icon.Default.
 *
 *  THE SIZES ARE LEAFLET'S OWN and are not decoration: the icon is
 *  25x41, and the anchor at [12, 41] is what puts the POINT of the pin
 *  on the coordinate instead of its top-left corner — get that wrong and
 *  the marker sits twenty metres north-west of the runway. popupAnchor
 *  lifts the bubble clear of the pin's head. */
const PIN = L.icon({
  iconUrl: pinUrl,
  iconRetinaUrl: pinRetinaUrl,
  shadowUrl: pinShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export default function Anfahrt() {
  const box = useRef<HTMLDivElement>(null);
  const made = useRef(false);

  useEffect(() => {
    const el = box.current;
    // StrictMode mounts effects twice in development, and Leaflet throws
    // "Map container is already initialized" on the second. A guard is
    // cheaper than tearing the map down and rebuilding it.
    if (!el || made.current) return;
    made.current = true;

    const map = L.map(el, {
      center: FIELD,
      zoom: 14,
      // The page scrolls; a map that swallows the wheel traps somebody
      // halfway down and is the single most complained-about thing an
      // embedded map does. Ctrl+wheel still zooms, and so do the
      // buttons and a pinch.
      scrollWheelZoom: false,
    });

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      // REQUIRED by the OSM tile usage policy, and it is also just
      // correct: somebody drew these roads for nothing.
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">' +
        "OpenStreetMap</a>-Mitwirkende",
    }).addTo(map);

    L.marker(FIELD, { icon: PIN })
      .addTo(map)
      .bindPopup(
        "<strong>Modellflugplatz Blankenloch</strong><br>" +
          "Start- und Landebahn 280 m, Nord–Süd",
      )
      .openPopup();

    return () => {
      map.remove();
      made.current = false;
    };
  }, []);

  return (
    <section className="anfahrt">
      <h2>Auf der Karte</h2>
      {/* role="application" so a screen reader hands the arrow keys to
          the map rather than scrolling the page with them, and a label
          because "map" alone tells somebody nothing about which map. */}
      <div
        className="karte"
        ref={box}
        role="application"
        aria-label="Karte des Modellflugplatzes Blankenloch"
      />

      <p className="anfahrtwege">
        <a
          href={`https://www.openstreetmap.org/directions?to=${FIELD[0]},${FIELD[1]}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          Route auf OpenStreetMap berechnen
        </a>
        <a
          href="https://maps.app.goo.gl/DSkaGCU3dxKsorAy6"
          target="_blank"
          rel="noreferrer noopener"
        >
          In Google Maps öffnen
        </a>
      </p>

      <h2>Anfahrtsskizze</h2>
      {/* The club's own drawing, and better than the map at the one thing
          that actually matters on arrival: WHICH of the two approaches to
          take, and where the pedestrian crossing is. Vendored into our
          own assets rather than linked from the old WordPress. */}
      <figure className="skizze">
        <img
          src="/anfahrtskizze.jpg"
          alt="Handgezeichnete Anfahrtsskizze: die Zufahrt von der L 560
               über Blankenloch in Blau, die Zufahrt vom Schloss Stutensee
               über die Fußgängerampel in Rot, mit dem Flugplatz in der
               Mitte."
          loading="lazy"
          decoding="async"
        />
        <figcaption>
          Blau: von Blankenloch über die L 560. Rot: vom Schloss Stutensee,
          über die Fußgängerampel.
        </figcaption>
      </figure>
    </section>
  );
}

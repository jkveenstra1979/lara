"use client";

import { useEffect, useRef } from "react";
import { Map as MapLibreMap, LngLatBounds, NavigationControl, setWorkerUrl } from "maplibre-gl";
import type { Feature, Geometry } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import styles from "./detail.module.css";

/**
 * Eén volume op de kaart: de vorm, zijn hoekpunten, en de kaart eromheen
 * gepast. Meer niet — geen lagen, geen obstakels, geen 3D. De brontool heeft
 * daar 1424 regels voor; hier is het één polygoon.
 *
 * De achtergrond komt van OpenStreetMap. Dat is het enige externe verzoek dat
 * de applicatie doet; fonts en alle andere assets zitten lokaal.
 */

const BRON = "gebied";

/**
 * MapLibre draait het zware werk in een web worker en laadt die met een URL die
 * de bundler invult. Turbopack laat dat bestand buiten de build, waardoor de
 * browser een 404-pagina terugkrijgt en weigert die als module uit te voeren:
 * "non-JavaScript MIME type of text/html".
 *
 * De worker staat daarom als gewoon bestand in public/, neergezet door
 * scripts/kopieer-maplibre-worker.mjs bij elke install en build.
 */
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

/** Alle punten van een geometrie, ongeacht of het een Polygon of MultiPolygon is. */
function allePunten(geometrie: Geometry): [number, number][] {
  const uit: [number, number][] = [];
  const loop = (waarde: unknown) => {
    if (!Array.isArray(waarde)) return;
    if (typeof waarde[0] === "number" && typeof waarde[1] === "number") {
      uit.push([waarde[0], waarde[1]]);
      return;
    }
    for (const deel of waarde) loop(deel);
  };
  if ("coordinates" in geometrie) loop(geometrie.coordinates);
  return uit;
}

export default function GebiedKaart({
  feature,
  label,
}: {
  feature: Feature<Geometry> | null;
  label: string;
}) {
  const houder = useRef<HTMLDivElement>(null);
  const kaart = useRef<MapLibreMap | null>(null);

  useEffect(() => {
    if (!houder.current || kaart.current) return;

    kaart.current = new MapLibreMap({
      container: houder.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [5.3, 52.1],
      zoom: 6,
      attributionControl: false,
    });

    kaart.current.addControl(new NavigationControl({ showCompass: false }), "top-right");

    return () => {
      kaart.current?.remove();
      kaart.current = null;
    };
  }, []);

  // De vorm tekenen en de kaart erop passen; draait opnieuw bij elke volumewissel.
  useEffect(() => {
    const map = kaart.current;
    if (!map) return;

    const teken = () => {
      for (const laag of ["gebied-vlak", "gebied-lijn", "gebied-punten"]) {
        if (map.getLayer(laag)) map.removeLayer(laag);
      }
      if (map.getSource(BRON)) map.removeSource(BRON);
      if (!feature?.geometry) return;

      map.addSource(BRON, { type: "geojson", data: feature });

      const accent = getComputedStyle(document.documentElement)
        .getPropertyValue("--action")
        .trim() || "#3f3d8f";

      map.addLayer({
        id: "gebied-vlak",
        type: "fill",
        source: BRON,
        paint: { "fill-color": accent, "fill-opacity": 0.14 },
      });
      map.addLayer({
        id: "gebied-lijn",
        type: "line",
        source: BRON,
        paint: { "line-color": accent, "line-width": 1.6 },
      });
      // De hoekpunten zichtbaar maken: bij een geïnterpoleerde boog wil je zien
      // hoeveel punten er werkelijk de export in gaan.
      map.addLayer({
        id: "gebied-punten",
        type: "circle",
        source: BRON,
        paint: { "circle-radius": 2.6, "circle-color": accent },
      });

      const punten = allePunten(feature.geometry);
      if (punten.length) {
        const grenzen = punten.reduce(
          (b, p) => b.extend(p),
          new LngLatBounds(punten[0], punten[0])
        );
        map.fitBounds(grenzen, { padding: 40, duration: 0, maxZoom: 12 });
      }
    };

    if (map.isStyleLoaded()) teken();
    else map.once("load", teken);
  }, [feature]);

  const punten = feature?.geometry ? allePunten(feature.geometry) : [];
  const lons = punten.map((p) => p[0]);
  const lats = punten.map((p) => p[1]);

  // De container staat er altijd, ook zonder vorm. Zou hij bij een leeg volume
  // verdwijnen, dan wordt de kaart nooit aangemaakt — en na het wisselen naar
  // een volume dat wél een vorm heeft blijft het scherm dan zwart, want de
  // opbouw draait maar één keer.
  return (
    <div className={styles.kaart}>
      <div ref={houder} style={{ position: "absolute", inset: 0 }} />
      {!feature?.geometry && (
        <div className={styles.kaartLeeg} style={{ position: "absolute", inset: 0, background: "var(--surface)" }}>
          Dit volume heeft geen opgeloste vorm. Bekijk het tabblad AIXM om te zien waar het
          naar verwijst.
        </div>
      )}
      <div className={styles.kaartMeta}>
        <span>{label}</span>
        <span>{punten.length} punten</span>
        <span className="spacer" />
        {punten.length > 0 && (
          <span>
            bbox {Math.min(...lons).toFixed(2)} / {Math.min(...lats).toFixed(2)} →{" "}
            {Math.max(...lons).toFixed(2)} / {Math.max(...lats).toFixed(2)}
          </span>
        )}
        <span>OSM · MapLibre</span>
      </div>
    </div>
  );
}

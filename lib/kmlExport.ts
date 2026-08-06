import type { Feature, FeatureCollection, Geometry, Position } from "geojson";

/**
 * GeoJSON → KML, om een export in Google Earth na te lopen voordat hij LARA in gaat.
 *
 * Overgenomen uit `app/airspaces/page.tsx` van de brontool (regels ~1180–1360),
 * waar het tussen 4440 regels schermcode zat. Hier is het een eigen module: los
 * testbaar, en de KML-vorm heeft niets met een scherm te maken.
 *
 * Vereenvoudigd ten opzichte van het origineel: geen kleurenpalet per gebied en
 * geen kleurvoorkeuren uit de database — die horen bij de composite-weergave die
 * hier niet meekomt. Eén accentkleur, en de hoogte uit het volume.
 */

const ACCENT = "3f3d8f"; // indigo, gelijk aan --action

const escapeXml = (tekst: string) =>
  tekst
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/** `#rrggbb` → KML's `aabbggrr`. Google Earth draait de volgorde om. */
const naarKmlKleur = (hex: string, alpha: string) => {
  const h = hex.replace("#", "");
  return `${alpha}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`;
};

const ringNaarKml = (ring: Position[], hoogteM: number) =>
  ring.map((p) => `${p[0]},${p[1]},${hoogteM}`).join(" ");

const polygoonNaarKml = (ringen: Position[][], hoogteM: number) => {
  if (!ringen.length) return "";
  const buiten = `<outerBoundaryIs><LinearRing><coordinates>${ringNaarKml(ringen[0], hoogteM)}</coordinates></LinearRing></outerBoundaryIs>`;
  const binnen = ringen
    .slice(1)
    .map((r) => `<innerBoundaryIs><LinearRing><coordinates>${ringNaarKml(r, hoogteM)}</coordinates></LinearRing></innerBoundaryIs>`)
    .join("");
  // clampToGround houdt de vorm op het maaiveld; absolute zou de hoogteband
  // tonen maar maakt het in Google Earth juist lastiger te lezen.
  return `<Polygon><altitudeMode>clampToGround</altitudeMode>${buiten}${binnen}</Polygon>`;
};

const geometrieNaarKml = (geometrie: Geometry, hoogteM: number): string => {
  if (geometrie.type === "Polygon") return polygoonNaarKml(geometrie.coordinates, hoogteM);
  if (geometrie.type === "MultiPolygon") {
    const delen = geometrie.coordinates.map((p) => polygoonNaarKml(p, hoogteM)).filter(Boolean);
    return delen.length ? `<MultiGeometry>${delen.join("")}</MultiGeometry>` : "";
  }
  return "";
};

export type KmlOpties = {
  documentNaam: string;
};

/**
 * Eén KML-document uit een FeatureCollection.
 *
 * Features zonder bruikbare vorm worden overgeslagen; een leeg document is
 * misleidend, dus dan volgt een fout.
 */
export function featureCollectionNaarKml(
  fc: FeatureCollection,
  opties: KmlOpties
): string {
  const placemarks = fc.features
    .map((feature: Feature, i: number) => {
      if (!feature.geometry) return "";
      const props = (feature.properties ?? {}) as Record<string, unknown>;
      const naam =
        (typeof props.ident === "string" && props.ident) ||
        (typeof props.name === "string" && props.name) ||
        `Gebied ${i + 1}`;

      const hoogteM = typeof props.upper_m === "number" ? Math.max(0, props.upper_m) : 0;
      const vorm = geometrieNaarKml(feature.geometry, hoogteM);
      if (!vorm) return "";

      const regels = [
        typeof props.lara_area_id === "number" ? `LARA Area ID: ${props.lara_area_id}` : null,
        typeof props.type === "string" ? `Type: ${props.type}` : null,
        typeof props.vertical === "string" ? `Hoogte: ${props.vertical}` : null,
        typeof props.volume === "string" ? `Volume: ${props.volume}` : null,
      ].filter(Boolean) as string[];

      const omschrijving = regels.length ? `<description>${escapeXml(regels.join("\n"))}</description>` : "";
      return `<Placemark><name>${escapeXml(naam)}</name><styleUrl>#gebied</styleUrl>${omschrijving}${vorm}</Placemark>`;
    })
    .filter(Boolean)
    .join("");

  if (!placemarks) {
    throw new Error("Geen enkel gebied heeft een vorm die naar KML kan.");
  }

  const stijl =
    `<Style id="gebied">` +
    `<LineStyle><color>${naarKmlKleur(ACCENT, "ff")}</color><width>2</width></LineStyle>` +
    `<PolyStyle><color>${naarKmlKleur(ACCENT, "55")}</color></PolyStyle>` +
    `</Style>`;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>` +
    `<name>${escapeXml(opties.documentNaam)}</name>${stijl}${placemarks}` +
    `</Document></kml>`
  );
}

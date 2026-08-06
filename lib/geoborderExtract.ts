/**
 * Landsgrenzen uit een AIXM-bestand halen.
 *
 * Dit is het antwoord op het grootste risico van deze tool. Een airspace langs de
 * Duitse of Belgische grens verwijst met een `xlink` naar een `GeoBorder` in
 * plaats van zijn eigen coördinaten op te schrijven. Kan de parser die
 * verwijzing niet oplossen, dan komt het gebied zonder coördinaten in de
 * LARA-export — zonder dat er iets misgaat dat je ziet.
 *
 * `parseAixm` haalt grenzen uit het bestand zelf al op en legt die over de
 * meegegeven lookup heen — het bestand wint, de tabel vult aan. Die volgorde
 * klopt en hoeft niet te veranderen.
 *
 * Waar deze module voor dient is wat de brontool níét doet:
 *
 *   1. tellen hoeveel grenzen er in het bestand zaten, zodat het importscherm
 *      dat kan tonen in plaats van er stilzwijgend van uit te gaan;
 *   2. ze wegschrijven naar de `geoborders`-tabel, zodat een volgend AIXM-bestand
 *      zónder grenzen alsnog te verwerken is.
 *
 * De extractielogica komt uit `app/api/geoborders/upload/route.ts` van de
 * brontool, hier losgemaakt zodat hij testbaar is en niet aan een route hangt.
 */

import { parseStringPromise, processors } from "xml2js";
import type { Feature, Geometry, LineString, Position } from "geojson";
import { bboxFromCoords, coordsFromPosList } from "./geo";

export type Geoborder = {
  borderId: string;
  name: string | null;
  geojson: Feature<Geometry>;
  bbox?: [number, number, number, number];
  /** De punten zoals de parser ze wil: [lon, lat]. */
  coords: [number, number][];
};

type AnyObject = Record<string, unknown>;

const toText = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value.toString();
  }
  if (Array.isArray(value)) return toText(value[0]);
  if (typeof value === "object") {
    const obj = value as AnyObject;
    if (typeof obj._ === "string" || typeof obj._ === "number") return obj._.toString();
    if (typeof obj.text === "string") return obj.text;
    if (obj.__text) return toText(obj.__text);
  }
  return undefined;
};

/**
 * De coördinaten van een grens zitten diep genest: border → Curve → segments →
 * GeodesicString → posList. De precieze diepte verschilt per leverancier, dus we
 * zoeken naar de eerste posList in plaats van een vast pad te volgen.
 */
const findFirstPosList = (node: unknown): string | undefined => {
  if (!node || typeof node !== "object") return undefined;
  const obj = node as AnyObject;
  for (const key of ["posList", "pos", "coordinates"]) {
    if (obj[key] !== undefined) {
      const value = toText(obj[key]);
      if (value) return value;
    }
  }
  for (const value of Object.values(obj)) {
    const found = findFirstPosList(value);
    if (found) return found;
  }
  return undefined;
};

export const normalizeUuid = (value: string) =>
  value.replace(/^#/, "").replace(/^urn:uuid:/, "").replace(/^uuid\./, "");

const collectGeoBorderNodes = (node: unknown, out: AnyObject[]) => {
  if (!node || typeof node !== "object") return;
  const obj = node as AnyObject;
  if (obj.GeoBorder) {
    const value = obj.GeoBorder;
    if (Array.isArray(value)) out.push(...(value as AnyObject[]));
    else out.push(value as AnyObject);
  }
  for (const value of Object.values(obj)) {
    if (typeof value === "object") collectGeoBorderNodes(value, out);
  }
};

const extractGeoBorder = (node: AnyObject): Geoborder | null => {
  // De canonieke sleutel is de gml:identifier binnen GeoBorder; gml:id is terugval.
  const borderIdRaw = toText(node.identifier) ?? toText(node.id) ?? toText(node["gml:id"]);
  if (!borderIdRaw) return null;

  const timeSlice =
    ((node.timeSlice as AnyObject)?.GeoBorderTimeSlice as AnyObject) ??
    (node.timeSlice as AnyObject) ??
    null;

  const posList = findFirstPosList(timeSlice?.border ?? timeSlice);
  if (!posList) return null;

  const coords = coordsFromPosList(posList);
  if (!coords?.length) return null;

  const line: Feature<LineString> = {
    type: "Feature",
    geometry: { type: "LineString", coordinates: coords as unknown as Position[] },
    properties: {},
  };

  return {
    borderId: normalizeUuid(borderIdRaw),
    name: toText(timeSlice?.name) ?? null,
    geojson: line as Feature<Geometry>,
    bbox: bboxFromCoords(coords) ?? undefined,
    coords,
  };
};

/**
 * Alle `GeoBorder`-elementen uit een AIXM-bestand. Een bestand zonder grenzen
 * levert een lege lijst op — dat is geen fout, veel AIXM-bestanden bevatten ze
 * niet.
 */
export async function extractGeoborders(xml: string | Buffer): Promise<Geoborder[]> {
  const text = typeof xml === "string" ? xml : xml.toString("utf-8");

  const parsed = await parseStringPromise(text, {
    explicitArray: false,
    mergeAttrs: true,
    tagNameProcessors: [processors.stripPrefix],
    attrNameProcessors: [processors.stripPrefix],
    xmlns: false,
  });

  const nodes: AnyObject[] = [];
  collectGeoBorderNodes(parsed, nodes);

  // Op borderId ontdubbelen: een grens kan in meerdere timeslices voorkomen.
  const perId = new Map<string, Geoborder>();
  for (const node of nodes) {
    const border = extractGeoBorder(node);
    if (border) perId.set(border.borderId, border);
  }
  return Array.from(perId.values());
}

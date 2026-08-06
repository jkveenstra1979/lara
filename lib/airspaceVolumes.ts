/**
 * Volumes uit een AIXM-timeslice halen.
 *
 * Een gebied bestaat uit één of meer `geometryComponent`s. Elk component is een
 * volume: een horizontale vorm mét de hoogteband die daarbij hoort. Een gebied
 * dat uit andere gebieden is opgebouwd heeft er meerdere, elk met een eigen
 * band — en dat is precies wat sheet 2 (Area Volumes) van LARA uitschrijft.
 *
 * De parser bewaart die componenten al. Wat hij daarna doet is het probleem:
 * `slice.verticalLimits` krijgt de band van het eerste component dat er één
 * heeft (aixmParser.ts, waar `geometryComponents.find(...)` staat). Voor een
 * gelaagd gebied is de bovengrens daarmee weg. Sheet 1 heeft juist de
 * omhullende band nodig, sheet 2 de band per volume.
 *
 * Deze module levert allebei: `collectVolumes` voor de rijen, en
 * `envelopeVerticalLimits` voor de omhullende band.
 */

import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { ParsedGeometryComponent, ParsedTimeSlice, VerticalLimit } from "./aixmParser";

/**
 * De AIXM-operaties uit CodeAirspaceAggregationType, plus `AGG`.
 *
 * `AGG` staat niet in AIXM: de parser gebruikt het als markering voor de
 * samengevoegde geometrie van alle componenten samen (`slice.aggregatedGeometry`,
 * operationSequence 0). Het is dus geen bewerking maar een uitkomst.
 */
export const VOLUME_OPERATIES = ["BASE", "UNION", "SUBTR", "INTERS", "AGG"] as const;
export type VolumeOperatie = (typeof VOLUME_OPERATIES)[number];

export type Hoogte = {
  value: number;
  /** FL, FT, M — zoals AIXM hem opgeeft, niet omgerekend. */
  unit: string;
  /** STD, MSL, SFC, … */
  reference?: string;
};

export type Volume = {
  operation: VolumeOperatie;
  operationSequence: number | null;
  lowerLimit: Hoogte | null;
  upperLimit: Hoogte | null;
  /** UUIDs van de gebieden waar dit volume uit is opgebouwd. Leeg bij een eigen vorm. */
  derivedFrom: string[];
  geometryStatus: ParsedGeometryComponent["geometryStatus"];
  geojson: Feature<Geometry> | null;
  bbox: FeatureCollection["bbox"];
  geomType?: string;
  centroidLat: number | null;
  centroidLon: number | null;
  warnings: string[];
};

const isOperatie = (v: string): v is VolumeOperatie =>
  (VOLUME_OPERATIES as readonly string[]).includes(v);

/**
 * Onbekende of ontbrekende operaties worden BASE.
 *
 * Dat is wat de aggregator van de brontool ook doet als AIXM geen operatie
 * opgeeft, en het is de veilige kant: een volume dat als BASE wordt behandeld
 * verdwijnt niet uit de export, terwijl een onbekende waarde de databasecheck
 * zou laten struikelen.
 */
const normaliseerOperatie = (raw: string | undefined | null): VolumeOperatie => {
  const op = (raw ?? "").trim().toUpperCase();
  return isOperatie(op) ? op : "BASE";
};

const toHoogte = (limit: VerticalLimit | undefined): Hoogte | null => {
  if (!limit || limit.value === null || limit.value === undefined) return null;
  const unit = (limit.uom ?? limit.unit ?? "").trim().toUpperCase();
  if (!unit) return null;
  return {
    value: limit.value,
    unit,
    ...(limit.reference ? { reference: limit.reference } : {}),
  };
};

/**
 * Hoogte in voet, om banden in verschillende eenheden te kunnen vergelijken.
 * Alleen voor het bepalen van de omhullende band — de opgeslagen waarde blijft
 * altijd de originele eenheid, want die gaat zo de export in.
 */
const inVoet = (h: Hoogte | null): number | null => {
  if (!h) return null;
  switch (h.unit) {
    case "FL":
      return h.value * 100;
    case "M":
      return h.value * 3.28084;
    case "FT":
    case "F":
      return h.value;
    default:
      return h.value;
  }
};

/**
 * Alle volumes van een timeslice, in de volgorde waarin ze horen te worden
 * toegepast. Componenten zonder `operationSequence` blijven achteraan staan in
 * de volgorde waarin AIXM ze aanleverde.
 */
export function collectVolumes(slice: ParsedTimeSlice): Volume[] {
  return slice.geometryComponents
    .map((component, index) => ({ component, index }))
    .sort((a, b) => {
      const as = a.component.operationSequence;
      const bs = b.component.operationSequence;
      if (as == null && bs == null) return a.index - b.index;
      if (as == null) return 1;
      if (bs == null) return -1;
      return as - bs || a.index - b.index;
    })
    .map(({ component }): Volume => {
      const limits = component.verticalLimits ?? {};
      return {
        operation: normaliseerOperatie(component.operation),
        operationSequence: component.operationSequence ?? null,
        lowerLimit: toHoogte(limits.lowerLimit ?? limits.minimumLimit),
        upperLimit: toHoogte(limits.upperLimit ?? limits.maximumLimit),
        derivedFrom: component.derivedFromAirspaceId ? [component.derivedFromAirspaceId] : [],
        geometryStatus: component.geometryStatus,
        geojson: component.geojson ?? null,
        bbox: component.bbox,
        geomType: component.geomType,
        centroidLat: component.centroidLat ?? null,
        centroidLon: component.centroidLon ?? null,
        warnings: component.warnings ?? [],
      };
    });
}

/**
 * De omhullende hoogteband: laagste onder- en hoogste bovengrens over alle
 * volumes. Dit is wat sheet 1 (Areas) toont en wat in `airspaces.lowerlimit` /
 * `upperlimit` terechtkomt.
 *
 * Vergelijken gebeurt in voet, teruggegeven wordt de originele waarde met zijn
 * eigen eenheid — FL 195 blijft FL 195 en wordt geen 19500 ft.
 */
export function envelopeVerticalLimits(volumes: Volume[]): {
  lowerLimit: Hoogte | null;
  upperLimit: Hoogte | null;
} {
  let lower: Hoogte | null = null;
  let upper: Hoogte | null = null;

  for (const volume of volumes) {
    const l = inVoet(volume.lowerLimit);
    if (l !== null && (lower === null || l < inVoet(lower)!)) lower = volume.lowerLimit;

    const u = inVoet(volume.upperLimit);
    if (u !== null && (upper === null || u > inVoet(upper)!)) upper = volume.upperLimit;
  }

  return { lowerLimit: lower, upperLimit: upper };
}

/**
 * Heeft dit gebied meer dan één volume? Dat is een bevinding op het
 * exportscherm: sheet 2 krijgt dan meer rijen dan er gebieden zijn, en dat is
 * precies waar de brontool stilzwijgend informatie verloor.
 */
export function heeftMeerdereVolumes(volumes: Volume[]): boolean {
  return volumes.filter((v) => v.operation !== "AGG").length > 1;
}

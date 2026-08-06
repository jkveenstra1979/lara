import type { Feature, Geometry } from "geojson";
import polygonClipping from "polygon-clipping";
import { expandXlinkBorderSegment, type Coord, type Coord as BorderCoord, type GeoBorder } from "./aixmGeojsonExport";
import type { ParsedAirspace, ParsedGeometryComponent } from "./aixmParser";

// Een coördinaat is een paar, geen willekeurige reeks getallen. polygon-clipping
// eist dat onderscheid; met `number[]` klopt de vorm toevallig wel maar weigert
// de compiler het door te laten. Aangescherpt bij het overnemen uit de brontool.
type Pair = [number, number];
type MultiPolygon = Pair[][][];

export type HorizontalGeometryResult = {
  geometry: MultiPolygon | null;
  warnings: string[];
  sourceAirspaceId?: string | null;
};

export type GeoBorderResolver = (uuid: string) => BorderCoord[] | null;

const toMultiPolygon = (geojson?: Feature<Geometry> | null): MultiPolygon | null => {
  if (!geojson?.geometry) return null;
  if (geojson.geometry.type === "Polygon") {
    return [geojson.geometry.coordinates as any];
  }
  if (geojson.geometry.type === "MultiPolygon") {
    return geojson.geometry.coordinates as any;
  }
  return null;
};

const bearingDeg = (from: Coord, to: Coord): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const φ1 = toRad(from.lat);
  const φ2 = toRad(to.lat);
  const Δλ = toRad(to.lon - from.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
};

const destinationPoint = (start: Coord, bearing: number, distanceNm: number): Coord => {
  const R = 6371000;
  const distanceMeters = distanceNm * 1852;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const δ = distanceMeters / R;
  const θ = toRad(bearing);
  const φ1 = toRad(start.lat);
  const λ1 = toRad(start.lon);
  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(sinφ2);
  const y = Math.sin(θ) * Math.sin(δ) * Math.cos(φ1);
  const x = Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2);
  const λ2 = λ1 + Math.atan2(y, x);
  return { lat: toDeg(φ2), lon: ((toDeg(λ2) + 540) % 360) - 180 };
};

type ParsedSeg =
  | { kind: "P"; lat: number; lon: number }
  | {
      kind: "ARC";
      centerLat: number;
      centerLon: number;
      radiusNm: number;
      direction: "CW" | "CCW";
      endLat: number;
      endLon: number;
    }
  | { kind: "BORDER"; uuid?: string | null; fromLat: number; fromLon: number; toLat: number; toLon: number };

const distDeg = (a: Coord, b: Coord) => {
  const dLat = a.lat - b.lat;
  const dLon = a.lon - b.lon;
  return Math.sqrt(dLat * dLat + dLon * dLon);
};

const parseSegments = (geometry: string): ParsedSeg[] => {
  const parts = geometry
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  const segs: ParsedSeg[] = [];
  for (const part of parts) {
    const p = /^P\(([^)]+)\)$/.exec(part);
    if (p) {
      const [lat, lon] = p[1].split(",").map((s) => Number(s.trim()));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      segs.push({ kind: "P", lat, lon });
      continue;
    }
    const arc = /^ARC\(([^)]+)\)$/.exec(part);
    if (arc) {
      const args = arc[1].split(",").map((s) => s.trim());
      if (args.length !== 6) continue;
      const [centerLat, centerLon, radiusNm, direction, endLat, endLon] = args;
      if (direction !== "CW" && direction !== "CCW") continue;
      segs.push({
        kind: "ARC",
        centerLat: Number(centerLat),
        centerLon: Number(centerLon),
        radiusNm: Number(radiusNm),
        direction,
        endLat: Number(endLat),
        endLon: Number(endLon),
      });
      continue;
    }
    const border = /^BORDER\(([^)]+)\)$/.exec(part);
    if (border) {
      const args = border[1].split(",").map((s) => s.trim());
      if (args.length === 4) {
        const [fromLat, fromLon, toLat, toLon] = args.map((n) => Number(n));
        segs.push({ kind: "BORDER", uuid: null, fromLat, fromLon, toLat, toLon });
        continue;
      }
      if (args.length === 5) {
        const [uuidRaw, fromLat, fromLon, toLat, toLon] = args;
        const uuid = normalizeUuid(uuidRaw);
        segs.push({
          kind: "BORDER",
          uuid,
          fromLat: Number(fromLat),
          fromLon: Number(fromLon),
          toLat: Number(toLat),
          toLon: Number(toLon),
        });
        continue;
      }
    }
  }
  return segs;
};

const sampleArc = (start: Coord, arc: Extract<ParsedSeg, { kind: "ARC" }>, steps = 36): Coord[] => {
  const center: Coord = { lat: arc.centerLat, lon: arc.centerLon };
  const radiusMeters = arc.radiusNm * 1852;
  const startBearing = bearingDeg(center, start);
  const end: Coord = { lat: arc.endLat, lon: arc.endLon };
  const endBearing = bearingDeg(center, end);

  const cwDelta = (endBearing - startBearing + 360) % 360;
  const ccwDelta = (startBearing - endBearing + 360) % 360;
  const delta = arc.direction === "CW" ? cwDelta : ccwDelta;

  const out: Coord[] = [];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const angle = arc.direction === "CW" ? startBearing + delta * t : startBearing - delta * t;
    out.push(destinationPoint(center, (angle + 360) % 360, arc.radiusNm));
  }
  out.push(end);
  return out;
};

const buildRingFromGeometryString = (
  geometry: string,
  geoBorderResolver: GeoBorderResolver,
  opts: { dedupeToleranceDeg?: number; snapToleranceDeg?: number } = {}
): Coord[] | null => {
  const dedupeToleranceDeg = opts.dedupeToleranceDeg ?? 1e-6;
  const snapToleranceDeg = opts.snapToleranceDeg ?? 5e-3;
  const segs = parseSegments(geometry);
  if (!segs.length) return null;
  const ring: Coord[] = [];

  const push = (p: Coord) => {
    const last = ring[ring.length - 1];
    if (last && distDeg(last, p) <= dedupeToleranceDeg) return;
    ring.push(p);
  };

  let lastVertex: Coord | null = null;
  for (const seg of segs) {
    if (seg.kind === "P") {
      const v = { lat: seg.lat, lon: seg.lon };
      push(v);
      lastVertex = v;
      continue;
    }
    if (seg.kind === "ARC") {
      if (!lastVertex) return null;
      const samples = sampleArc(lastVertex, seg);
      samples.forEach(push);
      lastVertex = samples[samples.length - 1] ?? lastVertex;
      continue;
    }
    if (seg.kind === "BORDER") {
      const from = { lat: seg.fromLat, lon: seg.fromLon };
      const to = { lat: seg.toLat, lon: seg.toLon };
      if (!lastVertex) push(from);
      if (!seg.uuid) return null;
      const borderCoords = geoBorderResolver(seg.uuid);
      if (!borderCoords) return null;
      const slice = expandXlinkBorderSegment(seg.uuid, from, to, [{ uuid: seg.uuid, coords: borderCoords } as GeoBorder], snapToleranceDeg);
      slice.forEach((p) => push(p as BorderCoord));
      lastVertex = { ...to };
      continue;
    }
  }

  if (ring.length < 3) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (distDeg(first, last) > dedupeToleranceDeg) ring.push({ ...first });
  return ring;
};

export const geometryStringToMultiPolygon = (geometry: string, geoBorderResolver: GeoBorderResolver) => {
  const ring = buildRingFromGeometryString(geometry, geoBorderResolver);
  if (!ring) return null;
  return [[ring.map((c) => [c.lon, c.lat])]] as MultiPolygon;
};

const normalizeUuid = (value: string) => value.replace(/^#/, "").replace(/^urn:uuid:/, "").replace(/^uuid\./, "");

const pickComponentOrder = (components: ParsedGeometryComponent[]) => {
  const sorted = [...components].sort((a, b) => (a.operationSequence ?? 0) - (b.operationSequence ?? 0));
  const base = sorted.find((c) => (c.operation ?? "").toUpperCase() === "BASE");
  if (!base) return sorted;
  return [base, ...sorted.filter((c) => c !== base)];
};

const resolveContributor = (
  contributorUuid: string,
  airspaceIndex: Map<string, ParsedAirspace>,
  visitedAirspaces: Set<string>,
  geoBorderResolver: GeoBorderResolver
): HorizontalGeometryResult => {
  if (visitedAirspaces.has(contributorUuid)) {
    return { geometry: null, warnings: ["Cycle detected in contributorAirspace chain."] };
  }
  visitedAirspaces.add(contributorUuid);

  const contributor = airspaceIndex.get(contributorUuid);
  if (!contributor) {
    return {
      geometry: null,
      warnings: [`Contributor airspace ${contributorUuid} not present in this AIXM file.`],
    };
  }

  const slice =
    contributor.activeSlice ??
    (Array.isArray(contributor.timeSlices) ? contributor.timeSlices.find((s) => s?.interpretation === "BASELINE") : null) ??
    (Array.isArray(contributor.timeSlices) ? contributor.timeSlices[0] : null);
  const components = Array.isArray(slice?.geometryComponents) ? slice!.geometryComponents : [];
  if (!components.length) {
    return {
      geometry: null,
      warnings: ["No resolvable horizontalProjection found in contributorAirspace chain."],
    };
  }

  const ordered = pickComponentOrder(components);
  for (const component of ordered) {
    const result = resolveHorizontalGeometry(component, airspaceIndex, geoBorderResolver, visitedAirspaces);
    if (result.geometry) {
      return {
        geometry: result.geometry,
        warnings: result.warnings,
        sourceAirspaceId: contributorUuid,
      };
    }
  }

  return {
    geometry: null,
    warnings: ["No resolvable horizontalProjection found in contributorAirspace chain."],
  };
};

export const resolveHorizontalGeometry = (
  component: ParsedGeometryComponent,
  airspaceIndex: Map<string, ParsedAirspace>,
  geoBorderResolver: GeoBorderResolver,
  visitedAirspaces: Set<string> = new Set()
): HorizontalGeometryResult => {
  if (component.geometryString) {
    try {
      const ring = buildRingFromGeometryString(component.geometryString, geoBorderResolver);
      if (ring) {
        return { geometry: [[ring.map((c): Pair => [c.lon, c.lat])]], warnings: [] };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to resolve geometryString.";
      return { geometry: null, warnings: [message] };
    }
  }

  const geojson = toMultiPolygon(component.geojson ?? null);
  if (geojson) {
    return { geometry: geojson, warnings: [] };
  }

  if (component.derivedFromAirspaceId) {
    const uuid = normalizeUuid(component.derivedFromAirspaceId);
    return resolveContributor(uuid, airspaceIndex, visitedAirspaces, geoBorderResolver);
  }

  return {
    geometry: null,
    warnings: ["No resolvable horizontalProjection found in contributorAirspace chain."],
  };
};

export const computeAggregatedHorizontalGeometry = (
  airspace: ParsedAirspace,
  airspaceIndex: Map<string, ParsedAirspace>,
  geoBorderResolver: GeoBorderResolver
): HorizontalGeometryResult => {
  const slice = airspace.activeSlice ?? airspace.timeSlices?.find((s) => s?.interpretation === "BASELINE") ?? airspace.timeSlices?.[0];
  const components = Array.isArray(slice?.geometryComponents) ? slice!.geometryComponents : [];
  if (!components.length) {
    return { geometry: null, warnings: ["No resolvable horizontalProjection found in contributorAirspace chain."] };
  }

  const sorted = [...components].sort((a, b) => (a.operationSequence ?? 0) - (b.operationSequence ?? 0));
  const baseComponent = sorted.find((c) => (c.operation ?? "").toUpperCase() === "BASE") ?? sorted[0];
  const base = resolveHorizontalGeometry(baseComponent, airspaceIndex, geoBorderResolver, new Set());
  if (!base.geometry) {
    return {
      geometry: null,
      warnings: base.warnings.length ? base.warnings : ["No resolvable horizontalProjection found in contributorAirspace chain."],
    };
  }

  let result = base.geometry;
  const warnings = [...base.warnings];
  for (const component of sorted) {
    if (component === baseComponent) continue;
    const resolved = resolveHorizontalGeometry(component, airspaceIndex, geoBorderResolver, new Set());
    if (!resolved.geometry) {
      const seq = component.operationSequence ?? "?";
      warnings.push(`Aggregation partially resolved; component ${seq} unresolved.`);
      continue;
    }
    const op = (component.operation ?? "").toUpperCase();
    if (op === "UNION") {
      result = polygonClipping.union(result, resolved.geometry) as MultiPolygon;
    } else if (op === "SUBTR") {
      result = polygonClipping.difference(result, resolved.geometry) as MultiPolygon;
    } else if (op === "INTERS") {
      result = polygonClipping.intersection(result, resolved.geometry) as MultiPolygon;
    }
  }

  return { geometry: result, warnings };
};

import type { Feature, FeatureCollection, Geometry, LineString, Polygon, Position } from "geojson";
import { processors, parseStringPromise } from "xml2js";
import { bboxFromCoords, centroidFromPolygon, coordsFromPosList, ensureClosedRing } from "./geo";
import {
  computeAirspaceAggregatedGeometry,
  type Airspace as AggAirspace,
  type AirspaceGeometryComponent as AggComponent,
  type AirspaceVolume as AggVolume,
  type MultiPolygon as AggMultiPolygon,
} from "./airspaceGeometryAggregator";
import {
  computeAggregatedHorizontalGeometry,
  geometryStringToMultiPolygon,
  type GeoBorderResolver as TransitiveGeoBorderResolver,
} from "./airspaceGeometryTransitive";

type AnyObject = Record<string, unknown>;

const normalizeUuid = (value: string) => value.replace(/^#/, "").replace(/^urn:uuid:/, "").replace(/^uuid\./, "");

export type VerticalLimit = {
  key: "upperLimit" | "lowerLimit" | "maximumLimit" | "minimumLimit";
  value: number | null;
  uom?: string;
  reference?: string;
  type?: string;
  unit?: string;
};

export type ParsedActivation = {
  activity?: string;
  status?: string;
  levels?: string;
  user?: string;
  aircraft?: string;
  raw?: AnyObject;
};

export type ParsedClass = { value?: string; schedule?: AnyObject | null };

export type ParsedGeometryComponent = {
  operation?: string;
  operationSequence?: number | null;
  geometryStatus: "ok" | "partial" | "centroid_only" | "missing";
  warnings: string[];
  geometryString?: string | null;
  derivedFromAirspaceId?: string | null;
  geojson?: Feature<Geometry> | null;
  bbox?: FeatureCollection["bbox"];
  centroidLat?: number | null;
  centroidLon?: number | null;
  geomType?: string;
  verticalLimits?: Partial<Record<VerticalLimit["key"], VerticalLimit>>;
};

export type ParsedTimeSlice = {
  interpretation?: string;
  sequenceNumber?: number | null;
  correctionNumber?: number | null;
  validTimeBegin?: string | null;
  validTimeEnd?: string | null;
  designator?: string | null;
  identifier?: string | null;
  name?: string | null;
  type?: string | null;
  localType?: string | null;
  designatorICAO?: string | null;
  controlType?: string | null;
  upperLowerSeparation?: string | null;
  aipFilterNl?: boolean | null;
  classes: ParsedClass[];
  activations: ParsedActivation[];
  notes: string[];
  warnings: string[];
  geometryComponents: ParsedGeometryComponent[];
  aggregatedGeometry?: ParsedGeometryComponent | null;
  verticalLimits?: Partial<Record<VerticalLimit["key"], VerticalLimit>>;
};

export type ParsedAirspace = {
  gmlId?: string | null;
  sourceRef: string;
  rawFragment?: string | null;
  timeSlices: ParsedTimeSlice[];
  activeSlice?: ParsedTimeSlice | null;
  warnings: string[];
  geometryStatus: "ok" | "partial" | "centroid_only" | "missing";
  centroidLat?: number | null;
  centroidLon?: number | null;
  bbox?: FeatureCollection["bbox"];
};

const toText = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value.toString();
  if (Array.isArray(value)) return toText(value[0]);
  if (typeof value === "object") {
    const objectValue = value as AnyObject;
    if (typeof objectValue._ === "string" || typeof objectValue._ === "number") {
      return objectValue._.toString();
    }
    if (typeof objectValue.text === "string") return objectValue.text;
    if (objectValue.__text) return toText(objectValue.__text);
  }
  return undefined;
};

// Extracts the xlink:href for a contributorAirspace, even when nested under
// <aixm:AirspaceVolumeDependency><aixm:theAirspace xlink:href="..."/></...>
// xml2js is configured with mergeAttrs + stripPrefix, so xlink:href becomes "href".
const findContributorAirspaceHref = (contributor: unknown): string | undefined => {
  const tryHref = (node: unknown): string | undefined => {
    if (!node || typeof node !== "object") return undefined;
    const obj = node as Record<string, unknown>;
    return (
      toText(obj.href) ??
      toText(obj.xlinkhref) ??
      toText(obj.xlinkHref) ??
      toText(obj["xlink:href"]) ??
      toText(obj["xlinkhref"]) ??
      toText(obj["xlinkHref"])
    );
  };

  const seen = new Set<unknown>();
  const visit = (node: unknown): string | undefined => {
    if (!node || typeof node !== "object") return undefined;
    if (seen.has(node)) return undefined;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        const found = visit(item);
        if (found) return found;
      }
      return undefined;
    }

    const obj = node as AnyObject;

    // Direct attribute on <contributorAirspace xlink:href="..."/>
    const direct = tryHref(obj);
    if (direct) return direct;

    // Common case: <theAirspace xlink:href="..."/>
    const theAirspace = (obj as AnyObject).theAirspace ?? (obj as AnyObject).TheAirspace;
    if (theAirspace) {
      const found = tryHref(theAirspace) ?? visit(theAirspace);
      if (found) return found;
    }

    // AIXM case: <contributorAirspace><AirspaceVolumeDependency>...<theAirspace .../></...></contributorAirspace>
    const dependency =
      (obj as AnyObject).AirspaceVolumeDependency ??
      (obj as AnyObject).airspaceVolumeDependency ??
      (obj as AnyObject).volumeDependency ??
      (obj as AnyObject).contributorAirspaceDependency;
    if (dependency) {
      const found = visit(dependency);
      if (found) return found;
    }

    for (const value of Object.values(obj)) {
      const found = visit(value);
      if (found) return found;
    }
    return undefined;
  };

  return visit(contributor);
};

const toNumber = (value: unknown): number | null => {
  const text = toText(value);
  if (text === undefined) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
};

const asArray = <T>(value: T | T[] | undefined | null): T[] => {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
};

const collectAirspaceNodes = (node: unknown): AnyObject[] => {
  if (!node || typeof node !== "object") return [];
  const objectNode = node as AnyObject;
  const nodes: AnyObject[] = [];
  if (objectNode.Airspace) {
    const airspaceValue = objectNode.Airspace;
    if (Array.isArray(airspaceValue)) {
      nodes.push(...(airspaceValue.filter(Boolean) as AnyObject[]));
    } else if (airspaceValue && typeof airspaceValue === "object") {
      nodes.push(airspaceValue as AnyObject);
    }
  }
  for (const value of Object.values(objectNode)) {
    if (typeof value === "object") {
      nodes.push(...collectAirspaceNodes(value));
    }
  }
  return nodes;
};

const findTimeSlices = (airspace: AnyObject): AnyObject[] => {
  const safe = airspace as AnyObject;
  const timeSlice = (safe.timeSlice as AnyObject | undefined) ?? undefined;
  const candidates = asArray(
    safe.AirspaceTimeSlice ?? timeSlice?.AirspaceTimeSlice ?? safe.timeSlice ?? safe.timeSlices
  ) as AnyObject[];
  if (candidates.length) return candidates;
  if (Array.isArray(airspace.timeSlice)) return airspace.timeSlice;
  return [];
};

const findTextDeep = (node: unknown, keys: string[]): string | undefined => {
  if (!node || typeof node !== "object") return undefined;
  const objectNode = node as AnyObject;
  for (const key of keys) {
    if (objectNode[key] !== undefined) {
      const txt = toText(objectNode[key]);
      if (txt !== undefined) return txt;
    }
  }
  for (const value of Object.values(objectNode)) {
    if (typeof value === "object") {
      const found = findTextDeep(value, keys);
      if (found !== undefined) return found;
    }
  }
  return undefined;
};

const findFirstPosList = (node: unknown): string | undefined => {
  if (!node || typeof node !== "object") return undefined;
  const objectNode = node as AnyObject;
  const candidates = ["posList", "pos", "coordinates"];
  for (const key of candidates) {
    if (objectNode[key] !== undefined) {
      const value = toText(objectNode[key]);
      if (value) return value;
    }
  }
  for (const value of Object.values(objectNode)) {
    const found = findFirstPosList(value);
    if (found) return found;
  }
  return undefined;
};

export type GeoBorderLookup = Record<string, Position[]>;

const collectGeoBorderNodes = (node: unknown, out: AnyObject[]) => {
  if (!node || typeof node !== "object") return;
  const objectNode = node as AnyObject;
  if (objectNode.GeoBorder) {
    const value = objectNode.GeoBorder;
    if (Array.isArray(value)) out.push(...value);
    else out.push(value as AnyObject);
  }
  for (const value of Object.values(objectNode)) {
    if (typeof value === "object") collectGeoBorderNodes(value, out);
  }
};

const collectGeoborders = (node: unknown, map: GeoBorderLookup) => {
  const nodes: AnyObject[] = [];
  collectGeoBorderNodes(node, nodes);
  nodes.forEach((geoBorderNode) => {
    const identifier = toText((geoBorderNode as AnyObject).identifier);
    const idAttr = toText((geoBorderNode as AnyObject).id ?? (geoBorderNode as AnyObject)["gml:id"]);
    const borderIdRaw = identifier ?? idAttr;
    if (!borderIdRaw) return;
    const borderId = normalizeUuid(borderIdRaw);

    const timeSlice = ((geoBorderNode as AnyObject).timeSlice as AnyObject | undefined) ?? undefined;
    const ts = timeSlice?.GeoBorderTimeSlice ?? timeSlice;
    const posList = findFirstPosList((ts as AnyObject)?.border ?? ts ?? geoBorderNode);
    if (!posList) return;
    const coords = coordsFromPosList(posList);
    if (!coords || !coords.length) return;
    map[borderId] = coords.map((coord) => [coord[0], coord[1]]);
  });
};

type LatLonStr = { lat: string; lon: string };
type RingSegment =
  | { kind: "geodesic"; points: LatLonStr[] }
  | { kind: "arc"; center: LatLonStr; radiusNmRaw: string; startAngleDeg: number; endAngleDeg: number }
  | { kind: "border"; uuid: string | null };

type GeometryStringSegment =
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
  | { kind: "BORDER" };

const parsePosListToLatLonStrings = (posList?: string): LatLonStr[] => {
  if (!posList) return [];
  const tokens = posList.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 4 || tokens.length % 2 !== 0) return [];
  const points: LatLonStr[] = [];
  for (let i = 0; i < tokens.length; i += 2) {
    points.push({ lat: tokens[i], lon: tokens[i + 1] });
  }
  return points;
};

const parsePosToLatLonStrings = (pos?: string): LatLonStr | null => {
  if (!pos) return null;
  const tokens = pos.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  return { lat: tokens[0], lon: tokens[1] };
};

const normalizeDeg = (deg: number) => ((deg % 360) + 360) % 360;

const directionFromAngles = (startAngleDeg: number, endAngleDeg: number): "CW" | "CCW" => {
  // AIXM ArcByCenterPoint: direction follows increasing angle values when start < end.
  return startAngleDeg <= endAngleDeg ? "CW" : "CCW";
};

const haversineMeters = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const h = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

const resolveArcOrientationWithNeighbors = (
  arc: Extract<RingSegment, { kind: "arc" }>,
  prevEnd: { lat: number; lon: number } | null,
  nextStart: { lat: number; lon: number } | null,
  opts: { toleranceMeters?: number } = {}
) => {
  const toleranceMeters = opts.toleranceMeters ?? 200;
  const radiusNm = Number(arc.radiusNmRaw);
  if (!Number.isFinite(radiusNm)) {
    return null;
  }
  const center = { lat: Number(arc.center.lat), lon: Number(arc.center.lon) };
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lon)) return null;
  const startBearing = normalizeDeg(arc.startAngleDeg);
  const endBearing = normalizeDeg(arc.endAngleDeg);
  const startPoint = destinationPoint(center, startBearing, radiusNm * 1852);
  const endPoint = destinationPoint(center, endBearing, radiusNm * 1852);
  const direction = directionFromAngles(arc.startAngleDeg, arc.endAngleDeg);

  const prevJoin = prevEnd ? haversineMeters(prevEnd, startPoint) : null;
  const nextJoin = nextStart ? haversineMeters(endPoint, nextStart) : null;
  const lowConfidence =
    (prevJoin !== null && prevJoin > toleranceMeters) ||
    (nextJoin !== null && nextJoin > toleranceMeters);

  return {
    end: endPoint,
    direction,
    prevJoin,
    nextJoin,
    lowConfidence,
  };
};

const radiusToNmString = (raw: string) => {
  const num = Number(raw);
  if (!Number.isFinite(num)) return raw;
  // Keep integers without trailing ".0"
  return Number.isInteger(num) ? String(num) : raw;
};

const parseGeometryStringSegments = (geometry: string): GeometryStringSegment[] | null => {
  const segments = geometry
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!segments.length) return null;

  const parsed: GeometryStringSegment[] = [];
  for (const seg of segments) {
    const pMatch = /^P\(([^)]+)\)$/.exec(seg);
    if (pMatch) {
      const [latStr, lonStr] = pMatch[1].split(",").map((s) => s.trim());
      const lat = Number(latStr);
      const lon = Number(lonStr);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      parsed.push({ kind: "P", lat, lon });
      continue;
    }
    const arcMatch = /^ARC\(([^)]+)\)$/.exec(seg);
    if (arcMatch) {
      const parts = arcMatch[1].split(",").map((s) => s.trim());
      if (parts.length !== 6) return null;
      const [centerLat, centerLon, radiusNmRaw, directionRaw, endLat, endLon] = parts;
      const direction = directionRaw === "CW" || directionRaw === "CCW" ? directionRaw : null;
      const radiusNm = Number(radiusNmRaw);
      if (!direction || !Number.isFinite(radiusNm)) return null;
      const centerLatNum = Number(centerLat);
      const centerLonNum = Number(centerLon);
      const endLatNum = Number(endLat);
      const endLonNum = Number(endLon);
      if (!Number.isFinite(centerLatNum) || !Number.isFinite(centerLonNum) || !Number.isFinite(endLatNum) || !Number.isFinite(endLonNum)) {
        return null;
      }
      parsed.push({
        kind: "ARC",
        centerLat: centerLatNum,
        centerLon: centerLonNum,
        radiusNm,
        direction,
        endLat: endLatNum,
        endLon: endLonNum,
      });
      continue;
    }
    const borderMatch = /^BORDER\(([^)]+)\)$/.exec(seg);
    if (borderMatch) {
      parsed.push({ kind: "BORDER" });
      continue;
    }
    return null;
  }

  return parsed;
};

const bearingDeg = (from: { lat: number; lon: number }, to: { lat: number; lon: number }): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const φ1 = toRad(from.lat);
  const φ2 = toRad(to.lat);
  const Δλ = toRad(to.lon - from.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
};

const sampleArc = (
  start: { lat: number; lon: number },
  arc: Extract<GeometryStringSegment, { kind: "ARC" }>,
  steps = 36
) => {
  const center = { lat: arc.centerLat, lon: arc.centerLon };
  const radiusMeters = arc.radiusNm * 1852;
  const startBearing = bearingDeg(center, start);
  const end = { lat: arc.endLat, lon: arc.endLon };
  const endBearing = bearingDeg(center, end);

  const cwDelta = (endBearing - startBearing + 360) % 360;
  const ccwDelta = (startBearing - endBearing + 360) % 360;
  const delta = arc.direction === "CW" ? cwDelta : ccwDelta;

  const out: { lat: number; lon: number }[] = [];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const angle = arc.direction === "CW" ? startBearing + delta * t : startBearing - delta * t;
    out.push(destinationPoint(center, (angle + 360) % 360, radiusMeters));
  }
  out.push(end);
  return out;
};

const buildRingFromGeometryString = (geometry: string): Position[] | null => {
  const segments = parseGeometryStringSegments(geometry);
  if (!segments) return null;
  const ring: Position[] = [];
  let last: { lat: number; lon: number } | null = null;

  for (const seg of segments) {
    if (seg.kind === "BORDER") return null;
    if (seg.kind === "P") {
      ring.push([seg.lon, seg.lat]);
      last = { lat: seg.lat, lon: seg.lon };
      continue;
    }
    if (seg.kind === "ARC") {
      if (!last) return null;
      const samples = sampleArc(last, seg);
      samples.forEach((p) => ring.push([p.lon, p.lat]));
      last = samples[samples.length - 1] ?? last;
    }
  }

  if (ring.length < 3) return null;
  return ensureClosedRing(ring as [number, number][]);
};

const normalizeUnit = (unit?: string | null) => (unit ?? "").trim().toLowerCase();

const radiusToMeters = (radius: number, unit?: string | null): number => {
  const u = normalizeUnit(unit);
  if (!u) return radius * 1852;
  if (u.includes("nmi")) return radius * 1852;
  if (u.includes("[nmi")) return radius * 1852;
  if (u.includes("nm")) return radius * 1852;
  if (u.includes("km")) return radius * 1000;
  if (u.includes("ft")) return radius * 0.3048;
  if (u.includes("m")) return radius;
  return radius * 1852;
};

const radiusToNm = (radius: number, unit?: string | null): number => {
  const u = normalizeUnit(unit);
  if (!u) return radius;
  if (u.includes("nmi")) return radius;
  if (u.includes("[nmi")) return radius;
  if (u.includes("nm")) return radius;
  if (u.includes("km")) return radius / 1.852;
  if (u.includes("ft")) return radius / 6076.12;
  if (u.includes("m")) return radius / 1852;
  return radius;
};

const formatCoord = (value: number) => {
  const txt = value.toFixed(9);
  return txt.replace(/\.?0+$/, "");
};

const formatDms = (value: number, isLat: boolean) => {
  const hemi = value >= 0 ? (isLat ? "N" : "E") : isLat ? "S" : "W";
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutesFull = (abs - degrees) * 60;
  const minutes = Math.floor(minutesFull);
  const seconds = (minutesFull - minutes) * 60;
  const degPad = isLat ? 2 : 3;
  const degStr = String(degrees).padStart(degPad, "0");
  const minStr = String(minutes).padStart(2, "0");
  const secStr = seconds.toFixed(2).padStart(5, "0");
  return `${hemi} ${degStr} ${minStr} ${secStr}`;
};

const formatCircleGeometryString = (circle: { lat: number; lon: number; radius: number; radiusUnit?: string | null }) => {
  const radiusNm = radiusToNm(circle.radius, circle.radiusUnit);
  const radiusStr = Number.isFinite(radiusNm)
    ? Number.isInteger(radiusNm)
      ? String(radiusNm)
      : radiusNm.toFixed(2).replace(/\.?0+$/, "")
    : String(circle.radius);
  return `Circle of radius ${radiusStr} NM centered on:\n${formatDms(circle.lat, true)} ${formatDms(circle.lon, false)}`;
};

const destinationPoint = (start: { lat: number; lon: number }, bearingDeg: number, distanceMeters: number) => {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const δ = distanceMeters / R;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(start.lat);
  const λ1 = toRad(start.lon);

  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(sinφ2);
  const y = Math.sin(θ) * Math.sin(δ) * Math.cos(φ1);
  const x = Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2);
  const λ2 = λ1 + Math.atan2(y, x);

  return { lat: toDeg(φ2), lon: ((toDeg(λ2) + 540) % 360) - 180 };
};

const sampleCircleCoords = (center: { lat: number; lon: number }, radiusMeters: number, steps = 72): Position[] => {
  const coords: Position[] = [];
  for (let i = 0; i < steps; i += 1) {
    const bearing = (i * 360) / steps;
    const point = destinationPoint(center, bearing, radiusMeters);
    coords.push([point.lon, point.lat]);
  }
  if (coords.length) {
    coords.push(coords[0]);
  }
  return coords;
};

const buildGeometryStringFromRing = (segments: RingSegment[]): string | null => {
  if (!segments.length) return null;

  const computeStartsEnds = (segs: RingSegment[]) => {
    const starts: (LatLonStr | null)[] = segs.map((seg) =>
      seg.kind === "geodesic" ? seg.points[0] ?? null : null
    );
    const ends: (LatLonStr | null)[] = segs.map((seg) =>
      seg.kind === "geodesic" ? seg.points[seg.points.length - 1] ?? null : null
    );

    // Seed arc starts/ends directly from angles when no geodesic anchors exist.
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (seg.kind !== "arc") continue;
      const radiusNm = Number(seg.radiusNmRaw);
      const centerLat = Number(seg.center.lat);
      const centerLon = Number(seg.center.lon);
      if (!Number.isFinite(radiusNm) || !Number.isFinite(centerLat) || !Number.isFinite(centerLon)) continue;
      const center = { lat: centerLat, lon: centerLon };
      if (!starts[i]) {
        const startPoint = destinationPoint(center, normalizeDeg(seg.startAngleDeg), radiusNm * 1852);
        starts[i] = { lat: formatCoord(startPoint.lat), lon: formatCoord(startPoint.lon) };
      }
      if (!ends[i]) {
        const endPoint = destinationPoint(center, normalizeDeg(seg.endAngleDeg), radiusNm * 1852);
        ends[i] = { lat: formatCoord(endPoint.lat), lon: formatCoord(endPoint.lon) };
      }
    }

    // Try to resolve missing starts by using previous segment end (wrapping ring).
    for (let pass = 0; pass < segs.length; pass++) {
      for (let i = 0; i < segs.length; i++) {
        if (starts[i]) continue;
        const prevIdx = (i - 1 + segs.length) % segs.length;
        const prevEnd = ends[prevIdx];
        if (prevEnd) starts[i] = prevEnd;
      }

      // Resolve arc/border ends as the next segment start (once available).
      for (let i = 0; i < segs.length; i++) {
        if (segs[i].kind === "geodesic") continue;
        const nextIdx = (i + 1) % segs.length;
        if (starts[nextIdx]) ends[i] = starts[nextIdx];
      }
    }

    return { starts, ends };
  };

  let segs = segments;
  let { starts, ends } = computeStartsEnds(segs);

  if (!starts[0]) {
    const idx = starts.findIndex((s) => Boolean(s));
    if (idx === -1) return null;
    const rotate = <T,>(arr: T[]) => [...arr.slice(idx), ...arr.slice(0, idx)];
    segs = rotate(segs);
    ({ starts, ends } = computeStartsEnds(segs));
    if (!starts[0]) return null;
  }

  const out: string[] = [];
  out.push(`P(${starts[0]!.lat},${starts[0]!.lon})`);

  const segOut = (s: string) => out.push(s);
  const prevKind = (i: number) => segs[(i - 1 + segs.length) % segs.length]?.kind;

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg.kind === "arc") {
      const prevIdx = (i - 1 + segs.length) % segs.length;
      const nextIdx = (i + 1) % segs.length;
      const prevEnd = ends[prevIdx] ?? starts[i] ?? null;
      const nextStart = starts[nextIdx] ?? null;
      const prevCoord = prevEnd
        ? { lat: Number(prevEnd.lat), lon: Number(prevEnd.lon) }
        : null;
      const nextCoord = nextStart
        ? { lat: Number(nextStart.lat), lon: Number(nextStart.lon) }
        : null;
      const resolved = resolveArcOrientationWithNeighbors(seg, prevCoord, nextCoord, { toleranceMeters: 200 });
      if (process.env.NODE_ENV !== "production" && process.env.AIXM_ARC_DEBUG === "1") {
        console.debug(
          `[arc ${i}] join prev=${resolved?.prevJoin?.toFixed(1) ?? "n/a"}m next=${
            resolved?.nextJoin?.toFixed(1) ?? "n/a"
          }m dir=${resolved?.direction ?? "n/a"} lowConf=${resolved?.lowConfidence ?? "n/a"}`
        );
      }
      if (!resolved) continue;
      const end = resolved.end;
      const endLat = formatCoord(end.lat);
      const endLon = formatCoord(end.lon);
      segOut(
        `ARC(${seg.center.lat},${seg.center.lon},${radiusToNmString(seg.radiusNmRaw)},${resolved.direction},${endLat},${endLon})`
      );
      continue;
    }
    if (seg.kind === "border") {
      const start = starts[i];
      const end = ends[i];
      if (!start || !end) continue;
      // Support both formats:
      // - BORDER(fromLat,fromLon,toLat,toLon) (legacy)
      // - BORDER(uuid,fromLat,fromLon,toLat,toLon) (preferred for GeoJSON export + filtering)
      segOut(
        seg.uuid
          ? `BORDER(${seg.uuid},${start.lat},${start.lon},${end.lat},${end.lon})`
          : `BORDER(${start.lat},${start.lon},${end.lat},${end.lon})`
      );
      continue;
    }
    if (seg.kind === "geodesic") {
      const points = seg.points;
      if (!points.length) continue;
      const shouldSkipFirst = prevKind(i) === "arc";
      const startIdx = shouldSkipFirst ? 1 : 0;
      for (let p = startIdx; p < points.length; p++) {
        const point = points[p];
        segOut(`P(${point.lat},${point.lon})`);
      }
      continue;
    }
  }

  return out.join(" | ");
};

const collectRingSegments = (node: AnyObject): RingSegment[] => {
  // Walk down to Ring.curveMember, but accept different nesting patterns.
  const ring = (() => {
    const safeNode = node as AnyObject;
    const patchesContainer = (safeNode.patches as AnyObject | undefined) ?? undefined;
    const nestedPatches = (patchesContainer?.patches as AnyObject | undefined) ?? undefined;
    const patches =
      (patchesContainer as AnyObject | undefined)?.PolygonPatch ??
      (nestedPatches as AnyObject | undefined)?.PolygonPatch;
    const polygonPatch = Array.isArray(patches) ? patches[0] : patches;
    const exterior = polygonPatch?.exterior;
    const ringNode = exterior?.Ring ?? exterior?.ring ?? exterior;
    return ringNode as AnyObject | undefined;
  })();
  if (!ring) return [];

  const curveMembers = asArray((ring as AnyObject).curveMember);
  const segments: RingSegment[] = [];

  curveMembers.forEach((member) => {
    if (!member) return;
    if (typeof member === "object" && (member as AnyObject).href) {
      const href = toText((member as AnyObject).href) ?? "";
      const uuid = href.startsWith("urn:uuid:") ? href.replace("urn:uuid:", "") : href || null;
      segments.push({ kind: "border", uuid });
      return;
    }
    const curve = (member as AnyObject)?.Curve ?? member;
    const segsContainer = (curve as AnyObject)?.segments ?? {};
    const arc = (segsContainer as AnyObject)?.ArcByCenterPoint;
    const circle = (segsContainer as AnyObject)?.CircleByCenterPoint;
    const geodesic = (segsContainer as AnyObject)?.GeodesicString;
    if (arc) {
      const arcNode = Array.isArray(arc) ? arc[0] : arc;
      const center = parsePosToLatLonStrings(toText((arcNode as AnyObject).pos));
      const radiusRaw = toText((arcNode as AnyObject).radius) ?? "";
      const startAngle = Number(toText((arcNode as AnyObject).startAngle) ?? "NaN");
      const endAngle = Number(toText((arcNode as AnyObject).endAngle) ?? "NaN");
      if (center && Number.isFinite(startAngle) && Number.isFinite(endAngle)) {
        segments.push({
          kind: "arc",
          center,
          radiusNmRaw: radiusRaw,
          startAngleDeg: startAngle,
          endAngleDeg: endAngle,
        });
      }
      return;
    }
    if (circle) {
      const circleNode = Array.isArray(circle) ? circle[0] : circle;
      const center = parsePosToLatLonStrings(toText((circleNode as AnyObject).pos));
      const radiusRaw = toText((circleNode as AnyObject).radius);
      const radiusNode = (circleNode as AnyObject).radius as AnyObject | undefined;
      const radiusUnit = toText(radiusNode?.uom ?? radiusNode?.unit);
      const radius = radiusRaw ? Number(radiusRaw) : NaN;
      if (center && Number.isFinite(radius)) {
        const radiusMeters = radiusToMeters(radius, radiusUnit);
        const points = sampleCircleCoords(
          { lat: Number(center.lat), lon: Number(center.lon) },
          radiusMeters
        );
        const asStrings = points.map((p) => ({ lat: formatCoord(p[1] as number), lon: formatCoord(p[0] as number) }));
        segments.push({ kind: "geodesic", points: asStrings });
      }
      return;
    }
    if (geodesic) {
      const geoNode = Array.isArray(geodesic) ? geodesic[0] : geodesic;
      const posList = toText((geoNode as AnyObject).posList);
      const points = parsePosListToLatLonStrings(posList);
      if (points.length) segments.push({ kind: "geodesic", points });
      return;
    }
  });

  return segments;
};

const geometryStringFromHorizontalProjection = (horizontalProjection: AnyObject): string | null => {
  const surface = (horizontalProjection as AnyObject)?.Surface ?? (horizontalProjection as AnyObject)?.surface ?? horizontalProjection;
  if (!surface || typeof surface !== "object") return null;
  const circle = findCircle(surface as AnyObject);
  if (circle && circle.radius !== undefined && circle.radius !== null) {
    return formatCircleGeometryString(circle as { lat: number; lon: number; radius: number; radiusUnit?: string | null });
  }
  const ringSegments = collectRingSegments(surface as AnyObject);
  if (!ringSegments.length) return null;
  return buildGeometryStringFromRing(ringSegments);
};

const collectPosLists = (node: unknown, acc: string[] = []): string[] => {
  if (!node || typeof node !== "object") return acc;
  const objectNode = node as AnyObject;
  const candidates = ["posList", "pos", "coordinates"];
  for (const key of candidates) {
    if (objectNode[key] !== undefined) {
      const value = toText(objectNode[key]);
      if (value) acc.push(value);
    }
  }
  Object.values(objectNode).forEach((value) => {
    if (typeof value === "object") collectPosLists(value, acc);
  });
  return acc;
};

const findCircle = (node: unknown): { lat: number; lon: number; radius?: number; radiusUnit?: string } | null => {
  if (!node || typeof node !== "object") return null;
  const objectNode = node as AnyObject;
  const circleNodeRaw = objectNode.CircleByCenterPoint ?? (objectNode as AnyObject).circleByCenterPoint;
  if (circleNodeRaw) {
    const circleNode = Array.isArray(circleNodeRaw) ? circleNodeRaw[0] : (circleNodeRaw as AnyObject);
    const pos = toText(circleNode.pos);
    const radius = toNumber(circleNode.radius);
    const radiusUnit = toText((circleNode.radius as AnyObject)?.uom ?? (circleNode.radius as AnyObject)?.unit);
    const coords = pos ? coordsFromPosList(pos) : null;
    if (coords && coords.length) {
      const [lon, lat] = coords[0];
      return { lat, lon, radius: radius ?? undefined, radiusUnit: radiusUnit ?? undefined };
    }
    const single = pos ? parsePosToLatLonStrings(pos) : null;
    if (single) {
      const lat = Number(single.lat);
      const lon = Number(single.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return { lat, lon, radius: radius ?? undefined, radiusUnit: radiusUnit ?? undefined };
      }
    }
  }
  for (const value of Object.values(objectNode)) {
    const found = findCircle(value);
    if (found) return found;
  }
  return null;
};

const findPoint = (node: unknown): { lat: number; lon: number } | null => {
  if (!node || typeof node !== "object") return null;
  const objectNode = node as AnyObject;
  const pos = toText(objectNode.pos ?? objectNode.position ?? objectNode.Point);
  if (pos) {
    const coords = coordsFromPosList(pos);
    if (coords && coords.length) {
      const [lon, lat] = coords[0];
      return { lat, lon };
    }
  }
  for (const value of Object.values(objectNode)) {
    const found = findPoint(value);
    if (found) return found;
  }
  return null;
};

const findLatLonInExtension = (slice: AnyObject): { lat: number; lon: number } | null => {
  const extensionNode = slice.extension as AnyObject | undefined;
  const ext =
    (slice.extension as AnyObject | undefined) ??
    (slice.extensions as AnyObject | undefined) ??
    (slice.AirspaceExtension as AnyObject | undefined) ??
    extensionNode?.AirspaceExtension;
  if (!ext || typeof ext !== "object") return null;
  const objectExt = ext as AnyObject;
  const lat = toNumber(objectExt.latitude);
  const lon = toNumber(objectExt.longitude);
  if (lat !== null && lon !== null) {
    return { lat, lon };
  }
  for (const value of Object.values(objectExt)) {
    if (typeof value === "object") {
      const found = findLatLonInExtension(value as AnyObject);
      if (found) return found;
    }
  }
  return null;
};

const parseValidTime = (slice: AnyObject): { begin?: string; end?: string } | null => {
  const validTimeNode = slice.validTime ?? slice.gmlvalidTime ?? slice["gml:validTime"];
  if (!validTimeNode || typeof validTimeNode !== "object") return null;
  const begin = findTextDeep(validTimeNode, ["beginPosition", "timePosition", "start"]);
  const end = findTextDeep(validTimeNode, ["endPosition", "stop", "end"]);
  if (!begin && !end) return null;
  return { begin: begin ?? undefined, end: end ?? undefined };
};

const normalizeVerticalReference = (value: string | undefined) => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split(/[\\/#.]/g).filter(Boolean);
  const last = parts.length ? parts[parts.length - 1] : trimmed;
  return last.trim().toUpperCase();
};

const parseVerticalLimit = (node: unknown, key: VerticalLimit["key"]): VerticalLimit | null => {
  if (!node || typeof node !== "object") return null;
  const objectNode = node as AnyObject;
  if (objectNode[key] === undefined) return null;
  const rawPayload = Array.isArray(objectNode[key]) ? (objectNode[key] as AnyObject[])[0] : (objectNode[key] as AnyObject);
  const payload = rawPayload as AnyObject;
  const value = toNumber(payload?._ ?? payload) ?? null;
  const uom =
    toText(payload?.uom ?? payload?.unit) ??
    toText(objectNode[`${key}Unit`]) ??
    (Array.isArray(objectNode[`${key}Unit`]) ? toText((objectNode[`${key}Unit`] as AnyObject[])[0]) : undefined);
  const referenceRaw =
    toText(objectNode[`${key}Reference`]) ??
    toText((objectNode[`${key}Reference`] as AnyObject | undefined)?.href) ??
    toText((objectNode[`${key}Reference`] as AnyObject | undefined)?.["xlink:href"]) ??
    toText(payload?.reference) ??
    toText(payload?.ref) ??
    toText(payload?.verticalReference) ??
    toText(payload?.verticalreference) ??
    toText(objectNode?.verticalReference) ??
    toText(objectNode?.verticalreference) ??
    toText(objectNode[`${key}Ref`]);
  const reference = normalizeVerticalReference(referenceRaw);
  const type = toText(payload?.type);
  const unit = toText(payload?.unit);
  return { key, value, uom: uom ?? undefined, reference: reference ?? undefined, type: type ?? undefined, unit: unit ?? undefined };
};

const parseVerticalLimits = (volume: AnyObject | undefined): Partial<Record<VerticalLimit["key"], VerticalLimit>> => {
  if (!volume || typeof volume !== "object") return {};
  const limits: Partial<Record<VerticalLimit["key"], VerticalLimit>> = {};
  (["upperLimit", "lowerLimit", "maximumLimit", "minimumLimit"] as VerticalLimit["key"][]).forEach((key) => {
    const parsed = parseVerticalLimit(volume, key);
    if (parsed) limits[key] = parsed;
  });
  return limits;
};

const parseClasses = (slice: AnyObject): ParsedClass[] => {
  const classNodes = asArray(slice.class ?? slice.airspaceClass ?? slice.AirspaceLayerClass ?? slice.AirspaceLayer);
  return classNodes
    .map((node) => {
      if (!node || typeof node !== "object") return null;
      const obj = (node as AnyObject).AirspaceLayerClass ?? node;
      const value =
        toText((obj as AnyObject).classification) ??
        toText((obj as AnyObject).value) ??
        toText(obj);
      const schedule =
        (obj as AnyObject).annotation ??
        (obj as AnyObject).Timesheet ??
        (obj as AnyObject).timeSheet ??
        null;
      if (!value && !schedule) return null;
      return { value: value ?? undefined, schedule: schedule ?? null };
    })
    .filter(Boolean) as ParsedClass[];
};

const parseActivations = (slice: AnyObject): ParsedActivation[] => {
  const activations = asArray(slice.activation ?? slice.Activation);
  return activations
    .map((node) => {
      if (!node || typeof node !== "object") return null;
      const obj = node as AnyObject;
      const activity = toText(obj.activity ?? obj.type);
      const status = toText(obj.status);
      const levels = toText(obj.levels ?? obj.level);
      const user = toText(obj.user ?? obj.controllingUnit ?? obj.usingUnit);
      const aircraft = toText(obj.aircraft ?? obj.aircraftCategory);
      if (!(activity || status || levels || user || aircraft)) return null;
      return { activity: activity ?? undefined, status: status ?? undefined, levels: levels ?? undefined, user: user ?? undefined, aircraft: aircraft ?? undefined, raw: obj };
    })
    .filter(Boolean) as ParsedActivation[];
};

const parseAnnotations = (slice: AnyObject): string[] => {
  const annotations = asArray(slice.annotation ?? slice.txtRmk ?? slice.remarks);
  return annotations
    .map((node) => {
      if (typeof node === "string") return node;
      if (typeof node === "number") return node.toString();
      if (node && typeof node === "object") {
        return toText((node as AnyObject).text ?? (node as AnyObject).value ?? node);
      }
      return null;
    })
    .filter(Boolean) as string[];
};

const parseLineStringGeometry = (node: unknown) => {
  const posList = findFirstPosList(node);
  const coords = coordsFromPosList(posList);
  if (coords && coords.length >= 2) {
    return {
      geojson: {
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords } as LineString,
        properties: {},
      } as Feature<Geometry>,
      geometryStatus: "partial" as const,
      centroidLat: coords[0][1],
      centroidLon: coords[0][0],
      geomType: "LineString",
      bbox: bboxFromCoords(coords),
    };
  }
  return null;
};

const parseSurfaceGeometry = (node: unknown) => {
  const circle = findCircle(node);
  if (circle && circle.radius !== undefined && circle.radius !== null) {
    const radiusMeters = radiusToMeters(circle.radius, circle.radiusUnit);
    const ring = sampleCircleCoords({ lat: circle.lat, lon: circle.lon }, radiusMeters);
    if (ring.length >= 4) {
      const centroid = centroidFromPolygon(ring as [number, number][]);
      const bbox = bboxFromCoords(ring as [number, number][]);
      const polygon: Feature<Polygon> = {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [ring as Position[]],
        },
        properties: {},
      };
      return {
        geojson: polygon as Feature<Geometry>,
        geometryStatus: "ok" as const,
        centroidLat: centroid?.lat ?? circle.lat,
        centroidLon: centroid?.lon ?? circle.lon,
        bbox: bbox ?? null,
        geomType: "Polygon",
      };
    }
  }

  const allPosLists = collectPosLists(node);
  const combinedCoords =
    allPosLists.length > 1
      ? allPosLists.flatMap((p) => coordsFromPosList(p) ?? [])
      : coordsFromPosList(findFirstPosList(node));
  const coords = combinedCoords && combinedCoords.length ? combinedCoords : null;
  if (coords && coords.length >= 3) {
    const ring = ensureClosedRing(coords);
    const centroid = centroidFromPolygon(ring);
    const bbox = bboxFromCoords(ring);
    const polygon: Feature<Polygon> = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [ring as Position[]],
      },
      properties: {},
    };
    return {
      geojson: polygon as Feature<Geometry>,
      geometryStatus: "ok" as const,
      centroidLat: centroid?.lat ?? null,
      centroidLon: centroid?.lon ?? null,
      bbox,
      geomType: "Polygon",
    };
  }
  return null;
};

const resolveGeoBorder = (component: AnyObject, geoborders: GeoBorderLookup): ParsedGeometryComponent | null => {
  const geoBorderNode =
    (component as AnyObject).theGeoborder ??
    (component as AnyObject).geoborder ??
    (component as AnyObject).geoBorder ??
    (component as AnyObject).theGeoBorder ??
    (component as AnyObject).GeoBorder;
  if (!geoBorderNode || typeof geoBorderNode !== "object") return null;
  const href =
    toText((geoBorderNode as AnyObject).href) ??
    toText((geoBorderNode as AnyObject).xlinkhref) ??
    toText((geoBorderNode as AnyObject).xlinkHref) ??
    toText((geoBorderNode as AnyObject).id) ??
    toText(geoBorderNode);
  if (!href) return null;
  const key = href.replace(/^#/, "");
  const coords = geoborders[key];
  if (!coords || !coords.length) return null;
  const line: Feature<LineString> = {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: coords as Position[],
    },
    properties: {},
  };
  return {
    operation: undefined,
    operationSequence: null,
    geometryStatus: "ok",
    warnings: [],
    geojson: line as Feature<Geometry>,
    bbox: bboxFromCoords(coords as [number, number][]) ?? undefined,
    centroidLat: coords[0]?.[1] ?? null,
    centroidLon: coords[0]?.[0] ?? null,
    geomType: "LineString",
  };
};

const parseGeometryComponent = (component: AnyObject, slice?: AnyObject, geoborders?: GeoBorderLookup): ParsedGeometryComponent => {
  const operation = toText(component.operation);
  const operationSequence = toNumber(component.operationSequence);
  const rawVolume =
    component.theAirspaceVolume ??
    component.airspaceVolume ??
    component.theGeometry ??
    component.horizontalProjection ??
    component.AirspaceVolume;
  const volumeInner =
    (rawVolume as AnyObject)?.AirspaceVolume ??
    (Array.isArray(rawVolume) ? (rawVolume as AnyObject[])[0] : rawVolume);
  const volume = (volumeInner as AnyObject) ?? rawVolume;
  const verticalLimits = parseVerticalLimits(volume as AnyObject);

  const warnings: string[] = [];

  // Important: contributorAirspace may exist without inline geometry. We still need to record the
  // derivedFromAirspaceId so geometry aggregation can resolve it later.
  const contributor = (volume as AnyObject)?.contributorAirspace ?? (component as AnyObject).contributorAirspace;
  const contributorHref = contributor ? findContributorAirspaceHref(contributor) : undefined;
  const derivedFromAirspaceId = contributorHref ? normalizeUuid(contributorHref) : null;

  const horizontalProjection =
    (volume as AnyObject)?.horizontalProjection ??
    (volume as AnyObject)?.theGeometry ??
    (component as AnyObject).horizontalProjection ??
    (component as AnyObject).theGeometry;
  const centreline = (volume as AnyObject)?.centreline ?? (component as AnyObject).centreline;

  let geometry =
    (geoborders ? resolveGeoBorder(component, geoborders) : null) ??
    parseSurfaceGeometry(horizontalProjection ?? volume) ??
    parseLineStringGeometry(horizontalProjection ?? volume) ??
    parseLineStringGeometry(centreline) ??
    parseSurfaceGeometry(volume) ??
    null;

  let geometryString = horizontalProjection && typeof horizontalProjection === "object"
    ? geometryStringFromHorizontalProjection(horizontalProjection as AnyObject)
    : null;

  const circleForString = findCircle(horizontalProjection ?? volume ?? component);
  if (circleForString && circleForString.radius !== undefined && circleForString.radius !== null) {
    geometryString = formatCircleGeometryString(
      circleForString as { lat: number; lon: number; radius: number; radiusUnit?: string | null }
    );
  }

  if (!geometry) {
    if (geometryString) {
      const ring = buildRingFromGeometryString(geometryString);
      if (ring) {
        const centroid = centroidFromPolygon(ring as [number, number][]);
        const bbox = bboxFromCoords(ring as [number, number][]);
        const polygon: Feature<Polygon> = {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [ring as Position[]],
          },
          properties: {},
        };
        geometry = {
          geojson: polygon as Feature<Geometry>,
          geometryStatus: "ok" as const,
          centroidLat: centroid?.lat ?? null,
          centroidLon: centroid?.lon ?? null,
          bbox,
          geomType: "Polygon",
        };
      }
    }
  }

  if (!geometry && geometryString && geoborders) {
    const geoBorderResolver: TransitiveGeoBorderResolver = (uuid) => {
      const coords = geoborders[uuid];
      if (!coords) return null;
      return coords.map((pair) => ({ lon: pair[0], lat: pair[1] }));
    };
    const mp = geometryStringToMultiPolygon(geometryString, geoBorderResolver);
    if (mp && mp.length) {
      const allCoords = mp.flatMap((poly) => poly.flat());
      const bbox = allCoords.length ? bboxFromCoords(allCoords as [number, number][]) : undefined;
      const exterior = mp[0]?.[0] ?? [];
      const centroid = exterior.length >= 3 ? centroidFromPolygon(exterior as [number, number][]) : null;
      const geojson: Feature<Geometry> =
        mp.length === 1
          ? ({
              type: "Feature",
              geometry: { type: "Polygon", coordinates: mp[0] as any },
              properties: {},
            } as Feature<Geometry>)
          : ({
              type: "Feature",
              geometry: { type: "MultiPolygon", coordinates: mp as any },
              properties: {},
            } as Feature<Geometry>);
      geometry = {
        geojson,
        geometryStatus: "ok" as const,
        centroidLat: centroid?.lat ?? null,
        centroidLon: centroid?.lon ?? null,
        bbox: bbox ?? null,
        geomType: geojson.geometry.type,
      };
    }
  }

  if (!geometry) {
    const circle = findCircle(volume ?? component);
    if (circle) {
      warnings.push(
        `Circle stored as centroid${circle.radius ? ` (radius ${circle.radius}${circle.radiusUnit ? ` ${circle.radiusUnit}` : ""})` : ""}.`
      );
      geometry = {
        geometryStatus: "centroid_only" as const,
        centroidLat: circle.lat,
        centroidLon: circle.lon,
        geomType: "Point",
        warnings: [],
      };
    }
  }

  if (!geometry) {
    const pointFallback = findPoint(volume ?? component);
    if (pointFallback) {
      warnings.push("Geometry not convertible; stored centroid only.");
      geometry = {
        geometryStatus: "centroid_only" as const,
        centroidLat: pointFallback.lat,
        centroidLon: pointFallback.lon,
        geomType: "Point",
        warnings: [],
      };
    }
  }

  if (!geometry) {
    const extPoint = findLatLonInExtension(component) ?? (slice ? findLatLonInExtension(slice) : null);
    if (extPoint) {
      warnings.push("Geometry not provided; centroid from extension latitude/longitude.");
      geometry = {
        geometryStatus: "centroid_only" as const,
        centroidLat: extPoint.lat,
        centroidLon: extPoint.lon,
        geomType: "Point",
        warnings: [],
      };
    }
  }

  if (!geometry) {
    // If a contributor airspace is present, missing inline geometry is expected and will be resolved
    // during aggregation. Avoid emitting noisy warnings per component.
    if (contributor && !contributorHref) {
      warnings.push("Geometry references contributorAirspace without inline geometry; centroid missing.");
    }
  }

  if (!geometry) {
    // Don't warn for contributor-only components: they intentionally have no inline geometry.
    if (!derivedFromAirspaceId) {
      warnings.push("No usable geometry found for component.");
    }
    return {
      operation: operation ?? undefined,
      operationSequence,
      geometryStatus: "missing",
      warnings,
      geometryString,
      derivedFromAirspaceId,
      verticalLimits,
    };
  }

  const status = geometry.geojson ? geometry.geometryStatus ?? "ok" : geometry.geometryStatus ?? "centroid_only";
  return {
    operation: operation ?? undefined,
    operationSequence,
    geometryStatus: status,
    warnings,
    geometryString,
    derivedFromAirspaceId,
    geojson: geometry.geojson ?? null,
    bbox: geometry.bbox ?? undefined,
    centroidLat: geometry.centroidLat ?? null,
    centroidLon: geometry.centroidLon ?? null,
    geomType: geometry.geomType,
    verticalLimits,
  };
};

const collectGeometryComponents = (slice: AnyObject, geoborders?: GeoBorderLookup): ParsedGeometryComponent[] => {
  const components = asArray(
    slice.geometryComponent ?? slice.geometryComponents ?? slice.AirspaceGeometryComponent ?? slice.theGeometryComponent
  );
  if (!components.length && (slice.theGeometry || slice.horizontalProjection)) {
    return [parseGeometryComponent(slice as AnyObject, slice, geoborders)];
  }
  return components
    .map((component) => {
      if (!component || typeof component !== "object") return null;
      const inner =
        (component as AnyObject).AirspaceGeometryComponent ??
        (component as AnyObject).geometryComponent ??
        (component as AnyObject).theGeometryComponent ??
        component;
      return parseGeometryComponent(inner as AnyObject, slice, geoborders);
    })
    .filter(Boolean) as ParsedGeometryComponent[];
};

const parseTimeSlice = (slice: AnyObject, geoborders?: GeoBorderLookup): ParsedTimeSlice => {
  const validTime = parseValidTime(slice);
  const interpretation = toText(slice.interpretation);
  const sequenceNumber = toNumber(slice.sequenceNumber);
  const correctionNumber = toNumber(slice.correctionNumber);
  const designator =
    toText(slice.designator ?? slice.identifier ?? slice.gmlidentifier ?? slice.id) ??
    toText(slice.name) ??
    undefined;

  const geometryComponents = collectGeometryComponents(slice, geoborders);
  const verticalLimits = geometryComponents.find((c) => c.verticalLimits && Object.keys(c.verticalLimits).length)?.verticalLimits;
  const classes = parseClasses(slice);
  const activations = parseActivations(slice);
  const notes = parseAnnotations(slice);
  const warnings: string[] = [];
  const aipFilterNl = (() => {
    const safeSlice = slice as AnyObject;
    const extensionNode = safeSlice.extension as AnyObject | undefined;
    const extensionAirspace = extensionNode ? (extensionNode as AnyObject)["AirspaceExtension"] : undefined;
    const findExtension = (node?: AnyObject | null) => {
      if (!node || typeof node !== "object") return undefined;
      if (node.AirspaceExtension) return node.AirspaceExtension;
      const key = Object.keys(node).find((k) => k === "AirspaceExtension" || k.endsWith(":AirspaceExtension"));
      if (key) return (node as AnyObject)[key];
      return undefined;
    };
    const ext =
      findExtension(safeSlice) ??
      findExtension(extensionNode) ??
      (safeSlice.extension as AnyObject | undefined) ??
      (safeSlice.extensions as AnyObject | undefined) ??
      extensionAirspace;
    if (!ext || typeof ext !== "object") return null;
    const value =
      toText((ext as AnyObject).aip_filt_nl ?? (ext as AnyObject).aipFiltNl) ??
      toText((ext as AnyObject)["adfe:aip_filt_nl"] ?? (ext as AnyObject)["adfe:aipFiltNl"]);
    if (!value) return null;
    const normalized = value.trim().toUpperCase();
    if (normalized === "YES") return true;
    if (normalized === "NO") return false;
    return null;
  })();

  return {
    interpretation: interpretation ?? undefined,
    sequenceNumber: sequenceNumber,
    correctionNumber: correctionNumber,
    validTimeBegin: validTime?.begin ?? null,
    validTimeEnd: validTime?.end ?? null,
    designator: designator ?? null,
    identifier: toText(slice.identifier) ?? null,
    name: toText(slice.name) ?? null,
    type: toText(slice.type) ?? null,
    localType: toText(slice.localType) ?? null,
    designatorICAO: toText(slice.designatorICAO) ?? null,
    controlType: toText(slice.controlType) ?? null,
    upperLowerSeparation: toText(slice.upperLowerSeparation) ?? null,
    aipFilterNl,
    classes,
    activations,
    notes,
    warnings,
    geometryComponents,
    verticalLimits,
  };
};

const isCurrentlyValid = (slice: ParsedTimeSlice, now: Date): boolean => {
  if (!slice.validTimeBegin && !slice.validTimeEnd) return false;
  const begin = slice.validTimeBegin ? new Date(slice.validTimeBegin) : null;
  const end = slice.validTimeEnd ? new Date(slice.validTimeEnd) : null;
  if (begin && Number.isNaN(begin.getTime())) return false;
  if (end && Number.isNaN(end.getTime())) return false;
  if (begin && now < begin) return false;
  if (end && now > end) return false;
  return true;
};

const pickActiveTimeSlice = (slices: ParsedTimeSlice[]): ParsedTimeSlice | null => {
  if (!slices.length) return null;
  const now = new Date();
  const normalizedInterpretation = (interpretation?: string | null) =>
    interpretation ? interpretation.toUpperCase() : undefined;

  const baselineOrSnapshot = slices.filter((s) => {
    const value = normalizedInterpretation(s.interpretation);
    return value === "BASELINE" || value === "SNAPSHOT";
  });

  let candidates = baselineOrSnapshot.length ? baselineOrSnapshot : slices;
  const withValidTime = candidates.filter((s) => s.validTimeBegin || s.validTimeEnd);

  const current = withValidTime.filter((s) => isCurrentlyValid(s, now));
  if (current.length) {
    candidates = current;
  } else if (withValidTime.length) {
    candidates = withValidTime;
  }

  // Prefer slices that actually contain usable geometry (or a geometryString), because some
  // AIXM datasets include later BASELINE slices that only update metadata and omit geometry.
  const hasUsableGeometry = (s: ParsedTimeSlice) =>
    (s.geometryComponents ?? []).some((c) => Boolean(c.geojson) || Boolean(c.geometryString));

  candidates = [...candidates].sort((a, b) => {
    const geomA = hasUsableGeometry(a) ? 1 : 0;
    const geomB = hasUsableGeometry(b) ? 1 : 0;
    if (geomA !== geomB) return geomB - geomA;

    const seqA = a.sequenceNumber ?? -Infinity;
    const seqB = b.sequenceNumber ?? -Infinity;
    if (seqA !== seqB) return seqB - seqA;
    const corrA = a.correctionNumber ?? -Infinity;
    const corrB = b.correctionNumber ?? -Infinity;
    if (corrA !== corrB) return corrB - corrA;
    const beginA = a.validTimeBegin ? new Date(a.validTimeBegin).getTime() : -Infinity;
    const beginB = b.validTimeBegin ? new Date(b.validTimeBegin).getTime() : -Infinity;
    return beginB - beginA;
  });

  return candidates[0] ?? null;
};

const geometryStatusFromComponents = (components: ParsedGeometryComponent[]): ParsedAirspace["geometryStatus"] => {
  if (!components.length) return "missing";
  const hasGeojson = components.some((c) => c.geojson);
  if (hasGeojson) {
    const hasMissing = components.some((c) => c.geometryStatus === "missing" || c.geometryStatus === "centroid_only");
    return hasMissing ? "partial" : "ok";
  }
  const hasCentroid = components.some((c) => c.geometryStatus === "centroid_only");
  if (hasCentroid) return "centroid_only";
  return "missing";
};

const aggregateCentroid = (components: ParsedGeometryComponent[]): { lat: number | null; lon: number | null } => {
  for (const component of components) {
    if (component.centroidLat !== undefined && component.centroidLat !== null && component.centroidLon !== undefined) {
      return { lat: component.centroidLat, lon: component.centroidLon };
    }
    if (component.geojson?.geometry?.type === "Polygon") {
      const coords = (component.geojson.geometry as Polygon).coordinates?.[0] as Position[] | undefined;
      if (coords) {
        const centroid = centroidFromPolygon(coords as [number, number][]);
        if (centroid) return { lat: centroid.lat, lon: centroid.lon };
      }
    }
  }
  return { lat: null, lon: null };
};

export const parseAixm = async (input: string | Buffer, externalGeoborders?: GeoBorderLookup): Promise<ParsedAirspace[]> => {
  const xml = typeof input === "string" ? input : input.toString("utf-8");
  const parsed = await parseStringPromise(xml, {
    explicitArray: false,
    mergeAttrs: true,
    tagNameProcessors: [processors.stripPrefix],
    attrNameProcessors: [processors.stripPrefix],
    xmlns: false,
  });

  const geoborders: GeoBorderLookup = { ...(externalGeoborders ?? {}) };
  collectGeoborders(parsed, geoborders);

  const airspaceNodes = collectAirspaceNodes(parsed);

  const parsedAirspaces = airspaceNodes.map((airspace, index) => {
    const gmlIdRaw = toText(airspace.id ?? airspace.gmlid ?? airspace["gml:id"]) ?? null;
    const gmlId = gmlIdRaw ? normalizeUuid(gmlIdRaw) : null;
    const timeSlices = findTimeSlices(airspace).map((slice) => parseTimeSlice(slice as AnyObject, geoborders));
    const activeSlice = pickActiveTimeSlice(timeSlices);

    const geometryStatus = geometryStatusFromComponents(activeSlice?.geometryComponents ?? []);
    const centroid = aggregateCentroid(activeSlice?.geometryComponents ?? []);
    const bbox = activeSlice?.geometryComponents.find((c) => c.bbox)?.bbox;

    const warnings: string[] = [];
    if (!activeSlice) warnings.push("No AirspaceTimeSlice available.");
    if (activeSlice && geometryStatus === "missing") warnings.push("No usable geometry on active timeSlice.");

    const rawFragment = JSON.stringify(timeSlices[0] ?? airspace);
    const sourceRef = gmlIdRaw ? `//Airspace[@gml:id='${gmlIdRaw}']` : `//Airspace[${index + 1}]`;

    return {
      gmlId,
      sourceRef,
      rawFragment: rawFragment.length > 4000 ? `${rawFragment.slice(0, 4000)}...` : rawFragment,
      timeSlices,
      activeSlice,
      warnings,
      geometryStatus,
      centroidLat: centroid.lat,
      centroidLon: centroid.lon,
      bbox,
    } as ParsedAirspace;
  });

  // Second pass: compute aggregated geometry (BASE/UNION/SUBTR/INTERS) across geometry components.
  // This is optional: if operations are missing/invalid or boolean-clipping dependency is missing,
  // we keep the original per-component geometries and add warnings instead.
  const opNorm = (op?: string | null): AggComponent["operation"] | null => {
    const txt = (op ?? "").toUpperCase();
    if (txt === "BASE") return "BASE";
    if (txt === "UNION" || txt === "ADD") return "UNION";
    if (txt === "SUBTR" || txt === "SUBTRACT" || txt === "DIFFERENCE") return "SUBTR";
    if (txt === "INTERS" || txt === "INTERSECTION" || txt === "INTERSECT") return "INTERS";
    return null;
  };

  const toMultiPolygon = (feature?: Feature<Geometry> | null): AggMultiPolygon | null => {
    const geom = feature?.geometry;
    if (!geom) return null;
    if (geom.type === "Polygon") return [geom.coordinates as any];
    if (geom.type === "MultiPolygon") return geom.coordinates as any;
    return null;
  };

  const airspacesById = new Map<string, AggAirspace>();
  const volumesById = new Map<string, AggVolume>();

  parsedAirspaces.forEach((a) => {
    const slice = a.activeSlice;
    if (!slice || !a.gmlId) return;
    const components: AggComponent[] = [];

    slice.geometryComponents.forEach((c, idx) => {
      const seq = c.operationSequence ?? idx + 1;
      const op = opNorm(c.operation);
      const volumeId = `${a.gmlId}:${seq}`;

      const mp = toMultiPolygon(c.geojson ?? null);
      const verticalFromComponent = {
        lowerFt: (c.verticalLimits as any)?.lowerLimit?.value ?? undefined,
        lowerRef: (c.verticalLimits as any)?.lowerLimit?.reference ?? undefined,
        upperFt: (c.verticalLimits as any)?.upperLimit?.value ?? undefined,
        upperRef: (c.verticalLimits as any)?.upperLimit?.reference ?? undefined,
      };
      const geometry = mp
        ? {
            horizontal: mp,
            ...verticalFromComponent,
          }
        : undefined;

      const derivedFromAirspaceId = c.derivedFromAirspaceId ? normalizeUuid(c.derivedFromAirspaceId) : undefined;
      volumesById.set(volumeId, { id: volumeId, geometry, derivedFromAirspaceId, vertical: verticalFromComponent });

      if (op) {
        components.push({ volumeId, operation: op, operationSequence: seq });
      }
    });

    airspacesById.set(a.gmlId, {
      id: a.gmlId,
      designator: slice.designator ?? a.gmlId,
      name: slice.name ?? slice.designator ?? a.gmlId,
      components,
    });
  });

  for (const a of parsedAirspaces) {
    const slice = a.activeSlice;
    if (!slice || !a.gmlId) continue;
    const aggAirspace = airspacesById.get(a.gmlId);
    if (!aggAirspace) continue;
    if (!aggAirspace.components.length) continue;

    const first = [...aggAirspace.components].sort((x, y) => x.operationSequence - y.operationSequence)[0];
    if (!first || first.operation !== "BASE" || first.operationSequence !== 1) {
      // Don't hard-fail parsing; just skip aggregation and keep component geometries.
      slice.warnings.push("Geometry aggregation skipped: first component must be BASE with operationSequence=1.");
      continue;
    }

    try {
      const agg = await computeAirspaceAggregatedGeometry(aggAirspace, volumesById, airspacesById);
      const mp = agg.geometry;
      const aggWarnings = agg.warnings.filter(
        (w) => w !== "Vertical limits differ between components; manual review needed."
      );
      if (!mp.length) {
        slice.warnings.push(...aggWarnings);
        slice.aggregatedGeometry = null;
        continue;
      }

      // Represent aggregated result as a GeoJSON Feature. Use Polygon when possible.
      const geojson: Feature<Geometry> = mp.length === 1
        ? ({
            type: "Feature",
            geometry: { type: "Polygon", coordinates: mp[0] as any },
            properties: {},
          } as Feature<Geometry>)
        : ({
            type: "Feature",
            geometry: { type: "MultiPolygon", coordinates: mp as any },
            properties: {},
          } as Feature<Geometry>);

      slice.aggregatedGeometry = {
        operation: "AGG",
        operationSequence: 0,
        geometryStatus: "ok",
        warnings: aggWarnings,
        geojson,
        geomType: geojson.geometry.type,
      };
      if (aggWarnings.length) slice.warnings.push(...aggWarnings);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Geometry aggregation failed.";
      slice.warnings.push(`Geometry aggregation failed: ${message}`);
    }
  }

  // If aggregation produced an aggregated geometry, prefer that for top-level status/warnings.
  // Many airspaces reference contributorAirspace without inline geometry; in that case the
  // per-component status is "missing" but aggregation can still be successful.
  for (const a of parsedAirspaces) {
    const slice = a.activeSlice;
    if (!slice) continue;
    if (slice.aggregatedGeometry?.geojson) {
      a.geometryStatus = "ok";
      a.warnings = a.warnings.filter((w) => w !== "No usable geometry on active timeSlice.");
    }
  }

  const dedupe = (items: string[]) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of items) {
      const key = item.trim();
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  };

  // Reduce noise: warnings can accumulate from multiple components and aggregation.
  for (const a of parsedAirspaces) {
    a.warnings = dedupe(a.warnings);
    if (a.activeSlice) {
      a.activeSlice.warnings = dedupe(
        a.activeSlice.warnings.filter(
          (w) => w !== "Vertical limits differ between components; manual review needed."
        )
      );
      a.activeSlice.geometryComponents = a.activeSlice.geometryComponents.map((c) => ({
        ...c,
        warnings: dedupe(
          c.warnings.filter((w) => w !== "Vertical limits differ between components; manual review needed.")
        ),
      }));
    }
  }

  // Third pass: if geometry is missing but a transitive contributor chain yields geometry,
  // mark as resolved and suppress missing-geometry warnings.
  const airspaceIndex = new Map<string, ParsedAirspace>();
  parsedAirspaces.forEach((a) => {
    if (a.gmlId) airspaceIndex.set(a.gmlId, a);
  });
  const transitiveGeoBorderResolver: TransitiveGeoBorderResolver = (uuid) => {
    const coords = geoborders[uuid];
    if (!coords) return null;
    return coords.map((pair) => ({ lon: pair[0], lat: pair[1] }));
  };
  parsedAirspaces.forEach((airspace) => {
    if (airspace.geometryStatus !== "missing" && airspace.geometryStatus !== "centroid_only") return;
    if (!airspace.activeSlice) return;
    try {
      const result = computeAggregatedHorizontalGeometry(airspace, airspaceIndex, transitiveGeoBorderResolver);
      if (result.geometry) {
        airspace.geometryStatus = "ok";
        airspace.warnings = (airspace.warnings ?? []).filter((w) => w !== "No usable geometry on active timeSlice.");
        airspace.activeSlice.warnings = (airspace.activeSlice.warnings ?? []).filter(
          (w) => w !== "No usable geometry on active timeSlice."
        );
        airspace.activeSlice.geometryComponents = (airspace.activeSlice.geometryComponents ?? []).map((c) => ({
          ...c,
          warnings: (c.warnings ?? []).filter(
            (w) =>
              w !== "No usable geometry found for component." &&
              w !== "Geometry not convertible; stored centroid only." &&
              w !== "Geometry not provided; centroid from extension latitude/longitude." &&
              !w.startsWith("Circle stored as centroid")
          ),
        }));
      }
    } catch (error) {
      // Keep original missing status/warnings if the transitive chain cannot be resolved.
    }
  });

  return parsedAirspaces;
};

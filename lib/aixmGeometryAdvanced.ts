import { parseStringPromise, processors } from "xml2js";
import polygonClipping from "polygon-clipping";

export type Coord = { lat: number; lon: number };
export type Segment =
  | { kind: "inline"; coords: Coord[] }
  | { kind: "arc"; center: Coord; radiusNm: number; startAngleDeg: number; endAngleDeg: number }
  | { kind: "xlink"; uuid: string };

export type GeoBorderResolver = (uuid: string) => Coord[] | null;

export type AirspaceVolume = {
  horizontalProjection?: unknown;
  contributorAirspace?: unknown;
};

export type AirspaceComponent = {
  operation: "BASE" | "UNION" | "SUBTR" | "INTERS";
  operationSequence: number;
  volume: AirspaceVolume;
  contributorUuid?: string | null;
  lowerLimitValue?: number | string | null;
  lowerLimitUom?: string | null;
  lowerLimitRef?: string | null;
  upperLimitValue?: number | string | null;
  upperLimitUom?: string | null;
  upperLimitRef?: string | null;
};

export type AirspaceShape = {
  uuid: string;
  components: AirspaceComponent[];
  contributorAirspace?: unknown;
};

export type AirspaceResolver = (uuid: string) => AirspaceShape | null;

// Zie airspaceGeometryTransitive.ts: polygon-clipping eist paren, geen losse
// getallenreeksen. Aangescherpt bij het overnemen uit de brontool.
type Pair = [number, number];
type MultiPolygon = Pair[][][];

const toText = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value.toString();
  if (Array.isArray(value)) return toText(value[0]);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj._ === "string" || typeof obj._ === "number") return obj._.toString();
  }
  return undefined;
};

const asArray = <T>(value: T | T[] | undefined | null): T[] => {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
};

const normalizeUuid = (value: string) => value.replace(/^#/, "").replace(/^urn:uuid:/, "").replace(/^uuid\./, "");

const parsePosList = (posList?: string): Coord[] => {
  if (!posList) return [];
  const tokens = posList.trim().split(/\s+/).filter(Boolean);
  const coords: Coord[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const lat = Number(tokens[i]);
    const lon = Number(tokens[i + 1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    coords.push({ lat, lon });
  }
  return coords;
};

const parsePos = (pos?: string): Coord | null => {
  if (!pos) return null;
  const tokens = pos.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const lat = Number(tokens[0]);
  const lon = Number(tokens[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
};

const normalizeDeg = (deg: number) => ((deg % 360) + 360) % 360;

const angularDiff = (a: number, b: number) => {
  const d = Math.abs(normalizeDeg(a) - normalizeDeg(b));
  return Math.min(d, 360 - d);
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

const directionFromAngles = (startAngle: number, endAngle: number): "CW" | "CCW" => {
  // AIXM ArcByCenterPoint: direction follows increasing angle values when start < end.
  return startAngle <= endAngle ? "CW" : "CCW";
};

const resolveArcOrientationWithNeighbors = (
  arc: Extract<Segment, { kind: "arc" }>,
  prevEnd: Coord | null,
  nextStart: Coord | null,
  opts: { toleranceMeters?: number } = {}
) => {
  const toleranceMeters = opts.toleranceMeters ?? 200;
  const startBearing = normalizeDeg(arc.startAngleDeg);
  const endBearing = normalizeDeg(arc.endAngleDeg);
  const startPoint = destinationPoint(arc.center, startBearing, arc.radiusNm);
  const endPoint = destinationPoint(arc.center, endBearing, arc.radiusNm);
  const direction = directionFromAngles(arc.startAngleDeg, arc.endAngleDeg);

  const prevJoin = prevEnd ? haversineMeters(prevEnd, startPoint) : null;
  const nextJoin = nextStart ? haversineMeters(endPoint, nextStart) : null;
  const lowConfidence =
    (prevJoin !== null && prevJoin > toleranceMeters) ||
    (nextJoin !== null && nextJoin > toleranceMeters);

  return {
    start: startPoint,
    end: endPoint,
    startBearing,
    endBearing,
    direction,
    prevJoin,
    nextJoin,
    lowConfidence,
  };
};

const sampleArc = (
  arc: Extract<Segment, { kind: "arc" }>,
  startBearing: number,
  endBearing: number,
  direction: "CW" | "CCW",
  opts: { stepNm?: number; minSegments?: number; maxSegments?: number } = {}
) => {
  const stepNm = opts.stepNm ?? 0.5;
  const minSegments = opts.minSegments ?? 12;
  const maxSegments = opts.maxSegments ?? 180;
  const start = normalizeDeg(startBearing);
  const end = normalizeDeg(endBearing);
  const sweep = direction === "CW" ? (end - start + 360) % 360 : (start - end + 360) % 360;
  const sweepRad = (sweep * Math.PI) / 180;
  const arcLengthNm = arc.radiusNm * sweepRad;
  const segments = Math.max(minSegments, Math.min(maxSegments, Math.ceil(arcLengthNm / stepNm)));
  const points: Coord[] = [];
  for (let i = 1; i <= segments; i += 1) {
    const t = i / segments;
    const angle = direction === "CW" ? start + sweep * t : start - sweep * t;
    points.push(destinationPoint(arc.center, normalizeDeg(angle), arc.radiusNm));
  }
  return points;
};

const haversineMeters = (a: Coord, b: Coord) => {
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

const dedupePush = (list: Coord[], point: Coord, toleranceDeg: number) => {
  const last = list[list.length - 1];
  if (!last) {
    list.push(point);
    return;
  }
  const dLat = last.lat - point.lat;
  const dLon = last.lon - point.lon;
  if (Math.sqrt(dLat * dLat + dLon * dLon) <= toleranceDeg) return;
  list.push(point);
};

export async function parseRingSegmentsFromXml(ringXmlNode: string | any): Promise<Segment[]> {
  let ringNode: any = ringXmlNode;
  if (typeof ringXmlNode === "string") {
    const parsed = await parseStringPromise(ringXmlNode, {
      explicitArray: false,
      mergeAttrs: true,
      tagNameProcessors: [processors.stripPrefix],
      attrNameProcessors: [processors.stripPrefix],
      xmlns: false,
    });
    ringNode = (parsed as any).Ring ?? parsed;
  }

  const curveMembers = asArray((ringNode as any)?.curveMember ?? (ringNode as any)?.curveMembers);
  const segments: Segment[] = [];

  for (const member of curveMembers) {
    if (!member) continue;
    const href = toText((member as any).href);
    if (href) {
      const uuid = normalizeUuid(href);
      segments.push({ kind: "xlink", uuid });
      continue;
    }

    const curve = (member as any).Curve ?? member;
    const segsContainer = (curve as any)?.segments ?? {};
    const geodesic = (segsContainer as any)?.GeodesicString;
    const arc = (segsContainer as any)?.ArcByCenterPoint;

    if (geodesic) {
      const geoNode = Array.isArray(geodesic) ? geodesic[0] : geodesic;
      const posList = toText((geoNode as any).posList);
      const coords = parsePosList(posList);
      if (coords.length) segments.push({ kind: "inline", coords });
      continue;
    }

    if (arc) {
      const arcNode = Array.isArray(arc) ? arc[0] : arc;
      const center = parsePos(toText((arcNode as any).pos));
      const radiusRaw = toText((arcNode as any).radius);
      const radius = radiusRaw ? Number(radiusRaw) : NaN;
      const startAngle = Number(toText((arcNode as any).startAngle));
      const endAngle = Number(toText((arcNode as any).endAngle));
      if (center && Number.isFinite(radius) && Number.isFinite(startAngle) && Number.isFinite(endAngle)) {
        segments.push({
          kind: "arc",
          center,
          radiusNm: radius,
          startAngleDeg: startAngle,
          endAngleDeg: endAngle,
        });
      }
      continue;
    }
  }

  return segments;
}

export function buildRingVertices(
  segments: Segment[],
  geoBorderResolver: GeoBorderResolver,
  opts: {
    dedupeToleranceDeg?: number;
    snapToleranceMeters?: number;
    arcStepNm?: number;
    arcMinSegments?: number;
    arcMaxSegments?: number;
  } = {}
): Coord[] {
  const dedupeToleranceDeg = opts.dedupeToleranceDeg ?? 1e-9;
  const snapToleranceMeters = opts.snapToleranceMeters ?? 50;
  const ring: Coord[] = [];

  const prevInlineEnd = (idx: number) => {
    for (let i = idx - 1; i >= 0; i -= 1) {
      const seg = segments[i];
      if (seg.kind === "inline" && seg.coords.length) return seg.coords[seg.coords.length - 1];
    }
    return null;
  };

  const nextInlineStart = (idx: number) => {
    for (let i = idx + 1; i < segments.length; i += 1) {
      const seg = segments[i];
      if (seg.kind === "inline" && seg.coords.length) return seg.coords[0];
    }
    return null;
  };

  const segmentStartCoord = (seg: Segment, idx: number) => {
    if (seg.kind === "inline") return seg.coords[0] ?? null;
    if (seg.kind === "arc") {
      return destinationPoint(seg.center, normalizeDeg(seg.startAngleDeg), seg.radiusNm);
    }
    const refCoords = geoBorderResolver(seg.uuid);
    if (!refCoords || !refCoords.length) return null;
    const nextHint = nextInlineStart(idx);
    if (!nextHint) return refCoords[0];
    const first = refCoords[0];
    const last = refCoords[refCoords.length - 1];
    return haversineMeters(first, nextHint) <= haversineMeters(last, nextHint) ? first : last;
  };

  segments.forEach((seg, idx) => {
    if (seg.kind === "inline") {
      seg.coords.forEach((coord) => dedupePush(ring, coord, dedupeToleranceDeg));
      return;
    }
    if (seg.kind === "arc") {
      let prev = ring[ring.length - 1] ?? prevInlineEnd(idx);
      if (!prev) {
        // Seed ring when arc is the first segment (no explicit start point).
        const startSeed = destinationPoint(seg.center, normalizeDeg(seg.startAngleDeg), seg.radiusNm);
        dedupePush(ring, startSeed, dedupeToleranceDeg);
        prev = startSeed;
      }
      const nextIdx = (idx + 1) % segments.length;
      const nextSeg = segments[nextIdx];
      const next = nextSeg ? segmentStartCoord(nextSeg, nextIdx) : null;
      const resolved = resolveArcOrientationWithNeighbors(seg, prev, next, { toleranceMeters: 200 });
      if (process.env.NODE_ENV !== "production" && process.env.AIXM_ARC_DEBUG === "1") {
        console.debug(
          `[arc ${idx}] join prev=${resolved.prevJoin?.toFixed(1) ?? "n/a"}m next=${
            resolved.nextJoin?.toFixed(1) ?? "n/a"
          }m dir=${resolved.direction} lowConf=${resolved.lowConfidence}`
        );
      }
      const samples = sampleArc(seg, resolved.startBearing, resolved.endBearing, resolved.direction, {
        stepNm: opts.arcStepNm,
        minSegments: opts.arcMinSegments,
        maxSegments: opts.arcMaxSegments,
      });
      samples.forEach((coord) => dedupePush(ring, coord, dedupeToleranceDeg));
      return;
    }
    if (seg.kind === "xlink") {
      const from = ring[ring.length - 1] ?? prevInlineEnd(idx);
      const to = nextInlineStart(idx) ?? ring[0] ?? null;
      if (!from || !to) throw new Error(`xlink segment missing anchors (uuid=${seg.uuid}).`);
      const refCoords = geoBorderResolver(seg.uuid);
      if (!refCoords || !refCoords.length) throw new Error(`Referenced curve not found for uuid=${seg.uuid}.`);

      const nearestIndex = (target: Coord) => {
        let bestIdx = -1;
        let bestMeters = Number.POSITIVE_INFINITY;
        for (let i = 0; i < refCoords.length; i += 1) {
          const d = haversineMeters(refCoords[i], target);
          if (d < bestMeters) {
            bestMeters = d;
            bestIdx = i;
          }
        }
        return { idx: bestIdx, meters: bestMeters };
      };

      const fromSnap = nearestIndex(from);
      const toSnap = nearestIndex(to);
      if (fromSnap.meters > snapToleranceMeters || toSnap.meters > snapToleranceMeters) {
        throw new Error(
          `xlink snap too far for uuid=${seg.uuid}: from=${fromSnap.meters.toFixed(1)}m to=${toSnap.meters.toFixed(1)}m`
        );
      }

      const i = fromSnap.idx;
      const j = toSnap.idx;
      const slice = i <= j ? refCoords.slice(i, j + 1) : [...refCoords.slice(j, i + 1)].reverse();
      slice.forEach((coord) => dedupePush(ring, coord, dedupeToleranceDeg));
      return;
    }
  });

  if (ring.length < 3) throw new Error("Ring has fewer than 3 points.");
  const first = ring[0];
  const last = ring[ring.length - 1];
  const dLat = first.lat - last.lat;
  const dLon = first.lon - last.lon;
  if (Math.sqrt(dLat * dLat + dLon * dLon) > dedupeToleranceDeg) ring.push({ ...first });
  return ring;
}

const toMultiPolygon = (ring: Coord[]): MultiPolygon => {
  const coords = ring.map((c): Pair => [c.lon, c.lat]);
  return [[coords]];
};

const findHorizontalProjection = (volume: AirspaceVolume) =>
  (volume as any)?.horizontalProjection ??
  (volume as any)?.theGeometry ??
  (volume as any)?.horizontalProjection?.surface ??
  (volume as any)?.Surface ??
  null;

const findContributorHref = (volume: AirspaceVolume): string | null => {
  const contributor = (volume as any)?.contributorAirspace ?? (volume as any)?.contributorAirspaceDependency ?? null;
  if (!contributor || typeof contributor !== "object") return null;
  const href =
    toText((contributor as any).href) ??
    toText((contributor as any).xlinkHref) ??
    toText((contributor as any).theAirspace?.href) ??
    toText((contributor as any).theAirspace?.xlinkHref) ??
    null;
  return href ? normalizeUuid(href) : null;
};

export async function resolveHorizontalProjection(
  volume: AirspaceVolume,
  airspaceResolver: AirspaceResolver,
  geoBorderResolver: GeoBorderResolver,
  opts: { visited?: Set<string> } = {}
): Promise<MultiPolygon> {
  const horizontal = findHorizontalProjection(volume);
  if (horizontal) {
    const segments = await parseRingSegmentsFromXml(horizontal);
    const ring = buildRingVertices(segments, geoBorderResolver);
    return toMultiPolygon(ring);
  }

  const contributorUuid = findContributorHref(volume);
  if (!contributorUuid) throw new Error("No horizontalProjection or contributorAirspace.");

  const visited = opts.visited ?? new Set<string>();
  if (visited.has(contributorUuid)) {
    throw new Error(`Contributor airspace cycle detected: ${contributorUuid}`);
  }
  visited.add(contributorUuid);
  const contributor = airspaceResolver(contributorUuid);
  if (!contributor) throw new Error(`Contributor airspace not found: ${contributorUuid}`);

  const baseComponent = contributor.components.find((c) => c.operation === "BASE") ?? contributor.components[0];
  if (!baseComponent) throw new Error(`Contributor airspace missing components: ${contributorUuid}`);

  return resolveHorizontalProjection(baseComponent.volume, airspaceResolver, geoBorderResolver, { visited });
}

export async function computeAggregatedHorizontal(
  airspace: AirspaceShape,
  airspaceResolver: AirspaceResolver,
  geoBorderResolver: GeoBorderResolver
): Promise<MultiPolygon> {
  const components = [...airspace.components].sort((a, b) => a.operationSequence - b.operationSequence);
  if (!components.length) throw new Error("No geometry components.");
  if (components[0].operation !== "BASE" || components[0].operationSequence !== 1) {
    throw new Error("First component must be BASE with operationSequence=1.");
  }

  const resolved = await Promise.all(
    components.map(async (c) => ({
      component: c,
      geometry: await resolveHorizontalProjection(c.volume, airspaceResolver, geoBorderResolver),
    }))
  );

  let result = resolved[0].geometry;
  for (let i = 1; i < resolved.length; i += 1) {
    const { component, geometry } = resolved[i];
    if (component.operation === "UNION") {
      result = polygonClipping.union(result, geometry);
    } else if (component.operation === "SUBTR") {
      result = polygonClipping.difference(result, geometry);
    } else if (component.operation === "INTERS") {
      result = polygonClipping.intersection(result, geometry);
    } else if (component.operation === "BASE") {
      throw new Error("Unexpected BASE after first component.");
    }
  }
  return result as MultiPolygon;
}

export async function exportAirspaceToGeoJSON(
  airspace: AirspaceShape,
  options: {
    mode?: "singleFeature" | "perComponentFeature";
    useOperationResult?: boolean;
  },
  airspaceResolver: AirspaceResolver,
  geoBorderResolver: GeoBorderResolver
) {
  const mode = options.mode ?? "singleFeature";
  const features: any[] = [];
  const components = [...airspace.components].sort((a, b) => a.operationSequence - b.operationSequence);

  const verticalSignatures = components.map((c) =>
    JSON.stringify({
      lower: [c.lowerLimitValue ?? null, c.lowerLimitUom ?? "", c.lowerLimitRef ?? ""],
      upper: [c.upperLimitValue ?? null, c.upperLimitUom ?? "", c.upperLimitRef ?? ""],
    })
  );
  const verticalWarning =
    Array.from(new Set(verticalSignatures)).length > 1
      ? "Vertical limits differ between components; manual review needed."
      : null;

  if (mode === "singleFeature") {
    const geometry = await computeAggregatedHorizontal(airspace, airspaceResolver, geoBorderResolver);
    features.push({
      type: "Feature",
      geometry: {
        type: geometry.length === 1 ? "Polygon" : "MultiPolygon",
        coordinates: geometry.length === 1 ? geometry[0] : geometry,
      },
      properties: {
        warnings: verticalWarning ? [verticalWarning] : [],
      },
    });
  } else {
    const resolved = await Promise.all(
      components.map(async (c) => ({
        component: c,
        geometry: await resolveHorizontalProjection(c.volume, airspaceResolver, geoBorderResolver),
      }))
    );
    const aggregated = options.useOperationResult
      ? await computeAggregatedHorizontal(airspace, airspaceResolver, geoBorderResolver)
      : null;

    resolved.forEach((item) => {
      const geometry = options.useOperationResult && aggregated ? aggregated : item.geometry;
      features.push({
        type: "Feature",
        geometry: {
          type: geometry.length === 1 ? "Polygon" : "MultiPolygon",
          coordinates: geometry.length === 1 ? geometry[0] : geometry,
        },
        properties: {
          operation: item.component.operation,
          operationSequence: item.component.operationSequence,
          lower: item.component.lowerLimitValue ?? null,
          lowerRef: item.component.lowerLimitRef ?? null,
          upper: item.component.upperLimitValue ?? null,
          upperRef: item.component.upperLimitRef ?? null,
          contributorUuid: item.component.contributorUuid ?? null,
        },
      });
    });
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

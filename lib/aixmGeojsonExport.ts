import type { Feature, FeatureCollection, Polygon } from "geojson";
import { parseStringPromise, processors } from "xml2js";

export type Coord = { lat: number; lon: number };
export type GeoBorder = { uuid: string; coords: Coord[] };

export type RingSegment =
  | { kind: "inline"; coords: Coord[] }
  | { kind: "xlink"; uuid: string };

const toText = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value.toString();
  if (Array.isArray(value)) return toText(value[0]);
  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    if (typeof objectValue._ === "string" || typeof objectValue._ === "number") return objectValue._.toString();
    if (typeof objectValue.text === "string") return objectValue.text;
    if (objectValue.__text) return toText(objectValue.__text);
  }
  return undefined;
};

const asArray = <T>(value: T | T[] | undefined | null): T[] => {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
};

/**
 * Parse "lat lon lat lon ..." pairs from a gml:posList (WGS84).
 */
export const parsePosList = (posList: string): Coord[] => {
  const tokens = posList.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 4 || tokens.length % 2 !== 0) {
    throw new Error(`Invalid posList length (${tokens.length})`);
  }
  const coords: Coord[] = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const lat = Number(tokens[i]);
    const lon = Number(tokens[i + 1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error(`Invalid posList number at index ${i}: "${tokens[i]} ${tokens[i + 1]}"`);
    }
    coords.push({ lat, lon });
  }
  return coords;
};

const distDeg = (a: Coord, b: Coord) => {
  const dLat = a.lat - b.lat;
  const dLon = a.lon - b.lon;
  return Math.sqrt(dLat * dLat + dLon * dLon);
};

/**
 * Haversine distance in meters.
 */
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

/**
 * Parse ring curveMembers (in order) from a ring XML string.
 *
 * Extracts:
 * - inline curveMembers with GeodesicString/posList -> { kind: "inline", coords }
 * - xlink:href="urn:uuid:<uuid>" -> { kind: "xlink", uuid }
 */
export async function parseRingSegmentsFromXml(ringXml: string): Promise<RingSegment[]> {
  const parsed = await parseStringPromise(ringXml, {
    explicitArray: false,
    mergeAttrs: true,
    tagNameProcessors: [processors.stripPrefix],
    attrNameProcessors: [processors.stripPrefix],
    xmlns: false,
  });

  // Accept either a raw Ring node or a wrapper that contains it.
  const ringNode = (parsed as any).Ring ?? (parsed as any);
  const curveMembers = asArray<any>(ringNode.curveMember);

  const segments: RingSegment[] = [];
  for (const member of curveMembers) {
    // Referenced curve member: <curveMember xlink:href="urn:uuid:..."/>
    const href = toText(member?.href);
    if (href && href.startsWith("urn:uuid:")) {
      segments.push({ kind: "xlink", uuid: href.replace("urn:uuid:", "") });
      continue;
    }

    // Inline curve member: <curveMember><Curve>...<GeodesicString><posList>...</posList>
    const curve = member?.Curve ?? member;
    const geodesic = curve?.segments?.GeodesicString;
    const posList = toText(geodesic?.posList);
    if (posList) {
      segments.push({ kind: "inline", coords: parsePosList(posList) });
      continue;
    }

    // If there's no GeodesicString but still a Curve, we currently don't handle other segment types here.
    throw new Error(`Unsupported curveMember format (expected GeodesicString or xlink:href): ${JSON.stringify(member).slice(0, 200)}...`);
  }

  return segments;
}

/**
 * Expand a referenced GeoBorder segment.
 *
 * Finds the nearest vertices in the specified GeoBorder polyline to the given FROM and TO points.
 * If either snap is farther than toleranceDeg, throws an error with details.
 * Returns the inclusive slice between snapped indices, direction-correct (reversed if needed).
 */
export function expandXlinkBorderSegment(
  uuid: string,
  from: Coord,
  to: Coord,
  geoBorders: GeoBorder[],
  toleranceDeg = 1e-4
): Coord[] {
  const border = geoBorders.find((b) => b.uuid === uuid);
  if (!border) throw new Error(`GeoBorder not found for uuid=${uuid}`);
  if (!border.coords.length) throw new Error(`GeoBorder coords empty for uuid=${uuid}`);

  const nearestOnSegment = (p: Coord, a: Coord, b: Coord) => {
    const ax = a.lon;
    const ay = a.lat;
    const bx = b.lon;
    const by = b.lat;
    const px = p.lon;
    const py = p.lat;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const tRaw = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
    const t = Math.max(0, Math.min(1, tRaw));
    const point: Coord = { lon: ax + t * dx, lat: ay + t * dy };
    return { point, t };
  };

  const nearestOnPolyline = (target: Coord) => {
    let bestSeg = -1;
    let bestT = 0;
    let bestPoint: Coord | null = null;
    let bestMeters = Number.POSITIVE_INFINITY;
    let bestDeg = Number.POSITIVE_INFINITY;
    for (let i = 0; i < border.coords.length - 1; i++) {
      const a = border.coords[i];
      const b = border.coords[i + 1];
      const { point, t } = nearestOnSegment(target, a, b);
      const dDeg = distDeg(point, target);
      if (dDeg > bestDeg) continue;
      const dM = haversineMeters(point, target);
      if (dM < bestMeters) {
        bestSeg = i;
        bestT = t;
        bestPoint = point;
        bestMeters = dM;
        bestDeg = dDeg;
      }
    }
    return { seg: bestSeg, t: bestT, point: bestPoint, meters: bestMeters, deg: bestDeg };
  };

  const dedupeConsecutive = (coords: Coord[]) => {
    const out: Coord[] = [];
    coords.forEach((pt) => {
      const last = out[out.length - 1];
      if (last && distDeg(last, pt) <= 1e-9) return;
      out.push(pt);
    });
    return out;
  };

  const buildSlice = (start: { seg: number; t: number; point: Coord }, end: { seg: number; t: number; point: Coord }) => {
    const forward = (s: typeof start, e: typeof end) => {
      const out: Coord[] = [s.point];
      if (s.seg === e.seg) {
        out.push(e.point);
        return dedupeConsecutive(out);
      }
      for (let i = s.seg + 1; i <= e.seg; i++) {
        out.push(border.coords[i]);
      }
      out.push(e.point);
      return dedupeConsecutive(out);
    };

    const sPos = start.seg + start.t;
    const ePos = end.seg + end.t;
    if (sPos <= ePos) {
      return forward(start, end);
    }
    return forward(end, start).reverse();
  };

  const snapFrom = nearestOnPolyline(from);
  const snapTo = nearestOnPolyline(to);

  if (snapFrom.seg === -1 || snapTo.seg === -1 || !snapFrom.point || !snapTo.point) {
    throw new Error(`Failed to snap endpoints for uuid=${uuid}`);
  }
  if (snapFrom.deg > toleranceDeg) {
    throw new Error(
      `GeoBorder snap FROM too far for uuid=${uuid}: deg=${snapFrom.deg} tol=${toleranceDeg} meters≈${snapFrom.meters.toFixed(1)}`
    );
  }
  if (snapTo.deg > toleranceDeg) {
    throw new Error(
      `GeoBorder snap TO too far for uuid=${uuid}: deg=${snapTo.deg} tol=${toleranceDeg} meters≈${snapTo.meters.toFixed(1)}`
    );
  }

  return buildSlice(
    { seg: snapFrom.seg, t: snapFrom.t, point: snapFrom.point },
    { seg: snapTo.seg, t: snapTo.t, point: snapTo.point }
  );
}

/**
 * Build a polygon ring from ring segments.
 *
 * - Inline segments append points in order.
 * - xlink segments are replaced by the GeoBorder slice between anchors:
 *   FROM = last point of previous inline segment
 *   TO   = first point of next inline segment
 * - Deduplicates consecutive identical points (within tolerance).
 * - Closes the ring at the end.
 */
export function buildRing(segments: RingSegment[], geoBorders: GeoBorder[], toleranceDeg = 1e-4): Coord[] {
  const ring: Coord[] = [];
  const pushDedupe = (p: Coord) => {
    const last = ring[ring.length - 1];
    if (last && distDeg(last, p) <= toleranceDeg) return;
    ring.push(p);
  };

  const findPrevInlineLast = (idx: number): Coord | null => {
    for (let i = idx - 1; i >= 0; i--) {
      const seg = segments[i];
      if (seg.kind === "inline" && seg.coords.length) return seg.coords[seg.coords.length - 1];
    }
    return null;
  };

  const findNextInlineFirst = (idx: number): Coord | null => {
    for (let i = idx + 1; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.kind === "inline" && seg.coords.length) return seg.coords[0];
    }
    return null;
  };

  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx];
    if (seg.kind === "inline") {
      seg.coords.forEach(pushDedupe);
      continue;
    }

    // xlink segment: must be anchored by adjacent inline segments
    const from = findPrevInlineLast(idx);
    const to = findNextInlineFirst(idx);
    if (!from || !to) {
      throw new Error(`Cannot anchor xlink border uuid=${seg.uuid}: missing adjacent inline curveMember`);
    }
    const borderSlice = expandXlinkBorderSegment(seg.uuid, from, to, geoBorders, toleranceDeg);
    borderSlice.forEach(pushDedupe);
  }

  if (ring.length < 3) throw new Error("Ring has fewer than 3 points after expansion");

  // Close ring
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (distDeg(first, last) > toleranceDeg) ring.push({ ...first });

  return ring;
}

/**
 * Export an airspace XML document (or relevant subset) to GeoJSON.
 *
 * For this deliverable we parse:
 * - designator, name, type, class
 * - lower/upper limits from AirspaceVolume
 * - ring curveMembers in order under Ring.curveMember
 */
export async function exportAirspaceXmlToGeoJSON(
  airspaceXml: string,
  geoBorders: GeoBorder[],
  toleranceDeg = 1e-4
): Promise<FeatureCollection> {
  const parsed = await parseStringPromise(airspaceXml, {
    explicitArray: false,
    mergeAttrs: true,
    tagNameProcessors: [processors.stripPrefix],
    attrNameProcessors: [processors.stripPrefix],
    xmlns: false,
  });

  // Accept either a full Airspace blob or a smaller snippet.
  const airspace = (parsed as any).Airspace ?? (parsed as any);
  const timeSlice = airspace?.timeSlice?.AirspaceTimeSlice ?? airspace?.AirspaceTimeSlice ?? airspace?.timeSlice ?? airspace;

  const designator = toText(timeSlice?.designator) ?? "";
  const name = toText(timeSlice?.name) ?? "";
  const type = toText(timeSlice?.type) ?? "";
  const classValue =
    toText(timeSlice?.class?.AirspaceLayerClass?.classification) ??
    toText(timeSlice?.class?.classification) ??
    "";

  const component = asArray(timeSlice?.geometryComponent)?.[0]?.AirspaceGeometryComponent ?? asArray(timeSlice?.geometryComponent)?.[0];
  const volume =
    component?.theAirspaceVolume?.AirspaceVolume ??
    component?.AirspaceVolume ??
    component?.theAirspaceVolume ??
    component;

  const lowerLimit = toText(volume?.lowerLimit) ?? undefined;
  const upperLimit = toText(volume?.upperLimit) ?? undefined;

  const surface = volume?.horizontalProjection?.Surface ?? volume?.horizontalProjection ?? volume?.Surface ?? volume;
  const ringNode =
    surface?.patches?.PolygonPatch?.exterior?.Ring ??
    surface?.patches?.PolygonPatch?.exterior?.ring ??
    surface?.patches?.PolygonPatch?.exterior ??
    surface?.patches?.PolygonPatch?.polygon?.exterior?.Ring ??
    surface?.Ring ??
    surface;

  const segments: RingSegment[] = [];
  const curveMembers = asArray<any>(ringNode?.curveMember);
  for (const member of curveMembers) {
    const href = toText(member?.href);
    if (href && href.startsWith("urn:uuid:")) {
      segments.push({ kind: "xlink", uuid: href.replace("urn:uuid:", "") });
      continue;
    }
    const curve = member?.Curve ?? member;
    const posList = toText(curve?.segments?.GeodesicString?.posList);
    if (!posList) {
      throw new Error(`Unsupported inline curveMember (expected GeodesicString/posList) for ${designator || "airspace"}`);
    }
    segments.push({ kind: "inline", coords: parsePosList(posList) });
  }

  const ring = buildRing(segments, geoBorders, toleranceDeg);
  const coordinates = ring.map((p) => [p.lon, p.lat]);

  const feature: Feature<Polygon> = {
    type: "Feature",
    properties: {
      designator,
      name,
      type,
      class: classValue,
      lowerLimit: lowerLimit ?? null,
      upperLimit: upperLimit ?? null,
    },
    geometry: {
      type: "Polygon",
      coordinates: [coordinates],
    },
  };

  return {
    type: "FeatureCollection",
    features: [feature],
  };
}

// ---- Demo (EHWO-style ring) ----
if (typeof process !== "undefined" && process.argv?.[1]?.includes("aixmGeojsonExport")) {
  (async () => {
    const ringXml = `
      <gml:Ring xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:xlink="http://www.w3.org/1999/xlink">
        <gml:curveMember>
          <gml:Curve>
            <gml:segments>
              <gml:GeodesicString>
                <gml:posList>51.427247222 4.552352778 51.423016667 4.535447222</gml:posList>
              </gml:GeodesicString>
            </gml:segments>
          </gml:Curve>
        </gml:curveMember>
        <gml:curveMember xlink:href="urn:uuid:a0d40d3b-2bbf-4733-9d3b-5cbc098c21c9" />
        <gml:curveMember>
          <gml:Curve>
            <gml:segments>
              <gml:GeodesicString>
                <gml:posList>51.353969444 4.24205 51.33865 4.222983333</gml:posList>
              </gml:GeodesicString>
            </gml:segments>
          </gml:Curve>
        </gml:curveMember>
      </gml:Ring>
    `;

    const geoBorders: GeoBorder[] = [
      {
        uuid: "a0d40d3b-2bbf-4733-9d3b-5cbc098c21c9",
        coords: [
          // mocked slice that includes the endpoints (and a few interior points)
          { lat: 51.423016667, lon: 4.535447222 },
          { lat: 51.4100, lon: 4.4800 },
          { lat: 51.3800, lon: 4.3400 },
          { lat: 51.353969444, lon: 4.24205 },
        ],
      },
    ];

    const segments = await parseRingSegmentsFromXml(ringXml);
    const ring = buildRing(segments, geoBorders, 1e-4);

    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { designator: "EHWO", name: "WOENSDRECHT CTR", type: "CTR", class: "D" },
          geometry: { type: "Polygon", coordinates: [ring.map((p) => [p.lon, p.lat])] },
        } as Feature<Polygon>,
      ],
    };

     
    console.log(JSON.stringify(fc, null, 2));
  })().catch((err) => {
     
    console.error(err);
    process.exitCode = 1;
  });
}

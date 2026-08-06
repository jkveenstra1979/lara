/**
 * Formatting layer for compact airspace geometry strings.
 *
 * Input format (segments separated by "|"):
 * - P(lat,lon)
 * - ARC(centerLat,centerLon,radiusNm,direction,endLat,endLon)
 * - BORDER(fromLat,fromLon,toLat,toLon)
 * - BORDER(uuid,fromLat,fromLon,toLat,toLon)  // newer format (uuid is ignored for pretty printing)
 *
 * Output is a "pretty" multi-line string for UI display. The stored geometry
 * string must remain unchanged; this module only derives a readable view.
 */

export type Coord = { lat: number; lon: number };

type BorderResolver = (uuid: string) => Coord[] | null;

type FormatOptions = {
  borderResolver?: BorderResolver;
  borderSnapMeters?: number;
  coordEpsilonDeg?: number;
  borderExpand?: boolean;
};

export type PrettyLine = { text: string; proposed?: boolean };
export type ProposedVertex = {
  segmentIndex: number;
  coord: Coord;
  role?: "start" | "end" | null;
  geoborderUuid?: string | null;
};
export type BorderDebugInfo = {
  segmentKey: string;
  geoborderUuid?: string;
  fromIndex: number | null;
  toIndex: number | null;
  proposals: { coord: Coord; dmsKey: string; pos: number | null; role?: "start" | "end" | null }[];
};

type Token =
  | { kind: "P"; lat: number; lon: number }
  | {
      kind: "ARC";
      centerLat: number;
      centerLon: number;
      radiusNmRaw: string;
      direction: "CW" | "CCW";
      endLat: number;
      endLon: number;
    }
  | { kind: "BORDER"; uuid?: string; fromLat: number; fromLon: number; toLat: number; toLon: number };

const parseNumberStrict = (value: string, label: string): number => {
  const num = Number(value);
  if (!Number.isFinite(num)) throw new Error(`Invalid number for ${label}: "${value}"`);
  return num;
};

const normalizeUuidLocal = (value?: string) =>
  (value ?? "").replace(/^#/, "").replace(/^urn:uuid:/, "").replace(/^uuid\./, "");

const parseGeometryTokens = (geometry: string): Token[] => {
  const segments = geometry
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  return segments.map((seg) => {
    const pMatch = /^P\(([^)]+)\)$/.exec(seg);
    if (pMatch) {
      const [latStr, lonStr] = pMatch[1].split(",").map((s) => s.trim());
      return {
        kind: "P",
        lat: parseNumberStrict(latStr, "P.lat"),
        lon: parseNumberStrict(lonStr, "P.lon"),
      };
    }

    const arcMatch = /^ARC\(([^)]+)\)$/.exec(seg);
    if (arcMatch) {
      const parts = arcMatch[1].split(",").map((s) => s.trim());
      if (parts.length !== 6) throw new Error(`Invalid ARC segment (expected 6 args): "${seg}"`);
      const [centerLat, centerLon, radiusNmRaw, directionRaw, endLat, endLon] = parts;
      const direction = directionRaw === "CCW" ? "CCW" : directionRaw === "CW" ? "CW" : null;
      if (!direction) throw new Error(`Invalid ARC direction (expected CW/CCW): "${directionRaw}"`);
      // radius is stored as raw string so we can print it exactly as given.
      // We'll still validate it is numeric.
      parseNumberStrict(radiusNmRaw, "ARC.radiusNm");
      return {
        kind: "ARC",
        centerLat: parseNumberStrict(centerLat, "ARC.centerLat"),
        centerLon: parseNumberStrict(centerLon, "ARC.centerLon"),
        radiusNmRaw,
        direction,
        endLat: parseNumberStrict(endLat, "ARC.endLat"),
        endLon: parseNumberStrict(endLon, "ARC.endLon"),
      };
    }

    const borderMatch = /^BORDER\(([^)]+)\)$/.exec(seg);
    if (borderMatch) {
      const parts = borderMatch[1].split(",").map((s) => s.trim());
      // Support both formats:
      // - BORDER(fromLat,fromLon,toLat,toLon)
      // - BORDER(uuid,fromLat,fromLon,toLat,toLon)
      if (parts.length !== 4 && parts.length !== 5) {
        throw new Error(`Invalid BORDER segment (expected 4 or 5 args): "${seg}"`);
      }
      const hasUuid = parts.length === 5;
      const uuid = hasUuid ? normalizeUuidLocal(parts[0]) : undefined;
      const [fromLat, fromLon, toLat, toLon] = hasUuid ? parts.slice(1) : parts;
      return {
        kind: "BORDER",
        uuid,
        fromLat: parseNumberStrict(fromLat, "BORDER.fromLat"),
        fromLon: parseNumberStrict(fromLon, "BORDER.fromLon"),
        toLat: parseNumberStrict(toLat, "BORDER.toLat"),
        toLon: parseNumberStrict(toLon, "BORDER.toLon"),
      };
    }

    throw new Error(`Unknown geometry segment: "${seg}"`);
  });
};

/**
 * Convert decimal degrees to DMS components and handle rounding carry.
 */
const toDmsParts = (value: number) => {
  const abs = Math.abs(value);
  let degrees = Math.floor(abs);
  const minutesFull = (abs - degrees) * 60;
  let minutes = Math.floor(minutesFull);
  let seconds = (minutesFull - minutes) * 60;

  // Round seconds to 2 decimals as required.
  seconds = Math.round(seconds * 100) / 100;

  // Handle carry (e.g. 59.999 -> 60.00).
  if (seconds >= 60) {
    seconds = 0;
    minutes += 1;
  }
  if (minutes >= 60) {
    minutes = 0;
    degrees += 1;
  }

  return { degrees, minutes, seconds };
};

/**
 * DMS format requirements:
 * - Latitude: "N 51 20 19.14"
 * - Longitude: "E 004 13 22.74"
 * Seconds: 2 decimals, zero padded to "00.00" when needed.
 */
export function toDmsLat(lat: number): string {
  const hemi = lat >= 0 ? "N" : "S";
  const { degrees, minutes, seconds } = toDmsParts(lat);
  const deg = String(degrees).padStart(2, "0");
  const min = String(minutes).padStart(2, "0");
  const sec = seconds.toFixed(2).padStart(5, "0");
  return `${hemi} ${deg} ${min} ${sec}`;
}

export function toDmsLon(lon: number): string {
  const hemi = lon >= 0 ? "E" : "W";
  const { degrees, minutes, seconds } = toDmsParts(lon);
  const deg = String(degrees).padStart(3, "0");
  const min = String(minutes).padStart(2, "0");
  const sec = seconds.toFixed(2).padStart(5, "0");
  return `${hemi} ${deg} ${min} ${sec}`;
}

export function formatCoord(lat: number, lon: number): string {
  return `${toDmsLat(lat)} ${toDmsLon(lon)}`;
}

const coordToDmsKey = (coord: Coord) => `${toDmsLat(coord.lat)}|${toDmsLon(coord.lon)}`;

/**
 * Build the pretty output for display.
 *
 * Formatting rules implemented:
 * - ARC block prints "starting from" previous vertex and prints center+radius.
 * - ARC end point is NOT printed inside the ARC block.
 * - ARC end point IS printed as the next "Line Joining..." point (arrival point),
 *   unless the next token is another ARC (then it becomes the next ARC start).
 * - P points are printed as "Line Joining..." arrival points, grouped for consecutive lines.
 *   If a P immediately precedes a BORDER (and matches the border start), that P is not printed
 *   as a line-joining point; it will be printed under the BORDER block instead.
 * - BORDER prints only its starting point (fromLat/fromLon) and does not expand the polyline.
 */
export function formatGeometryPretty(geometry: string, options: FormatOptions = {}): string {
  if (geometry.trim().toLowerCase().startsWith("circle of radius")) {
    return geometry.trim();
  }
  const tokens = parseGeometryTokens(geometry);
  const lines: string[] = [];

  let prev: Coord | null = null;
  let pendingLinePoints: Coord[] = [];
  let lastEmitted: Coord | null = null;
  let firstEmitted: Coord | null = null;

  const epsDeg = options.coordEpsilonDeg ?? 1e-6;
  const coordsEqual = (a: Coord, b: Coord, eps = epsDeg) =>
    Math.abs(a.lat - b.lat) <= eps && Math.abs(a.lon - b.lon) <= eps;

  const dedupeConsecutive = (points: Coord[]) => {
    const out: Coord[] = [];
    for (const p of points) {
      const last = out[out.length - 1];
      if (last && coordsEqual(last, p)) {
        continue;
      }
      out.push(p);
    }
    return out;
  };

  const startBlock = () => {
    if (lines.length) {
      lines.push("");
    }
  };

  const emitPoint = (p: Coord) => {
    lines.push(formatCoord(p.lat, p.lon));
    lastEmitted = p;
    if (!firstEmitted) firstEmitted = p;
  };

  const flushLinePoints = () => {
    if (!pendingLinePoints.length) return;
    let points = dedupeConsecutive(pendingLinePoints);
    if (lastEmitted && points.length && coordsEqual(points[0], lastEmitted)) {
      points = points.slice(1);
    }
    if (points.length < 1) {
      pendingLinePoints = [];
      return;
    }
    startBlock();
    lines.push("Line Joining following points:");
    for (const p of points) emitPoint(p);
    pendingLinePoints = [];
  };

  const directionLabel = (dir: "CW" | "CCW") => (dir === "CW" ? "clockwise" : "counterclockwise");
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const bearingDeg = (from: Coord, to: Coord) => {
    const φ1 = toRad(from.lat);
    const φ2 = toRad(to.lat);
    const Δλ = toRad(to.lon - from.lon);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  };
  const destinationPoint = (start: Coord, bearing: number, distanceMeters: number): Coord => {
    const R = 6371000;
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
  const haversineMeters = (a: Coord, b: Coord) => {
    const R = 6371000;
    const φ1 = toRad(a.lat);
    const φ2 = toRad(b.lat);
    const Δφ = toRad(b.lat - a.lat);
    const Δλ = toRad(b.lon - a.lon);
    const sinΔφ = Math.sin(Δφ / 2);
    const sinΔλ = Math.sin(Δλ / 2);
    const h = sinΔφ * sinΔφ + Math.cos(φ1) * Math.cos(φ2) * sinΔλ * sinΔλ;
    return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  };
  const resolveArcDirection = (start: Coord, token: Extract<Token, { kind: "ARC" }>) => {
    const center = { lat: token.centerLat, lon: token.centerLon };
    const end = { lat: token.endLat, lon: token.endLon };
    const radiusMeters = Number(token.radiusNmRaw) * 1852;
    const startBearing = bearingDeg(center, start);
    const endBearing = bearingDeg(center, end);
    const incDelta = (endBearing - startBearing + 360) % 360;
    const decDelta = (startBearing - endBearing + 360) % 360;
    const incEnd = destinationPoint(center, (startBearing + incDelta) % 360, radiusMeters);
    const decEnd = destinationPoint(center, (startBearing - decDelta + 360) % 360, radiusMeters);
    const incErr = haversineMeters(incEnd, end);
    const decErr = haversineMeters(decEnd, end);
    if (Math.abs(incErr - decErr) > 0.5) {
      return incErr < decErr ? "CCW" : "CW";
    }
    if (incDelta === decDelta) return "CW";
    return incDelta < decDelta ? "CCW" : "CW";
  };
  const resolveBorderPoints = (token: Extract<Token, { kind: "BORDER" }>) => {
    const fallback = [{ lat: token.fromLat, lon: token.fromLon }];
    if (options?.borderExpand === false) return fallback;
    if (!token.uuid || !options?.borderResolver) return fallback;
    const coords = options.borderResolver(normalizeUuidLocal(token.uuid));
    if (!coords || coords.length < 2) return fallback;
    const tolMeters = options.borderSnapMeters ?? 50;
    const nearestVertexIndex = (target: Coord) => {
      let bestIdx = -1;
      let bestMeters = Number.POSITIVE_INFINITY;
      for (let i = 0; i < coords.length; i++) {
        const d = haversineMeters(coords[i], target);
        if (d < bestMeters) {
          bestMeters = d;
          bestIdx = i;
        }
      }
      return { idx: bestIdx, meters: bestMeters };
    };
    const fromSnap = nearestVertexIndex({ lat: token.fromLat, lon: token.fromLon });
    const toSnap = nearestVertexIndex({ lat: token.toLat, lon: token.toLon });
    if (fromSnap.idx === -1 || toSnap.idx === -1) return fallback;
    if (fromSnap.meters > tolMeters || toSnap.meters > tolMeters) return fallback;
    const i = fromSnap.idx;
    const j = toSnap.idx;
    const forward = i <= j ? coords.slice(i, j + 1) : coords.slice(j, i + 1).reverse();
    return dedupeConsecutive(forward);
  };

  for (let idx = 0; idx < tokens.length; idx++) {
    const token = tokens[idx];
    const next = tokens[idx + 1];

    if (token.kind === "P") {
      const current: Coord = { lat: token.lat, lon: token.lon };

      // First vertex establishes the starting point but isn't necessarily an arrival point to print.
      if (!prev) {
        prev = current;
        continue;
      }

      // If this point is immediately followed by an ARC, treat it as the ARC start and don't print it here.
      if (next?.kind === "ARC") {
        prev = current;
        continue;
      }

      // If this point is immediately followed by a BORDER and matches the border start, keep it with the border.
      if (
        next?.kind === "BORDER" &&
        coordsEqual(current, { lat: next.fromLat, lon: next.fromLon })
      ) {
        prev = current;
        continue;
      }

      const lastPending = pendingLinePoints[pendingLinePoints.length - 1];
      if (!lastPending || !coordsEqual(lastPending, current)) {
        pendingLinePoints.push(current);
      }
      prev = current;
      continue;
    }

    if (token.kind === "ARC") {
      if (!prev) throw new Error("ARC segment encountered before any starting P(...) point.");
      flushLinePoints();
      startBlock();
      const resolvedDir = token.direction ?? resolveArcDirection(prev, token);
      lines.push(`Arc of circle in ${directionLabel(resolvedDir)} direction starting from:`);
      lines.push(`${formatCoord(prev.lat, prev.lon)},`);
      lastEmitted = { ...prev };
      if (!firstEmitted) firstEmitted = { ...prev };
      lines.push(`radius ${token.radiusNmRaw} NM, centered on:`);
      lines.push(formatCoord(token.centerLat, token.centerLon));
      lastEmitted = { lat: token.centerLat, lon: token.centerLon };
      if (!firstEmitted) firstEmitted = { lat: token.centerLat, lon: token.centerLon };

      // The path position becomes the ARC end.
      prev = { lat: token.endLat, lon: token.endLon };
      continue;
    }

    if (token.kind === "BORDER") {
      flushLinePoints();
      startBlock();
      lines.push("Geographical border on the following points:");
      const points = resolveBorderPoints(token);
      if (!points.length) {
        prev = { lat: token.toLat, lon: token.toLon };
        continue;
      }
      for (const p of points) {
        if (!lastEmitted || !coordsEqual(lastEmitted, p)) {
          emitPoint(p);
        }
      }
      prev = points.length ? points[points.length - 1] : { lat: token.fromLat, lon: token.fromLon };
      continue;
    }
  }

  flushLinePoints();

  if (firstEmitted && lastEmitted && !coordsEqual(firstEmitted, lastEmitted)) {
    lines.push("till ");
    lines.push("point:");
    lines.push(formatCoord(firstEmitted.lat, firstEmitted.lon));
  }

  return lines.join("\n");
}

export function formatGeometryPrettyWithProposals(
  geometry: string,
  options: FormatOptions = {},
  proposals: ProposedVertex[] = [],
  debugCollector?: (info: BorderDebugInfo) => void
): PrettyLine[] {
  if (geometry.trim().toLowerCase().startsWith("circle of radius")) {
    return [{ text: geometry.trim() }];
  }
  const tokens = parseGeometryTokens(geometry).map((token, index) => ({ ...token, index }));
  const lines: PrettyLine[] = [];

  type LinePoint = { coord: Coord; proposed?: boolean };

  let prev: Coord | null = null;
  let pendingLinePoints: LinePoint[] = [];
  let pendingLineOriginalKeys = new Set<string>();
  let lastEmitted: Coord | null = null;
  let firstEmitted: Coord | null = null;

  const epsDeg = options.coordEpsilonDeg ?? 1e-6;
  const coordsEqual = (a: Coord, b: Coord, eps = epsDeg) =>
    Math.abs(a.lat - b.lat) <= eps && Math.abs(a.lon - b.lon) <= eps;

  const dedupeCoordConsecutive = (points: Coord[]) => {
    const out: Coord[] = [];
    for (const p of points) {
      const last = out[out.length - 1];
      if (last && coordsEqual(last, p)) {
        continue;
      }
      out.push(p);
    }
    return out;
  };

  const dedupeConsecutive = (points: LinePoint[]) => {
    const out: LinePoint[] = [];
    for (const p of points) {
      const last = out[out.length - 1];
      if (last && coordsEqual(last.coord, p.coord)) {
        if (!last.proposed && p.proposed) {
          out[out.length - 1] = { ...last, proposed: true };
        }
        continue;
      }
      out.push(p);
    }
    return out;
  };

  const startBlock = () => {
    if (lines.length) {
      lines.push({ text: "" });
    }
  };

  const pushLine = (text: string, proposed = false) => {
    lines.push({ text, proposed });
  };

  const emitPoint = (point: LinePoint | Coord, proposed = false) => {
    const coord = "coord" in point ? point.coord : point;
    const isProposed = "coord" in point ? Boolean(point.proposed) : proposed;
    pushLine(formatCoord(coord.lat, coord.lon), isProposed);
    lastEmitted = coord;
    if (!firstEmitted) firstEmitted = coord;
  };

  const flushLinePoints = () => {
    if (!pendingLinePoints.length) return;
    let points = dedupeConsecutive(pendingLinePoints);
    if (lastEmitted && points.length && coordsEqual(points[0].coord, lastEmitted)) {
      points = points.slice(1);
    }
    if (points.length < 1) {
      pendingLinePoints = [];
      pendingLineOriginalKeys = new Set<string>();
      return;
    }
    startBlock();
    pushLine("Line Joining following points:");
    for (const p of points) emitPoint(p);
    pendingLinePoints = [];
    pendingLineOriginalKeys = new Set<string>();
  };

  const directionLabel = (dir: "CW" | "CCW") => (dir === "CW" ? "clockwise" : "counterclockwise");
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const bearingDeg = (from: Coord, to: Coord) => {
    const φ1 = toRad(from.lat);
    const φ2 = toRad(to.lat);
    const Δλ = toRad(to.lon - from.lon);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  };
  const destinationPoint = (start: Coord, bearing: number, distanceMeters: number): Coord => {
    const R = 6371000;
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
  const haversineMeters = (a: Coord, b: Coord) => {
    const R = 6371000;
    const φ1 = toRad(a.lat);
    const φ2 = toRad(b.lat);
    const Δφ = toRad(b.lat - a.lat);
    const Δλ = toRad(b.lon - a.lon);
    const sinΔφ = Math.sin(Δφ / 2);
    const sinΔλ = Math.sin(Δλ / 2);
    const h = sinΔφ * sinΔφ + Math.cos(φ1) * Math.cos(φ2) * sinΔλ * sinΔλ;
    return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  };
  const resolveArcDirection = (start: Coord, token: Extract<Token, { kind: "ARC" }>) => {
    const center = { lat: token.centerLat, lon: token.centerLon };
    const end = { lat: token.endLat, lon: token.endLon };
    const radiusMeters = Number(token.radiusNmRaw) * 1852;
    const startBearing = bearingDeg(center, start);
    const endBearing = bearingDeg(center, end);
    const incDelta = (endBearing - startBearing + 360) % 360;
    const decDelta = (startBearing - endBearing + 360) % 360;
    const incEnd = destinationPoint(center, (startBearing + incDelta) % 360, radiusMeters);
    const decEnd = destinationPoint(center, (startBearing - decDelta + 360) % 360, radiusMeters);
    const incErr = haversineMeters(incEnd, end);
    const decErr = haversineMeters(decEnd, end);
    if (Math.abs(incErr - decErr) > 0.5) {
      return incErr < decErr ? "CCW" : "CW";
    }
    if (incDelta === decDelta) return "CW";
    return incDelta < decDelta ? "CCW" : "CW";
  };
  const resolveBorderPointsWithDebug = (token: Extract<Token, { kind: "BORDER" }>) => {
    const fallback = { points: [{ lat: token.fromLat, lon: token.fromLon }], fromIndex: null, toIndex: null };
    if (!token.uuid || !options?.borderResolver) return fallback;
    const coords = options.borderResolver(normalizeUuidLocal(token.uuid));
    if (!coords || coords.length < 2) return fallback;
    const tolMeters = options.borderSnapMeters ?? 50;
    const nearestVertexIndex = (target: Coord) => {
      let bestIdx = -1;
      let bestMeters = Number.POSITIVE_INFINITY;
      for (let i = 0; i < coords.length; i++) {
        const d = haversineMeters(coords[i], target);
        if (d < bestMeters) {
          bestMeters = d;
          bestIdx = i;
        }
      }
      return { idx: bestIdx, meters: bestMeters };
    };
    const fromSnap = nearestVertexIndex({ lat: token.fromLat, lon: token.fromLon });
    const toSnap = nearestVertexIndex({ lat: token.toLat, lon: token.toLon });
    if (fromSnap.idx === -1 || toSnap.idx === -1) return fallback;
    if (fromSnap.meters > tolMeters || toSnap.meters > tolMeters) return fallback;
    const i = fromSnap.idx;
    const j = toSnap.idx;
    const forward = i <= j ? coords.slice(i, j + 1) : coords.slice(j, i + 1).reverse();
    return { points: dedupeCoordConsecutive(forward), fromIndex: i, toIndex: j };
  };

  const proposalsBySegmentKey = new Map<string, { start: Coord[]; end: Coord[] }>();
  proposals.forEach((proposal) => {
    const segmentKey = `${proposal.segmentIndex}|${proposal.geoborderUuid ?? ""}`;
    const entry = proposalsBySegmentKey.get(segmentKey) ?? { start: [], end: [] };
    if (proposal.role === "end") {
      entry.end.push(proposal.coord);
    } else {
      entry.start.push(proposal.coord);
    }
    proposalsBySegmentKey.set(segmentKey, entry);
  });

  const movedStartSegments = new Set<string>();
  let pendingExitInsert: Coord[] = [];
  let pendingExitMarkNextLinePoint = false;
  const sortByPos = (a: { pos: number | null }, b: { pos: number | null }) => {
    if (a.pos === null && b.pos === null) return 0;
    if (a.pos === null) return 1;
    if (b.pos === null) return -1;
    return a.pos - b.pos;
  };

  for (let idx = 0; idx < tokens.length; idx++) {
    const token = tokens[idx];
    const next = tokens[idx + 1];

    if (token.kind === "P") {
      const current: Coord = { lat: token.lat, lon: token.lon };

      if (!prev) {
        prev = current;
        continue;
      }

      if (next?.kind === "ARC") {
        prev = current;
        continue;
      }

      let proposed = false;
      if (pendingExitMarkNextLinePoint) {
        pendingExitInsert.forEach((coord) => {
          const key = coordToDmsKey(coord);
          const alreadyInBlock = pendingLineOriginalKeys.has(key);
          pendingLinePoints.push({ coord, proposed: !alreadyInBlock });
        });
        pendingExitInsert = [];
        pendingExitMarkNextLinePoint = false;
      }

      const isOriginalLinePoint =
        !next?.kind ||
        !(next.kind === "BORDER" && coordsEqual(current, { lat: next.fromLat, lon: next.fromLon }));

      if (next?.kind === "BORDER" && coordsEqual(current, { lat: next.fromLat, lon: next.fromLon })) {
        const segmentKey = `${next.index}|${next.uuid ?? ""}`;
        const hasStartProposal = (proposalsBySegmentKey.get(segmentKey)?.start.length ?? 0) > 0;
        if (!hasStartProposal) {
          prev = current;
          continue;
        }
        proposed = true;
        movedStartSegments.add(segmentKey);
      }

      const lastPending = pendingLinePoints[pendingLinePoints.length - 1];
      if (!lastPending || !coordsEqual(lastPending.coord, current)) {
        pendingLinePoints.push({ coord: current, proposed });
        if (isOriginalLinePoint) {
          pendingLineOriginalKeys.add(coordToDmsKey(current));
        }
      }
      prev = current;
      continue;
    }

    if (token.kind === "ARC") {
      if (!prev) throw new Error("ARC segment encountered before any starting P(...) point.");
      flushLinePoints();
      startBlock();
      const resolvedDir = token.direction ?? resolveArcDirection(prev, token);
      pushLine(`Arc of circle in ${directionLabel(resolvedDir)} direction starting from:`);
      pushLine(`${formatCoord(prev.lat, prev.lon)},`);
      lastEmitted = { ...prev };
      if (!firstEmitted) firstEmitted = { ...prev };
      pushLine(`radius ${token.radiusNmRaw} NM, centered on:`);
      pushLine(formatCoord(token.centerLat, token.centerLon));
      lastEmitted = { lat: token.centerLat, lon: token.centerLon };
      if (!firstEmitted) firstEmitted = { lat: token.centerLat, lon: token.centerLon };

      prev = { lat: token.endLat, lon: token.endLon };
      continue;
    }

    if (token.kind === "BORDER") {
      const segmentKey = `${token.index}|${token.uuid ?? ""}`;
      const segmentProposals = proposalsBySegmentKey.get(segmentKey) ?? { start: [], end: [] };
      const hasStartProposal = segmentProposals.start.length > 0;
      const hasEndProposal = segmentProposals.end.length > 0;
      if (hasStartProposal && !movedStartSegments.has(segmentKey)) {
        const originalCoord = { lat: token.fromLat, lon: token.fromLon };
        const key = coordToDmsKey(originalCoord);
        const alreadyInBlock = pendingLineOriginalKeys.has(key);
        pendingLinePoints.push({ coord: originalCoord, proposed: !alreadyInBlock });
        movedStartSegments.add(segmentKey);
      }
      flushLinePoints();

      const { points: slicePoints, fromIndex, toIndex } = resolveBorderPointsWithDebug(token);
      const indexByDmsKey = new Map<string, number>();
      slicePoints.forEach((point, idx) => {
        const key = coordToDmsKey(point);
        if (!indexByDmsKey.has(key)) {
          indexByDmsKey.set(key, idx);
        }
      });

      const buildProposalInfo = (coords: Coord[], role: "start" | "end") =>
        coords.map((coord) => {
          const dmsKey = coordToDmsKey(coord);
          const pos = indexByDmsKey.has(dmsKey) ? (indexByDmsKey.get(dmsKey) as number) : null;
          return { coord, dmsKey, pos, role };
        });

      const startInfo = buildProposalInfo(segmentProposals.start, "start").sort(sortByPos);
      const endInfo = buildProposalInfo(segmentProposals.end, "end").sort(sortByPos);

      if (debugCollector) {
        debugCollector({
          segmentKey,
          geoborderUuid: token.uuid,
          fromIndex,
          toIndex,
          proposals: [...startInfo, ...endInfo],
        });
      }

      const displayPoints =
        options?.borderExpand === false ? [{ lat: token.fromLat, lon: token.fromLon }] : slicePoints;

      startBlock();
      pushLine("Geographical border on the following points:");
      if (startInfo.length) {
        const borderPoint = startInfo[0].coord;
        emitPoint(borderPoint, true);
      } else if (displayPoints.length) {
        emitPoint({ coord: displayPoints[0], proposed: false });
      }

      if (hasEndProposal) {
        pendingExitInsert = endInfo.length ? endInfo.map((info) => info.coord) : segmentProposals.end.slice();
        pendingExitMarkNextLinePoint = true;
      }
      prev = { lat: token.toLat, lon: token.toLon };
      continue;
    }
  }

  flushLinePoints();

  if (firstEmitted && lastEmitted && !coordsEqual(firstEmitted, lastEmitted)) {
    pushLine("till ");
    pushLine("point:");
    pushLine(formatCoord(firstEmitted.lat, firstEmitted.lon));
  }

  return lines;
}

// ---- Demo (EHWO) ----
// Run this file directly with ts-node/tsx to see output.
if (typeof process !== "undefined" && process.argv?.[1]?.includes("geometryPretty")) {
  const geometry =
    "P(51.33865,4.222983333) | ARC(51.449,4.342141667,8,CW,51.427247222,4.552352778) | P(51.423016667,4.535447222) | BORDER(51.423016667,4.535447222,51.353969444,4.24205) | P(51.353969444,4.24205) | P(51.33865,4.222983333)";

   
  console.log(formatGeometryPretty(geometry));
}

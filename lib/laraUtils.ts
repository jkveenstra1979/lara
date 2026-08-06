import type { Feature, Geometry } from "geojson";

// ─── DMS conversie ───────────────────────────────────────────────────────────

export function decimalToDMS(decimal: number, isLat: boolean): string {
  const dir = isLat
    ? decimal >= 0 ? "N" : "S"
    : decimal >= 0 ? "E" : "W";
  const abs = Math.abs(decimal);
  const deg = Math.floor(abs);
  const minFull = (abs - deg) * 60;
  const min = Math.floor(minFull);
  let sec = Math.round((minFull - min) * 60);

  // Carry-over bij afronding naar 60
  let adjMin = min;
  let adjDeg = deg;
  if (sec === 60) {
    sec = 0;
    adjMin += 1;
  }
  if (adjMin === 60) {
    adjMin = 0;
    adjDeg += 1;
  }

  const degStr = String(adjDeg).padStart(isLat ? 2 : 3, "0");
  const minStr = String(adjMin).padStart(2, "0");
  const secStr = String(sec).padStart(2, "0");
  return `${degStr}°${minStr}'${secStr}"${dir}`;
}

export function pointToDMS(lat: number, lon: number): string {
  return `${decimalToDMS(lat, true)},${decimalToDMS(lon, false)}`;
}

// ─── Cirkel-geometrie string parsen ──────────────────────────────────────────

// Stored format: "Circle of radius X NM centered on:\nN DD MM SS.ss E DDD MM SS.ss"
const CIRCLE_REGEX =
  /^Circle of radius ([\d.]+) NM centered on:\s*([NS])\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([EW])\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i;

export function parseCircleGeometryString(geometry: string): {
  lat: number;
  lon: number;
  radiusNm: number;
} | null {
  const m = CIRCLE_REGEX.exec(geometry.trim());
  if (!m) return null;
  const [, radiusStr, latH, latDeg, latMin, latSec, lonH, lonDeg, lonMin, lonSec] = m;
  const lat =
    (Number(latDeg) + Number(latMin) / 60 + Number(latSec) / 3600) *
    (latH === "S" ? -1 : 1);
  const lon =
    (Number(lonDeg) + Number(lonMin) / 60 + Number(lonSec) / 3600) *
    (lonH === "W" ? -1 : 1);
  const radiusNm = Number(radiusStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radiusNm)) {
    return null;
  }
  return { lat, lon, radiusNm };
}

// ─── Polygoon-coördinaten uit GeoJSON ────────────────────────────────────────

function extractPolygonRing(feature: Feature<Geometry>): [number, number][] | null {
  const geom = feature.geometry;
  if (!geom) return null;
  let ring: [number, number][] | null = null;
  if (geom.type === "Polygon" && geom.coordinates[0]?.length) {
    ring = geom.coordinates[0] as [number, number][];
  } else if (
    geom.type === "MultiPolygon" &&
    geom.coordinates[0]?.[0]?.length
  ) {
    ring = geom.coordinates[0][0] as [number, number][];
  }
  if (!ring) return null;
  // Verwijder sluitpunt als dat gelijk is aan het eerste punt
  if (
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
  ) {
    ring = ring.slice(0, -1);
  }
  return ring;
}

// ─── Hoogte-limiet naar LARA formaat ─────────────────────────────────────────

type LimitObj = {
  value?: string | number | null;
  uom?: string | null;
  unit?: string | null;
  reference?: string | null;
};

export type LaraAltitude = { alt: number; unit: "FL" | "ft" };

export function formatAltForLARA(
  limitObj: LimitObj | null | undefined,
  fallbackValue: number | null | undefined,
  fallbackUnit: string | null | undefined
): LaraAltitude | null {
  const obj = limitObj ?? null;
  const rawValue = obj?.value ?? fallbackValue ?? null;
  const uom = (obj?.uom ?? obj?.unit ?? fallbackUnit ?? "").trim().toUpperCase();
  const ref = (obj?.reference ?? "").trim().toUpperCase();

  if (rawValue === null || rawValue === undefined) return null;

  const numStr = String(rawValue).trim().toUpperCase();
  if (numStr === "SFC") return { alt: 0, unit: "ft" };

  // FL-patroon in de waarde zelf (bijv. "FL60")
  const flInline = /^FL\s*0*(\d+)$/.exec(numStr);
  if (flInline) return { alt: Number(flInline[1]), unit: "FL" };

  const num = Number(numStr);
  if (!Number.isFinite(num)) return null;

  if (ref === "STD" || uom === "FL") return { alt: num, unit: "FL" };
  if (uom === "M") return { alt: Math.round(num * 3.28084), unit: "ft" };
  return { alt: num, unit: "ft" };
}

export function resolveVerticalForLARA(airspace: {
  vertical_limits_json?: Record<string, unknown> | null;
  lowerlimit?: number | null;
  lowerunit?: string | null;
  upperlimit?: number | null;
  upperunit?: string | null;
}): { lower: LaraAltitude | null; upper: LaraAltitude | null } {
  const v = airspace.vertical_limits_json as Record<string, LimitObj> | null | undefined;
  const lower = formatAltForLARA(
    v?.lowerLimit ?? v?.minimumLimit ?? null,
    airspace.lowerlimit,
    airspace.lowerunit
  );
  const upper = formatAltForLARA(
    v?.upperLimit ?? v?.maximumLimit ?? null,
    airspace.upperlimit,
    airspace.upperunit
  );
  return { lower, upper };
}

// ─── Hoofd-formatter: geometry → LARA volumeType + coordinates ───────────────

export type LaraGeometry = {
  volumeType: "Circle" | "Straight Lines";
  coordinates: string;
};

export function formatGeometryForLARA(
  geometryString: string | null | undefined,
  geojsonFeature: Feature<Geometry> | null | undefined
): LaraGeometry | null {
  // Cirkel: herken op de opgeslagen tekst-string
  if (geometryString && /^Circle of radius/i.test(geometryString.trim())) {
    const parsed = parseCircleGeometryString(geometryString);
    if (parsed) {
      const center = pointToDMS(parsed.lat, parsed.lon);
      const radiusStr = Number.isInteger(parsed.radiusNm)
        ? String(parsed.radiusNm)
        : parsed.radiusNm.toFixed(2).replace(/\.?0+$/, "");
      return {
        volumeType: "Circle",
        coordinates: `${center};${radiusStr}NM`,
      };
    }
  }

  // Polygoon / rechte lijnen (inclusief geïnterpoleerde bogen): gebruik GeoJSON
  if (geojsonFeature) {
    const ring = extractPolygonRing(geojsonFeature);
    if (ring && ring.length >= 3) {
      // Alle hoekpunten als DMS, eerste punt herhalen aan het eind (gesloten polygoon)
      const points = [...ring, ring[0]].map(([lon, lat]) => pointToDMS(lat, lon));
      return {
        volumeType: "Straight Lines",
        coordinates: points.join(";"),
      };
    }
  }

  return null;
}

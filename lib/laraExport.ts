import ExcelJS from "exceljs";
import type { Feature, Geometry } from "geojson";
import {
  formatGeometryForLARA,
  resolveVerticalForLARA,
  parseCircleGeometryString,
} from "@/lib/laraUtils";

type GeometryRow = {
  geojson?: Feature<Geometry> | null;
  geom_type?: string | null;
  operation?: string | null;
  operation_sequence?: number | null;
} | null;

export type LaraAirspace = {
  id: string;
  lara_area_id: number;
  ident: string;
  name?: string | null;
  geometry?: string | null;
  vertical_limits_json?: Record<string, unknown> | null;
  lowerlimit?: number | null;
  lowerunit?: string | null;
  upperlimit?: number | null;
  upperunit?: string | null;
  geometries?: GeometryRow[] | null;
};

// Kies de beste GeoJSON: voorkeur voor AGG-operatie, anders de eerste met een geldige geometrie.
function pickGeojson(geometries: GeometryRow[] | null | undefined): Feature<Geometry> | null {
  if (!geometries?.length) return null;
  const valid = geometries.filter(Boolean) as Exclude<GeometryRow, null>[];
  const agg = valid.find((g) => (g.operation ?? "").toUpperCase() === "AGG");
  if (agg?.geojson) return agg.geojson;
  const first = valid.find((g) => g.geojson);
  return first?.geojson ?? null;
}

function addHeaderRow(sheet: ExcelJS.Worksheet, headers: string[]) {
  const row = sheet.addRow(headers);
  row.font = { bold: true };
}

// ─── Verificatie-hulpfuncties ─────────────────────────────────────────────────

function circleApproximationFeature(
  lat: number,
  lon: number,
  radiusNm: number,
  steps = 64
): Feature<Geometry> {
  const R = 6371000;
  const d = radiusNm * 1852;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const latR = toRad(lat);
  const lonR = toRad(lon);
  const angDist = d / R;
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const bearing = toRad((i * 360) / steps);
    const destLat = Math.asin(
      Math.sin(latR) * Math.cos(angDist) +
      Math.cos(latR) * Math.sin(angDist) * Math.cos(bearing)
    );
    const destLon =
      lonR +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angDist) * Math.cos(latR),
        Math.cos(angDist) - Math.sin(latR) * Math.sin(destLat)
      );
    ring.push([toDeg(destLon), toDeg(destLat)]);
  }
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: {},
  };
}

function buildGeojsonIoUrl(feature: Feature<Geometry>, label: string): string | null {
  const fc = {
    type: "FeatureCollection",
    features: [{ ...feature, properties: { ...feature.properties, label } }],
  };
  const encoded = encodeURIComponent(JSON.stringify(fc));
  const url = `https://geojson.io/#data=data:application/json,${encoded}`;
  // geojson.io handles large data URIs; skip only if truly enormous
  return url.length <= 500_000 ? url : null;
}

function countRingPoints(feature: Feature<Geometry>): number {
  const geom = feature.geometry;
  if (geom.type === "Polygon") return geom.coordinates[0]?.length ?? 0;
  if (geom.type === "MultiPolygon") return geom.coordinates[0]?.[0]?.length ?? 0;
  return 0;
}

export async function buildLaraWorkbook(airspaces: LaraAirspace[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  // ── Sheet 1: Areas ────────────────────────────────────────────────────────
  const wsAreas = wb.addWorksheet("Areas");
  addHeaderRow(wsAreas, [
    "Area ID",
    "Area Name",
    "Full Name",
    "FMTP Name",
    "Send Over FMTP (YES/NO)",
    "UUID",
    "AUP/UUP (YES/NO)",
    "NOTAM Enabled (YES/NO/INTERVAL)",
    "Lower NOTAM Interval",
    "Lower NOTAM Unit (FL/ft)",
    "Upper NOTAM Interval",
    "Upper NOTAM Unit (FL/ft)",
    "NOTAM Purposes (NBOM)",
    "NOTAM Code Group (4 letters)",
    "NOTAM Scope (E/W/A)",
    "NOTAM Traffic Types",
    "Type",
    "AMC",
    "Start Date (dd/MM/yyyy)",
    "End Date (dd/MM/yyyy)",
    "Reference Allocation (HH:mm)",
    "Daily Ref. Alloc. (YES/NO)",
    "Applies By Default (YES/NO)",
    "Area Manageability Type (AMA/NAM/DYNAMIC_NAM)",
    "Activation Type (AUTOMATIC/MANUAL/DYNAMIC)",
    "Auto Release (YES/NO)",
    "Pending Time (Mins)",
    "Release Pending (Mins)",
    "Before Buffer (HH:mm)",
    "After Buffer (HH:mm)",
    "Between Buffer (Min)",
    "Below Buffer",
    "Below Unit (FL/ft)",
    "Above Buffer",
    "Above Unit (FL/ft)",
  ]);

  for (const a of airspaces) {
    wsAreas.addRow([
      a.lara_area_id,
      a.ident,
      a.name ?? a.ident,
      a.ident,
      "YES",
      a.id,
      "YES",
      "NO",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "R",
      "EHMCZAMC",
      "01/01/2018",
      "31/12/2036",
      "03:00",
      "NO",
      "YES",
      "AMA",
      "AUTOMATIC",
      "NO",
      30,
      15,
      0,
      0,
      0,
      0,
      "ft",
      0,
      "ft",
    ]);
  }

  // ── Sheet 2: Area Volumes ─────────────────────────────────────────────────
  const wsVolumes = wb.addWorksheet("Area Volumes");
  addHeaderRow(wsVolumes, [
    "Area ID",
    "Lower Alt",
    "Lower Unit (FL/ft)",
    "Upper Alt",
    "Upper Unit (FL/ft)",
    "Volume Type (Straight Lines / Circle)",
    "Coordinates",
  ]);

  for (const a of airspaces) {
    const geojson = pickGeojson(a.geometries);
    const laraGeom = formatGeometryForLARA(a.geometry, geojson);
    const { lower, upper } = resolveVerticalForLARA(a);

    wsVolumes.addRow([
      a.lara_area_id,
      lower?.alt ?? "",
      lower?.unit ?? "",
      upper?.alt ?? "",
      upper?.unit ?? "",
      laraGeom?.volumeType ?? "",
      laraGeom?.coordinates ?? "",
    ]);
  }

  // ── Sheet 3: Area Timesheets ──────────────────────────────────────────────
  const wsTime = wb.addWorksheet("Area Timesheets");
  addHeaderRow(wsTime, [
    "Area ID",
    "Start Date (dd/MM/yyyy)",
    "End Date (dd/MM/yyyy)",
    "Start Time (HH:mm)",
    "End Time (HH:mm)",
    "Day From (MON/TUE/..etc)",
    "Day Til (MON/TUE/..etc)",
  ]);

  for (const a of airspaces) {
    wsTime.addRow([
      a.lara_area_id,
      "01/01/2018",
      "31/12/2036",
      "00:00",
      "24:00",
      "MON",
      "SUN",
    ]);
  }

  // ── Sheets 4–9: alleen headers ────────────────────────────────────────────
  const emptySheets: { name: string; headers: string[] }[] = [
    {
      name: "CDR Segments",
      headers: [
        "Segment ID",
        "Segment Name",
        "Start Point",
        "End Point",
        "Lower Alt",
        "Lower Unit",
        "Upper Alt",
        "Upper Unit",
      ],
    },
    {
      name: "CDR Segment Timesheets",
      headers: [
        "Segment ID",
        "Start Date",
        "End Date",
        "Start Time",
        "End Time",
        "Day From",
        "Day Til",
      ],
    },
    {
      name: "Points",
      headers: ["Point ID", "Point Name", "Latitude", "Longitude"],
    },
    {
      name: "Area-CDR Segment Relationships",
      headers: ["Area ID", "Segment ID"],
    },
    {
      name: "Meta",
      headers: ["Key", "Value"],
    },
    {
      name: "Options",
      headers: ["Key", "Value"],
    },
  ];

  for (const { name, headers } of emptySheets) {
    addHeaderRow(wb.addWorksheet(name), headers);
  }

  // ── Sheet 10: Verificatie ─────────────────────────────────────────────────
  const wsVerify = wb.addWorksheet("Verificatie");
  addHeaderRow(wsVerify, ["Area ID", "Designator", "Naam", "Type", "Punten", "Open op kaart"]);
  wsVerify.columns = [
    { width: 10 },
    { width: 16 },
    { width: 30 },
    { width: 16 },
    { width: 8 },
    { width: 28 },
  ];

  for (const a of airspaces) {
    const geojson = pickGeojson(a.geometries);
    const laraGeom = formatGeometryForLARA(a.geometry, geojson);

    let verifyFeature: Feature<Geometry> | null = null;
    let pointCount = 0;

    if (laraGeom?.volumeType === "Straight Lines" && geojson) {
      verifyFeature = geojson;
      pointCount = countRingPoints(geojson);
    } else if (laraGeom?.volumeType === "Circle" && a.geometry) {
      const parsed = parseCircleGeometryString(a.geometry);
      if (parsed) {
        verifyFeature = circleApproximationFeature(parsed.lat, parsed.lon, parsed.radiusNm);
        pointCount = 64;
      }
    }

    const dataRow = wsVerify.addRow([
      a.lara_area_id,
      a.ident,
      a.name ?? "",
      laraGeom?.volumeType ?? "—",
      pointCount || "—",
    ]);

    const linkCell = dataRow.getCell(6);
    if (verifyFeature) {
      const url = buildGeojsonIoUrl(verifyFeature, `${a.ident} (${a.lara_area_id})`);
      if (url) {
        linkCell.value = { text: "Open op geojson.io ↗", hyperlink: url };
        linkCell.font = { color: { argb: "FF0563C1" }, underline: true };
      } else {
        linkCell.value = "URL te lang";
      }
    } else {
      linkCell.value = "Geen geometry";
      linkCell.font = { color: { argb: "FF888888" }, italic: true };
    }
  }

  return wb.xlsx.writeBuffer().then((b) => Buffer.from(b));
}

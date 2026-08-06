/**
 * LET OP — dit bestand past nog niet op ons schema.
 *
 * `resolveTransitiveGeometries` leest `airspaces.time_slices_json`, een kolom uit
 * de brontool die wij niet hebben: bij ons staan de componenten als losse rijen
 * in `geometries` (één per volume), wat de hele reden van dat schema is.
 *
 * De code is hier ongewijzigd overgenomen zodat de logica leesbaar blijft naast
 * het origineel, maar aanroepen kan pas na een aanpassing. Twee wegen:
 *
 *   a. de queries laten lezen uit `geometries` en daaruit de slice-vorm bouwen
 *      die `buildAirspaceIndex` verwacht;
 *   b. `airspaces` een `time_slices_json` geven, wat de componenten dubbel
 *      opslaat — makkelijker, maar dan lopen twee bronnen uit elkaar.
 *
 * Weg (a) hoort bij stap 8 (export), waar deze functie zijn enige afnemer krijgt.
 * Zie docs/HANDOVER.md § 6.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Feature, Geometry } from "geojson";
import {
  computeAggregatedHorizontalGeometry,
  geometryStringToMultiPolygon,
  type GeoBorderResolver,
} from "@/lib/airspaceGeometryTransitive";
import type { ParsedAirspace, ParsedGeometryComponent } from "@/lib/aixmParser";

type DbRow = {
  id: string;
  dataset_id: string;
  gml_id: string | null;
  ident: string | null;
  geometry?: string | null;
  time_slices_json: unknown[] | null;
};

export const normalizeUuid = (value: string) =>
  value.replace(/^#/, "").replace(/^urn:uuid:/, "").replace(/^uuid\./, "");

const attachGeometryString = (slices: any[], geometry?: string | null) => {
  if (!geometry) return slices;
  return slices.map((slice) => {
    const components = Array.isArray(slice?.geometryComponents) ? slice.geometryComponents : [];
    if (!components.length) {
      return {
        ...slice,
        geometryComponents: [{ operation: "BASE", operationSequence: 1, geometryString: geometry }],
      };
    }
    const baseIdx = components.findIndex((c: any) => (c?.operation ?? "").toUpperCase() === "BASE");
    const idx = baseIdx >= 0 ? baseIdx : 0;
    return {
      ...slice,
      geometryComponents: components.map((comp: any, i: number) =>
        i === idx && !comp?.geometryString ? { ...comp, geometryString: geometry } : comp
      ),
    };
  });
};

const toParsedAirspace = (row: DbRow): ParsedAirspace => ({
  gmlId: row.gml_id ? normalizeUuid(row.gml_id) : null,
  sourceRef: `//Airspace[@gml:id='${row.gml_id ?? ""}']`,
  rawFragment: null,
  timeSlices: attachGeometryString((row.time_slices_json ?? []) as any[], row.geometry ?? null),
  activeSlice: null,
  warnings: [],
  geometryStatus: "missing",
});

const mapGeometryComponents = (slice: any): ParsedGeometryComponent[] =>
  (Array.isArray(slice?.geometryComponents) ? slice.geometryComponents : []).map((c: any) => ({
    operation: c?.operation ?? undefined,
    operationSequence: c?.operationSequence ?? null,
    geometryStatus: c?.geometryStatus ?? "missing",
    warnings: c?.warnings ?? [],
    geometryString: c?.geometryString ?? null,
    derivedFromAirspaceId: c?.derivedFromAirspaceId ?? null,
    geojson: c?.geojson ?? null,
    bbox: c?.bbox ?? undefined,
    centroidLat: c?.centroidLat ?? null,
    centroidLon: c?.centroidLon ?? null,
    geomType: c?.geomType ?? undefined,
    verticalLimits: c?.verticalLimits ?? undefined,
  }));

const pickActiveSlice = (airspace: ParsedAirspace) => {
  const slices = airspace.timeSlices ?? [];
  return (
    slices.find((s: any) => s?.interpretation === "BASELINE") ??
    slices.find((s: any) => s?.interpretation === "BASE") ??
    slices[0] ??
    null
  );
};

const collectIdentifiers = (slices: any[]): string[] =>
  slices.flatMap((slice) => {
    const id = slice?.identifier;
    return typeof id === "string" ? [id] : [];
  });

const extractGeometryString = (slices: any[]): string | null => {
  for (const slice of slices) {
    for (const comp of Array.isArray(slice?.geometryComponents) ? slice.geometryComponents : []) {
      if (typeof comp?.geometryString === "string" && comp.geometryString.trim()) {
        return comp.geometryString.trim();
      }
    }
  }
  return null;
};

const extractContributorUuid = (slices: any[]): string | null => {
  for (const slice of slices) {
    for (const comp of Array.isArray(slice?.geometryComponents) ? slice.geometryComponents : []) {
      if (typeof comp?.derivedFromAirspaceId === "string" && comp.derivedFromAirspaceId.trim()) {
        return normalizeUuid(comp.derivedFromAirspaceId.trim());
      }
    }
  }
  return null;
};

const resolveContributorChain = (
  contributorUuid: string,
  rows: DbRow[],
  geoBorderResolver: GeoBorderResolver,
  visited = new Set<string>()
): number[][][][] | null => {
  const key = normalizeUuid(contributorUuid);
  if (!key || visited.has(key)) return null;
  visited.add(key);

  const row = rows.find((r) => normalizeUuid(String(r.gml_id ?? "")) === key);
  if (!row) return null;

  const slices = (row.time_slices_json ?? []) as any[];
  const geomStr = row.geometry ?? extractGeometryString(slices);
  if (geomStr) {
    const mp = geometryStringToMultiPolygon(geomStr, geoBorderResolver);
    if (mp) return mp;
  }

  const next = extractContributorUuid(slices);
  return next ? resolveContributorChain(next, rows, geoBorderResolver, visited) : null;
};

const buildAirspaceIndex = (rows: DbRow[]): Map<string, ParsedAirspace> => {
  const index = new Map<string, ParsedAirspace>();
  for (const row of rows) {
    const parsed = toParsedAirspace(row);
    parsed.activeSlice = pickActiveSlice(parsed);
    if (parsed.activeSlice) {
      parsed.activeSlice.geometryComponents = mapGeometryComponents(parsed.activeSlice);
    }
    if (row.gml_id) index.set(normalizeUuid(row.gml_id), parsed);
    for (const id of collectIdentifiers(parsed.timeSlices as any[]).map(normalizeUuid)) {
      if (id) index.set(id, parsed);
    }
  }
  return index;
};

const mpToFeature = (mp: number[][][][]): Feature<Geometry> => ({
  type: "Feature",
  geometry:
    mp.length === 1
      ? { type: "Polygon", coordinates: mp[0] }
      : { type: "MultiPolygon", coordinates: mp },
  properties: {},
});

/**
 * For the given airspace IDs, compute the polygon geometry using the same
 * transitive resolution logic as the geojson-transitive-batch endpoint.
 *
 * Returns a Map from airspace ID to a GeoJSON Feature. Airspaces for which
 * no geometry could be resolved are omitted from the map.
 */
export async function resolveTransitiveGeometries(
  airspaceIds: string[],
  supabase: SupabaseClient,
  geoBorderResolver: GeoBorderResolver
): Promise<Map<string, Feature<Geometry>>> {
  if (!airspaceIds.length) return new Map();

  const { data, error } = await supabase
    .from("airspaces")
    .select("id,dataset_id,gml_id,ident,geometry,time_slices_json")
    .in("id", airspaceIds);

  if (error || !data?.length) return new Map();

  const rows = data as DbRow[];
  const result = new Map<string, Feature<Geometry>>();

  // Group by dataset so we only fetch each dataset's full airspace list once
  const byDataset = new Map<string, DbRow[]>();
  for (const row of rows) {
    const group = byDataset.get(row.dataset_id) ?? [];
    group.push(row);
    byDataset.set(row.dataset_id, group);
  }

  for (const [datasetId, group] of byDataset) {
    const { data: datasetRows, error: dsErr } = await supabase
      .from("airspaces")
      .select("id,gml_id,ident,geometry,time_slices_json")
      .eq("dataset_id", datasetId);

    if (dsErr || !datasetRows) continue;

    const index = buildAirspaceIndex(datasetRows as DbRow[]);

    for (const row of group) {
      const parsed = toParsedAirspace(row);
      parsed.activeSlice = pickActiveSlice(parsed);
      if (parsed.activeSlice) {
        parsed.activeSlice.geometryComponents = mapGeometryComponents(parsed.activeSlice);
      }

      const { geometry } = computeAggregatedHorizontalGeometry(parsed, index, geoBorderResolver);

      if (geometry) {
        result.set(row.id, mpToFeature(geometry));
        continue;
      }

      // Fallback: follow the contributor chain manually (handles cases where
      // computeAggregatedHorizontalGeometry can't resolve via the index)
      const contributorUuid = extractContributorUuid(parsed.timeSlices as any[]);
      if (contributorUuid) {
        const mp = resolveContributorChain(contributorUuid, datasetRows as DbRow[], geoBorderResolver);
        if (mp) result.set(row.id, mpToFeature(mp));
      }
    }
  }

  return result;
}

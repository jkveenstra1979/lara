import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * De LARA-selectie van een dataset: alleen de gebieden die meegaan, met hun
 * Area ID. Gesorteerd op nummer, ongenummerde gebieden onderaan — want dat is
 * precies de lijst die nog werk vraagt.
 */

export type SelectieRij = {
  airspaceId: string;
  laraAreaId: number | null;
  note: string | null;
  ident: string;
  name: string | null;
  type: string | null;
  lowerlimit: number | null;
  lowerunit: string | null;
  upperlimit: number | null;
  upperunit: string | null;
  geometryStatus: string | null;
  volumes: number;
};

type Genest = {
  ident: string;
  name: string | null;
  type: string | null;
  lowerlimit: number | null;
  lowerunit: string | null;
  upperlimit: number | null;
  upperunit: string | null;
  geometry_status: string | null;
  geometries: { count: number }[] | null;
};

type Rij = {
  airspace_id: string;
  lara_area_id: number | null;
  note: string | null;
  airspaces: Genest | Genest[] | null;
};

export async function haalSelectie(
  supabase: SupabaseClient<Database>,
  datasetId: string
): Promise<{ rijen: SelectieRij[]; error: string | null }> {
  const { data, error } = await supabase
    .from("lara_areas")
    // Eén regel: concatenatie sloopt de type-inferentie van supabase-js.
    .select("airspace_id, lara_area_id, note, airspaces!inner(ident, name, type, lowerlimit, lowerunit, upperlimit, upperunit, geometry_status, geometries(count))")
    .eq("dataset_id", datasetId)
    .neq("airspaces.geometries.operation", "AGG");

  if (error) return { rijen: [], error: error.message };

  const rijen: SelectieRij[] = ((data ?? []) as unknown as Rij[]).map((rij) => {
    const gebied = Array.isArray(rij.airspaces) ? rij.airspaces[0] : rij.airspaces;
    return {
      airspaceId: rij.airspace_id,
      laraAreaId: rij.lara_area_id,
      note: rij.note,
      ident: gebied?.ident ?? "—",
      name: gebied?.name ?? null,
      type: gebied?.type ?? null,
      lowerlimit: gebied?.lowerlimit ?? null,
      lowerunit: gebied?.lowerunit ?? null,
      upperlimit: gebied?.upperlimit ?? null,
      upperunit: gebied?.upperunit ?? null,
      geometryStatus: gebied?.geometry_status ?? null,
      volumes: gebied?.geometries?.[0]?.count ?? 0,
    };
  });

  // Genummerd eerst op nummer, daarna de ongenummerde op designator.
  rijen.sort((a, b) => {
    if (a.laraAreaId === null && b.laraAreaId === null) return a.ident.localeCompare(b.ident);
    if (a.laraAreaId === null) return 1;
    if (b.laraAreaId === null) return -1;
    return a.laraAreaId - b.laraAreaId;
  });

  return { rijen, error: null };
}

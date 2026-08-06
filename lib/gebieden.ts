import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * De gebiedenlijst, in één query.
 *
 * Gedeeld tussen de pagina (die server-side laadt) en de API-route (die na een
 * actie ververst), zodat beide gegarandeerd dezelfde vorm opleveren.
 */

export type Gebied = {
  id: string;
  ident: string;
  name: string | null;
  type: string | null;
  class: string | null;
  lowerlimit: number | null;
  lowerunit: string | null;
  upperlimit: number | null;
  upperunit: string | null;
  geometry_status: string | null;
  geom_type: string | null;
  /** Aantal volumes, de samenvoegrij (AGG) niet meegeteld. */
  volumes: number;
  /** Staat dit gebied in de LARA-lijst? */
  inLara: boolean;
  laraAreaId: number | null;
};

type Rij = {
  id: string;
  ident: string;
  name: string | null;
  type: string | null;
  class: string | null;
  lowerlimit: number | null;
  lowerunit: string | null;
  upperlimit: number | null;
  upperunit: string | null;
  geometry_status: string | null;
  lara_areas: { lara_area_id: number | null } | { lara_area_id: number | null }[] | null;
  geometries: { count: number }[] | null;
};

/** Het geometrietype van de samenvoegrij, of van het eerste volume. */
type TypeRij = { airspace_id: string; geom_type: string | null; operation: string | null };

export async function haalGebieden(
  supabase: SupabaseClient<Database>,
  datasetId: string
): Promise<{ gebieden: Gebied[]; error: string | null }> {
  const { data, error } = await supabase
    .from("airspaces")
    // Eén regel: zie de opmerking in gebiedDetail.ts — concatenatie sloopt de
    // type-inferentie van supabase-js.
    .select("id, ident, name, type, class, lowerlimit, lowerunit, upperlimit, upperunit, geometry_status, lara_areas(lara_area_id), geometries(count)")
    .eq("dataset_id", datasetId)
    // De samenvoegrij is geen volume; die zou de telling met één ophogen.
    .neq("geometries.operation", "AGG")
    .order("ident");

  if (error) return { gebieden: [], error: error.message };

  // Het geometrietype apart: het hangt aan een geometrierij, niet aan het gebied.
  const { data: typeRijen } = await supabase
    .from("geometries")
    .select("airspace_id, geom_type, operation, airspaces!inner(dataset_id)")
    .eq("airspaces.dataset_id", datasetId)
    .not("geom_type", "is", null);

  const typePerGebied = new Map<string, string>();
  for (const rij of (typeRijen ?? []) as unknown as TypeRij[]) {
    // AGG wint: dat is de vorm van het gebied als geheel.
    if (rij.operation === "AGG" || !typePerGebied.has(rij.airspace_id)) {
      if (rij.geom_type) typePerGebied.set(rij.airspace_id, rij.geom_type);
    }
  }

  const gebieden: Gebied[] = ((data ?? []) as unknown as Rij[]).map((rij) => {
    const lara = Array.isArray(rij.lara_areas) ? rij.lara_areas[0] : rij.lara_areas;
    return {
      id: rij.id,
      ident: rij.ident,
      name: rij.name,
      type: rij.type,
      class: rij.class,
      lowerlimit: rij.lowerlimit,
      lowerunit: rij.lowerunit,
      upperlimit: rij.upperlimit,
      upperunit: rij.upperunit,
      geometry_status: rij.geometry_status,
      geom_type: typePerGebied.get(rij.id) ?? null,
      volumes: rij.geometries?.[0]?.count ?? 0,
      inLara: Boolean(lara),
      laraAreaId: lara?.lara_area_id ?? null,
    };
  });

  return { gebieden, error: null };
}

/** Hoogte zoals hij in de lijst staat: `GND`, `FL 065`, `3500 ft`. */
export function toonHoogte(waarde: number | null, eenheid: string | null): string {
  if (waarde === null || waarde === undefined) return "—";
  const e = (eenheid ?? "").toUpperCase();
  if (e === "FL") return `FL ${String(waarde).padStart(3, "0")}`;
  if (waarde === 0 && (e === "FT" || e === "")) return "GND";
  if (e === "M") return `${waarde} m`;
  return `${waarde} ft`;
}

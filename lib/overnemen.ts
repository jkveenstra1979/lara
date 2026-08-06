import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Selectie en nummering meenemen naar een nieuwe dataset.
 *
 * De LARA-lijst verandert nauwelijks tussen AIRAC-cycli: dezelfde gebieden, met
 * dezelfde nummers. Handmatig overnemen zou betekenen dat je na elke import
 * honderden gebieden opnieuw aanvinkt en nummert, en één vergeten cyclus levert
 * een lege export op. Daarom gebeurt het bij de import, automatisch.
 *
 * Gematcht wordt op `ident` — de designator. Die is stabiel over cycli heen,
 * anders dan de UUID's, die per export kunnen wisselen.
 *
 * De uitkomst noemt drie dingen, en de laatste twee zijn de reden dat het
 * gerapporteerd wordt in plaats van stil gedaan:
 *
 *   overgenomen  de designator bestaat in beide datasets
 *   vervallen    stond in de vorige lijst, komt niet meer voor in dit AIXM
 *   nieuw        staat in dit AIXM, stond niet in de vorige lijst
 */

export type OvernameResultaat = {
  bronDatasetId: string;
  bronFilename: string;
  bronAirac: string;
  overgenomen: number;
  /** Designators die niet meer voorkomen; hun nummer komt vrij. */
  vervallen: { ident: string; laraAreaId: number | null }[];
  /** Designators die nieuw zijn in dit bestand. */
  nieuw: string[];
};

/** De meest recente andere dataset die een LARA-lijst heeft. */
export async function vindBronDataset(
  supabase: SupabaseClient<Database>,
  doelDatasetId: string
): Promise<{ id: string; filename: string; airac: string } | null> {
  const { data: datasets } = await supabase
    .from("datasets")
    .select("id, filename, airac, uploaded_at")
    .neq("id", doelDatasetId)
    .order("uploaded_at", { ascending: false });

  for (const dataset of datasets ?? []) {
    const { count } = await supabase
      .from("lara_areas")
      .select("id", { count: "exact", head: true })
      .eq("dataset_id", dataset.id);
    if ((count ?? 0) > 0) {
      return { id: dataset.id, filename: dataset.filename, airac: dataset.airac };
    }
  }
  return null;
}

type BronRij = {
  lara_area_id: number | null;
  note: string | null;
  airspaces: { ident: string } | { ident: string }[] | null;
};

const identVan = (rij: BronRij) =>
  Array.isArray(rij.airspaces) ? rij.airspaces[0]?.ident : rij.airspaces?.ident;

export async function neemSelectieOver(
  supabase: SupabaseClient<Database>,
  doelDatasetId: string,
  bronDatasetId: string,
  gebruikerId?: string
): Promise<{ resultaat: OvernameResultaat | null; error: string | null }> {
  const { data: bron } = await supabase
    .from("datasets")
    .select("id, filename, airac")
    .eq("id", bronDatasetId)
    .maybeSingle();
  if (!bron) return { resultaat: null, error: "Brondataset niet gevonden." };

  const { data: bronSelectie, error: bronFout } = await supabase
    .from("lara_areas")
    // Eén regel: concatenatie sloopt de type-inferentie van supabase-js.
    .select("lara_area_id, note, airspaces!inner(ident)")
    .eq("dataset_id", bronDatasetId);
  if (bronFout) return { resultaat: null, error: bronFout.message };

  const { data: doelGebieden, error: doelFout } = await supabase
    .from("airspaces")
    .select("id, ident")
    .eq("dataset_id", doelDatasetId);
  if (doelFout) return { resultaat: null, error: doelFout.message };

  const idPerIdent = new Map<string, string>();
  for (const gebied of doelGebieden ?? []) idPerIdent.set(gebied.ident, gebied.id);

  const overTeNemen: {
    dataset_id: string;
    airspace_id: string;
    lara_area_id: number | null;
    note: string | null;
    added_by?: string;
    updated_by?: string;
  }[] = [];
  const vervallen: OvernameResultaat["vervallen"] = [];
  const bronIdents = new Set<string>();

  for (const rij of (bronSelectie ?? []) as unknown as BronRij[]) {
    const ident = identVan(rij);
    if (!ident) continue;
    bronIdents.add(ident);

    const airspaceId = idPerIdent.get(ident);
    if (!airspaceId) {
      vervallen.push({ ident, laraAreaId: rij.lara_area_id });
      continue;
    }
    overTeNemen.push({
      dataset_id: doelDatasetId,
      airspace_id: airspaceId,
      lara_area_id: rij.lara_area_id,
      note: rij.note,
      ...(gebruikerId ? { added_by: gebruikerId, updated_by: gebruikerId } : {}),
    });
  }

  if (overTeNemen.length) {
    // In stukken: honderden rijen in één insert loopt vast.
    for (let i = 0; i < overTeNemen.length; i += 500) {
      const { error } = await supabase
        .from("lara_areas")
        .upsert(overTeNemen.slice(i, i + 500), { onConflict: "airspace_id" });
      if (error) return { resultaat: null, error: error.message };
    }
  }

  const nieuw = (doelGebieden ?? [])
    .filter((g) => !bronIdents.has(g.ident))
    .map((g) => g.ident);

  return {
    resultaat: {
      bronDatasetId: bron.id,
      bronFilename: bron.filename,
      bronAirac: bron.airac,
      overgenomen: overTeNemen.length,
      vervallen,
      nieuw,
    },
    error: null,
  };
}

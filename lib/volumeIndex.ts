import type { SupabaseClient } from "@supabase/supabase-js";
import type { Feature, Geometry } from "geojson";
import type { Database } from "./database.types";
import { inBrokken } from "./supabase/inBrokken";
import type { ComponentRij, GebiedRij, Index } from "./volumeResolutie";

/**
 * De gegevens bij elkaar zoeken die `losOp` nodig heeft.
 *
 * AIXM laat een gebied naar een ánder gebied verwijzen in plaats van zijn eigen
 * coördinaten op te schrijven: EHR4A is "EHR4, maar dan deze hoogteband". Zulke
 * ketens zijn langer dan één stap — EHBDRMZ wijst naar EHBDRMZA, en die pas naar
 * EHBDATZA — dus de rijen van de gebieden waarnaar wordt verwezen moeten er ook
 * bij, en die van de gebieden waar díé weer naar wijzen.
 *
 * Staat hier los omdat twee kanten het nodig hebben: de export, en het
 * detailpaneel dat exact hetzelfde wil laten zien als de export schrijft.
 */

export type GeometrieRij = Database["public"]["Tables"]["geometries"]["Row"];

export const alsUuidLijst = (waarde: unknown): string[] =>
  Array.isArray(waarde) ? waarde.filter((v): v is string => typeof v === "string") : [];

export const nieuweIndex = (): Index => ({
  perId: new Map<string, GebiedRij>(),
  idPerUuid: new Map<string, string>(),
});

/** Geometrierijen bij hun gebied zetten, in de vorm die de resolver leest. */
export function voegComponentenToe(index: Index, rijen: GeometrieRij[]) {
  for (const rij of rijen) {
    const gebied = index.perId.get(rij.airspace_id);
    if (!gebied) continue;
    const component: ComponentRij = {
      operation: rij.operation,
      operationSequence: rij.operation_sequence,
      geojson: (rij.geojson as unknown as Feature<Geometry> | null) ?? null,
      derivedFrom: alsUuidLijst(rij.derived_from),
      lowerlimit: rij.lowerlimit,
      lowerunit: rij.lowerunit,
      upperlimit: rij.upperlimit,
      upperunit: rij.upperunit,
    };
    gebied.componenten.push(component);
  }
}

/** Alle UUID's waar de index nog niets van weet. */
function ontbrekendeVerwijzingen(index: Index): string[] {
  const gezocht = new Set<string>();
  for (const gebied of index.perId.values()) {
    for (const component of gebied.componenten) {
      if (component.geojson) continue;
      for (const uuid of component.derivedFrom) {
        if (!index.idPerUuid.has(uuid)) gezocht.add(uuid);
      }
    }
  }
  return Array.from(gezocht);
}

/**
 * De keten van verwijzingen ophalen tot er niets nieuws meer bij komt.
 *
 * De grens van acht rondes is een noodrem, geen verwachting: de langste keten in
 * het AIXM van 1 oktober 2026 is twee stappen.
 */
export async function vulKetenAan(
  supabase: SupabaseClient<Database>,
  datasetId: string,
  index: Index
): Promise<string | null> {
  for (let ronde = 0; ronde < 8; ronde += 1) {
    const gezocht = ontbrekendeVerwijzingen(index);
    if (!gezocht.length) return null;

    const { data: bronnen, error: bronFout } = await inBrokken(gezocht, (brok) =>
      supabase
        .from("airspaces")
        .select("id, uuid_identifier")
        .eq("dataset_id", datasetId)
        .in("uuid_identifier", brok)
    );
    if (bronFout) return bronFout;

    const nieuweIds: string[] = [];
    for (const bron of bronnen) {
      if (index.perId.has(bron.id)) continue;
      index.perId.set(bron.id, { uuid: bron.uuid_identifier, componenten: [] });
      if (bron.uuid_identifier) index.idPerUuid.set(bron.uuid_identifier, bron.id);
      nieuweIds.push(bron.id);
    }
    // Alles wat gezocht werd en niet bestaat: markeren, anders blijft de lus
    // er elke ronde opnieuw naar vragen.
    for (const uuid of gezocht) {
      if (!index.idPerUuid.has(uuid)) index.idPerUuid.set(uuid, "");
    }
    if (!nieuweIds.length) return null;

    const { data: extra, error: extraFout } = await inBrokken(nieuweIds, (brok) =>
      supabase
        .from("geometries")
        .select("*")
        .in("airspace_id", brok)
        .order("operation_sequence", { ascending: true, nullsFirst: false })
    );
    if (extraFout) return extraFout;
    voegComponentenToe(index, extra as GeometrieRij[]);
  }
  return null;
}

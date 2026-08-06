import type { SupabaseClient } from "@supabase/supabase-js";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { Database } from "./database.types";
import type { ExportGebied } from "./laraWorkbook";
import type { BevindingGebied } from "./exportBevindingen";
import { toonHoogte } from "./gebieden";

/**
 * Alles ophalen wat een export nodig heeft, in één keer.
 *
 * Gedeeld door het exportscherm (dat de bevindingen toont) en de drie
 * downloadroutes, zodat de controle op het scherm over exact dezelfde gegevens
 * gaat als het bestand dat je krijgt.
 */

export type ExportDataset = {
  id: string;
  filename: string;
  airac: string;
};

export type ExportSet = {
  dataset: ExportDataset;
  gebieden: ExportGebied[];
  /** Dezelfde gebieden, in de vorm die de bevindingencontrole verwacht. */
  voorBevindingen: BevindingGebied[];
};

type GeometrieRij = Database["public"]["Tables"]["geometries"]["Row"];

const alsUuidLijst = (waarde: unknown): string[] =>
  Array.isArray(waarde) ? waarde.filter((v): v is string => typeof v === "string") : [];

/** De eigen vorm van een volume, of die van het gebied waar het naar verwijst. */
function vormVan(
  volume: GeometrieRij,
  geleend: Map<string, Feature<Geometry>>
): Feature<Geometry> | null {
  const eigen = (volume.geojson as unknown as Feature<Geometry> | null) ?? null;
  if (eigen) return eigen;
  for (const uuid of alsUuidLijst(volume.derived_from)) {
    const vorm = geleend.get(uuid);
    if (vorm) return vorm;
  }
  return null;
}

export async function haalExportSet(
  supabase: SupabaseClient<Database>,
  datasetId: string
): Promise<{ set: ExportSet | null; error: string | null }> {
  const { data: dataset, error: datasetFout } = await supabase
    .from("datasets")
    .select("id, filename, airac")
    .eq("id", datasetId)
    .maybeSingle();
  if (datasetFout) return { set: null, error: datasetFout.message };
  if (!dataset) return { set: null, error: "Dataset niet gevonden." };

  // De selectie met alles wat sheet 1 nodig heeft.
  const { data: selectie, error: selectieFout } = await supabase
    .from("lara_areas")
    // Eén regel: concatenatie sloopt de type-inferentie van supabase-js.
    .select("airspace_id, lara_area_id, airspaces!inner(id, ident, name, type, uuid_identifier, geometry, geometry_status)")
    .eq("dataset_id", datasetId);
  if (selectieFout) return { set: null, error: selectieFout.message };

  type Genest = {
    id: string;
    ident: string;
    name: string | null;
    type: string | null;
    uuid_identifier: string | null;
    geometry: string | null;
    geometry_status: string | null;
  };
  type Rij = { airspace_id: string; lara_area_id: number | null; airspaces: Genest | Genest[] | null };

  const rijen = ((selectie ?? []) as unknown as Rij[]).map((r) => ({
    ...r,
    gebied: Array.isArray(r.airspaces) ? r.airspaces[0] : r.airspaces,
  }));
  const airspaceIds = rijen.map((r) => r.airspace_id);
  if (!airspaceIds.length) {
    return { set: { dataset, gebieden: [], voorBevindingen: [] }, error: null };
  }

  // Volumes: de samenvoegrij hoort niet in sheet 2.
  const { data: geometrieRijen } = await supabase
    .from("geometries")
    .select("*")
    .in("airspace_id", airspaceIds)
    .neq("operation", "AGG")
    .order("operation_sequence", { ascending: true, nullsFirst: false });

  const volumesPerGebied = new Map<string, GeometrieRij[]>();
  for (const rij of (geometrieRijen ?? []) as GeometrieRij[]) {
    const lijst = volumesPerGebied.get(rij.airspace_id) ?? [];
    lijst.push(rij);
    volumesPerGebied.set(rij.airspace_id, lijst);
  }

  // XML-fragmenten, voor de timesheets in sheet 3.
  const uuids = rijen.map((r) => r.gebied?.uuid_identifier).filter((u): u is string => Boolean(u));
  const snippetPerUuid = new Map<string, string>();
  if (uuids.length) {
    const { data: snippets } = await supabase
      .from("xml_snippets")
      .select("uuid, snippet")
      .eq("dataset_id", datasetId)
      .in("uuid", uuids);
    for (const s of snippets ?? []) snippetPerUuid.set(s.uuid, s.snippet);
  }

  // Gebieden die hun vorm van een ánder gebied lenen.
  //
  // AIXM laat een airspace naar een andere verwijzen in plaats van zijn eigen
  // coördinaten op te schrijven: EHR4A is "EHR4, maar dan deze hoogteband".
  // Zo'n volume heeft `derived_from` gevuld en `geojson` leeg. Zonder deze stap
  // komt de kolom Coordinates leeg in het werkboek en weigert LARA de rij — in
  // het bestand van 3 september 2026 raakt dat 11 van de 100 reserveerbare
  // gebieden, waaronder EHR3A, EHR4A en EHTRA10A.
  const teLenen = new Set<string>();
  for (const rij of rijen) {
    for (const volume of volumesPerGebied.get(rij.airspace_id) ?? []) {
      if (volume.geojson) continue;
      for (const uuid of alsUuidLijst(volume.derived_from)) teLenen.add(uuid);
    }
  }

  const vormPerUuid = new Map<string, Feature<Geometry>>();
  if (teLenen.size) {
    const { data: bronnen } = await supabase
      .from("airspaces")
      .select("id, uuid_identifier")
      .eq("dataset_id", datasetId)
      .in("uuid_identifier", Array.from(teLenen));

    const uuidPerId = new Map((bronnen ?? []).map((b) => [b.id, b.uuid_identifier]));
    if (uuidPerId.size) {
      const { data: bronGeometrie } = await supabase
        .from("geometries")
        .select("airspace_id, geojson, operation")
        .in("airspace_id", Array.from(uuidPerId.keys()))
        .not("geojson", "is", null);

      // De samenvoegrij wint: die beschrijft het brongebied als geheel.
      for (const g of bronGeometrie ?? []) {
        const uuid = uuidPerId.get(g.airspace_id);
        if (!uuid) continue;
        if (g.operation === "AGG" || !vormPerUuid.has(uuid)) {
          vormPerUuid.set(uuid, g.geojson as unknown as Feature<Geometry>);
        }
      }
    }
  }

  const gebieden: ExportGebied[] = [];
  const voorBevindingen: BevindingGebied[] = [];

  for (const rij of rijen) {
    const g = rij.gebied;
    if (!g) continue;
    const volumes = volumesPerGebied.get(rij.airspace_id) ?? [];
    const snippet = g.uuid_identifier ? (snippetPerUuid.get(g.uuid_identifier) ?? null) : null;

    gebieden.push({
      laraAreaId: rij.lara_area_id,
      ident: g.ident,
      name: g.name,
      type: g.type,
      uuid: g.uuid_identifier,
      // De geldigheid van de timeslice slaan we niet apart op; de terugval geldt.
      validTimeBegin: null,
      validTimeEnd: null,
      geometry: g.geometry,
      xmlSnippet: snippet,
      volumes: volumes.map((v) => ({
        operationSequence: v.operation_sequence,
        lowerlimit: v.lowerlimit,
        lowerunit: v.lowerunit,
        upperlimit: v.upperlimit,
        upperunit: v.upperunit,
        geojson: vormVan(v, vormPerUuid),
      })),
    });

    voorBevindingen.push({
      laraAreaId: rij.lara_area_id,
      ident: g.ident,
      type: g.type,
      geometryStatus: g.geometry_status,
      xmlSnippet: snippet,
      geometry: g.geometry,
      volumes: volumes.map((v) => ({
        lowerlimit: v.lowerlimit,
        lowerunit: v.lowerunit,
        upperlimit: v.upperlimit,
        upperunit: v.upperunit,
        geojson: vormVan(v, vormPerUuid),
      })),
    });
  }

  return { set: { dataset, gebieden, voorBevindingen }, error: null };
}

/** De selectie als FeatureCollection, voor de KML- en GeoJSON-download. */
export function naarFeatureCollection(gebieden: ExportGebied[]): FeatureCollection {
  const features: Feature[] = [];

  for (const gebied of gebieden) {
    gebied.volumes.forEach((volume, i) => {
      if (!volume.geojson?.geometry) return;
      const meerdere = gebied.volumes.length > 1;
      features.push({
        type: "Feature",
        geometry: volume.geojson.geometry,
        properties: {
          ident: meerdere ? `${gebied.ident} (volume ${i + 1})` : gebied.ident,
          name: gebied.name,
          type: gebied.type,
          lara_area_id: gebied.laraAreaId,
          vertical: `${toonHoogte(volume.lowerlimit, volume.lowerunit)} – ${toonHoogte(volume.upperlimit, volume.upperunit)}`,
          volume: meerdere ? `${i + 1} van ${gebied.volumes.length}` : null,
        },
      });
    });
  }

  return { type: "FeatureCollection", features };
}

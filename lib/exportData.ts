import type { SupabaseClient } from "@supabase/supabase-js";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { Database } from "./database.types";
import { inBrokken } from "./supabase/inBrokken";
import { nieuweIndex, voegComponentenToe, vulKetenAan, type GeometrieRij } from "./volumeIndex";
import { losOp, type Index } from "./volumeResolutie";
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
  /** Gebieden waarvan de vorm niet, of niet helemaal, op te lossen was. */
  onopgelost: { ident: string; redenen: string[] }[];
};

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
    .select("airspace_id, lara_area_id, airspaces!inner(id, ident, name, type, uuid_identifier, geometry, geometry_status, lowerlimit, lowerunit, upperlimit, upperunit)")
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
    lowerlimit: number | null;
    lowerunit: string | null;
    upperlimit: number | null;
    upperunit: string | null;
  };
  type Rij = { airspace_id: string; lara_area_id: number | null; airspaces: Genest | Genest[] | null };

  const rijen = ((selectie ?? []) as unknown as Rij[]).map((r) => ({
    ...r,
    gebied: Array.isArray(r.airspaces) ? r.airspaces[0] : r.airspaces,
  }));
  const airspaceIds = rijen.map((r) => r.airspace_id);
  if (!airspaceIds.length) {
    return { set: { dataset, gebieden: [], voorBevindingen: [], onopgelost: [] }, error: null };
  }

  // Alle geometrierijen van de selectie — de AGG-rij inbegrepen. Die is niet
  // "een extra volume" maar juist het antwoord: de parser heeft de componenten
  // daar al samengevoegd.
  //
  // In brokken, want 319 UUID's in één `.in()` maken een URL van 11 KB en
  // leveren 414 op.
  const { data: geometrieRijen, error: volumeFout } = await inBrokken(airspaceIds, (brok) =>
    supabase
      .from("geometries")
      .select("*")
      .in("airspace_id", brok)
      .order("operation_sequence", { ascending: true, nullsFirst: false })
  );
  if (volumeFout) return { set: null, error: volumeFout };

  const index: Index = nieuweIndex();
  for (const rij of rijen) {
    if (!rij.gebied) continue;
    index.perId.set(rij.airspace_id, { uuid: rij.gebied.uuid_identifier, componenten: [] });
    if (rij.gebied.uuid_identifier) index.idPerUuid.set(rij.gebied.uuid_identifier, rij.airspace_id);
  }
  voegComponentenToe(index, geometrieRijen as GeometrieRij[]);

  // XML-fragmenten, voor de timesheets in sheet 3.
  const uuids = rijen.map((r) => r.gebied?.uuid_identifier).filter((u): u is string => Boolean(u));
  const snippetPerUuid = new Map<string, string>();
  if (uuids.length) {
    const { data: snippets, error: snippetFout } = await inBrokken(uuids, (brok) =>
      supabase
        .from("xml_snippets")
        .select("uuid, snippet")
        .eq("dataset_id", datasetId)
        .in("uuid", brok)
    );
    if (snippetFout) return { set: null, error: snippetFout };
    for (const s of snippets) snippetPerUuid.set(s.uuid, s.snippet);
  }

  // Gebieden die hun vorm van een ánder gebied lenen — en dat gebied mag zelf
  // weer lenen.
  //
  // AIXM laat een airspace naar een andere verwijzen in plaats van zijn eigen
  // coördinaten op te schrijven: EHR4A is "EHR4, maar dan deze hoogteband".
  // Zulke ketens zijn langer dan één stap: EHAADLG35B wijst naar EHAME2, en die
  // wijst pas naar EHMCE — het enige gebied in de rij met echte coördinaten.
  // Eén stap volgen was dus niet genoeg; daarom halen we de keten op tot er
  // niets nieuws meer bij komt.
  const fout = await vulKetenAan(supabase, datasetId, index);
  if (fout) return { set: null, error: fout };

  const gebieden: ExportGebied[] = [];
  const voorBevindingen: BevindingGebied[] = [];

  const onopgelost: { ident: string; redenen: string[] }[] = [];

  for (const rij of rijen) {
    const g = rij.gebied;
    if (!g) continue;
    const snippet = g.uuid_identifier ? (snippetPerUuid.get(g.uuid_identifier) ?? null) : null;

    // Eén rij per hoogteband, en binnen een band één rij per vlak: een gebied
    // dat uiteenvalt in losse stukken heeft er meer dan één.
    const opgelost = losOp(rij.airspace_id, index);
    if (opgelost.redenen.length) onopgelost.push({ ident: g.ident, redenen: opgelost.redenen });

    type ExportVolume = ExportGebied["volumes"][number];
    const volumes: ExportVolume[] = opgelost.volumes.length
      ? opgelost.volumes.flatMap((volume) =>
          volume.vlakken.length
            ? volume.vlakken.map((vlak) => ({ ...volume.band, geojson: vlak }))
            : [{ ...volume.band, geojson: null as Feature<Geometry> | null }]
        )
      : // Niets op te lossen: toch een rij, met de hoogteband van het gebied zelf.
        // Een leeg vak valt op; een ontbrekende rij niet.
        [
          {
            lowerlimit: g.lowerlimit,
            lowerunit: g.lowerunit,
            upperlimit: g.upperlimit,
            upperunit: g.upperunit,
            geojson: null,
          },
        ];

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
      volumes,
    });

    voorBevindingen.push({
      laraAreaId: rij.lara_area_id,
      ident: g.ident,
      type: g.type,
      geometryStatus: g.geometry_status,
      xmlSnippet: snippet,
      geometry: g.geometry,
      volumes,
    });
  }

  return { set: { dataset, gebieden, voorBevindingen, onopgelost }, error: null };
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

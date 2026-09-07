import type { SupabaseClient } from "@supabase/supabase-js";
import type { Feature, Geometry } from "geojson";
import type { Database } from "./database.types";
import { formatGeometryForLARA, type LaraGeometry } from "./laraUtils";
import { inBrokken } from "./supabase/inBrokken";
import { alsUuidLijst, nieuweIndex, voegComponentenToe, vulKetenAan, type GeometrieRij } from "./volumeIndex";
import { losOp } from "./volumeResolutie";

/**
 * Eén gebied met alles wat het detailpaneel toont.
 *
 * De volumes worden hier uitgerekend, met dezelfde functie die de export
 * gebruikt (`losOp`) en over dezelfde rijen. Dat is het hele punt van dit
 * paneel: wat je op het scherm ziet is letterlijk wat er in sheet 2 belandt,
 * niet een benadering ervan.
 *
 * Het paneel liet eerder de componentrijen zelf zien. Dat werkt zolang een
 * component zijn eigen coördinaten heeft, maar in het AIXM van 3 september 2026
 * zijn álle componenten van de 31 samengestelde gebieden kale verwijzingen naar
 * een ander gebied. Die rijen hebben geen `geojson`, dus de kaart bleef leeg en
 * de coördinatentab zei dat er niets was — terwijl de vorm gewoon aan het eind
 * van de keten ligt.
 */

/** Eén rij zoals sheet 2 (`Area Volumes`) hem krijgt. */
export type VolumeDetail = {
  id: string;
  lowerlimit: number | null;
  lowerunit: string | null;
  upperlimit: number | null;
  upperunit: string | null;
  /** Hoeveelste vlak binnen deze hoogteband, en hoeveel het er zijn. */
  vlak: number;
  vlakken: number;
  geojson: Feature<Geometry> | null;
  /** De DMS-reeks zoals de export hem schrijft; null als er geen vorm is. */
  lara: LaraGeometry | null;
};

/** Waar de vorm vandaan komt: de componenten zoals ze in het AIXM staan. */
export type ComponentDetail = {
  id: string;
  operation: string | null;
  operationSequence: number | null;
  lowerlimit: number | null;
  lowerunit: string | null;
  upperlimit: number | null;
  upperunit: string | null;
  /** Designators van de gebieden waar dit component zijn vorm van leent. */
  bronnen: string[];
  eigenVorm: boolean;
};

export type GebiedDetail = {
  id: string;
  ident: string;
  name: string | null;
  type: string | null;
  localType: string | null;
  class: string | null;
  lowerlimit: number | null;
  lowerunit: string | null;
  upperlimit: number | null;
  upperunit: string | null;
  geometry: string | null;
  geometryStatus: string | null;
  centroidLat: number | null;
  centroidLon: number | null;
  warnings: string[];
  inLara: boolean;
  laraAreaId: number | null;
  volumes: VolumeDetail[];
  componenten: ComponentDetail[];
  /** Wat er bij het oplossen niet, of niet helemaal, lukte. */
  redenen: string[];
  xmlSnippet: string | null;
};

const alsStringLijst = (waarde: unknown): string[] =>
  Array.isArray(waarde) ? waarde.filter((v): v is string => typeof v === "string") : [];

export async function haalGebiedDetail(
  supabase: SupabaseClient<Database>,
  airspaceId: string
): Promise<{ gebied: GebiedDetail | null; error: string | null }> {
  const { data: rij, error } = await supabase
    .from("airspaces")
    // Eén regel, met opzet: supabase-js leidt het resultaattype af uit deze
    // string als literal. Aan elkaar geplakt met + is het gewoon `string`, en
    // dan valt de hele inferentie terug op GenericStringError.
    .select("id, dataset_id, ident, name, type, local_type, class, lowerlimit, lowerunit, upperlimit, upperunit, geometry, geometry_status, centroid_lat, centroid_lon, warnings_json, uuid_identifier, lara_areas(lara_area_id)")
    .eq("id", airspaceId)
    .maybeSingle();

  if (error) return { gebied: null, error: error.message };
  if (!rij) return { gebied: null, error: null };

  const { data: geometrieRijen } = await supabase
    .from("geometries")
    .select("*")
    .eq("airspace_id", airspaceId)
    .order("operation_sequence", { ascending: true, nullsFirst: false });

  const rijen = (geometrieRijen ?? []) as GeometrieRij[];

  // De keten erbij: zonder de gebieden waarnaar wordt verwezen valt er niets op
  // te lossen voor een gebied dat zijn vorm leent.
  const index = nieuweIndex();
  index.perId.set(rij.id, { uuid: rij.uuid_identifier, componenten: [] });
  if (rij.uuid_identifier) index.idPerUuid.set(rij.uuid_identifier, rij.id);
  voegComponentenToe(index, rijen);
  const ketenFout = await vulKetenAan(supabase, rij.dataset_id, index);
  if (ketenFout) return { gebied: null, error: ketenFout };

  const opgelost = losOp(rij.id, index);

  const volumes: VolumeDetail[] = opgelost.volumes.flatMap((volume, band) =>
    volume.vlakken.map((vlak, i) => ({
      id: `${band}-${i}`,
      lowerlimit: volume.band.lowerlimit,
      lowerunit: volume.band.lowerunit,
      upperlimit: volume.band.upperlimit,
      upperunit: volume.band.upperunit,
      vlak: i + 1,
      vlakken: volume.vlakken.length,
      geojson: vlak,
      // De geometrietekst hangt aan het gebied, niet aan het volume; hij is
      // nodig om een cirkel als cirkel te herkennen in plaats van als polygoon.
      lara: formatGeometryForLARA(rij.geometry, vlak),
    }))
  );

  // De componentrijen blijven zichtbaar, maar als herkomst: welke bewerking, uit
  // welk gebied. De designators daarvoor staan in de index, niet in de rij zelf.
  const idents = new Map<string, string>();
  const bronIds = Array.from(index.perId.keys()).filter((id) => id && id !== rij.id);
  if (bronIds.length) {
    const { data: bronnen } = await inBrokken(bronIds, (brok) =>
      supabase.from("airspaces").select("ident, uuid_identifier").in("id", brok)
    );
    for (const bron of bronnen) {
      if (bron.uuid_identifier) idents.set(bron.uuid_identifier, bron.ident);
    }
  }

  const componenten: ComponentDetail[] = rijen
    .filter((g) => g.operation !== "AGG")
    .map((g) => ({
      id: g.id,
      operation: g.operation,
      operationSequence: g.operation_sequence,
      lowerlimit: g.lowerlimit,
      lowerunit: g.lowerunit,
      upperlimit: g.upperlimit,
      upperunit: g.upperunit,
      bronnen: alsUuidLijst(g.derived_from).map((uuid) => idents.get(uuid) ?? uuid),
      eigenVorm: g.geojson !== null,
    }));

  let xmlSnippet: string | null = null;
  if (rij.uuid_identifier) {
    const { data: snippet } = await supabase
      .from("xml_snippets")
      .select("snippet")
      .eq("dataset_id", rij.dataset_id)
      .eq("uuid", rij.uuid_identifier)
      .maybeSingle();
    xmlSnippet = snippet?.snippet ?? null;
  }

  const lara = Array.isArray(rij.lara_areas) ? rij.lara_areas[0] : rij.lara_areas;

  return {
    gebied: {
      id: rij.id,
      ident: rij.ident,
      name: rij.name,
      type: rij.type,
      localType: rij.local_type,
      class: rij.class,
      lowerlimit: rij.lowerlimit,
      lowerunit: rij.lowerunit,
      upperlimit: rij.upperlimit,
      upperunit: rij.upperunit,
      geometry: rij.geometry,
      geometryStatus: rij.geometry_status,
      centroidLat: rij.centroid_lat,
      centroidLon: rij.centroid_lon,
      warnings: alsStringLijst(rij.warnings_json),
      inLara: Boolean(lara),
      laraAreaId: lara?.lara_area_id ?? null,
      volumes,
      componenten,
      redenen: opgelost.redenen,
      xmlSnippet,
    },
    error: null,
  };
}

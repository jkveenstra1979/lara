import type { SupabaseClient } from "@supabase/supabase-js";
import type { Feature, Geometry } from "geojson";
import type { Database } from "./database.types";
import { formatGeometryForLARA, type LaraGeometry } from "./laraUtils";

/**
 * Eén gebied met alles wat het detailpaneel toont.
 *
 * De coördinaten worden hier berekend, met dezelfde functie die de export
 * gebruikt. Dat is het hele punt van die tab: wat je op het scherm ziet is
 * letterlijk wat er in kolom `Coordinates` van sheet 2 belandt, niet een
 * benadering ervan.
 */

export type VolumeDetail = {
  id: string;
  operation: string | null;
  operationSequence: number | null;
  geomType: string | null;
  geometryStatus: string | null;
  lowerlimit: number | null;
  lowerunit: string | null;
  upperlimit: number | null;
  upperunit: string | null;
  /** UUIDs van de gebieden waar dit volume uit is opgebouwd. */
  derivedFrom: string[];
  geojson: Feature<Geometry> | null;
  /** De DMS-reeks zoals de export hem schrijft; null als er geen vorm is. */
  lara: LaraGeometry | null;
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
  xmlSnippet: string | null;
};

type GeometrieRij = Database["public"]["Tables"]["geometries"]["Row"];

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

  const volumes: VolumeDetail[] = ((geometrieRijen ?? []) as GeometrieRij[])
    // De samenvoegrij is geen volume; die hoort niet in de kiezer.
    .filter((g) => g.operation !== "AGG")
    .map((g) => {
      const geojson = (g.geojson as unknown as Feature<Geometry> | null) ?? null;
      return {
        id: g.id,
        operation: g.operation,
        operationSequence: g.operation_sequence,
        geomType: g.geom_type,
        geometryStatus: g.geometry_status,
        lowerlimit: g.lowerlimit,
        lowerunit: g.lowerunit,
        upperlimit: g.upperlimit,
        upperunit: g.upperunit,
        derivedFrom: alsStringLijst(g.derived_from),
        geojson,
        // De geometrietekst hangt aan het gebied, niet aan het volume; hij is
        // nodig om een cirkel als cirkel te herkennen in plaats van als polygoon.
        lara: formatGeometryForLARA(rij.geometry, geojson),
      };
    });

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
      xmlSnippet,
    },
    error: null,
  };
}

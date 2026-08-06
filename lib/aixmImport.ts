/**
 * Van AIXM-bestand naar databaserijen.
 *
 * Deze module raakt geen database aan: hij levert de rijen en een samenvatting,
 * zodat het geheel te testen is zonder Supabase. De route eromheen doet niets
 * anders dan opslaan.
 *
 * Twee dingen wijken af van de brontool:
 *
 *   * `geometries` krijgt één rij per volume, mét de hoogteband van dat volume.
 *     De brontool schreef de componenten wel weg maar zonder banden, waardoor
 *     sheet 2 (Area Volumes) ze niet kon reproduceren. Zie lib/airspaceVolumes.ts.
 *
 *   * De samenvatting benoemt wat er níét gelukt is. Onopgeloste landsgrenzen
 *     leiden tot gebieden zonder coördinaten in de LARA-export, en dat is precies
 *     het soort fout dat niemand opmerkt tot het bij de gebruiker ligt.
 */

import type { Feature, Geometry } from "geojson";
import { parseAixm, type GeoBorderLookup, type ParsedAirspace } from "./aixmParser";
import { buildXmlSnippetIndex } from "./xmlSnippetIndex";
import { extractGeoborders, normalizeUuid, type Geoborder } from "./geoborderExtract";
import { collectVolumes, envelopeVerticalLimits, heeftMeerdereVolumes, type Volume } from "./airspaceVolumes";
import type { Database } from "./database.types";

type AirspaceRij = Database["public"]["Tables"]["airspaces"]["Insert"] & { id: string };
type GeometrieRij = Database["public"]["Tables"]["geometries"]["Insert"];
type SnippetRij = Database["public"]["Tables"]["xml_snippets"]["Insert"];

export type OnopgelosteGrens = {
  /** UUID van de landsgrens waar niets van gevonden is. */
  uuid: string;
  /** Designators van de gebieden die erop wachten. */
  gebieden: string[];
};

export type ImportSamenvatting = {
  airspaces: number;
  metGeometrie: number;
  /** Gebieden waarvan de vorm niet (volledig) is op te lossen. */
  onopgelost: number;
  geobordersUitBestand: number;
  geobordersUitTabel: number;
  /** Verwijzingen naar een landsgrens die nergens gevonden is. */
  onopgelosteGrenzen: OnopgelosteGrens[];
  gebiedenMetMeerdereVolumes: number;
  volumes: number;
};

export type ImportResultaat = {
  airspaceRijen: AirspaceRij[];
  geometrieRijen: GeometrieRij[];
  snippetRijen: SnippetRij[];
  geoborders: Geoborder[];
  samenvatting: ImportSamenvatting;
};

/**
 * Grensverwijzingen uit een geometrietekst.
 *
 * De parser schrijft een zijde die de landsgrens volgt als
 * `BORDER(uuid,vanLat,vanLon,naarLat,naarLon)`. Er bestaat ook een oudere vorm
 * zónder uuid — daar valt niets over te zeggen, dus die slaan we over.
 *
 * Dit is de betrouwbare ingang, en de reden dat het zo moet: als de grens
 * ontbreekt, meldt de parser **niets**. Hij sluit de ring dan met een rechte lijn
 * tussen de twee ankerpunten, zet `geometryStatus` op `ok` en geeft geen enkele
 * waarschuwing. Het gebied komt dus met een verkeerde vorm in de export — en een
 * verkeerde vorm valt minder op dan een lege coördinatenkolom.
 */
const BORDER_VERWIJZING = /BORDER\(([^,)]+),/g;

const grensUuidsUit = (geometrieTekst: string | null | undefined): string[] => {
  if (!geometrieTekst) return [];
  const uuids: string[] = [];
  for (const match of geometrieTekst.matchAll(BORDER_VERWIJZING)) {
    const eerste = match[1].trim();
    // De oude vorm begint met een breedtegraad; alleen de nieuwe heeft een uuid.
    if (eerste && !Number.isFinite(Number(eerste))) uuids.push(eerste);
  }
  return uuids;
};

/**
 * Koppeling tussen een gebied en zijn XML-fragment.
 *
 * `buildXmlSnippetIndex` sleutelt op de `gml:identifier` — de UUID die ín het
 * Airspace-element staat. De parser geeft die niet terug: `activeSlice.identifier`
 * komt uit de *timeslice* en is meestal leeg, en `gmlId` is de `gml:id` van het
 * element, iets heel anders.
 *
 * Daarom leggen we de brug via `gml:id`, dat in beide te vinden is. Zonder deze
 * omweg blijft de AIXM-tab in het detailpaneel altijd leeg.
 *
 * De sleutel wordt genormaliseerd zoals de parser dat doet. AeroDB schrijft
 * `gml:id="uuid.e999e734-…"`; de parser strookt daar `uuid.` vanaf. Zonder
 * dezelfde bewerking matcht er op echte data niets — wat op een zelfgemaakte
 * fixture zonder die prefix niet opvalt.
 */
const uuidPerGmlId = (snippets: Record<string, string>): Map<string, string> => {
  const kaart = new Map<string, string>();
  for (const [uuid, snippet] of Object.entries(snippets)) {
    const match = /gml:id\s*=\s*"([^"]+)"/i.exec(snippet);
    if (match) kaart.set(normalizeUuid(match[1]), uuid);
  }
  return kaart;
};

const designatorVan = (airspace: ParsedAirspace, index: number): string => {
  const slice = airspace.activeSlice;
  return (
    slice?.designator ??
    slice?.identifier ??
    slice?.name ??
    airspace.gmlId ??
    `AS-${index + 1}`
  );
};

const alleWaarschuwingen = (airspace: ParsedAirspace): string[] => [
  ...(airspace.warnings ?? []),
  ...(airspace.activeSlice?.warnings ?? []),
  ...(airspace.activeSlice?.geometryComponents.flatMap((c) => c.warnings ?? []) ?? []),
];

/**
 * Zet een AIXM-bestand om in rijen.
 *
 * `geobordersUitTabel` zijn de grenzen die al in de database staan. Grenzen die
 * in het bestand zelf zitten winnen daarvan — dat doet `parseAixm` intern al.
 */
export async function bouwImport(
  xml: string | Buffer,
  datasetId: string,
  geobordersUitTabel: GeoBorderLookup = {}
): Promise<ImportResultaat> {
  const tekst = typeof xml === "string" ? xml : xml.toString("utf-8");

  const geoborders = await extractGeoborders(tekst);
  const snippetIndex = buildXmlSnippetIndex(tekst);
  const snippetUuidPerGmlId = uuidPerGmlId(snippetIndex);
  const airspaces = await parseAixm(tekst, geobordersUitTabel);

  // Alles wat de parser aan grenzen tot zijn beschikking had: uit het bestand
  // zelf plus wat er uit de tabel is meegegeven.
  const beschikbareGrenzen = new Set<string>([
    ...geoborders.map((g) => g.borderId),
    ...Object.keys(geobordersUitTabel),
  ]);

  const airspaceRijen: AirspaceRij[] = [];
  const geometrieRijen: GeometrieRij[] = [];
  const grenzenPerUuid = new Map<string, Set<string>>();

  let metGeometrie = 0;
  let onopgelost = 0;
  let gebiedenMetMeerdereVolumes = 0;

  airspaces.forEach((airspace, index) => {
    const slice = airspace.activeSlice;
    const ident = designatorVan(airspace, index);
    const airspaceId = crypto.randomUUID();

    const volumes: Volume[] = slice ? collectVolumes(slice) : [];
    const omhullend = envelopeVerticalLimits(volumes);
    const waarschuwingen = alleWaarschuwingen(airspace);

    // De leesbare geometrietekst van het eerste component dat er één heeft;
    // die gaat naar de coördinatentab en naar formatGeometryForLARA.
    const geometrieTekst =
      slice?.geometryComponents.map((c) => c.geometryString).find((t) => typeof t === "string" && t.length) ?? null;

    // Elke grensverwijzing in élk component telt, niet alleen in de tekst die we
    // opslaan: een gebied kan meerdere componenten hebben die elk een grens raken.
    const ontbrekendeGrenzen = Array.from(
      new Set(
        (slice?.geometryComponents ?? [])
          .flatMap((c) => grensUuidsUit(c.geometryString))
          .filter((uuid) => !beschikbareGrenzen.has(uuid))
      )
    );

    for (const uuid of ontbrekendeGrenzen) {
      const gebieden = grenzenPerUuid.get(uuid) ?? new Set<string>();
      gebieden.add(ident);
      grenzenPerUuid.set(uuid, gebieden);
      waarschuwingen.push(
        `Landsgrens ${uuid} niet gevonden — de zijde die hem volgt is een rechte lijn geworden.`
      );
    }

    // De parser noemt zo'n gebied "ok" omdat de ring sluit. Hij sluit alleen op
    // de verkeerde plek. Dat mag geen "ok" heten: het is een halve oplossing en
    // moet als zodanig door de lijst en de export heen te volgen zijn.
    const geometrieStatus =
      ontbrekendeGrenzen.length && airspace.geometryStatus === "ok" ? "partial" : airspace.geometryStatus;

    if (geometrieStatus === "ok") metGeometrie += 1;
    else onopgelost += 1;
    if (heeftMeerdereVolumes(volumes)) gebiedenMetMeerdereVolumes += 1;

    airspaceRijen.push({
      id: airspaceId,
      dataset_id: datasetId,
      gml_id: airspace.gmlId ?? null,
      // De sleutel naar xml_snippets; zie uuidPerGmlId hierboven.
      uuid_identifier:
        (airspace.gmlId ? snippetUuidPerGmlId.get(airspace.gmlId) : undefined) ??
        slice?.identifier ??
        null,
      ident,
      name: slice?.name ?? null,
      type: slice?.type ?? null,
      local_type: slice?.localType ?? null,
      class: slice?.classes?.[0]?.value ?? null,
      lowerlimit: omhullend.lowerLimit?.value ?? null,
      lowerunit: omhullend.lowerLimit?.unit ?? null,
      upperlimit: omhullend.upperLimit?.value ?? null,
      upperunit: omhullend.upperLimit?.unit ?? null,
      vertical_limits_json: slice?.verticalLimits ? JSON.parse(JSON.stringify(slice.verticalLimits)) : null,
      geometry: geometrieTekst,
      geometry_status: geometrieStatus,
      centroid_lat: airspace.centroidLat ?? null,
      centroid_lon: airspace.centroidLon ?? null,
      warnings_json: waarschuwingen.length ? waarschuwingen : null,
      raw_fragment: airspace.rawFragment ?? null,
    });

    // De samengevoegde geometrie krijgt sequence 0 en operatie AGG: één rij die
    // het gebied als geheel beschrijft, náást de volumes waaruit het bestaat.
    const aggregatie = slice?.aggregatedGeometry;
    if (aggregatie?.geojson) {
      geometrieRijen.push({
        airspace_id: airspaceId,
        geojson: aggregatie.geojson as unknown as GeometrieRij["geojson"],
        bbox: (aggregatie.bbox ?? null) as GeometrieRij["bbox"],
        geom_type: aggregatie.geomType ?? aggregatie.geojson.geometry?.type ?? null,
        operation: "AGG",
        operation_sequence: 0,
        geometry_status: aggregatie.geometryStatus,
        lowerlimit: omhullend.lowerLimit?.value ?? null,
        lowerunit: omhullend.lowerLimit?.unit ?? null,
        upperlimit: omhullend.upperLimit?.value ?? null,
        upperunit: omhullend.upperLimit?.unit ?? null,
        derived_from: null,
      });
    }

    for (const volume of volumes) {
      geometrieRijen.push({
        airspace_id: airspaceId,
        geojson: (volume.geojson ?? null) as unknown as GeometrieRij["geojson"],
        bbox: (volume.bbox ?? null) as GeometrieRij["bbox"],
        geom_type: volume.geomType ?? volume.geojson?.geometry?.type ?? null,
        operation: volume.operation,
        operation_sequence: volume.operationSequence,
        geometry_status: volume.geometryStatus,
        lowerlimit: volume.lowerLimit?.value ?? null,
        lowerunit: volume.lowerLimit?.unit ?? null,
        upperlimit: volume.upperLimit?.value ?? null,
        upperunit: volume.upperLimit?.unit ?? null,
        derived_from: volume.derivedFrom.length ? volume.derivedFrom : null,
      });
    }
  });

  const snippetRijen: SnippetRij[] = Object.entries(snippetIndex).map(([uuid, snippet]) => ({
    dataset_id: datasetId,
    uuid,
    snippet,
  }));

  const onopgelosteGrenzen: OnopgelosteGrens[] = Array.from(grenzenPerUuid.entries())
    .map(([uuid, gebieden]) => ({ uuid, gebieden: Array.from(gebieden).sort() }))
    .sort((a, b) => b.gebieden.length - a.gebieden.length);

  return {
    airspaceRijen,
    geometrieRijen,
    snippetRijen,
    geoborders,
    samenvatting: {
      airspaces: airspaceRijen.length,
      metGeometrie,
      onopgelost,
      geobordersUitBestand: geoborders.length,
      geobordersUitTabel: Object.keys(geobordersUitTabel).length,
      onopgelosteGrenzen,
      gebiedenMetMeerdereVolumes,
      volumes: geometrieRijen.filter((r) => r.operation !== "AGG").length,
    },
  };
}

/**
 * Rijen uit de `geoborders`-tabel omzetten naar de vorm die `parseAixm` verwacht.
 * Alleen LineString en de buitenring van een Polygon leveren bruikbare punten op.
 */
export function geoborderLookupUitRijen(
  rijen: { border_id: string; geojson: unknown }[]
): GeoBorderLookup {
  const lookup: GeoBorderLookup = {};

  for (const rij of rijen) {
    const feature = rij.geojson as Feature<Geometry> | null;
    const geometrie = feature?.geometry;
    if (!geometrie) continue;

    let paren: unknown[] = [];
    if (geometrie.type === "LineString") paren = geometrie.coordinates;
    else if (geometrie.type === "Polygon") paren = geometrie.coordinates[0] ?? [];

    const punten = paren.filter(
      (p): p is [number, number] =>
        Array.isArray(p) && p.length >= 2 && typeof p[0] === "number" && typeof p[1] === "number"
    );

    if (punten.length) {
      lookup[String(rij.border_id).replace(/^urn:uuid:/, "").replace(/^uuid\./, "")] = punten;
    }
  }

  return lookup;
}

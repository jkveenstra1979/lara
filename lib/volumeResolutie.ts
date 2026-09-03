import type { Feature, Geometry, MultiPolygon as GeoMultiPolygon } from "geojson";
import polygonClipping from "polygon-clipping";

/**
 * Eén gebied, één vorm.
 *
 * AIXM beschrijft een luchtruim niet als een lijst losse volumes maar als één
 * geometrie die is opgebouwd uit componenten: een BASE, en daarna UNION, SUBTR
 * of INTERS in de volgorde van `operationSequence`. Een component hoeft geen
 * eigen coördinaten te hebben — hij mag naar een ánder gebied verwijzen, en dat
 * gebied mag op zijn beurt weer verwijzen.
 *
 * De export schreef elke component als een eigen rij in sheet 2. Dat maakt van
 * één gebied meerdere volumes met dezelfde hoogteband, en het levert lege
 * coördinaten op zodra een component alleen een verwijzing is. In het AIXM van
 * 1 oktober 2026 raakt dat vijf gebieden.
 *
 * Deze module doet wat de analyzer (`aixm-ingest/parsers/airspace.py`) doet:
 * componenten oplossen — desnoods via de keten — en samenvoegen tot één vorm.
 *
 * Twee dingen die de analyzer niet heeft en hier wel:
 *
 *   - De parser zet bij de import al een `AGG`-rij neer met de samengevoegde
 *     vorm. Is die er, dan is het antwoord al gegeven en hoeft er niets te
 *     worden herrekend.
 *   - Valt de uitkomst uiteen in losse vlakken (EHAADLG6 is een MultiPolygon van
 *     twee), dan blijft het één gebied met één hoogteband, maar krijgt sheet 2
 *     er een rij per vlak. Anders zou de helft stil wegvallen.
 */

type Paar = [number, number];
/** Zoals polygon-clipping het wil: [polygoon][ring][punt]. */
type MultiPolygon = Paar[][][];

export type ComponentRij = {
  operation: string | null;
  operationSequence: number | null;
  geojson: Feature<Geometry> | null;
  /** UUID's van gebieden waar dit component zijn vorm van leent. */
  derivedFrom: string[];
  lowerlimit: number | null;
  lowerunit: string | null;
  upperlimit: number | null;
  upperunit: string | null;
};

export type GebiedRij = {
  /** Sleutel waarmee andere gebieden hiernaar verwijzen. */
  uuid: string | null;
  componenten: ComponentRij[];
};

export type Hoogteband = {
  lowerlimit: number | null;
  lowerunit: string | null;
  upperlimit: number | null;
  upperunit: string | null;
};

export type Opgelost = {
  /** Eén vorm per vlak. Leeg betekent: er viel niets op te lossen. */
  vlakken: Feature<Geometry>[];
  band: Hoogteband;
  /** Waarom het niet, of niet helemaal, lukte. Leeg is goed. */
  redenen: string[];
};

export type Index = {
  /** airspace_id → gebied. */
  perId: Map<string, GebiedRij>;
  /** uuid_identifier → airspace_id. */
  idPerUuid: Map<string, string>;
};

const OPERATIES = new Set(["UNION", "SUBTR", "INTERS"]);

const naarMultiPolygon = (feature: Feature<Geometry> | null): MultiPolygon | null => {
  const geom = feature?.geometry;
  if (!geom) return null;
  if (geom.type === "Polygon") return [geom.coordinates as Paar[][]];
  if (geom.type === "MultiPolygon") return geom.coordinates as Paar[][][];
  return null;
};

const bandVan = (c: ComponentRij): Hoogteband => ({
  lowerlimit: c.lowerlimit,
  lowerunit: c.lowerunit,
  upperlimit: c.upperlimit,
  upperunit: c.upperunit,
});

const zelfdeBand = (a: Hoogteband, b: Hoogteband) =>
  a.lowerlimit === b.lowerlimit &&
  a.lowerunit === b.lowerunit &&
  a.upperlimit === b.upperlimit &&
  a.upperunit === b.upperunit;

/** De vorm van één component: die van zichzelf, of die van het gebied waarnaar hij wijst. */
function vormVanComponent(
  component: ComponentRij,
  index: Index,
  bezig: Set<string>,
  onthouden: Map<string, MultiPolygon | null>
): { vorm: MultiPolygon | null; reden: string | null } {
  const eigen = naarMultiPolygon(component.geojson);
  if (eigen) return { vorm: eigen, reden: null };

  for (const uuid of component.derivedFrom) {
    const bronId = index.idPerUuid.get(uuid);
    if (!bronId) return { vorm: null, reden: `verwijst naar ${uuid}, dat niet in de dataset staat` };

    const vorm = vormVanGebied(bronId, index, bezig, onthouden);
    if (vorm) return { vorm, reden: null };
    return { vorm: null, reden: `de keten via ${uuid} levert geen vorm op` };
  }

  return { vorm: null, reden: "geen eigen coördinaten en geen verwijzing" };
}

/**
 * De samengevoegde vorm van een gebied. `bezig` breekt een kring af: AIXM
 * verbiedt niet dat A naar B wijst en B terug naar A.
 */
function vormVanGebied(
  airspaceId: string,
  index: Index,
  bezig: Set<string>,
  onthouden: Map<string, MultiPolygon | null>
): MultiPolygon | null {
  if (onthouden.has(airspaceId)) return onthouden.get(airspaceId) ?? null;
  if (bezig.has(airspaceId)) return null;

  bezig.add(airspaceId);
  const uitkomst = losOp(airspaceId, index, bezig, onthouden);
  bezig.delete(airspaceId);

  const vorm = uitkomst.vlakken.length ? samenvoegen(uitkomst.vlakken) : null;
  onthouden.set(airspaceId, vorm);
  return vorm;
}

const samenvoegen = (vlakken: Feature<Geometry>[]): MultiPolygon | null => {
  const delen = vlakken.map(naarMultiPolygon).filter((m): m is MultiPolygon => m !== null);
  if (!delen.length) return null;
  return delen.length === 1 ? delen[0] : (polygonClipping.union(delen[0], ...delen.slice(1)) as MultiPolygon);
};

const alsFeature = (polygoon: Paar[][]): Feature<Geometry> => ({
  type: "Feature",
  properties: {},
  geometry: { type: "Polygon", coordinates: polygoon },
});

/* ------------------------------------------------------------- splinters -- */

/**
 * Oppervlakte van een ring in km², op de bol.
 *
 * Ruw maar ruim voldoende: het gaat om de vraag of een vlak vierkante
 * kilometers groot is of vierkante meters.
 */
function oppervlakteKm2(ring: Paar[]): number {
  const R = 6371;
  let som = 0;
  for (let i = 0; i + 1 < ring.length; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    som +=
      (((x2 - x1) * Math.PI) / 180) *
      (2 + Math.sin((y1 * Math.PI) / 180) + Math.sin((y2 * Math.PI) / 180));
  }
  return Math.abs((som * R * R) / 2);
}

/**
 * Splinters uit de samenvoeging gooien.
 *
 * Twee componenten die een rand delen hebben in AIXM niet altijd exact dezelfde
 * hoekpunten: één tussenpunt dat er tientallen meters naast ligt is genoeg om
 * de samenvoeging een flinterdunne wig te laten achterlaten. In het AIXM van
 * 1 oktober 2026 levert dat bij EHAADLG6 een driehoek van 29,7 km lang en 23,8 m
 * breed — 0,4 km² naast een gebied van 531 km².
 *
 * Zo'n wig zou in sheet 2 een eigen rij krijgen en in LARA als een tweede vlak
 * binnenkomen. Weggooien dus, maar alleen als hij aan beide voorwaarden voldoet:
 * kleiner dan een halve procent van het grootste vlak, én kleiner dan een
 * vierkante kilometer. Een gebied dat werkelijk uit twee stukken bestaat — zoals
 * EBTRAN2, met 51 en 153 km² — blijft daarmee heel.
 */
const SPLINTER_DEEL = 0.005;
const SPLINTER_KM2 = 1;

function zonderSplinters(
  vlakken: MultiPolygon
): { vlakken: MultiPolygon; verwijderd: number[] } {
  if (vlakken.length < 2) return { vlakken, verwijderd: [] };

  const oppervlaktes = vlakken.map((p) => oppervlakteKm2(p[0] ?? []));
  const grootste = Math.max(...oppervlaktes);

  const houden: MultiPolygon = [];
  const verwijderd: number[] = [];
  vlakken.forEach((polygoon, i) => {
    const opp = oppervlaktes[i];
    if (opp < SPLINTER_KM2 && opp < grootste * SPLINTER_DEEL) verwijderd.push(opp);
    else houden.push(polygoon);
  });

  return { vlakken: houden.length ? houden : vlakken, verwijderd };
}

/** Vlakken naar features, met de splinters eruit. */
function naarVlakken(mp: MultiPolygon, redenen: string[]): Feature<Geometry>[] {
  const { vlakken, verwijderd } = zonderSplinters(mp);
  if (verwijderd.length) {
    redenen.push(
      `${verwijderd.length} ${verwijderd.length === 1 ? "splinter" : "splinters"} uit de samenvoeging weggelaten (${verwijderd
        .map((o) => `${o < 0.05 ? "<0,05" : o.toFixed(2).replace(".", ",")} km²`)
        .join(", ")})`
    );
  }
  return vlakken.map(alsFeature);
}

/**
 * Een gebied oplossen tot vlakken plus één hoogteband.
 *
 * Volgorde van beslissen:
 *   1. Is er een `AGG`-rij met een vorm, dan is dat de uitkomst.
 *   2. Anders: BASE als start (of het eerste component dat iets oplevert), en
 *      daarna de operaties op volgorde van `operationSequence`.
 */
export function losOp(
  airspaceId: string,
  index: Index,
  bezig: Set<string> = new Set(),
  onthouden: Map<string, MultiPolygon | null> = new Map()
): Opgelost {
  const gebied = index.perId.get(airspaceId);
  const leeg: Opgelost = {
    vlakken: [],
    band: { lowerlimit: null, lowerunit: null, upperlimit: null, upperunit: null },
    redenen: [],
  };
  if (!gebied?.componenten.length) {
    return { ...leeg, redenen: ["het gebied heeft geen geometrie"] };
  }

  // 1 — de samenvoegrij van de parser.
  const agg = gebied.componenten.find((c) => (c.operation ?? "").toUpperCase() === "AGG");
  const aggVorm = naarMultiPolygon(agg?.geojson ?? null);
  if (agg && aggVorm) {
    const redenenAgg: string[] = [];
    return { vlakken: naarVlakken(aggVorm, redenenAgg), band: bandVan(agg), redenen: redenenAgg };
  }

  // 2 — zelf samenvoegen.
  const delen = gebied.componenten
    .filter((c) => (c.operation ?? "").toUpperCase() !== "AGG")
    .sort((a, b) => (a.operationSequence ?? 0) - (b.operationSequence ?? 0));

  const start = delen.find((c) => (c.operation ?? "").toUpperCase() === "BASE") ?? delen[0];
  const redenen: string[] = [];

  const eerste = vormVanComponent(start, index, bezig, onthouden);
  let vorm = eerste.vorm;
  if (!vorm) {
    if (eerste.reden) redenen.push(`BASE: ${eerste.reden}`);
    // Terugval: het eerste component dat wél iets oplevert.
    for (const component of delen) {
      if (component === start) continue;
      const anders = vormVanComponent(component, index, bezig, onthouden);
      if (anders.vorm) {
        vorm = anders.vorm;
        redenen.push("BASE was niet op te lossen; een ander component is als basis gebruikt");
        break;
      }
    }
  }
  if (!vorm) return { ...leeg, band: bandVan(start), redenen: redenen.length ? redenen : ["geen enkel component levert een vorm op"] };

  const band = bandVan(start);

  for (const component of delen) {
    if (component === start) continue;
    const operatie = (component.operation ?? "").toUpperCase();
    if (!OPERATIES.has(operatie)) {
      redenen.push(`operatie ${operatie || "onbekend"} wordt niet ondersteund`);
      continue;
    }

    const deel = vormVanComponent(component, index, bezig, onthouden);
    if (!deel.vorm) {
      redenen.push(`${operatie} op volgnummer ${component.operationSequence ?? "?"}: ${deel.reden ?? "niet op te lossen"}`);
      continue;
    }
    if (!zelfdeBand(band, bandVan(component))) {
      redenen.push(
        `${operatie} op volgnummer ${component.operationSequence ?? "?"} heeft een andere hoogteband; die van BASE geldt`
      );
    }

    if (operatie === "UNION") vorm = polygonClipping.union(vorm, deel.vorm) as MultiPolygon;
    else if (operatie === "SUBTR") vorm = polygonClipping.difference(vorm, deel.vorm) as MultiPolygon;
    else vorm = polygonClipping.intersection(vorm, deel.vorm) as MultiPolygon;
  }

  return { vlakken: naarVlakken(vorm, redenen), band, redenen };
}

/** Het type is er alleen voor de test; de export gebruikt `losOp`. */
export type { GeoMultiPolygon };

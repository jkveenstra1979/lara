import type { Feature, Geometry } from "geojson";
import polygonClipping from "polygon-clipping";

/**
 * Eén gebied, één stapel volumes.
 *
 * AIXM beschrijft een luchtruim niet als een lijst losse volumes maar als één
 * geometrie die is opgebouwd uit componenten: een BASE, en daarna UNION, SUBTR
 * of INTERS in de volgorde van `operationSequence`. Elk component heeft een
 * eigen hoogteband, en hoeft geen eigen coördinaten te hebben — hij mag naar een
 * ánder gebied verwijzen (`contributorAirspace`), en dat gebied mag op zijn
 * beurt weer verwijzen.
 *
 * Twee dingen die daaruit volgen en die deze module doet:
 *
 *   1. De vorm van een component komt desnoods uit de keten. EHBDRMZ heeft geen
 *      enkele eigen coördinaat: BASE wijst naar EHBDRMZA, dat naar EHBDATZA
 *      wijst, en pas daar staan de punten.
 *
 *   2. Een gebied waarvan de componenten verschillende hoogtebanden hebben is
 *      geen plat vlak maar een trap. EHBDRMZ is EHBDRMZA tot 1200 ft mét
 *      EHBDRMZB tot 600 ft; die twee samenvoegen tot één vlak van 0–1200 ft
 *      maakt de onderste helft 600 voet te hoog.
 *
 *      Daarom wordt de hoogte-as opgeknipt op elke bandgrens die in de
 *      componenten voorkomt, wordt per schijf uitgerekend welke componenten daar
 *      gelden, en worden aangrenzende schijven met dezelfde inhoud weer
 *      samengevoegd. Wat overblijft is één volume per hoogteband — precies wat
 *      sheet 2 (`Area Volumes`) van LARA verwacht: meerdere rijen per gebied,
 *      elk met een eigen onder- en bovengrens.
 *
 * Hebben alle componenten dezelfde band — het gewone geval — dan blijft er één
 * schijf over en verandert er niets aan de uitkomst.
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

/** Eén hoogteband van een gebied, met de vlakken die daar gelden. */
export type Volume = {
  /** Meestal één vlak; alleen een gebied dat uiteenvalt krijgt er meer. */
  vlakken: Feature<Geometry>[];
  band: Hoogteband;
};

export type Opgelost = {
  /** Van laag naar hoog. Leeg betekent: er viel niets op te lossen. */
  volumes: Volume[];
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

const LEGE_BAND: Hoogteband = {
  lowerlimit: null,
  lowerunit: null,
  upperlimit: null,
  upperunit: null,
};

const operatieVan = (c: ComponentRij) => (c.operation ?? "").toUpperCase();

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

const heeftBand = (b: Hoogteband) => b.lowerlimit !== null || b.upperlimit !== null;

/**
 * Een hoogte in voet, alleen om banden te kunnen ordenen en vergelijken.
 *
 * FL95 is 9500 voet. Dat een vliegniveau een drukhoogte is en `FT` meestal
 * boven zeeniveau of grond ligt maakt hier niet uit: het gaat om de volgorde van
 * de grenzen, en die is in beide eenheden dezelfde. De band zelf gaat
 * onveranderd — in zijn eigen eenheid — de export in.
 */
const inVoet = (limiet: number | null, eenheid: string | null): number | null => {
  if (limiet === null) return null;
  return (eenheid ?? "").toUpperCase() === "FL" ? limiet * 100 : limiet;
};

const samenvoegen = (delen: MultiPolygon[]): MultiPolygon | null => {
  if (!delen.length) return null;
  if (delen.length === 1) return delen[0];
  return polygonClipping.union(delen[0], ...delen.slice(1)) as MultiPolygon;
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

function zonderSplinters(vlakken: MultiPolygon): { vlakken: MultiPolygon; verwijderd: number[] } {
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

/* ----------------------------------------------------------- componenten -- */

/**
 * Eén component, opgelost tot vorm-plus-band.
 *
 * Meestal is dat er één. Het worden er meer wanneer het component zijn hoogte
 * niet zelf opgeeft en het brongebied uit meerdere banden bestaat: dan neemt het
 * de hele stapel van dat gebied over. Zo staat het in het AIXM van 3 september
 * 2026 bij EHSECTLOW2, waar de componenten 10 en 11 geen `upperLimit` en
 * `lowerLimit` hebben en naar EHMCD en EHBK1 wijzen.
 */
type Deel = {
  operatie: string;
  vorm: MultiPolygon;
  band: Hoogteband;
  onderFt: number | null;
  bovenFt: number | null;
};

const alsDeel = (operatie: string, vorm: MultiPolygon, band: Hoogteband): Deel => ({
  operatie,
  vorm,
  band,
  onderFt: inVoet(band.lowerlimit, band.lowerunit),
  bovenFt: inVoet(band.upperlimit, band.upperunit),
});

/** Overlappen twee banden elkaar? Een onbekende grens telt als "ja". */
const overlapt = (a: Hoogteband, onderFt: number | null, bovenFt: number | null) => {
  const aOnder = inVoet(a.lowerlimit, a.lowerunit);
  const aBoven = inVoet(a.upperlimit, a.upperunit);
  if (onderFt !== null && aBoven !== null && aBoven <= onderFt) return false;
  if (bovenFt !== null && aOnder !== null && aOnder >= bovenFt) return false;
  return true;
};

function delenVanComponent(
  component: ComponentRij,
  operatie: string,
  index: Index,
  bezig: Set<string>,
  onthouden: Map<string, Volume[]>
): { delen: Deel[]; reden: string | null } {
  const band = bandVan(component);

  const eigen = naarMultiPolygon(component.geojson);
  if (eigen) return { delen: [alsDeel(operatie, eigen, band)], reden: null };

  for (const uuid of component.derivedFrom) {
    const bronId = index.idPerUuid.get(uuid);
    if (!bronId) return { delen: [], reden: `verwijst naar ${uuid}, dat niet in de dataset staat` };

    const bron = volumesVanGebied(bronId, index, bezig, onthouden).map((volume) => ({
      vorm: samenvoegen(volume.vlakken.map(naarMultiPolygon).filter((m): m is MultiPolygon => m !== null)),
      band: volume.band,
    }));
    const bruikbaar = bron.filter((b): b is { vorm: MultiPolygon; band: Hoogteband } => b.vorm !== null);
    if (!bruikbaar.length) return { delen: [], reden: `de keten via ${uuid} levert geen vorm op` };

    // Geeft het component zelf een hoogte op, dan geldt die — het leent van het
    // brongebied alleen de vorm. Van een brongebied dat zelf een stapel is
    // tellen dan de banden mee die de gevraagde hoogte raken.
    if (heeftBand(band)) {
      const onderFt = inVoet(band.lowerlimit, band.lowerunit);
      const bovenFt = inVoet(band.upperlimit, band.upperunit);
      const raakt = bruikbaar.filter((b) => overlapt(b.band, onderFt, bovenFt));
      const vorm = samenvoegen((raakt.length ? raakt : bruikbaar).map((b) => b.vorm));
      return vorm ? { delen: [alsDeel(operatie, vorm, band)], reden: null } : { delen: [], reden: null };
    }

    // Geen eigen hoogte: dan is dit component het brongebied, banden en al.
    return { delen: bruikbaar.map((b) => alsDeel(operatie, b.vorm, b.band)), reden: null };
  }

  return { delen: [], reden: "geen eigen coördinaten en geen verwijzing" };
}

/**
 * De volumes van een gebied, met een kring-slot. AIXM verbiedt niet dat A naar B
 * wijst en B terug naar A.
 */
function volumesVanGebied(
  airspaceId: string,
  index: Index,
  bezig: Set<string>,
  onthouden: Map<string, Volume[]>
): Volume[] {
  const bekend = onthouden.get(airspaceId);
  if (bekend) return bekend;
  if (bezig.has(airspaceId)) return [];

  bezig.add(airspaceId);
  const uitkomst = losOp(airspaceId, index, bezig, onthouden);
  bezig.delete(airspaceId);

  onthouden.set(airspaceId, uitkomst.volumes);
  return uitkomst.volumes;
}

/* --------------------------------------------------------------- schijven -- */

/**
 * De hoogte-as opknippen op elke bandgrens, en per schijf de componenten
 * toepassen die daar gelden.
 *
 * Een component telt mee in een schijf als hij die helemaal omvat. De schijven
 * lopen immers van bandgrens tot bandgrens, dus half meedoen kan niet.
 */
function schijven(delen: Deel[], redenen: string[]): Volume[] {
  const randen = Array.from(
    new Set(delen.flatMap((d) => [d.onderFt, d.bovenFt]).filter((v): v is number => v !== null))
  ).sort((a, b) => a - b);

  // Zonder bandgrenzen valt er niets op te knippen: één volume, één band.
  if (randen.length < 2) {
    const vorm = pasToe(delen, redenen);
    const start = delen.find((d) => d.operatie === "BASE") ?? delen[0];
    return vorm ? [{ vlakken: naarVlakken(vorm, redenen), band: start?.band ?? LEGE_BAND }] : [];
  }

  const onder = randen[0];
  const boven = randen[randen.length - 1];
  const actiefIn = (i: number) =>
    delen.filter((d) => (d.onderFt ?? onder) <= randen[i] && (d.bovenFt ?? boven) >= randen[i + 1]);

  // Aangrenzende schijven met exact dezelfde componenten horen bij elkaar: die
  // grens bestaat alleen omdat een ánder deel van het gebied daar overgaat.
  const stukken: { van: number; tot: number; actief: Deel[] }[] = [];
  for (let i = 0; i + 1 < randen.length; i += 1) {
    const actief = actiefIn(i);
    const vorige = stukken[stukken.length - 1];
    const zelfde =
      vorige &&
      vorige.tot === i &&
      vorige.actief.length === actief.length &&
      vorige.actief.every((d, n) => d === actief[n]);
    if (zelfde) vorige.tot = i + 1;
    else stukken.push({ van: i, tot: i + 1, actief });
  }

  // De grenzen terug in hun eigen eenheid: 9500 voet was FL95 of 9500 FT,
  // afhankelijk van hoe het component het opschreef.
  const onderPerFt = new Map<number, Hoogteband>();
  const bovenPerFt = new Map<number, Hoogteband>();
  for (const d of delen) {
    if (d.onderFt !== null && !onderPerFt.has(d.onderFt)) onderPerFt.set(d.onderFt, d.band);
    if (d.bovenFt !== null && !bovenPerFt.has(d.bovenFt)) bovenPerFt.set(d.bovenFt, d.band);
  }
  const grens = (ft: number, kant: "onder" | "boven"): Partial<Hoogteband> => {
    const eigen = kant === "onder" ? onderPerFt.get(ft) : bovenPerFt.get(ft);
    const ander = kant === "onder" ? bovenPerFt.get(ft) : onderPerFt.get(ft);
    if (kant === "onder") {
      if (eigen) return { lowerlimit: eigen.lowerlimit, lowerunit: eigen.lowerunit };
      if (ander) return { lowerlimit: ander.upperlimit, lowerunit: ander.upperunit };
      return { lowerlimit: null, lowerunit: null };
    }
    if (eigen) return { upperlimit: eigen.upperlimit, upperunit: eigen.upperunit };
    if (ander) return { upperlimit: ander.lowerlimit, upperunit: ander.lowerunit };
    return { upperlimit: null, upperunit: null };
  };

  const volumes: Volume[] = [];
  for (const stuk of stukken) {
    const vanFt = randen[stuk.van];
    const totFt = randen[stuk.tot];
    const vorm = pasToe(stuk.actief, redenen, `tussen ${vanFt} en ${totFt} voet`);
    if (!vorm) continue;
    volumes.push({
      vlakken: naarVlakken(vorm, redenen),
      band: { ...LEGE_BAND, ...grens(vanFt, "onder"), ...grens(totFt, "boven") },
    });
  }
  return volumes;
}

/**
 * De componenten van één schijf toepassen: een basis, en daaroverheen de
 * operaties op volgorde.
 */
function pasToe(actief: Deel[], redenen: string[], waar = ""): MultiPolygon | null {
  if (!actief.length) return null;

  // Een SUBTR of INTERS zonder iets om van af te trekken levert de omgekeerde
  // vorm op; dan is de schijf leeg, niet het tegendeel.
  const start = actief.find((d) => d.operatie === "BASE") ?? actief.find((d) => d.operatie === "UNION");
  if (!start) {
    redenen.push(`geen basisvorm${waar ? ` ${waar}` : ""}; die schijf is overgeslagen`);
    return null;
  }

  let vorm = start.vorm;
  for (const deel of actief) {
    if (deel === start) continue;
    if (deel.operatie === "UNION") vorm = polygonClipping.union(vorm, deel.vorm) as MultiPolygon;
    else if (deel.operatie === "SUBTR") vorm = polygonClipping.difference(vorm, deel.vorm) as MultiPolygon;
    else if (deel.operatie === "INTERS") vorm = polygonClipping.intersection(vorm, deel.vorm) as MultiPolygon;
  }
  return vorm.length ? vorm : null;
}

/* ------------------------------------------------------------------ losOp -- */

/**
 * Een gebied oplossen tot volumes.
 *
 * Volgorde van beslissen:
 *   1. Zijn er `AGG`-rijen, dan zijn dat de volumes. De import zet ze neer met
 *      deze functie, dus ze zijn hetzelfde antwoord — alleen al uitgerekend.
 *   2. Anders: de componenten oplossen (desnoods via de keten) en de hoogte-as
 *      opknippen op hun bandgrenzen.
 */
export function losOp(
  airspaceId: string,
  index: Index,
  bezig: Set<string> = new Set(),
  onthouden: Map<string, Volume[]> = new Map()
): Opgelost {
  const gebied = index.perId.get(airspaceId);
  if (!gebied?.componenten.length) {
    return { volumes: [], redenen: ["het gebied heeft geen geometrie"] };
  }

  // 1 — de samenvoegrijen van de import. Ze tellen vanaf 0 terug, zodat ze nooit
  // botsen met het volgnummer van een component.
  const agg = gebied.componenten
    .filter((c) => operatieVan(c) === "AGG" && c.geojson)
    .sort((a, b) => (b.operationSequence ?? 0) - (a.operationSequence ?? 0));
  if (agg.length) {
    const redenen: string[] = [];
    const volumes = agg
      .map((c) => ({ mp: naarMultiPolygon(c.geojson), band: bandVan(c) }))
      .filter((v): v is { mp: MultiPolygon; band: Hoogteband } => v.mp !== null)
      .map((v) => ({ vlakken: naarVlakken(v.mp, redenen), band: v.band }));
    if (volumes.length) return { volumes, redenen };
  }

  // 2 — zelf oplossen.
  const componenten = gebied.componenten
    .filter((c) => operatieVan(c) !== "AGG")
    .sort((a, b) => (a.operationSequence ?? 0) - (b.operationSequence ?? 0));

  const eersteBase = componenten.findIndex((c) => operatieVan(c) === "BASE");
  const startIndex = eersteBase === -1 ? 0 : eersteBase;

  const redenen: string[] = [];
  const delen: Deel[] = [];

  componenten.forEach((component, i) => {
    // Een tweede BASE telt als UNION — zo leest de analyzer het ook
    // (aixm-ingest/parsers/airspace.py). Anders zou zo'n component wegvallen.
    const eigen = operatieVan(component);
    const operatie = i === startIndex ? "BASE" : eigen === "BASE" ? "UNION" : eigen;

    if (i !== startIndex && !OPERATIES.has(operatie)) {
      redenen.push(`operatie ${eigen || "onbekend"} wordt niet ondersteund`);
      return;
    }

    const uitkomst = delenVanComponent(component, operatie, index, bezig, onthouden);
    if (uitkomst.reden) {
      const waar = i === startIndex ? "BASE" : `${operatie} op volgnummer ${component.operationSequence ?? "?"}`;
      redenen.push(`${waar}: ${uitkomst.reden}`);
    }
    delen.push(...uitkomst.delen);
  });

  if (!delen.length) {
    return { volumes: [], redenen: redenen.length ? redenen : ["geen enkel component levert een vorm op"] };
  }

  // De basis is niet op te lossen, maar een ander component wel: dan is dat de
  // basis. Beter een vorm die een deel mist dan een lege rij in de export.
  if (!delen.some((d) => d.operatie === "BASE")) {
    const vervanger = delen.find((d) => d.operatie === "UNION");
    if (vervanger) {
      vervanger.operatie = "BASE";
      redenen.push("BASE was niet op te lossen; een ander component is als basis gebruikt");
    }
  }

  return { volumes: schijven(delen, redenen), redenen };
}

import type { Feature, Geometry } from "geojson";
import { gatenInReeks } from "./bulkNummers";
import { LARA_AREA_TYPES } from "./laraWorkbook";
import { extractTimesheets, timesheetsNaarLara } from "./laraTimesheets";
import { formatGeometryForLARA } from "./laraUtils";

/**
 * Wat er mis kan zijn met een export, vóórdat hij gedownload wordt.
 *
 * De opzet: alles wat LARA stilzwijgend anders zou opvatten, hier hardop zeggen.
 * Een gebied dat als `UNKNOWN` binnenkomt of een cirkel op de halve maat merk je
 * anders pas als iemand ernaar vliegt.
 *
 * `blokkeert` betekent niet dat de download wordt tegengehouden — dat zou de
 * gebruiker alleen maar dwingen het buiten de tool om te doen. Het betekent: dit
 * levert gegarandeerd een verkeerde of onvolledige import op.
 */

export type Ernst = "blokkeert" | "let op" | "in orde";

export type Bevinding = {
  ernst: Ernst;
  /** Korte kop, zoals hij in de lijst staat. */
  kop: string;
  /** Uitleg in gewone taal; mag leeg zijn als de kop genoeg zegt. */
  toelichting?: string;
  /** Designators waar het om gaat, voor het uitklappen. */
  gebieden?: string[];
};

export type BevindingGebied = {
  laraAreaId: number | null;
  ident: string;
  type: string | null;
  geometryStatus: string | null;
  xmlSnippet: string | null;
  /** De leesbare geometrietekst; nodig om een cirkel als cirkel te herkennen. */
  geometry?: string | null;
  volumes: {
    lowerlimit: number | null;
    lowerunit: string | null;
    upperlimit: number | null;
    upperunit: string | null;
    geojson: unknown;
  }[];
};

/**
 * Levert dit volume coördinaten op?
 *
 * Met dezelfde functie die de export gebruikt, niet met "is er een geojson".
 * Dat verschil is niet theoretisch: een gebied waarvan AIXM maar twee punten
 * geeft heeft wél een geometrie (een LineString) maar geen vlak, en komt dus met
 * een lege kolom Coordinates in het werkboek. In het bestand van 3 september 2026
 * overkomt dat EHTRA14B en EBTRANB.
 */
const heeftCoordinaten = (gebied: BevindingGebied, volume: BevindingGebied["volumes"][number]) =>
  Boolean(
    formatGeometryForLARA(
      gebied.geometry ?? null,
      (volume.geojson as Feature<Geometry> | null) ?? null
    )
  );

/** Hoogte in voet, om onder- en bovengrens te kunnen vergelijken. */
const inVoet = (waarde: number | null, eenheid: string | null): number | null => {
  if (waarde === null) return null;
  const e = (eenheid ?? "").toUpperCase();
  if (e === "FL") return waarde * 100;
  if (e === "M") return waarde * 3.28084;
  return waarde;
};

export function bepaalBevindingen(gebieden: BevindingGebied[]): Bevinding[] {
  const bevindingen: Bevinding[] = [];
  const noem = (lijst: BevindingGebied[]) => lijst.map((g) => g.ident).sort();

  // --- blokkerend --------------------------------------------------------

  const zonderId = gebieden.filter((g) => g.laraAreaId === null);
  if (zonderId.length) {
    bevindingen.push({
      ernst: "blokkeert",
      kop: `${zonderId.length} ${zonderId.length === 1 ? "gebied staat" : "gebieden staan"} in de lijst zonder Area ID`,
      toelichting:
        "Area ID is verplicht in LARA. Deze rijen komen zonder nummer in het werkboek en worden bij de import overgeslagen.",
      gebieden: noem(zonderId),
    });
  }

  const zonderVorm = gebieden.filter((g) => !g.volumes.some((v) => heeftCoordinaten(g, v)));
  if (zonderVorm.length) {
    bevindingen.push({
      ernst: "blokkeert",
      kop: `${zonderVorm.length} ${zonderVorm.length === 1 ? "gebied levert" : "gebieden leveren"} geen coördinaten op`,
      toelichting:
        "De kolom Coordinates blijft leeg en LARA weigert de rij. Meestal geeft AIXM te weinig punten voor een vlak, of verwijst het gebied naar een ander gebied dat zelf geen vorm heeft.",
      gebieden: noem(zonderVorm),
    });
  }

  // Losse volumes zonder vorm binnen een gebied dat verder wél coördinaten heeft.
  const deelsZonderVorm = gebieden.filter(
    (g) =>
      g.volumes.some((v) => heeftCoordinaten(g, v)) &&
      g.volumes.some((v) => !heeftCoordinaten(g, v))
  );
  if (deelsZonderVorm.length) {
    bevindingen.push({
      ernst: "blokkeert",
      kop: `${deelsZonderVorm.length} ${deelsZonderVorm.length === 1 ? "gebied heeft" : "gebieden hebben"} een volume zonder coördinaten`,
      toelichting: "Die volumerij komt leeg in sheet 2 en wordt door LARA overgeslagen.",
      gebieden: noem(deelsZonderVorm),
    });
  }

  // LARA weigert een volume waarvan de ondergrens niet lager ligt dan de boven-
  // grens (§ 2.3.2.2). Dat is geen waarschuwing maar een geweigerde rij.
  const omgekeerd = gebieden.filter((g) =>
    g.volumes.some((v) => {
      const onder = inVoet(v.lowerlimit, v.lowerunit);
      const boven = inVoet(v.upperlimit, v.upperunit);
      return onder !== null && boven !== null && onder >= boven;
    })
  );
  if (omgekeerd.length) {
    bevindingen.push({
      ernst: "blokkeert",
      kop: `${omgekeerd.length} ${omgekeerd.length === 1 ? "gebied heeft" : "gebieden hebben"} een ondergrens die niet lager is dan de bovengrens`,
      toelichting: "LARA importeert zo'n volume niet.",
      gebieden: noem(omgekeerd),
    });
  }

  // --- let op ------------------------------------------------------------

  const grensMist = gebieden.filter((g) => g.geometryStatus === "partial");
  if (grensMist.length) {
    bevindingen.push({
      ernst: "let op",
      kop: `${grensMist.length} ${grensMist.length === 1 ? "gebied volgt" : "gebieden volgen"} een landsgrens die ontbreekt`,
      toelichting:
        "De zijde langs de grens is een rechte lijn geworden. De coördinaten komen dus wél binnen, maar het gebied heeft de verkeerde vorm.",
      gebieden: noem(grensMist),
    });
  }

  const onbekendType = gebieden.filter(
    (g) => g.type && !LARA_AREA_TYPES.has(g.type.toUpperCase())
  );
  if (onbekendType.length) {
    const types = Array.from(new Set(onbekendType.map((g) => g.type))).sort();
    bevindingen.push({
      ernst: "let op",
      kop: `${onbekendType.length} ${onbekendType.length === 1 ? "gebied heeft" : "gebieden hebben"} een type dat LARA niet kent`,
      toelichting: `LARA maakt daar stilzwijgend UNKNOWN van. Het gaat om: ${types.join(", ")}.`,
      gebieden: noem(onbekendType),
    });
  }

  const zonderType = gebieden.filter((g) => !g.type);
  if (zonderType.length) {
    bevindingen.push({
      ernst: "let op",
      kop: `${zonderType.length} ${zonderType.length === 1 ? "gebied heeft" : "gebieden hebben"} geen type`,
      toelichting: "Type is verplicht; zonder waarde wordt het UNKNOWN.",
      gebieden: noem(zonderType),
    });
  }

  const meerVolumes = gebieden.filter((g) => g.volumes.length > 1);
  if (meerVolumes.length) {
    const totaal = gebieden.reduce((n, g) => n + g.volumes.length, 0);
    bevindingen.push({
      ernst: "let op",
      kop: `${meerVolumes.length} ${meerVolumes.length === 1 ? "gebied bestaat" : "gebieden bestaan"} uit meerdere volumes`,
      toelichting: `Sheet 2 krijgt daardoor ${totaal} rijen voor ${gebieden.length} gebieden. Controleer of LARA ze als losse lagen overneemt.`,
      gebieden: noem(meerVolumes),
    });
  }

  // Timesheets die niet vertaald konden worden — vooral feestdagen.
  const zonderTimesheet: BevindingGebied[] = [];
  const overgeslagen = new Map<string, string[]>();
  for (const gebied of gebieden) {
    const uit = timesheetsNaarLara(extractTimesheets(gebied.xmlSnippet));
    if (!uit.rijen.length) zonderTimesheet.push(gebied);
    for (const over of uit.overgeslagen) {
      const lijst = overgeslagen.get(over.reden) ?? [];
      lijst.push(gebied.ident);
      overgeslagen.set(over.reden, lijst);
    }
  }
  for (const [reden, idents] of overgeslagen) {
    bevindingen.push({
      ernst: "let op",
      kop: `${idents.length} timesheet${idents.length === 1 ? "" : "s"} overgeslagen`,
      toelichting: reden,
      gebieden: Array.from(new Set(idents)).sort(),
    });
  }
  if (zonderTimesheet.length) {
    bevindingen.push({
      ernst: "let op",
      kop: `${zonderTimesheet.length} ${zonderTimesheet.length === 1 ? "gebied krijgt" : "gebieden krijgen"} geen timesheet`,
      toelichting:
        "Zonder rij in sheet 3 legt LARA geen openstellingstijden vast. Controleer of dat klopt voor deze gebieden.",
      gebieden: noem(zonderTimesheet),
    });
  }

  const gaten = gatenInReeks(gebieden.map((g) => g.laraAreaId));
  if (gaten.length) {
    bevindingen.push({
      ernst: "let op",
      kop: `Gaten in de nummering: ${gaten.slice(0, 10).join(", ")}${gaten.length > 10 ? "…" : ""}`,
      toelichting: "Dat mag, maar controleer of het bedoeld is.",
    });
  }

  // --- in orde -----------------------------------------------------------

  const cirkels = gebieden.filter((g) => g.volumes.length > 0).length;
  if (cirkels && !bevindingen.some((b) => b.ernst === "blokkeert")) {
    bevindingen.push({
      ernst: "in orde",
      kop: `${gebieden.length} gebieden klaar voor export`,
      toelichting: "Alle verplichte velden zijn gevuld.",
    });
  }

  return bevindingen;
}

/** Kort overzicht voor de knop en de balk boven de lijst. */
export function telBevindingen(bevindingen: Bevinding[]) {
  return {
    blokkeert: bevindingen.filter((b) => b.ernst === "blokkeert").length,
    letOp: bevindingen.filter((b) => b.ernst === "let op").length,
  };
}

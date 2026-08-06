import ExcelJS from "exceljs";
import type { Feature, Geometry } from "geojson";
import { formatGeometryForLARA, type LaraAltitude } from "./laraUtils";
import { extractTimesheets, timesheetsNaarLara, type LaraTimesheetRij } from "./laraTimesheets";
import {
  AREA_STANDAARDWAARDEN,
  KLEUR_OPTIONEEL,
  KOLOMMEN_AREAS,
  KOLOMMEN_TIMESHEETS,
  KOLOMMEN_VOLUMES,
  type Kolom,
} from "./laraKolommen";

/**
 * Het LARA-importwerkboek bouwen.
 *
 * Volgt `documents/LARA V4.0 Excel Airspace Import Format.pdf`, met de opmaak
 * van de meegeleverde template: dezelfde koppen, dezelfde volgorde, dezelfde
 * kolombreedtes, en de groene kop op optionele kolommen.
 *
 * Alle 35 kolommen worden geschreven, ook al mogen de optionele volgens § 2.1.4
 * weggelaten worden. Reden: het werkboek moet naast het bestand kunnen liggen
 * dat er nu draait. Een export met acht kolommen is niet te vergelijken met een
 * van vijfendertig, en dat maakt controleren lastiger dan nodig.
 *
 * Eén ding wijkt bewust af van de bestaande export: `Type` komt uit AIXM in
 * plaats van altijd `R`. De specificatie noemt het veld verplicht en zegt dat
 * een onbekende waarde `UNKNOWN` wordt — een TRA als `R` wegschrijven is dus
 * geen opmaakkeuze maar een fout.
 *
 * Geen lege werkbladen: § 2.1.1 zegt dat een bestand niet alle bladen hoeft te
 * bevatten, en zes lege sheets voegen niets toe.
 */

/** De 21 Area Types die LARA kent, uit de sheet `Options` van de template. */
export const LARA_AREA_TYPES = new Set([
  "TSA", "TRA", "D", "RCA", "P", "RVA", "MTA", "R", "MRA", "FIR", "PIR", "UIR",
  "ES", "CS", "CTA", "TMA", "UTA", "CTR", "OCA", "CBA", "UNKNOWN",
]);

/**
 * Straal → de waarde die in de kolom `Coordinates` van een cirkel komt.
 *
 * De specificatie en de template zeggen allebei **diameter**; AIXM levert een
 * straal en de brontool schrijft die ongewijzigd weg. Zolang dat niet bevestigd
 * is bij de LARA-beheerder houden we de bestaande praktijk aan — anders
 * verandert stilzwijgend de maat van 848 gebieden.
 *
 * Blijkt diameter juist, dan is dit de enige plek die hoeft te wijzigen:
 * `return straalNm * 2`.
 *
 * Zie docs/TESTPLAN.md § 2.
 */
export const CIRKELMAAT: "straal" | "diameter" = "straal";

export function cirkelmaatNm(straalNm: number): number {
  return CIRKELMAAT === "diameter" ? straalNm * 2 : straalNm;
}

export type ExportGebied = {
  laraAreaId: number | null;
  ident: string;
  name: string | null;
  type: string | null;
  uuid: string | null;
  /** Geldigheid van de actieve timeslice; leeg betekent: de vaste terugval. */
  validTimeBegin: string | null;
  validTimeEnd: string | null;
  geometry: string | null;
  xmlSnippet: string | null;
  volumes: {
    operationSequence: number | null;
    lowerlimit: number | null;
    lowerunit: string | null;
    upperlimit: number | null;
    upperunit: string | null;
    geojson: Feature<Geometry> | null;
  }[];
};

export type WorkbookOpties = {
  /** De verantwoordelijke Airspace Manageable Cell. Verplicht veld in LARA. */
  amc: string;
  /** Terugval als de timeslice geen geldigheid opgeeft. */
  standaardStartDatum: string;
  standaardEindDatum: string;
};

export const STANDAARD_OPTIES: WorkbookOpties = {
  amc: "EHMCZAMC",
  standaardStartDatum: "01/01/2018",
  standaardEindDatum: "31/12/2036",
};

/**
 * `2026-08-06T00:00:00` → `06/08/2026`. Ongeldige of lege invoer geeft null.
 *
 * De datum wordt uit de tekst gelezen, niet via `new Date()`. AIXM schrijft
 * tijdstippen zonder tijdzone (`2025-07-10T00:00:00`); JavaScript leest die als
 * lokale tijd, en wie hem dan als UTC uitschrijft verliest in de zomer een dag.
 * Voor een geldigheidsdatum telt de kalenderdag, niet het tijdstip.
 */
export function naarLaraDatum(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const kalender = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (kalender) return `${kalender[3]}/${kalender[2]}/${kalender[1]}`;

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const dag = String(d.getUTCDate()).padStart(2, "0");
  const maand = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dag}/${maand}/${d.getUTCFullYear()}`;
}

/**
 * Hoogte naar de vorm die sheet 2 wil: een getal met `FL`/`ft`, of het woord
 * `GND` / `UNL`. § 2.3.2.2 staat die woorden expliciet toe, en `GND` leest
 * aanzienlijk beter dan `0 ft`.
 */
export function naarLaraHoogte(alt: LaraAltitude | null): { waarde: number | string; eenheid: string } {
  if (!alt) return { waarde: "", eenheid: "" };
  if (alt.unit === "ft" && alt.alt === 0) return { waarde: "GND", eenheid: "ft" };
  // Als getal, niet als tekst: een hoogte is een waarde en LARA leest hem zo.
  return { waarde: alt.alt, eenheid: alt.unit };
}

/**
 * De kopregel met de opmaak uit de template: breedtes per kolom en een groene
 * vulling op alles wat optioneel is. Vet is toegevoegd — de template heeft dat
 * niet, maar zonder onderscheid leest een kopregel van 35 kolommen slecht.
 */
const kopRij = (ws: ExcelJS.Worksheet, kolommen: Kolom[]) => {
  ws.columns = kolommen.map((k) => ({ width: k.breedte }));
  const rij = ws.addRow(kolommen.map((k) => k.kop));
  rij.font = { bold: true };

  kolommen.forEach((kolom, i) => {
    if (kolom.verplicht) return;
    rij.getCell(i + 1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: KLEUR_OPTIONEEL },
    };
  });

  ws.views = [{ state: "frozen", ySplit: 1 }];
};

/**
 * De cirkelwaarde uit een geometrietekst halen en zonodig omrekenen.
 *
 * `formatGeometryForLARA` levert `"<middelpunt>;5NM"` met de straal uit AIXM.
 * Hier gaat die door `cirkelmaatNm`, zodat er precies één plek is waar de
 * straal-of-diameterkeuze valt.
 */
function pasCirkelmaatToe(coordinates: string): string {
  const match = /^(.*);(\d+(?:\.\d+)?)NM$/.exec(coordinates);
  if (!match) return coordinates;
  const maat = cirkelmaatNm(Number(match[2]));
  const net = Number.isInteger(maat) ? String(maat) : maat.toFixed(2).replace(/\.?0+$/, "");
  return `${match[1]};${net}NM`;
}

export type WorkbookResultaat = {
  buffer: ArrayBuffer;
  rijen: { areas: number; volumes: number; timesheets: number };
  /** Timesheets die niet vertaald konden worden, per gebied. */
  overgeslagenTimesheets: { ident: string; day: string; reden: string }[];
};

export async function bouwLaraWorkbook(
  gebieden: ExportGebied[],
  opties: WorkbookOpties = STANDAARD_OPTIES
): Promise<WorkbookResultaat> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "LARA Areas";
  wb.created = new Date();

  const wsAreas = wb.addWorksheet("Areas");
  const wsVolumes = wb.addWorksheet("Area Volumes");
  const wsTimesheets = wb.addWorksheet("Area Timesheets");
  kopRij(wsAreas, KOLOMMEN_AREAS);
  kopRij(wsVolumes, KOLOMMEN_VOLUMES);
  kopRij(wsTimesheets, KOLOMMEN_TIMESHEETS);

  const overgeslagenTimesheets: WorkbookResultaat["overgeslagenTimesheets"] = [];
  let volumeRijen = 0;
  let timesheetRijen = 0;

  // Op Area ID, zodat het werkboek leest zoals de lijst op het scherm.
  const gesorteerd = [...gebieden].sort(
    (a, b) => (a.laraAreaId ?? Number.MAX_SAFE_INTEGER) - (b.laraAreaId ?? Number.MAX_SAFE_INTEGER)
  );

  for (const gebied of gesorteerd) {
    const areaId = gebied.laraAreaId ?? "";
    const start = naarLaraDatum(gebied.validTimeBegin) ?? opties.standaardStartDatum;
    const eind = naarLaraDatum(gebied.validTimeEnd) ?? opties.standaardEindDatum;

    const std = AREA_STANDAARDWAARDEN;
    wsAreas.addRow([
      areaId,                       // Area ID
      gebied.ident,                 // Area Name
      gebied.name ?? "",            // Full Name
      gebied.ident,                 // FMTP Name — gelijk aan Area Name
      std.sendOverFmtp,
      gebied.uuid ?? "",            // UUID; leeg laten mag, LARA maakt er dan een
      std.aupUup,
      std.notamEnabled,
      "", "", "", "",               // NOTAM-intervallen en -eenheden
      "", "", "", "",               // NOTAM purposes, code group, scope, traffic
      gebied.type ?? "",            // Type — uit AIXM, niet altijd R
      opties.amc,
      start,
      eind,
      std.referenceAllocation,
      std.dailyRefAlloc,
      std.appliesByDefault,
      std.manageabilityType,
      std.activationType,
      std.autoRelease,
      std.pendingTime,
      std.releasePending,
      std.beforeBuffer,
      std.afterBuffer,
      std.betweenBuffer,
      std.belowBuffer,
      std.belowUnit,
      std.aboveBuffer,
      std.aboveUnit,
    ]);

    // Sheet 2: één rij per volume. Een gebied dat uit meerdere volumes bestaat
    // krijgt er dus meerdere — dat is precies wat de brontool verloor.
    for (const volume of gebied.volumes) {
      const vorm = formatGeometryForLARA(gebied.geometry, volume.geojson);
      const onder = naarLaraHoogte(
        volume.lowerlimit === null
          ? null
          : { alt: volume.lowerlimit, unit: (volume.lowerunit ?? "ft").toUpperCase() === "FL" ? "FL" : "ft" }
      );
      const boven = naarLaraHoogte(
        volume.upperlimit === null
          ? null
          : { alt: volume.upperlimit, unit: (volume.upperunit ?? "ft").toUpperCase() === "FL" ? "FL" : "ft" }
      );

      wsVolumes.addRow([
        areaId,
        onder.waarde,
        onder.eenheid,
        boven.waarde,
        boven.eenheid,
        vorm?.volumeType ?? "",
        vorm ? (vorm.volumeType === "Circle" ? pasCirkelmaatToe(vorm.coordinates) : vorm.coordinates) : "",
      ]);
      volumeRijen += 1;
    }

    // Sheet 3: uit de activaties in het bewaarde AIXM-fragment.
    const { rijen, overgeslagen } = timesheetsNaarLara(extractTimesheets(gebied.xmlSnippet));
    for (const ts of rijen as LaraTimesheetRij[]) {
      wsTimesheets.addRow([areaId, start, eind, ts.startTime, ts.endTime, ts.dayFrom, ts.dayTil]);
      timesheetRijen += 1;
    }
    for (const over of overgeslagen) {
      overgeslagenTimesheets.push({ ident: gebied.ident, ...over });
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return {
    buffer: buffer as ArrayBuffer,
    rijen: { areas: gesorteerd.length, volumes: volumeRijen, timesheets: timesheetRijen },
    overgeslagenTimesheets,
  };
}

/** `LARAV4_2608_20260806.xlsx` — AIRAC en exportdatum, zodat een download te herleiden is. */
export function exportBestandsnaam(airac: string, extensie: string, nu = new Date()): string {
  const datum =
    `${nu.getFullYear()}` +
    `${String(nu.getMonth() + 1).padStart(2, "0")}` +
    `${String(nu.getDate()).padStart(2, "0")}`;
  return `LARAV4_${airac}_${datum}.${extensie}`;
}

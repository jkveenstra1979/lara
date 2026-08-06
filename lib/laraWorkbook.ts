import ExcelJS from "exceljs";
import type { Feature, Geometry } from "geojson";
import { formatGeometryForLARA, type LaraAltitude } from "./laraUtils";
import { extractTimesheets, timesheetsNaarLara, type LaraTimesheetRij } from "./laraTimesheets";

/**
 * Het LARA-importwerkboek bouwen.
 *
 * Volgt `documents/LARA V4.0 Excel Airspace Import Format.pdf`. Twee dingen
 * werken anders dan in de brontool, allebei omdat de specificatie het toestaat:
 *
 *   * **Alleen de zes verplichte kolommen plus wat uit AIXM komt.** § 2.1.3 zegt
 *     dat lege optionele velden een standaardwaarde uit LARA's eigen
 *     `housekeeperSettings.gsdk` krijgen, en § 2.1.4 dat optionele kolommen
 *     helemaal weg mogen. De brontool vult 34 kolommen met verzonnen waarden en
 *     overschrijft daarmee wat de beheerder in LARA heeft ingesteld.
 *
 *   * **Geen lege werkbladen.** § 2.1.1: het bestand hoeft niet alle bladen te
 *     bevatten.
 *
 * De kolomkoppen komen letterlijk uit de meegeleverde template, inclusief de
 * formaataanwijzing tussen haakjes — § 2.1.4 zegt dat het formaat in de kop
 * staat, dus die moet erbij.
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

const KOP_AREAS = [
  "Area ID",
  "Area Name",
  "Full Name",
  "UUID",
  "Type",
  "AMC",
  "Start Date (dd/MM/yyyy)",
  "End Date (dd/MM/yyyy)",
];

const KOP_VOLUMES = [
  "Area ID",
  "Lower Alt",
  "Lower Unit (FL/ft)",
  "Upper Alt",
  "Upper Unit (FL/ft)",
  "Volume Type (Straight Lines / Circle)",
  "Coordinates (Degrees, minutes, seconds, or decimal degrees separated by a semi-colon (straight lines) or centre-point in degrees, minutes, seconds or decimal degrees followed by diameter in nautical miles (circle))",
];

const KOP_TIMESHEETS = [
  "Area ID",
  "Start Date (dd/MM/yyyy)",
  "End Date  (dd/MM/yyyy)",
  "Start Time (HH:mm)",
  "End Time (HH:mm)",
  "Day From (MON/TUE/..etc)",
  "Day Til (MON/TUE/..etc)",
];

const kopRij = (ws: ExcelJS.Worksheet, koppen: string[]) => {
  ws.addRow(koppen).font = { bold: true };
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
  kopRij(wsAreas, KOP_AREAS);
  kopRij(wsVolumes, KOP_VOLUMES);
  kopRij(wsTimesheets, KOP_TIMESHEETS);

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

    wsAreas.addRow([
      areaId,
      gebied.ident,
      gebied.name ?? "",
      gebied.uuid ?? "",
      gebied.type ?? "",
      opties.amc,
      start,
      eind,
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

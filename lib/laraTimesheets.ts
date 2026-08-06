/**
 * AIXM-activaties omzetten naar rijen voor sheet 3 (`Area Timesheets`).
 *
 * Waarom dit hier staat en niet in de parser: `parseActivations` in
 * `aixmParser.ts` leest `slice.activation`, maar de velden zitten een niveau
 * dieper in `AirspaceActivation`. Het resultaat is een lege lijst — geverifieerd
 * met het voorbeeld uit de LVNL-mail. De parser is ongewijzigd overgenomen uit de
 * brontool en blijft dat; deze module haalt de timesheets uit het XML-fragment
 * dat bij de import toch al per gebied wordt bewaard.
 *
 * De vertaalregels staan in docs/TESTPLAN.md § 4.
 */

export type AixmTimesheet = {
  day: string;
  startTime: string;
  endTime: string;
  /** `DD-MM`, jaarlijks terugkerend — niet het levensduurbereik. */
  startDate?: string;
  endDate?: string;
  excluded?: string;
};

export type LaraTimesheetRij = {
  dayFrom: string;
  dayTil: string;
  startTime: string;
  endTime: string;
};

export type TimesheetUitkomst = {
  rijen: LaraTimesheetRij[];
  /** Timesheets die niet vertaald konden worden, met de reden. */
  overgeslagen: { day: string; reden: string }[];
};

/**
 * Dagnamen zoals de **specificatie** ze voorschrijft (§ 2.4.2.4).
 *
 * De meegeleverde template schrijft op drie plekken `TUE` en `THU`. Wij volgen
 * het document; de discrepantie staat in het testplan en is één regel om te
 * wisselen mocht LARA de template volgen.
 */
export const LARA_DAGEN = ["MON", "TUES", "WED", "THUR", "FRI", "SAT", "SUN"] as const;

const AIXM_NAAR_LARA: Record<string, string> = {
  MON: "MON",
  TUE: "TUES",
  WED: "WED",
  THU: "THUR",
  FRI: "FRI",
  SAT: "SAT",
  SUN: "SUN",
};

/** Een etmaal loopt in AIXM tot `00:00`; LARA eist een eindtijd ná de starttijd. */
export function normaliseerEindtijd(startTime: string, endTime: string): string {
  const eind = (endTime ?? "").trim();
  if (eind === "00:00" || eind === "0:00" || eind === "") return "24:00";
  return eind;
}

const geldigeTijd = (t: string) => /^\d{1,2}:\d{2}$/.test((t ?? "").trim());

/**
 * Eén AIXM-timesheet naar nul of meer LARA-rijen.
 *
 * `ANY` en `WORK_DAY` worden een dagbereik. Losse dagen worden een bereik van
 * één dag — LARA staat niet toe dat `Day Til` vóór `Day From` ligt, dus een
 * omlopende reeks bestaat niet.
 */
export function timesheetNaarLara(ts: AixmTimesheet): TimesheetUitkomst {
  const dag = (ts.day ?? "").trim().toUpperCase();
  const startTime = (ts.startTime ?? "").trim() || "00:00";
  const endTime = normaliseerEindtijd(startTime, ts.endTime);

  if (!geldigeTijd(startTime) || !geldigeTijd(endTime)) {
    return { rijen: [], overgeslagen: [{ day: dag, reden: `Onbruikbare tijd ${startTime}–${endTime}.` }] };
  }

  // Een timesheet die een periode uitzondert in plaats van vastlegt kunnen we
  // niet omkeren; LARA kent geen "behalve".
  if ((ts.excluded ?? "").trim().toUpperCase() === "YES") {
    return { rijen: [], overgeslagen: [{ day: dag, reden: "Timesheet is een uitzondering (excluded=YES)." }] };
  }

  if (dag === "ANY") {
    return { rijen: [{ dayFrom: "MON", dayTil: "SUN", startTime, endTime }], overgeslagen: [] };
  }
  if (dag === "WORK_DAY" || dag === "WORKDAY") {
    return { rijen: [{ dayFrom: "MON", dayTil: "FRI", startTime, endTime }], overgeslagen: [] };
  }
  if (dag === "HOL" || dag === "HOLIDAY") {
    // Geen equivalent in Day From / Day Til. Bewust niet benaderd: of LARA
    // feestdagen kent is onbekend. Zie TESTPLAN § 4.2.
    return {
      rijen: [],
      overgeslagen: [{ day: dag, reden: "Feestdag — LARA kent geen dagwaarde hiervoor." }],
    };
  }

  const lara = AIXM_NAAR_LARA[dag];
  if (!lara) {
    return { rijen: [], overgeslagen: [{ day: dag, reden: `Onbekende dagwaarde ${dag || "(leeg)"}.` }] };
  }
  return { rijen: [{ dayFrom: lara, dayTil: lara, startTime, endTime }], overgeslagen: [] };
}

/** Alle timesheets van een gebied, ontdubbeld — AIXM herhaalt ze vaak per activiteit. */
export function timesheetsNaarLara(lijst: AixmTimesheet[]): TimesheetUitkomst {
  const rijen: LaraTimesheetRij[] = [];
  const overgeslagen: { day: string; reden: string }[] = [];
  const gezien = new Set<string>();

  for (const ts of lijst) {
    const uitkomst = timesheetNaarLara(ts);
    for (const rij of uitkomst.rijen) {
      const sleutel = `${rij.dayFrom}|${rij.dayTil}|${rij.startTime}|${rij.endTime}`;
      if (gezien.has(sleutel)) continue;
      gezien.add(sleutel);
      rijen.push(rij);
    }
    overgeslagen.push(...uitkomst.overgeslagen);
  }

  return { rijen, overgeslagen };
}

/**
 * Timesheets uit een AIXM-fragment.
 *
 * Bewust met reguliere expressies in plaats van een XML-parser: het gaat om een
 * fragment dat al uit een geparseerd bestand komt, de structuur is vlak, en zo
 * blijft de import één doorloop zonder tweede parse van 96 MB.
 */
export function extractTimesheets(fragment: string | null | undefined): AixmTimesheet[] {
  if (!fragment) return [];
  const uit: AixmTimesheet[] = [];

  for (const blok of fragment.matchAll(/<(?:\w+:)?Timesheet\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Timesheet>/g)) {
    const inhoud = blok[1];
    const veld = (naam: string) => {
      const m = new RegExp(`<(?:\\w+:)?${naam}>([^<]*)</(?:\\w+:)?${naam}>`).exec(inhoud);
      return m ? m[1].trim() : undefined;
    };
    const day = veld("day");
    if (!day) continue;
    uit.push({
      day,
      startTime: veld("startTime") ?? "00:00",
      endTime: veld("endTime") ?? "00:00",
      startDate: veld("startDate"),
      endDate: veld("endDate"),
      excluded: veld("excluded"),
    });
  }

  return uit;
}

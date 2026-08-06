/**
 * De kolommen van het LARA-werkboek, precies zoals de officiële template ze
 * heeft: dezelfde koppen, dezelfde volgorde, dezelfde breedtes en dezelfde
 * kleurcodering.
 *
 * Die kleur blijkt betekenis te hebben. In de template zijn zes koppen wit en de
 * rest groen, en dat komt exact overeen met wat de specificatie `[MANDATORY]`
 * en `[OPTIONAL]` noemt. Groen is dus "mag leeg".
 *
 * Waarom alle 35 kolommen en niet alleen de verplichte: een werkboek dat er
 * anders uitziet dan het bestand dat er nu draait, is bij het naast elkaar
 * leggen niet te vergelijken. De optionele kolommen krijgen de waarden die de
 * bestaande export ook schrijft — die zijn in gebruik en werken.
 */

export type Kolom = {
  kop: string;
  /** Kolombreedte in Excel-eenheden, uit de template. */
  breedte: number;
  /** Verplicht volgens de specificatie; in de template wit in plaats van groen. */
  verplicht?: boolean;
};

/** Groen uit de template: FF008000. */
export const KLEUR_OPTIONEEL = "FF008000";

export const KOLOMMEN_AREAS: Kolom[] = [
  { kop: "Area ID", breedte: 7.4, verplicht: true },
  { kop: "Area Name", breedte: 10.9, verplicht: true },
  { kop: "Full Name", breedte: 10.0 },
  { kop: "FMTP Name", breedte: 11.6 },
  { kop: "Send Over FMTP (YES/NO)", breedte: 24.4 },
  { kop: "UUID", breedte: 38.1 },
  { kop: "AUP/UUP (YES/NO)", breedte: 18.1 },
  { kop: "NOTAM Enabled (YES/NO/INTERVAL)", breedte: 34.3 },
  { kop: "Lower NOTAM Interval", breedte: 21.4 },
  { kop: "Lower NOTAM Unit (FL/ft)", breedte: 24.3 },
  { kop: "Upper NOTAM Interval", breedte: 21.4 },
  { kop: "Upper NOTAM Unit (FL/ft)", breedte: 24.3 },
  { kop: "NOTAM Purposes (NBOM)", breedte: 24.4 },
  { kop: "NOTAM Code Group (4 letters)", breedte: 28.4 },
  { kop: "NOTAM Scope (E/W/A)", breedte: 21.7 },
  { kop: "NOTAM Traffic Types", breedte: 19.7 },
  { kop: "Type", breedte: 5.3, verplicht: true },
  { kop: "AMC", breedte: 10.6, verplicht: true },
  { kop: "Start Date (dd/MM/yyyy)", breedte: 23.4, verplicht: true },
  { kop: "End Date (dd/MM/yyyy)", breedte: 22.6, verplicht: true },
  { kop: "Reference Allocation (HH:mm)", breedte: 28.6 },
  { kop: "Daily Ref. Alloc. (YES/NO)", breedte: 23.9 },
  { kop: "Applies By Default (YES/NO)", breedte: 26.4 },
  { kop: "Area Manageability Type (AMA/NAM/DYNAMIC_NAM)", breedte: 50.4 },
  { kop: "Activation Type (AUTOMATIC/MANUAL/DYNAMIC)", breedte: 46.6 },
  { kop: "Auto Release (YES/NO)", breedte: 21.7 },
  { kop: "Pending Time (Mins)", breedte: 19.6 },
  { kop: "Release Pending (Mins)", breedte: 22.3 },
  { kop: "Before Buffer (HH:mm)", breedte: 21.9 },
  { kop: "After Buffer (HH:mm)", breedte: 20.3 },
  { kop: "Between Buffer (Min)", breedte: 20.6 },
  // De template schrijft "Below Buffer " met een spatie erachter; de export die
  // nu draait doet dat niet. Zonder — dat leest beter en komt overeen met wat
  // er in gebruik is.
  { kop: "Below Buffer", breedte: 13.1 },
  { kop: "Below Unit (FL/ft)", breedte: 16.9 },
  { kop: "Above Buffer", breedte: 12.7 },
  { kop: "Above Unit (FL/ft)", breedte: 17.0 },
];

export const KOLOMMEN_VOLUMES: Kolom[] = [
  { kop: "Area ID", breedte: 7.4, verplicht: true },
  { kop: "Lower Alt", breedte: 9.4, verplicht: true },
  { kop: "Lower Unit (FL/ft)", breedte: 16.7, verplicht: true },
  { kop: "Upper Alt", breedte: 9.4, verplicht: true },
  { kop: "Upper Unit (FL/ft)", breedte: 16.7, verplicht: true },
  { kop: "Volume Type (Straight Lines / Circle)", breedte: 34.0, verplicht: true },
  { kop: "Coordinates", breedte: 196.7, verplicht: true },
];

export const KOLOMMEN_TIMESHEETS: Kolom[] = [
  { kop: "Area ID", breedte: 7.4, verplicht: true },
  { kop: "Start Date (dd/MM/yyyy)", breedte: 23.4, verplicht: true },
  { kop: "End Date (dd/MM/yyyy)", breedte: 23.0, verplicht: true },
  { kop: "Start Time (HH:mm)", breedte: 18.7, verplicht: true },
  { kop: "End Time (HH:mm)", breedte: 17.9, verplicht: true },
  { kop: "Day From (MON/TUE/..etc)", breedte: 25.0, verplicht: true },
  { kop: "Day Til (MON/TUE/..etc)", breedte: 22.6, verplicht: true },
];

/**
 * De standaardwaarden voor de optionele kolommen in `Areas`.
 *
 * Overgenomen uit de export die nu in gebruik is. LARA zou bij lege velden zijn
 * eigen instellingen gebruiken (§ 2.1.3), maar deze waarden draaien aantoonbaar
 * mee — en een werkboek dat afwijkt van het bestaande is lastiger te
 * controleren dan een dat er hetzelfde uitziet.
 */
export const AREA_STANDAARDWAARDEN = {
  sendOverFmtp: "YES",
  aupUup: "YES",
  notamEnabled: "NO",
  referenceAllocation: "03:00",
  dailyRefAlloc: "NO",
  appliesByDefault: "YES",
  manageabilityType: "AMA",
  activationType: "AUTOMATIC",
  autoRelease: "NO",
  pendingTime: 30,
  releasePending: 15,
  beforeBuffer: "0",
  afterBuffer: "0",
  betweenBuffer: 0,
  belowBuffer: 0,
  belowUnit: "ft",
  aboveBuffer: 0,
  aboveUnit: "ft",
} as const;

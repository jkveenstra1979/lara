/**
 * Een geplakte lijst met Area IDs lezen.
 *
 * De brontool eist `nummer,ident` in die volgorde. Dat is één kolomvolgorde te
 * weinig: wie uit een spreadsheet plakt heeft net zo vaak de designator vooraan
 * staan. Daarom kijken we welk deel een getal is in plaats van naar de plek.
 *
 * Gescheiden door een tab, komma, puntkomma of meerdere spaties — alles wat er
 * uit Excel, Numbers of een tekstbestand komt.
 */

export type BulkRegel = {
  /** Regelnummer in de geplakte tekst, om een fout terug te kunnen wijzen. */
  regel: number;
  ident: string;
  laraAreaId: number;
};

export type BulkFout = {
  regel: number;
  tekst: string;
  reden: string;
};

export type BulkLijst = {
  toewijzingen: BulkRegel[];
  fouten: BulkFout[];
};

const SCHEIDING = /\t|;|,|\s{2,}|\s+/;

export function parseBulkLijst(ruw: string): BulkLijst {
  const toewijzingen: BulkRegel[] = [];
  const fouten: BulkFout[] = [];
  const gezienIdent = new Set<string>();
  const gezienNummer = new Set<number>();

  ruw.split(/\r?\n/).forEach((regelTekst, index) => {
    const regel = index + 1;
    const tekst = regelTekst.trim();
    if (!tekst) return;

    const delen = tekst.split(SCHEIDING).filter(Boolean);
    if (delen.length < 2) {
      fouten.push({ regel, tekst, reden: "Verwacht een designator én een nummer." });
      return;
    }

    // Welk deel is het nummer? Zo werkt zowel "1 EHR1" als "EHR1 1".
    const nummerIndex = delen.findIndex((d) => /^\d+$/.test(d));
    if (nummerIndex === -1) {
      fouten.push({ regel, tekst, reden: "Geen nummer gevonden." });
      return;
    }

    const laraAreaId = Number(delen[nummerIndex]);
    const ident = delen.filter((_, i) => i !== nummerIndex).join(" ").trim();

    if (!ident) {
      fouten.push({ regel, tekst, reden: "Geen designator gevonden." });
      return;
    }
    if (!Number.isInteger(laraAreaId) || laraAreaId <= 0) {
      fouten.push({ regel, tekst, reden: "Het nummer moet groter dan nul zijn." });
      return;
    }
    if (gezienIdent.has(ident.toUpperCase())) {
      fouten.push({ regel, tekst, reden: `${ident} staat al eerder in de lijst.` });
      return;
    }
    if (gezienNummer.has(laraAreaId)) {
      fouten.push({ regel, tekst, reden: `Nummer ${laraAreaId} staat al eerder in de lijst.` });
      return;
    }

    gezienIdent.add(ident.toUpperCase());
    gezienNummer.add(laraAreaId);
    toewijzingen.push({ regel, ident, laraAreaId });
  });

  return { toewijzingen, fouten };
}

/**
 * Het eerstvolgende vrije nummer.
 *
 * Vult gaten op in plaats van door te tellen: nummer 3 dat vrijkomt hoort weer
 * gebruikt te worden voordat de reeks doorloopt naar 43.
 */
export function volgendVrijNummer(inGebruik: Iterable<number | null>): number {
  const bezet = new Set<number>();
  for (const nummer of inGebruik) {
    if (typeof nummer === "number" && nummer > 0) bezet.add(nummer);
  }
  let kandidaat = 1;
  while (bezet.has(kandidaat)) kandidaat += 1;
  return kandidaat;
}

/**
 * Gaten in de nummering: nummers die tussen 1 en het hoogste toegekende nummer
 * ontbreken. Dat mag, maar het is bijna altijd onbedoeld — vandaar dat het
 * exportscherm er een bevinding van maakt.
 */
export function gatenInReeks(inGebruik: Iterable<number | null>): number[] {
  const bezet = new Set<number>();
  let hoogste = 0;
  for (const nummer of inGebruik) {
    if (typeof nummer === "number" && nummer > 0) {
      bezet.add(nummer);
      if (nummer > hoogste) hoogste = nummer;
    }
  }
  const gaten: number[] = [];
  for (let i = 1; i < hoogste; i += 1) {
    if (!bezet.has(i)) gaten.push(i);
  }
  return gaten;
}

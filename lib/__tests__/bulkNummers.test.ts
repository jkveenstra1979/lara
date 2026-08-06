import { describe, expect, it } from "vitest";
import { gatenInReeks, parseBulkLijst, volgendVrijNummer } from "../bulkNummers";

describe("parseBulkLijst", () => {
  it("leest nummer-eerst, zoals de brontool het schrijft", () => {
    const { toewijzingen, fouten } = parseBulkLijst("1,EHR1\n2,EHR2\n27,EHD12");

    expect(fouten).toEqual([]);
    expect(toewijzingen).toEqual([
      { regel: 1, ident: "EHR1", laraAreaId: 1 },
      { regel: 2, ident: "EHR2", laraAreaId: 2 },
      { regel: 3, ident: "EHD12", laraAreaId: 27 },
    ]);
  });

  it("leest designator-eerst net zo goed", () => {
    // Uit een spreadsheet komt de kolomvolgorde zoals hij daar staat.
    const { toewijzingen } = parseBulkLijst("EHR1\t1\nEHTRA10\t7");

    expect(toewijzingen).toEqual([
      { regel: 1, ident: "EHR1", laraAreaId: 1 },
      { regel: 2, ident: "EHTRA10", laraAreaId: 7 },
    ]);
  });

  it("slikt tabs, komma's, puntkomma's en spaties", () => {
    const { toewijzingen, fouten } = parseBulkLijst("1,EHR1\n2;EHR2\n3\tEHR3\n4   EHR4");

    expect(fouten).toEqual([]);
    expect(toewijzingen.map((t) => t.ident)).toEqual(["EHR1", "EHR2", "EHR3", "EHR4"]);
  });

  it("negeert lege regels", () => {
    const { toewijzingen, fouten } = parseBulkLijst("\n1,EHR1\n\n\n2,EHR2\n   \n");

    expect(toewijzingen).toHaveLength(2);
    expect(fouten).toEqual([]);
  });

  it("wijst een duplicaat in de plaklijst zelf af", () => {
    const { toewijzingen, fouten } = parseBulkLijst("1,EHR1\n2,EHR2\n1,EHR3");

    expect(toewijzingen).toHaveLength(2);
    expect(fouten).toHaveLength(1);
    expect(fouten[0].regel).toBe(3);
    expect(fouten[0].reden).toContain("Nummer 1 staat al eerder");
  });

  it("wijst dezelfde designator twee keer af", () => {
    const { fouten } = parseBulkLijst("1,EHR1\n2,EHR1");

    expect(fouten).toHaveLength(1);
    expect(fouten[0].reden).toContain("EHR1 staat al eerder");
  });

  it("meldt per regel wat er mis is", () => {
    const { toewijzingen, fouten } = parseBulkLijst("EHR1\n1,EHR2\nEHR3,nul\n0,EHR4");

    expect(toewijzingen).toHaveLength(1);
    expect(fouten.map((f) => f.regel)).toEqual([1, 3, 4]);
    expect(fouten[0].reden).toContain("designator én een nummer");
    expect(fouten[1].reden).toContain("Geen nummer");
    expect(fouten[2].reden).toContain("groter dan nul");
  });
});

describe("volgendVrijNummer", () => {
  it("begint bij 1 als er niets is toegekend", () => {
    expect(volgendVrijNummer([])).toBe(1);
    expect(volgendVrijNummer([null, null])).toBe(1);
  });

  it("vult een gat op in plaats van door te tellen", () => {
    // Nummer 3 is vrijgekomen; die hoort weer gebruikt te worden.
    expect(volgendVrijNummer([1, 2, 4, 5])).toBe(3);
  });

  it("telt door als er geen gaten zijn", () => {
    expect(volgendVrijNummer([1, 2, 3])).toBe(4);
  });
});

describe("gatenInReeks", () => {
  it("noemt de ontbrekende nummers onder het hoogste", () => {
    expect(gatenInReeks([1, 2, 3, 6, 7])).toEqual([4, 5]);
  });

  it("ziet geen gat boven het hoogste nummer", () => {
    expect(gatenInReeks([1, 2, 3])).toEqual([]);
  });

  it("negeert ongenummerde gebieden", () => {
    expect(gatenInReeks([1, null, 3, null])).toEqual([2]);
  });

  it("geeft niets terug bij een lege lijst", () => {
    expect(gatenInReeks([])).toEqual([]);
    expect(gatenInReeks([null])).toEqual([]);
  });
});

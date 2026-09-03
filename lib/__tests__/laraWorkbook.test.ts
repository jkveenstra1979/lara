import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { Feature, Geometry } from "geojson";
import {
  bouwLaraWorkbook,
  cirkelmaatNm,
  exportBestandsnaam,
  naarLaraDatum,
  naarLaraHoogte,
  type ExportGebied,
} from "../laraWorkbook";
import { bepaalBevindingen } from "../exportBevindingen";

const vierkant = (): Feature<Geometry> => ({
  type: "Feature",
  properties: {},
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [4, 52],
        [5, 52],
        [5, 53],
        [4, 53],
        [4, 52],
      ],
    ],
  },
});

const gebied = (over: Partial<ExportGebied> = {}): ExportGebied => ({
  laraAreaId: 1,
  ident: "EHR1",
  name: "Deelen",
  type: "R",
  uuid: "aaaaaaaa-0000-0000-0000-000000000001",
  validTimeBegin: null,
  validTimeEnd: null,
  geometry: null,
  xmlSnippet: null,
  volumes: [
    { lowerlimit: 0, lowerunit: "FT", upperlimit: 65, upperunit: "FL", geojson: vierkant() },
  ],
  ...over,
});

const lees = async (buffer: ArrayBuffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const uit: Record<string, unknown[][]> = {};
  wb.eachSheet((ws) => {
    const rijen: unknown[][] = [];
    ws.eachRow((rij) => {
      const waarden = rij.values as unknown[];
      rijen.push(waarden.slice(1));
    });
    uit[ws.name] = rijen;
  });
  return uit;
};

describe("naarLaraDatum", () => {
  it("schrijft dd/MM/yyyy", () => {
    expect(naarLaraDatum("2026-08-06T00:00:00Z")).toBe("06/08/2026");
    // Zonder tijdzone-achtervoegsel, zoals AIXM het schrijft. Via new Date()
    // zou dit in de zomer 09/07 worden.
    expect(naarLaraDatum("2025-07-10T00:00:00")).toBe("10/07/2025");
    expect(naarLaraDatum("2025-12-31T23:00:00")).toBe("31/12/2025");
  });

  it("geeft null bij niets of onzin", () => {
    expect(naarLaraDatum(null)).toBeNull();
    expect(naarLaraDatum("geen datum")).toBeNull();
  });
});

describe("naarLaraHoogte", () => {
  it("schrijft grondniveau als GND", () => {
    // De spec staat GND expliciet toe en dat leest beter dan "0 ft".
    expect(naarLaraHoogte({ alt: 0, unit: "ft" })).toEqual({ waarde: "GND", eenheid: "ft" });
  });

  it("laat FL en voet met rust", () => {
    // Als getal: LARA verwacht een waarde, geen tekst.
    expect(naarLaraHoogte({ alt: 65, unit: "FL" })).toEqual({ waarde: 65, eenheid: "FL" });
    expect(naarLaraHoogte({ alt: 3500, unit: "ft" })).toEqual({ waarde: 3500, eenheid: "ft" });
  });
});

describe("cirkelmaatNm", () => {
  it("houdt de straal aan zolang dat de afspraak is", () => {
    // De spec zegt diameter, de brontool schrijft straal. Tot dat is bevestigd
    // blijft de bestaande praktijk staan — zie docs/TESTPLAN.md § 2.
    expect(cirkelmaatNm(5)).toBe(5);
  });
});

describe("exportBestandsnaam", () => {
  it("zet AIRAC en datum in de naam", () => {
    expect(exportBestandsnaam("2608", "xlsx", new Date(2026, 7, 6))).toBe("LARAV4_2608_20260806.xlsx");
    expect(exportBestandsnaam("2608", "kml", new Date(2026, 11, 31))).toBe("LARAV4_2608_20261231.kml");
  });
});

describe("bouwLaraWorkbook", () => {
  it("maakt drie werkbladen, geen lege", async () => {
    // De spec zegt dat een bestand niet alle bladen hoeft te bevatten; zes lege
    // sheets meeleveren voegt niets toe.
    const { buffer } = await bouwLaraWorkbook([gebied()]);
    const sheets = await lees(buffer);

    expect(Object.keys(sheets)).toEqual(["Areas", "Area Volumes", "Area Timesheets"]);
  });

  it("houdt de kolomindeling van de template aan", async () => {
    // Alle 35 kolommen, in dezelfde volgorde als het bestand dat nu draait —
    // zodat de twee naast elkaar te leggen zijn.
    const { buffer } = await bouwLaraWorkbook([gebied()]);
    const sheets = await lees(buffer);
    const kop = sheets["Areas"][0];

    expect(kop).toHaveLength(35);
    expect(kop[0]).toBe("Area ID");
    expect(kop[16]).toBe("Type");
    expect(kop[17]).toBe("AMC");
    expect(kop[34]).toBe("Above Unit (FL/ft)");
  });

  it("vult de verplichte velden met wat uit AIXM komt", async () => {
    const { buffer } = await bouwLaraWorkbook([gebied()]);
    const rij = (await lees(buffer))["Areas"][1];

    expect(rij[0]).toBe(1);                                            // Area ID
    expect(rij[1]).toBe("EHR1");                                       // Area Name
    expect(rij[2]).toBe("Deelen");                                     // Full Name
    expect(rij[5]).toBe("aaaaaaaa-0000-0000-0000-000000000001");       // UUID
    expect(rij[16]).toBe("R");                                         // Type
    expect(rij[17]).toBe("EHMCZAMC");                                  // AMC
    expect(rij[18]).toBe("01/01/2018");                                // Start Date
    expect(rij[19]).toBe("31/12/2036");                                // End Date
  });

  it("vult de optionele velden zoals de bestaande export dat doet", async () => {
    const { buffer } = await bouwLaraWorkbook([gebied()]);
    const rij = (await lees(buffer))["Areas"][1];

    expect(rij[4]).toBe("YES");        // Send Over FMTP
    expect(rij[20]).toBe("03:00");     // Reference Allocation
    expect(rij[23]).toBe("AMA");       // Area Manageability Type
    expect(rij[24]).toBe("AUTOMATIC"); // Activation Type
    expect(rij[26]).toBe(30);          // Pending Time
    expect(rij[34]).toBe("ft");        // Above Unit
  });

  it("neemt het type uit AIXM over in plaats van altijd R", async () => {
    const { buffer } = await bouwLaraWorkbook([gebied({ type: "TRA", ident: "EHTRA10" })]);
    const sheets = await lees(buffer);

    expect(sheets["Areas"][1][16]).toBe("TRA");
  });

  it("gebruikt de geldigheid uit de timeslice als die er is", async () => {
    const { buffer } = await bouwLaraWorkbook([
      gebied({ validTimeBegin: "2025-07-10T00:00:00", validTimeEnd: "2027-01-01T00:00:00" }),
    ]);
    const sheets = await lees(buffer);

    expect(sheets["Areas"][1][18]).toBe("10/07/2025");
    expect(sheets["Areas"][1][19]).toBe("01/01/2027");
  });

  it("schrijft één rij per volume in sheet 2", async () => {
    const drieVolumes = gebied({
      ident: "EHTRA10",
      volumes: [
        { lowerlimit: 55, lowerunit: "FL", upperlimit: 95, upperunit: "FL", geojson: vierkant() },
        { lowerlimit: 95, lowerunit: "FL", upperlimit: 145, upperunit: "FL", geojson: vierkant() },
        { lowerlimit: 145, lowerunit: "FL", upperlimit: 195, upperunit: "FL", geojson: vierkant() },
      ],
    });
    const { buffer, rijen } = await bouwLaraWorkbook([drieVolumes]);
    const sheets = await lees(buffer);

    expect(rijen).toEqual({ areas: 1, volumes: 3, timesheets: 0 });
    expect(sheets["Area Volumes"]).toHaveLength(4); // kop + 3
    expect(sheets["Area Volumes"].slice(1).map((r) => [r[1], r[3]])).toEqual([
      [55, 95],
      [95, 145],
      [145, 195],
    ]);
  });

  it("schrijft de coördinaten in het formaat dat de spec voorschrijft", async () => {
    const { buffer } = await bouwLaraWorkbook([gebied()]);
    const sheets = await lees(buffer);
    const rij = sheets["Area Volumes"][1];

    expect(rij[5]).toBe("Straight Lines");
    // xx°xx'xx"N,xxx°xx'xx"E met puntkomma's ertussen (§ 2.3.2.7).
    expect(String(rij[6])).toMatch(/^\d{2}°\d{2}'\d{2}"[NS],\d{3}°\d{2}'\d{2}"[EW](;|$)/);
    // Gesloten ring: vijf punten voor een vierkant.
    expect(String(rij[6]).split(";")).toHaveLength(5);
  });

  it("schrijft een cirkel als middelpunt met maat", async () => {
    const cirkel = gebied({
      ident: "EHER",
      geometry: "Circle of radius 5 NM centered on:\nN 54 05 52.89 E 003 21 36.86",
      volumes: [
        { lowerlimit: 0, lowerunit: "FT", upperlimit: 2000, upperunit: "FT", geojson: null },
      ],
    });
    const { buffer } = await bouwLaraWorkbook([cirkel]);
    const sheets = await lees(buffer);
    const rij = sheets["Area Volumes"][1];

    expect(rij[5]).toBe("Circle");
    expect(String(rij[6])).toMatch(/^\d{2}°\d{2}'\d{2}"N,\d{3}°\d{2}'\d{2}"E;5NM$/);
  });

  it("schrijft grondniveau als GND", async () => {
    const { buffer } = await bouwLaraWorkbook([gebied()]);
    const sheets = await lees(buffer);

    expect(sheets["Area Volumes"][1][1]).toBe("GND");
  });

  it("maakt timesheetrijen uit het AIXM-fragment", async () => {
    const metTimesheet = gebied({
      xmlSnippet: `<aixm:Timesheet><aixm:day>ANY</aixm:day><aixm:startTime>00:00</aixm:startTime><aixm:endTime>00:00</aixm:endTime></aixm:Timesheet>`,
    });
    const { buffer, rijen } = await bouwLaraWorkbook([metTimesheet]);
    const sheets = await lees(buffer);

    expect(rijen.timesheets).toBe(1);
    expect(sheets["Area Timesheets"][1]).toEqual([
      1, "01/01/2018", "31/12/2036", "00:00", "24:00", "MON", "SUN",
    ]);
  });

  it("meldt een timesheet die niet vertaald kon worden", async () => {
    const feestdag = gebied({
      xmlSnippet: `<aixm:Timesheet><aixm:day>HOL</aixm:day><aixm:startTime>00:00</aixm:startTime><aixm:endTime>00:00</aixm:endTime></aixm:Timesheet>`,
    });
    const { overgeslagenTimesheets, rijen } = await bouwLaraWorkbook([feestdag]);

    expect(rijen.timesheets).toBe(0);
    expect(overgeslagenTimesheets[0]).toMatchObject({ ident: "EHR1", day: "HOL" });
  });

  it("sorteert op Area ID", async () => {
    const { buffer } = await bouwLaraWorkbook([
      gebied({ laraAreaId: 7, ident: "EHD42" }),
      gebied({ laraAreaId: 2, ident: "EHR2" }),
      gebied({ laraAreaId: null, ident: "EHNIEUW" }),
    ]);
    const sheets = await lees(buffer);

    expect(sheets["Areas"].slice(1).map((r) => r[1])).toEqual(["EHR2", "EHD42", "EHNIEUW"]);
  });
});

describe("bepaalBevindingen", () => {
  const bev = (over: Partial<Parameters<typeof bepaalBevindingen>[0][0]> = {}) => ({
    laraAreaId: 1,
    ident: "EHR1",
    type: "R",
    geometryStatus: "ok",
    xmlSnippet: `<aixm:Timesheet><aixm:day>ANY</aixm:day><aixm:startTime>00:00</aixm:startTime><aixm:endTime>00:00</aixm:endTime></aixm:Timesheet>`,
    volumes: [{ lowerlimit: 0, lowerunit: "FT", upperlimit: 65, upperunit: "FL", geojson: vierkant() }],
    ...over,
  });

  it("blokkeert op een gebied zonder Area ID", () => {
    const b = bepaalBevindingen([bev({ laraAreaId: null })]);
    expect(b[0].ernst).toBe("blokkeert");
    expect(b[0].kop).toContain("zonder Area ID");
  });

  it("blokkeert als de ondergrens niet lager is dan de bovengrens", () => {
    // LARA weigert zo'n volume (§ 2.3.2.2).
    const b = bepaalBevindingen([
      bev({ volumes: [{ lowerlimit: 195, lowerunit: "FL", upperlimit: 55, upperunit: "FL", geojson: vierkant() }] }),
    ]);
    expect(b.some((x) => x.ernst === "blokkeert" && x.kop.includes("ondergrens"))).toBe(true);
  });

  it("vergelijkt hoogtes over eenheden heen", () => {
    // FL 010 = 1000 ft, dus 2000 ft onder en FL 010 boven is omgekeerd.
    const b = bepaalBevindingen([
      bev({ volumes: [{ lowerlimit: 2000, lowerunit: "FT", upperlimit: 10, upperunit: "FL", geojson: vierkant() }] }),
    ]);
    expect(b.some((x) => x.kop.includes("ondergrens"))).toBe(true);
  });

  it("ziet een gebied dat te weinig punten heeft voor een vlak", () => {
    // Echt geval uit het AeroDB-bestand van 3 september 2026: EHTRA14B en
    // EBTRANB hebben in AIXM maar twee punten. Er ís een geometrie — een
    // LineString — maar geen vlak, dus de kolom Coordinates blijft leeg.
    // De controle draait daarom formatGeometryForLARA, net als de export zelf.
    const lijn = bev({
      ident: "EHTRA14B",
      volumes: [
        {
          lowerlimit: 0,
          lowerunit: "FT",
          upperlimit: 2000,
          upperunit: "FT",
          geojson: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: [[6.58, 52.88], [6.87, 52.92]] },
          },
        },
      ],
    });
    const b = bepaalBevindingen([lijn]);

    expect(b[0].ernst).toBe("blokkeert");
    expect(b[0].kop).toContain("geen coördinaten");
    expect(b[0].gebieden).toEqual(["EHTRA14B"]);
  });

  it("waarschuwt voor een type dat LARA niet kent", () => {
    const b = bepaalBevindingen([bev({ type: "HTZ" })]);
    const t = b.find((x) => x.kop.includes("type dat LARA niet kent"));
    expect(t?.ernst).toBe("let op");
    expect(t?.toelichting).toContain("HTZ");
  });

  it("accepteert de types die wél in de lijst staan", () => {
    for (const type of ["TSA", "TRA", "R", "D", "CBA", "P"]) {
      const b = bepaalBevindingen([bev({ type })]);
      expect(b.some((x) => x.kop.includes("niet kent"))).toBe(false);
    }
  });

  it("waarschuwt voor een ontbrekende landsgrens", () => {
    const b = bepaalBevindingen([bev({ geometryStatus: "partial" })]);
    expect(b.some((x) => x.kop.includes("landsgrens"))).toBe(true);
  });

  it("meldt gaten in de nummering", () => {
    const b = bepaalBevindingen([bev({ laraAreaId: 1 }), bev({ laraAreaId: 4, ident: "EHR4" })]);
    expect(b.some((x) => x.kop.includes("Gaten in de nummering: 2, 3"))).toBe(true);
  });

  it("meldt een feestdag-timesheet", () => {
    const b = bepaalBevindingen([
      bev({ xmlSnippet: `<aixm:Timesheet><aixm:day>HOL</aixm:day><aixm:startTime>00:00</aixm:startTime><aixm:endTime>00:00</aixm:endTime></aixm:Timesheet>` }),
    ]);
    expect(b.some((x) => x.toelichting?.includes("Feestdag"))).toBe(true);
  });

  it("zegt niets bijzonders als alles klopt", () => {
    const b = bepaalBevindingen([bev()]);
    expect(b.every((x) => x.ernst === "in orde")).toBe(true);
  });
});

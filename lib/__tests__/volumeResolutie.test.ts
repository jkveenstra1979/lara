import { describe, expect, it } from "vitest";
import type { Feature, Geometry } from "geojson";
import { losOp, type ComponentRij, type Index } from "../volumeResolutie";

/**
 * De aanleiding staat in het AIXM van 1 oktober 2026: vijf gebieden kwamen
 * zonder coördinaten in de export omdat hun componenten alleen verwijzingen
 * waren — soms twee stappen ver (EHAADLG35B → EHAME2 → EHMCE).
 */

const vierkant = (x: number, y: number, zijde = 1): Feature<Geometry> => ({
  type: "Feature",
  properties: {},
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [x, y],
        [x + zijde, y],
        [x + zijde, y + zijde],
        [x, y + zijde],
        [x, y],
      ],
    ],
  },
});

const component = (over: Partial<ComponentRij> = {}): ComponentRij => ({
  operation: "BASE",
  operationSequence: 1,
  geojson: null,
  derivedFrom: [],
  lowerlimit: 0,
  lowerunit: "FT",
  upperlimit: 65,
  upperunit: "FL",
  ...over,
});

/** Een index bouwen uit `id → { uuid, componenten }`. */
const index = (gebieden: Record<string, { uuid: string; componenten: ComponentRij[] }>): Index => ({
  perId: new Map(Object.entries(gebieden).map(([id, g]) => [id, { uuid: g.uuid, componenten: g.componenten }])),
  idPerUuid: new Map(Object.entries(gebieden).map(([id, g]) => [g.uuid, id])),
});

/** Alle vlakken van alle hoogtebanden, met hun aantal punten. */
const vlakkenVan = (uitkomst: ReturnType<typeof losOp>) =>
  uitkomst.volumes.flatMap((volume) =>
    volume.vlakken.map((v) => (v.geometry as { coordinates: number[][][] }).coordinates[0].length)
  );

/** Het enige volume, als de test er maar één verwacht. */
const enige = (uitkomst: ReturnType<typeof losOp>) => {
  expect(uitkomst.volumes).toHaveLength(1);
  return uitkomst.volumes[0];
};

describe("losOp", () => {
  it("neemt de AGG-rij over als de parser die al heeft gemaakt", () => {
    const i = index({
      a: {
        uuid: "u-a",
        componenten: [
          component({ operation: "AGG", operationSequence: 0, geojson: vierkant(0, 0), lowerlimit: 95, lowerunit: "FL" }),
          component({ operation: "BASE", operationSequence: 1, derivedFrom: ["onbekend"] }),
          component({ operation: "UNION", operationSequence: 2, derivedFrom: ["onbekend"] }),
        ],
      },
    });

    const uit = losOp("a", i);
    expect(enige(uit).vlakken).toHaveLength(1);
    // De hoogteband komt van de AGG-rij, niet van de losse componenten.
    expect(enige(uit).band.lowerlimit).toBe(95);
    expect(uit.redenen).toEqual([]);
  });

  it("voegt BASE en UNION samen tot één vorm", () => {
    const i = index({
      a: {
        uuid: "u-a",
        componenten: [
          component({ operation: "BASE", operationSequence: 1, geojson: vierkant(0, 0) }),
          // Sluit aan op de eerste: samen één rechthoek.
          component({ operation: "UNION", operationSequence: 2, geojson: vierkant(1, 0) }),
        ],
      },
    });

    const uit = losOp("a", i);
    expect(enige(uit).vlakken).toHaveLength(1);
    expect(uit.redenen).toEqual([]);
  });

  it("gooit een flinterdunne wig weg en zegt dat", () => {
    // Zoals EHAADLG6: twee componenten die een rand delen, maar met één
    // tussenpunt dat er tientallen meters naast ligt. De samenvoeging laat dan
    // een driehoek van kilometers lang en meters breed achter.
    const groot = vierkant(4, 51, 1);
    const wig: Feature<Geometry> = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          // De echte coördinaten van de wig bij EHAADLG6: 29,7 km lang, 23,8 m
          // breed op het breedste punt.
          [
            [6.028333333, 51.7],
            [6.4075, 51.828055556],
            [6.214075, 51.762975],
            [6.028333333, 51.7],
          ],
        ],
      },
    };
    const i = index({
      a: {
        uuid: "u-a",
        componenten: [
          component({ operation: "BASE", operationSequence: 1, geojson: groot }),
          component({ operation: "UNION", operationSequence: 2, geojson: wig }),
        ],
      },
    });

    const uit = losOp("a", i);
    expect(enige(uit).vlakken).toHaveLength(1);
    expect(uit.redenen.join(" ")).toContain("splinter");
  });

  it("laat twee echte stukken staan", () => {
    // EBTRAN2 bestaat werkelijk uit twee blokken van 51 en 153 km²; die mogen
    // niet als splinter sneuvelen.
    const i = index({
      a: {
        uuid: "u-a",
        componenten: [
          component({ operation: "BASE", operationSequence: 1, geojson: vierkant(4, 51, 0.3) }),
          component({ operation: "UNION", operationSequence: 2, geojson: vierkant(6, 51, 0.5) }),
        ],
      },
    });

    const uit = losOp("a", i);
    expect(enige(uit).vlakken).toHaveLength(2);
    expect(uit.redenen).toEqual([]);
  });

  it("houdt losse stukken uit elkaar als vlakken", () => {
    const i = index({
      a: {
        uuid: "u-a",
        componenten: [
          component({ operation: "BASE", operationSequence: 1, geojson: vierkant(0, 0) }),
          component({ operation: "UNION", operationSequence: 2, geojson: vierkant(10, 10) }),
        ],
      },
    });

    // Twee vlakken, één gebied, één hoogteband — precies wat sheet 2 nodig heeft.
    const uit = losOp("a", i);
    expect(enige(uit).vlakken).toHaveLength(2);
    expect(enige(uit).band.upperlimit).toBe(65);
  });

  it("volgt een verwijzing die zelf weer verwijst", () => {
    // EHAADLG35B → EHAME2 → EHMCE: pas de derde heeft coördinaten.
    const i = index({
      kind: { uuid: "u-kind", componenten: [component({ derivedFrom: ["u-ouder"] })] },
      ouder: { uuid: "u-ouder", componenten: [component({ derivedFrom: ["u-grootouder"] })] },
      grootouder: { uuid: "u-grootouder", componenten: [component({ geojson: vierkant(3, 51) })] },
    });

    const uit = losOp("kind", i);
    expect(vlakkenVan(uit)).toEqual([5]);
    expect(uit.redenen).toEqual([]);
  });

  it("trekt een SUBTR eraf", () => {
    const i = index({
      a: {
        uuid: "u-a",
        componenten: [
          component({ operation: "BASE", operationSequence: 1, geojson: vierkant(0, 0, 4) }),
          component({ operation: "SUBTR", operationSequence: 2, geojson: vierkant(1, 1) }),
        ],
      },
    });

    const uit = losOp("a", i);
    expect(enige(uit).vlakken).toHaveLength(1);
    // Buitenring plus het gat dat eruit is gehaald.
    const vorm = enige(uit).vlakken[0].geometry as { coordinates: number[][][] };
    expect(vorm.coordinates).toHaveLength(2);
  });

  it("loopt niet vast in een kring", () => {
    const i = index({
      a: { uuid: "u-a", componenten: [component({ derivedFrom: ["u-b"] })] },
      b: { uuid: "u-b", componenten: [component({ derivedFrom: ["u-a"] })] },
    });

    const uit = losOp("a", i);
    expect(uit.volumes).toEqual([]);
    expect(uit.redenen.join(" ")).toContain("keten");
  });

  it("zegt waarom het niet lukte als een verwijzing buiten de dataset valt", () => {
    const i = index({ a: { uuid: "u-a", componenten: [component({ derivedFrom: ["u-weg"] })] } });

    const uit = losOp("a", i);
    expect(uit.volumes).toEqual([]);
    expect(uit.redenen.join(" ")).toContain("niet in de dataset");
  });

  it("gebruikt een ander component als basis wanneer BASE niet oplost", () => {
    const i = index({
      a: {
        uuid: "u-a",
        componenten: [
          component({ operation: "BASE", operationSequence: 1, derivedFrom: ["u-weg"] }),
          component({ operation: "UNION", operationSequence: 2, geojson: vierkant(0, 0) }),
        ],
      },
    });

    const uit = losOp("a", i);
    expect(enige(uit).vlakken).toHaveLength(1);
    expect(uit.redenen.join(" ")).toContain("ander component");
  });
  it("knipt een gebied op in hoogtebanden", () => {
    // EHBDRMZ: EHBDRMZA tot 1200 ft, met EHBDRMZB tot 600 ft erbij. Samenvoegen
    // tot één vlak van 0–1200 ft maakt de onderste helft 600 voet te hoog.
    const i = index({
      a: {
        uuid: "u-a",
        componenten: [
          component({
            operation: "BASE",
            operationSequence: 1,
            geojson: vierkant(0, 0),
            lowerlimit: 0,
            lowerunit: "FT",
            upperlimit: 1200,
            upperunit: "FT",
          }),
          component({
            operation: "UNION",
            operationSequence: 2,
            geojson: vierkant(1, 0),
            lowerlimit: 0,
            lowerunit: "FT",
            upperlimit: 600,
            upperunit: "FT",
          }),
        ],
      },
    });

    const uit = losOp("a", i);
    expect(uit.volumes).toHaveLength(2);
    // Onderaan gelden allebei: één rechthoek van twee vierkanten.
    expect(uit.volumes[0].band).toMatchObject({ lowerlimit: 0, upperlimit: 600 });
    expect(vlakkenVan({ ...uit, volumes: [uit.volumes[0]] })).toEqual([5]);
    // Daarboven blijft alleen de BASE over.
    expect(uit.volumes[1].band).toMatchObject({ lowerlimit: 600, upperlimit: 1200 });
    const boven = uit.volumes[1].vlakken[0].geometry as { coordinates: number[][][] };
    expect(boven.coordinates[0].map((p) => p[0])).toEqual([0, 1, 1, 0, 0]);
  });

  it("laat een SUBTR alleen gelden op zijn eigen hoogte", () => {
    // EHAATMZD trekt een gebied af dat maar een deel van de band beslaat. Over
    // de hele hoogte aftrekken zou een gat maken waar het gebied gewoon geldt.
    const i = index({
      a: {
        uuid: "u-a",
        componenten: [
          component({
            operation: "BASE",
            operationSequence: 1,
            geojson: vierkant(0, 0, 4),
            lowerlimit: 0,
            lowerunit: "FT",
            upperlimit: 100,
            upperunit: "FL",
          }),
          component({
            operation: "SUBTR",
            operationSequence: 2,
            geojson: vierkant(1, 1),
            lowerlimit: 0,
            lowerunit: "FT",
            upperlimit: 50,
            upperunit: "FL",
          }),
        ],
      },
    });

    const uit = losOp("a", i);
    expect(uit.volumes).toHaveLength(2);
    // Onderin een vierkant met een gat erin: buitenring plus binnenring.
    const onder = uit.volumes[0].vlakken[0].geometry as { coordinates: number[][][] };
    expect(onder.coordinates).toHaveLength(2);
    expect(uit.volumes[0].band).toMatchObject({ upperlimit: 50, upperunit: "FL" });
    // Daarboven is het weer heel.
    const boven = uit.volumes[1].vlakken[0].geometry as { coordinates: number[][][] };
    expect(boven.coordinates).toHaveLength(1);
    expect(uit.volumes[1].band).toMatchObject({ lowerlimit: 50, upperlimit: 100 });
  });

  it("rekent FL en FT tegen elkaar af", () => {
    // 5000 FT ligt onder FL95; de banden sluiten dus op elkaar aan in plaats van
    // dat het er twee losse zijn.
    const i = index({
      a: {
        uuid: "u-a",
        componenten: [
          component({
            operation: "BASE",
            operationSequence: 1,
            geojson: vierkant(0, 0, 2),
            lowerlimit: 5000,
            lowerunit: "FT",
            upperlimit: 95,
            upperunit: "FL",
          }),
          component({
            operation: "UNION",
            operationSequence: 2,
            geojson: vierkant(2, 0, 2),
            lowerlimit: 70,
            lowerunit: "FL",
            upperlimit: 95,
            upperunit: "FL",
          }),
        ],
      },
    });

    const uit = losOp("a", i);
    expect(uit.volumes.map((v) => [v.band.lowerlimit, v.band.lowerunit])).toEqual([
      [5000, "FT"],
      [70, "FL"],
    ]);
  });

  it("neemt de hoogte van het brongebied over als het component er geen opgeeft", () => {
    // EHSECTLOW2, componenten 10 en 11: geen upperLimit en lowerLimit in het
    // AIXM, alleen een verwijzing. Dan geldt de stapel van het brongebied.
    const i = index({
      a: {
        uuid: "u-a",
        componenten: [
          component({
            operation: "BASE",
            operationSequence: 1,
            geojson: vierkant(0, 0),
            lowerlimit: 0,
            lowerunit: "FT",
            upperlimit: 1000,
            upperunit: "FT",
          }),
          component({
            operation: "UNION",
            operationSequence: 2,
            derivedFrom: ["u-bron"],
            lowerlimit: null,
            lowerunit: null,
            upperlimit: null,
            upperunit: null,
          }),
        ],
      },
      bron: {
        uuid: "u-bron",
        componenten: [
          component({
            operation: "BASE",
            operationSequence: null,
            geojson: vierkant(1, 0),
            lowerlimit: 0,
            lowerunit: "FT",
            upperlimit: 500,
            upperunit: "FT",
          }),
        ],
      },
    });

    const uit = losOp("a", i);
    expect(uit.volumes.map((v) => v.band.upperlimit)).toEqual([500, 1000]);
    expect(uit.redenen).toEqual([]);
  });

  it("telt een tweede BASE als UNION", () => {
    // Zo leest de analyzer het ook. Overslaan zou het component laten wegvallen.
    const i = index({
      a: {
        uuid: "u-a",
        componenten: [
          component({ operation: "BASE", operationSequence: 1, geojson: vierkant(0, 0) }),
          component({ operation: "BASE", operationSequence: 2, geojson: vierkant(1, 0) }),
        ],
      },
    });

    const uit = losOp("a", i);
    expect(vlakkenVan(uit)).toEqual([5]);
    expect(uit.redenen).toEqual([]);
  });
});

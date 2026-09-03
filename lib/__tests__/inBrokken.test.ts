import { describe, expect, it } from "vitest";
import { inBrokken, schrijfInBrokken } from "../supabase/inBrokken";

/**
 * De aanleiding: 319 UUID's in één `.in()` maakten een URL van 11 KB, waarop
 * PostgREST 414 antwoordde. Die fout werd weggegooid, dus de export leverde
 * stilzwijgend een leeg blad `Area Volumes` en `Area Timesheets` op.
 */

const sleutels = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

describe("inBrokken", () => {
  it("knipt op tot honderd sleutels per verzoek", async () => {
    const brokken: string[][] = [];
    await inBrokken(sleutels(319), (brok) => {
      brokken.push(brok);
      return Promise.resolve({ data: [], error: null });
    });

    expect(brokken.map((b) => b.length)).toEqual([100, 100, 100, 19]);
    // Elke sleutel precies één keer, in dezelfde volgorde.
    expect(brokken.flat()).toEqual(sleutels(319));
  });

  it("plakt de rijen van alle brokken achter elkaar", async () => {
    const { data, error } = await inBrokken(sleutels(250), (brok) =>
      Promise.resolve({ data: brok.map((s) => ({ id: s })), error: null })
    );

    expect(error).toBeNull();
    expect(data).toHaveLength(250);
    expect(data[0]).toEqual({ id: "id-0" });
    expect(data[249]).toEqual({ id: "id-249" });
  });

  it("stopt bij een fout en geeft die terug in plaats van een halve uitkomst", async () => {
    let verzoeken = 0;
    const { data, error } = await inBrokken(sleutels(300), () => {
      verzoeken += 1;
      return Promise.resolve(
        verzoeken === 2
          ? { data: null, error: { message: "URI too long" } }
          : { data: [{ id: "x" }], error: null }
      );
    });

    expect(error).toBe("URI too long");
    expect(data).toEqual([]);
    expect(verzoeken).toBe(2);
  });

  it("doet niets bij een lege lijst", async () => {
    let verzoeken = 0;
    const { data, error } = await inBrokken([], () => {
      verzoeken += 1;
      return Promise.resolve({ data: [], error: null });
    });

    expect(verzoeken).toBe(0);
    expect(data).toEqual([]);
    expect(error).toBeNull();
  });
});

describe("schrijfInBrokken", () => {
  it("voert elke brok uit en meldt de eerste fout", async () => {
    const groottes: number[] = [];
    const { error } = await schrijfInBrokken(sleutels(150), (brok) => {
      groottes.push(brok.length);
      return Promise.resolve({ error: null });
    });

    expect(groottes).toEqual([100, 50]);
    expect(error).toBeNull();
  });

  it("stopt zodra een brok mislukt", async () => {
    let verzoeken = 0;
    const { error } = await schrijfInBrokken(sleutels(300), () => {
      verzoeken += 1;
      return Promise.resolve({ error: { message: "kapot" } });
    });

    expect(error).toBe("kapot");
    expect(verzoeken).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { formatGeometryPretty, type Coord } from "../geometryPretty";

const EXPECTED_EHBK1 = `Lateral Limits Significant Points

Geographical border on the following points:
N 51 02 00.74 E 005 52 37.81

Line Joining following points:
N 50 54 41.50 E 006 05 06.12
N 50 54 45.26 E 005 58 40.31

Arc of circle in clockwise direction starting from:
N 50 51 24.51 E 005 55 13.17,
radius 6.5 NM, centered on:
N 50 54 57.00 E 005 46 37.00

Line Joining following points:
N 50 48 29.24 E 005 45 37.93
N 50 46 36.93 E 005 43 42.97

Geographical border on the following points:
N 50 47 24.32 E 005 41 45.81

Line Joining following points:
N 50 59 55.80 E 005 46 01.10
N 51 03 16.99 E 005 49 32.07
N 51 02 00.74 E 005 52 37.81`;

const P = {
  A: { lat: 51.03353889, lon: 5.87716944 },
  B: { lat: 50.91152778, lon: 6.08503333 },
  C: { lat: 50.91257222, lon: 5.97786389 },
  D: { lat: 50.85680833, lon: 5.920325 },
  E: { lat: 50.91583333, lon: 5.77694444 },
  F: { lat: 50.80812222, lon: 5.76053611 },
  G: { lat: 50.776925, lon: 5.72860278 },
  H: { lat: 50.79008889, lon: 5.69605833 },
  I: { lat: 50.99883333, lon: 5.76697222 },
  J: { lat: 51.05471944, lon: 5.825575 },
};

const BORDER_UUID = "a0d40d3b-2bbf-4733-9d3b-5cbc098c21c9";

const borderResolver = (uuid: string): Coord[] | null => {
  if (uuid !== BORDER_UUID) return null;
  return [P.A, P.H];
};

const geometry = [
  `P(${P.A.lat},${P.A.lon})`,
  `BORDER(${BORDER_UUID},${P.A.lat},${P.A.lon},${P.A.lat},${P.A.lon})`,
  `P(${P.B.lat},${P.B.lon})`,
  `P(${P.C.lat},${P.C.lon})`,
  `P(${P.D.lat},${P.D.lon})`,
  `ARC(${P.E.lat},${P.E.lon},6.5,CW,${P.F.lat},${P.F.lon})`,
  `P(${P.F.lat},${P.F.lon})`,
  `P(${P.G.lat},${P.G.lon})`,
  `BORDER(${BORDER_UUID},${P.H.lat},${P.H.lon},${P.H.lat},${P.H.lon})`,
  `P(${P.I.lat},${P.I.lon})`,
  `P(${P.J.lat},${P.J.lon})`,
  `P(${P.A.lat},${P.A.lon})`,
].join(" | ");

describe("formatGeometryPretty", () => {
  it("renders EHBK1 lateral limits without duplicates and with clockwise arc", () => {
    const pretty = formatGeometryPretty(geometry, { borderResolver });
    const output = `Lateral Limits Significant Points\n\n${pretty}`;
    expect(output).toBe(EXPECTED_EHBK1);

    const blocks = pretty.split("\n\n");
    expect(blocks.length).toBeGreaterThanOrEqual(6);

    const lineBeforeArc = blocks[1];
    expect(lineBeforeArc).toContain("Line Joining following points:");
    expect(lineBeforeArc).toContain("N 50 54 41.50 E 006 05 06.12");
    expect(lineBeforeArc).toContain("N 50 54 45.26 E 005 58 40.31");
    expect(lineBeforeArc).not.toContain("N 50 51 24.51 E 005 55 13.17");

    const arcBlock = blocks[2];
    expect(arcBlock).toContain("Arc of circle in clockwise direction starting from:");
    expect(arcBlock).toContain("N 50 51 24.51 E 005 55 13.17");

    const lineAfterArc = blocks[3];
    expect(lineAfterArc).toContain("Line Joining following points:");
    expect(lineAfterArc).toContain("N 50 48 29.24 E 005 45 37.93");
    expect(lineAfterArc).toContain("N 50 46 36.93 E 005 43 42.97");
    expect(lineAfterArc).not.toContain("N 50 47 24.32 E 005 41 45.81");

    const borderBlock = blocks[4];
    expect(borderBlock).toContain("Geographical border on the following points:");
    expect(borderBlock).toContain("N 50 47 24.32 E 005 41 45.81");
  });
});

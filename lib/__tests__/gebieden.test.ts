import { describe, expect, it } from "vitest";
import { toonHoogte } from "../gebieden";

describe("toonHoogte", () => {
  it("schrijft een flight level met drie cijfers", () => {
    expect(toonHoogte(65, "FL")).toBe("FL 065");
    expect(toonHoogte(5, "FL")).toBe("FL 005");
    expect(toonHoogte(195, "FL")).toBe("FL 195");
  });

  it("noemt grondniveau GND", () => {
    // 0 voet is de grond; "0 ft" leest niemand als zodanig.
    expect(toonHoogte(0, "FT")).toBe("GND");
    expect(toonHoogte(0, null)).toBe("GND");
  });

  it("laat FL 000 met rust — dat is geen grond", () => {
    // FL 000 is de standaarddrukhoogte, niet het maaiveld.
    expect(toonHoogte(0, "FL")).toBe("FL 000");
  });

  it("houdt voet en meter uit elkaar", () => {
    expect(toonHoogte(3500, "FT")).toBe("3500 ft");
    expect(toonHoogte(900, "M")).toBe("900 m");
  });

  it("toont een streepje als er geen hoogte is", () => {
    expect(toonHoogte(null, "FL")).toBe("—");
    expect(toonHoogte(null, null)).toBe("—");
  });
});

import { describe, expect, it } from "vitest";
import { toonDatum, toonDatumTijd } from "../datum";

/**
 * Deze tests draaien in de tijdzone van de machine. Dat is precies het punt:
 * de uitkomst moet daar níét van afhangen. Zonder expliciete tijdzone geeft een
 * server in UTC een andere tekst dan een browser in Amsterdam, en dat meldt
 * React bij het hydrateren als fout #418.
 */
describe("toonDatum", () => {
  it("schrijft dd-mm-jjjj", () => {
    expect(toonDatum("2026-08-06T12:00:00Z")).toBe("06-08-2026");
  });

  it("houdt de Nederlandse dag aan, ook rond middernacht UTC", () => {
    // 23:30 UTC op 5 augustus is in Amsterdam al 6 augustus (zomertijd, UTC+2).
    expect(toonDatum("2026-08-05T23:30:00Z")).toBe("06-08-2026");
    // En 22:30 UTC in de winter is nog dezelfde dag (UTC+1).
    expect(toonDatum("2026-01-05T22:30:00Z")).toBe("05-01-2026");
  });

  it("geeft een streepje bij niets of onzin", () => {
    expect(toonDatum(null)).toBe("—");
    expect(toonDatum("")).toBe("—");
    expect(toonDatum("geen datum")).toBe("—");
  });
});

describe("toonDatumTijd", () => {
  it("rekent naar Nederlandse tijd, niet naar die van de server", () => {
    // Zomertijd: UTC+2.
    expect(toonDatumTijd("2026-08-06T12:22:00Z")).toBe("06-08-2026 14:22");
    // Wintertijd: UTC+1.
    expect(toonDatumTijd("2026-01-06T12:22:00Z")).toBe("06-01-2026 13:22");
  });

  it("geeft een streepje bij niets", () => {
    expect(toonDatumTijd(null)).toBe("—");
    expect(toonDatumTijd(undefined)).toBe("—");
  });
});

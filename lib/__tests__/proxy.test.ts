import { describe, expect, it } from "vitest";
import { isPubliekPad } from "../../proxy";

describe("isPubliekPad", () => {
  it("laat de voorpagina door, maar niet alles wat eronder hangt", () => {
    // `/` staat bewust niet in PUBLIEKE_PADEN: als prefix zou het met
    // startsWith de hele applicatie openzetten.
    expect(isPubliekPad("/")).toBe(true);
    expect(isPubliekPad("/gebieden")).toBe(false);
    expect(isPubliekPad("/api/export/lara")).toBe(false);
  });

  it("laat de schermen door die zonder account bereikbaar moeten zijn", () => {
    expect(isPubliekPad("/inloggen")).toBe(true);
    expect(isPubliekPad("/uitnodiging")).toBe(true);
    // De uitnodigingslink draagt het token als queryparameter, dus het pad zelf
    // is kaal — maar een subpad moet ook kunnen.
    expect(isPubliekPad("/auth/callback")).toBe(true);
  });

  it("laat het accepteren van een uitnodiging door", () => {
    // Zonder deze regel stuurt de proxy de POST naar /inloggen, en dan komt er
    // een 405 terug in plaats van een account.
    expect(isPubliekPad("/api/uitnodiging/accepteren")).toBe(true);
  });

  it("houdt de beheerroute afgeschermd — die scheelt één letter", () => {
    // /api/uitnodigingen (meervoud) maakt en verwijdert uitnodigingen. Met een
    // kale startsWith zou /api/uitnodiging die óók dekken.
    expect(isPubliekPad("/api/uitnodigingen")).toBe(false);
    expect(isPubliekPad("/api/uitnodigingen/abc-123")).toBe(false);
  });

  it("houdt de rest afgeschermd", () => {
    // `/` staat hier niet meer bij: dat is sinds de voorpagina openbaar, met de
    // uitleg en het inlogveld erop.
    for (const pad of [
      "/importeren",
      "/gebieden",
      "/lara-selectie",
      "/exporteren",
      "/beheer/gebruikers",
      "/api/upload",
      "/api/gebruikers",
      "/api/export/lara",
    ]) {
      expect(isPubliekPad(pad), pad).toBe(false);
    }
  });

  it("trapt niet in een pad dat toevallig zo begint", () => {
    expect(isPubliekPad("/inloggenXYZ")).toBe(false);
    expect(isPubliekPad("/uitnodigingsoverzicht")).toBe(false);
  });
});

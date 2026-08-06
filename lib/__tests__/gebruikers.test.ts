import { describe, expect, it } from "vitest";
import { ROL_LABEL, isLaatsteAdmin, uitnodigingsLink, type Gebruiker } from "../gebruikers";

const gebruiker = (id: string, rol: Gebruiker["rol"]): Gebruiker => ({
  id,
  email: `${id}@projectus.nl`,
  naam: null,
  rol,
  createdAt: "2026-08-06T00:00:00Z",
  lastSeen: null,
});

describe("isLaatsteAdmin", () => {
  it("herkent de enige beheerder", () => {
    // Zonder deze controle kan de laatste admin zichzelf degraderen, en dan kan
    // niemand meer gebruikers beheren — ook zichzelf niet terugzetten.
    const lijst = [gebruiker("a", "admin"), gebruiker("b", "user"), gebruiker("c", "user")];

    expect(isLaatsteAdmin(lijst, "a")).toBe(true);
    expect(isLaatsteAdmin(lijst, "b")).toBe(false);
  });

  it("laat degraderen toe zodra er een tweede beheerder is", () => {
    const lijst = [gebruiker("a", "admin"), gebruiker("b", "admin")];

    expect(isLaatsteAdmin(lijst, "a")).toBe(false);
    expect(isLaatsteAdmin(lijst, "b")).toBe(false);
  });

  it("zegt niets over een lijst zonder beheerders", () => {
    expect(isLaatsteAdmin([gebruiker("a", "user")], "a")).toBe(false);
    expect(isLaatsteAdmin([], "a")).toBe(false);
  });
});

describe("uitnodigingsLink", () => {
  it("wijst naar de eigen applicatie, niet naar Supabase", () => {
    // Zo is er geen redirect-allowlist in Supabase nodig.
    const link = uitnodigingsLink("https://lara.example.nl", "abc123");

    expect(link).toBe("https://lara.example.nl/uitnodiging?token=abc123");
  });

  it("werkt ook lokaal", () => {
    expect(uitnodigingsLink("http://localhost:3000", "xyz")).toBe(
      "http://localhost:3000/uitnodiging?token=xyz"
    );
  });
});

describe("ROL_LABEL", () => {
  it("noemt de rollen zoals ze op het scherm staan", () => {
    expect(ROL_LABEL.admin).toBe("Beheerder");
    expect(ROL_LABEL.user).toBe("Gebruiker");
  });
});

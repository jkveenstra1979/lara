import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Gebruikers en rollen.
 *
 * Twee rollen, één verschil: een `admin` beheert gebruikers, een `user` niet.
 * Aan de luchtruimgegevens mag iedereen die is ingelogd evenveel doen — dat was
 * een bewuste keuze en die blijft staan.
 */

export type Rol = "admin" | "user";

export type Gebruiker = {
  id: string;
  email: string;
  naam: string | null;
  rol: Rol;
  createdAt: string;
  lastSeen: string | null;
};

export const ROL_LABEL: Record<Rol, string> = {
  admin: "Beheerder",
  user: "Gebruiker",
};

type Rij = {
  id: string;
  email: string;
  naam: string | null;
  rol: Rol;
  created_at: string;
  last_seen: string | null;
};

const naarGebruiker = (r: Rij): Gebruiker => ({
  id: r.id,
  email: r.email,
  naam: r.naam,
  rol: r.rol,
  createdAt: r.created_at,
  lastSeen: r.last_seen,
});

/** Het profiel van wie er nu is ingelogd, of null. */
export async function huidigeGebruiker(
  supabase: SupabaseClient<Database>
): Promise<Gebruiker | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("gebruikers")
    .select("id, email, naam, rol, created_at, last_seen")
    .eq("id", user.id)
    .maybeSingle();

  if (data) return naarGebruiker(data as unknown as Rij);

  // Geen profiel: het account bestaat wel in auth maar de trigger heeft nog geen
  // rij gemaakt (bijvoorbeeld als de migratie later is gedraaid). Behandel het
  // als gewone gebruiker in plaats van als uitgelogd.
  return {
    id: user.id,
    email: user.email ?? "",
    naam: null,
    rol: "user",
    createdAt: new Date().toISOString(),
    lastSeen: null,
  };
}

export async function haalGebruikers(
  supabase: SupabaseClient<Database>
): Promise<{ gebruikers: Gebruiker[]; error: string | null }> {
  const { data, error } = await supabase
    .from("gebruikers")
    .select("id, email, naam, rol, created_at, last_seen")
    .order("created_at");

  if (error) return { gebruikers: [], error: error.message };
  return { gebruikers: ((data ?? []) as unknown as Rij[]).map(naarGebruiker), error: null };
}

/**
 * Is dit de laatste beheerder?
 *
 * Zonder deze controle kan de enige admin zichzelf degraderen of verwijderen, en
 * dan kan niemand meer gebruikers beheren — ook zichzelf niet terugzetten.
 */
export function isLaatsteAdmin(gebruikers: Gebruiker[], id: string): boolean {
  const admins = gebruikers.filter((g) => g.rol === "admin");
  return admins.length === 1 && admins[0].id === id;
}

/* ------------------------------------------------------------ uitnodigen ---- */

export type Uitnodiging = {
  id: string;
  email: string;
  naam: string | null;
  rol: Rol;
  token: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  /** Verlopen én nog niet geaccepteerd. */
  verlopen: boolean;
};

type UitnodigingRij = {
  id: string;
  email: string;
  naam: string | null;
  rol: Rol;
  token: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
};

/** Openstaande uitnodigingen: nog niet geaccepteerd, nieuwste eerst. */
export async function haalUitnodigingen(
  supabase: SupabaseClient<Database>
): Promise<{ uitnodigingen: Uitnodiging[]; error: string | null }> {
  const { data, error } = await supabase
    .from("uitnodigingen")
    .select("id, email, naam, rol, token, created_at, expires_at, accepted_at")
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  if (error) return { uitnodigingen: [], error: error.message };

  const nu = Date.now();
  return {
    uitnodigingen: ((data ?? []) as unknown as UitnodigingRij[]).map((r) => ({
      id: r.id,
      email: r.email,
      naam: r.naam,
      rol: r.rol,
      token: r.token,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      acceptedAt: r.accepted_at,
      verlopen: new Date(r.expires_at).getTime() < nu,
    })),
    error: null,
  };
}

/** De link die de beheerder doorstuurt. */
export function uitnodigingsLink(origin: string, token: string): string {
  const url = new URL("/uitnodiging", origin);
  url.searchParams.set("token", token);
  return url.toString();
}

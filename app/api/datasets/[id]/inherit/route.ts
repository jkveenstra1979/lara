import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Selectie en nummering overnemen van een eerdere dataset, gematcht op designator.
 *
 * Zonder dit moet je na elke AIRAC-cyclus tientallen gebieden opnieuw aanvinken
 * en nummeren. Het antwoord noemt drie uitkomsten, en de laatste twee zijn de
 * reden dat deze functie bestaat:
 *
 *   overgenomen  de designator bestaat in beide datasets
 *   vervallen    stond in de vorige selectie, komt niet meer voor in dit AIXM
 *   nieuw        staat in dit AIXM, stond niet in de vorige selectie
 *
 * Een gebied dat stilzwijgend uit de LARA-lijst verdwijnt is een fout die pas bij
 * de gebruiker opvalt.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: doelDataset } = await ctx.params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const bronDataset = String(body?.bronDatasetId ?? "");
  if (!bronDataset) {
    return NextResponse.json({ error: "Geef aan van welke dataset overgenomen moet worden." }, { status: 400 });
  }
  if (bronDataset === doelDataset) {
    return NextResponse.json({ error: "Bron en doel zijn dezelfde dataset." }, { status: 400 });
  }

  // De selectie van de bron, met de designator erbij.
  const { data: bronSelectie, error: bronFout } = await supabase
    .from("lara_areas")
    .select("lara_area_id, note, airspaces!inner(ident)")
    .eq("dataset_id", bronDataset);
  if (bronFout) return NextResponse.json({ error: bronFout.message }, { status: 500 });

  const { data: doelGebieden, error: doelFout } = await supabase
    .from("airspaces")
    .select("id, ident")
    .eq("dataset_id", doelDataset);
  if (doelFout) return NextResponse.json({ error: doelFout.message }, { status: 500 });

  const perIdent = new Map<string, string>();
  for (const gebied of doelGebieden ?? []) perIdent.set(gebied.ident, gebied.id);

  type BronRij = { lara_area_id: number | null; note: string | null; airspaces: { ident: string } | { ident: string }[] };
  const identVan = (rij: BronRij) =>
    Array.isArray(rij.airspaces) ? rij.airspaces[0]?.ident : rij.airspaces?.ident;

  const overTeNemen: { dataset_id: string; airspace_id: string; lara_area_id: number | null; note: string | null }[] = [];
  const vervallen: { ident: string; lara_area_id: number | null }[] = [];

  for (const rij of (bronSelectie ?? []) as BronRij[]) {
    const ident = identVan(rij);
    if (!ident) continue;
    const airspaceId = perIdent.get(ident);
    if (!airspaceId) {
      vervallen.push({ ident, lara_area_id: rij.lara_area_id });
      continue;
    }
    overTeNemen.push({
      dataset_id: doelDataset,
      airspace_id: airspaceId,
      lara_area_id: rij.lara_area_id,
      note: rij.note,
    });
  }

  if (overTeNemen.length) {
    const { error } = await supabase
      .from("lara_areas")
      .upsert(overTeNemen.map((r) => ({ ...r, updated_by: user.id })), { onConflict: "airspace_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const bronIdents = new Set((bronSelectie ?? []).map((r) => identVan(r as BronRij)).filter(Boolean));
  const nieuw = (doelGebieden ?? []).filter((g) => !bronIdents.has(g.ident)).map((g) => g.ident);

  return NextResponse.json({
    overgenomen: overTeNemen.length,
    vervallen,
    nieuw: nieuw.length,
    nieuweIdents: nieuw.slice(0, 50),
  });
}

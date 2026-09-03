import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { schrijfInBrokken } from "@/lib/supabase/inBrokken";

export const runtime = "nodejs";

/** De LARA-selectie van een dataset. */
export async function GET(req: NextRequest) {
  const datasetId = req.nextUrl.searchParams.get("datasetId");
  if (!datasetId) {
    return NextResponse.json({ error: "datasetId ontbreekt." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lara_areas")
    .select("id, airspace_id, lara_area_id, note, airspaces!inner(ident, name, type)")
    .eq("dataset_id", datasetId)
    .order("lara_area_id", { ascending: true, nullsFirst: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ selectie: data ?? [] });
}

/**
 * Gebieden aan de LARA-lijst toevoegen.
 *
 * Zonder Area ID: selecteren en nummeren zijn twee stappen, en op dit scherm
 * gaat het alleen om de vraag of een gebied meegaat. Nummeren gebeurt op
 * scherm 3.
 *
 * `ignoreDuplicates` maakt de aanroep herhaalbaar: een gebied dat er al in staat
 * blijft staan met zijn nummer, in plaats van dat het nummer wordt gewist.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const datasetId = String(body?.datasetId ?? "");
  const airspaceIds: string[] = Array.isArray(body?.airspaceIds) ? body.airspaceIds : [];

  if (!datasetId || !airspaceIds.length) {
    return NextResponse.json({ error: "datasetId en airspaceIds zijn verplicht." }, { status: 400 });
  }

  const { error } = await supabase.from("lara_areas").upsert(
    airspaceIds.map((airspaceId) => ({
      dataset_id: datasetId,
      airspace_id: airspaceId,
      added_by: user.id,
      updated_by: user.id,
    })),
    { onConflict: "airspace_id", ignoreDuplicates: true }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ toegevoegd: airspaceIds.length });
}

/**
 * Een Area ID toekennen of wissen.
 *
 * De duplicaatcontrole zit in de database (`unique (dataset_id, lara_area_id)`),
 * niet hier. Een controle vooraf zou een tweede gebruiker die tegelijk hetzelfde
 * nummer intikt alsnog doorlaten; de constraint niet.
 */
export async function PUT(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const airspaceId = String(body?.airspaceId ?? "");
  const ruw = body?.laraAreaId;
  const laraAreaId = ruw === null || ruw === "" || ruw === undefined ? null : Number(ruw);

  if (!airspaceId) {
    return NextResponse.json({ error: "airspaceId is verplicht." }, { status: 400 });
  }
  if (laraAreaId !== null && (!Number.isInteger(laraAreaId) || laraAreaId <= 0)) {
    return NextResponse.json({ error: "Het nummer moet een geheel getal groter dan nul zijn." }, { status: 400 });
  }

  const { error } = await supabase
    .from("lara_areas")
    .update({ lara_area_id: laraAreaId, updated_by: user.id })
    .eq("airspace_id", airspaceId);

  if (error) {
    // 23505 = unique_violation: dit nummer is al vergeven binnen deze dataset.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: `Nummer ${laraAreaId} is al in gebruik in deze dataset.`, code: "duplicaat" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ airspaceId, laraAreaId });
}

/**
 * Gebieden uit de LARA-lijst halen. Het Area ID vervalt mee — dat hoort bij de
 * selectie, niet bij het gebied.
 */
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const airspaceIds: string[] = Array.isArray(body?.airspaceIds) ? body.airspaceIds : [];
  if (!airspaceIds.length) {
    return NextResponse.json({ error: "airspaceIds is verplicht." }, { status: 400 });
  }

  // In brokken: `.in()` gaat over de URL, en "alles uit LARA halen" stuurt er
  // zo een paar honderd mee. Boven ruim 200 UUID's antwoordt PostgREST met 414.
  const { error } = await schrijfInBrokken(airspaceIds, (brok) =>
    supabase.from("lara_areas").delete().in("airspace_id", brok)
  );
  if (error) return NextResponse.json({ error }, { status: 500 });

  return NextResponse.json({ verwijderd: airspaceIds.length });
}

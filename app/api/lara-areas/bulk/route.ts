import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseBulkLijst } from "@/lib/bulkNummers";
import { inBrokken, schrijfInBrokken } from "@/lib/supabase/inBrokken";

export const runtime = "nodejs";

/**
 * Een geplakte lijst verwerken: toevoegen én nummeren in één keer.
 *
 * Dit is hoe een nummering uit een vorige cyclus of uit een spreadsheet
 * binnenkomt. Gebieden die nog niet in de LARA-lijst staan worden meteen
 * toegevoegd — anders zou je twee keer hetzelfde lijstje moeten doorlopen.
 *
 * Het antwoord noemt per regel wat er is gebeurd. Stil overslaan van een
 * designator die niet bestaat is precies hoe je een gebied kwijtraakt zonder het
 * te merken.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const datasetId = String(body?.datasetId ?? "");
  const tekst = String(body?.tekst ?? "");

  if (!datasetId) return NextResponse.json({ error: "datasetId is verplicht." }, { status: 400 });

  const { toewijzingen, fouten } = parseBulkLijst(tekst);
  if (!toewijzingen.length) {
    return NextResponse.json({ toegepast: 0, onbekend: [], fouten, botsingen: [] });
  }

  const { data: gebieden, error: gebiedenFout } = await supabase
    .from("airspaces")
    .select("id, ident")
    .eq("dataset_id", datasetId);
  if (gebiedenFout) return NextResponse.json({ error: gebiedenFout.message }, { status: 500 });

  const idPerIdent = new Map<string, string>();
  for (const gebied of gebieden ?? []) idPerIdent.set(gebied.ident.toUpperCase(), gebied.id);

  const teVerwerken: { airspace_id: string; lara_area_id: number; ident: string }[] = [];
  const onbekend: string[] = [];

  for (const toewijzing of toewijzingen) {
    const airspaceId = idPerIdent.get(toewijzing.ident.toUpperCase());
    if (!airspaceId) {
      onbekend.push(toewijzing.ident);
      continue;
    }
    teVerwerken.push({
      airspace_id: airspaceId,
      lara_area_id: toewijzing.laraAreaId,
      ident: toewijzing.ident,
    });
  }

  // Eerst de nummers vrijmaken die deze lijst opnieuw uitdeelt. Zonder deze stap
  // botst een omwisseling (1↔2) op de unique constraint terwijl het resultaat
  // prima geldig is.
  //
  // In twee stappen, en in brokken. Het stond eerst in één statement met
  // `.not("airspace_id", "in", "(…)")`, maar dat filter gaat over de URL: bij een
  // geplakte lijst van een paar honderd regels werd het verzoek te lang en
  // antwoordde PostgREST met 414 — waarna het vrijmaken stil oversloeg en de
  // upsert erna op een duplicaat stukliep.
  const nummers = teVerwerken.map((t) => t.lara_area_id);
  const doelen = new Set(teVerwerken.map((t) => t.airspace_id));

  if (nummers.length) {
    const { data: houders, error: houderFout } = await inBrokken(nummers, (brok) =>
      supabase
        .from("lara_areas")
        .select("airspace_id")
        .eq("dataset_id", datasetId)
        .in("lara_area_id", brok)
    );
    if (houderFout) return NextResponse.json({ error: houderFout }, { status: 500 });

    // Alleen de gebieden die hun nummer kwijtraken; wie het houdt, blijft staan.
    const vrijTeMaken = houders
      .map((h) => h.airspace_id)
      .filter((id) => !doelen.has(id));

    if (vrijTeMaken.length) {
      const { error: vrijFout } = await schrijfInBrokken(vrijTeMaken, (brok) =>
        supabase
          .from("lara_areas")
          .update({ lara_area_id: null, updated_by: user.id })
          .in("airspace_id", brok)
      );
      if (vrijFout) return NextResponse.json({ error: vrijFout }, { status: 500 });
    }
  }

  const { error } = await supabase.from("lara_areas").upsert(
    teVerwerken.map((t) => ({
      dataset_id: datasetId,
      airspace_id: t.airspace_id,
      lara_area_id: t.lara_area_id,
      added_by: user.id,
      updated_by: user.id,
    })),
    { onConflict: "airspace_id" }
  );

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Twee gebieden zouden hetzelfde nummer krijgen.", code: "duplicaat" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    toegepast: teVerwerken.length,
    onbekend,
    fouten,
    /** Gebieden die hun nummer kwijtraakten doordat deze lijst het opnieuw uitdeelde. */
    vrijgemaakt: nummers.length,
  });
}

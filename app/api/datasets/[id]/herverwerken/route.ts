import { gunzipSync } from "node:zlib";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { bouwImport, geoborderLookupUitRijen } from "@/lib/aixmImport";

export const runtime = "nodejs";
export const maxDuration = 300;

const BUCKET = "aixm-uploads";

async function insertInStukken<T>(
  tabel: string,
  rijen: T[],
  admin: ReturnType<typeof createAdminClient>,
  grootte = 500
) {
  for (let i = 0; i < rijen.length; i += grootte) {
    const { error } = await admin.from(tabel).insert(rijen.slice(i, i + grootte) as never);
    if (error) throw new Error(`${tabel}: ${error.message}`);
  }
}

/**
 * Een dataset opnieuw verwerken uit het bewaarde bestand.
 *
 * De parser verandert; de brondata niet. Wanneer een fout in het uitlezen wordt
 * hersteld — een boog die niet werd geïnterpoleerd, een landsgrens die niet werd
 * gevolgd — staat de oude uitkomst nog in de database. Zonder deze route zou je
 * het AIXM-bestand opnieuw moeten uploaden, terwijl het al in de bucket staat.
 * Daar wordt het immers voor bewaard.
 *
 * De LARA-selectie blijft behouden. Dat vraagt aandacht: `lara_areas` hangt via
 * `airspace_id` aan de gebieden, en die worden vervangen. De selectie wordt dus
 * eerst opgeslagen op designator en daarna teruggezet.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: datasetId } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  const admin = createAdminClient();

  const { data: dataset } = await admin
    .from("datasets")
    .select("id, filename, storage_path")
    .eq("id", datasetId)
    .maybeSingle();

  if (!dataset) return NextResponse.json({ error: "Dataset niet gevonden." }, { status: 404 });
  if (!dataset.storage_path) {
    return NextResponse.json(
      { error: "Van deze import is het bronbestand niet bewaard; upload het opnieuw." },
      { status: 400 }
    );
  }

  const faal = async (bericht: string) => {
    await admin.from("datasets").update({ status: "error", error_message: bericht }).eq("id", datasetId);
    return NextResponse.json({ error: bericht }, { status: 500 });
  };

  try {
    await admin.from("datasets").update({ status: "running", error_message: null }).eq("id", datasetId);

    // De selectie veiligstellen op designator: de gebieden zelf worden vervangen.
    const { data: selectie } = await admin
      .from("lara_areas")
      // Eén regel: concatenatie sloopt de type-inferentie van supabase-js.
      .select("lara_area_id, note, airspaces!inner(ident)")
      .eq("dataset_id", datasetId);

    type Rij = { lara_area_id: number | null; note: string | null; airspaces: { ident: string } | { ident: string }[] | null };
    const bewaard = ((selectie ?? []) as unknown as Rij[])
      .map((r) => ({
        ident: Array.isArray(r.airspaces) ? r.airspaces[0]?.ident : r.airspaces?.ident,
        laraAreaId: r.lara_area_id,
        note: r.note,
      }))
      .filter((r): r is { ident: string; laraAreaId: number | null; note: string | null } => Boolean(r.ident));

    const download = await admin.storage.from(BUCKET).download(dataset.storage_path);
    if (download.error || !download.data) {
      return await faal(`Het bewaarde bestand kon niet worden opgehaald: ${download.error?.message ?? "onbekend"}`);
    }
    const ruw = Buffer.from(await download.data.arrayBuffer());
    const isGzip = dataset.storage_path.endsWith(".gz") || (ruw[0] === 0x1f && ruw[1] === 0x8b);
    const xml = (isGzip ? gunzipSync(ruw) : ruw).toString("utf-8");

    const { data: bekendeGrenzen } = await admin.from("geoborders").select("border_id, geojson");
    const resultaat = await bouwImport(xml, datasetId, geoborderLookupUitRijen(bekendeGrenzen ?? []));

    // Het oude resultaat weg; geometries, xml_snippets en lara_areas gaan mee
    // via on delete cascade.
    const { error: wegFout } = await admin.from("airspaces").delete().eq("dataset_id", datasetId);
    if (wegFout) return await faal(`Opruimen mislukte: ${wegFout.message}`);
    await admin.from("xml_snippets").delete().eq("dataset_id", datasetId);

    await insertInStukken("airspaces", resultaat.airspaceRijen, admin);
    await insertInStukken("geometries", resultaat.geometrieRijen, admin);
    await insertInStukken("xml_snippets", resultaat.snippetRijen, admin);

    // De selectie terug, gematcht op designator.
    let hersteld = 0;
    const vervallen: string[] = [];
    if (bewaard.length) {
      const idPerIdent = new Map(resultaat.airspaceRijen.map((a) => [a.ident, a.id]));
      const terug = bewaard
        .map((b) => {
          const airspaceId = idPerIdent.get(b.ident);
          if (!airspaceId) {
            vervallen.push(b.ident);
            return null;
          }
          return {
            dataset_id: datasetId,
            airspace_id: airspaceId,
            lara_area_id: b.laraAreaId,
            note: b.note,
            added_by: user.id,
            updated_by: user.id,
          };
        })
        .filter(Boolean) as Record<string, unknown>[];

      for (let i = 0; i < terug.length; i += 500) {
        const { error } = await admin
          .from("lara_areas")
          .upsert(terug.slice(i, i + 500) as never, { onConflict: "airspace_id" });
        if (error) return await faal(`Selectie terugzetten mislukte: ${error.message}`);
      }
      hersteld = terug.length;
    }

    await admin
      .from("datasets")
      .update({ status: "done", airspace_count: resultaat.airspaceRijen.length, error_message: null })
      .eq("id", datasetId);

    return NextResponse.json({
      datasetId,
      samenvatting: resultaat.samenvatting,
      selectie: { hersteld, vervallen },
    });
  } catch (error) {
    return await faal(error instanceof Error ? error.message : "Opnieuw verwerken mislukte.");
  }
}

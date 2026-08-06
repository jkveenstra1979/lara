import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { bouwImport, geoborderLookupUitRijen } from "@/lib/aixmImport";

export const runtime = "nodejs";
// Een AIXM-bestand van tientallen MB's parsen en wegschrijven duurt seconden.
// Op Vercel geldt bovendien het plafond van het abonnement: 60 s op Hobby,
// 300 s op Pro. Blijft de import daar net onder, dan is het snijden in wat er
// per gebied wordt weggeschreven de eerste plek om te kijken.
export const maxDuration = 300;

const BUCKET = "aixm-uploads";

/** Rijen in stukken wegschrijven; één insert met duizenden rijen loopt vast. */
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
 * Een geüpload AIXM-bestand verwerken.
 *
 * Het bestand gaat **niet** door deze request. De browser zet het rechtstreeks
 * in de bucket en stuurt hier alleen het pad naartoe; deze route haalt het
 * daarvandaan op. Reden: een platform als Vercel kapt request bodies af op
 * 4,5 MB en antwoordt dan met `Request Entity Too Large` in platte tekst — een
 * AIXM-bestand van 96 MB komt er niet doorheen.
 *
 * De sessie bepaalt of je mag importeren; het wegschrijven gebeurt met de
 * service-role-sleutel, omdat één import honderden rijen over vier tabellen
 * verdeelt en dat niet halverwege mag stranden op een verlopen sessie.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const storagePath = String(body?.storagePath ?? "");
  const filename = String(body?.filename ?? "aixm-upload.xml");
  const airac = String(body?.airac ?? "").trim();

  if (!storagePath) {
    return NextResponse.json({ error: "Er is geen bestand ontvangen." }, { status: 400 });
  }
  // Het AIRAC-veld is verplicht: het bepaalt de naam van het exportbestand en is
  // achteraf niet meer af te leiden.
  if (!/^\d{4}$/.test(airac)) {
    return NextResponse.json(
      { error: "Vul de AIRAC-cyclus in als vier cijfers, bijvoorbeeld 2608." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const datasetId = crypto.randomUUID();

  const { error: datasetError } = await admin.from("datasets").insert({
    id: datasetId,
    filename,
    airac,
    storage_path: storagePath,
    status: "running",
    uploaded_by: user.id,
  });
  if (datasetError) {
    return NextResponse.json({ error: datasetError.message }, { status: 500 });
  }

  const faal = async (bericht: string, status = 500) => {
    await admin
      .from("datasets")
      .update({ status: "error", error_message: bericht })
      .eq("id", datasetId);
    return NextResponse.json({ error: bericht, datasetId }, { status });
  };

  try {
    const download = await admin.storage.from(BUCKET).download(storagePath);
    if (download.error || !download.data) {
      return await faal(`Het bestand kon niet worden opgehaald: ${download.error?.message ?? "onbekend"}`);
    }
    const xml = await download.data.text();

    const { data: bekendeGrenzen } = await admin.from("geoborders").select("border_id, geojson");
    const uitTabel = geoborderLookupUitRijen(bekendeGrenzen ?? []);

    const resultaat = await bouwImport(xml, datasetId, uitTabel);

    await insertInStukken("airspaces", resultaat.airspaceRijen, admin);
    await insertInStukken("geometries", resultaat.geometrieRijen, admin);
    await insertInStukken("xml_snippets", resultaat.snippetRijen, admin);

    // Grenzen uit dit bestand bewaren, zodat een volgend AIXM-bestand zonder
    // grenzen alsnog te verwerken is.
    if (resultaat.geoborders.length) {
      const { error } = await admin.from("geoborders").upsert(
        resultaat.geoborders.map((g) => ({
          border_id: g.borderId,
          name: g.name,
          geojson: g.geojson as never,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "border_id" }
      );
      // Niet fataal: de import zelf is gelukt, alleen het bewaren niet.
      if (error) console.error("Geoborders bewaren mislukte:", error.message);
    }

    await admin
      .from("datasets")
      .update({
        status: "done",
        airspace_count: resultaat.airspaceRijen.length,
        error_message: null,
      })
      .eq("id", datasetId);

    return NextResponse.json({ datasetId, samenvatting: resultaat.samenvatting });
  } catch (error) {
    const bericht = error instanceof Error ? error.message : "Verwerken van het AIXM-bestand mislukte.";
    return await faal(bericht);
  }
}

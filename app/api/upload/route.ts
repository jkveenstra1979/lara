import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { bouwImport, geoborderLookupUitRijen } from "@/lib/aixmImport";

export const runtime = "nodejs";
// Een AIXM-bestand van 50 MB parsen duurt seconden, niet milliseconden.
export const maxDuration = 300;

const BUCKET = "aixm-uploads";
const MAX_BYTES = 200 * 1024 * 1024;

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
 * AIXM-bestand inlezen en opslaan.
 *
 * De sessie bepaalt of je mag uploaden; het wegschrijven gebeurt met de
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

  const formData = await req.formData();
  const file = formData.get("file");
  const airac = String(formData.get("airac") ?? "").trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Geen bestand ontvangen." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Bestand is groter dan ${MAX_BYTES / 1024 / 1024} MB.` },
      { status: 413 }
    );
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
  const filename = file.name || "aixm-upload.xml";
  const storagePath = `${datasetId}/${filename}`;

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
    const buffer = Buffer.from(await file.arrayBuffer());

    // Het bronbestand bewaren, zodat een import na een parserwijziging herhaald
    // kan worden zonder het opnieuw op te vragen bij de leverancier.
    const upload = await admin.storage.from(BUCKET).upload(storagePath, buffer, {
      contentType: file.type || "application/xml",
      upsert: true,
    });
    if (upload.error) return await faal(`Opslaan van het bestand mislukte: ${upload.error.message}`);

    const { data: bekendeGrenzen } = await admin.from("geoborders").select("border_id, geojson");
    const uitTabel = geoborderLookupUitRijen(bekendeGrenzen ?? []);

    const resultaat = await bouwImport(buffer, datasetId, uitTabel);

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

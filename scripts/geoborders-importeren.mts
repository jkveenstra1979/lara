/**
 * Landsgrenzen uit een AIXM-bestand in de database zetten.
 *
 *   npm run geoborders -- documents/snapshot_AeroDB_2026-09-03_LIVE.xml
 *
 * Waarom apart, terwijl de import dit ook doet: een AIXM-bestand dat de grenzen
 * níét meelevert is niet te verwerken zolang de tabel leeg is. Met dit script
 * vul je hem één keer, en daarna maakt het niet meer uit.
 *
 * Grenzen veranderen niet. Ze staan daarom los van een dataset — één rij per
 * grens, bijgewerkt als een nieuw bestand een nieuwere versie meebrengt.
 *
 * Wat er op het spel staat: in het bestand van 3 september 2026 volgen 104 van
 * de 922 gebieden een landsgrens. Ontbreken de grenzen, dan sluit de parser die
 * gebieden met een rechte lijn — zonder iets te melden.
 */

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { extractGeoborders } from "../lib/geoborderExtract";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const [pad] = process.argv.slice(2);

const groen = (s: string) => `\x1b[32m${s}\x1b[0m`;
const rood = (s: string) => `\x1b[31m${s}\x1b[0m`;
const grijs = (s: string) => `\x1b[90m${s}\x1b[0m`;

if (!url || !serviceKey) {
  console.error(rood("\n.env.local is niet compleet — zie .env.example.\n"));
  process.exit(1);
}
if (!pad) {
  console.error("\nGebruik: npm run geoborders -- <pad naar een AIXM-bestand>\n");
  process.exit(1);
}

const ruw = readFileSync(pad);
const xml = (ruw[0] === 0x1f && ruw[1] === 0x8b ? gunzipSync(ruw) : ruw).toString("utf-8");

const grenzen = await extractGeoborders(xml);
if (!grenzen.length) {
  console.error(rood(`\nGeen GeoBorder-elementen gevonden in ${pad}.\n`));
  process.exit(1);
}

console.log(`\n${grenzen.length} grenzen gevonden in ${grijs(pad)}:\n`);
for (const g of grenzen) {
  console.log(`  ${g.name ?? "(naamloos)"}  ${grijs(g.borderId)}  ${g.coords.length} punten`);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { error } = await admin.from("geoborders").upsert(
  grenzen.map((g) => ({
    border_id: g.borderId,
    name: g.name,
    geojson: g.geojson as never,
    updated_at: new Date().toISOString(),
  })),
  { onConflict: "border_id" }
);

if (error) {
  console.error(rood(`\nOpslaan mislukte: ${error.message}\n`));
  process.exit(1);
}

const { count } = await admin
  .from("geoborders")
  .select("id", { count: "exact", head: true });

console.log(`\n${groen("Opgeslagen.")} De tabel bevat nu ${count} grenzen.\n`);

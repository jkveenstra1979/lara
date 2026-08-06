/**
 * Controleert of de Supabase-omgeving klopt met wat de applicatie verwacht.
 *
 *   npm run check:supabase
 *
 * Draait tegen de omgeving in .env.local — cloud of self-hosted, dat maakt niet
 * uit. Controleert drie dingen die je anders pas merkt als er data in zit:
 * bestaan de tabellen mét de kolommen uit de migratie, houdt RLS anon buiten de
 * deur, en staat de bucket klaar.
 *
 * Geen enkele schrijfactie. Veilig tegen productie te draaien.
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const groen = (s: string) => `\x1b[32m${s}\x1b[0m`;
const rood = (s: string) => `\x1b[31m${s}\x1b[0m`;
const geel = (s: string) => `\x1b[33m${s}\x1b[0m`;
const grijs = (s: string) => `\x1b[90m${s}\x1b[0m`;

let mislukt = 0;
let gewaarschuwd = 0;

function ok(wat: string, detail = "") {
  console.log(`  ${groen("✓")} ${wat}${detail ? grijs(" — " + detail) : ""}`);
}
function fout(wat: string, detail = "") {
  mislukt++;
  console.log(`  ${rood("✕")} ${wat}${detail ? grijs(" — " + detail) : ""}`);
}
function let_op(wat: string, detail = "") {
  gewaarschuwd++;
  console.log(`  ${geel("!")} ${wat}${detail ? grijs(" — " + detail) : ""}`);
}

if (!url || !anonKey || !serviceKey) {
  console.error(
    rood("\n.env.local is niet compleet.\n") +
      "  Nodig: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY\n" +
      "  Zie .env.example en het kopje 'Supabase koppelen' in de README.\n"
  );
  process.exit(1);
}

console.log(`\n${grijs("omgeving")}  ${url}\n`);

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/* ------------------------------------------------------------- tabellen ---- */
// Per tabel de kolommen die de applicatie echt gebruikt. PostgREST geeft een
// fout op een kolom die niet bestaat, dus dit toetst de migratie zelf.

const TABELLEN: Record<string, string> = {
  datasets: "id,filename,airac,storage_path,status,airspace_count,is_active,uploaded_at",
  airspaces: "id,dataset_id,ident,type,class,lowerlimit,upperunit,uuid_identifier,geometry_status",
  geometries: "id,airspace_id,operation,operation_sequence,lowerlimit,upperlimit,derived_from,geojson",
  lara_areas: "id,dataset_id,airspace_id,lara_area_id,note,added_at,updated_at",
  xml_snippets: "dataset_id,uuid,snippet",
  geoborders: "id,border_id,name,geojson",
};

console.log("tabellen en kolommen");
for (const [tabel, kolommen] of Object.entries(TABELLEN)) {
  const { error } = await admin.from(tabel).select(kolommen).limit(0);
  if (error) fout(tabel, error.message);
  else ok(tabel, `${kolommen.split(",").length} kolommen gecontroleerd`);
}

/* ------------------------------------------------------------------ RLS ---- */

console.log("\ntoegang");
{
  // Niet ingelogd: anon hoort niets te kunnen lezen. Twee vormen van "nee" zijn
  // goed — geweigerd door de grant, of een lege set door de policy.
  //
  // Een onbereikbare server geeft óók een fout, en die zou hier als "keurig
  // afgesloten" worden geteld. Vandaar dat netwerkfouten apart worden gevangen:
  // een controle die faalt omdat er niets antwoordt, heeft niets bewezen.
  const { data, error } = await anon.from("datasets").select("id").limit(1);
  const netwerkfout = error && /fetch failed|ENOTFOUND|ECONNREFUSED|timeout/i.test(error.message);

  if (netwerkfout) fout("anon-controle onmogelijk", error.message.split("\n")[0]);
  else if (error) ok("anon wordt geweigerd", error.message.split("\n")[0]);
  else if (!data?.length) ok("anon krijgt geen rijen", "RLS-policy sluit af");
  else fout("anon LEEST DATA", `${data.length} rij(en) zonder sessie — controleer RLS`);
}
{
  const { error } = await admin.from("datasets").select("id").limit(1);
  if (error) fout("service-role kan niet lezen", error.message);
  else ok("service-role leest", "gaat buiten RLS om, zoals bedoeld");
}

/* -------------------------------------------------------------- opslag ---- */

console.log("\nopslag");
{
  const { data, error } = await admin.storage.listBuckets();
  if (error) {
    fout("buckets opvragen", error.message);
  } else {
    const bucket = data?.find((b) => b.id === "aixm-uploads");
    if (!bucket) {
      fout("bucket aixm-uploads ontbreekt", "draai supabase/migrations/*_storage.sql");
    } else if (bucket.public) {
      fout("bucket aixm-uploads is PUBLIEK", "AIXM-bestanden horen privé te staan");
    } else {
      ok("bucket aixm-uploads", "privé");
    }
  }
}

/* ---------------------------------------------------------------- auth ---- */

console.log("\nauth");
{
  const { data, error } = await admin.auth.admin.listUsers();
  if (error) {
    fout("gebruikers opvragen", error.message);
  } else if (!data.users.length) {
    let_op(
      "nog geen gebruikers",
      "maak er één aan in het dashboard — er is geen registratieformulier"
    );
  } else {
    ok(`${data.users.length} gebruiker(s)`, data.users.map((u) => u.email).join(", "));
  }
}

/* --------------------------------------------------------------- slot ---- */

console.log("");
if (mislukt) {
  console.log(rood(`${mislukt} controle(s) mislukt.`) + ` ${gewaarschuwd} waarschuwing(en).\n`);
  process.exit(1);
}
console.log(
  groen("Omgeving klopt.") +
    (gewaarschuwd ? ` ${gewaarschuwd} waarschuwing(en).` : "") +
    "\n"
);

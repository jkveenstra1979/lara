/**
 * Een bestaande LARA-lijst uit een LARA V4/V5 Excel-bestand in de selectie zetten.
 *
 *   npm run lara-selectie -- "documents/LARAV4_export (4).xlsx"          # proefdraai
 *   npm run lara-selectie -- "documents/LARAV4_export (4).xlsx" --schrijf
 *
 * Bedoeld voor één keer: de lijst die al in LARA staat overnemen, zodat de
 * selectie en de nummering niet met de hand hoeven te worden ingeklopt. Daarna
 * neemt de import zelf het over (zie lib/overnemen.ts).
 *
 * Gematcht wordt op de designator uit de kolom `Area Name`, niet op de kolom
 * `UUID`. Die UUID is het rij-id van de dataset waaruit ooit is geëxporteerd;
 * na een nieuwe import bestaat dat id niet meer. De designator is stabiel over
 * AIRAC-cycli heen — dezelfde afweging als in lib/overnemen.ts.
 *
 * Komt een designator meer dan eens voor in het AIXM (EHLE1 is zowel een TMA
 * als een CTR), dan beslist de kolom `Full Name` tegen `airspaces.name`. Blijft
 * het onbeslist, dan wordt er niets gekozen en zegt het script welke.
 *
 * `--schrijf` verwijdert éérst de hele selectie van de doeldataset. Dat is
 * bedoeld: de Excel-lijst is de waarheid, niet wat er stond.
 */

import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const groen = (s: string) => `\x1b[32m${s}\x1b[0m`;
const rood = (s: string) => `\x1b[31m${s}\x1b[0m`;
const geel = (s: string) => `\x1b[33m${s}\x1b[0m`;
const grijs = (s: string) => `\x1b[90m${s}\x1b[0m`;

const argumenten = process.argv.slice(2);
const schrijven = argumenten.includes("--schrijf");
const datasetArg = argumenten.find((a) => a.startsWith("--dataset="))?.slice("--dataset=".length);
const pad = argumenten.find((a) => !a.startsWith("--"));

if (!url || !serviceKey) {
  console.error(rood("\n.env.local is niet compleet — zie .env.example.\n"));
  process.exit(1);
}
if (!pad) {
  console.error("\nGebruik: npm run lara-selectie -- <pad naar xlsx> [--dataset=<id>] [--schrijf]\n");
  process.exit(1);
}

/* ------------------------------------------------------------------ Excel -- */

type ExcelRij = { areaId: number; designator: string; volledigeNaam: string; regel: number };

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(pad);
const ws = wb.getWorksheet("Areas");
if (!ws) {
  console.error(rood(`\n${pad} heeft geen tabblad "Areas".\n`));
  process.exit(1);
}

const excelRijen: ExcelRij[] = [];
ws.eachRow((row, nr) => {
  if (nr === 1) return; // koprij
  const tekst = (kolom: number) => String(row.getCell(kolom).value ?? "").trim();
  const areaId = Number(tekst(1));
  const designator = tekst(2);
  if (!Number.isInteger(areaId) || areaId <= 0 || !designator) return;
  excelRijen.push({ areaId, designator, volledigeNaam: tekst(3), regel: nr });
});

if (!excelRijen.length) {
  console.error(rood(`\nGeen gebieden gevonden in het tabblad "Areas".\n`));
  process.exit(1);
}

// Dubbele nummers of designators halen de unique-constraint onderuit; dan is
// het bestand zelf niet in orde en heeft doorgaan geen zin.
const dubbeleNummers = tel(excelRijen.map((r) => String(r.areaId)));
const dubbeleDesignators = tel(excelRijen.map((r) => r.designator));
if (dubbeleNummers.length || dubbeleDesignators.length) {
  console.error(rood("\nHet bestand bevat dubbelen:"));
  if (dubbeleNummers.length) console.error(`  Area ID: ${dubbeleNummers.join(", ")}`);
  if (dubbeleDesignators.length) console.error(`  Area Name: ${dubbeleDesignators.join(", ")}`);
  console.error("");
  process.exit(1);
}

function tel(waarden: string[]): string[] {
  const gezien = new Set<string>();
  const dubbel = new Set<string>();
  for (const w of waarden) (gezien.has(w) ? dubbel : gezien).add(w);
  return [...dubbel];
}

/* --------------------------------------------------------------- dataset -- */

const admin = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: datasets, error: datasetFout } = await admin
  .from("datasets")
  .select("id, filename, airac, status, is_active, uploaded_at")
  .order("uploaded_at", { ascending: false });

if (datasetFout) {
  console.error(rood(`\nDatasets ophalen mislukte: ${datasetFout.message}\n`));
  process.exit(1);
}

// Dezelfde keuze als de schermen maken: de gemarkeerde dataset, anders de
// nieuwste geslaagde import.
const dataset = datasetArg
  ? (datasets ?? []).find((d) => d.id === datasetArg)
  : (datasets ?? []).find((d) => d.is_active) ?? (datasets ?? []).find((d) => d.status === "done");

if (!dataset) {
  console.error(rood(`\nGeen dataset gevonden${datasetArg ? ` met id ${datasetArg}` : ""}.\n`));
  process.exit(1);
}

const { data: gebieden, error: gebiedFout } = await admin
  .from("airspaces")
  .select("id, ident, name, type")
  .eq("dataset_id", dataset.id);

if (gebiedFout) {
  console.error(rood(`\nGebieden ophalen mislukte: ${gebiedFout.message}\n`));
  process.exit(1);
}

console.log(
  `\n${excelRijen.length} gebieden in ${grijs(pad)}` +
    `\nDoeldataset: ${dataset.filename} ${grijs(`AIRAC ${dataset.airac} · ${dataset.id}`)} — ${gebieden?.length ?? 0} gebieden\n`
);

/* ---------------------------------------------------------------- matchen -- */

type Gebied = NonNullable<typeof gebieden>[number];

const perDesignator = new Map<string, Gebied[]>();
for (const g of gebieden ?? []) {
  const lijst = perDesignator.get(g.ident);
  if (lijst) lijst.push(g);
  else perDesignator.set(g.ident, [g]);
}

const gevonden: { rij: ExcelRij; gebied: Gebied }[] = [];
const ontbreekt: ExcelRij[] = [];
const onbeslist: { rij: ExcelRij; kandidaten: Gebied[] }[] = [];

for (const rij of excelRijen) {
  const kandidaten = perDesignator.get(rij.designator);
  if (!kandidaten?.length) {
    ontbreekt.push(rij);
    continue;
  }
  if (kandidaten.length === 1) {
    gevonden.push({ rij, gebied: kandidaten[0] });
    continue;
  }
  const opNaam = kandidaten.filter(
    (k) => (k.name ?? "").trim().toUpperCase() === rij.volledigeNaam.toUpperCase()
  );
  if (opNaam.length === 1) gevonden.push({ rij, gebied: opNaam[0] });
  else onbeslist.push({ rij, kandidaten });
}

console.log(`${groen(String(gevonden.length))} gebieden gematcht op designator.`);

if (onbeslist.length) {
  console.log(`\n${geel(`${onbeslist.length} onbeslist`)} — designator komt meer dan eens voor, naam gaf geen uitsluitsel:`);
  for (const { rij, kandidaten } of onbeslist) {
    console.log(`  ${rij.areaId} ${rij.designator} "${rij.volledigeNaam}"`);
    for (const k of kandidaten) console.log(grijs(`      ${k.type ?? "—"}  "${k.name ?? ""}"  ${k.id}`));
  }
}

if (ontbreekt.length) {
  console.log(`\n${geel(`${ontbreekt.length} niet gevonden`)} — deze designator staat niet in dit AIXM-bestand:`);
  for (const rij of ontbreekt) {
    console.log(`  ${rij.areaId} ${rij.designator} ${grijs(`"${rij.volledigeNaam}"`)}`);
  }
}

if (!gevonden.length) {
  console.error(rood("\nNiets te schrijven.\n"));
  process.exit(1);
}

if (!schrijven) {
  console.log(`\n${geel("Proefdraai")} — er is niets gewijzigd. Voeg ${grijs("--schrijf")} toe om door te voeren.\n`);
  process.exit(0);
}

/* --------------------------------------------------------------- wegzetten -- */

const { count: oud } = await admin
  .from("lara_areas")
  .select("id", { count: "exact", head: true })
  .eq("dataset_id", dataset.id);

const { error: wisFout } = await admin.from("lara_areas").delete().eq("dataset_id", dataset.id);
if (wisFout) {
  console.error(rood(`\nWissen van de oude selectie mislukte: ${wisFout.message}\n`));
  process.exit(1);
}
console.log(`\nOude selectie verwijderd (${oud ?? 0} gebieden).`);

// In blokken: één insert van honderden rijen loopt tegen de payloadgrens aan.
const blokken = 200;
for (let i = 0; i < gevonden.length; i += blokken) {
  const { error } = await admin.from("lara_areas").insert(
    gevonden.slice(i, i + blokken).map(({ rij, gebied }) => ({
      dataset_id: dataset.id,
      airspace_id: gebied.id,
      lara_area_id: rij.areaId,
    }))
  );
  if (error) {
    console.error(rood(`\nWegschrijven mislukte bij rij ${i + 1}: ${error.message}\n`));
    process.exit(1);
  }
}

const { count: nieuw } = await admin
  .from("lara_areas")
  .select("id", { count: "exact", head: true })
  .eq("dataset_id", dataset.id);

console.log(`${groen("Opgeslagen.")} De selectie van deze dataset bevat nu ${nieuw} gebieden, allemaal genummerd.\n`);

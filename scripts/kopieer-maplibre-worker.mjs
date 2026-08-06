/**
 * De MapLibre-worker naar public/ zetten.
 *
 * MapLibre draait het zware werk — tegels ontleden, geometrie voorbereiden — in
 * een web worker, en laadt die met `new Worker(url, { type: "module" })`. Die
 * URL wordt door de bundler ingevuld, en Turbopack laat dat bestand buiten de
 * build. Het gevolg is een verzoek naar een pad dat niet bestaat: de server
 * antwoordt met de HTML van een 404-pagina, en de browser weigert dat als
 * module — "non-JavaScript MIME type of text/html".
 *
 * Daarom zetten we de worker als gewoon bestand neer en wijzen we MapLibre er
 * met `setWorkerUrl` naartoe. De worker importeert `./maplibre-gl-shared.mjs`,
 * dus dat bestand moet ernaast staan.
 *
 * Draait bij elke install en build, zodat de kopie niet achterloopt op het
 * pakket.
 */
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const wortel = join(dirname(fileURLToPath(import.meta.url)), "..");
const bron = join(wortel, "node_modules", "maplibre-gl", "dist");
const doel = join(wortel, "public", "maplibre");

const BESTANDEN = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

if (!existsSync(bron)) {
  console.warn("maplibre-gl niet gevonden; worker niet gekopieerd.");
  process.exit(0);
}

mkdirSync(doel, { recursive: true });
for (const naam of BESTANDEN) {
  copyFileSync(join(bron, naam), join(doel, naam));
}
console.log(`MapLibre-worker gekopieerd naar public/maplibre/ (${BESTANDEN.length} bestanden)`);

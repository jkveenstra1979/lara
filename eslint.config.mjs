import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * De AIXM-bestanden hieronder zijn ongewijzigd overgenomen uit
 * Airspace_management. Dat is opzet: bij een parserfix daar moet een diff hier
 * leesbaar blijven. Ze omschrijven om de linter tevreden te stellen zou dat
 * kapotmaken — en het gaat om code die door een XML-boom loopt waarvan de vorm
 * per AIXM-leverancier verschilt, precies het geval waarvoor `any` bestaat.
 *
 * Nieuwe code valt hier niet onder en wordt gewoon gecontroleerd.
 */
const OVERGENOMEN_PARSER = [
  "lib/aixmParser.ts",
  "lib/aixmGeometryAdvanced.ts",
  "lib/aixmGeojsonExport.ts",
  "lib/airspaceGeometryAggregator.ts",
  "lib/airspaceGeometryTransitive.ts",
  "lib/airspaceTransitiveResolve.ts",
  "lib/geometryPretty.ts",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Kopie van maplibre-gl uit node_modules; wordt bij install en build
    // neergezet door scripts/kopieer-maplibre-worker.mjs.
    "public/maplibre/**",
    // Wegwerpproeven tegen de echte snapshot; staan ook niet in git.
    "scripts/.tmp/**",
  ]),
  {
    files: OVERGENOMEN_PARSER,
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "warn",
    },
  },
]);

export default eslintConfig;

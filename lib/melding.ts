/**
 * De categorieën van een melding.
 *
 * Staan hier en niet in de route: de knop is een client component, en die mag
 * niets uit een routebestand importeren — dan trekt de bundel de server-only
 * Supabase-client mee.
 */
export const CATEGORIEEN = [
  "Fout in de export",
  "Fout in de gebiedsgegevens",
  "Verkeerde vorm of coördinaten",
  "Werkt niet",
  "Suggestie",
  "Overig",
] as const;

export type Categorie = (typeof CATEGORIEEN)[number];

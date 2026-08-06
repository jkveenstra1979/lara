/**
 * Datums en tijden tonen.
 *
 * Altijd met een expliciete tijdzone. Zonder die opgave gebruikt de omgeving
 * zijn eigen instelling: de server draait in UTC, de browser in Amsterdam. Bij
 * server-side rendering levert dat twee verschillende teksten voor hetzelfde
 * tijdstip op, en dat is precies wat React als hydration-fout meldt (#418).
 *
 * Nederlandse tijd, want dit zijn administratieve momenten — wanneer iemand iets
 * heeft geïmporteerd of uitgenodigd. De tijden ín de luchtruimgegevens zelf
 * blijven staan zoals AIXM ze aanlevert; die worden hier niet omgerekend.
 */

const ZONE = "Europe/Amsterdam";

/** `06-08-2026` */
export function toonDatum(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("nl-NL", {
    timeZone: ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** `06-08-2026 14:22` */
export function toonDatumTijd(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // nl-NL zet een komma tussen datum en tijd; de mockup schrijft ze zonder.
  return d
    .toLocaleString("nl-NL", {
      timeZone: ZONE,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(",", "");
}

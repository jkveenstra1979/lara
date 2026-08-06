import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { haalExportSet } from "@/lib/exportData";
import { bepaalBevindingen, telBevindingen, type Bevinding } from "@/lib/exportBevindingen";
import { exportBestandsnaam } from "@/lib/laraWorkbook";
import { extractTimesheets, timesheetsNaarLara } from "@/lib/laraTimesheets";
import styles from "./page.module.css";

export const metadata = { title: "Exporteren — LARA Areas" };

const TEKEN: Record<Bevinding["ernst"], { teken: string; klasse: string }> = {
  blokkeert: { teken: "✕", klasse: styles.tekenBlokkeert },
  "let op": { teken: "!", klasse: styles.tekenLetOp },
  "in orde": { teken: "✓", klasse: styles.tekenOk },
};

export default async function ExporterenPagina() {
  const supabase = await createClient();

  const { data: datasets } = await supabase
    .from("datasets")
    .select("id, is_active, status")
    .order("uploaded_at", { ascending: false });

  const alle = datasets ?? [];
  const gekozen = alle.find((d) => d.is_active) ?? alle.find((d) => d.status === "done") ?? null;
  if (!gekozen) redirect("/importeren");

  const { set } = await haalExportSet(supabase, gekozen.id);
  if (!set) redirect("/importeren");

  const bevindingen = bepaalBevindingen(set.voorBevindingen);
  const telling = telBevindingen(bevindingen);

  // Dezelfde telling als het werkboek maakt, zonder het bestand te bouwen.
  const volumeRijen = set.gebieden.reduce((n, g) => n + g.volumes.length, 0);
  const timesheetRijen = set.gebieden.reduce(
    (n, g) => n + timesheetsNaarLara(extractTimesheets(g.xmlSnippet)).rijen.length,
    0
  );

  const naam = (ext: string) => exportBestandsnaam(set.dataset.airac, ext);
  const url = (soort: string) => `/api/export/${soort}?datasetId=${set.dataset.id}`;

  if (!set.gebieden.length) {
    return (
      <div className={styles.work}>
        <section>
          <div className="sectionHead">
            <span className="sectionLabel">01 · Controle vóór export</span>
            <span className="rule" />
          </div>
          <div className={styles.paneel} style={{ marginTop: 14 }}>
            <div className={styles.leeg}>
              De LARA-lijst is leeg — er valt niets te exporteren.
              <br />
              Kies gebieden op het scherm <Link href="/gebieden">Gebieden</Link>.
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.work}>
      <section>
        <div className="sectionHead">
          <span className="sectionLabel">01 · Controle vóór export</span>
          <span className="rule" />
          <span className="meta">{set.gebieden.length} gebieden in de LARA-lijst</span>
        </div>

        <div style={{ paddingTop: 14 }} className={styles.rooster}>
          <div className={styles.paneel}>
            <div className={styles.paneelKop}>
              <span className="sectionLabel">Bevindingen</span>
              <span className="spacer" />
              {telling.blokkeert > 0 ? (
                <span className="badge badgeFout">
                  {telling.blokkeert} blokkeert · {telling.letOp} aandachtspunt
                  {telling.letOp === 1 ? "" : "en"}
                </span>
              ) : telling.letOp > 0 ? (
                <span className="badge badgeWarn">
                  {telling.letOp} aandachtspunt{telling.letOp === 1 ? "" : "en"}
                </span>
              ) : (
                <span className="badge badgeOk">in orde</span>
              )}
            </div>

            {bevindingen.map((b, i) => (
              <div key={i} className={styles.rij}>
                <span className={`${styles.teken} ${TEKEN[b.ernst].klasse}`}>
                  {TEKEN[b.ernst].teken}
                </span>
                <span>
                  <span className={styles.kop}>{b.kop}</span>
                  {b.toelichting && <div className={styles.toelichting}>{b.toelichting}</div>}
                  {b.gebieden && b.gebieden.length > 0 && (
                    <div className={styles.gebieden}>
                      {b.gebieden.slice(0, 25).join(" · ")}
                      {b.gebieden.length > 25 ? ` … en nog ${b.gebieden.length - 25}` : ""}
                    </div>
                  )}
                </span>
              </div>
            ))}
          </div>

          <div className={styles.paneel}>
            <div className={styles.paneelKop}>
              <span className="sectionLabel">Werkboek</span>
              <span className="spacer" />
              <span className="meta">{naam("xlsx")}</span>
            </div>
            <div className={styles.sheetLijst}>
              <div className={styles.sheetRij}>
                <span>Areas</span>
                <span>{set.gebieden.length} rijen</span>
              </div>
              <div className={styles.sheetRij}>
                <span>Area Volumes</span>
                <span>{volumeRijen} rijen</span>
              </div>
              <div className={styles.sheetRij}>
                <span>Area Timesheets</span>
                <span>{timesheetRijen} rijen</span>
              </div>
            </div>
            <div className={styles.noot}>
              Drie werkbladen, geen lege. Van de 34 kolommen in <span className="mono">Areas</span>{" "}
              zijn er zes verplicht; de rest laten we leeg, zodat LARA de standaardwaarden gebruikt
              die daar zijn ingesteld.
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="sectionHead">
          <span className="sectionLabel">02 · Downloaden</span>
          <span className="rule" />
        </div>

        <div style={{ paddingTop: 14 }} className={styles.knoppen}>
          <a className="btn btnPrimary" href={url("lara")} download>
            Exporteer LARA V4 (.xlsx)
          </a>
          <a className="btn" href={url("kml")} download>
            LARA-selectie als KML
          </a>
          <a className="btn" href={url("geojson")} download>
            LARA-selectie als GeoJSON
          </a>
          <span className="spacer" />
          <span className={styles.bestandsnaam}>
            {naam("xlsx")} · {naam("kml")} · {naam("geojson")}
          </span>
        </div>

        <p className="lead" style={{ paddingTop: 12 }}>
          De export gaat over de gebieden in de LARA-lijst, niet over alles uit het
          AIXM-bestand. Het formaat volgt{" "}
          <span className="mono">LARA V4.0 Excel Airspace Import Format</span>; wat er nog
          nagelopen moet worden in LARA staat in{" "}
          <span className="mono">docs/TESTPLAN.md</span>.
        </p>
      </section>
    </div>
  );
}

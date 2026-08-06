"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toonDatumTijd } from "@/lib/datum";
import type { ImportSamenvatting } from "@/lib/aixmImport";
import type { OvernameResultaat } from "@/lib/overnemen";
import styles from "./page.module.css";

type Fase = "leeg" | "uploaden" | "verwerken" | "klaar" | "fout";

export type DatasetRij = {
  id: string;
  filename: string;
  airac: string;
  status: string;
  error_message: string | null;
  airspace_count: number;
  is_active: boolean;
  uploaded_at: string;
  in_lara: number;
};

export default function ImportForm({ datasets }: { datasets: DatasetRij[] }) {
  const [bestand, setBestand] = useState<File | null>(null);
  const [airac, setAirac] = useState("");
  const [fase, setFase] = useState<Fase>("leeg");
  const [fout, setFout] = useState<string | null>(null);
  const [samenvatting, setSamenvatting] = useState<ImportSamenvatting | null>(null);
  const [overname, setOvername] = useState<OvernameResultaat | null>(null);
  const [sleep, setSleep] = useState(false);
  const [herverwerkt, setHerverwerkt] = useState<string | null>(null);
  const [herbezig, setHerbezig] = useState<string | null>(null);
  const invoer = useRef<HTMLInputElement>(null);

  const airacGeldig = /^\d{4}$/.test(airac);
  const bezig = fase === "uploaden" || fase === "verwerken";
  const kanVersturen = Boolean(bestand) && airacGeldig && !bezig;

  /**
   * Eerst het bestand rechtstreeks in de bucket, dan pas de route aanroepen.
   *
   * Het bestand door de request body sturen werkt lokaal maar niet op Vercel:
   * daar worden bodies boven 4,5 MB afgekapt met een 413 in platte tekst.
   *
   * En het gaat gecomprimeerd. Een AIXM-bestand is grotendeels herhaling —
   * 96 MB wordt 8,4 MB — en de storage-service heeft standaard een grens van
   * 50 MB per bestand, ongeacht wat er op de bucket staat ingesteld. Zo past
   * elk realistisch bestand, en de upload is bovendien tien keer sneller.
   */
  const verstuur = async () => {
    if (!bestand || !airacGeldig) return;
    setFout(null);
    setSamenvatting(null);
    setOvername(null);
    setFase("uploaden");

    try {
      const supabase = createClient();

      // CompressionStream is standaard in moderne browsers; ontbreekt hij, dan
      // gaat het bestand ongecomprimeerd en geldt de grens van de server.
      let teUploaden: Blob = bestand;
      let naam = bestand.name;
      if (typeof CompressionStream !== "undefined") {
        const gz = bestand.stream().pipeThrough(new CompressionStream("gzip"));
        teUploaden = await new Response(gz).blob();
        naam = `${bestand.name}.gz`;
      }

      const storagePath = `${crypto.randomUUID()}/${naam}`;
      const upload = await supabase.storage.from("aixm-uploads").upload(storagePath, teUploaden, {
        contentType: naam.endsWith(".gz") ? "application/gzip" : "application/xml",
        upsert: true,
      });
      if (upload.error) {
        throw new Error(
          /exceeded the maximum allowed size/i.test(upload.error.message)
            ? `Het bestand is te groot voor de opslag, ook ingepakt (${(teUploaden.size / 1024 / 1024).toFixed(0)} MB). Verhoog FILE_SIZE_LIMIT in de storage-service.`
            : `Uploaden mislukte: ${upload.error.message}`
        );
      }

      setFase("verwerken");
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath, filename: bestand.name, airac }),
      });

      // Een platform-fout (413, 504) komt niet als JSON terug.
      const tekst = await res.text();
      let data: { error?: string; samenvatting?: ImportSamenvatting; overname?: OvernameResultaat | null } = {};
      try {
        data = JSON.parse(tekst);
      } catch {
        throw new Error(
          res.status === 413
            ? "Het bestand is te groot voor de server."
            : `De server antwoordde met ${res.status}: ${tekst.slice(0, 120)}`
        );
      }

      if (!res.ok) throw new Error(data.error ?? "De import is mislukt.");
      setSamenvatting(data.samenvatting as ImportSamenvatting);
      setOvername(data.overname ?? null);
      setFase("klaar");
    } catch (error) {
      setFout(error instanceof Error ? error.message : "De import is mislukt.");
      setFase("fout");
    }
  };

  /**
   * Een eerdere import opnieuw verwerken uit het bewaarde bestand.
   *
   * Nodig als het uitlezen is verbeterd: de brondata is dan dezelfde, maar wat
   * eruit komt niet. Scheelt het opnieuw uploaden van tientallen megabytes, en
   * de LARA-selectie blijft staan.
   */
  const herverwerk = async (dataset: DatasetRij) => {
    setHerbezig(dataset.id);
    setHerverwerkt(null);
    setFout(null);
    try {
      const res = await fetch(`/api/datasets/${dataset.id}/herverwerken`, { method: "POST" });
      const tekst = await res.text();
      let data: { error?: string; samenvatting?: ImportSamenvatting; selectie?: { hersteld: number } } = {};
      try {
        data = JSON.parse(tekst);
      } catch {
        throw new Error(`De server antwoordde met ${res.status}: ${tekst.slice(0, 120)}`);
      }
      if (!res.ok) throw new Error(data.error ?? "Opnieuw verwerken mislukte.");
      setSamenvatting(data.samenvatting as ImportSamenvatting);
      setHerverwerkt(
        `${dataset.filename} is opnieuw verwerkt` +
          (data.selectie ? ` — ${data.selectie.hersteld} gebieden in de LARA-lijst behouden.` : ".")
      );
      setFase("klaar");
    } catch (error) {
      setFout(error instanceof Error ? error.message : "Opnieuw verwerken mislukte.");
      setFase("fout");
    } finally {
      setHerbezig(null);
    }
  };

  return (
    <div className={styles.work}>
      {/* ---------------------------------------------------------- bestand -- */}
      <section>
        <div className="sectionHead">
          <span className="sectionLabel">01 · AIXM-bestand</span>
          <span className="rule" />
          <span className="meta">AIXM 5.1 · .xml · max 200 MB</span>
        </div>

        <div style={{ paddingTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            className={`${styles.drop} ${sleep ? styles.dropActief : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setSleep(true);
            }}
            onDragLeave={() => setSleep(false)}
            onDrop={(e) => {
              e.preventDefault();
              setSleep(false);
              const f = e.dataTransfer.files?.[0];
              if (f) setBestand(f);
            }}
          >
            <span className={styles.dropTitel}>Sleep het AIXM-bestand hierheen</span>
            <div className={styles.dropHint}>
              het bestand wordt bewaard, zodat de import later herhaald kan worden
            </div>
            {bestand && (
              <div className={styles.gekozen}>
                {bestand.name} · {(bestand.size / 1024 / 1024).toFixed(1)} MB
              </div>
            )}
            <input
              ref={invoer}
              type="file"
              accept=".xml,text/xml,application/xml"
              hidden
              onChange={(e) => setBestand(e.target.files?.[0] ?? null)}
            />
            <button type="button" className="btn btnPrimary" onClick={() => invoer.current?.click()}>
              {bestand ? "Ander bestand kiezen" : "Bestand kiezen"}
            </button>
          </div>

          <div className={styles.velden}>
            <div className={styles.airacVeld}>
              <label className="field" htmlFor="airac">
                AIRAC-cyclus <span className={styles.verplicht}>·</span> verplicht
              </label>
              <input
                id="airac"
                className="monoField"
                type="text"
                inputMode="numeric"
                placeholder="jjcc"
                maxLength={4}
                value={airac}
                onChange={(e) => setAirac(e.target.value.replace(/\D/g, ""))}
              />
            </div>

            <button
              type="button"
              className="btn btnPrimary"
              disabled={!kanVersturen}
              onClick={verstuur}
            >
              {fase === "uploaden"
                ? "Bestand uploaden…"
                : fase === "verwerken"
                  ? "Inlezen en opslaan…"
                  : "Importeren"}
            </button>

            <p className="lead" style={{ fontSize: 12, paddingBottom: 8 }}>
              De cyclus wordt niet uit de bestandsnaam afgeleid; hij bepaalt de naam van het
              exportbestand (<span className="mono">LARAV4_{airac || "jjcc"}_…xlsx</span>).
            </p>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- resultaat -- */}
      {(bezig || fase === "klaar" || fase === "fout") && (
        <section>
          <div className="sectionHead">
            <span className="sectionLabel">02 · Verwerking</span>
            <span className="rule" />
            {bestand && (
              <span className="meta">
                {bestand.name} · {(bestand.size / 1024 / 1024).toFixed(1)} MB
              </span>
            )}
          </div>

          <div style={{ paddingTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
            <div className={styles.voortgang}>
              <div
                className={styles.voortgangVulling}
                style={{ width: fase === "uploaden" ? "35%" : fase === "verwerken" ? "75%" : "100%" }}
              />
            </div>

            {fase === "fout" && (
              <div className={`${styles.melding} ${styles.meldingFout}`}>
                <span className={styles.teken}>✕</span>
                <span>{fout}</span>
              </div>
            )}

            {samenvatting && (
              <>
                <div className={styles.cijfers}>
                  <div className={styles.cel}>
                    <div className={styles.getal}>{samenvatting.airspaces}</div>
                    <div className={styles.label}>Airspaces</div>
                  </div>
                  <div className={styles.cel}>
                    <div className={styles.getal}>{samenvatting.metGeometrie}</div>
                    <div className={styles.label}>Met geometrie</div>
                  </div>
                  <div className={styles.cel}>
                    <div
                      className={`${styles.getal} ${samenvatting.onopgelost ? styles.getalWarn : ""}`}
                    >
                      {samenvatting.onopgelost}
                    </div>
                    <div className={styles.label}>Onopgelost</div>
                  </div>
                  <div className={styles.cel}>
                    <div className={styles.getal}>{samenvatting.geobordersUitBestand}</div>
                    <div className={styles.label}>Geoborders</div>
                  </div>
                  <div className={styles.cel}>
                    <div className={styles.getal}>{samenvatting.gebiedenMetMeerdereVolumes}</div>
                    <div className={styles.label}>Meerdere volumes</div>
                  </div>
                </div>

                {samenvatting.onopgelosteGrenzen.length > 0 ? (
                  <div className={`${styles.melding} ${styles.meldingFout}`}>
                    <span className={styles.teken}>!</span>
                    <span>
                      <strong>
                        {samenvatting.onopgelosteGrenzen.length} landsgrens
                        {samenvatting.onopgelosteGrenzen.length === 1 ? "" : "en"} niet gevonden.
                      </strong>{" "}
                      De gebieden hieronder verwijzen naar een grens die niet in dit bestand staat en
                      ook niet bekend is. Hun vorm is gesloten met een <em>rechte lijn</em> — de
                      export bevat dan verkeerde coördinaten, niet ontbrekende. Laad de bijbehorende
                      geoborder en importeer opnieuw.
                      <ul className={styles.grenslijst}>
                        {samenvatting.onopgelosteGrenzen.map((g) => (
                          <li key={g.uuid}>
                            {g.uuid} → {g.gebieden.join(", ")}
                          </li>
                        ))}
                      </ul>
                    </span>
                  </div>
                ) : (
                  <div className={`${styles.melding} ${styles.meldingOk}`}>
                    <span className={styles.teken}>✓</span>
                    <span>
                      Alle verwijzingen naar landsgrenzen zijn opgelost
                      {samenvatting.geobordersUitBestand > 0
                        ? ` (${samenvatting.geobordersUitBestand} uit dit bestand`
                        : " (geen in dit bestand"}
                      {samenvatting.geobordersUitTabel > 0
                        ? `, ${samenvatting.geobordersUitTabel} al bekend).`
                        : ")."}
                    </span>
                  </div>
                )}

                {herverwerkt && (
                  <div className={`${styles.melding} ${styles.meldingOk}`}>
                    <span className={styles.teken}>✓</span>
                    <span>{herverwerkt}</span>
                  </div>
                )}

                {overname && (
                  <div className={`${styles.melding} ${styles.meldingOk}`}>
                    <span className={styles.teken}>→</span>
                    <span>
                      De LARA-lijst is overgenomen van{" "}
                      <span className="mono">{overname.bronFilename}</span> (AIRAC{" "}
                      {overname.bronAirac}): <strong>{overname.overgenomen} gebieden</strong> met
                      hun Area ID.
                      {overname.vervallen.length > 0 && (
                        <>
                          {" "}
                          <strong>{overname.vervallen.length} vervallen</strong> — die designators
                          komen niet meer voor in dit bestand:{" "}
                          {overname.vervallen
                            .slice(0, 8)
                            .map((v) => `${v.ident}${v.laraAreaId ? ` (${v.laraAreaId})` : ""}`)
                            .join(", ")}
                          {overname.vervallen.length > 8 ? " …" : ""}. Hun nummers zijn vrij.
                        </>
                      )}
                    </span>
                  </div>
                )}

                {samenvatting.gebiedenMetMeerdereVolumes > 0 && (
                  <div className={`${styles.melding} ${styles.meldingWarn}`}>
                    <span className={styles.teken}>!</span>
                    <span>
                      {samenvatting.gebiedenMetMeerdereVolumes} gebieden zijn uit meerdere volumes
                      opgebouwd; sheet 2 (<span className="mono">Area Volumes</span>) krijgt daardoor{" "}
                      {samenvatting.volumes} rijen voor {samenvatting.airspaces} gebieden.
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {/* ---------------------------------------------------- eerdere imports -- */}
      <section>
        <div className="sectionHead">
          <span className="sectionLabel">03 · Eerdere imports</span>
          <span className="rule" />
          <span className="meta">{datasets.length} datasets</span>
        </div>

        <div style={{ paddingTop: 14 }} className={styles.tabelRand}>
          <table>
            <thead>
              <tr>
                <th>Bestand</th>
                <th style={{ width: 70 }}>AIRAC</th>
                <th style={{ width: 140 }}>Geïmporteerd</th>
                <th className="numeric" style={{ width: 90 }}>
                  Airspaces
                </th>
                <th className="numeric" style={{ width: 80 }}>
                  In LARA
                </th>
                <th style={{ width: 110 }} />
                <th style={{ width: 150 }} />
              </tr>
            </thead>
            <tbody>
              {datasets.length === 0 && (
                <tr>
                  <td colSpan={7} className="dim">
                    Nog geen imports.
                  </td>
                </tr>
              )}
              {datasets.map((d) => (
                <tr key={d.id} data-selected={d.is_active}>
                  <td className="ident">{d.filename}</td>
                  <td className="dim mono">{d.airac}</td>
                  <td className="dim">{toonDatumTijd(d.uploaded_at)}</td>
                  <td className="numeric">{d.airspace_count}</td>
                  <td className="numeric">{d.in_lara}</td>
                  <td>
                    {d.status === "error" ? (
                      <span className="badge badgeFout" title={d.error_message ?? undefined}>
                        fout
                      </span>
                    ) : d.is_active ? (
                      <span className="badge badgeOk">actief</span>
                    ) : (
                      <span className="badge badgeQuiet">{d.status}</span>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btnSmall"
                      disabled={herbezig !== null}
                      title="Het bewaarde bestand opnieuw uitlezen. De LARA-selectie blijft staan."
                      onClick={() => herverwerk(d)}
                    >
                      {herbezig === d.id ? "Bezig…" : "Opnieuw verwerken"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import type { ImportSamenvatting } from "@/lib/aixmImport";
import styles from "./page.module.css";

type Fase = "leeg" | "bezig" | "klaar" | "fout";

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

const datumKort = (iso: string) =>
  new Date(iso).toLocaleString("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function ImportForm({ datasets }: { datasets: DatasetRij[] }) {
  const [bestand, setBestand] = useState<File | null>(null);
  const [airac, setAirac] = useState("");
  const [fase, setFase] = useState<Fase>("leeg");
  const [fout, setFout] = useState<string | null>(null);
  const [samenvatting, setSamenvatting] = useState<ImportSamenvatting | null>(null);
  const [sleep, setSleep] = useState(false);
  const invoer = useRef<HTMLInputElement>(null);

  const airacGeldig = /^\d{4}$/.test(airac);
  const kanVersturen = Boolean(bestand) && airacGeldig && fase !== "bezig";

  const verstuur = async () => {
    if (!bestand || !airacGeldig) return;
    setFase("bezig");
    setFout(null);
    setSamenvatting(null);

    const body = new FormData();
    body.append("file", bestand);
    body.append("airac", airac);

    try {
      const res = await fetch("/api/upload", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setFout(data.error ?? "De import is mislukt.");
        setFase("fout");
        return;
      }
      setSamenvatting(data.samenvatting as ImportSamenvatting);
      setFase("klaar");
    } catch (error) {
      setFout(error instanceof Error ? error.message : "De import is mislukt.");
      setFase("fout");
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
              {fase === "bezig" ? "Bezig met inlezen…" : "Importeren"}
            </button>

            <p className="lead" style={{ fontSize: 12, paddingBottom: 8 }}>
              De cyclus wordt niet uit de bestandsnaam afgeleid; hij bepaalt de naam van het
              exportbestand (<span className="mono">LARAV4_{airac || "jjcc"}_…xlsx</span>).
            </p>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- resultaat -- */}
      {(fase === "bezig" || fase === "klaar" || fase === "fout") && (
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
                style={{ width: fase === "bezig" ? "60%" : "100%" }}
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
              </tr>
            </thead>
            <tbody>
              {datasets.length === 0 && (
                <tr>
                  <td colSpan={6} className="dim">
                    Nog geen imports.
                  </td>
                </tr>
              )}
              {datasets.map((d) => (
                <tr key={d.id} data-selected={d.is_active}>
                  <td className="ident">{d.filename}</td>
                  <td className="dim mono">{d.airac}</td>
                  <td className="dim">{datumKort(d.uploaded_at)}</td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

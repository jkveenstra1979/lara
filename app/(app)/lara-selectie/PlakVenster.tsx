"use client";

import { useState } from "react";
import { parseBulkLijst } from "@/lib/bulkNummers";
import styles from "./page.module.css";

type Uitslag = {
  toegepast: number;
  onbekend: string[];
  fouten: { regel: number; tekst: string; reden: string }[];
};

/**
 * Een lijst plakken: toevoegen én nummeren in één handeling.
 *
 * Vóór het versturen wordt de tekst al gelezen, zodat je ziet wat er gaat
 * gebeuren. Wat de server daarna meldt is wat er écht is gebeurd — inclusief de
 * designators die in deze dataset niet bestaan.
 */
export default function PlakVenster({
  datasetId,
  onSluiten,
  onKlaar,
}: {
  datasetId: string;
  onSluiten: () => void;
  onKlaar: () => void;
}) {
  const [tekst, setTekst] = useState("");
  const [bezig, setBezig] = useState(false);
  const [uitslag, setUitslag] = useState<Uitslag | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  const vooraf = parseBulkLijst(tekst);

  const verstuur = async () => {
    setBezig(true);
    setFout(null);
    try {
      const res = await fetch("/api/lara-areas/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasetId, tekst }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Verwerken mislukt.");
      setUitslag(data as Uitslag);
    } catch (error) {
      setFout(error instanceof Error ? error.message : "Verwerken mislukt.");
    } finally {
      setBezig(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onSluiten}>
      <div className={styles.modaal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modaalKop}>
          <span className="sectionLabel">Lijst plakken</span>
          <p className="lead" style={{ fontSize: 12, marginTop: 6 }}>
            Eén gebied per regel, met de designator en het nummer. De volgorde maakt niet
            uit: <span className="mono">1,EHR1</span> en <span className="mono">EHR1 1</span>{" "}
            lezen allebei goed. Gebieden die nog niet in de lijst staan worden toegevoegd.
          </p>
        </div>

        <div className={styles.modaalBody}>
          <textarea
            className={styles.plakveld}
            value={tekst}
            onChange={(e) => {
              setTekst(e.target.value);
              setUitslag(null);
            }}
            placeholder={"1,EHR1\n2,EHR2\n7,EHTRA10"}
            autoFocus
          />

          {!uitslag && tekst.trim() && (
            <div className={styles.uitslag}>
              <div>{vooraf.toewijzingen.length} regels gelezen</div>
              {vooraf.fouten.map((f) => (
                <div key={f.regel} className={styles.uitslagFout}>
                  regel {f.regel}: {f.reden} — <span style={{ opacity: 0.7 }}>{f.tekst}</span>
                </div>
              ))}
            </div>
          )}

          {uitslag && (
            <div className={styles.uitslag}>
              <div>{uitslag.toegepast} gebieden toegevoegd en genummerd</div>
              {uitslag.onbekend.length > 0 && (
                <div className={styles.uitslagWarn}>
                  {uitslag.onbekend.length} designator(s) komen niet voor in deze dataset:{" "}
                  {uitslag.onbekend.join(", ")}
                </div>
              )}
              {uitslag.fouten.map((f) => (
                <div key={f.regel} className={styles.uitslagFout}>
                  regel {f.regel}: {f.reden}
                </div>
              ))}
            </div>
          )}

          {fout && <div className={`${styles.uitslag} ${styles.uitslagFout}`}>{fout}</div>}
        </div>

        <div className={styles.modaalVoet}>
          {uitslag ? (
            <button type="button" className="btn btnPrimary" onClick={onKlaar}>
              Klaar
            </button>
          ) : (
            <button
              type="button"
              className="btn btnPrimary"
              disabled={bezig || !vooraf.toewijzingen.length}
              onClick={verstuur}
            >
              {bezig ? "Bezig…" : `${vooraf.toewijzingen.length} toepassen`}
            </button>
          )}
          <button type="button" className="btn" onClick={onSluiten}>
            {uitslag ? "Sluiten" : "Annuleren"}
          </button>
        </div>
      </div>
    </div>
  );
}

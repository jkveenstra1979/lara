"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { CATEGORIEEN } from "@/lib/melding";
import styles from "./meldknop.module.css";

/**
 * Een melding maken zonder het scherm te verlaten. De route maakt er een
 * GitHub-issue van.
 *
 * De knop staat in de voetbalk en dus op elk scherm. Het pad en de actieve
 * dataset gaan automatisch mee: bij "dit klopt niet" is de eerste vraag altijd
 * waar en waarover.
 */

type Stand = "dicht" | "open" | "bezig" | "klaar" | "fout";

export default function MeldKnop({ dataset }: { dataset: string | null }) {
  const pad = usePathname();
  const [stand, setStand] = useState<Stand>("dicht");
  const [bericht, setBericht] = useState("");
  // Leeg begonnen: een categorie die er al staat wordt de categorie die je
  // meestuurt zonder erover na te denken.
  const [categorie, setCategorie] = useState("");
  const [fout, setFout] = useState("");
  const [issue, setIssue] = useState<{ nummer: number; url: string } | null>(null);

  const open = () => {
    setBericht("");
    setCategorie("");
    setFout("");
    setIssue(null);
    setStand("open");
  };

  const sluit = () => {
    if (stand !== "bezig") setStand("dicht");
  };

  const verstuur = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categorie || !bericht.trim()) return;
    setStand("bezig");
    setFout("");
    try {
      const res = await fetch("/api/melding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bericht: bericht.trim(), categorie, pagina: pad, dataset }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "De melding is niet verstuurd.");
      setIssue(data);
      setStand("klaar");
    } catch (error) {
      setFout(error instanceof Error ? error.message : "De melding is niet verstuurd.");
      setStand("fout");
    }
  };

  return (
    <>
      <button type="button" className={styles.knop} onClick={open}>
        Melding maken
      </button>

      {stand !== "dicht" && (
        <div className={styles.overlay} onClick={sluit}>
          <div className={styles.modaal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.kop}>
              <span className="sectionLabel">Melding maken</span>
              <p className="lead" style={{ fontSize: 12, marginTop: 6 }}>
                Komt terecht als issue in de repository. Het scherm waar je nu staat en de
                actieve dataset gaan mee.
              </p>
            </div>

            {stand === "klaar" ? (
              <>
                <div className={styles.body}>
                  <p style={{ margin: 0, fontSize: 13 }}>
                    Verstuurd als issue <strong>#{issue?.nummer}</strong>.
                  </p>
                  {issue?.url && (
                    <p style={{ marginTop: 8, fontSize: 12 }}>
                      <a href={issue.url} target="_blank" rel="noreferrer">
                        Openen op GitHub ↗
                      </a>
                    </p>
                  )}
                </div>
                <div className={styles.voet}>
                  <span className="spacer" />
                  <button type="button" className="btn btnSmall btnPrimary" onClick={sluit}>
                    Sluiten
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={verstuur}>
                <div className={styles.body}>
                  <label className="field" htmlFor="meld-categorie">
                    Categorie
                  </label>
                  <select
                    id="meld-categorie"
                    value={categorie}
                    onChange={(e) => setCategorie(e.target.value)}
                    disabled={stand === "bezig"}
                    required
                  >
                    <option value="" disabled>
                      Selecteer type melding
                    </option>
                    {CATEGORIEEN.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>

                  <label className="field" htmlFor="meld-bericht" style={{ marginTop: 14 }}>
                    Omschrijving
                  </label>
                  <textarea
                    id="meld-bericht"
                    className={styles.veld}
                    placeholder="Wat gebeurde er, en wat verwachtte je?"
                    value={bericht}
                    onChange={(e) => setBericht(e.target.value)}
                    disabled={stand === "bezig"}
                    required
                    autoFocus
                  />

                  {stand === "fout" && <p className={styles.fout}>{fout}</p>}
                </div>

                <div className={styles.voet}>
                  <span className="meta">{pad}</span>
                  <span className="spacer" />
                  <button
                    type="button"
                    className="btn btnSmall"
                    onClick={sluit}
                    disabled={stand === "bezig"}
                  >
                    Annuleren
                  </button>
                  <button
                    type="submit"
                    className="btn btnSmall btnPrimary"
                    disabled={stand === "bezig" || !categorie || !bericht.trim()}
                  >
                    {stand === "bezig" ? "Versturen…" : "Versturen"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

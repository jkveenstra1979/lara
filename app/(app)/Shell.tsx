"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { toonDatumTijd } from "@/lib/datum";
import styles from "./shell.module.css";

/**
 * De vier stappen zijn de werkstroom. Ze staan in de rail én in de stappenbalk,
 * omdat de mockup allebei toont: de rail om ergens heen te springen, de balk om
 * te zien waar je bent.
 *
 * Stappen 2 tot 4 hebben een dataset nodig; zonder import is er niets te tonen.
 */
const STAPPEN = [
  { pad: "/importeren", num: "1", naam: "Importeren", vereistDataset: false },
  { pad: "/gebieden", num: "2", naam: "Gebieden", vereistDataset: true },
  { pad: "/lara-selectie", num: "3", naam: "LARA-selectie", vereistDataset: true },
  { pad: "/exporteren", num: "4", naam: "Exporteren", vereistDataset: true },
];

export type ShellDataset = {
  id: string;
  filename: string;
  airac: string;
  uploaded_at: string;
  airspace_count: number;
};

export default function Shell({
  children,
  email,
  rol,
  actief,
  aantalDatasets,
  inLara,
}: {
  children: React.ReactNode;
  email: string;
  rol: "admin" | "user";
  actief: ShellDataset | null;
  aantalDatasets: number;
  inLara: number;
}) {
  const pad = usePathname();

  return (
    <div className={styles.app}>
      <nav className={styles.rail} aria-label="Hoofdnavigatie">
        <div className={styles.brand}>
          <span className={styles.wordmark}>
            LARA<em>·</em>Areas
          </span>
          <span className={styles.tagline}>AIXM → LARA V4</span>
        </div>

        <div className={styles.groep}>
          <span className={`sectionLabel ${styles.groepLabel}`}>Werkstroom</span>
          {STAPPEN.map((stap) => {
            const uit = stap.vereistDataset && !actief;
            const aan = pad === stap.pad;
            const telling =
              stap.pad === "/gebieden"
                ? actief?.airspace_count
                : stap.pad === "/lara-selectie" || stap.pad === "/exporteren"
                  ? inLara
                  : undefined;

            if (uit) {
              return (
                <span key={stap.pad} className={`${styles.item} ${styles.itemUit}`}>
                  {stap.naam}
                </span>
              );
            }
            return (
              <Link
                key={stap.pad}
                href={stap.pad}
                className={`${styles.item} ${aan ? styles.itemActief : ""}`}
              >
                {stap.naam}
                {telling !== undefined && <span className={styles.telling}>{telling}</span>}
              </Link>
            );
          })}
        </div>

        <div className={styles.groep}>
          <span className={`sectionLabel ${styles.groepLabel}`}>Datasets</span>
          <Link href="/importeren" className={styles.item}>
            {aantalDatasets === 0 ? "Nog geen imports" : `${aantalDatasets} geïmporteerd`}
            <span className={styles.telling}>+</span>
          </Link>
        </div>

        {rol === "admin" && (
          <div className={styles.groep}>
            <span className={`sectionLabel ${styles.groepLabel}`}>Beheer</span>
            <Link
              href="/beheer/gebruikers"
              className={`${styles.item} ${pad === "/beheer/gebruikers" ? styles.itemActief : ""}`}
            >
              Gebruikers
            </Link>
          </div>
        )}

        <span className="spacer" />

        <div className={styles.railVoet}>
          <span className={styles.gebruiker}>{email}</span>
          <span className={styles.rol}>{rol === "admin" ? "beheerder" : "gebruiker"}</span>
        </div>
      </nav>

      <div className={styles.main}>
        <header className={styles.sessieBalk}>
          <span className="sectionLabel">Dataset</span>
          <span className={styles.project}>{actief ? actief.filename : "geen actieve dataset"}</span>
          {actief && (
            <>
              <span className={styles.scheiding} />
              <span className={styles.positie}>
                AIRAC {actief.airac} · geïmporteerd {toonDatumTijd(actief.uploaded_at)}
              </span>
            </>
          )}
          <span className="spacer" />
          {actief && (
            <span className="badge badgeQuiet">
              {inLara} in LARA · {actief.airspace_count} gebieden
            </span>
          )}
        </header>

        <nav className={styles.stapBalk} aria-label="Werkstroom">
          {STAPPEN.map((stap, i) => {
            const uit = stap.vereistDataset && !actief;
            const aan = pad === stap.pad;
            return (
              <div key={stap.pad} className={styles.stapWrap}>
                <Link
                  href={uit ? "#" : stap.pad}
                  className={`${styles.stap} ${uit ? styles.stapUit : ""}`}
                  aria-current={aan ? "step" : undefined}
                >
                  <span className={`${styles.stapNum} ${aan ? styles.stapNumAan : ""}`}>
                    {stap.num}
                  </span>
                  <span className={aan ? styles.stapLabelAan : styles.stapLabel}>{stap.naam}</span>
                </Link>
                {i < STAPPEN.length - 1 && <span className={styles.stapLijn} />}
              </div>
            );
          })}
        </nav>

        <div className={styles.werk}>{children}</div>

        <footer className={styles.voetBalk}>
          <span className="meta">
            {actief
              ? `${actief.airspace_count} gebieden · ${inLara} in LARA`
              : "importeer een AIXM-bestand om te beginnen"}
          </span>
          <span className="spacer" />
          <span className="meta">LARA Areas</span>
        </footer>
      </div>
    </div>
  );
}

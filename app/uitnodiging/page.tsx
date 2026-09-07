"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./page.module.css";

/**
 * Een uitnodiging inwisselen.
 *
 * Deze pagina staat buiten de applicatieschil en buiten de inlogbewaking — wie
 * hier komt heeft nog geen account. Het token uit de link is het enige bewijs;
 * de server controleert of het nog geldig en ongebruikt is.
 */
function Formulier() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const router = useRouter();

  const [naam, setNaam] = useState("");
  const [wachtwoord, setWachtwoord] = useState("");
  const [herhaal, setHerhaal] = useState("");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [klaar, setKlaar] = useState<string | null>(null);

  const langGenoeg = wachtwoord.length >= 10;
  const gelijk = wachtwoord === herhaal;
  const kanVersturen = Boolean(token) && langGenoeg && gelijk && !bezig;

  const verstuur = async () => {
    setBezig(true);
    setFout(null);
    try {
      const res = await fetch("/api/uitnodiging/accepteren", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, wachtwoord, naam }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Aanmaken mislukte.");
      setKlaar(data.email);
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Aanmaken mislukte.");
    } finally {
      setBezig(false);
    }
  };

  if (!token) {
    return (
      <main className={styles.card}>
        <div className={styles.head}>
          <span className={styles.wordmark}>
            LARA<em>·</em>Areas
          </span>
          <span className={styles.tagline}>AIXM → LARA</span>
        </div>
        <div style={{ paddingTop: 20 }}>
          <div className={styles.error}>
            Deze link is niet compleet. Vraag de beheerder om een nieuwe.
          </div>
        </div>
      </main>
    );
  }

  if (klaar) {
    return (
      <main className={styles.card}>
        <div className={styles.head}>
          <span className={styles.wordmark}>
            LARA<em>·</em>Areas
          </span>
          <span className={styles.tagline}>AIXM → LARA</span>
        </div>
        <div style={{ paddingTop: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div className={styles.ok}>
            Je account is klaar. Log in met <strong>{klaar}</strong> en het wachtwoord dat je
            net hebt gekozen.
          </div>
          <button type="button" className="btn btnPrimary" onClick={() => router.push("/inloggen")}>
            Naar het inlogscherm
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.card}>
      <div className={styles.head}>
        <span className={styles.wordmark}>
          LARA<em>·</em>Areas
        </span>
        <span className={styles.tagline}>AIXM → LARA</span>
      </div>

      <div className={styles.fields}>
        <p className="lead" style={{ fontSize: 12.5 }}>
          Je bent uitgenodigd. Kies een wachtwoord om je account af te maken.
        </p>

        <div>
          <label className="field" htmlFor="naam">
            Naam <span className="meta">optioneel</span>
          </label>
          <input id="naam" type="text" value={naam} onChange={(e) => setNaam(e.target.value)} />
        </div>

        <div>
          <label className="field" htmlFor="ww">
            Wachtwoord <span className="meta">minstens tien tekens</span>
          </label>
          <input
            id="ww"
            type="password"
            autoComplete="new-password"
            value={wachtwoord}
            onChange={(e) => setWachtwoord(e.target.value)}
          />
        </div>

        <div>
          <label className="field" htmlFor="ww2">
            Nog een keer
          </label>
          <input
            id="ww2"
            type="password"
            autoComplete="new-password"
            value={herhaal}
            onChange={(e) => setHerhaal(e.target.value)}
          />
          {herhaal.length > 0 && !gelijk && (
            <span className="meta" style={{ color: "var(--fout)" }}>
              De twee wachtwoorden verschillen.
            </span>
          )}
        </div>

        {fout && <span className={styles.error}>{fout}</span>}

        <button type="button" className="btn btnPrimary" disabled={!kanVersturen} onClick={verstuur}>
          {bezig ? "Bezig…" : "Account aanmaken"}
        </button>
      </div>

      <div className={styles.foot}>
        <span className="meta">
          Heb je al een account? <Link href="/inloggen">Inloggen</Link>
        </span>
      </div>
    </main>
  );
}

export default function UitnodigingPagina() {
  return (
    <div className={styles.wrap}>
      <Suspense fallback={null}>
        <Formulier />
      </Suspense>
    </div>
  );
}

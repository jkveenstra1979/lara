import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseIsIngesteld } from "@/lib/supabase/config";
import Formulier from "./(auth)/inloggen/Formulier";
import styles from "./page.module.css";

export const metadata = { title: "LARA Areas — AIXM naar LARA" };

/**
 * De voorpagina: wat de tool doet, en het inlogveld ernaast.
 *
 * Openbaar, want zonder account is dit het enige wat er te zien valt. Wie al is
 * ingelogd gaat meteen door naar de werkstroom — die begint bij importeren.
 */

const STAPPEN = [
  { num: "1", naam: "Importeren", uitleg: "Een AIXM 5.1-bestand van AeroDB uploaden. De gebieden, hun vorm en hun openstellingstijden worden eruit gelezen." },
  { num: "2", naam: "Gebieden", uitleg: "Alles wat in het bestand zit, met de vorm op de kaart en het originele AIXM-fragment ernaast." },
  { num: "3", naam: "LARA-selectie", uitleg: "Welke gebieden meegaan naar LARA, en welk Area ID ze krijgen. De nummering gaat mee naar de volgende AIRAC-cyclus." },
  { num: "4", naam: "Exporteren", uitleg: "Het importwerkboek voor LARA, plus een controle vooraf op wat LARA zou weigeren." },
];

export default async function Home() {
  // Nog geen Supabase: dan is inloggen zinloos en zegt de pagina wat er mist.
  if (supabaseIsIngesteld) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect("/importeren");
  }

  return (
    <div className={styles.page}>
      <main className={styles.paginaKaart}>
        <div className={styles.head}>
          <span className={styles.wordmark}>
            LARA<em>·</em>Areas
          </span>
          <span className={styles.tagline}>AIXM → LARA V4</span>
        </div>

        <div className={styles.kolommen}>
          <div>
            <p className={styles.lead}>
              Luchtruimgegevens uit <strong>AeroDB</strong> omzetten naar een importbestand voor{" "}
              <strong>LARA</strong>. Een AIXM-bestand gaat erin, een werkboek volgens de
              officiële specificatie komt eruit — met de Area IDs die je zelf toekent.
            </p>

            <ol className={styles.steps}>
              {STAPPEN.map((stap) => (
                <li key={stap.num} className={styles.step}>
                  <span className={styles.stepNum}>{stap.num}</span>
                  <span>
                    <span className={styles.stepName}>{stap.naam}</span>
                    <span className={styles.stepUitleg}>{stap.uitleg}</span>
                  </span>
                </li>
              ))}
            </ol>

            <div className={styles.uit}>
              <span className="sectionLabel">Wat je meekrijgt</span>
              <p className={styles.uitTekst}>
                Het LARA-werkboek als <span className="mono">.xlsx</span>, in de V4- of de
                V5-uitgave. Daarnaast <span className="mono">KML</span> en{" "}
                <span className="mono">GeoJSON</span> van dezelfde selectie, om de vormen
                buiten LARA na te kijken.
              </p>
            </div>
          </div>

          <div className={styles.inlog}>
            {supabaseIsIngesteld ? (
              <>
                <span className="sectionLabel">Inloggen</span>
                <Formulier verder="/importeren" />
                <span className="meta">
                  Accounts worden aangemaakt door de beheerder — er is geen registratie.
                </span>
              </>
            ) : (
              <div className={styles.melding}>
                <strong>Supabase is nog niet ingesteld.</strong> Kopieer{" "}
                <span className="mono">.env.example</span> naar{" "}
                <span className="mono">.env.local</span> en vul de sleutels van het project in.
                Controleer daarna met <span className="mono">npm run check:supabase</span>.
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

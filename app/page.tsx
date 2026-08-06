import { redirect } from "next/navigation";
import { supabaseIsIngesteld } from "@/lib/supabase/config";
import styles from "./page.module.css";

/**
 * De werkstroom begint bij importeren; daar gaat iedereen naartoe. Deze pagina
 * blijft alleen bestaan voor het geval Supabase nog niet is ingesteld — dan zou
 * doorverwijzen op een stacktrace uitkomen in plaats van op een uitleg.
 */
export default function Home() {
  if (supabaseIsIngesteld) redirect("/importeren");

  return (
    <div className={styles.page}>
      <main className={styles.card}>
        <div className={styles.head}>
          <span className={styles.wordmark}>
            LARA<em>·</em>Areas
          </span>
          <span className={styles.tagline}>AIXM → LARA V4</span>
        </div>

        <div style={{ paddingTop: 20 }}>
          <div className={styles.melding}>
            <strong>Supabase is nog niet ingesteld.</strong> Kopieer{" "}
            <span className="mono">.env.example</span> naar{" "}
            <span className="mono">.env.local</span> en vul de sleutels van het project in.
            Controleer daarna met <span className="mono">npm run check:supabase</span>.
          </div>
        </div>
      </main>
    </div>
  );
}

"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "./actions";
import styles from "./page.module.css";

function InloggenForm() {
  const params = useSearchParams();
  const verder = params.get("verder") ?? "/";

  const [state, action, pending] = useActionState(signIn, null);

  return (
    <main className={styles.card}>
      <div className={styles.head}>
        <span className={styles.wordmark}>
          LARA<em>·</em>Areas
        </span>
        <span className={styles.tagline}>AIXM → LARA V4</span>
      </div>

      <form action={action} className={styles.fields}>
        <input type="hidden" name="verder" value={verder} />

        <div>
          <label className="field" htmlFor="email">
            E-mailadres
          </label>
          <input
            id="email"
            name="email"
            type="email"
            className="monoField"
            autoComplete="username"
            required
          />
        </div>

        <div>
          <label className="field" htmlFor="password">
            Wachtwoord
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>

        {state?.error && <span className={styles.error}>{state.error}</span>}

        <button type="submit" className="btn btnPrimary" disabled={pending}>
          {pending ? "Bezig…" : "Inloggen"}
        </button>
      </form>

      <div className={styles.foot}>
        <span className="meta">
          Accounts worden aangemaakt door de beheerder — er is geen registratie.
        </span>
      </div>
    </main>
  );
}

export default function Inloggen() {
  return (
    <Suspense fallback={null}>
      <InloggenForm />
    </Suspense>
  );
}

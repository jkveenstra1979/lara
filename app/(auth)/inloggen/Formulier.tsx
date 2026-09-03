"use client";

import { useActionState } from "react";
import { signIn } from "./actions";
import styles from "./page.module.css";

/**
 * Het inlogformulier zelf, zonder omlijsting.
 *
 * Staat los omdat het op twee plekken staat: het kale scherm `/inloggen`, waar
 * de proxy je heen stuurt met het pad dat je wilde, en de voorpagina, waar het
 * naast de uitleg staat.
 */
export default function Formulier({ verder }: { verder: string }) {
  const [state, action, pending] = useActionState(signIn, null);

  return (
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
  );
}

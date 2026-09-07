"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Formulier from "./Formulier";
import styles from "./page.module.css";

/** Het kale inlogscherm; hier stuurt de proxy je heen bij een dieper pad. */
function InloggenForm() {
  const params = useSearchParams();
  const verder = params.get("verder") ?? "/importeren";

  return (
    <main className={styles.card}>
      <div className={styles.head}>
        <span className={styles.wordmark}>
          LARA<em>·</em>Areas
        </span>
        <span className={styles.tagline}>AIXM → LARA</span>
      </div>

      <Formulier verder={verder} />

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

import styles from "./layout.module.css";

/** Auth-schermen staan los van de applicatie: geen rail, gecentreerd op --bg. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className={styles.wrap}>{children}</div>;
}

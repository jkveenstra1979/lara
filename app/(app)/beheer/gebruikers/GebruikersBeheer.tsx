"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROL_LABEL, type Gebruiker, type Rol, type Uitnodiging } from "@/lib/gebruikers";
import { toonDatum } from "@/lib/datum";
import styles from "./page.module.css";

/**
 * Gebruikersbeheer — alleen voor beheerders.
 *
 * Uitnodigen levert een link op die je zelf doorstuurt; er is geen e-mailserver
 * gekoppeld. De link staat na het aanmaken in een veld dat je kunt kopiëren, en
 * blijft daarna in de lijst met openstaande uitnodigingen staan.
 */
export default function GebruikersBeheer({
  ik,
  gebruikers: initieel,
  uitnodigingen: initieleUitnodigingen,
}: {
  ik: Gebruiker;
  gebruikers: Gebruiker[];
  uitnodigingen: Uitnodiging[];
}) {
  const [gebruikers, setGebruikers] = useState(initieel);
  const [uitnodigingen, setUitnodigingen] = useState(initieleUitnodigingen);
  const [email, setEmail] = useState("");
  const [naam, setNaam] = useState("");
  const [rol, setRol] = useState<Rol>("user");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [nieuweLink, setNieuweLink] = useState<{ email: string; link: string } | null>(null);
  const router = useRouter();

  const aantalAdmins = gebruikers.filter((g) => g.rol === "admin").length;

  const roep = async (url: string, opties: RequestInit) => {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...opties,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Er ging iets mis.");
    return data;
  };

  const nodigUit = async () => {
    setBezig(true);
    setFout(null);
    setNieuweLink(null);
    try {
      const data = await roep("/api/uitnodigingen", {
        method: "POST",
        body: JSON.stringify({ email, naam, rol }),
      });
      setNieuweLink({ email: data.uitnodiging.email, link: data.link });
      setUitnodigingen((lijst) => [
        {
          id: data.uitnodiging.id,
          email: data.uitnodiging.email,
          naam: data.uitnodiging.naam,
          rol: data.uitnodiging.rol,
          token: data.uitnodiging.token,
          createdAt: new Date().toISOString(),
          expiresAt: data.uitnodiging.expires_at,
          acceptedAt: null,
          verlopen: false,
        },
        ...lijst.filter((u) => u.email !== data.uitnodiging.email),
      ]);
      setEmail("");
      setNaam("");
      setRol("user");
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Uitnodigen mislukte.");
    } finally {
      setBezig(false);
    }
  };

  const wijzigRol = async (gebruiker: Gebruiker, nieuweRol: Rol) => {
    setFout(null);
    const vorige = gebruiker.rol;
    setGebruikers((l) => l.map((g) => (g.id === gebruiker.id ? { ...g, rol: nieuweRol } : g)));
    try {
      await roep(`/api/gebruikers/${gebruiker.id}`, {
        method: "PATCH",
        body: JSON.stringify({ rol: nieuweRol }),
      });
      router.refresh();
    } catch (e) {
      setGebruikers((l) => l.map((g) => (g.id === gebruiker.id ? { ...g, rol: vorige } : g)));
      setFout(e instanceof Error ? e.message : "Wijzigen mislukte.");
    }
  };

  const verwijder = async (gebruiker: Gebruiker) => {
    if (!confirm(`${gebruiker.email} verwijderen? Het account verdwijnt volledig.`)) return;
    setFout(null);
    try {
      await roep(`/api/gebruikers/${gebruiker.id}`, { method: "DELETE" });
      setGebruikers((l) => l.filter((g) => g.id !== gebruiker.id));
      router.refresh();
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Verwijderen mislukte.");
    }
  };

  const verleng = async (uitnodiging: Uitnodiging) => {
    setFout(null);
    try {
      const data = await roep(`/api/uitnodigingen/${uitnodiging.id}`, { method: "PATCH" });
      setNieuweLink({ email: uitnodiging.email, link: data.link });
      setUitnodigingen((l) =>
        l.map((u) => (u.id === uitnodiging.id ? { ...u, expiresAt: data.expiresAt, verlopen: false } : u))
      );
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Verlengen mislukte.");
    }
  };

  const trekIn = async (uitnodiging: Uitnodiging) => {
    setFout(null);
    try {
      await roep(`/api/uitnodigingen/${uitnodiging.id}`, { method: "DELETE" });
      setUitnodigingen((l) => l.filter((u) => u.id !== uitnodiging.id));
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Intrekken mislukte.");
    }
  };

  return (
    <div className={styles.work}>
      {/* ------------------------------------------------------- uitnodigen -- */}
      <section>
        <div className="sectionHead">
          <span className="sectionLabel">01 · Iemand uitnodigen</span>
          <span className="rule" />
          <span className="meta">geen e-mailserver — je stuurt de link zelf door</span>
        </div>

        <div className={styles.paneel} style={{ marginTop: 14 }}>
          <div className={styles.velden}>
            <div className={styles.veld}>
              <label className="field" htmlFor="email">
                E-mailadres
              </label>
              <input
                id="email"
                type="email"
                className="monoField"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="naam@organisatie.nl"
              />
            </div>
            <div className={styles.veld}>
              <label className="field" htmlFor="naam">
                Naam <span className="meta">optioneel</span>
              </label>
              <input id="naam" type="text" value={naam} onChange={(e) => setNaam(e.target.value)} />
            </div>
            <div className={`${styles.veld} ${styles.smal}`}>
              <label className="field" htmlFor="rol">
                Rol
              </label>
              <select id="rol" value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
                <option value="user">Gebruiker</option>
                <option value="admin">Beheerder</option>
              </select>
            </div>
            <button
              type="button"
              className="btn btnPrimary"
              disabled={bezig || !email.includes("@")}
              onClick={nodigUit}
            >
              {bezig ? "Bezig…" : "Uitnodiging maken"}
            </button>
          </div>

          {fout && <div className={styles.foutBalk}>{fout}</div>}

          {nieuweLink && (
            <div className={styles.link}>
              <span style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>✓</span>
              <span style={{ flex: 1 }}>
                Uitnodiging voor <strong>{nieuweLink.email}</strong> klaar. Stuur deze link door;
                hij is veertien dagen geldig en werkt één keer.
                <input
                  className={styles.linkveld}
                  readOnly
                  value={nieuweLink.link}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </span>
              <button
                type="button"
                className="btn btnSmall"
                onClick={() => navigator.clipboard.writeText(nieuweLink.link)}
              >
                Kopiëren
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ---------------------------------------------- openstaande uitnodigingen -- */}
      {uitnodigingen.length > 0 && (
        <section>
          <div className="sectionHead">
            <span className="sectionLabel">02 · Openstaand</span>
            <span className="rule" />
            <span className="meta">{uitnodigingen.length} nog niet gebruikt</span>
          </div>
          <div className={styles.paneel} style={{ marginTop: 14 }}>
            <table>
              <thead>
                <tr>
                  <th>E-mailadres</th>
                  <th style={{ width: 160 }}>Naam</th>
                  <th style={{ width: 100 }}>Rol</th>
                  <th style={{ width: 120 }}>Geldig tot</th>
                  <th style={{ width: 200 }} />
                </tr>
              </thead>
              <tbody>
                {uitnodigingen.map((u) => (
                  <tr key={u.id}>
                    <td className="ident">{u.email}</td>
                    <td>{u.naam ?? "—"}</td>
                    <td className={styles.rol}>{ROL_LABEL[u.rol]}</td>
                    <td>
                      {u.verlopen ? (
                        <span className="badge badgeWarn">verlopen</span>
                      ) : (
                        <span className="dim">{toonDatum(u.expiresAt)}</span>
                      )}
                    </td>
                    <td>
                      <div className={styles.acties}>
                        <button
                          type="button"
                          className="btn btnSmall"
                          onClick={() =>
                            navigator.clipboard.writeText(
                              `${window.location.origin}/uitnodiging?token=${u.token}`
                            )
                          }
                        >
                          Link kopiëren
                        </button>
                        <button type="button" className="btn btnSmall" onClick={() => verleng(u)}>
                          Nieuwe link
                        </button>
                        <button type="button" className="btn btnSmall" onClick={() => trekIn(u)}>
                          Intrekken
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------- gebruikers -- */}
      <section>
        <div className="sectionHead">
          <span className="sectionLabel">
            {uitnodigingen.length > 0 ? "03" : "02"} · Gebruikers
          </span>
          <span className="rule" />
          <span className="meta">
            {gebruikers.length} · {aantalAdmins} beheerder{aantalAdmins === 1 ? "" : "s"}
          </span>
        </div>

        <div className={styles.paneel} style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr>
                <th>E-mailadres</th>
                <th style={{ width: 180 }}>Naam</th>
                <th style={{ width: 140 }}>Rol</th>
                <th style={{ width: 120 }}>Sinds</th>
                <th style={{ width: 110 }} />
              </tr>
            </thead>
            <tbody>
              {gebruikers.map((g) => (
                <tr key={g.id}>
                  <td className="ident">
                    {g.email} {g.id === ik.id && <span className={styles.ik}>jij</span>}
                  </td>
                  <td>{g.naam ?? "—"}</td>
                  <td>
                    <select
                      value={g.rol}
                      onChange={(e) => wijzigRol(g, e.target.value as Rol)}
                      style={{ height: 26, fontSize: 12 }}
                      disabled={g.id === ik.id}
                      title={
                        g.id === ik.id ? "Je kunt je eigen rol niet wijzigen" : undefined
                      }
                    >
                      <option value="user">Gebruiker</option>
                      <option value="admin">Beheerder</option>
                    </select>
                  </td>
                  <td className="dim">{toonDatum(g.createdAt)}</td>
                  <td>
                    <div className={styles.acties}>
                      {g.id !== ik.id && (
                        <button type="button" className="btn btnSmall" onClick={() => verwijder(g)}>
                          Verwijderen
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="lead" style={{ paddingTop: 12 }}>
          Het enige verschil tussen de twee rollen is dit scherm: een beheerder nodigt uit en
          wijzigt rollen. Aan de luchtruimgegevens — importeren, selecteren, nummeren,
          exporteren — mag iedereen die is ingelogd evenveel doen.
        </p>
      </section>
    </div>
  );
}

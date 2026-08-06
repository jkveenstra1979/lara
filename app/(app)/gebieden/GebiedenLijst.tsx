"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toonHoogte, type Gebied } from "@/lib/gebieden";
import DetailPaneel from "./DetailPaneel";
import styles from "./page.module.css";

type LaraFilter = "alle" | "in" | "uit";

/**
 * Scherm 2 — alles wat in het AIXM-bestand zit.
 *
 * Het selectievakje is de enige actie: hoort dit gebied in LARA? Het Area ID
 * hoort bij de selectie en wordt op scherm 3 toegekend, niet hier.
 */
export default function GebiedenLijst({
  datasetId,
  gebieden: initieel,
}: {
  datasetId: string;
  gebieden: Gebied[];
}) {
  const [gebieden, setGebieden] = useState(initieel);
  const [zoek, setZoek] = useState("");
  const [type, setType] = useState("");
  const [klasse, setKlasse] = useState("");
  const [laraFilter, setLaraFilter] = useState<LaraFilter>("alle");
  const [bezig, setBezig] = useState<Set<string>>(new Set());
  const [fout, setFout] = useState<string | null>(null);
  const [gekozen, setGekozen] = useState<string | null>(null);
  const router = useRouter();

  const types = useMemo(
    () => Array.from(new Set(gebieden.map((g) => g.type).filter(Boolean))).sort() as string[],
    [gebieden]
  );
  const klassen = useMemo(
    () => Array.from(new Set(gebieden.map((g) => g.class).filter(Boolean))).sort() as string[],
    [gebieden]
  );

  const zichtbaar = useMemo(() => {
    const term = zoek.trim().toLowerCase();
    return gebieden.filter((g) => {
      if (term && !`${g.ident} ${g.name ?? ""}`.toLowerCase().includes(term)) return false;
      if (type && g.type !== type) return false;
      if (klasse && g.class !== klasse) return false;
      if (laraFilter === "in" && !g.inLara) return false;
      if (laraFilter === "uit" && g.inLara) return false;
      return true;
    });
  }, [gebieden, zoek, type, klasse, laraFilter]);

  const inLara = gebieden.filter((g) => g.inLara).length;
  const zichtbaarNietInLara = zichtbaar.filter((g) => !g.inLara);

  /** Toevoegen of verwijderen; de lijst wordt meteen bijgewerkt en teruggedraaid bij een fout. */
  const wissel = async (ids: string[], naarLara: boolean) => {
    if (!ids.length) return;
    setFout(null);
    setBezig((b) => new Set([...b, ...ids]));
    setGebieden((lijst) =>
      lijst.map((g) =>
        ids.includes(g.id)
          ? { ...g, inLara: naarLara, laraAreaId: naarLara ? g.laraAreaId : null }
          : g
      )
    );

    try {
      const res = await fetch("/api/lara-areas", {
        method: naarLara ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasetId, airspaceIds: ids }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "De wijziging is niet opgeslagen.");
      }
      // De rail, de sessiebalk en de voetbalk tonen tellingen die nu veranderd
      // zijn; die staan in server components en moeten opnieuw worden opgehaald.
      router.refresh();
    } catch (error) {
      setGebieden((lijst) =>
        lijst.map((g) => (ids.includes(g.id) ? { ...g, inLara: !naarLara } : g))
      );
      setFout(error instanceof Error ? error.message : "De wijziging is niet opgeslagen.");
    } finally {
      setBezig((b) => {
        const volgende = new Set(b);
        for (const id of ids) volgende.delete(id);
        return volgende;
      });
    }
  };

  return (
    <div className={styles.split}>
      <div className={styles.lijstPaneel}>
        <div className={styles.filterBalk}>
          <input
            type="search"
            className={styles.zoek}
            placeholder="Designator of naam…"
            value={zoek}
            onChange={(e) => setZoek(e.target.value)}
          />
          <select className={styles.keuze} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Alle types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select className={styles.keuze} value={klasse} onChange={(e) => setKlasse(e.target.value)}>
            <option value="">Alle klassen</option>
            {klassen.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <select
            className={styles.keuze}
            value={laraFilter}
            onChange={(e) => setLaraFilter(e.target.value as LaraFilter)}
          >
            <option value="alle">Alle gebieden</option>
            <option value="in">Alleen in LARA</option>
            <option value="uit">Alleen nog niet in LARA</option>
          </select>

          <span className="spacer" />

          <span className={styles.telling}>
            {zichtbaar.length} van {gebieden.length} · {inLara} in LARA
          </span>
          <button
            type="button"
            className="btn btnSmall btnPrimary"
            disabled={!zichtbaarNietInLara.length}
            onClick={() => wissel(zichtbaarNietInLara.map((g) => g.id), true)}
          >
            {zichtbaarNietInLara.length
              ? `${zichtbaarNietInLara.length} toevoegen aan LARA`
              : "Alles staat in LARA"}
          </button>
        </div>

        {fout && <div className={styles.foutBalk}>{fout}</div>}

        <div className={styles.tabelScroll}>
          <table>
            <thead>
              <tr>
                <th className={styles.pickCel} title="In de LARA-lijst">
                  ✓
                </th>
                <th style={{ width: 110 }}>Designator</th>
                <th>Naam</th>
                <th style={{ width: 60 }}>Type</th>
                <th style={{ width: 60 }}>Class</th>
                <th style={{ width: 82 }}>Onder</th>
                <th style={{ width: 82 }}>Boven</th>
                <th style={{ width: 150 }}>Geometrie</th>
              </tr>
            </thead>
            <tbody>
              {zichtbaar.map((g) => (
                <tr
                  key={g.id}
                  data-selected={g.id === gekozen}
                  onClick={() => setGekozen(g.id)}
                  className={styles.rij}
                >
                  <td className={styles.pickCel} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className={`${styles.pick} ${g.inLara ? styles.pickAan : ""}`}
                      disabled={bezig.has(g.id)}
                      aria-pressed={g.inLara}
                      aria-label={
                        g.inLara ? `${g.ident} uit de LARA-lijst halen` : `${g.ident} toevoegen aan LARA`
                      }
                      onClick={() => wissel([g.id], !g.inLara)}
                    />
                  </td>
                  <td className="ident">{g.ident}</td>
                  <td>{g.name ?? "—"}</td>
                  <td className="dim">{g.type ?? "—"}</td>
                  <td className="dim">{g.class ?? "—"}</td>
                  <td className={styles.hoogte}>{toonHoogte(g.lowerlimit, g.lowerunit)}</td>
                  <td className={styles.hoogte}>{toonHoogte(g.upperlimit, g.upperunit)}</td>
                  <td>
                    <span className={styles.geomCel}>
                      {g.geometry_status === "ok" ? (
                        <span className="dim">{g.geom_type ?? "—"}</span>
                      ) : g.geometry_status === "partial" ? (
                        <span className="badge badgeFout" title="Verwijst naar een landsgrens die ontbreekt">
                          grens mist
                        </span>
                      ) : (
                        <span className="badge badgeWarn">onopgelost</span>
                      )}
                      {g.volumes > 1 && (
                        <span className="badge badgeQuiet" title={`${g.volumes} volumes in sheet 2`}>
                          {g.volumes} vol
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
              {!zichtbaar.length && (
                <tr>
                  <td colSpan={8} className={styles.leeg}>
                    {gebieden.length
                      ? "Geen gebieden die aan de filters voldoen."
                      : "Deze dataset bevat geen gebieden."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <DetailPaneel airspaceId={gekozen} />
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toonHoogte, type Gebied } from "@/lib/gebieden";
import DetailPaneel from "../detail/DetailPaneel";
import { useDetailPaneel } from "../detail/useDetailPaneel";
import styles from "./page.module.css";

type LaraFilter = "alle" | "in" | "uit";

/**
 * Scherm 2 — alles wat in het AIXM-bestand zit.
 *
 * Het vinkje is een **voorselectie**, geen toestand. Je vinkt aan wat je wilt
 * behandelen en drukt dan op toevoegen of verwijderen; of een gebied al in LARA
 * staat lees je in de laatste kolom.
 *
 * Dat onderscheid is er niet altijd geweest. Eerst wás het vinkje de
 * LARA-status en voegde de knop alles toe wat de filters overlieten. Bij 922
 * gebieden gaf dat "919 toevoegen aan LARA" naast drie aangevinkte rijen — één
 * klik van een lijst die je daarna met de hand mag opschonen.
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
  const [aangevinkt, setAangevinkt] = useState<Set<string>>(new Set());
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const detail = useDetailPaneel();
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

  // Wat de knoppen gaan doen, gerekend over de aangevinkte rijen.
  const gekozenGebieden = gebieden.filter((g) => aangevinkt.has(g.id));
  const toeTeVoegen = gekozenGebieden.filter((g) => !g.inLara);
  const teVerwijderen = gekozenGebieden.filter((g) => g.inLara);

  const allesZichtbaarAangevinkt =
    zichtbaar.length > 0 && zichtbaar.every((g) => aangevinkt.has(g.id));

  const vinkAan = (id: string) =>
    setAangevinkt((s) => {
      const volgende = new Set(s);
      if (volgende.has(id)) volgende.delete(id);
      else volgende.add(id);
      return volgende;
    });

  const vinkAllesZichtbaar = () =>
    setAangevinkt((s) => {
      const volgende = new Set(s);
      if (allesZichtbaarAangevinkt) for (const g of zichtbaar) volgende.delete(g.id);
      else for (const g of zichtbaar) volgende.add(g.id);
      return volgende;
    });

  /** Toevoegen of verwijderen; meteen zichtbaar, teruggedraaid bij een fout. */
  const wissel = async (ids: string[], naarLara: boolean) => {
    if (!ids.length) return;
    setFout(null);
    setBezig(true);
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
      setAangevinkt(new Set());
      // De rail, de sessiebalk en de voetbalk tonen tellingen die nu veranderd
      // zijn; die staan in server components en moeten opnieuw worden opgehaald.
      router.refresh();
    } catch (error) {
      setGebieden((lijst) =>
        lijst.map((g) => (ids.includes(g.id) ? { ...g, inLara: !naarLara } : g))
      );
      setFout(error instanceof Error ? error.message : "De wijziging is niet opgeslagen.");
    } finally {
      setBezig(false);
    }
  };

  return (
    <div className="split" {...detail.splitProps}>
      <div className="lijstPaneel">
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
            className="btn btnSmall"
            aria-pressed={detail.open}
            onClick={detail.wissel}
            title={detail.open ? "Detailpaneel verbergen" : "Detailpaneel tonen"}
          >
            {detail.open ? "Details verbergen" : "Details tonen"}
          </button>
        </div>

        {/* De actiebalk verschijnt pas als je iets hebt aangevinkt. Zo kan er
            niets gebeuren waar je niet om hebt gevraagd. */}
        {gekozenGebieden.length > 0 && (
          <div className={styles.actieBalk}>
            <span className={styles.actieTelling}>{gekozenGebieden.length} aangevinkt</span>
            {toeTeVoegen.length > 0 && (
              <button
                type="button"
                className="btn btnSmall btnPrimary"
                disabled={bezig}
                onClick={() => wissel(toeTeVoegen.map((g) => g.id), true)}
              >
                {toeTeVoegen.length} toevoegen aan LARA
              </button>
            )}
            {teVerwijderen.length > 0 && (
              <button
                type="button"
                className="btn btnSmall"
                disabled={bezig}
                onClick={() => wissel(teVerwijderen.map((g) => g.id), false)}
              >
                {teVerwijderen.length} uit LARA halen
              </button>
            )}
            <span className="spacer" />
            <button type="button" className="btn btnSmall" onClick={() => setAangevinkt(new Set())}>
              Selectie wissen
            </button>
          </div>
        )}

        {fout && <div className={styles.foutBalk}>{fout}</div>}

        <div className={styles.tabelScroll}>
          <table>
            <thead>
              <tr>
                <th className={styles.pickCel}>
                  <button
                    type="button"
                    className={`${styles.pick} ${allesZichtbaarAangevinkt ? styles.pickAan : ""}`}
                    onClick={vinkAllesZichtbaar}
                    aria-label={
                      allesZichtbaarAangevinkt ? "Selectie wissen" : "Alles in beeld aanvinken"
                    }
                    title={
                      allesZichtbaarAangevinkt
                        ? "Selectie wissen"
                        : `${zichtbaar.length} zichtbare gebieden aanvinken`
                    }
                  />
                </th>
                <th style={{ width: 110 }}>Designator</th>
                <th>Naam</th>
                <th style={{ width: 60 }}>Type</th>
                <th style={{ width: 60 }}>Class</th>
                <th style={{ width: 82 }}>Onder</th>
                <th style={{ width: 82 }}>Boven</th>
                <th style={{ width: 150 }}>Geometrie</th>
                <th style={{ width: 100 }}>In LARA</th>
              </tr>
            </thead>
            <tbody>
              {zichtbaar.map((g) => (
                <tr
                  key={g.id}
                  data-selected={g.id === detail.gekozen}
                  onClick={() => detail.kies(g.id)}
                  className={styles.rij}
                >
                  <td className={styles.pickCel} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className={`${styles.pick} ${aangevinkt.has(g.id) ? styles.pickAan : ""}`}
                      aria-pressed={aangevinkt.has(g.id)}
                      aria-label={`${g.ident} aanvinken`}
                      onClick={() => vinkAan(g.id)}
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
                  <td>
                    {g.inLara ? (
                      <span className="badge badgeOk">
                        <span aria-hidden="true">✓</span>
                        {g.laraAreaId !== null ? `ID:${g.laraAreaId}` : "in LARA"}
                      </span>
                    ) : (
                      <span className="dim">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!zichtbaar.length && (
                <tr>
                  <td colSpan={9} className={styles.leeg}>
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

      {detail.open && (
        <>
          <div className="splitter" {...detail.splitterProps} />
          <DetailPaneel
            airspaceId={detail.gekozen}
            onSluiten={detail.sluit}
          />
        </>
      )}
    </div>
  );
}

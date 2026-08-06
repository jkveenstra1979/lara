"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { gatenInReeks, volgendVrijNummer } from "@/lib/bulkNummers";
import { toonHoogte } from "@/lib/gebieden";
import type { SelectieRij } from "@/lib/selectie";
import PlakVenster from "./PlakVenster";
import styles from "./page.module.css";

type Filter = "alle" | "zonderId" | "meerVolumes" | "geenGeometrie";

/**
 * Scherm 3 — de LARA-lijst, en de enige plek waar Area IDs staan.
 *
 * Nummeren gebeurt inline. De duplicaatcontrole komt van de database: het
 * invoerveld toont wat de server terugstuurt, in plaats van vooraf te raden of
 * een nummer vrij is.
 */
export default function SelectieLijst({
  datasetId,
  rijen: initieel,
  eerdereDatasets,
}: {
  datasetId: string;
  rijen: SelectieRij[];
  eerdereDatasets: { id: string; filename: string; airac: string; aantal: number }[];
}) {
  const [rijen, setRijen] = useState(initieel);
  const [zoek, setZoek] = useState("");
  const [filter, setFilter] = useState<Filter>("alle");
  const [fouten, setFouten] = useState<Record<string, string>>({});
  const [bezig, setBezig] = useState<Set<string>>(new Set());
  const [balkFout, setBalkFout] = useState<string | null>(null);
  const [plakOpen, setPlakOpen] = useState(false);
  const [overname, setOvername] = useState<{ overgenomen: number; vervallen: string[]; nieuw: number } | null>(null);
  const [bron, setBron] = useState(eerdereDatasets[0]?.id ?? "");
  const router = useRouter();

  const nummers = useMemo(() => rijen.map((r) => r.laraAreaId), [rijen]);
  const gaten = useMemo(() => gatenInReeks(nummers), [nummers]);
  const genummerd = rijen.filter((r) => r.laraAreaId !== null).length;

  const zichtbaar = useMemo(() => {
    const term = zoek.trim().toLowerCase();
    return rijen.filter((r) => {
      if (term && !`${r.ident} ${r.name ?? ""}`.toLowerCase().includes(term)) return false;
      if (filter === "zonderId" && r.laraAreaId !== null) return false;
      if (filter === "meerVolumes" && r.volumes <= 1) return false;
      if (filter === "geenGeometrie" && r.geometryStatus === "ok") return false;
      return true;
    });
  }, [rijen, zoek, filter, ]);

  const merkBezig = (id: string, aan: boolean) =>
    setBezig((b) => {
      const volgende = new Set(b);
      if (aan) volgende.add(id);
      else volgende.delete(id);
      return volgende;
    });

  /** Een nummer opslaan. Leeg betekent: het nummer wissen, het gebied blijft in de lijst. */
  const bewaarNummer = async (rij: SelectieRij, waarde: string) => {
    const nieuw = waarde.trim() === "" ? null : Number(waarde);
    if (nieuw === rij.laraAreaId) return;

    setFouten((f) => ({ ...f, [rij.airspaceId]: "" }));
    merkBezig(rij.airspaceId, true);
    const vorige = rij.laraAreaId;
    setRijen((lijst) =>
      lijst.map((r) => (r.airspaceId === rij.airspaceId ? { ...r, laraAreaId: nieuw } : r))
    );

    try {
      const res = await fetch("/api/lara-areas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ airspaceId: rij.airspaceId, laraAreaId: nieuw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Bij een botsing helpt het te weten wie het nummer heeft; dat staat in
        // de lijst die we toch al in beeld hebben.
        const houder = nieuw !== null ? rijen.find((r) => r.laraAreaId === nieuw) : undefined;
        throw new Error(
          data.code === "duplicaat" && houder
            ? `Nummer ${nieuw} is al van ${houder.ident}.`
            : (data.error ?? "Opslaan mislukt.")
        );
      }
      router.refresh();
    } catch (error) {
      setRijen((lijst) =>
        lijst.map((r) => (r.airspaceId === rij.airspaceId ? { ...r, laraAreaId: vorige } : r))
      );
      setFouten((f) => ({
        ...f,
        [rij.airspaceId]: error instanceof Error ? error.message : "Opslaan mislukt.",
      }));
    } finally {
      merkBezig(rij.airspaceId, false);
    }
  };

  const uitLijst = async (rij: SelectieRij) => {
    merkBezig(rij.airspaceId, true);
    setBalkFout(null);
    try {
      const res = await fetch("/api/lara-areas", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ airspaceIds: [rij.airspaceId] }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Verwijderen mislukt.");
      setRijen((lijst) => lijst.filter((r) => r.airspaceId !== rij.airspaceId));
      router.refresh();
    } catch (error) {
      setBalkFout(error instanceof Error ? error.message : "Verwijderen mislukt.");
    } finally {
      merkBezig(rij.airspaceId, false);
    }
  };

  const neemOver = async () => {
    if (!bron) return;
    setBalkFout(null);
    try {
      const res = await fetch(`/api/datasets/${datasetId}/inherit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bronDatasetId: bron }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Overnemen mislukt.");
      setOvername({
        overgenomen: data.overgenomen,
        vervallen: (data.vervallen ?? []).map((v: { ident: string }) => v.ident),
        nieuw: data.nieuw,
      });
      router.refresh();
    } catch (error) {
      setBalkFout(error instanceof Error ? error.message : "Overnemen mislukt.");
    }
  };

  return (
    <div className={styles.paneel}>
      <div className={styles.strook}>
        <div className={styles.cel}>
          <div className={styles.getal}>{rijen.length}</div>
          <div className={styles.label}>In de LARA-lijst</div>
        </div>
        <div className={styles.cel}>
          <div className={styles.getal}>{genummerd}</div>
          <div className={styles.label}>Genummerd</div>
        </div>
        <div className={styles.cel}>
          <div className={`${styles.getal} ${rijen.length - genummerd ? styles.getalWarn : ""}`}>
            {rijen.length - genummerd}
          </div>
          <div className={styles.label}>Zonder ID</div>
        </div>
        <div className={styles.cel}>
          <div className={`${styles.getal} ${gaten.length ? styles.getalWarn : ""}`}>
            {gaten.length}
          </div>
          <div className={styles.label}>
            {gaten.length ? `Gaten: ${gaten.slice(0, 6).join(", ")}${gaten.length > 6 ? "…" : ""}` : "Gaten in de reeks"}
          </div>
        </div>
      </div>

      {eerdereDatasets.length > 0 && (
        <div className={styles.overname}>
          <span style={{ fontFamily: "var(--mono)", fontWeight: 600, color: "var(--action)" }}>→</span>
          {overname ? (
            <>
              <span>Overgenomen.</span>
              <div className={styles.tally}>
                <span>{overname.overgenomen} overgenomen</span>
                {overname.vervallen.length > 0 && (
                  <span className={styles.vervallen} title={overname.vervallen.join(", ")}>
                    {overname.vervallen.length} vervallen: {overname.vervallen.slice(0, 5).join(", ")}
                    {overname.vervallen.length > 5 ? "…" : ""}
                  </span>
                )}
                <span className={styles.nieuw}>{overname.nieuw} nieuw</span>
              </div>
            </>
          ) : (
            <>
              <span>Neem selectie en nummering over van</span>
              <select
                className={styles.keuze}
                value={bron}
                onChange={(e) => setBron(e.target.value)}
              >
                {eerdereDatasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.filename} — AIRAC {d.airac} — {d.aantal} in LARA
                  </option>
                ))}
              </select>
              <button type="button" className="btn btnSmall" onClick={neemOver}>
                Overnemen
              </button>
            </>
          )}
        </div>
      )}

      <div className={styles.balk}>
        <input
          type="search"
          className={styles.zoek}
          placeholder="Designator of naam…"
          value={zoek}
          onChange={(e) => setZoek(e.target.value)}
        />
        <select
          className={styles.keuze}
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
        >
          <option value="alle">Alle in de lijst</option>
          <option value="zonderId">Alleen zonder ID</option>
          <option value="meerVolumes">Meerdere volumes</option>
          <option value="geenGeometrie">Geometrie niet in orde</option>
        </select>
        <span className="spacer" />
        <button type="button" className="btn btnSmall" onClick={() => setPlakOpen(true)}>
          Lijst plakken…
        </button>
      </div>

      {balkFout && <div className={styles.foutBalk}>{balkFout}</div>}

      <div className={styles.tabelScroll}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 116 }}>LARA ID</th>
              <th style={{ width: 110 }}>Designator</th>
              <th>Naam</th>
              <th style={{ width: 60 }}>Type</th>
              <th style={{ width: 82 }}>Onder</th>
              <th style={{ width: 82 }}>Boven</th>
              <th style={{ width: 190 }}>Notitie</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {zichtbaar.map((rij) => (
              <tr key={rij.airspaceId}>
                <td>
                  <div className={styles.idCel}>
                    <input
                      // key op de waarde: na een geweigerd nummer zet React het
                      // veld terug op wat er werkelijk staat. Zonder dit bleef de
                      // afgekeurde waarde in beeld en probeerde elke volgende
                      // blur hem opnieuw — twee, drie keer dezelfde 409.
                      key={`${rij.airspaceId}-${rij.laraAreaId ?? "leeg"}`}
                      type="number"
                      min={1}
                      className={`${styles.idVeld} ${fouten[rij.airspaceId] ? styles.idVeldFout : ""}`}
                      defaultValue={rij.laraAreaId ?? ""}
                      placeholder="—"
                      disabled={bezig.has(rij.airspaceId)}
                      onBlur={(e) => bewaarNummer(rij, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") {
                          e.currentTarget.value = String(rij.laraAreaId ?? "");
                          e.currentTarget.blur();
                        }
                      }}
                      aria-label={`LARA Area ID voor ${rij.ident}`}
                    />
                    {rij.laraAreaId === null && (
                      <button
                        type="button"
                        className="btn btnSmall"
                        title="Volgend vrij nummer"
                        onClick={() => bewaarNummer(rij, String(volgendVrijNummer(nummers)))}
                      >
                        N
                      </button>
                    )}
                  </div>
                  {fouten[rij.airspaceId] && (
                    <div className={styles.rijFout}>{fouten[rij.airspaceId]}</div>
                  )}
                </td>
                <td className="ident">{rij.ident}</td>
                <td>{rij.name ?? "—"}</td>
                <td className="dim">{rij.type ?? "—"}</td>
                <td className={styles.hoogte}>{toonHoogte(rij.lowerlimit, rij.lowerunit)}</td>
                <td className={styles.hoogte}>{toonHoogte(rij.upperlimit, rij.upperunit)}</td>
                <td>
                  {rij.geometryStatus === "partial" ? (
                    <span className="badge badgeFout">grens mist</span>
                  ) : rij.geometryStatus !== "ok" ? (
                    <span className="badge badgeWarn">geen geometrie</span>
                  ) : rij.volumes > 1 ? (
                    <span className="meta">
                      {rij.volumes} volumes · {rij.volumes} rijen in sheet 2
                    </span>
                  ) : null}
                </td>
                <td>
                  <button
                    type="button"
                    className={styles.weg}
                    title="Uit de LARA-lijst halen"
                    disabled={bezig.has(rij.airspaceId)}
                    onClick={() => uitLijst(rij)}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
            {!zichtbaar.length && (
              <tr>
                <td colSpan={8} className={styles.leeg}>
                  {rijen.length ? (
                    "Geen gebieden die aan de filters voldoen."
                  ) : (
                    <>
                      De LARA-lijst is nog leeg.
                      <br />
                      Kies gebieden op het scherm <strong>Gebieden</strong>, of plak een lijst.
                    </>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {plakOpen && (
        <PlakVenster
          datasetId={datasetId}
          onSluiten={() => setPlakOpen(false)}
          onKlaar={() => {
            setPlakOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

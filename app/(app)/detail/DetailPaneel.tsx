"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { GebiedDetail, VolumeDetail } from "@/lib/gebiedDetail";
import { toonHoogte } from "@/lib/gebieden";
import styles from "./detail.module.css";

// MapLibre heeft `window` nodig; laden zodra het paneel in beeld is.
const GebiedKaart = dynamic(() => import("./GebiedKaart"), {
  ssr: false,
  loading: () => <div className={styles.kaartLeeg}>Kaart laden…</div>,
});

type Tab = "kaart" | "coord" | "aixm";

const band = (v: { lowerlimit: number | null; lowerunit: string | null; upperlimit: number | null; upperunit: string | null }) =>
  `${toonHoogte(v.lowerlimit, v.lowerunit)}–${toonHoogte(v.upperlimit, v.upperunit)}`;

/**
 * De schil staat los van de inhoud omdat het paneel vier gedaantes heeft — leeg,
 * ladend, mislukt en gevuld — en de sluitknop in alle vier op dezelfde plek moet
 * staan. Eén schil betekent ook dat het paneel bij een wissel niet opnieuw wordt
 * opgebouwd.
 */
function Schil({ onSluiten, children }: { onSluiten: () => void; children: React.ReactNode }) {
  return (
    <aside className={styles.paneel}>
      <button
        type="button"
        className={styles.sluit}
        onClick={onSluiten}
        aria-label="Detailpaneel sluiten"
        title="Detailpaneel sluiten"
      >
        ✕
      </button>
      {children}
    </aside>
  );
}

export default function DetailPaneel({
  airspaceId,
  onSluiten,
}: {
  airspaceId: string | null;
  onSluiten: () => void;
}) {
  // Het opgehaalde gebied draagt zijn eigen id mee. Zo hoeft er bij een wissel
  // niets te worden teruggezet in een effect — de vorige gegevens horen simpelweg
  // niet bij het huidige gebied, en dat is af te leiden in plaats van te resetten.
  const [geladen, setGeladen] = useState<{ id: string; gebied: GebiedDetail } | null>(null);
  const [laadFout, setLaadFout] = useState<{ id: string; bericht: string } | null>(null);
  const [keuze, setKeuze] = useState<{ id: string; index: number } | null>(null);
  const [tab, setTab] = useState<Tab>("coord");

  const gebied = geladen?.id === airspaceId ? geladen.gebied : null;
  const fout = laadFout?.id === airspaceId ? laadFout.bericht : null;
  const volumeIndex = keuze?.id === airspaceId ? keuze.index : 0;
  const laden = Boolean(airspaceId) && !gebied && !fout;

  useEffect(() => {
    if (!airspaceId) return;
    let afgebroken = false;

    fetch(`/api/airspaces/${airspaceId}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Ophalen mislukt.");
        return data.gebied as GebiedDetail;
      })
      .then((g) => {
        if (!afgebroken) setGeladen({ id: airspaceId, gebied: g });
      })
      .catch((e) => {
        if (!afgebroken) {
          setLaadFout({ id: airspaceId, bericht: e instanceof Error ? e.message : "Ophalen mislukt." });
        }
      });

    return () => {
      afgebroken = true;
    };
  }, [airspaceId]);

  if (!airspaceId) {
    return (
      <Schil onSluiten={onSluiten}>
        <div className={styles.leeg}>
          Kies een gebied in de lijst om de kaart, de coördinaten en het originele
          AIXM-fragment te zien.
        </div>
      </Schil>
    );
  }

  if (laden) {
    return (
      <Schil onSluiten={onSluiten}>
        <div className={styles.leeg}>Laden…</div>
      </Schil>
    );
  }

  if (fout || !gebied) {
    return (
      <Schil onSluiten={onSluiten}>
        <div className={styles.leeg}>{fout ?? "Gebied niet gevonden."}</div>
      </Schil>
    );
  }

  const volume: VolumeDetail | undefined = gebied.volumes[volumeIndex];
  const meerdere = gebied.volumes.length > 1;

  return (
    <Schil onSluiten={onSluiten}>
      <div className={styles.kop}>
        <div className={styles.kopRij}>
          <span className={styles.ident}>{gebied.ident}</span>
          {gebied.inLara ? (
            <span className="badge badgeOk">
              <span aria-hidden="true">✓</span>
              {gebied.laraAreaId !== null ? `ID:${gebied.laraAreaId}` : "in LARA"}
            </span>
          ) : (
            <span className="badge badgeQuiet">niet in LARA</span>
          )}
        </div>
        <div className={styles.naam}>{gebied.name ?? "—"}</div>

        <div className={styles.feiten}>
          <div className={styles.feit}>
            <span className={styles.feitSleutel}>Type</span>
            <span className={styles.feitWaarde}>{gebied.localType ?? gebied.type ?? "—"}</span>
          </div>
          <div className={styles.feit}>
            <span className={styles.feitSleutel}>Class</span>
            <span className={styles.feitWaarde}>{gebied.class ?? "—"}</span>
          </div>
          <div className={styles.feit}>
            <span className={styles.feitSleutel}>Onder</span>
            <span className={styles.feitWaarde}>
              {toonHoogte(gebied.lowerlimit, gebied.lowerunit)}
            </span>
          </div>
          <div className={styles.feit}>
            <span className={styles.feitSleutel}>Boven</span>
            <span className={styles.feitWaarde}>
              {toonHoogte(gebied.upperlimit, gebied.upperunit)}
            </span>
          </div>
          <div className={styles.feit}>
            <span className={styles.feitSleutel}>Geometrie</span>
            <span className={styles.feitWaarde}>{volume?.lara?.volumeType ?? "—"}</span>
          </div>
          <div className={styles.feit}>
            <span className={styles.feitSleutel}>Volumes</span>
            <span className={styles.feitWaarde}>{gebied.volumes.length}</span>
          </div>
        </div>
      </div>

      {gebied.geometryStatus === "partial" && (
        <div className={styles.waarschuwing}>
          Dit gebied verwijst naar een landsgrens die niet gevonden is. De zijde die hem volgt
          is een <strong>rechte lijn</strong> geworden — de coördinaten hieronder zijn dus niet
          de werkelijke vorm.
        </div>
      )}

      {meerdere && (
        <div className={styles.volBalk}>
          <span className="sectionLabel">Volume</span>
          {gebied.volumes.map((v, i) => (
            <button
              key={v.id}
              type="button"
              className={`${styles.volChip} ${i === volumeIndex ? styles.volChipAan : ""}`}
              onClick={() => setKeuze({ id: gebied.id, index: i })}
            >
              {i + 1} · {band(v)}
            </button>
          ))}
          <span className="spacer" />
          <span className={styles.volBron}>
            {volume?.operation ?? "—"}
            {volume?.derivedFrom.length ? ` · uit ${volume.derivedFrom.join(", ")}` : " · eigen geometrie"}
          </span>
        </div>
      )}

      <div className={styles.tabs}>
        {(
          [
            ["kaart", "Kaart"],
            ["coord", "Coördinaten"],
            ["aixm", "AIXM"],
          ] as [Tab, string][]
        ).map(([sleutel, naam]) => (
          <button
            key={sleutel}
            type="button"
            className={`${styles.tab} ${tab === sleutel ? styles.tabAan : ""}`}
            onClick={() => setTab(sleutel)}
          >
            {naam}
          </button>
        ))}
      </div>

      <div className={styles.tabInhoud}>
        {tab === "kaart" && (
          <GebiedKaart
            feature={volume?.geojson ?? null}
            label={`${gebied.ident}${meerdere ? ` · volume ${volumeIndex + 1}` : ""}`}
          />
        )}

        {tab === "coord" && <Coordinaten volume={volume} meerdere={meerdere} />}

        {tab === "aixm" && (
          <pre className={styles.xml}>
            {gebied.xmlSnippet ?? "Geen AIXM-fragment bewaard voor dit gebied."}
          </pre>
        )}
      </div>

      <div className={styles.voet}>
        <button
          type="button"
          className="btn btnSmall"
          disabled={!volume?.lara}
          onClick={() => navigator.clipboard.writeText(volume?.lara?.coordinates ?? "")}
        >
          Coördinaten kopiëren
        </button>
        <button
          type="button"
          className="btn btnSmall"
          disabled={!volume?.geojson}
          onClick={() => navigator.clipboard.writeText(JSON.stringify(volume?.geojson, null, 2))}
        >
          GeoJSON
        </button>
        <button
          type="button"
          className="btn btnSmall"
          disabled={!gebied.xmlSnippet}
          onClick={() => navigator.clipboard.writeText(gebied.xmlSnippet ?? "")}
        >
          XML
        </button>
      </div>
    </Schil>
  );
}

/**
 * De coördinatentab toont letterlijk wat er in kolom `Coordinates` van sheet 2
 * komt te staan — dezelfde functie, dezelfde uitkomst. Daarom staat de
 * scheidingstekst erbij: het is geen weergave maar de export zelf.
 */
function Coordinaten({ volume, meerdere }: { volume: VolumeDetail | undefined; meerdere: boolean }) {
  if (!volume?.lara) {
    return (
      <div className={styles.leeg}>
        Dit volume levert geen coördinaten op. Zonder vorm komt de rij leeg in de export.
      </div>
    );
  }

  if (volume.lara.volumeType === "Circle") {
    const [midden, straal] = volume.lara.coordinates.split(";");
    return (
      <>
        <div className={styles.coordNoot}>
          Een cirkel gaat als middelpunt en straal de export in, niet als reeks punten.
        </div>
        <div className={styles.cirkel}>
          <div>middelpunt {midden}</div>
          <div>straal {straal}</div>
        </div>
      </>
    );
  }

  const punten = volume.lara.coordinates.split(";");
  return (
    <>
      <div className={styles.coordNoot}>
        Precies de reeks die in kolom <span className="mono">Coordinates</span> van sheet{" "}
        <span className="mono">Area Volumes</span> terechtkomt
        {meerdere ? ", voor dít volume" : ""}. Bogen zijn geïnterpoleerd; het eerste punt wordt
        aan het eind herhaald.
      </div>
      <ul className={styles.coordLijst}>
        {punten.map((punt, i) => (
          <li key={`${punt}-${i}`}>
            <span className={styles.coordIdx}>{i + 1}</span>
            <span>{punt}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

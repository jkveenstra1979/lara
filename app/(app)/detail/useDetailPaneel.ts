"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Het detailpaneel aan de rechterkant: open of dicht, en hoe breed.
 *
 * Staat hier los omdat twee schermen het gebruiken — de gebiedenlijst en de
 * LARA-selectie — en het gedrag op allebei hetzelfde hoort te zijn: dicht tot je
 * een rij aanklikt, te sluiten met de ✕, en te versmallen door de scheiding vast
 * te pakken.
 *
 * De klasnamen `split`, `lijstPaneel` en `splitter` staan in styles/base.css.
 */

/**
 * Wat het paneel minstens nodig heeft om leesbaar te blijven, en wat de lijst
 * minstens overhoudt. Onder de eerste vallen de coördinaten uit elkaar; onder de
 * tweede blijft er van de tabel niets over dan een kolom.
 */
const MIN_PANEEL = 320;
const MIN_LIJST = 420;

export function useDetailPaneel() {
  const [gekozen, setGekozen] = useState<string | null>(null);
  // Dicht tot je een rij aanklikt.
  const [open, setOpen] = useState(false);
  // null = nog niet versleept; dan bepaalt --detail-w uit tokens.css de breedte.
  const [breedte, setBreedte] = useState<number | null>(null);
  const [sleept, setSleept] = useState(false);
  const sleepStart = useRef<{ muisX: number; breedte: number } | null>(null);

  /** Binnen de perken van dit venster houden. */
  const begrens = useCallback((px: number) => {
    const max = Math.max(MIN_PANEEL, window.innerWidth - MIN_LIJST);
    return Math.round(Math.min(Math.max(px, MIN_PANEEL), max));
  }, []);

  // Een versleepte breedte kan te groot zijn voor een kleiner venster.
  useEffect(() => {
    if (breedte === null) return;
    const opnieuwMeten = () => setBreedte((b) => (b === null ? null : begrens(b)));
    window.addEventListener("resize", opnieuwMeten);
    return () => window.removeEventListener("resize", opnieuwMeten);
  }, [breedte, begrens]);

  /**
   * Bij de eerste sleep staat de breedte nog in CSS, niet in de state; die meten
   * we dan van het paneel. Dat is het element direct ná de scheiding — zo staat
   * het in de markup van allebei de schermen.
   */
  const huidigeBreedte = (splitter: HTMLElement) =>
    breedte ?? (splitter.nextElementSibling as HTMLElement | null)?.offsetWidth ?? MIN_PANEEL;

  const pakVast = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    sleepStart.current = { muisX: e.clientX, breedte: huidigeBreedte(e.currentTarget) };
    setSleept(true);
  };

  const schuif = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = sleepStart.current;
    if (!start) return;
    // Naar links slepen maakt het paneel breder, vandaar het min-teken.
    setBreedte(begrens(start.breedte - (e.clientX - start.muisX)));
  };

  const laatLos = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!sleepStart.current) return;
    sleepStart.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setSleept(false);
  };

  /** Met de pijltjes kan het ook — een scheiding die alleen sleept is niet bedienbaar. */
  const opToets = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const richting = e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? -1 : 0;
    if (!richting) return;
    e.preventDefault();
    setBreedte(begrens(huidigeBreedte(e.currentTarget) + richting * (e.shiftKey ? 64 : 16)));
  };

  return {
    gekozen,
    open,

    /** Een gebied kiezen opent het paneel — daar was de klik voor. */
    kies: (airspaceId: string) => {
      setGekozen(airspaceId);
      setOpen(true);
    },
    sluit: () => setOpen(false),
    wissel: () => setOpen((o) => !o),

    /** Op het element met klasse `split`. */
    splitProps: {
      "data-sleept": sleept || undefined,
      style:
        breedte === null
          ? undefined
          : ({ "--detail-w": `${breedte}px` } as CSSProperties),
    },

    /** Op het element met klasse `splitter`, tussen de lijst en het paneel. */
    splitterProps: {
      role: "separator",
      "aria-orientation": "vertical" as const,
      "aria-label": "Breedte van het detailpaneel",
      tabIndex: 0,
      onPointerDown: pakVast,
      onPointerMove: schuif,
      onPointerUp: laatLos,
      onPointerCancel: laatLos,
      onKeyDown: opToets,
    },
  };
}

"use client";

import { useRef, useSyncExternalStore } from "react";
import { Download, Expand } from "iconoir-react";
import styles from "./studies.module.css";

/**
 * The full study. On tablet and desktop, the deck the builder made, read-only, in a 16:9 stage
 * (arrow keys and clicks move between slides). On a phone, a 16:9 slide is a fifth of its size
 * and its text unreadable, so the slides come as images one under the other: tapping one opens
 * it full size, where the phone can turn or zoom. The PDF is always one tap away.
 */

const QUERY = "(min-width: 768px)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function useLayout(): "deck" | "stack" | null {
  return useSyncExternalStore(
    subscribe,
    () => (window.matchMedia(QUERY).matches ? "deck" : "stack"),
    () => null
  );
}

type Labels = { downloadPdf: string; fullscreen: string; tapHint: string; slideAlt: string[]; deckTitle: string };

export function StudyViewer({ deckSrc, slides, pdfHref, labels }: { deckSrc: string; slides: string[]; pdfHref: string | null; labels: Labels }) {
  const layout = useLayout();
  const stage = useRef<HTMLDivElement>(null);

  const pdf = pdfHref ? (
    <a className={styles.toolButtonPrimary} href={pdfHref} download>
      <Download aria-hidden /> {labels.downloadPdf}
    </a>
  ) : null;

  if (layout === "stack" && slides.length > 0) {
    return (
      <>
        <p className={styles.hint}>{labels.tapHint}</p>
        <ol className={styles.stack}>
          {slides.map((src, i) => (
            <li key={src}>
              <a href={src} target="_blank" rel="noopener">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={labels.slideAlt[i]} loading={i < 2 ? "eager" : "lazy"} decoding="async" />
              </a>
            </li>
          ))}
        </ol>
        {pdf ? <div className={styles.pdfDock}>{pdf}</div> : null}
      </>
    );
  }

  return (
    <>
      <div className={styles.viewerActions}>
        <button type="button" className={styles.toolButton} onClick={() => stage.current?.requestFullscreen?.()}>
          <Expand aria-hidden /> {labels.fullscreen}
        </button>
        {pdf}
      </div>
      <div className={styles.stage} ref={stage}>
        {layout === null ? null : <iframe src={deckSrc} title={labels.deckTitle} allow="fullscreen" referrerPolicy="same-origin" />}
      </div>
    </>
  );
}

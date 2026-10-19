"use client";

import { useEffect, useRef, useState } from "react";
import { PageControl } from "@/components/ui/PageControl";
import styles from "./ReachScroll.module.css";

export type ReachCopy = {
  title: string;
  languages: { label: string; items: string[] };
  countries: { label: string; items: string[] };
  time: { steps: string[]; label: string };
};

/** How long each language or country stays on screen, and how long each column stays lit. */
const WORD_MS = 1500;
const SPOT_MS = 4500;

/**
 * Languages and countries take turns one at a time, in a loop, under their count; the third
 * column holds "days". The lit column moves on its own (the dots show which one and pause it).
 * Nothing is tied to scroll; it only runs while the section is on screen.
 */
export function ReachScroll({ copy, beats, toggleLabels }: { copy: ReachCopy; beats: [string, string, string]; toggleLabels: { play: string; pause: string } }) {
  const ref = useRef<HTMLElement>(null);
  const [tick, setTick] = useState(0);
  const [spot, setSpot] = useState(0);
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold: 0.25 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const running = visible && !paused && !reduced;

  useEffect(() => {
    if (!running) return;
    const words = window.setInterval(() => setTick((t) => t + 1), WORD_MS);
    return () => window.clearInterval(words);
  }, [running]);

  useEffect(() => {
    if (!running) return;
    const spots = window.setInterval(() => setSpot((s) => (s + 1) % 3), SPOT_MS);
    return () => window.clearInterval(spots);
  }, [running, spot]);

  const days = copy.time.steps[copy.time.steps.length - 1]!;

  return (
    <section ref={ref} className={styles.section}>
      <div className={styles.inner}>
        <h2 className={styles.title}>{copy.title}</h2>
        <div className={styles.grid}>
          <div className={styles.stat} data-on={spot === 0}>
            <Rotator items={copy.languages.items} index={tick} moved={tick > 0} />
            <span className={styles.label}>{copy.languages.label}</span>
          </div>
          <div className={styles.stat} data-on={spot === 1}>
            {/* Offset by half the list so the two columns never change in step. */}
            <Rotator items={copy.countries.items} index={tick + Math.floor(copy.countries.items.length / 2)} moved={tick > 0} />
            <span className={styles.label}>{copy.countries.label}</span>
          </div>
          <div className={styles.stat} data-on={spot === 2}>
            <span className={styles.word}>
              <span className={styles.wordText} style={fit(days)}>
                {days}
              </span>
            </span>
            <span className={styles.label}>{copy.time.label}</span>
          </div>
        </div>
        {!reduced ? (
          <PageControl
            className={styles.dots}
            count={3}
            active={spot}
            labels={beats}
            onSelect={setSpot}
            duration={SPOT_MS}
            playing={running}
            onToggle={() => setPaused((p) => !p)}
            toggleLabels={toggleLabels}
          />
        ) : null}
      </div>
    </section>
  );
}

/** Long words get a smaller size so every word fits its column on one line. */
function fit(word: string) {
  return { fontSize: `min(var(--reach-size), calc(100cqi / ${(Math.max(word.length, 5) * 0.56).toFixed(2)}))` };
}

/** One word at a time: the new one rises in while the previous one leaves upward. */
function Rotator({ items, index, moved }: { items: string[]; index: number; moved: boolean }) {
  const current = items[index % items.length]!;
  const previous = moved ? items[(index - 1) % items.length]! : null;
  return (
    <span className={styles.word} aria-live="off">
      {previous && previous !== current ? (
        <span key={`out-${index}`} className={styles.wordText} data-out style={fit(previous)} aria-hidden>
          {previous}
        </span>
      ) : null}
      <span key={`in-${index}`} className={styles.wordText} data-in={moved} style={fit(current)}>
        {current}
      </span>
    </span>
  );
}

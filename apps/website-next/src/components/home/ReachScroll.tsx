"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ReachScroll.module.css";

export type ReachCopy = {
  title: string;
  languages: { label: string; items: string[] };
  countries: { label: string; items: string[] };
  time: { steps: string[]; label: string };
};

/**
 * Scroll-driven: the section pins while the reader scrolls through three beats. Languages count
 * up one by one, then countries, then the time drops from weeks to days.
 */
export function ReachScroll({ copy }: { copy: ReachCopy }) {
  const ref = useRef<HTMLElement>(null);
  const [p, setP] = useState(1);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const onScroll = () => {
      const el = ref.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      const run = box.height - window.innerHeight;
      setP(Math.min(1, Math.max(0, -box.top / (run || 1))));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // Three beats, each with a short hold at the end.
  const beat = (i: number) => Math.min(1, Math.max(0, (p - i * 0.31) / 0.26));
  const lang = beat(0);
  const country = beat(1);
  const time = beat(2);
  const stage = p < 0.31 ? 0 : p < 0.62 ? 1 : 2;
  const langCount = Math.round(lang * copy.languages.items.length);
  const countryCount = Math.round(country * copy.countries.items.length);
  const timeIndex = Math.min(copy.time.steps.length - 1, Math.floor(time * copy.time.steps.length));

  return (
    <section ref={ref} className={styles.section}>
      <div className={styles.sticky}>
        <div className={styles.inner}>
          <h2 className={styles.title}>{copy.title}</h2>
          <div className={styles.grid}>
            <div className={styles.stat} data-on={stage === 0} data-done={lang >= 1}>
              <span className={styles.value}>{langCount}</span>
              <span className={styles.label}>{copy.languages.label}</span>
              <ul className={styles.chips}>
                {copy.languages.items.map((item, i) => (
                  <li key={item} data-in={i < langCount}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className={styles.stat} data-on={stage === 1} data-done={country >= 1}>
              <span className={styles.value}>
                {Math.min(20, countryCount)}
                {countryCount >= 20 ? "+" : ""}
              </span>
              <span className={styles.label}>{copy.countries.label}</span>
              <ul className={styles.chips}>
                {copy.countries.items.map((item, i) => (
                  <li key={item} data-in={i < countryCount}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className={styles.stat} data-on={stage === 2} data-done={time >= 1}>
              <span className={styles.value} key={timeIndex}>
                {copy.time.steps[timeIndex]}
              </span>
              <span className={styles.label}>{copy.time.label}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

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

/**
 * Three beats: languages count up one by one, then countries, then the time drops from weeks to
 * days. Scroll-driven on phones (the section pins); on desktop they play once when in view.
 */
export function ReachScroll({ copy, beats }: { copy: ReachCopy; beats: [string, string, string] }) {
  const ref = useRef<HTMLElement>(null);
  const [p, setP] = useState(1);

  // Phones: the section pins and the scroll drives the three beats.
  // Desktop: no pinning; the beats play on their own the first time the section is in view.
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const desktop = window.matchMedia("(min-width: 960px)").matches;
    setWide(desktop);
    const el = ref.current;
    if (!el) return;
    if (desktop) {
      setP(0);
      let raf = 0;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry?.isIntersecting) return;
          observer.disconnect();
          const start = performance.now();
          const tick = (now: number) => {
            const t = Math.min(1, (now - start) / 6500);
            setP(t);
            if (t < 1) raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
        },
        { threshold: 0.45 }
      );
      observer.observe(el);
      return () => {
        observer.disconnect();
        cancelAnimationFrame(raf);
      };
    }
    const onScroll = () => {
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

  // Three beats in about one and a half screens of scrolling, each with a short hold.
  const beat = (i: number) => Math.min(1, Math.max(0, (p - i * 0.33) / 0.24));
  const lang = beat(0);
  const country = beat(1);
  const time = beat(2);
  const stage = p < 0.33 ? 0 : p < 0.66 ? 1 : 2;
  // The dots also jump: each one scrolls to the start of its beat.
  const jump = (i: number) => {
    if (wide) return setP(Math.min(1, i * 0.33 + 0.26));
    const el = ref.current;
    if (!el) return;
    const run = el.offsetHeight - window.innerHeight;
    window.scrollTo({ top: el.offsetTop + run * (i * 0.33 + 0.24), behavior: "smooth" });
  };
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
          <PageControl className={styles.dots} count={3} active={stage} labels={beats} onSelect={jump} />
        </div>
      </div>
    </section>
  );
}

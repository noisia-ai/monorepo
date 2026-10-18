"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./Counters.module.css";

function useSeen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && setSeen(true), { threshold: 0.6 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, seen };
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Counts up to the value the first time it scrolls into view. */
export function CountUp({ value, suffix, label }: { value: number; suffix: string; label: string }) {
  const { ref, seen } = useSeen<HTMLDivElement>();
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (!seen) {
      if (!reducedMotion()) setShown(0);
      return;
    }
    if (reducedMotion()) return setShown(value);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 1400);
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, value]);
  return (
    <div ref={ref} className={styles.stat}>
      <span className={styles.value} data-final={shown === value}>
        {shown}
        {suffix}
      </span>
      <span className={styles.label}>{label}</span>
    </div>
  );
}

/** Steps down through the time it usually takes (weeks) until it lands on ours. */
export function CountDown({ steps, label }: { steps: string[]; label: string }) {
  const { ref, seen } = useSeen<HTMLDivElement>();
  const last = steps.length - 1;
  const [index, setIndex] = useState(last);
  useEffect(() => {
    if (!seen) {
      if (!reducedMotion()) setIndex(0);
      return;
    }
    if (reducedMotion()) return setIndex(last);
    let i = 0;
    setIndex(0);
    const timer = window.setInterval(() => {
      i += 1;
      setIndex(i);
      if (i >= last) window.clearInterval(timer);
    }, 420);
    return () => window.clearInterval(timer);
  }, [seen, last]);
  return (
    <div ref={ref} className={styles.stat}>
      <span className={styles.value} data-final={index === last}>
        <span key={index} className={styles.tick}>
          {steps[index]}
        </span>
      </span>
      <span className={styles.label}>{label}</span>
    </div>
  );
}

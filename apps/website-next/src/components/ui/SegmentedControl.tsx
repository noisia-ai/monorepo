"use client";

import { useLayoutEffect, useRef, useState } from "react";
import styles from "./SegmentedControl.module.css";

/**
 * Apple-style segmented control: one pill, a highlight that slides to the chosen option.
 * Options keep their size, so nothing around it jumps when the choice changes.
 */
export function SegmentedControl({
  options,
  active,
  onChange,
  label,
  accent
}: {
  options: { key: string; label: string }[];
  active: number;
  onChange: (index: number) => void;
  label: string;
  /** Option index drawn in teal instead of ink (e.g. Noisia in a comparison). */
  accent?: number;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current[active];
      if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active, options.length]);

  useLayoutEffect(() => {
    const el = refs.current[active];
    const root = scroller.current;
    if (el && root && root.scrollWidth > root.clientWidth) root.scrollTo({ left: el.offsetLeft - 16, behavior: "smooth" });
  }, [active]);

  return (
    <div ref={scroller} className={styles.scroller}>
      <div className={styles.control} role="tablist" aria-label={label}>
        {thumb ? <span className={styles.thumb} data-accent={active === accent} style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }} aria-hidden /> : null}
        {options.map((option, i) => (
          <button
            key={option.key}
            ref={(el) => void (refs.current[i] = el)}
            type="button"
            role="tab"
            aria-selected={i === active}
            className={styles.option}
            onClick={() => onChange(i)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

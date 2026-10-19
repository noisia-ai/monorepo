"use client";

import { Pause, Play } from "iconoir-react";
import styles from "./PageControl.module.css";

type Props = {
  count: number;
  active: number;
  /** Names for screen readers, one per page. */
  labels: string[];
  onSelect: (index: number) => void;
  /** How long the active page lasts; the active dot fills over this time while playing. */
  duration?: number;
  playing?: boolean;
  onToggle?: () => void;
  toggleLabels?: { play: string; pause: string };
  className?: string;
};

/**
 * The one progress indicator of the site (Apple calls it a page control): dots in a soft pill,
 * the active one stretches and fills, with an optional play and pause button beside it.
 */
export function PageControl({ count, active, labels, onSelect, duration, playing = false, onToggle, toggleLabels, className }: Props) {
  return (
    <div className={`${styles.wrap} ${className ?? ""}`}>
      <div className={styles.pill}>
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            type="button"
            className={styles.dot}
            data-active={i === active}
            aria-label={labels[i]}
            aria-current={i === active}
            onClick={() => onSelect(i)}
          >
            {i === active ? (
              <span
                key={`${active}-${duration}`}
                className={styles.fill}
                data-timed={Boolean(duration)}
                style={duration ? { animationDuration: `${duration}ms`, animationPlayState: playing ? "running" : "paused" } : undefined}
              />
            ) : null}
          </button>
        ))}
      </div>
      {onToggle ? (
        <button type="button" className={styles.toggle} aria-label={playing ? toggleLabels?.pause : toggleLabels?.play} onClick={onToggle}>
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        </button>
      ) : null}
    </div>
  );
}

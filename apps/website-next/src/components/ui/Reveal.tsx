import type { CSSProperties, ReactNode } from "react";
import styles from "./reveal.module.css";

/**
 * Fades content up as it enters the viewport using CSS scroll-driven animations.
 * No JavaScript: browsers without support (and readers with reduced motion) simply see it.
 */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const style = { "--reveal-shift": `${Math.round(delay * 100)}%` } as CSSProperties;
  return (
    <div className={className ? `${styles.reveal} ${className}` : styles.reveal} style={style}>
      {children}
    </div>
  );
}

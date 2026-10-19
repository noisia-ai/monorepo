import type { CSSProperties, ReactNode } from "react";

/** Wraps content in an Apple-style entrance (see ScrollReveal); `delay` staggers siblings, in seconds. */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const style = { "--reveal-delay": `${Math.round(delay * 1500)}ms` } as CSSProperties;
  return (
    <div className={className} style={style} data-reveal>
      {children}
    </div>
  );
}

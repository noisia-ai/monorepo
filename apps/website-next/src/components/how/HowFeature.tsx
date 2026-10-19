import type { CSSProperties, ReactNode } from "react";
import clsx from "clsx";
import styles from "./how.module.css";

/**
 * One idea per section: a big title, one short paragraph and its animation. Stacked on
 * phones (text, then the animation); two columns on desktop, alternating sides with `flip`.
 */
export function HowFeature({
  title,
  lead,
  media,
  flip = false,
  tone = "default",
  children
}: {
  title: string;
  lead: string;
  media: ReactNode;
  flip?: boolean;
  tone?: "default" | "soft";
  children?: ReactNode;
}) {
  return (
    <section className={clsx(styles.feature, tone === "soft" && styles.soft)}>
      <div className={clsx(styles.featureInner, flip && styles.flip)}>
        <div className={styles.featureText} data-reveal>
          <h2 className={styles.featureTitle}>{title}</h2>
          <p className={styles.featureLead}>{lead}</p>
          {children}
        </div>
        <div className={styles.featureMedia} data-reveal style={{ "--reveal-delay": "140ms" } as CSSProperties}>
          {media}
        </div>
      </div>
    </section>
  );
}

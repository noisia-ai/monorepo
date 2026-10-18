import type { ReactNode } from "react";
import clsx from "clsx";
import styles from "./ui.module.css";

type Props = {
  id?: string;
  title?: ReactNode;
  lead?: ReactNode;
  tone?: "default" | "soft" | "dark";
  width?: "read" | "wide";
  children?: ReactNode;
  className?: string;
};

/** Page section with an optional plain title and lead. No eyebrows by design. */
export function Section({ id, title, lead, tone = "default", width = "wide", children, className }: Props) {
  return (
    <section id={id} className={clsx(styles.section, styles[`tone-${tone}`], className)}>
      <div className={clsx(styles.container, width === "read" && styles.read)}>
        {title || lead ? (
          <header className={styles.sectionHead}>
            {title ? <h2 className={styles.sectionTitle}>{title}</h2> : null}
            {lead ? <p className={styles.sectionLead}>{lead}</p> : null}
          </header>
        ) : null}
        {children}
      </div>
    </section>
  );
}

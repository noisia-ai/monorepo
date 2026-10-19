"use client";

import { useId, useState } from "react";
import { Plus } from "iconoir-react";
import { FAQ_ICONS, type FaqIcon } from "./faq-icons";
import styles from "./ui.module.css";

/** Each answer opens and closes with a height and fade transition, one or many at a time. */
export function FaqList({ items }: { items: { q: string; a: string; icon?: FaqIcon }[] }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const id = useId();
  const toggle = (i: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  return (
    <div className={styles.faq}>
      {items.map((item, i) => {
        const isOpen = open.has(i);
        return (
          <div key={item.q} className={styles.faqItem} data-open={isOpen}>
            <button type="button" className={styles.faqQ} aria-expanded={isOpen} aria-controls={`${id}-${i}`} onClick={() => toggle(i)}>
              {item.icon ? (
                <span className={styles.faqLead} aria-hidden>
                  {(() => {
                    const Icon = FAQ_ICONS[item.icon];
                    return <Icon />;
                  })()}
                </span>
              ) : null}
              <span className={styles.faqText}>{item.q}</span>
              <span className={styles.faqIcon} aria-hidden>
                <Plus />
              </span>
            </button>
            <div id={`${id}-${i}`} className={styles.faqPanel} role="region">
              <div className={styles.faqInner}>
                <p className={item.icon ? `${styles.faqA} ${styles.faqAIndented}` : styles.faqA}>{item.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

"use client";

import { useRef, useState, type CSSProperties } from "react";
import { Plus } from "iconoir-react";
import { methodOrder, methodSheet, methodSheetLabels, type MethodKey } from "@/content/pages/method-sheet";
import { MethodSheet } from "./MethodSheet";
import styles from "./methods.module.css";

/** The six methods as cards; each one opens the same sheet the chips open elsewhere on the site. */
export function MethodLibrary({ locale }: { locale: string }) {
  const lang = locale === "en" ? "en" : "es";
  const [open, setOpen] = useState<MethodKey | null>(null);
  const triggers = useRef<Partial<Record<MethodKey, HTMLButtonElement | null>>>({});
  const returnFocus = useRef<HTMLElement | null>(null);

  return (
    <>
      <ul className={styles.library}>
        {methodOrder.map((key, i) => {
          const data = methodSheet[key];
          const Icon = data.icon;
          return (
            <li key={key} data-reveal style={{ "--reveal-delay": `${i * 70}ms` } as CSSProperties}>
              <button
                ref={(el) => {
                  triggers.current[key] = el;
                }}
                type="button"
                className={styles.libraryCard}
                aria-haspopup="dialog"
                aria-label={`${methodSheetLabels[lang].open} ${data.name}`}
                onClick={() => {
                  returnFocus.current = triggers.current[key] ?? null;
                  setOpen(key);
                }}
              >
                <span className={styles.libraryIcon} aria-hidden>
                  <Icon />
                </span>
                <span className={styles.libraryText}>
                  <span className={styles.libraryName}>{data.name}</span>
                  <span className={styles.libraryQuestion}>{data[lang].question}</span>
                </span>
                <span className={styles.libraryPlus} aria-hidden>
                  <Plus />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {methodOrder.map((key) => (
        <MethodSheet key={key} method={key} locale={locale} open={open === key} onClose={() => setOpen(null)} returnFocus={returnFocus} />
      ))}
    </>
  );
}

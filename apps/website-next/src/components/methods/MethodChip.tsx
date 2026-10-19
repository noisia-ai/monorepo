"use client";

import { useRef, useState } from "react";
import { methodSheet, methodSheetLabels, type MethodKey } from "@/content/pages/method-sheet";
import { MethodSheet } from "./MethodSheet";
import styles from "./MethodChip.module.css";

type Props = { method: MethodKey; locale: string; label?: string };

/** A quiet chip with a method's icon and name; tapping it opens the method in a sheet. */
export function MethodChip({ method, locale, label }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const data = methodSheet[method];
  const Icon = data.icon;
  const lang = locale === "en" ? "en" : "es";
  const text = label ?? data.name;
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={styles.chip}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${methodSheetLabels[lang].open} ${data.name}`}
      >
        <span className={styles.icon} aria-hidden>
          <Icon />
        </span>
        <span className={styles.label}>{text}</span>
      </button>
      <MethodSheet method={method} locale={locale} open={open} onClose={() => setOpen(false)} returnFocus={ref} />
    </>
  );
}

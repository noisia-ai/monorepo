"use client";

import { useState } from "react";
import NextLink from "next/link";
import styles from "./LangToggle.module.css";

/**
 * ES / EN as a real two-way switch. The choice is stored in the NEXT_LOCALE cookie so it wins
 * over the browser language on the next visit, and the jump is a client navigation, not a reload.
 */
export function LangToggle({ locale, otherHref, label }: { locale: string; otherHref: string; label: string }) {
  // The thumb moves on click, before the new language finishes loading.
  const [shown, setShown] = useState(locale);
  const remember = (value: string) => {
    document.cookie = `NEXT_LOCALE=${value}; path=/; max-age=31536000; samesite=lax`;
    setShown(value);
  };
  return (
    <div className={styles.toggle} role="group" aria-label={label} data-locale={shown}>
      <span className={styles.thumb} aria-hidden />
      {(["es", "en"] as const).map((code) =>
        code === locale ? (
          <span key={code} className={styles.option} aria-current="true" lang={code}>
            {code.toUpperCase()}
          </span>
        ) : (
          <NextLink key={code} href={otherHref} className={styles.option} hrefLang={code} lang={code} prefetch={false} onClick={() => remember(code)}>
            {code.toUpperCase()}
          </NextLink>
        )
      )}
    </div>
  );
}

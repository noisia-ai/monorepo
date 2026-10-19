"use client";

import { useState, type MouseEvent } from "react";
import styles from "./LangToggle.module.css";

/**
 * ES / EN as a real two-way switch. The choice goes to the NEXT_LOCALE cookie so it wins over
 * the device language on later visits. Changing language reloads the root layout, so the page
 * fades out first and the next one fades in (inline script in the locale layout).
 */
export function LangToggle({ locale, otherHref, label }: { locale: string; otherHref: string; label: string }) {
  const [shown, setShown] = useState(locale);
  const go = (event: MouseEvent<HTMLAnchorElement>, value: string) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    document.cookie = `NEXT_LOCALE=${value}; path=/; max-age=31536000; samesite=lax`;
    setShown(value);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    try {
      if (!reduced) sessionStorage.setItem("noisia-lang-switch", "1");
    } catch {
      // storage unavailable: the switch still works, just without the fade
    }
    if (!reduced) document.documentElement.dataset.lang = "out";
    window.setTimeout(() => window.location.assign(otherHref), reduced ? 0 : 220);
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
          <a key={code} href={otherHref} className={styles.option} hrefLang={code} lang={code} onClick={(event) => go(event, code)}>
            {code.toUpperCase()}
          </a>
        )
      )}
    </div>
  );
}

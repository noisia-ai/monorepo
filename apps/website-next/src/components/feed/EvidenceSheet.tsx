"use client";

import { useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Xmark } from "iconoir-react";
import { SourceMark } from "@/components/brand/SourceMark";
import { MentionMeta } from "./MentionMeta";
import type { FeedStory } from "./types";
import styles from "./Feed.module.css";

export function EvidenceSheet({ story, onClose }: { story: FeedStory; onClose: () => void }) {
  const t = useTranslations("feed");
  const locale = useLocale();
  const closeRef = useRef<HTMLButtonElement>(null);

  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !sheetRef.current) return;
      // Keep focus inside the dialog.
      const focusable = sheetRef.current.querySelectorAll<HTMLElement>("button, a[href], [tabindex]:not([tabindex='-1'])");
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const facts = [
    story.method ? { label: t("method"), value: story.method } : null,
    story.period ? { label: t("period"), value: story.period } : null,
    { label: t("market"), value: story.market }
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className={styles.sheetBackdrop} onClick={onClose}>
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.sheetHead}>
          <div>
            <h2 id="evidence-title" className={styles.sheetTitle}>
              {t("evidenceTitle")}
            </h2>
            <p className={styles.sheetIntro}>{t("evidenceIntro")}</p>
          </div>
          <button ref={closeRef} type="button" className={styles.iconAction} aria-label={t("closeSheet")} onClick={onClose}>
            <Xmark aria-hidden />
          </button>
        </div>

        <ul className={styles.quotes}>
          {story.content.evidence.map((item, i) => (
            <li key={i} className={styles.mention}>
              <div className={styles.bubble}>
                <p className={styles.quoteText}>{item.quote}</p>
                {item.translation ? <p className={styles.quoteTranslation}>{item.translation}</p> : null}
              </div>
              <MentionMeta platform={item.platform} date={item.date} locale={locale} />
            </li>
          ))}
        </ul>

        {story.sources.length ? (
          <div className={styles.sourcesBlock}>
            <p className={styles.factLabel}>{t("sources")}</p>
            <ul className={styles.sourceList}>
              {story.sources.map((source) => (
                <li key={source}>
                  <SourceMark name={source} locale={locale} size={16} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <dl className={styles.facts}>
          {facts.map((fact) => (
            <div key={fact.label} className={styles.fact}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>

        <div className={styles.takeaway}>
          <p className={styles.takeawayLabel}>{t("whatToDo")}</p>
          <p className={styles.takeawayText}>{story.content.takeaway}</p>
        </div>
      </div>
    </div>
  );
}

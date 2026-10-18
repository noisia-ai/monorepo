"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Xmark } from "iconoir-react";
import type { FeedStory } from "./types";
import styles from "./Feed.module.css";

export function EvidenceSheet({ story, onClose }: { story: FeedStory; onClose: () => void }) {
  const t = useTranslations("feed");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const facts = [
    story.method ? { label: t("method"), value: story.method } : null,
    story.sources.length ? { label: t("sources"), value: story.sources.join(" · ") } : null,
    story.period ? { label: t("period"), value: story.period } : null,
    { label: t("market"), value: story.market }
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className={styles.sheetBackdrop} onClick={onClose}>
      <div
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
            <li key={i} className={styles.quote}>
              <p className={styles.quoteText}>{item.quote}</p>
              {item.translation ? <p className={styles.quoteTranslation}>{item.translation}</p> : null}
              <p className={styles.quoteMeta}>
                {item.platform}
                {item.date ? ` · ${item.date}` : ""}
              </p>
            </li>
          ))}
        </ul>

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

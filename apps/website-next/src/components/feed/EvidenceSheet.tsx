"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { OpenBook, Xmark } from "iconoir-react";
import { SourceMark } from "@/components/brand/SourceMark";
import { MentionMeta } from "./MentionMeta";
import type { FeedStory } from "./types";
import styles from "./Feed.module.css";

const CLOSE_MS = 280;

/**
 * Everything behind a reel: what it says, the mentions that hold it up, sources, method and what
 * a brand can do. On a phone it is a bottom sheet that rises from the edge and closes by dragging
 * it down from the handle, or from anywhere once its content is scrolled to the top.
 */
export function EvidenceSheet({ story, onClose }: { story: FeedStory; onClose: () => void }) {
  const t = useTranslations("feed");
  const locale = useLocale();
  const backdropRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [closing, setClosing] = useState(false);

  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(onClose, reduced ? 0 : CLOSE_MS);
  }, [closing, onClose]);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
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
  }, [requestClose]);

  // Drag to dismiss. Touch listeners are registered by hand because React's are passive and the
  // drag has to stop the page behind from scrolling.
  useEffect(() => {
    const sheet = sheetRef.current;
    const body = bodyRef.current;
    const backdrop = backdropRef.current;
    if (!sheet || !body || !backdrop) return;
    let startY = 0;
    let startTime = 0;
    let delta = 0;
    let armed = false;
    let dragging = false;
    let fromHandle = false;

    const setOffset = (y: number) => {
      sheet.style.transform = y > 0 ? `translateY(${y}px)` : "";
      backdrop.style.backgroundColor = y > 0 ? `rgba(6, 18, 24, ${0.36 * Math.max(0, 1 - y / sheet.offsetHeight)})` : "";
    };

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      startY = event.touches[0].clientY;
      startTime = performance.now();
      delta = 0;
      dragging = false;
      fromHandle = Boolean((event.target as HTMLElement).closest(`.${styles.grab}`));
      armed = fromHandle || body.scrollTop <= 0;
    };
    const onMove = (event: TouchEvent) => {
      if (!armed) return;
      delta = event.touches[0].clientY - startY;
      if (!dragging) {
        if (delta > 6) {
          dragging = true;
          sheet.dataset.dragging = "true";
        } else if (delta < -6 && !fromHandle) {
          armed = false; // scrolling the content up
          return;
        } else return;
      }
      event.preventDefault();
      setOffset(Math.max(0, delta));
    };
    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      delete sheet.dataset.dragging;
      const velocity = delta / Math.max(1, performance.now() - startTime);
      if (delta > sheet.offsetHeight * 0.25 || velocity > 0.6) {
        sheet.style.transform = "translateY(100%)";
        backdrop.style.backgroundColor = "";
        requestClose();
      } else setOffset(0);
    };

    sheet.addEventListener("touchstart", onStart, { passive: true });
    sheet.addEventListener("touchmove", onMove, { passive: false });
    sheet.addEventListener("touchend", onEnd);
    sheet.addEventListener("touchcancel", onEnd);
    // Touches on the dimmed area never scroll the feed behind it.
    const block = (event: TouchEvent) => {
      if (event.target === backdrop) event.preventDefault();
    };
    backdrop.addEventListener("touchmove", block, { passive: false });
    return () => {
      sheet.removeEventListener("touchstart", onStart);
      sheet.removeEventListener("touchmove", onMove);
      sheet.removeEventListener("touchend", onEnd);
      sheet.removeEventListener("touchcancel", onEnd);
      backdrop.removeEventListener("touchmove", block);
    };
  }, [requestClose]);

  const facts = [
    story.method ? { label: t("method"), value: story.method } : null,
    story.period ? { label: t("period"), value: story.period } : null,
    { label: t("market"), value: story.market }
  ].filter(Boolean) as { label: string; value: string }[];

  const kind = story.kind === "editorial" ? t("kindEditorial") : story.kind === "demo" ? t("kindDemo") : t("kindExample");

  return (
    <div ref={backdropRef} className={styles.sheetBackdrop} data-state={closing ? "closing" : "open"} onClick={requestClose}>
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.grab} aria-hidden />
        <div ref={bodyRef} className={styles.sheetBody}>
          <div className={styles.sheetHead}>
            <div>
              <span className={story.kind === "demo" ? styles.kindDemo : styles.kind}>
                {kind} · {story.tag}
              </span>
              <h2 id="evidence-title" className={styles.sheetTitle}>
                {story.content.title}
              </h2>
              <p className={styles.sheetIntro}>{story.content.dek}</p>
            </div>
            <button ref={closeRef} type="button" className={styles.sheetClose} aria-label={t("closeSheet")} onClick={requestClose}>
              <Xmark aria-hidden />
            </button>
          </div>

          <div>
            <h3 className={styles.sheetSection}>{t("evidenceTitle")}</h3>
            <p className={styles.sheetIntro}>{t("evidenceIntro")}</p>
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

          {story.reportHref ? (
            <a className={styles.sheetReport} href={story.reportHref}>
              <OpenBook aria-hidden /> {t("report")}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

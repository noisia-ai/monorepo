"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { OpenBook, Pause, Play, ShareIos } from "iconoir-react";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/brand/Logo";
import { SourceIcon, sourceLabel } from "@/components/brand/SourceMark";
import { Stage } from "@/motion/runtime";
import { StoryComposition, posterFrame, storyDuration } from "@/motion/StoryComposition";
import { CANVAS } from "@/motion/theme";
import { EvidenceSheet } from "./EvidenceSheet";
import { MentionMeta } from "./MentionMeta";
import type { FeedCollection, FeedStory } from "./types";
import styles from "./Feed.module.css";

export type FeedFilter = { type: "industry" | "collection"; id: string };

type Props = {
  stories: FeedStory[];
  collections?: FeedCollection[];
  initialId?: string;
  initialFilter?: FeedFilter;
  initialTitle?: string;
};

const matches = (story: FeedStory, filter: FeedFilter | null) =>
  !filter || (filter.type === "collection" ? story.collection === filter.id : story.industry === filter.id);

const WINDOW = 1;

function rotateTo(stories: FeedStory[], id?: string): FeedStory[] {
  const at = id ? stories.findIndex((story) => story.id === id) : -1;
  return at > 0 ? [...stories.slice(at), ...stories.slice(0, at)] : stories;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function Feed({ stories, collections = [], initialId, initialFilter, initialTitle }: Props) {
  const t = useTranslations("feed");
  const tIndustry = useTranslations("industries");
  const locale = useLocale();
  const reduced = usePrefersReducedMotion();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<FeedFilter | null>(
    initialFilter && stories.some((story) => matches(story, initialFilter)) ? initialFilter : null
  );
  const [cycles, setCycles] = useState(1);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [optIn, setOptIn] = useState(false);
  const [sheet, setSheet] = useState<FeedStory | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const evidenceTrigger = useRef<HTMLElement | null>(null);

  const base = useMemo(() => {
    const filtered = stories.filter((story) => matches(story, filter));
    return rotateTo(filtered, filter ? undefined : initialId);
  }, [stories, filter, initialId]);

  // Infinite feed: when the reader nears the end, the list repeats.
  const items = useMemo(
    () => Array.from({ length: cycles }, (_, c) => base.map((story) => ({ story, key: `${story.id}-${c}` }))).flat(),
    [base, cycles]
  );

  const industries = useMemo(() => Array.from(new Set(stories.map((story) => story.industry))), [stories]);
  const collectionName = useMemo(() => new Map(collections.map((collection) => [collection.id, collection.name])), [collections]);

  // Every item is exactly one viewport tall, so the active story follows from the scroll
  // position. Simpler and sturdier than an IntersectionObserver across browsers.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const update = () => {
      const height = root.clientHeight || 1;
      setActive(Math.max(0, Math.round(root.scrollTop / height)));
    };
    update();
    root.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      root.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [items]);

  useEffect(() => {
    if (base.length > 1 && active >= items.length - 2) setCycles((count) => count + 1);
  }, [active, items.length, base.length]);

  // Each story keeps its own shareable URL; the address bar follows the feed.
  const activeId = items[active]?.story.id;
  useEffect(() => {
    if (!activeId) return;
    const path = `${locale === "en" ? "/en" : ""}/insights/${activeId}`;
    if (window.location.pathname !== path) window.history.replaceState(window.history.state, "", path + window.location.search);
    setPaused(false);
    setOptIn(false);
  }, [activeId, locale]);

  const scrollToIndex = useCallback((index: number) => {
    const root = scrollerRef.current;
    const target = root?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    target?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, [reduced]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (sheet || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      // Leave keys alone while a control has focus: Space must still press buttons.
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, a, input, textarea, select, [contenteditable]")) return;
      if (["ArrowDown", "PageDown", "j"].includes(event.key)) {
        event.preventDefault();
        scrollToIndex(active + 1);
      } else if (["ArrowUp", "PageUp", "k"].includes(event.key)) {
        event.preventDefault();
        scrollToIndex(Math.max(0, active - 1));
      } else if (event.key === " ") {
        event.preventDefault();
        setPaused((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, scrollToIndex, sheet]);

  const share = useCallback(
    async (story: FeedStory) => {
      const url = `${window.location.origin}${locale === "en" ? "/en" : ""}/insights/${story.id}`;
      try {
        if (navigator.share) {
          await navigator.share({ title: story.content.title, url });
          return;
        }
        await navigator.clipboard.writeText(url);
        setToast(t("copied"));
        if (toastTimer.current) window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(null), 1800);
      } catch (error) {
        // Closing the native share sheet throws AbortError; anything else falls back to copying.
        if ((error as Error)?.name !== "AbortError") {
          await navigator.clipboard?.writeText(url).catch(() => undefined);
          setToast(t("copied"));
          if (toastTimer.current) window.clearTimeout(toastTimer.current);
          toastTimer.current = window.setTimeout(() => setToast(null), 1800);
        }
      }
    },
    [locale, t]
  );

  const closeSheet = useCallback(() => {
    setSheet(null);
    // Return focus to the button that opened the sheet.
    window.requestAnimationFrame(() => evidenceTrigger.current?.focus());
  }, []);

  const changeFilter = (value: FeedFilter | null) => {
    setFilter(value);
    setCycles(1);
    setActive(0);
    scrollerRef.current?.scrollTo({ top: 0 });
    // The tab lives in the query string so a study's feed can be shared as one link.
    const params = new URLSearchParams(window.location.search);
    ["coleccion", "collection", "industria", "industry"].forEach((key) => params.delete(key));
    if (value) params.set(value.type === "collection" ? (locale === "en" ? "collection" : "coleccion") : locale === "en" ? "industry" : "industria", value.id);
    const query = params.toString();
    window.history.replaceState(window.history.state, "", window.location.pathname + (query ? `?${query}` : ""));
  };
  const isOn = (type: FeedFilter["type"], id: string) => filter?.type === type && filter.id === id;

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.logo}>
          <Logo height={22} />
        </Link>
        <nav className={styles.filters} aria-label={t("filter")}>
          <button type="button" className={styles.chip} aria-pressed={filter === null} onClick={() => changeFilter(null)}>
            {tIndustry("all")}
          </button>
          {collections.map((collection) => (
            <button
              key={collection.id}
              type="button"
              className={`${styles.chip} ${styles.chipCollection}`}
              aria-pressed={isOn("collection", collection.id)}
              onClick={() => changeFilter({ type: "collection", id: collection.id })}
            >
              <span className={styles.chipDot} aria-hidden />
              {collection.name}
            </button>
          ))}
          {industries.map((industry) => (
            <button
              key={industry}
              type="button"
              className={styles.chip}
              aria-pressed={isOn("industry", industry)}
              onClick={() => changeFilter({ type: "industry", id: industry })}
            >
              {tIndustry(industry)}
            </button>
          ))}
        </nav>
      </header>

      <h1 className="visually-hidden">{initialTitle ?? t("heading")}</h1>
      <div ref={scrollerRef} className={styles.scroller} role="feed" aria-label={t("label")} aria-busy={false}>
        {items.map(({ story, key }, index) => {
          const near = Math.abs(index - active) <= WINDOW;
          const isActive = index === active;
          const duration = storyDuration(story.content);
          const playing = isActive && !paused && (!reduced || optIn);
          return (
            <article
              key={key}
              data-index={index}
              className={styles.item}
              tabIndex={0}
              aria-posinset={index + 1}
              aria-setsize={-1}
              aria-labelledby={`${key}-title`}
            >
              <div className={styles.stageWrap}>
                {near ? (
                  <Stage
                    className={styles.stage}
                    align="top"
                    durationInFrames={duration}
                    fps={CANVAS.fps}
                    playing={playing}
                    frame={isActive && !reduced ? 0 : posterFrame(story.content)}
                    label={story.content.title}
                  >
                    <StoryComposition story={story.content} locale={locale} tag={story.tag} mode="feed" />
                  </Stage>
                ) : null}
                {isActive ? (
                  <button
                    type="button"
                    className={styles.playToggle}
                    aria-label={playing ? t("pause") : t("play")}
                    onClick={() => (reduced && !optIn ? setOptIn(true) : setPaused((value) => !value))}
                  >
                    {playing ? <Pause /> : <Play />}
                  </button>
                ) : null}
              </div>

              {near ? (
              <div className={styles.caption}>
                <div className={styles.metaRow}>
                  <span className={story.kind === "demo" ? styles.kindDemo : styles.kind}>
                    {story.kind === "editorial" ? t("kindEditorial") : story.kind === "demo" ? t("kindDemo") : t("kindExample")}
                    {story.collection && collectionName.has(story.collection) ? ` · ${collectionName.get(story.collection)}` : ""}
                  </span>
                  <span className={styles.sourceIcons}>
                    {story.sources.slice(0, 6).map((source) => (
                      <span key={source} title={sourceLabel(source, locale)} aria-label={sourceLabel(source, locale)} role="img">
                        <SourceIcon name={source} size={15} />
                      </span>
                    ))}
                  </span>
                </div>
                <h2 id={`${key}-title`} className={styles.title}>
                  {story.content.title}
                </h2>
                <p className={styles.dek}>{story.content.dek}</p>
                {near ? (
                  <ul className={styles.inlineEvidence} aria-label={t("evidenceTitle")}>
                    {story.content.evidence.slice(0, 2).map((item, i) => (
                      <li key={i} className={styles.mention}>
                        <div className={styles.bubble}>
                          <p className={styles.inlineQuote}>{item.quote}</p>
                        </div>
                        <MentionMeta platform={item.platform} date={item.date} locale={locale} />
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.action}
                    onClick={(event) => {
                      evidenceTrigger.current = event.currentTarget;
                      setSheet(story);
                    }}
                  >
                    {t("evidence")}
                  </button>
                  {story.reportHref ? (
                    <a className={styles.actionGhost} href={story.reportHref}>
                      <OpenBook aria-hidden /> {t("report")}
                    </a>
                  ) : null}
                  <button type="button" className={styles.iconAction} aria-label={t("share")} onClick={() => share(story)}>
                    <ShareIos aria-hidden />
                  </button>
                </div>
              </div>
              ) : (
                <h2 id={`${key}-title`} className="visually-hidden">
                  {story.content.title}
                </h2>
              )}
            </article>
          );
        })}
      </div>

      {active === 0 && items.length > 1 ? (
        <p className={styles.hint} aria-hidden>
          {t("swipeHint")}
        </p>
      ) : null}
      {toast ? (
        <div className={styles.toast} role="status">
          {toast}
        </div>
      ) : null}
      {sheet ? <EvidenceSheet story={sheet} onClose={closeSheet} /> : null}
    </div>
  );
}


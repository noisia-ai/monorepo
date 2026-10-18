"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { OpenBook, Pause, Play, ShareIos } from "iconoir-react";
import { Link } from "@/i18n/navigation";
import { Stage } from "@/motion/runtime";
import { StoryComposition, posterFrame, storyDuration } from "@/motion/StoryComposition";
import { CANVAS } from "@/motion/theme";
import { EvidenceSheet } from "./EvidenceSheet";
import type { FeedStory } from "./types";
import styles from "./Feed.module.css";

type Props = { stories: FeedStory[]; initialId?: string };

const WINDOW = 2;

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

export function Feed({ stories, initialId }: Props) {
  const t = useTranslations("feed");
  const tIndustry = useTranslations("industries");
  const locale = useLocale();
  const reduced = usePrefersReducedMotion();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [cycles, setCycles] = useState(1);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [optIn, setOptIn] = useState(false);
  const [sheet, setSheet] = useState<FeedStory | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const base = useMemo(() => {
    const filtered = filter ? stories.filter((story) => story.industry === filter) : stories;
    return rotateTo(filtered, filter ? undefined : initialId);
  }, [stories, filter, initialId]);

  // Infinite feed: when the reader nears the end, the list repeats.
  const items = useMemo(
    () => Array.from({ length: cycles }, (_, c) => base.map((story) => ({ story, key: `${story.id}-${c}` }))).flat(),
    [base, cycles]
  );

  const industries = useMemo(() => Array.from(new Set(stories.map((story) => story.industry))), [stories]);

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.index));
        }
      },
      { root, threshold: 0.6 }
    );
    root.querySelectorAll("[data-index]").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [items]);

  useEffect(() => {
    if (base.length > 1 && active >= items.length - 2) setCycles((count) => count + 1);
  }, [active, items.length, base.length]);

  // Each story keeps its own shareable URL; the address bar follows the feed.
  useEffect(() => {
    const story = items[active]?.story;
    if (!story) return;
    const path = `${locale === "en" ? "/en" : ""}/insights/${story.id}`;
    if (window.location.pathname !== path) window.history.replaceState(window.history.state, "", path);
    setPaused(false);
    setOptIn(false);
  }, [active, items, locale]);

  const scrollToIndex = useCallback((index: number) => {
    const root = scrollerRef.current;
    const target = root?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (sheet) return;
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
        window.setTimeout(() => setToast(null), 1800);
      } catch {
        // The reader closed the share sheet; nothing to do.
      }
    },
    [locale, t]
  );

  const changeFilter = (value: string | null) => {
    setFilter(value);
    setCycles(1);
    setActive(0);
    scrollerRef.current?.scrollTo({ top: 0 });
  };

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.logo} aria-label="Noisia">
          noisia
        </Link>
        <nav className={styles.filters} aria-label={t("filter")}>
          <button type="button" className={styles.chip} aria-pressed={filter === null} onClick={() => changeFilter(null)}>
            {tIndustry("all")}
          </button>
          {industries.map((industry) => (
            <button key={industry} type="button" className={styles.chip} aria-pressed={filter === industry} onClick={() => changeFilter(industry)}>
              {tIndustry(industry)}
            </button>
          ))}
        </nav>
      </header>

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
              aria-posinset={index + 1}
              aria-setsize={-1}
              aria-labelledby={`${key}-title`}
            >
              <div className={styles.stageWrap}>
                {near ? (
                  <Stage
                    className={styles.stage}
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

              <div className={styles.caption}>
                <span className={styles.kind}>{story.kind === "editorial" ? t("kindEditorial") : t("kindExample")}</span>
                <h2 id={`${key}-title`} className={styles.title}>
                  {story.content.title}
                </h2>
                <p className={styles.dek}>{story.content.dek}</p>
                <div className={styles.actions}>
                  <button type="button" className={styles.action} onClick={() => setSheet(story)}>
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
            </article>
          );
        })}
      </div>

      {toast ? (
        <div className={styles.toast} role="status">
          {toast}
        </div>
      ) : null}
      {sheet ? <EvidenceSheet story={sheet} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}

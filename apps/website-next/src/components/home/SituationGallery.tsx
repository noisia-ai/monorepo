"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import NextLink from "next/link";
import { ArrowRight, Pause, Play } from "iconoir-react";
import styles from "./SituationGallery.module.css";

export type GalleryItem = {
  href: string;
  name: string;
  question: string;
  summary: string;
  deliverable: string;
  photo: { src: string; alt: string; credit: string };
};

const STEP_MS = 6000;

/**
 * Large photo cards in a horizontal gallery, with a pager that advances on its own while
 * the gallery is on screen (Apple Intelligence style). Touching or scrolling it hands
 * control to the reader; the play button gives it back.
 */
export function SituationGallery({ items, labels }: { items: GalleryItem[]; labels: { more: string; photos: string; play: string; pause: string } }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const root = scroller.current;
    if (!root) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold: 0.5 });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // The active card follows the scroll position.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const onScroll = () => {
      const cards = Array.from(root.children) as HTMLElement[];
      const left = root.scrollLeft + parseFloat(getComputedStyle(root).scrollPaddingLeft || "0");
      let best = 0;
      cards.forEach((card, i) => {
        if (Math.abs(card.offsetLeft - left) < Math.abs((cards[best]?.offsetLeft ?? 0) - left)) best = i;
      });
      setActive(best);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, []);

  const goTo = useCallback((index: number) => {
    const root = scroller.current;
    const card = root?.children[index] as HTMLElement | undefined;
    if (!root || !card) return;
    const pad = parseFloat(getComputedStyle(root).scrollPaddingLeft || "0");
    root.scrollTo({ left: card.offsetLeft - pad, behavior: "smooth" });
  }, []);

  const playing = auto && visible && !reduced;
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => goTo((active + 1) % items.length), STEP_MS);
    return () => window.clearTimeout(timer);
  }, [playing, active, items.length, goTo]);

  const takeOver = () => setAuto(false);

  return (
    <div className={styles.gallery}>
      <div ref={scroller} className={styles.scroller} onPointerDown={takeOver} onWheel={(e) => Math.abs(e.deltaX) > 4 && takeOver()}>
        {items.map((item, i) => (
          <NextLink key={item.href} href={item.href} prefetch={false} className={styles.card} aria-label={`${item.name}. ${item.question}`} data-active={i === active}>
            <picture>
              <source media="(min-width: 960px)" srcSet={`${item.photo.src}?w=1800&h=1000&fit=crop&auto=format&q=70`} />
              <img src={`${item.photo.src}?w=900&h=1125&fit=crop&auto=format&q=70`} alt={item.photo.alt} loading={i < 2 ? "eager" : "lazy"} className={styles.photo} />
            </picture>
            <span className={styles.shade} aria-hidden />
            <span className={styles.top}>
              <span className={styles.name}>{item.name}</span>
              <span className={styles.question}>{item.question}</span>
            </span>
            <span className={styles.bottom}>
              <span className={styles.summary}>{item.summary}</span>
              <span className={styles.foot}>
                <span className={styles.chip}>{item.deliverable}</span>
                <span className={styles.more}>
                  {labels.more} <ArrowRight aria-hidden />
                </span>
              </span>
            </span>
          </NextLink>
        ))}
      </div>

      <div className={styles.controls}>
        <div className={styles.pager}>
          {items.map((item, i) => (
            <button
              key={item.href}
              type="button"
              className={styles.dot}
              data-active={i === active}
              aria-label={item.name}
              aria-current={i === active}
              onClick={() => {
                takeOver();
                goTo(i);
              }}
            >
              {i === active ? <span key={`${active}-${playing}`} className={styles.dotFill} data-playing={playing} style={{ animationDuration: `${STEP_MS}ms` }} /> : null}
            </button>
          ))}
        </div>
        {!reduced ? (
          <button type="button" className={styles.play} aria-label={playing ? labels.pause : labels.play} onClick={() => setAuto((value) => !value)}>
            {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
          </button>
        ) : null}
      </div>
      <p className={styles.credit}>{labels.photos}</p>
    </div>
  );
}

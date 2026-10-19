"use client";

import { useRef, useState } from "react";
import { Stage } from "@/motion/runtime";
import { HERO, HeroComposition, type HeroCopy } from "@/motion/HeroComposition";
import { EnterComposition, LaunchComposition, SLIDE, TrackComposition, type EnterCopy, type LaunchCopy, type TrackCopy } from "@/motion/HeroSlides";
import { PageControl } from "@/components/ui/PageControl";
import { TrendComposition, type TrendCopy } from "@/motion/SignalCompositions";
import { TREND } from "@/motion/sizes";
import { usePlayback } from "@/components/motion/usePlayback";
import { Button } from "@/components/ui/Button";
import styles from "./RotatingHero.module.css";

export type HeroSlide = { key: "track" | "trend" | "launch" | "enter" | "defend"; tab: string; title: string; sub: string };
export type RotatingHeroCopy = {
  heading: string;
  slides: HeroSlide[];
  primary: string;
  secondary: string;
  motion: { track: TrackCopy; trend: TrendCopy; launch: LaunchCopy; enter: EnterCopy; defend: HeroCopy };
};

const FRAMES = { track: SLIDE.frames, trend: TREND.frames, launch: SLIDE.frames, enter: SLIDE.frames, defend: HERO.durationInFrames } as const;
// What a still frame shows when motion is reduced: the moment each story is complete.
const POSTER = { track: 236, trend: 300, launch: 236, enter: 236, defend: 330 } as const;

/**
 * The hero rotates through the situations a brand brings to us. Title, subtitle and
 * animation change together; tabs show progress and let the reader jump.
 */
export function RotatingHero({ copy, labels }: { copy: RotatingHeroCopy; labels: { play: string; pause: string } }) {
  const ref = useRef<HTMLElement>(null);
  const { playing, reduced, toggle } = usePlayback(ref);
  const [index, setIndex] = useState(0);
  const slide = copy.slides[index]!;
  const frames = FRAMES[slide.key];
  const go = (next: number) => setIndex((next + copy.slides.length) % copy.slides.length);

  const actions = (
    <>
      <Button href="/taller" arrow>
        {copy.primary}
      </Button>
      <Button href="/insights" variant="secondary">
        {copy.secondary}
      </Button>
    </>
  );

  return (
    <section ref={ref} className={styles.hero}>
      <h1 className="visually-hidden">{copy.heading}</h1>
      <div className={styles.inner}>
        <div className={styles.text}>
          {/* Every slide sits in the same cell, so the block keeps the height of the longest one. */}
          <div className={styles.stack} aria-live="polite">
            {copy.slides.map((item, i) => (
              <div key={item.key} className={styles.copy} data-active={i === index} aria-hidden={i !== index}>
                <p className={styles.title}>{item.title}</p>
                <p className={styles.sub}>{item.sub}</p>
              </div>
            ))}
          </div>
          <div className={`${styles.actions} ${styles.actionsDesktop}`}>{actions}</div>
        </div>

        <div className={styles.media}>
          <div className={styles.motion}>
            <Stage
              key={slide.key}
              durationInFrames={frames}
              width={1080}
              height={1080}
              playing={playing}
              loop={false}
              frame={reduced ? POSTER[slide.key] : 0}
              label={slide.title}
              className={styles.stage}
              onEnded={() => go(index + 1)}
            >
              {slide.key === "track" ? (
                <TrackComposition copy={copy.motion.track} />
              ) : slide.key === "trend" ? (
                <TrendComposition copy={copy.motion.trend} />
              ) : slide.key === "launch" ? (
                <LaunchComposition copy={copy.motion.launch} />
              ) : slide.key === "enter" ? (
                <EnterComposition copy={copy.motion.enter} />
              ) : (
                <HeroComposition copy={copy.motion.defend} />
              )}
            </Stage>
          </div>
          <PageControl
            count={copy.slides.length}
            active={index}
            labels={copy.slides.map((item) => item.tab)}
            onSelect={go}
            duration={reduced ? undefined : (frames / 30) * 1000}
            playing={playing}
            onToggle={reduced ? undefined : toggle}
            toggleLabels={labels}
          />
        </div>
        <div className={`${styles.actions} ${styles.actionsMobile}`}>{actions}</div>
      </div>
    </section>
  );
}

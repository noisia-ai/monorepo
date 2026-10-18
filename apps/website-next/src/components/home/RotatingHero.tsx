"use client";

import { useRef, useState } from "react";
import { Stage } from "@/motion/runtime";
import { HERO, HeroComposition, type HeroCopy } from "@/motion/HeroComposition";
import { EnterComposition, LaunchComposition, SLIDE, TrackComposition, type EnterCopy, type LaunchCopy, type TrackCopy } from "@/motion/HeroSlides";
import { PauseButton } from "@/components/motion/PauseButton";
import { usePlayback } from "@/components/motion/usePlayback";
import { Button } from "@/components/ui/Button";
import styles from "./RotatingHero.module.css";

export type HeroSlide = { key: "track" | "launch" | "enter" | "defend"; tab: string; title: string; sub: string };
export type RotatingHeroCopy = {
  heading: string;
  slides: HeroSlide[];
  primary: string;
  secondary: string;
  motion: { track: TrackCopy; launch: LaunchCopy; enter: EnterCopy; defend: HeroCopy };
};

const FRAMES = { track: SLIDE.frames, launch: SLIDE.frames, enter: SLIDE.frames, defend: HERO.durationInFrames } as const;
// What a still frame shows when motion is reduced: the moment each story is complete.
const POSTER = { track: 236, launch: 236, enter: 236, defend: 330 } as const;

/**
 * The hero rotates through the situations a brand brings to us. Title, subtitle and
 * animation change together; tabs show progress and let the reader jump.
 */
export function RotatingHero({ copy }: { copy: RotatingHeroCopy }) {
  const ref = useRef<HTMLElement>(null);
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const { playing, reduced, paused, toggle } = usePlayback(ref);
  const [index, setIndex] = useState(0);
  const slide = copy.slides[index]!;
  const frames = FRAMES[slide.key];

  const go = (next: number) => {
    bars.current.forEach((bar) => bar && (bar.style.transform = "scaleX(0)"));
    setIndex((next + copy.slides.length) % copy.slides.length);
  };

  return (
    <section ref={ref} className={styles.hero}>
      <h1 className="visually-hidden">{copy.heading}</h1>
      <div className={styles.inner}>
        <div className={styles.text}>
          <div className={styles.tabs} role="tablist" aria-label={copy.heading}>
            {copy.slides.map((item, i) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={i === index}
                className={styles.tab}
                onClick={() => go(i)}
              >
                {item.tab}
                <span className={styles.track} aria-hidden>
                  <span ref={(el) => void (bars.current[i] = el)} className={styles.fill} style={i < index ? { transform: "scaleX(1)" } : undefined} />
                </span>
              </button>
            ))}
          </div>

          <div key={slide.key} className={styles.copy} role="tabpanel" aria-live="polite">
            <p className={styles.title}>{slide.title}</p>
            <p className={styles.sub}>{slide.sub}</p>
          </div>

          <div className={styles.actions}>
            <Button href="/taller" arrow>
              {copy.primary}
            </Button>
            <Button href="/insights" variant="secondary">
              {copy.secondary}
            </Button>
          </div>
        </div>

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
            onFrame={(frame) => {
              const bar = bars.current[index];
              if (bar) bar.style.transform = `scaleX(${frame / frames})`;
            }}
            onEnded={() => go(index + 1)}
          >
            {slide.key === "track" ? (
              <TrackComposition copy={copy.motion.track} />
            ) : slide.key === "launch" ? (
              <LaunchComposition copy={copy.motion.launch} />
            ) : slide.key === "enter" ? (
              <EnterComposition copy={copy.motion.enter} />
            ) : (
              <HeroComposition copy={copy.motion.defend} />
            )}
          </Stage>
          {!reduced ? <PauseButton playing={!paused} onToggle={toggle} /> : null}
        </div>
      </div>
    </section>
  );
}

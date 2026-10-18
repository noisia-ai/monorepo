"use client";

import { useRef } from "react";
import { Stage } from "@/motion/runtime";
import { HERO, HeroComposition, type HeroCopy } from "@/motion/HeroComposition";
import { PauseButton } from "@/components/motion/PauseButton";
import { usePlayback } from "@/components/motion/usePlayback";

/** Plays the hero loop while it is on screen; shows the final state when motion is reduced. */
export function HeroMotion({ copy, label, className }: { copy: HeroCopy; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { playing, reduced, paused, toggle } = usePlayback(ref);
  return (
    <div ref={ref} className={className}>
      <Stage
        durationInFrames={HERO.durationInFrames}
        fps={HERO.fps}
        width={HERO.width}
        height={HERO.height}
        playing={playing}
        frame={reduced ? 330 : 0}
        label={label}
        className="hero-stage"
      >
        <HeroComposition copy={copy} />
      </Stage>
      {!reduced ? <PauseButton playing={!paused} onToggle={toggle} /> : null}
      <style>{`.hero-stage{position:absolute;inset:0}`}</style>
    </div>
  );
}

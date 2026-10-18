"use client";

import { useEffect, useRef, useState } from "react";
import { Stage } from "@/motion/runtime";
import { HERO, HeroComposition, type HeroCopy } from "@/motion/HeroComposition";

/** Plays the hero loop while it is on screen; shows the final state when motion is reduced. */
export function HeroMotion({ copy, label, className }: { copy: HeroCopy; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold: 0.2 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className={className}>
      <Stage
        durationInFrames={HERO.durationInFrames}
        fps={HERO.fps}
        width={HERO.width}
        height={HERO.height}
        playing={visible && !reduced}
        frame={reduced ? 330 : 0}
        label={label}
        className="hero-stage"
      >
        <HeroComposition copy={copy} />
      </Stage>
      <style>{`.hero-stage{position:absolute;inset:0}`}</style>
    </div>
  );
}

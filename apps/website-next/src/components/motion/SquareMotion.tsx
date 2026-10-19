"use client";

import { useRef, type ReactNode } from "react";
import { Stage } from "@/motion/runtime";
import { PauseButton } from "./PauseButton";
import { usePlayback } from "./usePlayback";

/** A square composition that loops while on screen, with a pause button and a still poster for reduced motion. */
export function SquareMotion({ frames, poster, label, className, children }: { frames: number; poster: number; label: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { playing, reduced, paused, toggle } = usePlayback(ref);
  return (
    <div ref={ref} className={className} style={{ position: "relative", width: "100%", aspectRatio: "1 / 1" }}>
      <Stage durationInFrames={frames} width={1080} height={1080} playing={playing} frame={reduced ? poster : 0} label={label} className="square-motion-stage">
        {children}
      </Stage>
      {!reduced ? <PauseButton playing={!paused} onToggle={toggle} /> : null}
      <style>{`.square-motion-stage{position:absolute;inset:0}`}</style>
    </div>
  );
}

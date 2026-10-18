"use client";

import { useEffect, useRef, useState } from "react";
import { Stage } from "@/motion/runtime";
import { LAYOUTS, PROCESS_FRAMES, ProcessComposition, type ProcessCopy } from "@/motion/ProcessComposition";
import { PauseButton } from "./PauseButton";
import { usePlayback } from "./usePlayback";

/** The pipeline animation: wide on desktop, tall on phones; plays while on screen. */
export function ProcessMotion({ copy, label }: { copy: ProcessCopy; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [variant, setVariant] = useState<"wide" | "tall">("tall");
  const { playing, reduced, paused, toggle } = usePlayback(ref);

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 900px)");
    const update = () => setVariant(wide.matches ? "wide" : "tall");
    update();
    wide.addEventListener("change", update);
    return () => wide.removeEventListener("change", update);
  }, []);

  const layout = LAYOUTS[variant];
  return (
    <div ref={ref} style={{ position: "relative", width: "100%", aspectRatio: `${layout.width} / ${layout.height}` }}>
      <Stage
        key={variant}
        durationInFrames={PROCESS_FRAMES}
        width={layout.width}
        height={layout.height}
        playing={playing}
        frame={reduced ? 380 : 0}
        label={label}
        className="process-stage"
      >
        <ProcessComposition copy={copy} variant={variant} />
      </Stage>
      {!reduced ? <PauseButton playing={!paused} onToggle={toggle} /> : null}
      <style>{`.process-stage{position:absolute;inset:0}`}</style>
    </div>
  );
}

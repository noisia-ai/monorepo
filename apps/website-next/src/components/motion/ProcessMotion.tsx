"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
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
  // The box takes its shape from CSS (same 900px breakpoint) so the server HTML already has the
  // desktop proportions; sizing it from state made the page jump once the script ran.
  const box = { position: "relative", width: "100%", "--process-tall": `${LAYOUTS.tall.width} / ${LAYOUTS.tall.height}`, "--process-wide": `${LAYOUTS.wide.width} / ${LAYOUTS.wide.height}` } as CSSProperties;
  return (
    <div ref={ref} className="process-box" style={box}>
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
      <style>{`.process-stage{position:absolute;inset:0}.process-box{aspect-ratio:var(--process-tall)}@media (min-width:900px){.process-box{aspect-ratio:var(--process-wide)}}`}</style>
    </div>
  );
}

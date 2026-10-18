"use client";

import { useEffect, useRef, useState } from "react";
import { Stage } from "@/motion/runtime";
import { LAYOUTS, PROCESS_FRAMES, ProcessComposition, type ProcessCopy } from "@/motion/ProcessComposition";

/** The pipeline animation: wide on desktop, tall on phones; plays while on screen. */
export function ProcessMotion({ copy, label }: { copy: ProcessCopy; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [variant, setVariant] = useState<"wide" | "tall">("tall");
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 900px)");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setVariant(wide.matches ? "wide" : "tall");
      setReduced(motion.matches);
    };
    update();
    wide.addEventListener("change", update);
    const node = ref.current;
    const onScroll = () => {
      if (!node) return;
      const box = node.getBoundingClientRect();
      setVisible(box.top < window.innerHeight * 0.85 && box.bottom > window.innerHeight * 0.15);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      wide.removeEventListener("change", update);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const layout = LAYOUTS[variant];
  return (
    <div ref={ref} style={{ position: "relative", width: "100%", aspectRatio: `${layout.width} / ${layout.height}` }}>
      <Stage
        key={variant}
        durationInFrames={PROCESS_FRAMES}
        width={layout.width}
        height={layout.height}
        playing={visible && !reduced}
        frame={reduced ? 380 : 0}
        label={label}
        className="process-stage"
      >
        <ProcessComposition copy={copy} variant={variant} />
      </Stage>
      <style>{`.process-stage{position:absolute;inset:0}`}</style>
    </div>
  );
}

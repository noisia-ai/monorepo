"use client";

import { useEffect, useState } from "react";
import type { StoryLocale } from "@/content/stories/schema";
import { Stage } from "@/motion/runtime";
import { StoryComposition, storyDuration } from "@/motion/StoryComposition";
import { CANVAS } from "@/motion/theme";

type Props = { story: StoryLocale; locale: string; tag: string; frame: number; mode: "feed" | "video"; scale: number };

declare global {
  interface Window {
    __noisiaSetFrame?: (frame: number) => Promise<void>;
  }
}

export function RenderFrame({ story, locale, tag, frame: initialFrame, mode, scale }: Props) {
  const duration = storyDuration(story);
  const [frame, setFrame] = useState(initialFrame);
  // The exporter drives frames from outside and waits two paints before capturing.
  useEffect(() => {
    window.__noisiaSetFrame = (next) =>
      new Promise((resolve) => {
        setFrame(next);
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    return () => {
      delete window.__noisiaSetFrame;
    };
  }, []);
  if (frame < 0) {
    // ?frame=-1 renders a contact sheet: one tile every second, for quick QA.
    const tiles = Array.from({ length: Math.ceil(duration / CANVAS.fps) }, (_, i) => i * CANVAS.fps);
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 180px)", gap: 12, padding: 12, background: "#eee" }} data-duration={duration}>
        {tiles.map((at) => (
          <div key={at} style={{ position: "relative", width: 180, height: 320, background: "#fff" }}>
            <Stage durationInFrames={duration} frame={at} width={CANVAS.width} height={CANVAS.height} className="tile">
              <StoryComposition story={story} locale={locale} tag={tag} mode={mode} />
            </Stage>
            <span style={{ position: "absolute", bottom: 4, left: 6, fontSize: 11, color: "#666" }}>{at}</span>
          </div>
        ))}
        <style>{`.tile{position:absolute;inset:0}`}</style>
      </div>
    );
  }
  return (
    <div
      id="render-root"
      data-duration={duration}
      style={{ position: "relative", width: CANVAS.width * scale, height: CANVAS.height * scale, overflow: "hidden" }}
    >
      <Stage durationInFrames={duration} frame={frame} className="frame">
        <StoryComposition story={story} locale={locale} tag={tag} mode={mode} />
      </Stage>
      <style>{`.frame{position:absolute;inset:0}`}</style>
    </div>
  );
}

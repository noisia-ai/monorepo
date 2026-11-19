"use client";

import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "./runtime";
import { CANVAS, PHOTO_SCENE_VARS, color } from "./theme";
import { clamp } from "./util";

/**
 * Photo stories (experiment): several photos fill the screen, one per scene, and the usual
 * animated scenes play over them in a light-on-dark palette. Changing the photo with each scene
 * keeps the eye moving; the scenes keep all their motion, charts and icons.
 */

/** How many frames a new photo takes to cross-fade over the previous one. */
const CROSSFADE = 12;

/** One photo, edge to edge, fading in over the previous one with a slow push-in. */
function Photo({ src, length, index }: { src: string; length: number; index: number }) {
  const frame = useCurrentFrame();
  const opacity = index === 0 ? 1 : interpolate(frame, [0, CROSSFADE], [0, 1], clamp);
  const scale = interpolate(frame, [0, length], [1.03, 1.12], clamp);
  // Alternate the push-in's anchor so consecutive photos do not move the same way.
  const origin = index % 2 === 0 ? "50% 35%" : "40% 55%";
  return (
    <AbsoluteFill style={{ opacity, overflow: "hidden" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size image inside the canvas */}
      <img
        src={src}
        alt=""
        style={{ position: "absolute", inset: 0, width: CANVAS.width, height: CANVAS.height, objectFit: "cover", transform: `scale(${scale})`, transformOrigin: origin }}
      />
    </AbsoluteFill>
  );
}

/** The photos behind the scenes: scene `i` shows photo `i` (cycling when there are fewer). */
export function PhotoBackdrop({ images, lengths, total }: { images: string[]; lengths: number[]; total: number }) {
  let from = 0;
  return (
    <AbsoluteFill style={{ background: color.dark }}>
      {lengths.map((length, i) => {
        const start = from;
        from += length;
        // Each photo stays until the end so the next one fades over it, never over black.
        return (
          <Sequence key={i} from={i === 0 ? 0 : start - CROSSFADE / 2} durationInFrames={total}>
            <Photo src={images[i % images.length]!} length={length + CROSSFADE} index={i} />
          </Sequence>
        );
      })}
      {/* Darkens the photo enough for white type and charts: more at the foot and the top. */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(6,18,24,0.62) 0%, rgba(6,18,24,0.34) 18%, rgba(6,18,24,0.42) 50%, rgba(6,18,24,0.8) 78%, rgba(6,18,24,0.92) 100%)"
        }}
      />
    </AbsoluteFill>
  );
}

/** Wraps the scenes so their colors switch to the light-on-dark palette and the type gets a soft shadow. */
export function PhotoPalette({ children }: { children: ReactNode }) {
  return <AbsoluteFill style={{ ...(PHOTO_SCENE_VARS as CSSProperties), textShadow: "0 2px 22px rgba(0,0,0,0.35)" }}>{children}</AbsoluteFill>;
}

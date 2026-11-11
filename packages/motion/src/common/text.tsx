import type { CSSProperties, ReactNode } from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "../engine";
import { MOTION, SAFE, color, font } from "../brand/theme";
import { clamp, rise } from "../brand/util";

export const text = (size: number, weight = 500, extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: font,
  fontSize: size,
  fontWeight: weight,
  lineHeight: 1.12,
  letterSpacing: 0,
  color: color.ink,
  margin: 0,
  ...extra
});

/** Fades a scene in (12 frames, from 36 px below) and out (last 10, upwards) inside the safe area. */
export function Shell({ bottomSafe, align = "center", children }: { bottomSafe: number; align?: "center" | "start"; children: ReactNode }) {
  const frame = useCurrentFrame();
  const { durationInFrames: d } = useVideoConfig();
  const opacity = interpolate(frame, [0, 8, d - 8, d], [0, 1, 1, 0], clamp);
  const shift = interpolate(frame, [0, MOTION.sceneIn, d - MOTION.sceneOut, d], [36, 0, 0, -36], { ...clamp, easing: (t) => 1 - Math.pow(1 - t, 3) });
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: `${SAFE.top + 40}px ${SAFE.side}px ${bottomSafe}px`,
        display: "flex",
        flexDirection: "column",
        justifyContent: align === "center" ? "center" : "flex-start",
        gap: 44,
        opacity,
        transform: `translateY(${shift}px)`
      }}
    >
      {children}
    </div>
  );
}

/** Words that rise one by one, 3 frames apart (2 in a takeaway). */
export function Words({ value, size, delay = 0, stagger = MOTION.wordStagger, tone = color.ink, weight = 500 }: { value: string; size: number; delay?: number; stagger?: number; tone?: string; weight?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <p style={text(size, weight, { display: "flex", flexWrap: "wrap", columnGap: size * 0.26, rowGap: size * 0.04, color: tone })}>
      {value.split(" ").map((word, i) => (
        <span key={`${word}-${i}`} style={{ display: "inline-block", ...rise(frame, fps, delay + i * stagger, size * 0.4) }}>
          {word}
        </span>
      ))}
    </p>
  );
}

/** Removes the outer quotes when the quote already carries its own, so the card never shows ””. */
export function bare(quote: string): string {
  return quote.trim().replace(/^["“”«]+|["“”»]+$/g, "");
}

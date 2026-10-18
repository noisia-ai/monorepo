"use client";

import { User } from "iconoir-react";
import { SourceIcon } from "@/components/brand/SourceMark";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "./runtime";
import { color, font } from "./theme";
import { clamp, enter } from "./util";

/**
 * One mention, read the way the methods read it: the reasons behind it sit in layers
 * around the person (psychological, personal, social, cultural), as what drives them
 * or what holds them back. Square 1080 canvas.
 */

export const UNDERSTAND = { width: 1080, height: 1080, fps: 30, frames: 330 } as const;

export type UnderstandCopy = {
  quote: string;
  layers: [string, string, string, string];
  chips: { text: string; layer: number; kind: "trigger" | "barrier" }[];
  trigger: string;
  barrier: string;
  caption: string;
};

const C = { x: 540, y: 690 };
const BANDS = [
  { r0: 92, r1: 162 },
  { r0: 162, r1: 232 },
  { r0: 232, r1: 302 },
  { r0: 302, r1: 372 }
];
const ANGLES = [-28, 205, 22, 158];

export function UnderstandComposition({ copy }: { copy: UnderstandCopy }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = interpolate(frame, [UNDERSTAND.frames - 22, UNDERSTAND.frames - 2], [1, 0], clamp);
  const bubble = enter(frame, fps, 4, 18);
  const person = enter(frame, fps, 40, 16);
  const legend = enter(frame, fps, 236, 18);
  const caption = enter(frame, fps, 258, 18);

  return (
    <AbsoluteFill style={{ opacity: fade, fontFamily: font }}>
      {/* the mention */}
      <div style={{ position: "absolute", left: 80, right: 80, top: 50, opacity: bubble, transform: `translateY(${(1 - bubble) * 18}px)` }}>
        <div style={{ position: "relative", marginLeft: 20 }}>
          <svg width={44} height={40} viewBox="0 0 18 16" style={{ position: "absolute", left: -21, bottom: 0 }} aria-hidden>
            <path d="M18 0 C18 9 13 15 0 16 C8 12 9 6 9 0 Z" fill={color.bubble} />
          </svg>
          <div style={{ background: color.bubble, borderRadius: "44px 44px 44px 14px", padding: "30px 38px", fontSize: 44, lineHeight: 1.22, color: color.ink }}>{copy.quote}</div>
        </div>
        <div style={{ marginTop: 12, marginLeft: 24 }}>
          <SourceIcon name="TikTok" size={34} />
        </div>
      </div>

      {/* the layers around the person */}
      <svg width={1080} height={1080} style={{ position: "absolute", inset: 0 }} aria-hidden>
        {BANDS.map((band, i) => {
          const p = enter(frame, fps, 54 + i * 10, 18);
          const r = (band.r0 + band.r1) / 2;
          return <circle key={i} cx={C.x} cy={C.y} r={r * (0.7 + 0.3 * p)} fill="none" stroke={i % 2 ? "#f3f3f3" : "#f8f8f8"} strokeWidth={band.r1 - band.r0} opacity={p} />;
        })}
        {BANDS.map((band, i) => (
          <circle key={`l${i}`} cx={C.x} cy={C.y} r={band.r1} fill="none" stroke={color.line} strokeWidth={2} opacity={enter(frame, fps, 54 + i * 10, 18)} />
        ))}
      </svg>
      {copy.layers.map((layer, i) => {
        const band = BANDS[i]!;
        const p = enter(frame, fps, 70 + i * 10, 18);
        return (
          <span key={layer} style={{ position: "absolute", left: C.x, top: C.y - (band.r0 + band.r1) / 2 - 16, transform: "translateX(-50%)", fontSize: 26, color: color.muted, opacity: p, whiteSpace: "nowrap" }}>
            {layer}
          </span>
        );
      })}
      <span style={{ position: "absolute", left: C.x - 70, top: C.y - 70, width: 140, height: 140, borderRadius: 70, background: color.ink, color: "#fff", display: "grid", placeItems: "center", opacity: person, transform: `scale(${0.7 + person * 0.3})` }}>
        <User width={64} height={64} strokeWidth={1.6} />
      </span>

      {/* each reason lifts out of the quote and lands in its layer */}
      {copy.chips.map((chip, i) => {
        const band = BANDS[chip.layer] ?? BANDS[0]!;
        const r = (band.r0 + band.r1) / 2;
        const a = ((ANGLES[i] ?? 0) * Math.PI) / 180;
        const tx = C.x + Math.cos(a) * r;
        const ty = C.y + Math.sin(a) * r;
        const t = interpolate(frame, [120 + i * 22, 160 + i * 22], [0, 1], { ...clamp, easing: (v) => 1 - Math.pow(1 - v, 3) });
        const x = 540 + (tx - 540) * t;
        const y = 200 + (ty - 200) * t;
        const trigger = chip.kind === "trigger";
        return (
          <span
            key={chip.text}
            style={{
              position: "absolute",
              left: x,
              top: y,
              transform: `translate(-50%, -50%) scale(${0.6 + 0.4 * t})`,
              opacity: t > 0 ? 1 : 0,
              fontSize: 32,
              fontWeight: 500,
              padding: "8px 20px",
              borderRadius: 999,
              whiteSpace: "nowrap",
              background: trigger ? color.teal : color.coral,
              color: "#fff",
              boxShadow: "0 8px 20px rgba(10,10,10,0.12)"
            }}
          >
            {trigger ? "↑ " : "↓ "}
            {chip.text}
          </span>
        );
      })}

      <div style={{ position: "absolute", left: 60, top: 990, display: "flex", gap: 28, fontSize: 28, color: color.fg, opacity: legend }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 18, height: 18, borderRadius: 9, background: color.teal }} />
          {copy.trigger}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 18, height: 18, borderRadius: 9, background: color.coral }} />
          {copy.barrier}
        </span>
      </div>
      <span style={{ position: "absolute", right: 60, top: 300, maxWidth: 330, textAlign: "right", fontSize: 30, lineHeight: 1.25, fontWeight: 500, color: color.ink, opacity: caption }}>{copy.caption}</span>
    </AbsoluteFill>
  );
}

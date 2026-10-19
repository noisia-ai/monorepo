"use client";

import { Check } from "iconoir-react";
import { SourceIcon } from "@/components/brand/SourceMark";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "./runtime";
import { color, font } from "./theme";
import { clamp, enter } from "./util";

/**
 * Moving the number versus moving the reason (square 1080 canvas). A discount lifts a weekly
 * line that falls back while the reason behind it stays; once the reason is addressed the line
 * rises and holds. Values and the quote are illustrative.
 */

export const METHOD_NUMBER = { frames: 420 } as const;

export type MethodNumberCopy = {
  metric: string;
  weeks: string;
  push: string;
  before: string;
  quote: string;
  platform: string;
  stuck: string;
  fixed: string;
  fix: string;
  caption: string;
};

const W = [30, 31, 29, 30, 31, 44, 40, 34, 30, 33, 38, 43, 46];
const X0 = 120;
const X1 = 960;
const xOf = (t: number) => X0 + (t / 12) * (X1 - X0);
const yOf = (v: number) => 560 - ((v - 20) / 30) * 300;
const valueAt = (t: number) => {
  const i = Math.min(11, Math.floor(t));
  const f = t - i;
  const k = (1 - Math.cos(f * Math.PI)) / 2;
  return W[i]! + (W[i + 1]! - W[i]!) * k;
};
function segment(a: number, b: number) {
  const pts: string[] = [];
  for (let s = a; s < b; s += 0.1) pts.push(`${xOf(s).toFixed(1)} ${yOf(valueAt(s)).toFixed(1)}`);
  pts.push(`${xOf(b).toFixed(1)} ${yOf(valueAt(b)).toFixed(1)}`);
  return "M " + pts.join(" L ");
}
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const card = { background: "#fff", borderRadius: 32, boxShadow: "0 18px 50px rgba(10,10,10,0.08)" } as const;

function pill(bg: string, fg: string, p: number) {
  return {
    position: "absolute" as const,
    padding: "8px 20px",
    borderRadius: 999,
    background: bg,
    color: fg,
    fontSize: 26,
    fontWeight: 500,
    whiteSpace: "nowrap" as const,
    opacity: p,
    transform: `translateY(${(1 - p) * 12}px)`
  };
}

export function MethodNumberComposition({ copy }: { copy: MethodNumberCopy }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = interpolate(frame, [METHOD_NUMBER.frames - 22, METHOD_NUMBER.frames - 2], [1, 0], clamp);
  const head = enter(frame, fps, 4, 18);
  const t =
    frame < 84
      ? interpolate(frame, [18, 70], [0, 4], { ...clamp, easing: ease })
      : frame < 236
        ? interpolate(frame, [84, 176], [4, 8], { ...clamp, easing: (v) => v })
        : interpolate(frame, [236, 320], [8, 12], { ...clamp, easing: ease });
  const push = enter(frame, fps, 80, 16);
  const before = enter(frame, fps, 168, 18);
  const fixMark = enter(frame, fps, 228, 16);
  const quote = enter(frame, fps, 140, 18);
  const stuck = enter(frame, fps, 176, 16) * (1 - interpolate(frame, [222, 236], [0, 1], clamp));
  const fixed = enter(frame, fps, 236, 16);
  const caption = enter(frame, fps, 326, 18);

  const line = segment(0, t);
  const area = t > 0.05 ? `${line} L ${xOf(t).toFixed(1)} 560 L ${X0} 560 Z` : "";
  const spike = t > 4 ? segment(4, Math.min(t, 8)) : "";
  const hx = xOf(t);
  const hy = yOf(valueAt(t));
  const warm = t > 4.05 && t < 7.95;

  return (
    <AbsoluteFill style={{ opacity: fade, fontFamily: font, textAlign: "left" }}>
      <div style={{ ...card, position: "absolute", left: 60, right: 60, top: 56, height: 560, opacity: head, transform: `translateY(${(1 - head) * 18}px)` }} />
      <div style={{ position: "absolute", left: 100, right: 100, top: 92, display: "flex", justifyContent: "space-between", alignItems: "baseline", opacity: head }}>
        <span style={{ fontSize: 34, fontWeight: 500, color: color.ink }}>{copy.metric}</span>
        <span style={{ fontSize: 26, color: color.muted }}>{copy.weeks}</span>
      </div>

      <svg width={1080} height={1080} style={{ position: "absolute", inset: 0, opacity: head }} aria-hidden>
        <defs>
          <linearGradient id="method-number-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color.teal} stopOpacity={0.18} />
            <stop offset="100%" stopColor={color.teal} stopOpacity={0} />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((i) => (
          <line key={i} x1={X0} x2={X1} y1={260 + i * 100} y2={260 + i * 100} stroke={color.track} strokeWidth={2} />
        ))}
        <line x1={X0} x2={X1} y1={560} y2={560} stroke={color.line} strokeWidth={2} />
        {/* where the number was */}
        <line x1={X0} x2={X1} y1={yOf(30)} y2={yOf(30)} stroke={color.faint} strokeWidth={2.5} strokeDasharray="8 10" opacity={before} />
        {/* markers */}
        <line x1={xOf(4)} x2={xOf(4)} y1={232} y2={560} stroke={color.coral} strokeWidth={2.5} strokeDasharray="4 8" opacity={push * 0.8} />
        <line x1={xOf(8)} x2={xOf(8)} y1={232} y2={560} stroke={color.teal} strokeWidth={2.5} strokeDasharray="4 8" opacity={fixMark * 0.8} />
        {area ? <path d={area} fill="url(#method-number-area)" /> : null}
        <path d={line} fill="none" stroke={color.teal} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
        {spike ? <path d={spike} fill="none" stroke={color.coral} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" /> : null}
        <circle cx={hx} cy={hy} r={13} fill="#fff" stroke={warm ? color.coral : color.teal} strokeWidth={6} />
      </svg>

      <span style={{ ...pill(color.coralSoft, color.coral, push), left: xOf(4) - 96, top: 166 }}>{copy.push}</span>
      <span style={{ ...pill(color.tealSoft, color.teal, fixMark), left: xOf(8) - 26, top: 166 }}>{copy.fix}</span>
      <span style={{ position: "absolute", right: 120, top: yOf(30) + 14, fontSize: 24, color: color.muted, opacity: before }}>{copy.before}</span>

      {/* the reason under the number */}
      <div style={{ position: "absolute", left: 60, top: 664, width: 620, opacity: quote, transform: `translateY(${(1 - quote) * 20}px)` }}>
        <div style={{ background: color.bubble, borderRadius: "30px 30px 30px 10px", padding: "18px 26px", fontSize: 32, lineHeight: 1.25, color: color.ink }}>{copy.quote}</div>
        <div style={{ marginTop: 8, marginLeft: 8 }}>
          <SourceIcon name={copy.platform} size={26} />
        </div>
      </div>
      <span style={{ ...pill(color.coralSoft, color.coral, stuck), left: 60, top: 852, fontSize: 30, padding: "10px 24px" }}>↓ {copy.stuck}</span>
      <span style={{ ...pill(color.teal, "#fff", fixed), left: 60, top: 852, fontSize: 30, padding: "10px 24px", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 8px 20px rgba(0,138,138,0.25)" }}>
        <Check width={30} height={30} strokeWidth={2.4} />
        {copy.fixed}
      </span>

      <p style={{ position: "absolute", left: 60, right: 60, top: 950, margin: 0, fontSize: 34, lineHeight: 1.2, fontWeight: 500, color: color.ink, opacity: caption, transform: `translateY(${(1 - caption) * 14}px)` }}>{copy.caption}</p>
    </AbsoluteFill>
  );
}

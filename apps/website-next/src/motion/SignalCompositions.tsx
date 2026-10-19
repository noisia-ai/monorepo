"use client";

import { SourceIcon } from "@/components/brand/SourceMark";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "./runtime";
import { color, font } from "./theme";
import { clamp, enter } from "./util";

/**
 * Always-on stories, square 1080 canvas: anticipating trends (signals on a volume × growth map
 * that turn into a lifecycle curve) and the customer journey read month after month.
 * Stage names are Noisia's own (Cultural Foresight). Examples are illustrative.
 */

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const card = { background: "#fff", borderRadius: 30, boxShadow: "0 18px 50px rgba(10,10,10,0.08)", fontFamily: font } as const;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ---------------------------------------------------------------- trends */

export type TrendCopy = {
  volume: string;
  growth: string;
  signals: [string, string, string, string, string];
  stages: [string, string, string, string];
  time: string;
  now: string;
  payoff: string;
};

// Signals on the map: x = volume, y = growth (0..1). Index 0 is the small, fast one.
const SIGNALS = [
  { x: 0.18, y: 0.82, size: 0.45 },
  { x: 0.46, y: 0.6, size: 0.65 },
  { x: 0.82, y: 0.4, size: 1 },
  { x: 0.7, y: 0.14, size: 0.85 },
  { x: 0.3, y: 0.24, size: 0.4 }
];
const MAP = { x: 150, y: 150, w: 820, h: 620 };
const CURVE = { x0: 120, x1: 960, low: 820, high: 300 };
const curveY = (t: number) => CURVE.low - (CURVE.low - CURVE.high) / (1 + Math.exp(-(t - 0.48) * 9));
const curveX = (t: number) => CURVE.x0 + (CURVE.x1 - CURVE.x0) * t;

const TREND_DOTS = (() => {
  const r = rng(53);
  return Array.from({ length: 120 }, (_, i) => {
    const k = i % 5;
    const a = r() * Math.PI * 2;
    const rad = Math.sqrt(r()) * (24 + SIGNALS[k]!.size * 46);
    return { sx: 80 + r() * 920, sy: 140 + r() * 640, k, a, rad, delay: Math.floor(r() * 30) };
  });
})();

/** phase "map" plays only the signals on the map; "curve" starts at the lifecycle. */
export function TrendComposition({ copy, phase = "all" }: { copy: TrendCopy; phase?: "all" | "map" | "curve" }) {
  const raw = useCurrentFrame();
  const frame = raw + (phase === "curve" ? 150 : 0);
  const { fps, durationInFrames } = useVideoConfig();
  const fade = interpolate(raw, [durationInFrames - 22, durationInFrames - 2], [1, 0], clamp);
  const gather = interpolate(frame, [40, 100], [0, 1], { ...clamp, easing: ease });
  const axes = enter(frame, fps, 60, 18);
  const labels = enter(frame, fps, 96, 18);
  const focus = enter(frame, fps, 124, 16);
  const morph = interpolate(frame, [158, 200], [0, 1], { ...clamp, easing: ease });
  const draw = interpolate(frame, [176, 226], [0, 1], clamp);
  const travel = interpolate(frame, [226, 280], [0.06, 0.4], { ...clamp, easing: ease });
  const payoff = phase === "map" ? 0 : enter(frame, fps, 282, 18);

  const curvePath = Array.from({ length: 61 }, (_, i) => {
    const t = i / 60;
    return `${i ? "L" : "M"} ${curveX(t).toFixed(1)} ${curveY(t).toFixed(1)}`;
  }).join(" ");
  const bands = [0, 0.25, 0.5, 0.75, 1];

  return (
    <AbsoluteFill style={{ opacity: fade, fontFamily: font }}>
      <svg width={1080} height={1080} style={{ position: "absolute", inset: 0 }} aria-hidden>
        {/* the map */}
        <g opacity={axes * (1 - morph)}>
          <line x1={MAP.x} y1={MAP.y + MAP.h} x2={MAP.x + MAP.w} y2={MAP.y + MAP.h} stroke={color.line} strokeWidth={4} />
          <line x1={MAP.x} y1={MAP.y} x2={MAP.x} y2={MAP.y + MAP.h} stroke={color.line} strokeWidth={4} />
          <line x1={MAP.x + MAP.w / 2} y1={MAP.y} x2={MAP.x + MAP.w / 2} y2={MAP.y + MAP.h} stroke={color.track} strokeWidth={3} strokeDasharray="10 10" />
          <line x1={MAP.x} y1={MAP.y + MAP.h / 2} x2={MAP.x + MAP.w} y2={MAP.y + MAP.h / 2} stroke={color.track} strokeWidth={3} strokeDasharray="10 10" />
          <text x={MAP.x + MAP.w} y={MAP.y + MAP.h + 46} textAnchor="end" fontSize={30} fill={color.muted}>
            {copy.volume} →
          </text>
          <text x={MAP.x - 20} y={MAP.y + 10} textAnchor="end" fontSize={30} fill={color.muted} transform={`rotate(-90 ${MAP.x - 20} ${MAP.y + 10})`}>
            {copy.growth} →
          </text>
          <circle cx={MAP.x + SIGNALS[0]!.x * MAP.w} cy={MAP.y + (1 - SIGNALS[0]!.y) * MAP.h} r={96} fill="none" stroke={color.teal} strokeWidth={4} opacity={focus} />
        </g>
        {/* the dots: scattered, then grouped into signals, then fading as the curve appears */}
        {TREND_DOTS.map((d, i) => {
          const s = SIGNALS[d.k]!;
          const cx = MAP.x + s.x * MAP.w + Math.cos(d.a) * d.rad;
          const cy = MAP.y + (1 - s.y) * MAP.h + Math.sin(d.a) * d.rad;
          const appear = interpolate(frame, [4 + d.delay, 24 + d.delay], [0, 1], clamp);
          const x = d.sx + (cx - d.sx) * gather;
          const y = d.sy + (cy - d.sy) * gather;
          const hot = d.k === 0 && focus > 0.1;
          return <circle key={i} cx={x} cy={y} r={hot ? 9 : 7} fill={hot ? color.teal : gather > 0.6 ? "#9cc9c9" : color.muted} opacity={appear * (1 - morph) * (hot || focus === 0 ? 1 : 1 - focus * 0.4)} />;
        })}
        {/* the lifecycle */}
        <g opacity={morph}>
          {bands.slice(0, 4).map((b, k) => (
            <rect key={k} x={curveX(b)} y={240} width={curveX(bands[k + 1]!) - curveX(b)} height={600} fill={k === 1 ? color.tealSoft : k % 2 ? "#fafafa" : "#ffffff"} />
          ))}
          {bands.slice(1, 4).map((b) => (
            <line key={b} x1={curveX(b)} y1={240} x2={curveX(b)} y2={840} stroke={color.line} strokeWidth={2} strokeDasharray="8 8" />
          ))}
          <path d={curvePath} fill="none" stroke={color.ink} strokeWidth={6} strokeLinecap="round" strokeDasharray={1400} strokeDashoffset={1400 * (1 - draw)} />
          <line x1={CURVE.x0} y1={860} x2={CURVE.x1} y2={860} stroke={color.line} strokeWidth={3} />
          <text x={CURVE.x1} y={900} textAnchor="end" fontSize={28} fill={color.muted}>
            {copy.time} →
          </text>
        </g>
        {morph > 0 ? (
          <g opacity={interpolate(frame, [226, 236], [0, 1], clamp)}>
            <circle cx={curveX(travel)} cy={curveY(travel)} r={30} fill={color.teal} opacity={0.18} />
            <circle cx={curveX(travel)} cy={curveY(travel)} r={14} fill={color.teal} />
          </g>
        ) : null}
      </svg>

      {/* signal names on the map */}
      {SIGNALS.map((s, k) => (
        <span
          key={k}
          style={{
            position: "absolute",
            left: MAP.x + s.x * MAP.w,
            top: MAP.y + (1 - s.y) * MAP.h - 30 - (24 + s.size * 46),
            transform: "translate(-50%, -100%)",
            fontSize: 30,
            fontWeight: k === 0 ? 500 : 400,
            color: k === 0 && focus > 0.1 ? color.teal : color.fg,
            background: "rgba(255,255,255,0.9)",
            padding: "4px 12px",
            borderRadius: 999,
            whiteSpace: "nowrap",
            opacity: labels * (1 - morph)
          }}
        >
          {copy.signals[k]}
        </span>
      ))}

      {/* stage names along the curve */}
      {copy.stages.map((stage, k) => (
        <span
          key={stage}
          style={{
            position: "absolute",
            left: (curveX(bands[k]!) + curveX(bands[k + 1]!)) / 2,
            top: 254,
            transform: "translateX(-50%)",
            fontSize: 28,
            fontWeight: 500,
            color: k === 1 ? color.teal : color.muted,
            opacity: enter(frame, fps, 190 + k * 8, 18) * morph,
            whiteSpace: "nowrap"
          }}
        >
          {stage}
        </span>
      ))}
      {morph > 0 ? (
        <span
          style={{
            position: "absolute",
            left: curveX(travel) + 26,
            top: curveY(travel) - 64,
            fontSize: 28,
            fontWeight: 500,
            color: "#fff",
            background: color.teal,
            padding: "6px 14px",
            borderRadius: 999,
            whiteSpace: "nowrap",
            opacity: interpolate(frame, [236, 250], [0, 1], clamp)
          }}
        >
          {copy.signals[0]} · {copy.now}
        </span>
      ) : null}

      <div style={{ ...card, position: "absolute", left: 90, right: 90, top: 930, padding: "18px 28px", background: color.tealSoft, boxShadow: "none", opacity: payoff, transform: `translateY(${(1 - payoff) * 16}px)` }}>
        <p style={{ margin: 0, fontSize: 32, lineHeight: 1.2, color: color.ink }}>{copy.payoff}</p>
      </div>
    </AbsoluteFill>
  );
}

/* ---------------------------------------------------------------- journey */

export type JourneyCopy = {
  steps: [string, string, string, string, string];
  current: string;
  previous: string;
  quote: string;
  platform: string;
  fixLabel: string;
  fix: string;
};

// Mood per step (-1 frustrated .. 1 happy), this month and the one before.
const NOW = [0.55, 0.35, 0.3, -0.75, -0.2];
const BEFORE = [0.5, 0.3, 0.35, -0.35, 0.05];

export function JourneyComposition({ copy }: { copy: JourneyCopy }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const fade = interpolate(frame, [durationInFrames - 22, durationInFrames - 2], [1, 0], clamp);
  const x = (i: number) => 140 + i * 200;
  const y = (v: number) => 470 - v * 220;
  const drawBefore = interpolate(frame, [20, 80], [0, 1], clamp);
  const drawNow = interpolate(frame, [70, 140], [0, 1], clamp);
  const dip = enter(frame, fps, 150, 14);
  const quote = enter(frame, fps, 176, 18);
  const fix = enter(frame, fps, 214, 18);
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"} ${x(i)} ${y(v)}`).join(" ");

  return (
    <AbsoluteFill style={{ opacity: fade, fontFamily: font }}>
      <svg width={1080} height={1080} style={{ position: "absolute", inset: 0 }} aria-hidden>
        <line x1={100} y1={470} x2={980} y2={470} stroke={color.line} strokeWidth={3} strokeDasharray="10 10" />
        <path d={path(BEFORE)} fill="none" stroke="#c9d3d3" strokeWidth={5} strokeDasharray={1200} strokeDashoffset={1200 * (1 - drawBefore)} strokeLinejoin="round" />
        <path d={path(NOW)} fill="none" stroke={color.teal} strokeWidth={7} strokeDasharray={1200} strokeDashoffset={1200 * (1 - drawNow)} strokeLinejoin="round" />
        {NOW.map((v, i) => {
          const p = interpolate(frame, [70 + i * 14, 84 + i * 14], [0, 1], clamp);
          const hot = i === 3;
          return <circle key={i} cx={x(i)} cy={y(v)} r={hot ? 14 + dip * 8 : 12} fill={hot && dip > 0.1 ? color.coral : color.teal} opacity={p} />;
        })}
        <circle cx={x(3)} cy={y(NOW[3]!)} r={60} fill="none" stroke={color.coral} strokeWidth={4} opacity={dip} />
      </svg>
      {copy.steps.map((step, i) => (
        <span key={step} style={{ position: "absolute", left: x(i), top: 760, transform: "translateX(-50%)", fontSize: 30, color: i === 3 && dip > 0.1 ? color.coral : color.fg, fontWeight: i === 3 ? 500 : 400, whiteSpace: "nowrap", opacity: enter(frame, fps, 8 + i * 6, 18) }}>
          {step}
        </span>
      ))}
      <div style={{ position: "absolute", left: 100, top: 80, display: "flex", gap: 28, fontSize: 28, color: color.muted, opacity: enter(frame, fps, 4, 18) }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 36, height: 7, borderRadius: 4, background: color.teal }} />
          {copy.current}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 36, height: 7, borderRadius: 4, background: "#c9d3d3" }} />
          {copy.previous}
        </span>
      </div>
      <div style={{ position: "absolute", left: 300, right: 90, top: 180, opacity: quote, transform: `translateY(${(1 - quote) * 16}px)` }}>
        <div style={{ background: color.bubble, borderRadius: "34px 34px 34px 10px", padding: "20px 28px", fontSize: 32, lineHeight: 1.25, color: color.ink }}>{copy.quote}</div>
        <div style={{ marginTop: 10, marginLeft: 8 }}>
          <SourceIcon name={copy.platform} size={30} />
        </div>
      </div>
      <div style={{ ...card, position: "absolute", left: 90, right: 90, top: 850, padding: "24px 32px", background: color.tealSoft, boxShadow: "none", opacity: fix, transform: `translateY(${(1 - fix) * 18}px)` }}>
        <p style={{ margin: 0, fontSize: 28, fontWeight: 500, color: color.teal }}>{copy.fixLabel}</p>
        <p style={{ margin: "8px 0 0", fontSize: 38, lineHeight: 1.15, color: color.ink }}>{copy.fix}</p>
      </div>
    </AbsoluteFill>
  );
}

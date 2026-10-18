"use client";

import { SourceIcon } from "@/components/brand/SourceMark";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "./runtime";
import { color, font } from "./theme";
import { clamp, enter } from "./util";

/**
 * Hero animations, one per situation of the rotating hero (square 1080 canvas, transparent).
 * Defend reuses HeroComposition; these three cover track, launch and enter.
 * Quotes here are illustrative, like every example in the hero.
 */

export const SLIDE = { width: 1080, height: 1080, fps: 30, frames: 270 } as const;

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const fadeOut = (frame: number) => interpolate(frame, [SLIDE.frames - 22, SLIDE.frames - 2], [1, 0], clamp);

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const card = {
  background: "#fff",
  borderRadius: 32,
  boxShadow: "0 18px 50px rgba(10,10,10,0.08)",
  fontFamily: font
} as const;

function Bubble({ text, platform, x, y, width, p, size = 34 }: { text: string; platform: string; x: number; y: number; width: number; p: number; size?: number }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width, opacity: p, transform: `translateY(${(1 - p) * 18}px) scale(${0.94 + p * 0.06})` }}>
      <div style={{ background: color.bubble, borderRadius: "30px 30px 30px 10px", padding: "18px 24px", fontFamily: font, fontSize: size, lineHeight: 1.25, color: color.ink }}>{text}</div>
      <div style={{ marginTop: 8, marginLeft: 6, display: "flex", alignItems: "center", gap: 8 }}>
        <SourceIcon name={platform} size={26} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- track */

export type TrackCopy = {
  header: string;
  previous: string;
  current: string;
  topics: [string, string, string, string];
  changeLabel: string;
  change: string;
  quote: string;
};

const TRACK = [
  { before: 42, after: 40 },
  { before: 18, after: 46 },
  { before: 34, after: 22 },
  { before: 26, after: 27 }
];

export function TrackComposition({ copy }: { copy: TrackCopy }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const head = enter(frame, fps, 2, 18);
  const morph = interpolate(frame, [96, 150], [0, 1], { ...clamp, easing: ease });
  const deltas = enter(frame, fps, 150, 16);
  const change = enter(frame, fps, 184, 18);
  const quote = enter(frame, fps, 204, 18);
  const max = 50;

  return (
    <AbsoluteFill style={{ opacity: fadeOut(frame) }}>
      <div style={{ ...card, position: "absolute", left: 60, right: 60, top: 60, padding: "34px 40px", opacity: head, transform: `translateY(${(1 - head) * 18}px)` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 36, fontWeight: 500, color: color.ink }}>{copy.header}</span>
          <span style={{ display: "flex", gap: 10, fontSize: 28 }}>
            <span style={{ padding: "6px 16px", borderRadius: 999, background: morph > 0.5 ? color.track : color.ink, color: morph > 0.5 ? color.muted : "#fff" }}>{copy.previous}</span>
            <span style={{ padding: "6px 16px", borderRadius: 999, background: morph > 0.5 ? color.ink : color.track, color: morph > 0.5 ? "#fff" : color.muted }}>{copy.current}</span>
          </span>
        </div>
        <div style={{ marginTop: 34, display: "flex", flexDirection: "column", gap: 26 }}>
          {TRACK.map((row, i) => {
            const grow = enter(frame, fps, 24 + i * 9, 20);
            const value = row.before + (row.after - row.before) * morph;
            const diff = row.after - row.before;
            const big = Math.abs(diff) >= 10;
            const tone = diff > 0 ? color.teal : color.coral;
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "230px 1fr 120px", alignItems: "center", gap: 20 }}>
                <span style={{ fontSize: 32, color: big && morph > 0.6 ? color.ink : color.fg, fontWeight: big && morph > 0.6 ? 500 : 400 }}>{copy.topics[i]}</span>
                <div style={{ height: 26, borderRadius: 13, background: color.track, position: "relative", overflow: "hidden" }}>
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: `${(value / max) * 100 * grow}%`,
                      borderRadius: 13,
                      background: big && morph > 0.4 ? tone : "#b9d9d9"
                    }}
                  />
                </div>
                <span style={{ fontSize: 30, fontWeight: 500, textAlign: "right", color: big ? tone : color.muted, opacity: deltas }}>
                  {diff > 0 ? "+" : diff < 0 ? "−" : "±"}
                  {Math.round(Math.abs(diff) * deltas)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ ...card, position: "absolute", left: 60, width: 600, top: 600, padding: "28px 34px", background: color.tealSoft, boxShadow: "none", opacity: change, transform: `translateY(${(1 - change) * 22}px)` }}>
        <p style={{ margin: 0, fontSize: 28, fontWeight: 500, color: color.teal }}>{copy.changeLabel}</p>
        <p style={{ margin: "10px 0 0", fontSize: 42, lineHeight: 1.15, color: color.ink }}>{copy.change}</p>
      </div>
      <Bubble text={copy.quote} platform="TikTok" x={600} y={800} width={420} p={quote} size={32} />
    </AbsoluteFill>
  );
}

/* ---------------------------------------------------------------- launch */

export type LaunchCopy = {
  concept: string;
  conceptLabel: string;
  pull: string;
  push: string;
  pulls: [string, string, string];
  pushes: [string, string, string];
  verdict: string;
};

const LAUNCH_DOTS = (() => {
  const r = rng(29);
  return Array.from({ length: 110 }, (_, i) => {
    const side = i % 5 < 3 ? -1 : 1; // three in five pull toward the idea
    const a = r() * Math.PI * 2;
    return {
      sx: 540 + Math.cos(a) * (560 + r() * 160),
      sy: 520 + Math.sin(a) * (560 + r() * 160),
      mx: 540 + Math.cos(a) * (150 + r() * 70),
      my: 470 + Math.sin(a) * (110 + r() * 50),
      tx: side < 0 ? 120 + r() * 300 : 660 + r() * 300,
      ty: 690 + r() * 170,
      side,
      delay: Math.floor(r() * 40)
    };
  });
})();

export function LaunchComposition({ copy }: { copy: LaunchCopy }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const concept = enter(frame, fps, 4, 16);
  const split = interpolate(frame, [104, 156], [0, 1], { ...clamp, easing: ease });
  const labels = enter(frame, fps, 140, 18);
  const verdict = enter(frame, fps, 206, 18);

  return (
    <AbsoluteFill style={{ opacity: fadeOut(frame) }}>
      <svg width={1080} height={1080} style={{ position: "absolute", inset: 0 }} aria-hidden>
        {LAUNCH_DOTS.map((dot, i) => {
          const arrive = interpolate(frame, [18 + dot.delay, 70 + dot.delay], [0, 1], { ...clamp, easing: ease });
          const x = split > 0 ? dot.mx + (dot.tx - dot.mx) * split : dot.sx + (dot.mx - dot.sx) * arrive;
          const y = split > 0 ? dot.my + (dot.ty - dot.my) * split : dot.sy + (dot.my - dot.sy) * arrive;
          const fill = split > 0.3 ? (dot.side < 0 ? color.teal : color.coral) : color.muted;
          return <circle key={i} cx={x} cy={y} r={8} fill={fill} opacity={arrive * (0.55 + split * 0.4)} />;
        })}
      </svg>

      <div
        style={{
          ...card,
          position: "absolute",
          left: 290,
          width: 500,
          top: 330 - split * 250,
          padding: "26px 32px",
          textAlign: "center",
          opacity: concept,
          transform: `scale(${0.9 + concept * 0.1})`
        }}
      >
        <p style={{ margin: 0, fontSize: 26, color: color.muted }}>{copy.conceptLabel}</p>
        <p style={{ margin: "8px 0 0", fontSize: 40, lineHeight: 1.15, color: color.ink, fontWeight: 500 }}>{copy.concept}</p>
      </div>

      {[
        { title: copy.pull, items: copy.pulls, x: 60, tone: color.teal, soft: color.tealSoft },
        { title: copy.push, items: copy.pushes, x: 580, tone: color.coral, soft: color.coralSoft }
      ].map((col, c) => (
        <div key={c} style={{ position: "absolute", left: col.x, width: 440, top: 300, opacity: labels, transform: `translateY(${(1 - labels) * 16}px)`, fontFamily: font }}>
          <p style={{ margin: 0, fontSize: 32, fontWeight: 500, color: col.tone }}>{col.title}</p>
          <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 10 }}>
            {col.items.map((item, k) => (
              <span key={item} style={{ fontSize: 30, padding: "8px 18px", borderRadius: 999, background: col.soft, color: color.ink, opacity: enter(frame, fps, 150 + k * 8, 18) }}>
                {item}
              </span>
            ))}
          </div>
        </div>
      ))}

      <div style={{ ...card, position: "absolute", left: 140, right: 140, top: 900, padding: "22px 30px", textAlign: "center", background: color.tealSoft, boxShadow: "none", opacity: verdict, transform: `translateY(${(1 - verdict) * 20}px)` }}>
        <p style={{ margin: 0, fontSize: 38, color: color.ink, fontWeight: 500 }}>{copy.verdict}</p>
      </div>
    </AbsoluteFill>
  );
}

/* ---------------------------------------------------------------- enter */

export type EnterCopy = {
  bubbles: [string, string, string, string, string];
  rulesLabel: string;
  rules: [string, string, string];
};

const ENTER_BUBBLES = [
  { x: 60, y: 70, w: 520, platform: "Facebook" },
  { x: 560, y: 150, w: 460, platform: "TikTok" },
  { x: 110, y: 330, w: 470, platform: "X" },
  { x: 600, y: 410, w: 420, platform: "Instagram" },
  { x: 220, y: 560, w: 520, platform: "Reviews" }
];

export function EnterComposition({ copy }: { copy: EnterCopy }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const collapse = interpolate(frame, [128, 168], [0, 1], { ...clamp, easing: ease });
  const label = enter(frame, fps, 160, 18);

  return (
    <AbsoluteFill style={{ opacity: fadeOut(frame) }}>
      {ENTER_BUBBLES.map((b, i) => {
        const p = enter(frame, fps, 6 + i * 16, 18);
        // Each mention shrinks into the rule it supports.
        const target = { x: 120 + (i % 3) * 300, y: 690 };
        const x = b.x + (target.x - b.x) * collapse;
        const y = b.y + (target.y - b.y) * collapse;
        return (
          <div key={i} style={{ position: "absolute", left: 0, top: 0, transform: `translate(${x}px, ${y}px) scale(${1 - collapse * 0.85})`, transformOrigin: "top left", opacity: p * (1 - collapse) }}>
            <Bubble text={copy.bubbles[i]} platform={b.platform} x={0} y={0} width={b.w} p={1} size={32} />
          </div>
        );
      })}

      <p style={{ position: "absolute", left: 60, top: 600, margin: 0, fontFamily: font, fontSize: 32, fontWeight: 500, color: color.teal, opacity: label }}>{copy.rulesLabel}</p>
      {copy.rules.map((rule, i) => {
        const p = enter(frame, fps, 168 + i * 12, 16);
        return (
          <div
            key={rule}
            style={{
              ...card,
              position: "absolute",
              left: 60 + i * 330,
              width: 300,
              top: 660,
              minHeight: 250,
              padding: "26px 26px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              opacity: p,
              transform: `translateY(${(1 - p) * 26}px)`
            }}
          >
            <span style={{ width: 54, height: 54, borderRadius: 16, background: color.tealSoft, color: color.teal, display: "grid", placeItems: "center", fontSize: 30, fontWeight: 500 }}>{i + 1}</span>
            <p style={{ margin: 0, fontSize: 36, lineHeight: 1.15, color: color.ink }}>{rule}</p>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

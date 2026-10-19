"use client";

import { SourceIcon } from "@/components/brand/SourceMark";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "./runtime";
import { color, font } from "./theme";
import { clamp, enter } from "./util";

/**
 * The same conversation read four ways (square 1080 canvas). Every mode starts from the
 * same dots so the difference is only in what comes out: an answer, a dashboard, a text
 * that changes, or a slow reading of a sample.
 */

export const APPROACH = { width: 1080, height: 1080, fps: 30, frames: 300 } as const;
/** Noisia's reading runs longer: after the topics it opens the approved one to find the why. */
export const APPROACH_FRAMES = { noisia: 420, listening: 300, ai: 300, agency: 300 } as const;
export type ApproachMode = "noisia" | "listening" | "ai" | "agency";

export type ApproachCopy = {
  clusters: [string, string, string, string, string];
  noise: string;
  approved: string;
  answerLabel: string;
  answer: string;
  quote: string;
  reasons: [string, string, string];
  action: string;
  mentions: string;
  sentiment: [string, string, string];
  why: string;
  aiRead: string;
  aiAgain: string;
  week: string;
  sample: string;
};

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const N = 150;
const SOURCES = ["TikTok", "Instagram", "YouTube", "X", "Facebook", "Reddit", "Reviews"];
const CENTERS = [
  { x: 220, y: 390 },
  { x: 470, y: 330 },
  { x: 740, y: 380 },
  { x: 350, y: 560 },
  { x: 640, y: 570 },
  { x: 930, y: 560 }
];
const HI = 3;
const BARS = 9;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const DOTS = (() => {
  const r = rng(41);
  const perBar = new Array(BARS).fill(0);
  return Array.from({ length: N }, (_, i) => {
    const cluster = i % 10 === 0 ? 5 : Math.floor(r() * 5);
    const a = r() * Math.PI * 2;
    const rad = Math.sqrt(r()) * (cluster === 5 ? 50 : 72);
    const bar = Math.min(BARS - 1, Math.floor(Math.pow(r(), 0.8) * BARS));
    const level = perBar[bar]++;
    return {
      sx: 70 + r() * 940,
      sy: 150 + r() * 470,
      cx: CENTERS[cluster]!.x + Math.cos(a) * rad,
      cy: CENTERS[cluster]!.y + Math.sin(a) * rad * 0.8,
      cluster,
      bar,
      level,
      phase: r() * Math.PI * 2,
      delay: Math.floor(r() * 30),
      // the part a generic AI gets to read, and the few a person reads by hand
      inWindow: false,
      handOrder: -1
    };
  });
})();
// Window: the dots that fall inside a fixed rectangle of the starting scatter.
const WINDOW = { x: 300, y: 190, w: 470, h: 330 };
DOTS.forEach((d) => (d.inWindow = d.sx > WINDOW.x && d.sx < WINDOW.x + WINDOW.w && d.sy > WINDOW.y && d.sy < WINDOW.y + WINDOW.h));
DOTS.filter((_, i) => i % 9 === 4).slice(0, 14).forEach((d, k) => (d.handOrder = k));
// Dots stack into the dashboard bars; the spacing keeps the tallest bar inside the card.
const LEVEL_GAP = Math.min(14, 250 / Math.max(...DOTS.map((d) => d.level + 1)));

const card = { background: "#fff", borderRadius: 30, boxShadow: "0 18px 50px rgba(10,10,10,0.08)", fontFamily: font } as const;

export function ApproachComposition({ mode, copy }: { mode: ApproachMode; copy: ApproachCopy }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const fade = interpolate(frame, [durationInFrames - 22, durationInFrames - 2], [1, 0], clamp);
  // Noisia only: the approved topic rises and opens into the reasons behind it.
  const lift = mode === "noisia" ? interpolate(frame, [204, 240], [0, 1], { ...clamp, easing: ease }) : 0;
  const shift = -190 * lift;
  const quote = enter(frame, fps, 236, 18);
  const answerAt = 318;

  // shared
  const gather = interpolate(frame, [60, 130], [0, 1], { ...clamp, easing: ease });
  const labels = enter(frame, fps, 122, 18);
  const focus = enter(frame, fps, 150, 16);
  const approved = enter(frame, fps, 168, 14);
  const answer = enter(frame, fps, mode === "noisia" ? answerAt : 190, 18);
  const dash = enter(frame, fps, 138, 18);
  const why = enter(frame, fps, 196, 16);
  const win = enter(frame, fps, 56, 18);
  const flow = interpolate(frame, [104, 160], [0, 1], { ...clamp, easing: ease });
  const again = interpolate(frame, [196, 226], [0, 1], { ...clamp, easing: ease });
  const week = Math.min(4, 1 + Math.floor(interpolate(frame, [60, 250], [0, 4], clamp)));

  const dotPos = (d: (typeof DOTS)[number], i: number) => {
    const wobble = 6 * (1 - gather);
    const base = { x: d.sx + Math.cos(frame / 22 + d.phase) * wobble, y: d.sy + Math.sin(frame / 26 + d.phase) * wobble };
    if (mode === "noisia") return { x: base.x + (d.cx - base.x) * gather, y: base.y + (d.cy - base.y) * gather };
    if (mode === "listening") {
      const tx = 150 + d.bar * 48;
      const ty = 980 - d.level * LEVEL_GAP;
      return { x: base.x + (tx - base.x) * gather, y: base.y + (ty - base.y) * gather };
    }
    if (mode === "ai") {
      if (!d.inWindow) return base;
      const row = i % 5;
      const tx = 130 + ((i * 37) % 820) * flow;
      const ty = 720 + row * 46;
      return { x: base.x + (tx - base.x) * flow, y: base.y + (ty - base.y) * flow };
    }
    // agency: a handful, one by one
    if (d.handOrder < 0) return base;
    const t = interpolate(frame, [70 + d.handOrder * 12, 100 + d.handOrder * 12], [0, 1], { ...clamp, easing: ease });
    const tx = 180 + (d.handOrder % 7) * 40;
    const ty = 800 + Math.floor(d.handOrder / 7) * 40;
    return { x: base.x + (tx - base.x) * t, y: base.y + (ty - base.y) * t };
  };

  const dotStyle = (d: (typeof DOTS)[number]) => {
    if (mode === "noisia") {
      const noise = d.cluster === 5;
      const hi = d.cluster === HI;
      const fill = noise ? color.faint : hi && focus > 0.05 ? color.teal : gather > 0.6 ? "#7cc4c4" : color.muted;
      const opacity = noise ? 1 - focus * 0.85 : !hi ? 1 - focus * 0.45 - lift * 0.4 : 1;
      return { fill, opacity, r: hi ? 8 + focus * 2 : 7 };
    }
    if (mode === "listening") return { fill: gather > 0.5 ? "#7cc4c4" : color.muted, opacity: 1, r: 7 };
    // What the AI reads dissolves into the text it writes.
    if (mode === "ai") return { fill: d.inWindow ? (win > 0.3 ? color.ink : color.muted) : color.faint, opacity: d.inWindow ? 1 - interpolate(flow, [0.55, 1], [0, 1], clamp) : 1 - win * 0.75, r: 7 };
    return { fill: d.handOrder >= 0 ? color.ink : color.faint, opacity: d.handOrder >= 0 ? 1 : 0.55, r: 7 };
  };

  const hi = CENTERS[HI]!;

  return (
    <AbsoluteFill style={{ opacity: fade, fontFamily: font }}>
      {/* where the conversation comes from */}
      <div style={{ position: "absolute", top: 40, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 28 }}>
        {SOURCES.map((source, i) => {
          const p = enter(frame, fps, 2 + i * 4, 16);
          return (
            <span key={source} style={{ width: 70, height: 70, borderRadius: 22, background: "#fff", boxShadow: "0 8px 24px rgba(10,10,10,0.07)", display: "grid", placeItems: "center", opacity: p * (1 - lift), transform: `translateY(${(1 - p) * 14}px)` }}>
              <SourceIcon name={source} size={36} />
            </span>
          );
        })}
      </div>

      {mode === "ai" ? (
        <div style={{ position: "absolute", left: WINDOW.x - 18, top: WINDOW.y - 18, width: WINDOW.w + 36, height: WINDOW.h + 36, borderRadius: 26, border: `4px dashed ${color.ink}`, opacity: win * (1 - flow * 0.7) }}>
          <span style={{ position: "absolute", left: 18, top: -52, fontSize: 32, fontWeight: 500, color: color.ink, whiteSpace: "nowrap" }}>{copy.aiRead}</span>
        </div>
      ) : null}

      {mode === "listening" ? (
        <div style={{ ...card, position: "absolute", left: 90, right: 90, top: 660, height: 360, opacity: dash }}>
          <span style={{ position: "absolute", right: 40, top: 34, fontSize: 64, fontWeight: 500, color: color.ink }}>12.480</span>
          <span style={{ position: "absolute", right: 40, top: 110, fontSize: 28, color: color.muted }}>{copy.mentions}</span>
          <svg width={220} height={220} viewBox="0 0 220 220" style={{ position: "absolute", right: 40, bottom: 20 }} aria-hidden>
            {[
              { v: 0.46, c: "#7cc4c4" },
              { v: 0.32, c: color.faint },
              { v: 0.22, c: color.coral }
            ].reduce<{ acc: number; el: JSX.Element[] }>(
              (state, seg, k) => {
                const len = 2 * Math.PI * 70;
                state.el.push(
                  <circle key={k} cx={110} cy={110} r={70} fill="none" stroke={seg.c} strokeWidth={34} strokeDasharray={`${len * seg.v * dash} ${len}`} strokeDashoffset={-len * state.acc * dash} transform="rotate(-90 110 110)" />
                );
                state.acc += seg.v;
                return state;
              },
              { acc: 0, el: [] }
            ).el}
          </svg>
          <div style={{ position: "absolute", left: 470, top: 170, display: "flex", flexDirection: "column", gap: 10, fontSize: 24, color: color.muted }}>
            {copy.sentiment.map((s, k) => (
              <span key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 14, height: 14, borderRadius: 7, background: ["#7cc4c4", color.faint, color.coral][k] }} />
                {s}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {mode === "ai" ? (
        <div style={{ ...card, position: "absolute", left: 90, right: 90, top: 680, height: 300, opacity: enter(frame, fps, 100, 18) }}>
          {[0, 1, 2, 3, 4].map((k) => {
            const w1 = [86, 72, 90, 64, 40][k]!;
            const w2 = [60, 88, 70, 84, 52][k]!;
            const w = w1 + (w2 - w1) * again;
            return <div key={k} style={{ position: "absolute", left: 40, top: 40 + k * 46, height: 18, borderRadius: 9, width: `${(w * interpolate(frame, [120 + k * 8, 150 + k * 8], [0, 1], clamp)) * 0.85}%`, background: again > 0.05 && again < 0.95 ? color.coral : color.faint }} />;
          })}
        </div>
      ) : null}

      {mode === "agency" ? (
        <div style={{ ...card, position: "absolute", left: 90, right: 90, top: 700, height: 300, opacity: enter(frame, fps, 50, 18) }}>
          <span style={{ position: "absolute", right: 40, top: 30, fontSize: 40, fontWeight: 500, color: color.ink }}>
            {copy.week} {week}
          </span>
          <span style={{ position: "absolute", left: 40, top: 34, fontSize: 30, color: color.muted }}>{copy.sample}</span>
          {[0, 1, 2].map((k) => {
            const p = enter(frame, fps, 120 + k * 45, 18);
            return <div key={k} style={{ position: "absolute", right: 40 + (2 - k) * 150, bottom: 40, width: 130, height: 90, borderRadius: 12, border: `3px solid ${color.line}`, background: color.track, opacity: p, transform: `translateY(${(1 - p) * 12}px)` }} />;
          })}
        </div>
      ) : null}

      <svg width={1080} height={1080} style={{ position: "absolute", inset: 0, transform: `translateY(${shift}px)` }} aria-hidden>
        {DOTS.map((d, i) => {
          const appear = interpolate(frame, [10 + d.delay, 30 + d.delay], [0, 1], clamp);
          const p = dotPos(d, i);
          const s = dotStyle(d);
          return <circle key={i} cx={p.x} cy={p.y} r={s.r} fill={s.fill} opacity={appear * s.opacity} />;
        })}
        {mode === "noisia" ? <circle cx={hi.x} cy={hi.y} r={98} fill="none" stroke={color.teal} strokeWidth={4} opacity={focus} /> : null}
      </svg>

      {mode === "noisia" ? (
        <>
          <div style={{ position: "absolute", inset: 0, transform: `translateY(${shift}px)` }}>
            {CENTERS.slice(0, 5).map((center, i) => (
              <span
                key={i}
                style={{
                  position: "absolute",
                  left: center.x,
                  top: center.y - 120,
                  transform: "translateX(-50%)",
                  fontSize: 32,
                  fontWeight: i === HI ? 500 : 400,
                  color: i === HI && focus > 0.1 ? color.teal : color.fg,
                  background: "rgba(255,255,255,0.88)",
                  padding: "4px 14px",
                  borderRadius: 999,
                  whiteSpace: "nowrap",
                  opacity: labels * (i === HI ? 1 : 1 - focus * 0.5 - lift * 0.4)
                }}
              >
                {copy.clusters[i]}
              </span>
            ))}
            <span style={{ position: "absolute", left: CENTERS[5]!.x, top: CENTERS[5]!.y - 100, transform: "translateX(-50%)", fontSize: 28, color: color.muted, textDecoration: "line-through", opacity: labels * (1 - focus) }}>
              {copy.noise}
            </span>
            <span style={{ position: "absolute", left: hi.x + 110, top: hi.y - 24, fontSize: 30, fontWeight: 500, color: "#fff", background: color.ink, padding: "8px 18px", borderRadius: 999, whiteSpace: "nowrap", opacity: approved, transform: `scale(${0.85 + approved * 0.15})`, transformOrigin: "left center" }}>
              ✓ {copy.approved}
            </span>
          </div>

          {/* the why: one mention from the topic, read for what is behind it */}
          <div style={{ position: "absolute", left: 90, right: 90, top: 520, opacity: quote, transform: `translateY(${(1 - quote) * 18}px)` }}>
            <div style={{ position: "relative", marginLeft: 18 }}>
              <svg width={40} height={36} viewBox="0 0 18 16" style={{ position: "absolute", left: -19, bottom: 0 }} aria-hidden>
                <path d="M18 0 C18 9 13 15 0 16 C8 12 9 6 9 0 Z" fill={color.bubble} />
              </svg>
              <div style={{ background: color.bubble, borderRadius: "36px 36px 36px 12px", padding: "22px 30px", fontSize: 34, lineHeight: 1.25, color: color.ink }}>{copy.quote}</div>
            </div>
          </div>
          <div style={{ position: "absolute", left: 90, right: 60, top: 676, display: "flex", flexWrap: "wrap", gap: 10 }}>
            {copy.reasons.map((reason, k) => {
              const p = enter(frame, fps, 262 + k * 14, 16);
              return (
                <span key={reason} style={{ fontSize: 27, fontWeight: 500, padding: "8px 16px", borderRadius: 999, whiteSpace: "nowrap", background: color.coral, color: "#fff", opacity: p, transform: `translateY(${(1 - p) * 12}px)` }}>
                  ↓ {reason}
                </span>
              );
            })}
          </div>
          <div style={{ ...card, position: "absolute", left: 90, right: 90, top: 790, padding: "24px 32px", background: color.tealSoft, boxShadow: "none", opacity: answer, transform: `translateY(${(1 - answer) * 22}px)` }}>
            <p style={{ margin: 0, fontSize: 28, fontWeight: 500, color: color.teal }}>{copy.answerLabel}</p>
            <p style={{ margin: "8px 0 0", fontSize: 42, lineHeight: 1.12, color: color.ink }}>{copy.answer}</p>
            <p style={{ margin: "12px 0 0", fontSize: 30, lineHeight: 1.25, color: color.fg, opacity: enter(frame, fps, answerAt + 22, 18) }}>→ {copy.action}</p>
          </div>
        </>
      ) : null}

      {mode === "listening" ? (
        <span style={{ position: "absolute", left: 90, top: 600, fontSize: 34, fontWeight: 500, color: color.coral, border: `3px dashed ${color.coral}`, padding: "6px 18px", borderRadius: 999, opacity: why, transform: `translateY(${(1 - why) * 10}px)` }}>
          {copy.why}
        </span>
      ) : null}

      {mode === "ai" ? (
        <span style={{ position: "absolute", left: 90, top: 610, fontSize: 32, fontWeight: 500, color: color.coral, opacity: again > 0.05 ? 1 : 0 }}>↻ {copy.aiAgain}</span>
      ) : null}
    </AbsoluteFill>
  );
}

"use client";

import type { CSSProperties, ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Check, DashFlag, Journal, Plus } from "iconoir-react";
import { SourceIcon } from "@/components/brand/SourceMark";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "./runtime";
import { color, font } from "./theme";
import { clamp, enter } from "./util";

/**
 * The three ways of working with Noisia on the Solutions page, one animation each. Every
 * composition reads its canvas from the Stage and lays itself out for a wide canvas (desktop)
 * or a tall one (phones). Topics, quotes and numbers are illustrative.
 */

/** Canvas sizes per layout; the wrapper picks one by breakpoint. */
export const PRODUCT_CANVAS = {
  wide: { width: 1920, height: 1000 },
  tall: { width: 1080, height: 1300 }
} as const;

export const PRODUCT_FRAMES = { report: 540, study: 400, plan: 360 } as const;

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const fade = (frame: number, total: number) => interpolate(frame, [total - 22, total - 2], [1, 0], clamp);
const shadow = "0 2px 0 rgba(10,10,10,0.03), 0 24px 60px rgba(10,10,10,0.08)";
const card: CSSProperties = { position: "absolute", background: "#fff", borderRadius: 36, boxShadow: shadow, fontFamily: font };

function useLayout() {
  const { width, height } = useVideoConfig();
  return { wide: width > height, width, height };
}

/** A chat bubble with the platform it came from, the visual unit of "what people said". */
function Quote({ text, source, size = 40, style }: { text: string; source: string; size?: number; style?: CSSProperties }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, ...style }}>
      <div style={{ background: color.bubble, borderRadius: "34px 34px 34px 10px", padding: `${size * 0.55}px ${size * 0.7}px`, fontSize: size, lineHeight: 1.22, color: color.ink, textWrap: "balance" }}>
        “{text}”
      </div>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: size * 0.62, color: color.muted, paddingLeft: 8 }}>
        <SourceIcon name={source} size={Math.round(size * 0.7)} />
        {source}
      </span>
    </div>
  );
}

/* ================================================================ report */

export type OfferReportCopy = {
  cadences: [string, string, string];
  /** Which cadence the animation shows as chosen. */
  cadence: number;
  dates: [string, string, string, string];
  sinceLabel: string;
  whyLabel: string;
  doLabel: string;
  dirLabels: { up: string; down: string; new: string };
  editions: { dir: "up" | "down" | "new"; topic: string; quote: string; source: string; action: string }[];
};

const LINES: Record<"up" | "down" | "new", number[]> = {
  up: [30, 33, 31, 36, 39, 45, 54, 68],
  down: [64, 61, 63, 58, 52, 47, 40, 31],
  new: [2, 2, 3, 4, 7, 12, 22, 38]
};

const EDITION_START = 24;
const EDITION_LEN = 170;

export function OfferReportComposition({ copy }: { copy: OfferReportCopy }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { wide } = useLayout();
  const intro = enter(frame, fps, 0, 18);
  // Timeline head: moves between edition dots during the hand-off between editions.
  const head = copy.editions.reduce((sum, _, k) => sum + interpolate(frame, [EDITION_START + k * EDITION_LEN - 14, EDITION_START + k * EDITION_LEN + 8], [0, 1], { ...clamp, easing: easeInOut }), 0) - 1;

  const cadence = (
    <div style={{ display: "inline-flex", padding: 8, borderRadius: 999, background: color.track, gap: 4, opacity: intro, fontSize: wide ? 24 : 34 }}>
      {copy.cadences.map((name, k) => (
        <span key={name} style={{ padding: wide ? "12px 18px" : "16px 30px", borderRadius: 999, background: k === copy.cadence ? "#fff" : "transparent", boxShadow: k === copy.cadence ? "0 4px 14px rgba(10,10,10,0.1)" : "none", color: k === copy.cadence ? color.ink : color.muted, fontWeight: k === copy.cadence ? 500 : 400 }}>
          {name}
        </span>
      ))}
    </div>
  );

  // Edition dots: done (teal), current (teal, ringed), upcoming (grey).
  const dots = copy.dates.map((date, k) => {
    const reached = head >= k - 0.02;
    const current = Math.round(head) === k && k < copy.editions.length;
    return { date, reached, current };
  });

  return (
    <AbsoluteFill style={{ opacity: fade(frame, PRODUCT_FRAMES.report), fontFamily: font }}>
      {wide ? (
        <>
          <div style={{ position: "absolute", left: 90, top: 96 }}>{cadence}</div>
          {/* vertical timeline */}
          <div style={{ position: "absolute", left: 120, top: 250, width: 4, height: 600, background: color.line, borderRadius: 2 }} />
          <div style={{ position: "absolute", left: 120, top: 250, width: 4, height: 200 * Math.max(0, head), background: color.teal, borderRadius: 2 }} />
          {dots.map((dot, k) => (
            <div key={dot.date} style={{ position: "absolute", left: 100, top: 230 + k * 200, display: "flex", alignItems: "center", gap: 30, opacity: intro }}>
              <Dot {...dot} />
              <span style={{ fontSize: 34, color: dot.current ? color.ink : color.muted, fontWeight: dot.current ? 500 : 400 }}>{dot.date}</span>
            </div>
          ))}
        </>
      ) : (
        <>
          <div style={{ position: "absolute", left: 0, right: 0, top: 56, display: "flex", justifyContent: "center" }}>{cadence}</div>
          <div style={{ position: "absolute", left: 140, right: 140, top: 222, height: 4, background: color.line, borderRadius: 2 }} />
          <div style={{ position: "absolute", left: 140, top: 222, height: 4, width: (800 / 3) * Math.max(0, head), background: color.teal, borderRadius: 2 }} />
          {dots.map((dot, k) => (
            <div key={dot.date} style={{ position: "absolute", left: 140 + k * (800 / 3) - 90, width: 180, top: 202, display: "flex", flexDirection: "column", alignItems: "center", gap: 18, opacity: intro }}>
              <Dot {...dot} />
              <span style={{ fontSize: 30, color: dot.current ? color.ink : color.muted, fontWeight: dot.current ? 500 : 400 }}>{dot.date}</span>
            </div>
          ))}
        </>
      )}

      <div style={{ ...card, ...(wide ? { left: 650, right: 80, top: 80, bottom: 80 } : { left: 50, right: 50, top: 340, bottom: 50 }), overflow: "hidden", opacity: enter(frame, fps, 8, 18), transform: `translateY(${(1 - enter(frame, fps, 8, 18)) * 30}px)` }}>
        {copy.editions.map((edition, k) => {
          const start = EDITION_START + k * EDITION_LEN;
          const inP = k === 0 ? 1 : interpolate(frame, [start - 4, start + 18], [0, 1], { ...clamp, easing: easeOut });
          const outP = k === copy.editions.length - 1 ? 0 : interpolate(frame, [start + EDITION_LEN - 16, start + EDITION_LEN + 2], [0, 1], { ...clamp, easing: easeInOut });
          if (inP * (1 - outP) <= 0.001) return null;
          return (
            <div key={edition.topic} style={{ position: "absolute", inset: 0, opacity: inP * (1 - outP), transform: `translateX(${(1 - inP) * 60 - outP * 60}px)` }}>
              <Edition copy={copy} edition={edition} local={frame - start} wide={wide} date={copy.dates[k] ?? ""} />
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

function Dot({ reached, current }: { reached: boolean; current: boolean }) {
  return (
    <span style={{ width: 44, height: 44, borderRadius: 22, display: "grid", placeItems: "center", background: current ? color.tealSoft : "transparent", flex: "none" }}>
      <span style={{ width: current ? 24 : 18, height: current ? 24 : 18, borderRadius: 12, background: reached ? color.teal : "#fff", border: `4px solid ${reached ? color.teal : color.faint}` }} />
    </span>
  );
}

function Edition({ copy, edition, local, wide, date }: { copy: OfferReportCopy; edition: OfferReportCopy["editions"][number]; local: number; wide: boolean; date: string }) {
  const { fps } = useVideoConfig();
  const tone = edition.dir === "up" ? color.teal : edition.dir === "down" ? color.coral : color.ink;
  const soft = edition.dir === "up" ? color.tealSoft : edition.dir === "down" ? color.coralSoft : color.track;
  const Icon = edition.dir === "up" ? ArrowUp : edition.dir === "down" ? ArrowDown : Plus;
  const draw = interpolate(local, [6, 46], [0, 1], { ...clamp, easing: easeOut });
  const why = enter(local, fps, 34, 18);
  const act = enter(local, fps, 56, 18);
  const line = LINES[edition.dir];
  const w = wide ? 540 : 880;
  const h = wide ? 380 : 230;
  const max = 72;
  const pts = line.map((v, i) => [(i / (line.length - 1)) * w, h - (v / max) * (h - 20) - 10] as const);
  const path = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1]!;

  const topic = (
    <div style={{ display: "flex", flexDirection: "column", gap: wide ? 26 : 20 }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: wide ? 30 : 30, color: color.muted }}>
        {copy.sinceLabel}
        <span style={{ fontSize: wide ? 26 : 26, padding: "8px 18px", borderRadius: 999, border: `2px solid ${color.line}`, color: color.fg }}>{date}</span>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
        <span style={{ fontSize: wide ? 64 : 58, lineHeight: 1.05, fontWeight: 500, color: color.ink, letterSpacing: "-0.01em" }}>{edition.topic}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 20px 8px 14px", borderRadius: 999, background: soft, color: tone, fontSize: 30, fontWeight: 500 }}>
          <Icon width={30} height={30} strokeWidth={2.2} />
          {copy.dirLabels[edition.dir]}
        </span>
      </span>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: "visible", marginTop: wide ? 18 : 6 }} aria-hidden>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={0} x2={w} y1={h * g} y2={h * g} stroke={color.track} strokeWidth={2} />
        ))}
        <path d={`${path} L${w},${h} L0,${h} Z`} fill={tone} opacity={0.08 * draw} />
        <path d={path} fill="none" stroke={tone} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
        <circle cx={last[0]} cy={last[1]} r={12 * Math.min(1, Math.max(0, draw * 3 - 2))} fill={tone} />
        <circle cx={last[0]} cy={last[1]} r={26 * Math.min(1, Math.max(0, draw * 3 - 2))} fill={tone} opacity={0.18} />
      </svg>
    </div>
  );

  const reason = (
    <div style={{ display: "flex", flexDirection: "column", gap: wide ? 30 : 24 }}>
      <div style={{ opacity: why, transform: `translateY(${(1 - why) * 18}px)` }}>
        <p style={{ margin: "0 0 16px", fontSize: 30, fontWeight: 500, color: color.teal }}>{copy.whyLabel}</p>
        <Quote text={edition.quote} source={edition.source} size={wide ? 40 : 38} />
      </div>
      <div style={{ opacity: act, transform: `translateY(${(1 - act) * 18}px)` }}>
        <p style={{ margin: "0 0 12px", fontSize: 30, fontWeight: 500, color: color.teal }}>{copy.doLabel}</p>
        <p style={{ margin: 0, display: "flex", alignItems: "flex-start", gap: 14, fontSize: wide ? 40 : 38, lineHeight: 1.2, color: color.ink }}>
          <ArrowRight width={40} height={40} strokeWidth={2} style={{ flex: "none", color: color.teal, marginTop: 2 }} />
          {edition.action}
        </p>
      </div>
    </div>
  );

  return wide ? (
    <div style={{ position: "absolute", inset: 0, padding: "56px 64px", display: "grid", gridTemplateColumns: "540px 1fr", gap: 64, alignItems: "start" }}>
      {topic}
      <div style={{ paddingTop: 64 }}>{reason}</div>
    </div>
  ) : (
    <div style={{ position: "absolute", inset: 0, padding: "44px 50px", display: "flex", flexDirection: "column", gap: 34 }}>
      {topic}
      {reason}
    </div>
  );
}

/* ================================================================ study */

export type OfferStudyCopy = {
  decisionLabel: string;
  decision: string;
  questionLabel: string;
  question: string;
  method: string;
  noise: string;
  draws: { label: string; groups: [string, string] };
  holds: { label: string; groups: [string, string] };
  quote: { text: string; source: string };
  answerLabel: string;
  answer: string;
  recommendation: string;
};

// Deterministic pseudo-random numbers, so every frame and every render agree.
const rand = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// 0 noise, 1-2 draws, 3-4 holds; the price cluster (3) is the biggest.
const DOTS: number[] = [
  ...Array.from({ length: 34 }, () => 0),
  ...Array.from({ length: 20 }, () => 1),
  ...Array.from({ length: 13 }, () => 2),
  ...Array.from({ length: 32 }, () => 3),
  ...Array.from({ length: 12 }, () => 4)
];
const ORDER = DOTS.map((_, i) => i).sort((a, b) => rand(a + 900) - rand(b + 900));

export function OfferStudyComposition({ copy }: { copy: OfferStudyCopy }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { wide } = useLayout();
  const askP = enter(frame, fps, 2, 18);
  const swap = interpolate(frame, [52, 70], [0, 1], { ...clamp, easing: easeInOut });
  const methodP = enter(frame, fps, 96, 16);
  const noiseOut = interpolate(frame, [124, 160], [0, 1], { ...clamp, easing: easeInOut });
  const noiseLabel = interpolate(frame, [116, 128, 152, 166], [0, 1, 1, 0], clamp);
  const sortP = interpolate(frame, [150, 214], [0, 1], { ...clamp, easing: easeInOut });
  const labelsP = enter(frame, fps, 184, 18);
  const groupsP = enter(frame, fps, 206, 18);
  const quoteP = enter(frame, fps, 226, 18);
  const answerP = enter(frame, fps, 254, 18);

  // Field and cluster geometry per layout.
  const field = wide ? { x: 820, y: 150, w: 1020, h: 600 } : { x: 60, y: 380, w: 960, h: 460 };
  const centers = wide
    ? [null, [1080, 330], [1080, 610], [1590, 350], [1590, 640]]
    : [null, [290, 515], [290, 735], [790, 525], [790, 772]];
  const counters = [0, 0, 0, 0, 0];
  const dots = DOTS.map((group, i) => {
    const n = counters[group]!++;
    const sx = field.x + 30 + rand(i) * (field.w - 60);
    const sy = field.y + 30 + rand(i + 50) * (field.h - 60);
    const appear = enter(frame, fps, 70 + ORDER.indexOf(i) * 0.35, 20);
    if (group === 0) {
      return { x: sx, y: sy, r: 11 * appear * (1 - noiseOut), fill: color.faint, opacity: appear * (1 - noiseOut) };
    }
    const c = centers[group]!;
    const angle = n * 2.39996;
    const radius = 19 * Math.sqrt(n + 0.6);
    const tx = c[0]! + Math.cos(angle) * radius;
    const ty = c[1]! + Math.sin(angle) * radius;
    const delay = rand(i + 300) * 0.25;
    const p = interpolate(sortP, [delay, delay + 0.75], [0, 1], { ...clamp, easing: easeInOut });
    const tone = group <= 2 ? color.teal : color.coral;
    return { x: sx + (tx - sx) * p, y: sy + (ty - sy) * p, r: 11 * appear, fill: p > 0.05 ? tone : "#b7c3c3", opacity: appear * (0.55 + 0.45 * p) };
  });

  const ask = (
    <div style={{ display: "grid" }}>
      {[
        { label: copy.decisionLabel, text: copy.decision, o: 1 - swap },
        { label: copy.questionLabel, text: copy.question, o: swap }
      ].map((s) => (
        <div key={s.label} style={{ gridArea: "1 / 1", opacity: s.o, transform: `translateY(${(1 - s.o) * 10}px)` }}>
          <p style={{ margin: 0, fontSize: 30, color: color.muted }}>{s.label}</p>
          <p style={{ margin: "10px 0 0", fontSize: wide ? 50 : 50, lineHeight: 1.14, color: color.ink, fontWeight: 500, textWrap: "balance" }}>{s.text}</p>
        </div>
      ))}
    </div>
  );

  const method = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 12, fontSize: 32, fontWeight: 500, padding: "14px 28px", borderRadius: 999, background: color.teal, color: "#fff", opacity: methodP, transform: `scale(${0.9 + 0.1 * methodP})` }}>
      <Journal width={32} height={32} strokeWidth={2} />
      {copy.method}
    </span>
  );

  const answer = (
    <div style={{ opacity: answerP, transform: `translateY(${(1 - answerP) * 24}px)` }}>
      <p style={{ margin: 0, fontSize: 30, fontWeight: 500, color: color.teal }}>{copy.answerLabel}</p>
      <p style={{ margin: "10px 0 0", fontSize: wide ? 46 : 44, lineHeight: 1.16, color: color.ink, textWrap: "balance" }}>{copy.answer}</p>
      <p style={{ margin: "18px 0 0", display: "flex", alignItems: "flex-start", gap: 12, fontSize: wide ? 34 : 32, lineHeight: 1.25, color: color.fg }}>
        <ArrowRight width={34} height={34} strokeWidth={2} style={{ flex: "none", color: color.teal, marginTop: 2 }} />
        {copy.recommendation}
      </p>
    </div>
  );

  const colLabel = (text: string, tone: string, x: number, y: number) => (
    <span style={{ position: "absolute", left: x, top: y, transform: "translateX(-50%)", whiteSpace: "nowrap", fontSize: wide ? 36 : 36, fontWeight: 500, color: tone, opacity: labelsP }}>{text}</span>
  );
  const groupLabel = (text: string, x: number, y: number, strong = false) => (
    <span style={{ position: "absolute", left: x, top: y, transform: `translate(-50%, ${(1 - groupsP) * 10}px)`, whiteSpace: "nowrap", fontSize: strong ? 34 : 30, fontWeight: strong ? 500 : 400, color: strong ? color.ink : color.fg, background: "rgba(255,255,255,0.92)", padding: "6px 18px", borderRadius: 999, boxShadow: "0 6px 18px rgba(10,10,10,0.08)", opacity: groupsP }}>
      {text}
    </span>
  );

  return (
    <AbsoluteFill style={{ opacity: fade(frame, PRODUCT_FRAMES.study), fontFamily: font }}>
      {wide ? (
        <>
          <div style={{ ...card, left: 80, top: 80, width: 640, padding: "40px 46px", opacity: askP, transform: `translateY(${(1 - askP) * 24}px)` }}>{ask}</div>
          <div style={{ position: "absolute", left: 80, top: 430 }}>{method}</div>
          <div style={{ ...card, left: 80, top: 560, width: 640, padding: "38px 46px", background: color.tealSoft, boxShadow: "none", opacity: answerP }}>{answer}</div>
        </>
      ) : (
        <>
          <div style={{ ...card, left: 50, right: 50, top: 40, padding: "34px 42px", minHeight: 230, opacity: askP, transform: `translateY(${(1 - askP) * 24}px)` }}>{ask}</div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 300, display: "flex", justifyContent: "center" }}>{method}</div>
          <div style={{ ...card, left: 50, right: 50, top: 1010, padding: "30px 40px", background: color.tealSoft, boxShadow: "none", opacity: answerP }}>{answer}</div>
        </>
      )}

      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }} aria-hidden>
        {dots.map((dot, i) => (
          <circle key={i} cx={dot.x} cy={dot.y} r={Math.max(0, dot.r)} fill={dot.fill} opacity={dot.opacity} />
        ))}
      </svg>

      <span style={{ position: "absolute", left: field.x + field.w / 2, top: field.y + field.h / 2 - 30, transform: "translateX(-50%)", whiteSpace: "nowrap", fontSize: 32, color: color.muted, background: "rgba(255,255,255,0.94)", padding: "12px 26px", borderRadius: 999, boxShadow: "0 8px 24px rgba(10,10,10,0.08)", opacity: noiseLabel }}>
        {copy.noise}
      </span>

      {wide ? (
        <>
          {colLabel(copy.draws.label, color.teal, 1080, 130)}
          {colLabel(copy.holds.label, color.coral, 1590, 130)}
          {groupLabel(copy.draws.groups[0], 1080, 432)}
          {groupLabel(copy.draws.groups[1], 1080, 690)}
          {groupLabel(copy.holds.groups[0], 1590, 482, true)}
          {groupLabel(copy.holds.groups[1], 1590, 722)}
        </>
      ) : (
        <>
          {colLabel(copy.draws.label, color.teal, 290, 380)}
          {colLabel(copy.holds.label, color.coral, 790, 380)}
          {groupLabel(copy.draws.groups[0], 290, 612)}
          {groupLabel(copy.draws.groups[1], 290, 812)}
          {groupLabel(copy.holds.groups[0], 790, 646, true)}
          {groupLabel(copy.holds.groups[1], 790, 848)}
        </>
      )}

      {wide ? (
        <div style={{ position: "absolute", left: 1090, width: 700, top: 800, opacity: quoteP, transform: `translateY(${(1 - quoteP) * 20}px)` }}>
          <Quote text={copy.quote.text} source={copy.quote.source} size={36} />
        </div>
      ) : (
        <div style={{ position: "absolute", left: 300, right: 50, top: 906, opacity: quoteP, transform: `translateY(${(1 - quoteP) * 16}px)` }}>
          <div style={{ background: color.bubble, borderRadius: "30px 10px 30px 30px", padding: "18px 26px", fontSize: 32, lineHeight: 1.2, color: color.ink, display: "flex", alignItems: "center", gap: 14 }}>
            <SourceIcon name={copy.quote.source} size={30} />“{copy.quote.text}”
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
}

/* ================================================================ plan */

export type OfferPlanCopy = {
  months: string[];
  reportLabel: string;
  studyLabel: string;
  decisionLabel: string;
  ready: string;
  moments: { month: number; label: string }[];
};

export function OfferPlanComposition({ copy }: { copy: OfferPlanCopy }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { wide } = useLayout();
  const run = interpolate(frame, [16, 272], [0, 11.6], clamp);
  const legendP = enter(frame, fps, 10, 18);

  // The report: a continuous line of conversation running along the year.
  const axis = wide ? { from: 140, to: 1780, at: 730 } : { from: 120, to: 1170, at: 210 };
  const step = (axis.to - axis.from) / 11;
  const pos = (m: number) => axis.from + m * step;
  const wave = (m: number) => Math.sin(m * 2.1) * 16 + Math.sin(m * 5.3 + 1) * 9 + Math.sin(m * 0.9) * 12;
  const samples = Array.from({ length: 111 }, (_, i) => i / 10).filter((m) => m <= run);
  const pathPts = samples.map((m) => (wide ? [pos(m), axis.at - 70 + wave(m)] : [axis.at + 70 + wave(m), pos(m)]));
  const path = pathPts.map(([x, y], i) => `${i ? "L" : "M"}${x!.toFixed(1)},${y!.toFixed(1)}`).join(" ");
  const headPt = pathPts[pathPts.length - 1];

  return (
    <AbsoluteFill style={{ opacity: fade(frame, PRODUCT_FRAMES.plan), fontFamily: font }}>
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }} aria-hidden>
        {wide ? (
          <line x1={axis.from} y1={axis.at} x2={axis.to} y2={axis.at} stroke={color.line} strokeWidth={4} strokeLinecap="round" />
        ) : (
          <line x1={axis.at} y1={axis.from} x2={axis.at} y2={axis.to} stroke={color.line} strokeWidth={4} strokeLinecap="round" />
        )}
        {copy.months.map((_, m) => {
          const on = run >= m;
          const [cx, cy] = wide ? [pos(m), axis.at] : [axis.at, pos(m)];
          return <circle key={m} cx={cx} cy={cy} r={on ? 9 : 7} fill={on ? color.teal : "#fff"} stroke={on ? color.teal : color.faint} strokeWidth={4} />;
        })}
        {samples.length > 1 ? <path d={path} fill="none" stroke={color.teal} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" /> : null}
        {/* every two weeks an edition of the report */}
        {Array.from({ length: 23 }, (_, k) => k / 2).filter((m) => m <= run).map((m) => {
          const [cx, cy] = wide ? [pos(m), axis.at - 70 + wave(m)] : [axis.at + 70 + wave(m), pos(m)];
          return <circle key={m} cx={cx} cy={cy} r={7} fill="#fff" stroke={color.teal} strokeWidth={4} />;
        })}
        {/* each study draws on what the report already saw in the weeks before the moment */}
        {copy.moments.map((moment) => {
          const p = interpolate(run, [moment.month - 0.95, moment.month - 0.55], [0, 1], clamp);
          const from = moment.month - 0.8;
          const [x1, y1] = wide ? [pos(from), axis.at - 70 + wave(from)] : [axis.at + 70 + wave(from), pos(from)];
          const [x2, y2] = wide ? [pos(moment.month), 486] : [axis.at + 180, pos(moment.month)];
          const d = wide ? `M${x1},${y1 - 14} C${x1},${y2 + 60} ${x2},${y2 + 70} ${x2},${y2}` : `M${x1 + 14},${y1} C${x2 - 60},${y1} ${x2 - 70},${y2} ${x2},${y2}`;
          return <path key={moment.label} d={d} fill="none" stroke={color.teal} strokeWidth={4} strokeDasharray="10 9" strokeLinecap="round" opacity={0.7 * p} />;
        })}
        {headPt && run < 11.5 ? <circle cx={headPt[0]} cy={headPt[1]} r={20} fill={color.cyan} opacity={0.35} /> : null}
      </svg>

      {copy.months.map((month, m) => (
        <span
          key={month}
          style={{
            position: "absolute",
            ...(wide ? { left: pos(m), top: axis.at + 30, transform: "translateX(-50%)" } : { right: 1080 - axis.at + 34, top: pos(m) - 20, textAlign: "right" }),
            fontSize: wide ? 28 : 30,
            color: run >= m ? color.fg : color.faint
          }}
        >
          {month}
        </span>
      ))}

      {copy.moments.map((moment) => {
        const studyP = interpolate(run, [moment.month - 0.95, moment.month - 0.55], [0, 1], { ...clamp, easing: easeOut });
        const flagP = interpolate(run, [moment.month - 0.1, moment.month + 0.25], [0, 1], { ...clamp, easing: easeOut });
        const readyP = interpolate(run, [moment.month - 0.05, moment.month + 0.3], [0, 1], clamp);
        if (wide) {
          const x = pos(moment.month);
          return (
            <div key={moment.label}>
              {/* the study grows out of the report line, then points at the decision */}
              <div style={{ ...card, left: x - 135, top: 376, width: 270, padding: "22px 24px", borderRadius: 28, opacity: studyP, transform: `translateY(${(1 - studyP) * 30}px)` }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 28, fontWeight: 500, color: color.teal }}>
                  <Journal width={30} height={30} strokeWidth={2} />
                  {copy.studyLabel}
                </span>
                <span style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, fontSize: 24, color: color.muted, opacity: readyP }}>
                  <Check width={26} height={26} strokeWidth={2.2} style={{ color: color.teal }} />
                  {copy.ready}
                </span>
              </div>
              <div style={{ position: "absolute", left: x - 2, top: 292, width: 4, height: 84 * flagP, background: color.ink, opacity: 0.18 }} />
              <div style={{ position: "absolute", left: x, top: 214, transform: `translate(-50%, ${(1 - flagP) * 16}px)`, opacity: flagP, display: "inline-flex", alignItems: "center", gap: 10, whiteSpace: "nowrap", padding: "14px 24px", borderRadius: 999, background: color.ink, color: "#fff", fontSize: 28, fontWeight: 500 }}>
                <DashFlag width={28} height={28} strokeWidth={2} />
                {moment.label}
              </div>
            </div>
          );
        }
        const y = pos(moment.month);
        return (
          <div key={moment.label}>
            <div style={{ ...card, left: axis.at + 180, top: y - 50, width: 290, padding: "18px 22px", borderRadius: 26, opacity: studyP, transform: `translateX(${(1 - studyP) * -24}px)` }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 28, fontWeight: 500, color: color.teal }}>
                <Journal width={30} height={30} strokeWidth={2} />
                {copy.studyLabel}
              </span>
              <span style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, fontSize: 24, color: color.muted, opacity: readyP }}>
                <Check width={26} height={26} strokeWidth={2.2} style={{ color: color.teal }} />
                {copy.ready}
              </span>
            </div>
            <div style={{ position: "absolute", left: axis.at + 480, top: y - 2, height: 4, width: 50 * flagP, background: color.ink, opacity: 0.18 }} />
            <div style={{ position: "absolute", left: axis.at + 540, top: y, transform: `translate(${(1 - flagP) * -16}px, -50%)`, opacity: flagP, display: "inline-flex", alignItems: "center", gap: 10, whiteSpace: "nowrap", padding: "14px 24px", borderRadius: 999, background: color.ink, color: "#fff", fontSize: 30, fontWeight: 500 }}>
              <DashFlag width={30} height={30} strokeWidth={2} />
              {moment.label}
            </div>
          </div>
        );
      })}

      <Legend copy={copy} style={{ position: "absolute", opacity: legendP, ...(wide ? { left: 140, top: 890 } : { left: 70, right: 70, top: 1220, justifyContent: "center" }) }} />
    </AbsoluteFill>
  );
}

function Legend({ copy, style }: { copy: OfferPlanCopy; style: CSSProperties }) {
  const item = (mark: ReactNode, text: string) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
      {mark}
      {text}
    </span>
  );
  return (
    <div style={{ display: "flex", gap: 40, fontSize: 28, color: color.muted, ...style }}>
      {item(<span style={{ width: 44, height: 7, borderRadius: 4, background: color.teal }} />, copy.reportLabel)}
      {item(<Journal width={30} height={30} strokeWidth={2} style={{ color: color.teal }} />, copy.studyLabel)}
      {item(<DashFlag width={30} height={30} strokeWidth={2} style={{ color: color.ink }} />, copy.decisionLabel)}
    </div>
  );
}

"use client";
/* eslint-disable @next/next/no-img-element -- the logo inside fixed-size mockups */

import type { CSSProperties, ReactNode } from "react";
import { Calendar, ChatLines, Filter, Home, Microphone, NavArrowDown, OpenNewWindow, Settings, StatsUpSquare, User, VideoCamera } from "iconoir-react";
import { SourceIcon } from "@/components/brand/SourceMark";
import { LOGO_RATIO } from "@/components/brand/Logo";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "./runtime";
import { color, font } from "./theme";
import { clamp, enter } from "./util";

/**
 * The formats a finding can take on the Solutions page (live presentation, document with the
 * evidence, online dashboard), as small animated mockups. Each one lays itself out for a wide
 * canvas (desktop, beside the list of formats) or a tall one (phones). Content is illustrative.
 */

export const FORMAT_CANVAS = {
  wide: { width: 1200, height: 1000 },
  tall: { width: 1000, height: 1250 }
} as const;

export const FORMAT_FRAMES = 300;

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const fade = (frame: number) => interpolate(frame, [FORMAT_FRAMES - 20, FORMAT_FRAMES - 2], [1, 0], clamp);

function useWideCanvas() {
  const { width, height } = useVideoConfig();
  return width > height;
}

const win: CSSProperties = { position: "absolute", background: "#fff", borderRadius: 30, boxShadow: "0 2px 0 rgba(10,10,10,0.03), 0 30px 80px rgba(10,10,10,0.12)", overflow: "hidden", fontFamily: font };

function Logo({ width }: { width: number }) {
  return <img src="/brand/noisia.svg" alt="" width={width} height={Math.round(width / LOGO_RATIO)} style={{ display: "block" }} />;
}

function Bubble({ text, source, meta, size, tone = color.bubble, corner = "left", style }: { text: string; source?: string; meta?: string; size: number; tone?: string; corner?: "left" | "right"; style?: CSSProperties }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: corner === "left" ? "flex-start" : "flex-end", gap: 8, ...style }}>
      <div style={{ background: tone, borderRadius: corner === "left" ? `${size}px ${size}px ${size}px 8px` : `${size}px ${size}px 8px ${size}px`, padding: `${size * 0.5}px ${size * 0.7}px`, fontSize: size, lineHeight: 1.24, color: color.ink, textWrap: "balance" }}>{text}</div>
      {source || meta ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: size * 0.7, color: color.muted, padding: "0 6px" }}>
          {source ? <SourceIcon name={source} size={Math.round(size * 0.78)} /> : null}
          {source ? <span>{source}</span> : null}
          {meta ? <span>{source ? "· " : ""}{meta}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

/* ================================================================ live */

export type LiveFormatCopy = {
  badge: string;
  meeting: string;
  slide: string;
  bars: [string, string, string];
  people: [string, string, string];
  questionsLabel: string;
  question: string;
  answer: string;
};

export function LiveFormat({ copy }: { copy: LiveFormatCopy }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const wide = useWideCanvas();
  const s = wide ? 1 : 1.25;
  const box = wide ? { left: 30, top: 70, width: 1140, height: 860 } : { left: 24, top: 40, width: 952, height: 1170 };
  const slide = wide ? { left: 26, top: 102, width: 760, height: 428 } : { left: 22, top: 100, width: 908, height: 511 };
  const tiles = wide ? { left: 810, top: 102, width: 304, height: 428, dir: "column" as const } : { left: 22, top: 634, width: 908, height: 170, dir: "row" as const };
  const qa = wide ? { left: 26, top: 556, width: 1088, height: 278 } : { left: 22, top: 828, width: 908, height: 320 };
  const bars = [0.84, 0.52, 0.34];
  const pointer = interpolate(frame, [70, 104], [0, 1], { ...clamp, easing: easeInOut });
  const q = enter(frame, fps, 120, 18);
  const a = enter(frame, fps, 168, 18);
  const seconds = 12 * 60 + 48 + Math.floor(frame / 30);
  const timer = `00:${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const pulse = 0.55 + 0.45 * Math.abs(Math.sin(frame / 9));
  const barRowTop = slide.top + (wide ? 160 : 190);
  const rowGap = wide ? 82 : 100;

  return (
    <AbsoluteFill style={{ opacity: fade(frame) }}>
      <div style={{ ...win, ...box, background: "#fbfcfc" }}>
        <div style={{ height: 76, display: "flex", alignItems: "center", gap: 18, padding: "0 24px", background: "#fff", borderBottom: `2px solid ${color.line}` }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "8px 18px", borderRadius: 999, background: color.coralSoft, color: color.coral, fontSize: 24 * s, fontWeight: 500 }}>
            <span style={{ width: 14, height: 14, borderRadius: 7, background: color.coral, opacity: pulse }} />
            {copy.badge}
          </span>
          <span style={{ fontSize: 26 * s, color: color.ink, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{copy.meeting}</span>
          <span style={{ marginLeft: "auto", fontSize: 22 * s, color: color.muted, fontVariantNumeric: "tabular-nums" }}>{timer}</span>
          {wide
            ? [Microphone, VideoCamera].map((Icon, k) => (
                <span key={k} style={{ width: 46, height: 46, borderRadius: 23, background: color.track, display: "grid", placeItems: "center", color: color.fg }}>
                  <Icon width={24} height={24} strokeWidth={1.8} />
                </span>
              ))
            : null}
        </div>

        {/* the slide being presented */}
        <div style={{ position: "absolute", ...slide, borderRadius: 20, background: "#fff", border: `2px solid ${color.line}`, padding: wide ? "34px 40px" : "40px 46px" }}>
          <p style={{ margin: 0, fontSize: 38 * s, lineHeight: 1.1, fontWeight: 500, color: color.ink }}>{copy.slide}</p>
          <div style={{ position: "absolute", right: wide ? 36 : 42, top: wide ? 40 : 48 }}>
            <Logo width={wide ? 96 : 120} />
          </div>
        </div>
        {copy.bars.map((bar, k) => {
          const grow = interpolate(frame, [18 + k * 10, 58 + k * 10], [0, 1], { ...clamp, easing: easeOut });
          const tone = k === 1 ? color.coral : color.teal;
          return (
            <div key={bar} style={{ position: "absolute", left: slide.left + (wide ? 40 : 46), width: slide.width - (wide ? 80 : 92), top: barRowTop + k * rowGap, display: "grid", gridTemplateColumns: `${wide ? 170 : 210}px 1fr`, alignItems: "center", gap: 18 }}>
              <span style={{ fontSize: 26 * s, color: color.fg }}>{bar}</span>
              <div style={{ height: 26 * s, borderRadius: 13 * s, background: color.track }}>
                <div style={{ width: `${bars[k]! * grow * 100}%`, height: "100%", borderRadius: 13 * s, background: tone }} />
              </div>
            </div>
          );
        })}
        {/* the presenter's pointer lands on the bar that matters */}
        <span
          style={{
            position: "absolute",
            left: slide.left + slide.width * (0.62 - 0.12 * pointer),
            top: barRowTop + rowGap + 13 * s - 14 - (1 - pointer) * 120,
            width: 28,
            height: 28,
            borderRadius: 14,
            background: color.red,
            boxShadow: `0 0 0 10px rgba(238,11,0,0.16), 0 0 26px rgba(238,11,0,0.5)`,
            opacity: interpolate(frame, [60, 72, 200, 214], [0, 1, 1, 0], clamp)
          }}
        />

        <div style={{ position: "absolute", ...tiles, display: "flex", flexDirection: tiles.dir, gap: 14 }}>
          {copy.people.map((name, k) => {
            const speaking = k === 0 ? frame < 116 || frame > 156 : k === 1 && frame >= 116 && frame <= 156;
            return (
              <div key={name} style={{ flex: 1, position: "relative", borderRadius: 18, background: ["#e9f4f4", "#f1f1f1", "#eef0f3"][k], boxShadow: speaking ? `inset 0 0 0 4px ${color.teal}` : "none", display: "grid", placeItems: "center" }}>
                <span style={{ width: 76 * s, height: 76 * s, borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center", color: k === 0 ? color.teal : color.muted }}>
                  <User width={40 * s} height={40 * s} strokeWidth={1.6} />
                </span>
                <span style={{ position: "absolute", left: 12, bottom: 10, fontSize: 20 * s, color: color.fg, background: "rgba(255,255,255,0.9)", padding: "4px 12px", borderRadius: 999, display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {speaking ? (
                    <span style={{ display: "inline-flex", alignItems: "flex-end", gap: 3, height: 16 }}>
                      {[0, 1, 2].map((b) => (
                        <span key={b} style={{ width: 4, borderRadius: 2, background: color.teal, height: 5 + 11 * Math.abs(Math.sin(frame / 4 + b * 1.3)) }} />
                      ))}
                    </span>
                  ) : null}
                  {name}
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ position: "absolute", ...qa, borderRadius: 20, background: "#fff", border: `2px solid ${color.line}`, padding: "20px 26px" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 22 * s, fontWeight: 500, color: color.muted }}>
            <ChatLines width={26 * s} height={26 * s} strokeWidth={1.8} />
            {copy.questionsLabel}
          </span>
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <Bubble text={copy.question} meta={copy.people[1]} size={26 * s} style={{ opacity: q, transform: `translateY(${(1 - q) * 14}px)`, maxWidth: "78%" }} />
            <Bubble text={copy.answer} meta={copy.people[0]} size={26 * s} tone={color.tealSoft} corner="right" style={{ opacity: a, transform: `translateY(${(1 - a) * 14}px)`, alignSelf: "flex-end", maxWidth: "78%" }} />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

/* ================================================================ document */

export type DocumentFormatCopy = {
  kicker: string;
  title: string;
  drawsLabel: string;
  holdsLabel: string;
  draws: [string, string];
  holds: [string, string];
  quote: string;
  source: string;
  date: string;
  footnote: string;
  evidenceLabel: string;
  evidence: string;
  open: string;
  recsLabel: string;
  recs: [string, string];
};

export function DocumentFormat({ copy }: { copy: DocumentFormatCopy }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const wide = useWideCanvas();
  const s = wide ? 1 : 1.18;
  const page = wide ? { left: 90, top: 56, width: 640, height: 890 } : { left: 70, top: 40, width: 740, height: 1010 };
  const evidence = wide ? { left: 690, top: 420, width: 470 } : { left: 290, top: 850, width: 570 };
  const pageP = enter(frame, fps, 0, 20);
  const mark = interpolate(frame, [96, 128], [0, 1], { ...clamp, easing: easeInOut });
  const evP = enter(frame, fps, 132, 18);
  const columns = [
    { label: copy.drawsLabel, items: copy.draws, tone: color.teal, values: [0.78, 0.46] },
    { label: copy.holdsLabel, items: copy.holds, tone: color.coral, values: [0.88, 0.4] }
  ];

  return (
    <AbsoluteFill style={{ opacity: fade(frame), fontFamily: font }}>
      {/* the page behind gives the document its thickness */}
      <div style={{ ...win, ...page, borderRadius: 14, transform: `translate(${34 * pageP}px, ${14 * pageP}px) rotate(${3 * pageP}deg)`, boxShadow: "0 18px 50px rgba(10,10,10,0.08)" }} />
      <div style={{ ...win, ...page, borderRadius: 14, padding: wide ? "46px 50px" : "54px 58px", opacity: pageP, transform: `translateY(${(1 - pageP) * 30}px)` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
          <Logo width={wide ? 108 : 128} />
          <span style={{ fontSize: 19 * s, color: color.muted }}>{copy.kicker}</span>
        </div>
        <p style={{ margin: `${wide ? 40 : 48}px 0 0`, fontSize: 40 * s, lineHeight: 1.1, fontWeight: 500, color: color.ink, textWrap: "balance" }}>{copy.title}</p>
        <div style={{ marginTop: wide ? 34 : 40, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
          {columns.map((col) => (
            <div key={col.label}>
              <p style={{ margin: 0, fontSize: 22 * s, fontWeight: 500, color: col.tone }}>{col.label}</p>
              {col.items.map((item, k) => {
                const grow = interpolate(frame, [24 + k * 10, 64 + k * 10], [0, 1], { ...clamp, easing: easeOut });
                return (
                  <div key={item} style={{ marginTop: 16 }}>
                    <span style={{ fontSize: 22 * s, color: color.fg }}>{item}</span>
                    <div style={{ marginTop: 8, height: 14 * s, borderRadius: 8, background: color.track }}>
                      <div style={{ width: `${col.values[k]! * grow * 100}%`, height: "100%", borderRadius: 8, background: col.tone }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {/* the quote, highlighted as if someone were reading it */}
        <div style={{ marginTop: wide ? 40 : 50, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ position: "relative", alignSelf: "flex-start", maxWidth: "92%", background: color.bubble, borderRadius: "26px 26px 26px 8px", padding: `${14 * s}px ${20 * s}px`, fontSize: 26 * s, lineHeight: 1.25, color: color.ink }}>
            <span style={{ backgroundImage: `linear-gradient(${color.cyan}55, ${color.cyan}55)`, backgroundRepeat: "no-repeat", backgroundSize: `${mark * 100}% 100%`, borderRadius: 4, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}>“{copy.quote}”</span>
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 14, fontSize: 18 * s, color: color.muted, paddingLeft: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <SourceIcon name={copy.source} size={Math.round(20 * s)} />
              {copy.source}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Calendar width={18 * s} height={18 * s} strokeWidth={1.8} />
              {copy.date}
            </span>
          </span>
        </div>
        <div style={{ marginTop: wide ? 38 : 48 }}>
          <p style={{ margin: 0, fontSize: 22 * s, fontWeight: 500, color: color.teal }}>{copy.recsLabel}</p>
          {copy.recs.map((rec, k) => {
            const p = enter(frame, fps, 60 + k * 10, 18);
            return (
              <p key={rec} style={{ margin: "12px 0 0", display: "flex", gap: 12, alignItems: "flex-start", fontSize: 23 * s, lineHeight: 1.3, color: color.fg, opacity: p }}>
                <span style={{ flex: "none", width: 30 * s, height: 30 * s, borderRadius: "50%", background: color.tealSoft, color: color.teal, display: "grid", placeItems: "center", fontSize: 17 * s, fontWeight: 500 }}>{k + 1}</span>
                {rec}
              </p>
            );
          })}
        </div>
        <div style={{ position: "absolute", left: wide ? 50 : 58, right: wide ? 50 : 58, bottom: wide ? 34 : 40, display: "flex", justifyContent: "space-between", fontSize: 17 * s, color: color.faint, borderTop: `2px solid ${color.track}`, paddingTop: 14 }}>
          <span>{copy.footnote}</span>
          <span>12</span>
        </div>
      </div>

      {/* the original mention, one tap away from the quote */}
      <div style={{ ...win, ...evidence, borderRadius: 26, padding: wide ? "26px 30px" : "28px 32px", opacity: evP, transform: `translate(${(1 - evP) * 40}px, 0)` }}>
        <p style={{ margin: 0, fontSize: 22 * s, fontWeight: 500, color: color.teal }}>{copy.evidenceLabel}</p>
        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ width: 52 * s, height: 52 * s, borderRadius: "50%", background: color.track, display: "grid", placeItems: "center" }}>
            <SourceIcon name={copy.source} size={Math.round(28 * s)} />
          </span>
          <span style={{ display: "flex", flexDirection: "column", fontSize: 20 * s, color: color.muted, lineHeight: 1.3 }}>
            <strong style={{ color: color.ink, fontWeight: 500, fontSize: 22 * s }}>{copy.source}</strong>
            {copy.date}
          </span>
        </div>
        <p style={{ margin: "16px 0 0", fontSize: 24 * s, lineHeight: 1.35, color: color.fg }}>{copy.evidence}</p>
        <span style={{ marginTop: 18, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 20 * s, fontWeight: 500, color: color.teal }}>
          {copy.open}
          <OpenNewWindow width={20 * s} height={20 * s} strokeWidth={2} />
        </span>
      </div>
    </AbsoluteFill>
  );
}

/* ================================================================ dashboard */

export type DashboardFormatCopy = {
  filters: [string, string][];
  title: string;
  xLabel: string;
  yLabel: string;
  quadrants: [string, string, string, string];
  bubbles: { name: string; x: number; y: number; size: number; tone: "teal" | "coral" | "grey" }[];
  listTitle: string;
  items: [string, string][];
  tooltip: { topic: string; stage: string; quote: string; source: string };
};

const TONES = { teal: color.teal, coral: color.coral, grey: "#a9b6b6" };

export function DashboardFormat({ copy }: { copy: DashboardFormatCopy }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const wide = useWideCanvas();
  const s = wide ? 1 : 1.2;
  const box = wide ? { left: 24, top: 50, width: 1152, height: 900 } : { left: 20, top: 30, width: 960, height: 1190 };
  const side = wide ? 84 : 0;
  const map = wide ? { left: side + 20, top: 150, width: 640, height: 730 } : { left: 20, top: 170, width: 920, height: 640 };
  const list = wide ? { left: side + 680, top: 150, width: box.width - side - 700, height: 730 } : { left: 20, top: 830, width: 920, height: 340 };
  const plot = wide ? { x: 70, y: 96, w: 540, h: 560 } : { x: 80, y: 96, w: 800, h: 470 };
  const target = copy.bubbles.find((b) => b.name === copy.tooltip.topic) ?? copy.bubbles[0]!;
  const tx = map.left + plot.x + target.x * plot.w;
  const ty = map.top + plot.y + (1 - target.y) * plot.h;
  const cursor = interpolate(frame, [104, 140], [0, 1], { ...clamp, easing: easeInOut });
  const tip = enter(frame, fps, 142, 18);
  const sel = interpolate(frame, [138, 150], [0, 1], clamp);
  const items = wide ? copy.items : copy.items.slice(0, 3);
  const stageTone = (k: number) => [color.teal, "#c98200", color.teal, color.muted][k] ?? color.muted;

  return (
    <AbsoluteFill style={{ opacity: fade(frame), fontFamily: font }}>
      <div style={{ ...win, ...box, background: "#f5f7f7" }}>
        <div style={{ height: 58, background: "#fff", borderBottom: `2px solid ${color.line}`, display: "flex", alignItems: "center", gap: 12, padding: "0 24px" }}>
          {["#f26b5b", "#f5c04a", "#5ac36b"].map((c) => (
            <span key={c} style={{ width: 15, height: 15, borderRadius: 8, background: c }} />
          ))}
          <span style={{ marginLeft: 18 }}>
            <Logo width={wide ? 104 : 124} />
          </span>
        </div>
        {wide ? (
          <div style={{ position: "absolute", left: 0, top: 58, bottom: 0, width: side, background: "#fff", borderRight: `2px solid ${color.line}`, display: "flex", flexDirection: "column", alignItems: "center", gap: 18, paddingTop: 24 }}>
            {[Home, StatsUpSquare, ChatLines, Filter, Settings].map((Icon, k) => (
              <span key={k} style={{ width: 50, height: 50, borderRadius: 14, display: "grid", placeItems: "center", background: k === 1 ? color.tealSoft : "transparent", color: k === 1 ? color.teal : color.muted }}>
                <Icon width={26} height={26} strokeWidth={1.8} />
              </span>
            ))}
          </div>
        ) : null}

        <div style={{ position: "absolute", left: side + 20, top: 76, right: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
          {copy.filters.map(([label, value], k) => (
            <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 10, height: 50 * s, padding: `0 ${16 * s}px`, borderRadius: 999, background: "#fff", border: `2px solid ${color.line}`, fontSize: 20 * s, color: color.fg, whiteSpace: "nowrap" }}>
              <span style={{ color: color.muted }}>{label}</span>
              {k === 1 ? (
                <span style={{ display: "inline-flex", gap: 6 }}>
                  {["TikTok", "Instagram", "X"].map((p) => (
                    <SourceIcon key={p} name={p} size={Math.round(20 * s)} />
                  ))}
                </span>
              ) : k === 2 ? (
                <Calendar width={20 * s} height={20 * s} strokeWidth={1.8} />
              ) : null}
              <strong style={{ fontWeight: 500, color: color.ink }}>{value}</strong>
              <NavArrowDown width={18 * s} height={18 * s} strokeWidth={2} style={{ color: color.muted }} />
            </span>
          ))}
        </div>

        {/* topic map: volume against growth, the stage of every topic at a glance */}
        <div style={{ position: "absolute", ...map, background: "#fff", borderRadius: 20, border: `2px solid ${color.line}` }}>
          <p style={{ margin: 0, position: "absolute", left: 24, top: 22, fontSize: 24 * s, fontWeight: 500, color: color.ink }}>{copy.title}</p>
          <svg width={map.width} height={map.height} style={{ position: "absolute", inset: 0 }} aria-hidden>
            <line x1={plot.x} y1={plot.y + plot.h} x2={plot.x + plot.w} y2={plot.y + plot.h} stroke={color.line} strokeWidth={3} />
            <line x1={plot.x} y1={plot.y} x2={plot.x} y2={plot.y + plot.h} stroke={color.line} strokeWidth={3} />
            <line x1={plot.x + plot.w / 2} y1={plot.y} x2={plot.x + plot.w / 2} y2={plot.y + plot.h} stroke={color.line} strokeWidth={2} strokeDasharray="8 10" />
            <line x1={plot.x} y1={plot.y + plot.h / 2} x2={plot.x + plot.w} y2={plot.y + plot.h / 2} stroke={color.line} strokeWidth={2} strokeDasharray="8 10" />
            {[
              { t: copy.quadrants[0], x: plot.x + 14, y: plot.y + 28, a: "start" as const },
              { t: copy.quadrants[1], x: plot.x + plot.w - 14, y: plot.y + 28, a: "end" as const },
              { t: copy.quadrants[2], x: plot.x + plot.w - 14, y: plot.y + plot.h - 16, a: "end" as const },
              { t: copy.quadrants[3], x: plot.x + 14, y: plot.y + plot.h - 16, a: "start" as const }
            ].map((q) => (
              <text key={q.t} x={q.x} y={q.y} textAnchor={q.a} fontSize={18 * s} fill={color.faint} fontFamily="inherit">
                {q.t}
              </text>
            ))}
            {copy.bubbles.map((b, k) => {
              const p = enter(frame, fps, 14 + k * 9, 14);
              const cx = plot.x + b.x * plot.w;
              const cy = plot.y + (1 - b.y) * plot.h + Math.sin(frame / 22 + k) * 2;
              const r = (16 + b.size * 40) * s * p;
              const chosen = b.name === target.name;
              return (
                <g key={b.name}>
                  <circle cx={cx} cy={cy} r={Math.max(0, r)} fill={TONES[b.tone]} opacity={0.2} />
                  <circle cx={cx} cy={cy} r={Math.max(0, r * 0.34)} fill={TONES[b.tone]} />
                  {chosen ? <circle cx={cx} cy={cy} r={Math.max(0, r + 8)} fill="none" stroke={color.ink} strokeWidth={3} opacity={sel} /> : null}
                  <text x={cx} y={cy - r - 10} textAnchor="middle" fontSize={19 * s} fill={color.fg} opacity={p} fontFamily="inherit">
                    {b.name}
                  </text>
                </g>
              );
            })}
            <text x={plot.x + plot.w} y={plot.y + plot.h + 32} textAnchor="end" fontSize={18 * s} fill={color.muted} fontFamily="inherit">
              {copy.xLabel} →
            </text>
            <text x={plot.x - 16} y={plot.y + 6} textAnchor="end" fontSize={18 * s} fill={color.muted} fontFamily="inherit" transform={`rotate(-90 ${plot.x - 16} ${plot.y + 6})`}>
              {copy.yLabel} →
            </text>
          </svg>
        </div>

        <div style={{ position: "absolute", ...list, background: "#fff", borderRadius: 20, border: `2px solid ${color.line}`, padding: "22px 24px" }}>
          <p style={{ margin: 0, fontSize: 24 * s, fontWeight: 500, color: color.ink }}>{copy.listTitle}</p>
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column" }}>
            {items.map(([topic, stage], k) => {
              const draw = interpolate(frame, [30 + k * 12, 80 + k * 12], [0, 1], { ...clamp, easing: easeOut });
              const pts = [0, 1, 2, 3, 4, 5, 6].map((i) => [i * 20, 34 - (i * (4.2 - k) + [2, 6, 3, 8, 6, 10, 9][i]!) * (k === 3 ? 0.5 : 0.85)] as const);
              const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x},${y.toFixed(1)}`).join(" ");
              return (
                <div key={topic} style={{ display: "flex", flexDirection: wide ? "column" : "row", alignItems: wide ? "stretch" : "center", justifyContent: "space-between", gap: wide ? 10 : 16, padding: `${wide ? 16 : 14}px 0`, borderTop: k ? `2px solid ${color.track}` : "none" }}>
                  <span style={{ fontSize: 22 * s, color: color.ink, lineHeight: 1.2, flex: wide ? undefined : 1 }}>{topic}</span>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                    <span style={{ fontSize: 17 * s, fontWeight: 500, color: stageTone(k), padding: "4px 12px", borderRadius: 999, border: `2px solid ${stageTone(k)}`, whiteSpace: "nowrap" }}>{stage}</span>
                    <svg width={124} height={40} viewBox="0 0 124 40" style={{ overflow: "visible" }} aria-hidden>
                      <path d={line} fill="none" stroke={color.teal} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
                    </svg>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* the reader points at a topic and gets what people actually said */}
        <svg width={40} height={40} viewBox="0 0 24 24" style={{ position: "absolute", left: tx + 14 + (1 - cursor) * 220, top: ty + 10 + (1 - cursor) * 180, opacity: interpolate(frame, [96, 106, 250, 262], [0, 1, 1, 0], clamp), filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.25))" }} aria-hidden>
          <path d="M4 2l15 9.5-6.6 1.4 3.9 7.3-2.8 1.5-3.9-7.3L4.8 19z" fill={color.ink} stroke="#fff" strokeWidth={1.4} strokeLinejoin="round" />
        </svg>
        <Tip copy={copy.tooltip} s={s} style={{ position: "absolute", left: Math.min(tx + 30, box.width - (wide ? 430 : 520)), top: ty + 56, width: wide ? 400 : 500, opacity: tip, transform: `translateY(${(1 - tip) * 14}px)` }} />
      </div>
    </AbsoluteFill>
  );
}

function Tip({ copy, s, style }: { copy: DashboardFormatCopy["tooltip"]; s: number; style: CSSProperties }) {
  return (
    <div style={{ background: "#fff", borderRadius: 20, boxShadow: "0 20px 50px rgba(10,10,10,0.16)", border: `2px solid ${color.line}`, padding: "18px 20px", ...style }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <strong style={{ fontSize: 22 * s, fontWeight: 500, color: color.ink }}>{copy.topic}</strong>
        <span style={{ fontSize: 16 * s, fontWeight: 500, color: color.teal, background: color.tealSoft, padding: "4px 12px", borderRadius: 999 }}>{copy.stage}</span>
      </span>
      <Bubble text={copy.quote} source={copy.source} size={21 * s} style={{ marginTop: 14 }} />
    </div>
  );
}

/** Lets a parent drop any of the three mockups by key. */
export function FormatMock({ kind, copy }: { kind: "live" | "document" | "dashboard"; copy: { live: LiveFormatCopy; document: DocumentFormatCopy; dashboard: DashboardFormatCopy } }): ReactNode {
  if (kind === "live") return <LiveFormat copy={copy.live} />;
  if (kind === "document") return <DocumentFormat copy={copy.document} />;
  return <DashboardFormat copy={copy.dashboard} />;
}

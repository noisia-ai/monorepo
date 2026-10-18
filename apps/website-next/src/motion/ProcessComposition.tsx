"use client";

import { Fragment, type ComponentType, type SVGProps } from "react";
import { ChatLines, Filter, LightBulb, Search, UserBadgeCheck, Network } from "iconoir-react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "./runtime";
import { color, font } from "./theme";

/**
 * "From question to answer": the whole pipeline in one loop. Mentions arrive from the
 * question, noise falls out, duplicates merge, the core of the conversation groups into
 * topics, a person approves, and the answer links back to the mention that proves it.
 * Ported from the 2026 partner deck, rebuilt on the Noisia runtime, in two layouts.
 */

export const PROCESS_FRAMES = 450;

export type ProcessCopy = {
  asks: string;
  question: string;
  clusters: [string, string, string, string, string, string];
  stages: [string, string, string];
  steps: [string, string, string, string, string];
  human: string;
  answer: string;
  linked: string;
};

type Point = { x: number; y: number };
type Layout = {
  width: number;
  height: number;
  field: { x: number; y: number; w: number; h: number };
  clusters: Point[];
  spread: number;
  question: { x: number; y: number; w: number };
  spawn: Point;
  answer: { x: number; y: number; w: number };
  trace: (target: Point) => string;
  stepper: { y: number; x0: number; x1: number; labels: "all" | "active" };
  type: { question: number; label: number; step: number; stage: number; cluster: number };
};

export const LAYOUTS: Record<"wide" | "tall", Layout> = {
  wide: {
    width: 1720,
    height: 730,
    field: { x: 360, y: 24, w: 900, h: 500 },
    clusters: [
      { x: 520, y: 150 },
      { x: 810, y: 128 },
      { x: 1090, y: 165 },
      { x: 590, y: 380 },
      { x: 870, y: 360 },
      { x: 1120, y: 395 }
    ],
    spread: 62,
    question: { x: 10, y: 120, w: 300 },
    spawn: { x: 300, y: 230 },
    answer: { x: 1336, y: 80, w: 350 },
    trace: (t) => `M 1336 372 C 1290 372, 1300 548, 1100 548 S ${t.x + 40} ${t.y + 120}, ${t.x} ${t.y}`,
    stepper: { y: 560, x0: 150, x1: 1550, labels: "all" },
    type: { question: 25, label: 17, step: 20, stage: 30, cluster: 19 }
  },
  tall: {
    width: 1080,
    height: 1440,
    field: { x: 60, y: 300, w: 960, h: 620 },
    clusters: [
      { x: 230, y: 450 },
      { x: 540, y: 420 },
      { x: 850, y: 455 },
      { x: 250, y: 740 },
      { x: 540, y: 715 },
      { x: 830, y: 750 }
    ],
    spread: 70,
    question: { x: 60, y: 40, w: 960 },
    spawn: { x: 540, y: 250 },
    answer: { x: 60, y: 960, w: 960 },
    trace: (t) => `M 160 960 C 160 900, ${t.x - 30} ${t.y + 140}, ${t.x} ${t.y}`,
    stepper: { y: 1290, x0: 130, x1: 950, labels: "active" },
    type: { question: 44, label: 28, step: 30, stage: 42, cluster: 28 }
  }
};

const HIGHLIGHT = 3;
const N = 520;
const HUMAN_STEPS = [0, 3, 4];
const STEP_FROM = [0, 50, 140, 225, 320];
const ICONS: ComponentType<SVGProps<SVGSVGElement>>[] = [Search, ChatLines, Filter, Network, LightBulb];
const EASE = (t: number) => 1 - Math.pow(1 - t, 3);
const EASE_IO = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function tween(f: number, a: number, b: number, from = 0, to = 1, ease = EASE) {
  return interpolate(f, [a, b], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Dot = { x: number; y: number; kind: "ok" | "dup" | "noise"; core: boolean; c: number; cx: number; cy: number; t0: number; twin: number };

function makeDots(layout: Layout, count: number): Dot[] {
  const r = rng(7);
  const { field, clusters, spread } = layout;
  const out: Dot[] = [];
  for (let i = 0; i < count; i++) {
    const roll = r();
    const kind: Dot["kind"] = roll < 0.12 ? "noise" : roll < 0.3 && i > 10 ? "dup" : "ok";
    let x = field.x + 24 + r() * (field.w - 48);
    let y = field.y + 24 + r() * (field.h - 48);
    let twin = -1;
    if (kind === "dup") {
      twin = Math.floor(r() * i);
      x = out[twin]!.x + (r() - 0.5) * 26;
      y = out[twin]!.y + (r() - 0.5) * 26;
    }
    const core = kind === "ok" && r() < 0.62;
    const c = Math.floor(r() * clusters.length);
    const ang = r() * Math.PI * 2;
    const rad = Math.sqrt(r()) * spread;
    out.push({ x, y, kind, core, c, cx: clusters[c]!.x + Math.cos(ang) * rad, cy: clusters[c]!.y + Math.sin(ang) * rad * 0.8, t0: 52 + r() * 80, twin });
  }
  return out;
}

// Fewer points on the phone layout: same story, lighter on the GPU.
const DOTS = { wide: makeDots(LAYOUTS.wide, N), tall: makeDots(LAYOUTS.tall, 340) };

function Card({ x, y, w, soft, children, style }: { x: number; y: number; w: number; soft?: boolean; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        padding: 26,
        borderRadius: 24,
        background: soft ? color.tealSoft : "#fff",
        border: `1.5px solid ${soft ? "#cdeeee" : color.line}`,
        boxShadow: soft ? "none" : "0 14px 40px rgba(10,10,10,0.06)",
        fontFamily: font,
        ...style
      }}
    >
      {children}
    </div>
  );
}

export function ProcessComposition({ copy, variant }: { copy: ProcessCopy; variant: "wide" | "tall" }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = LAYOUTS[variant];
  const dots = DOTS[variant];
  const traceIndex = dots.findIndex((d) => d.core && d.c === HIGHLIGHT);
  const fade = tween(f, PROCESS_FRAMES - 22, PROCESS_FRAMES, 1, 0, EASE_IO);
  const step = STEP_FROM.reduce((acc, from, i) => (f >= from ? i : acc), 0);
  const qIn = spring({ frame: f - 8, fps, config: { damping: 18, mass: 0.8, stiffness: 120 } });
  const aIn = spring({ frame: f - 322, fps, config: { damping: 18, mass: 0.8, stiffness: 120 } });
  const stage = f < 140 ? 0 : f < 188 ? 1 : 2;
  const stageOp = tween(f, 50, 70) * tween(f, 228, 250, 1, 0);
  const { field } = L;
  const steps = L.stepper;
  const stepX = (i: number) => steps.x0 + (i * (steps.x1 - steps.x0)) / 4;

  return (
    <AbsoluteFill style={{ background: "transparent", fontFamily: font }}>
      <div style={{ position: "absolute", inset: 0, opacity: fade }}>
        <div
          style={{
            position: "absolute",
            left: field.x,
            top: field.y,
            width: field.w,
            height: field.h,
            borderRadius: 24,
            background: "#fafafa",
            border: `1.5px solid ${color.line}`,
            opacity: tween(f, 30, 60)
          }}
        />

        {L.clusters.map((c, i) => {
          const p = tween(f, 240 + i * 8, 290 + i * 8);
          const t = tween(f, 265 + i * 8, 295 + i * 8);
          return (
            <Fragment key={i}>
              <div
                style={{
                  position: "absolute",
                  left: c.x - L.spread * 1.5,
                  top: c.y - L.spread * 1.22,
                  width: L.spread * 3,
                  height: L.spread * 2.45,
                  borderRadius: "50%",
                  background: i === HIGHLIGHT ? "rgba(0,138,138,0.13)" : "rgba(0,138,138,0.07)",
                  transform: `scale(${0.6 + 0.4 * p})`,
                  opacity: p
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: c.x - 150,
                  width: 300,
                  top: c.y + L.spread * 1.2,
                  textAlign: "center",
                  fontSize: L.type.cluster,
                  fontWeight: 500,
                  color: i === HIGHLIGHT ? color.teal : color.fg,
                  opacity: t,
                  transform: `translateY(${(1 - t) * 10}px)`
                }}
              >
                {copy.clusters[i]}
              </div>
            </Fragment>
          );
        })}

        {dots.map((d, i) => {
          const born = tween(f, d.t0, d.t0 + 16);
          if (born <= 0) return null;
          let x = interpolate(born, [0, 1], [L.spawn.x, d.x]);
          let y = interpolate(born, [0, 1], [L.spawn.y + ((i * 37) % 60), d.y]);
          let fill: string = "#9a9a9a";
          let op = born;
          if (d.kind === "noise") {
            if (tween(f, 142 + (i % 20), 152 + (i % 20)) > 0) fill = color.coral;
            const drop = tween(f, 158 + (i % 24), 185 + (i % 24), 0, 1, EASE_IO);
            y += drop * 90;
            op *= 1 - drop;
          }
          if (d.kind === "dup") {
            const twin = dots[d.twin]!;
            const m = tween(f, 146 + (i % 26), 176 + (i % 26));
            x = interpolate(m, [0, 1], [x, twin.x]);
            y = interpolate(m, [0, 1], [y, twin.y]);
            op *= 1 - tween(f, 170 + (i % 26), 182 + (i % 26));
          }
          if (d.kind === "ok") {
            if (!d.core) op *= 1 - 0.78 * tween(f, 190 + (i % 20), 215 + (i % 20));
            else if (tween(f, 190, 215) > 0.5) fill = color.fg;
            if (d.core) {
              const mv = tween(f, 228 + (i % 40), 278 + (i % 40), 0, 1, EASE_IO);
              x = interpolate(mv, [0, 1], [x, d.cx]);
              y = interpolate(mv, [0, 1], [y, d.cy]);
              if (mv > 0.6) fill = d.c === HIGHLIGHT ? color.teal : "#3f8f8f";
            } else {
              op *= 1 - tween(f, 230, 260) * 0.6;
            }
          }
          const pulse = i === traceIndex ? tween(f, 360, 380) : 0;
          const size = pulse > 0 ? 12 : 7;
          return (
            <Fragment key={i}>
              {pulse > 0 ? (
                <div
                  style={{
                    position: "absolute",
                    left: Math.round(x - 18),
                    top: Math.round(y - 18),
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    border: `2.5px solid ${color.teal}`,
                    opacity: pulse,
                    transform: `scale(${0.6 + 0.4 * pulse})`
                  }}
                />
              ) : null}
              <div
                style={{
                  position: "absolute",
                  left: Math.round(x - size / 2),
                  top: Math.round(y - size / 2),
                  width: size,
                  height: size,
                  borderRadius: "50%",
                  background: pulse > 0 ? color.teal : fill,
                  opacity: op
                }}
              />
            </Fragment>
          );
        })}

        {/* stage label in place of raw counts */}
        <div style={{ position: "absolute", left: field.x, width: field.w, top: field.y + field.h * 0.36, textAlign: "center", opacity: stageOp }}>
          <span
            style={{
              display: "inline-block",
              padding: "16px 28px",
              borderRadius: 20,
              background: "rgba(255,255,255,0.94)",
              border: `1.5px solid ${color.line}`,
              fontSize: L.type.stage,
              fontWeight: 500,
              color: color.ink
            }}
          >
            {copy.stages[stage]}
          </span>
        </div>

        <Card x={L.question.x} y={L.question.y} w={L.question.w} style={{ opacity: qIn, transform: `translateY(${(1 - qIn) * 24}px)` }}>
          <div style={{ display: "flex", gap: 18, alignItems: variant === "tall" ? "center" : "flex-start", flexDirection: variant === "tall" ? "row" : "column" }}>
            <span style={{ width: 56, height: 56, borderRadius: 16, background: color.tealSoft, color: color.teal, display: "grid", placeItems: "center", flex: "none" }}>
              <Search width={28} height={28} strokeWidth={1.8} />
            </span>
            <div>
              <p style={{ margin: 0, fontSize: L.type.label, color: color.muted }}>{copy.asks}</p>
              <p style={{ margin: "6px 0 0", fontSize: L.type.question, lineHeight: 1.2, fontWeight: 500, color: color.ink }}>{copy.question}</p>
            </div>
          </div>
        </Card>

        <svg width={L.width} height={L.height} style={{ position: "absolute", left: 0, top: 0 }} aria-hidden>
          {traceIndex >= 0
            ? (() => {
                const d = dots[traceIndex]!;
                const p = tween(f, 340, 372, 0, 1, EASE_IO);
                return (
                  <path
                    d={L.trace({ x: d.cx, y: d.cy })}
                    fill="none"
                    stroke={color.teal}
                    strokeWidth={2.5}
                    strokeDasharray={1200}
                    strokeDashoffset={1200 * (1 - p)}
                    opacity={p > 0 ? 1 : 0}
                  />
                );
              })()
            : null}
        </svg>

        <Card x={L.answer.x} y={L.answer.y} w={L.answer.w} soft style={{ opacity: aIn, transform: `translateX(${(1 - aIn) * 30}px)` }}>
          <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
            <span style={{ width: 56, height: 56, borderRadius: 16, background: "#fff", color: color.teal, display: "grid", placeItems: "center", flex: "none" }}>
              <LightBulb width={28} height={28} strokeWidth={1.8} />
            </span>
            <p style={{ margin: 0, fontSize: L.type.question, fontWeight: 500, color: color.ink }}>{copy.answer}</p>
          </div>
          {[0, 1, 2].map((k) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 12, marginTop: k ? 12 : 18, opacity: tween(f, 330 + k * 6, 346 + k * 6) }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: "#fff", color: color.teal, fontSize: 16, fontWeight: 700, display: "grid", placeItems: "center" }}>
                {k + 1}
              </span>
              <span style={{ height: 11, borderRadius: 6, background: "#c8e9e9", width: `${[70, 56, 63][k]}%` }} />
            </div>
          ))}
          <div
            style={{
              marginTop: 20,
              padding: "14px 16px",
              borderRadius: 14,
              background: "#fff",
              border: "1.5px solid #cdeeee",
              display: "flex",
              alignItems: "center",
              gap: 12,
              color: color.teal,
              opacity: tween(f, 334, 350)
            }}
          >
            <ChatLines width={24} height={24} strokeWidth={1.8} />
            <span style={{ fontSize: L.type.label, color: color.muted }}>{copy.linked}</span>
          </div>
        </Card>

        {/* stepper */}
        <div style={{ position: "absolute", left: 0, right: 0, top: steps.y, height: 140 }}>
          <div style={{ position: "absolute", left: steps.x0, width: steps.x1 - steps.x0, top: 27, height: 2, background: color.line }} />
          <div
            style={{
              position: "absolute",
              left: steps.x0,
              top: 27,
              height: 2,
              background: color.teal,
              width: interpolate(f, [0, 60, 140, 225, 320, 340], [0, 0, 0.25, 0.5, 0.75, 1], { extrapolateRight: "clamp" }) * (steps.x1 - steps.x0)
            }}
          />
          {copy.steps.map((label, i) => {
            const active = i === step;
            const done = i < step;
            const Icon = ICONS[i]!;
            const human = HUMAN_STEPS.includes(i);
            const showLabel = steps.labels === "all" || active;
            return (
              <div key={i} style={{ position: "absolute", left: stepX(i) - 150, width: 300, top: 0, textAlign: "center" }}>
                <div
                  style={{
                    margin: "0 auto",
                    width: 56,
                    height: 56,
                    borderRadius: 16,
                    background: active ? color.teal : done ? color.tealSoft : "#fff",
                    border: `1.5px solid ${active ? color.teal : done ? "#cdeeee" : color.line}`,
                    color: active ? "#fff" : done ? color.teal : "#9a9a9a",
                    display: "grid",
                    placeItems: "center",
                    transform: `scale(${active ? 1.08 : 1})`
                  }}
                >
                  <Icon width={26} height={26} strokeWidth={1.8} />
                </div>
                {showLabel ? (
                  <div style={{ marginTop: 12, fontSize: L.type.step, fontWeight: active ? 700 : 500, color: active ? color.ink : color.muted, whiteSpace: "nowrap" }}>{label}</div>
                ) : null}
                {human && showLabel ? (
                  <div
                    style={{
                      marginTop: 8,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 12px 4px 8px",
                      borderRadius: 20,
                      background: active ? color.coralSoft : "#f4f4f4",
                      color: active ? color.coral : color.muted,
                      fontSize: L.type.label - 2,
                      fontWeight: 500
                    }}
                  >
                    <UserBadgeCheck width={18} height={18} strokeWidth={1.8} />
                    {copy.human}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}

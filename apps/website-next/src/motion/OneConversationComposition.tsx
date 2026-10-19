"use client";

import { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "./runtime";
import { color, font } from "./theme";

/**
 * One conversation, cut the way each team thinks: the same 300 mentions rearrange into
 * a store, brand topics, a competitive comparison and the client's own framework.
 * Ported from the 2026 partner deck onto the Noisia runtime, square so it reads on phones.
 */

export const ONE = { width: 1080, height: 1080, seg: 108 } as const;
export const ONE_FRAMES = ONE.seg * 4;
const MOVE = 32;
const N = 300;

export type OneConversationCopy = {
  views: [{ tab: string; caption: string }, { tab: string; caption: string }, { tab: string; caption: string }, { tab: string; caption: string }];
  topics: [string, string, string, string, string];
  brands: [string, string, string];
  framework: string;
  nodes: [string, string, string];
};

type P = { x: number; y: number; c: string };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const R = rng(11);
const SEEDS = Array.from({ length: N }, () => ({ a: R(), b: R(), c: R(), d: R() }));
const EASE_IO = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const tween = (f: number, a: number, b: number, ease = EASE_IO) => interpolate(f, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });

const GREY = "#a6a6a6";
const TOPICS = [
  { x: 250, y: 400 },
  { x: 540, y: 340 },
  { x: 830, y: 400 },
  { x: 370, y: 650 },
  { x: 710, y: 650 }
];
const BRANDS = [
  { x: 270, share: 0.44, c: color.teal },
  { x: 540, share: 0.33, c: "#7a9e9e" },
  { x: 810, share: 0.23, c: "#b9c9c9" }
];
const NODES = [
  { x: 230, y: 470, c: color.teal },
  { x: 850, y: 470, c: color.teal },
  { x: 540, y: 720, c: color.coral }
];
const CENTER = { x: 540, y: 470 };

const grid = (i: number): P => {
  const cols = 20;
  return { x: 112 + (i % cols) * 45, y: 300 + Math.floor(i / cols) * 34, c: GREY };
};
const topic = (i: number): P => {
  const s = SEEDS[i]!;
  const k = Math.floor(s.a * TOPICS.length);
  const ang = s.b * Math.PI * 2;
  const rad = Math.sqrt(s.c) * 92;
  return { x: TOPICS[k]!.x + Math.cos(ang) * rad, y: TOPICS[k]!.y + Math.sin(ang) * rad * 0.75, c: color.teal };
};
const brandOf = (i: number) => (i / N < BRANDS[0]!.share ? 0 : i / N < BRANDS[0]!.share + BRANDS[1]!.share ? 1 : 2);
const comp = (i: number): P => {
  const b = brandOf(i);
  const start = b === 0 ? 0 : b === 1 ? Math.ceil(BRANDS[0]!.share * N) : Math.ceil((BRANDS[0]!.share + BRANDS[1]!.share) * N);
  const j = i - start;
  const cols = 10;
  return { x: BRANDS[b]!.x - 4.5 * 20 + (j % cols) * 20, y: 790 - Math.floor(j / cols) * 20, c: BRANDS[b]!.c };
};
const tax = (i: number): P => {
  const s = SEEDS[i]!;
  const k = Math.floor(s.d * NODES.length);
  const ang = s.b * Math.PI * 2;
  const rad = 74 + Math.sqrt(s.c) * 62;
  return { x: NODES[k]!.x + Math.cos(ang) * rad, y: NODES[k]!.y + Math.sin(ang) * rad * 0.7, c: NODES[k]!.c };
};
const LAYOUT = [grid, topic, comp, tax];

function mix(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((k) => parseInt(a.slice(k, k + 2), 16));
  const pb = [1, 3, 5].map((k) => parseInt(b.slice(k, k + 2), 16));
  return `rgb(${pa.map((v, k) => Math.round(v + (pb[k]! - v) * t)).join(",")})`;
}

function Dots({ frame }: { frame: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const view = Math.floor(frame / ONE.seg) % 4;
    const prev = (view + 3) % 4;
    const local = frame - view * ONE.seg;
    ctx.clearRect(0, 0, ONE.width, ONE.height);
    for (let i = 0; i < N; i++) {
      const a = LAYOUT[prev]!(i);
      const b = LAYOUT[view]!(i);
      const lt = tween(local, SEEDS[i]!.a * 8, SEEDS[i]!.a * 8 + MOVE - 6);
      ctx.fillStyle = mix(a.c, b.c, lt);
      ctx.beginPath();
      ctx.arc(a.x + (b.x - a.x) * lt, a.y + (b.y - a.y) * lt, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  return <canvas ref={ref} width={ONE.width} height={ONE.height} style={{ position: "absolute", inset: 0 }} aria-hidden />;
}

export function OneConversationComposition({ copy }: { copy: OneConversationCopy }) {
  const f = useCurrentFrame();
  const view = Math.floor(f / ONE.seg) % 4;
  const local = f - view * ONE.seg;
  const settled = tween(local, MOVE - 6, MOVE + 10);
  const label = (text: string, x: number, y: number, extra: React.CSSProperties = {}) => (
    <div style={{ position: "absolute", left: x - 160, width: 320, top: y, textAlign: "center", fontSize: 32, fontWeight: 500, color: color.fg, opacity: settled, ...extra }}>{text}</div>
  );

  return (
    <AbsoluteFill style={{ fontFamily: font }}>
      {/* view title with four steps */}
      <div style={{ position: "absolute", left: 60, right: 60, top: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
        <div style={{ display: "flex", gap: 12 }}>
          {copy.views.map((_, k) => (
            <span key={k} style={{ width: k === view ? 56 : 14, height: 14, borderRadius: 7, background: k === view ? color.teal : "#dcdcdc", transition: "none" }} />
          ))}
        </div>
        <span style={{ fontSize: 52, fontWeight: 500, color: color.ink, opacity: 0.25 + 0.75 * settled }}>{copy.views[view]!.tab}</span>
      </div>

      <svg width={ONE.width} height={ONE.height} style={{ position: "absolute", inset: 0 }} aria-hidden>
        {NODES.map((n, k) => (
          <line key={k} x1={CENTER.x} y1={CENTER.y} x2={n.x} y2={n.y} stroke="#e2e2e2" strokeWidth={3} opacity={view === 3 ? settled : 0} />
        ))}
      </svg>

      <Dots frame={f} />

      {view === 1 ? TOPICS.map((t, k) => label(copy.topics[k]!, t.x, t.y + 86)) : null}
      {view === 2
        ? BRANDS.map((b, k) => label(copy.brands[k]!, b.x, 820, { color: k === 0 ? color.teal : color.fg, fontWeight: k === 0 ? 700 : 500 }))
        : null}
      {view === 3 ? (
        <>
          <div
            style={{
              position: "absolute",
              left: CENTER.x - 140,
              top: CENTER.y - 40,
              width: 280,
              height: 80,
              borderRadius: 40,
              background: color.ink,
              color: "#fff",
              fontSize: 30,
              fontWeight: 500,
              display: "grid",
              placeItems: "center",
              opacity: settled,
              transform: `scale(${0.85 + 0.15 * settled})`
            }}
          >
            {copy.framework}
          </div>
          {NODES.map((n, k) => (
            <div
              key={k}
              style={{
                position: "absolute",
                left: n.x - 120,
                width: 240,
                top: n.y - 26,
                height: 52,
                borderRadius: 26,
                background: "#fff",
                border: `2px solid ${n.c === color.coral ? "#f6c9bf" : "#bfe5e5"}`,
                fontSize: 28,
                fontWeight: 700,
                color: n.c,
                display: "grid",
                placeItems: "center",
                opacity: settled
              }}
            >
              {copy.nodes[k]}
            </div>
          ))}
        </>
      ) : null}

      <div style={{ position: "absolute", left: 80, right: 80, top: 920, textAlign: "center", fontSize: 34, lineHeight: 1.3, color: color.muted, opacity: settled }}>
        {copy.views[view]!.caption}
      </div>
    </AbsoluteFill>
  );
}

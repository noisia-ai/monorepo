"use client";

import { useLayoutEffect, useRef, type ComponentType, type SVGProps } from "react";
import { ChatBubbleQuestion, Database, Network, Search, Star, Group } from "iconoir-react";
import { siFacebook, siInstagram, siTiktok, siX, siYoutube } from "simple-icons";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "./runtime";
import { color, font } from "./theme";

/** Every source flows into one reading: social, reviews, forums, search and the client's own data. */

export const HUB = { width: 1080, height: 1080 } as const;
export const HUB_FRAMES = 360;

export type SourcesHubCopy = { center: string; sources: string[]; owned: string };

/** Platforms carry their real mark (Simple Icons, brand color); source types keep an Iconoir icon. */
function brandMark(icon: { path: string; hex: string }): ComponentType<SVGProps<SVGSVGElement>> {
  function Mark(props: SVGProps<SVGSVGElement>) {
    const { width, height } = props;
    return (
      <svg width={width} height={height} viewBox="0 0 24 24" aria-hidden>
        <path d={icon.path} fill={`#${icon.hex}`} />
      </svg>
    );
  }
  return Mark;
}
const ICONS: ComponentType<SVGProps<SVGSVGElement>>[] = [
  brandMark(siTiktok),
  brandMark(siInstagram),
  brandMark(siYoutube),
  brandMark(siX),
  brandMark(siFacebook),
  Star,
  ChatBubbleQuestion,
  Search,
  Group,
  Database
];
const CENTER = { x: 540, y: 540 };
const RADIUS = 380;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

function nodePosition(i: number, total: number) {
  const angle = -Math.PI / 2 + (i / total) * Math.PI * 2;
  return { x: CENTER.x + Math.cos(angle) * RADIUS, y: CENTER.y + Math.sin(angle) * RADIUS * 0.92 };
}

function Flow({ frame, total, owned }: { frame: number; total: number; owned: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, HUB.width, HUB.height);
    const flowIn = interpolate(frame, [150, 175], [0, 1], clamp) * interpolate(frame, [HUB_FRAMES - 30, HUB_FRAMES - 10], [1, 0], clamp);
    if (flowIn <= 0) return;
    for (let i = 0; i < total; i++) {
      const from = nodePosition(i, total);
      for (let k = 0; k < 4; k++) {
        const t = ((frame - 150) / 70 + k / 4 + i * 0.13) % 1;
        if (t < 0) continue;
        const x = from.x + (CENTER.x - from.x) * t;
        const y = from.y + (CENTER.y - from.y) * t;
        ctx.globalAlpha = flowIn * Math.sin(t * Math.PI) * 0.9;
        ctx.fillStyle = i >= total - owned ? color.coral : color.teal;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  });
  return <canvas ref={ref} width={HUB.width} height={HUB.height} style={{ position: "absolute", inset: 0 }} aria-hidden />;
}

export function SourcesHubComposition({ copy }: { copy: SourcesHubCopy }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const total = Math.min(copy.sources.length, ICONS.length);
  const owned = 2; // the last two sources are the client's own data
  const fade = interpolate(frame, [HUB_FRAMES - 20, HUB_FRAMES], [1, 0], clamp);
  const core = spring({ frame: frame - 120, fps, config: { damping: 14, mass: 0.8, stiffness: 110 } });
  const pulse = frame > 160 ? 1 + 0.04 * Math.sin((frame - 160) / 8) : 1;

  return (
    <AbsoluteFill style={{ fontFamily: font, opacity: fade }}>
      <svg width={HUB.width} height={HUB.height} style={{ position: "absolute", inset: 0 }} aria-hidden>
        <circle cx={CENTER.x} cy={CENTER.y} r={RADIUS} fill="none" stroke="#efefef" strokeWidth={2} strokeDasharray="6 10" />
        {Array.from({ length: total }, (_, i) => {
          const p = nodePosition(i, total);
          const draw = interpolate(frame, [60 + i * 6, 110 + i * 6], [0, 1], clamp);
          const len = Math.hypot(p.x - CENTER.x, p.y - CENTER.y);
          return (
            <line
              key={i}
              x1={p.x}
              y1={p.y}
              x2={CENTER.x}
              y2={CENTER.y}
              stroke={i >= total - owned ? "#f6c9bf" : "#bfe5e5"}
              strokeWidth={3}
              strokeDasharray={len}
              strokeDashoffset={len * (1 - draw)}
            />
          );
        })}
      </svg>

      <Flow frame={frame} total={total} owned={owned} />

      {Array.from({ length: total }, (_, i) => {
        const p = nodePosition(i, total);
        const s = spring({ frame: frame - (6 + i * 7), fps, config: { damping: 15, mass: 0.7, stiffness: 120 } });
        const Icon = ICONS[i]!;
        const isOwned = i >= total - owned;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: p.x - 120,
              top: p.y - 50,
              width: 240,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
              opacity: s,
              transform: `scale(${0.7 + 0.3 * s})`
            }}
          >
            <span
              style={{
                width: 84,
                height: 84,
                borderRadius: 24,
                display: "grid",
                placeItems: "center",
                background: isOwned ? color.coralSoft : "#fff",
                border: `2px solid ${isOwned ? "#f6c9bf" : color.line}`,
                color: isOwned ? color.coral : color.ink,
                boxShadow: "0 10px 26px rgba(10,10,10,0.06)"
              }}
            >
              <Icon width={i < 5 ? 34 : 38} height={i < 5 ? 34 : 38} strokeWidth={1.7} />
            </span>
            <span style={{ fontSize: 31, fontWeight: 500, color: color.fg, whiteSpace: "nowrap" }}>{copy.sources[i]}</span>
          </div>
        );
      })}

      <div
        style={{
          position: "absolute",
          left: CENTER.x - 150,
          top: CENTER.y - 150,
          width: 300,
          height: 300,
          borderRadius: "50%",
          background: color.teal,
          color: "#fff",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          textAlign: "center",
          opacity: core,
          transform: `scale(${(0.6 + 0.4 * core) * pulse})`,
          boxShadow: `0 0 0 ${18 * core}px ${color.tealSoft}`
        }}
      >
        <Network width={48} height={48} strokeWidth={1.7} />
        <span style={{ fontSize: 38, fontWeight: 500, lineHeight: 1.15, padding: "0 30px" }}>{copy.center}</span>
      </div>

      <div style={{ position: "absolute", left: 0, right: 0, bottom: 20, display: "flex", justifyContent: "center", opacity: interpolate(frame, [170, 200], [0, 1], clamp) }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 12, fontSize: 31, color: color.muted }}>
          <span style={{ width: 16, height: 16, borderRadius: 8, background: color.coral }} />
          {copy.owned}
        </span>
      </div>
    </AbsoluteFill>
  );
}

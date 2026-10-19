"use client";

import { LightBulb, CursorPointer, ChatLines } from "iconoir-react";
import { siInstagram, siReddit, siTiktok, siX, siYoutube } from "simple-icons";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "./runtime";
import { color, font } from "./theme";

/**
 * Open evidence: a finding with its confidence level, a tap on "see mentions", and the
 * mentions that hold it up slide out as chat bubbles with their platform and date.
 */

export const HOW_EVIDENCE = { width: 1080, height: 1080, frames: 300 } as const;

type Platform = "tiktok" | "reddit" | "youtube" | "instagram" | "x";
export type HowEvidenceCopy = {
  finding: string;
  level: string;
  open: string;
  quotes: [{ source: Platform; date: string; text: string }, { source: Platform; date: string; text: string }, { source: Platform; date: string; text: string }];
};

const MARKS: Record<Platform, { label: string; path: string; hex: string }> = {
  tiktok: { label: "TikTok", path: siTiktok.path, hex: `#${siTiktok.hex}` },
  reddit: { label: "Reddit", path: siReddit.path, hex: `#${siReddit.hex}` },
  youtube: { label: "YouTube", path: siYoutube.path, hex: `#${siYoutube.hex}` },
  instagram: { label: "Instagram", path: siInstagram.path, hex: `#${siInstagram.hex}` },
  x: { label: "X", path: siX.path, hex: `#${siX.hex}` }
};

const EASE_IO = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const tw = (f: number, a: number, b: number, ease = EASE_IO) => interpolate(f, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });

const LEFT = 70;
const W = 1080 - LEFT * 2;
const CARD_TOP = 70;
const QUOTE_TOP = [430, 640, 850];

export function HowEvidenceComposition({ copy }: { copy: HowEvidenceCopy }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { frames } = HOW_EVIDENCE;
  const fade = 1 - tw(f, frames - 22, frames);
  const cardIn = spring({ frame: f - 2, fps, config: { damping: 18, mass: 0.8, stiffness: 120 } });
  const levelIn = spring({ frame: f - 30, fps, config: { damping: 14, mass: 0.6, stiffness: 140 } });
  const cursor = tw(f, 52, 82);
  const press = tw(f, 84, 90) * (1 - tw(f, 92, 102));
  const opened = tw(f, 92, 108);
  const line = tw(f, 100, 200);

  return (
    <AbsoluteFill style={{ fontFamily: font, opacity: fade }}>
      {/* the finding */}
      <div
        style={{
          position: "absolute",
          left: LEFT,
          top: CARD_TOP,
          width: W,
          padding: 40,
          borderRadius: 40,
          background: "#fff",
          border: `2px solid ${color.line}`,
          boxShadow: "0 24px 60px rgba(10,10,10,0.07)",
          opacity: cardIn,
          transform: `translateY(${(1 - cardIn) * 30}px)`,
          display: "flex",
          flexDirection: "column",
          gap: 26
        }}
      >
        <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
          <span style={{ width: 68, height: 68, borderRadius: 20, background: color.tealSoft, color: color.teal, display: "grid", placeItems: "center", flex: "none" }}>
            <LightBulb width={36} height={36} strokeWidth={1.8} />
          </span>
          <span style={{ fontSize: 48, lineHeight: 1.18, fontWeight: 500, color: color.ink }}>{copy.finding}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, paddingLeft: 92 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 22px",
              borderRadius: 999,
              background: color.tealSoft,
              color: color.teal,
              fontSize: 30,
              fontWeight: 500,
              opacity: levelIn,
              transform: `scale(${0.8 + 0.2 * levelIn})`
            }}
          >
            <span style={{ width: 14, height: 14, borderRadius: 7, background: color.teal }} />
            {copy.level}
          </span>
          <span
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 26px",
              borderRadius: 999,
              border: `2px solid ${opened > 0.5 ? color.teal : "#dadada"}`,
              color: opened > 0.5 ? color.teal : color.ink,
              background: "#fff",
              fontSize: 30,
              fontWeight: 500,
              transform: `scale(${1 - press * 0.06})`
            }}
          >
            <ChatLines width={30} height={30} strokeWidth={1.8} />
            {copy.open}
            {/* the reader's tap */}
            <span
              style={{
                position: "absolute",
                right: 30 - (1 - cursor) * 60,
                bottom: -46 - (1 - cursor) * 90,
                color: color.ink,
                opacity: cursor * (1 - tw(f, 120, 140)),
                filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.15))"
              }}
            >
              <CursorPointer width={54} height={54} strokeWidth={1.6} fill="#fff" />
            </span>
          </span>
        </div>
      </div>

      {/* the thread that ties each mention to the finding */}
      <svg width={1080} height={1080} style={{ position: "absolute", inset: 0 }} aria-hidden>
        <path
          d={`M ${LEFT + 74} 360 L ${LEFT + 74} ${QUOTE_TOP[2]! + 40}`}
          stroke="#bfe5e5"
          strokeWidth={4}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={600}
          strokeDashoffset={600 * (1 - line)}
        />
      </svg>

      {copy.quotes.map((q, i) => {
        const p = spring({ frame: f - (108 + i * 30), fps, config: { damping: 16, mass: 0.7, stiffness: 120 } });
        const mark = MARKS[q.source];
        const glow = Math.max(tw(f, 120 + i * 30, 140 + i * 30) * (1 - tw(f, 145 + i * 30, 175 + i * 30)), tw(f, 200 + i * 22, 214 + i * 22) * (1 - tw(f, 216 + i * 22, 240 + i * 22)));
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: LEFT + 34,
              top: QUOTE_TOP[i],
              width: W - 34,
              display: "flex",
              gap: 22,
              alignItems: "flex-start",
              opacity: Math.min(1, p),
              transform: `translateY(${(1 - p) * 30}px)`
            }}
          >
            <span
              style={{
                width: 80,
                height: 80,
                borderRadius: 40,
                background: "#fff",
                border: `2px solid ${color.line}`,
                boxShadow: `0 8px 20px rgba(10,10,10,0.06), 0 0 0 ${10 * glow}px rgba(0,138,138,${0.18 * glow})`,
                display: "grid",
                placeItems: "center",
                flex: "none"
              }}
            >
              <svg width={38} height={38} viewBox="0 0 24 24" aria-hidden>
                <path d={mark.path} fill={mark.hex} />
              </svg>
            </span>
            <div style={{ flex: 1, minWidth: 0, padding: "22px 30px 26px", borderRadius: "10px 34px 34px 34px", background: glow > 0.01 ? `rgba(230,247,247,${0.4 + 0.6 * glow})` : "#f4f4f4", boxShadow: `inset 0 0 0 2px rgba(0,138,138,${0.25 * glow})` }}>
              <div style={{ fontSize: 26, color: color.muted, marginBottom: 8 }}>
                {mark.label} · {q.date}
              </div>
              <div style={{ fontSize: 34, lineHeight: 1.3, color: color.ink }}>{q.text}</div>
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

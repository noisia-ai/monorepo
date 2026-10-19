"use client";

import { Check, Sparks, UserBadgeCheck, Xmark, ArrowUnion } from "iconoir-react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "./runtime";
import { color, font } from "./theme";

/**
 * The expert in the loop: our software proposes topics, the Intelligence Architect approves
 * one, merges two that say the same thing, drops the noise, approves the rest and signs.
 * Square, so it reads the same on phones and in a desktop column.
 */

export const HOW_ARCHITECT = { width: 1080, height: 1080, frames: 390 } as const;

export type HowArchitectCopy = {
  title: string;
  /** Five proposed topics: [approved, kept after merge, merged into the previous one, noise, approved]. */
  topics: [string, string, string, string, string];
  merged: string;
  noise: string;
  approved: string;
  role: string;
  signed: string;
};

const ROW = 118;
const HEAD = 132;
const SIG = 176;
const PAD = 44;
const SHARE = [0.62, 0.48, 0.3, 0.4, 0.36];
const EASE = (t: number) => 1 - Math.pow(1 - t, 3);
const EASE_IO = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const tw = (f: number, a: number, b: number, ease = EASE) => interpolate(f, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });

type Status = { kind: "approved" | "merged" | "noise"; at: number };
const STATUS: (Status | null)[] = [{ kind: "approved", at: 118 }, { kind: "merged", at: 172 }, null, { kind: "noise", at: 214 }, { kind: "approved", at: 262 }];

function Chip({ kind, label, p }: { kind: Status["kind"]; label: string; p: number }) {
  const noise = kind === "noise";
  const Icon = kind === "approved" ? Check : kind === "merged" ? ArrowUnion : Xmark;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 20px 10px 14px",
        borderRadius: 999,
        background: noise ? color.coralSoft : color.tealSoft,
        color: noise ? color.coral : color.teal,
        fontSize: 30,
        fontWeight: 500,
        whiteSpace: "nowrap",
        opacity: p,
        transform: `scale(${0.8 + 0.2 * p})`
      }}
    >
      <Icon width={30} height={30} strokeWidth={2} />
      {label}
    </span>
  );
}

export function HowArchitectComposition({ copy }: { copy: HowArchitectCopy }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { frames } = HOW_ARCHITECT;
  const fade = 1 - tw(f, frames - 24, frames, EASE_IO);
  const cardIn = spring({ frame: f - 2, fps, config: { damping: 18, mass: 0.8, stiffness: 120 } });
  const merge = tw(f, 160, 196, EASE_IO);
  const collapse = tw(f, 236, 266, EASE_IO);
  const sig = tw(f, 292, 322, EASE_IO);
  const sigDraw = tw(f, 312, 352, EASE_IO);
  const person = spring({ frame: f - 96, fps, config: { damping: 16, mass: 0.7, stiffness: 120 } });

  const rows = 5 - merge - collapse;
  const height = HEAD + rows * ROW + sig * SIG + PAD;
  const top = (HOW_ARCHITECT.height - height) / 2;
  const left = 70;
  const width = HOW_ARCHITECT.width - left * 2;

  // Where each row sits once rows above it have merged or collapsed.
  const rowY = (i: number) => {
    let y = HEAD + i * ROW;
    if (i >= 2) y -= merge * ROW;
    if (i >= 4) y -= collapse * ROW;
    return y;
  };

  return (
    <AbsoluteFill style={{ fontFamily: font, opacity: fade }}>
      <div
        style={{
          position: "absolute",
          left,
          top,
          width,
          height,
          borderRadius: 40,
          background: "#fff",
          border: `2px solid ${color.line}`,
          boxShadow: "0 24px 60px rgba(10,10,10,0.07)",
          opacity: cardIn,
          transform: `translateY(${(1 - cardIn) * 30}px)`,
          overflow: "hidden"
        }}
      >
        {/* header: what the software proposes, and who reviews it */}
        <div style={{ position: "absolute", left: PAD, right: PAD, top: 40, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 18 }}>
            <span style={{ width: 60, height: 60, borderRadius: 18, background: color.tealSoft, color: color.teal, display: "grid", placeItems: "center" }}>
              <Sparks width={32} height={32} strokeWidth={1.8} />
            </span>
            <span style={{ fontSize: 40, fontWeight: 500, color: color.ink }}>{copy.title}</span>
          </span>
          <span
            style={{
              width: 60,
              height: 60,
              borderRadius: 30,
              background: color.coralSoft,
              color: color.coral,
              display: "grid",
              placeItems: "center",
              opacity: person,
              transform: `scale(${0.6 + 0.4 * person})`
            }}
            aria-hidden
          >
            <UserBadgeCheck width={32} height={32} strokeWidth={1.8} />
          </span>
        </div>

        {copy.topics.map((name, i) => {
          const appear = tw(f, 22 + i * 12, 44 + i * 12);
          const bar = tw(f, 34 + i * 12, 70 + i * 12, EASE_IO);
          const status = STATUS[i];
          const sp = status ? spring({ frame: f - status.at, fps, config: { damping: 15, mass: 0.6, stiffness: 140 } }) : 0;
          let op = appear;
          let share = SHARE[i]!;
          let strike = 0;
          if (i === 1) share += SHARE[2]! * merge;
          if (i === 2) op *= 1 - merge;
          if (i === 3) {
            strike = tw(f, 220, 240, EASE_IO);
            op *= 1 - 0.65 * tw(f, 226, 240) - 0.35 * collapse;
          }
          const y = rowY(i);
          const kept = status && status.kind !== "noise";
          return (
            <div
              key={name}
              style={{
                position: "absolute",
                left: PAD,
                right: PAD,
                top: y,
                height: ROW,
                display: "flex",
                alignItems: "center",
                gap: 24,
                borderTop: `2px solid ${color.track}`,
                opacity: op,
                transform: `translateY(${(1 - appear) * 16}px)`
              }}
            >
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
                <span style={{ position: "relative", alignSelf: "flex-start", fontSize: 40, fontWeight: 500, color: kept && sp > 0.5 ? color.ink : color.fg, whiteSpace: "nowrap" }}>
                  {name}
                  <span style={{ position: "absolute", left: 0, top: "54%", height: 3, width: `${strike * 100}%`, background: color.coral }} />
                </span>
                <span style={{ height: 12, borderRadius: 6, background: color.track, width: "100%", position: "relative", overflow: "hidden" }}>
                  <span
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      borderRadius: 6,
                      width: `${share * bar * 100}%`,
                      background: i === 3 && strike > 0 ? "#f3b9ac" : kept && sp > 0.5 ? color.teal : "#cfd8d8"
                    }}
                  />
                </span>
              </div>
              <div style={{ width: 230, display: "flex", justifyContent: "flex-end" }}>
                {status ? <Chip kind={status.kind} label={status.kind === "approved" ? copy.approved : status.kind === "merged" ? copy.merged : copy.noise} p={sp} /> : null}
              </div>
            </div>
          );
        })}

        {/* signature: the person who answers for the reading */}
        <div
          style={{
            position: "absolute",
            left: PAD,
            right: PAD,
            top: HEAD + rows * ROW + 20,
            height: SIG - 20,
            borderRadius: 28,
            background: color.tealSoft,
            display: "flex",
            alignItems: "center",
            gap: 22,
            padding: "0 30px",
            opacity: sig,
            transform: `translateY(${(1 - sig) * 24}px)`
          }}
        >
          <span style={{ width: 76, height: 76, borderRadius: 38, background: "#fff", color: color.teal, display: "grid", placeItems: "center", flex: "none" }}>
            <UserBadgeCheck width={40} height={40} strokeWidth={1.8} />
          </span>
          <span style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 34, fontWeight: 500, color: color.ink }}>{copy.role}</span>
            <span style={{ fontSize: 28, color: color.muted }}>{copy.signed}</span>
          </span>
          <svg width={190} height={90} viewBox="0 0 190 90" aria-hidden style={{ flex: "none" }}>
            <path
              d="M8 62 C 26 20, 40 20, 38 52 S 58 78, 72 44 S 92 18, 98 50 S 118 70, 132 40 C 140 26, 150 30, 148 48 C 146 62, 164 60, 182 34"
              fill="none"
              stroke={color.teal}
              strokeWidth={4}
              strokeLinecap="round"
              strokeDasharray={420}
              strokeDashoffset={420 * (1 - sigDraw)}
            />
          </svg>
        </div>
      </div>
    </AbsoluteFill>
  );
}

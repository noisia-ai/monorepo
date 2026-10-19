"use client";

import { ArrowRight } from "iconoir-react";
import { SourceIcon } from "@/components/brand/SourceMark";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "./runtime";
import { color, font } from "./theme";
import { clamp, countUp, enter } from "./util";

/**
 * Counting versus understanding (square 1080 canvas). A topic chart ranks what comes up most;
 * the biggest bar opens into three people who say the same thing for different reasons, and
 * each reason asks the brand for something different. Quotes are illustrative.
 */

export const METHOD_COUNT = { frames: 420 } as const;

export type MethodCountCopy = {
  header: string;
  unit: string;
  bars: [{ label: string; value: number }, { label: string; value: number }, { label: string; value: number }];
  inside: string;
  asks: string;
  rows: [MethodCountRow, MethodCountRow, MethodCountRow];
  caption: string;
};
type MethodCountRow = { quote: string; platform: string; ask: string };

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const card = { background: "#fff", borderRadius: 32, boxShadow: "0 18px 50px rgba(10,10,10,0.08)" } as const;
const ROW_Y = [448, 614, 780];

export function MethodCountComposition({ copy }: { copy: MethodCountCopy }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = interpolate(frame, [METHOD_COUNT.frames - 22, METHOD_COUNT.frames - 2], [1, 0], clamp);
  const head = enter(frame, fps, 4, 18);
  const dim = interpolate(frame, [96, 120], [0, 1], { ...clamp, easing: ease });
  const heads = enter(frame, fps, 122, 18);
  const caption = enter(frame, fps, 300, 18);
  const max = Math.max(...copy.bars.map((bar) => bar.value));

  return (
    <AbsoluteFill style={{ opacity: fade, fontFamily: font, textAlign: "left" }}>
      {/* what a count shows: one big topic */}
      <div style={{ ...card, position: "absolute", left: 60, right: 60, top: 56, padding: "30px 40px 32px", opacity: head, transform: `translateY(${(1 - head) * 18}px)` }}>
        <p style={{ margin: 0, fontSize: 34, fontWeight: 500, color: color.ink }}>{copy.header}</p>
        <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          {copy.bars.map((bar, i) => {
            const grow = interpolate(frame, [20 + i * 8, 76 + i * 8], [0, 1], { ...clamp, easing: ease });
            const top = i === 0;
            return (
              <div key={bar.label} style={{ display: "grid", gridTemplateColumns: "170px 1fr 230px", alignItems: "center", gap: 20, opacity: top ? 1 : 1 - dim * 0.65 }}>
                <span style={{ fontSize: 32, color: top ? color.ink : color.fg, fontWeight: top ? 500 : 400 }}>{bar.label}</span>
                <div style={{ height: 26, borderRadius: 13, background: color.track, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(bar.value / max) * 100 * grow}%`, borderRadius: 13, background: top && dim > 0.2 ? color.teal : "#b9d9d9" }} />
                </div>
                <span style={{ fontSize: 30, textAlign: "right", color: top ? color.ink : color.muted, fontVariantNumeric: "tabular-nums" }}>
                  {Math.round(countUp(frame, bar.value, 20 + i * 8, 56))} {copy.unit}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* the thread from the big bar down to the people inside it */}
      <svg width={1080} height={1080} style={{ position: "absolute", inset: 0 }} aria-hidden>
        <path d="M 100 376 L 100 436" stroke={color.teal} strokeWidth={3} strokeDasharray="6 8" strokeLinecap="round" fill="none" opacity={heads} />
      </svg>

      <span style={{ position: "absolute", left: 122, top: 394, fontSize: 26, fontWeight: 500, color: color.teal, opacity: heads }}>{copy.inside}</span>
      <span style={{ position: "absolute", left: 650, top: 394, fontSize: 26, color: color.muted, opacity: enter(frame, fps, 200, 18) }}>{copy.asks}</span>

      {copy.rows.map((row, i) => {
        const q = enter(frame, fps, 132 + i * 26, 16);
        const a = enter(frame, fps, 212 + i * 26, 16);
        const y = ROW_Y[i]!;
        return (
          <div key={row.quote}>
            <div style={{ position: "absolute", left: 60, top: y, width: 540, opacity: q, transform: `translateY(${(1 - q) * 22}px) scale(${0.95 + q * 0.05})`, transformOrigin: "left top" }}>
              <div style={{ background: color.bubble, borderRadius: "30px 30px 30px 10px", padding: "18px 26px", fontSize: 32, lineHeight: 1.25, color: color.ink }}>{row.quote}</div>
              <div style={{ marginTop: 8, marginLeft: 8 }}>
                <SourceIcon name={row.platform} size={26} />
              </div>
            </div>
            <span style={{ position: "absolute", left: 604, top: y + 30, color: color.teal, opacity: a, transform: `translateX(${(1 - a) * -14}px)` }}>
              <ArrowRight width={34} height={34} strokeWidth={2} />
            </span>
            <div
              style={{
                position: "absolute",
                left: 650,
                top: y,
                width: 370,
                minHeight: 96,
                display: "flex",
                alignItems: "center",
                padding: "16px 26px",
                borderRadius: 26,
                background: color.tealSoft,
                fontSize: 30,
                lineHeight: 1.2,
                fontWeight: 500,
                color: color.ink,
                opacity: a,
                transform: `translateY(${(1 - a) * 18}px)`
              }}
            >
              {row.ask}
            </div>
          </div>
        );
      })}

      <p style={{ position: "absolute", left: 60, right: 60, top: 962, margin: 0, fontSize: 34, lineHeight: 1.2, fontWeight: 500, color: color.ink, opacity: caption, transform: `translateY(${(1 - caption) * 14}px)` }}>{copy.caption}</p>
    </AbsoluteFill>
  );
}

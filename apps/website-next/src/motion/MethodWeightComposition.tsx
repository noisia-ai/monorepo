"use client";

import { SourceIcon } from "@/components/brand/SourceMark";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "./runtime";
import { color, font } from "./theme";
import { clamp, enter } from "./util";

/**
 * How many versus how much it weighs (square 1080 canvas). Three groups of mentions ranked by
 * volume re-rank by weight (intensity, context, link to the decision): the twelve angry ones
 * about to leave rise to the top. Values and the quote are illustrative.
 */

export const METHOD_WEIGHT = { frames: 390 } as const;

export type MethodWeightCopy = {
  byCount: string;
  byWeight: string;
  unit: string;
  rows: [MethodWeightRow, MethodWeightRow, MethodWeightRow];
  quote: string;
  platform: string;
  caption: string;
};
/** `hot` marks the group that rises once weight is taken into account. */
type MethodWeightRow = { label: string; count: number; weight: number; hot?: boolean };

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const card = { background: "#fff", borderRadius: 32, boxShadow: "0 18px 50px rgba(10,10,10,0.08)" } as const;
const SLOT_Y = [234, 364, 494];

export function MethodWeightComposition({ copy }: { copy: MethodWeightCopy }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = interpolate(frame, [METHOD_WEIGHT.frames - 22, METHOD_WEIGHT.frames - 2], [1, 0], clamp);
  const head = enter(frame, fps, 4, 18);
  const toggle = interpolate(frame, [140, 166], [0, 1], { ...clamp, easing: ease });
  const r = interpolate(frame, [168, 216], [0, 1], { ...clamp, easing: (v) => (v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2) });
  const quote = enter(frame, fps, 226, 18);
  const caption = enter(frame, fps, 290, 18);

  const maxCount = Math.max(...copy.rows.map((row) => row.count));
  const maxWeight = Math.max(...copy.rows.map((row) => row.weight));
  const byCount = [...copy.rows].sort((a, b) => b.count - a.count);
  const byWeight = [...copy.rows].sort((a, b) => b.weight - a.weight);
  const segW = [copy.byCount.length * 15 + 60, copy.byWeight.length * 15 + 60];

  return (
    <AbsoluteFill style={{ opacity: fade, fontFamily: font, textAlign: "left" }}>
      <div style={{ ...card, position: "absolute", left: 60, right: 60, top: 76, height: 560, opacity: head, transform: `translateY(${(1 - head) * 18}px)` }}>
        {/* the switch from counting to weighing */}
        <div style={{ position: "absolute", left: 40, top: 38, height: 64, padding: 6, borderRadius: 999, background: color.track, display: "flex" }}>
          <span
            style={{
              position: "absolute",
              top: 6,
              left: 6 + toggle * segW[0]!,
              width: segW[0]! + (segW[1]! - segW[0]!) * toggle,
              height: 52,
              borderRadius: 999,
              background: color.ink,
              boxShadow: "0 4px 12px rgba(10,10,10,0.18)"
            }}
          />
          {[copy.byCount, copy.byWeight].map((label, i) => (
            <span key={label} style={{ position: "relative", width: segW[i], display: "grid", placeItems: "center", fontSize: 28, fontWeight: 500, color: (i === 0 ? 1 - toggle : toggle) > 0.5 ? "#fff" : color.muted }}>
              {label}
            </span>
          ))}
        </div>
      </div>

      {copy.rows.map((row, i) => {
        const from = byCount.indexOf(row);
        const to = byWeight.indexOf(row);
        const y = SLOT_Y[from]! + (SLOT_Y[to]! - SLOT_Y[from]!) * r;
        const grow = interpolate(frame, [22 + i * 8, 80 + i * 8], [0, 1], { ...clamp, easing: ease });
        const share = (row.count / maxCount) * (1 - r) + (row.weight / maxWeight) * r;
        const hot = row.hot && r > 0.15;
        const barColor = r < 0.15 ? "#b9d9d9" : hot ? color.coral : "#d9d9d9";
        return (
          <div key={row.label} style={{ position: "absolute", left: 100, right: 100, top: y, opacity: head }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 20 }}>
              <span style={{ fontSize: 32, fontWeight: hot ? 500 : 400, color: hot ? color.ink : color.fg }}>{row.label}</span>
              <span style={{ fontSize: 26, color: color.muted, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                {row.count} {copy.unit}
              </span>
            </div>
            <div style={{ marginTop: 14, height: 26, borderRadius: 13, background: color.track, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.max(3, share * 100 * grow)}%`, borderRadius: 13, background: barColor }} />
            </div>
          </div>
        );
      })}

      <div style={{ position: "absolute", left: 60, top: 700, width: 700, opacity: quote, transform: `translateY(${(1 - quote) * 20}px)` }}>
        <div style={{ background: color.bubble, borderRadius: "30px 30px 30px 10px", padding: "18px 26px", fontSize: 32, lineHeight: 1.25, color: color.ink }}>{copy.quote}</div>
        <div style={{ marginTop: 8, marginLeft: 8 }}>
          <SourceIcon name={copy.platform} size={26} />
        </div>
      </div>

      <p style={{ position: "absolute", left: 60, right: 60, top: 950, margin: 0, fontSize: 34, lineHeight: 1.2, fontWeight: 500, color: color.ink, opacity: caption, transform: `translateY(${(1 - caption) * 14}px)` }}>{copy.caption}</p>
    </AbsoluteFill>
  );
}

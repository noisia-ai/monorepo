"use client";

import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "./runtime";
import { color, font } from "./theme";
import { clamp, enter } from "./util";

/**
 * How a survey reads a question (square 1080 canvas): the options are fixed in advance, people
 * tick one, the ticks become percentages. It measures how many; the why and whatever nobody
 * listed stay outside. Companion of ApproachComposition on the comparison pages.
 */

export const LEARN_SURVEY = { frames: 300 } as const;

export type LearnSurveyCopy = {
  label: string;
  question: string;
  options: [string, string, string, string];
  /** Percent for each option; they should add up to 100. */
  values: [number, number, number, number];
  respondents: string;
  why: string;
  unasked: string;
};

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const card = { background: "#fff", borderRadius: 30, boxShadow: "0 18px 50px rgba(10,10,10,0.08)", fontFamily: font } as const;

export function LearnSurveyComposition({ copy }: { copy: LearnSurveyCopy }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const fade = interpolate(frame, [durationInFrames - 22, durationInFrames - 2], [1, 0], clamp);
  const box = enter(frame, fps, 4, 18);
  const tally = interpolate(frame, [120, 175], [0, 1], { ...clamp, easing: ease });
  const why = enter(frame, fps, 200, 16);
  const unasked = enter(frame, fps, 222, 16);
  const max = Math.max(...copy.values);
  // People answering: small ticks land on the options one after another.
  const ticks = Array.from({ length: 24 }, (_, k) => ({ at: 40 + k * 3, option: [0, 1, 0, 2, 1, 0, 3, 0, 1, 2, 0, 1, 0, 2, 1, 0, 3, 1, 0, 2, 0, 1, 0, 1][k]! }));

  return (
    <AbsoluteFill style={{ opacity: fade, fontFamily: font }}>
      <div style={{ ...card, position: "absolute", left: 90, right: 90, top: 80, padding: "40px 44px 44px", opacity: box, transform: `translateY(${(1 - box) * 20}px)` }}>
        <p style={{ margin: 0, fontSize: 30, color: color.muted }}>{copy.label}</p>
        <p style={{ margin: "12px 0 34px", fontSize: 50, lineHeight: 1.16, color: color.ink }}>{copy.question}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {copy.options.map((option, i) => {
            const count = ticks.filter((t) => t.option === i && frame >= t.at).length;
            const checked = count > 0;
            const width = (copy.values[i]! / max) * 100 * tally;
            return (
              <div key={option} style={{ position: "relative", height: 80, borderRadius: 18, background: color.track, overflow: "hidden" }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${width}%`, background: i === 0 ? "#7cc4c4" : "#cfe9e9", borderRadius: 18 }} />
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", gap: 20, padding: "0 24px" }}>
                  <span
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      border: `3px solid ${checked ? color.teal : color.faint}`,
                      background: checked ? color.teal : "#fff",
                      color: "#fff",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 24,
                      opacity: 1 - tally * 0.9,
                      flex: "none"
                    }}
                  >
                    {checked ? "✓" : ""}
                  </span>
                  <span style={{ fontSize: 38, color: color.ink, flex: 1 }}>{option}</span>
                  <span style={{ fontSize: 40, fontWeight: 500, color: color.ink, opacity: tally }}>{Math.round(copy.values[i]! * tally)}%</span>
                </div>
              </div>
            );
          })}
        </div>
        <p style={{ margin: "26px 0 0", fontSize: 28, color: color.muted, opacity: tally }}>{copy.respondents}</p>
      </div>

      <div style={{ position: "absolute", left: 90, right: 90, top: 870, display: "flex", flexWrap: "wrap", gap: 18 }}>
        <span style={{ fontSize: 38, fontWeight: 500, color: color.coral, border: `3px dashed ${color.coral}`, padding: "8px 20px", borderRadius: 999, opacity: why, transform: `translateY(${(1 - why) * 10}px)` }}>{copy.why}</span>
        <span style={{ fontSize: 38, fontWeight: 500, color: color.coral, border: `3px dashed ${color.coral}`, padding: "8px 20px", borderRadius: 999, opacity: unasked, transform: `translateY(${(1 - unasked) * 10}px)` }}>{copy.unasked}</span>
      </div>
    </AbsoluteFill>
  );
}

"use client";

import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "./runtime";
import { color, font } from "./theme";
import { clamp, enter } from "./util";
import { OFFER } from "./sizes";

export { OFFER };

/**
 * The three ways of working with Noisia, each as a square 1080 animation for Solutions:
 * the monthly report, the study and the annual plan. Numbers are illustrative.
 */


const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const fadeOut = (frame: number) => interpolate(frame, [OFFER.frames - 22, OFFER.frames - 2], [1, 0], clamp);
const card = { background: "#fff", borderRadius: 30, boxShadow: "0 18px 50px rgba(10,10,10,0.08)", fontFamily: font } as const;

/* ---------------------------------------------------------------- report */

export type ReportCopy = {
  months: [string, string, string];
  brands: [string, string, string];
  shareLabel: string;
  changeTitle: string;
  changes: { dir: "up" | "down" | "new"; text: string }[];
};

// Share of conversation per month: your brand, competitor A, competitor B.
const SHARE = [
  [34, 41, 25],
  [37, 39, 24],
  [45, 33, 22]
];

export function ReportComposition({ copy }: { copy: ReportCopy }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const head = enter(frame, fps, 2, 18);
  const month = Math.min(2, Math.floor(interpolate(frame, [40, 150], [0, 3], clamp)));
  const changes = enter(frame, fps, 170, 18);
  const tones = [color.teal, "#9fb8b8", "#d5dede"];

  return (
    <AbsoluteFill style={{ opacity: fadeOut(frame), fontFamily: font }}>
      <div style={{ ...card, position: "absolute", left: 60, right: 60, top: 60, padding: "34px 40px", opacity: head }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <span style={{ fontSize: 36, fontWeight: 500, color: color.ink }}>{copy.shareLabel}</span>
          <span style={{ display: "flex", gap: 26, fontSize: 26, color: color.muted }}>
            {copy.brands.map((brand, k) => (
              <span key={brand} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 16, height: 16, borderRadius: 8, background: tones[k] }} />
                {brand}
              </span>
            ))}
          </span>
        </div>
        <div style={{ marginTop: 36, display: "flex", flexDirection: "column", gap: 24 }}>
          {SHARE.map((row, m) => {
            const p = interpolate(frame, [30 + m * 36, 62 + m * 36], [0, 1], { ...clamp, easing: ease });
            const current = m === month;
            return (
              <div key={m} style={{ display: "grid", gridTemplateColumns: "90px 1fr", alignItems: "center", gap: 20, opacity: 0.35 + 0.65 * p }}>
                <span style={{ fontSize: 30, fontWeight: current ? 500 : 400, color: current ? color.ink : color.muted }}>{copy.months[m]}</span>
                <div style={{ display: "flex", height: 52, borderRadius: 14, overflow: "hidden", background: color.track, boxShadow: current ? `0 0 0 4px ${color.tealSoft}` : "none" }}>
                  {row.map((v, k) => (
                    <div key={k} style={{ width: `${v * p}%`, background: tones[k], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 500, color: k === 0 ? "#fff" : color.fg }}>
                      {p > 0.9 ? `${v}%` : ""}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ ...card, position: "absolute", left: 60, right: 60, top: 560, padding: "32px 40px", background: color.tealSoft, boxShadow: "none", opacity: changes, transform: `translateY(${(1 - changes) * 22}px)` }}>
        <p style={{ margin: 0, fontSize: 30, fontWeight: 500, color: color.teal }}>{copy.changeTitle}</p>
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 16 }}>
          {copy.changes.map((change, k) => {
            const p = enter(frame, fps, 186 + k * 14, 18);
            const tone = change.dir === "up" ? color.teal : change.dir === "down" ? color.coral : color.ink;
            const mark = change.dir === "up" ? "↑" : change.dir === "down" ? "↓" : "＋";
            return (
              <p key={change.text} style={{ margin: 0, display: "flex", gap: 16, alignItems: "baseline", fontSize: 38, lineHeight: 1.2, color: color.ink, opacity: p, transform: `translateX(${(1 - p) * 16}px)` }}>
                <span style={{ color: tone, fontWeight: 500 }}>{mark}</span>
                {change.text}
              </p>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}

/* ---------------------------------------------------------------- study */

export type StudyCopy = {
  steps: { label: string; text: string }[];
  method: string;
  recommendations: [string, string, string];
};

export function StudyComposition({ copy }: { copy: StudyCopy }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tops = [70, 290, 470];
  const line = interpolate(frame, [30, 200], [0, 1], clamp);

  return (
    <AbsoluteFill style={{ opacity: fadeOut(frame), fontFamily: font }}>
      <svg width={1080} height={1080} style={{ position: "absolute", inset: 0 }} aria-hidden>
        <line x1={110} y1={120} x2={110} y2={700} stroke={color.line} strokeWidth={4} />
        <line x1={110} y1={120} x2={110} y2={120 + 580 * line} stroke={color.teal} strokeWidth={4} />
      </svg>
      {copy.steps.slice(0, 3).map((step, i) => {
        const p = enter(frame, fps, 10 + i * 55, 18);
        const isMethod = i === 2;
        return (
          <div key={step.label} style={{ position: "absolute", left: 70, right: 60, top: tops[i], display: "grid", gridTemplateColumns: "80px 1fr", gap: 24, opacity: p, transform: `translateY(${(1 - p) * 18}px)` }}>
            <span style={{ width: 80, height: 80, borderRadius: 40, background: color.teal, color: "#fff", display: "grid", placeItems: "center", fontSize: 34, fontWeight: 500 }}>{i + 1}</span>
            <div>
              <p style={{ margin: 0, fontSize: 28, color: color.muted }}>{step.label}</p>
              {isMethod ? (
                <span style={{ display: "inline-block", marginTop: 10, fontSize: 40, fontWeight: 500, padding: "10px 24px", borderRadius: 999, background: color.teal, color: "#fff" }}>{copy.method}</span>
              ) : (
                <p style={{ margin: "8px 0 0", fontSize: i === 0 ? 46 : 40, lineHeight: 1.15, color: color.ink }}>{step.text}</p>
              )}
            </div>
          </div>
        );
      })}

      {(() => {
        const p = enter(frame, fps, 180, 18);
        const last = copy.steps[3]!;
        return (
          <div style={{ ...card, position: "absolute", left: 60, right: 60, top: 650, padding: "30px 38px", background: color.tealSoft, boxShadow: "none", opacity: p, transform: `translateY(${(1 - p) * 22}px)` }}>
            <p style={{ margin: 0, fontSize: 28, fontWeight: 500, color: color.teal }}>{last.label}</p>
            <p style={{ margin: "8px 0 0", fontSize: 42, lineHeight: 1.15, color: color.ink }}>{last.text}</p>
            <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
              {copy.recommendations.map((rec, k) => (
                <p key={rec} style={{ margin: 0, fontSize: 30, color: color.fg, opacity: enter(frame, fps, 200 + k * 12, 18) }}>
                  → {rec}
                </p>
              ))}
            </div>
          </div>
        );
      })()}
    </AbsoluteFill>
  );
}

/* ---------------------------------------------------------------- plan */

export type PlanCopy = {
  months: string[];
  reportLabel: string;
  studies: { month: number; label: string }[];
  caption: string;
};

export function PlanComposition({ copy }: { copy: PlanCopy }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const left = 80;
  const width = 920;
  const step = width / 11;
  const run = interpolate(frame, [20, 160], [0, 1], clamp);
  const caption = enter(frame, fps, 230, 18);
  const lineY = 620;

  return (
    <AbsoluteFill style={{ opacity: fadeOut(frame), fontFamily: font }}>
      <svg width={1080} height={1080} style={{ position: "absolute", inset: 0 }} aria-hidden>
        <line x1={left} y1={lineY} x2={left + width} y2={lineY} stroke={color.line} strokeWidth={6} strokeLinecap="round" />
        <line x1={left} y1={lineY} x2={left + width * run} y2={lineY} stroke={color.teal} strokeWidth={6} strokeLinecap="round" />
        {copy.months.map((_, m) => {
          const on = run * 11 >= m;
          return <circle key={m} cx={left + m * step} cy={lineY} r={on ? 12 : 8} fill={on ? color.teal : "#fff"} stroke={on ? color.teal : color.faint} strokeWidth={4} />;
        })}
      </svg>
      {copy.months.map((month, m) => (
        <span key={month} style={{ position: "absolute", left: left + m * step, top: lineY + 34, transform: "translateX(-50%)", fontSize: 26, color: color.muted }}>
          {month}
        </span>
      ))}
      <span style={{ position: "absolute", left, top: lineY + 90, fontSize: 30, fontWeight: 500, color: color.teal, opacity: enter(frame, fps, 30, 18), display: "inline-flex", alignItems: "center", gap: 14 }}>
        <span style={{ width: 40, height: 6, borderRadius: 3, background: color.teal }} />
        {copy.reportLabel}
      </span>

      {copy.studies.map((study, k) => {
        const p = enter(frame, fps, 90 + k * 26, 16);
        const x = left + study.month * step;
        const high = k % 2 === 0;
        const top = high ? 240 : 400;
        return (
          <div key={study.label}>
            <div style={{ position: "absolute", left: x - 2, top: top + 90, width: 4, height: lineY - top - 90, background: color.teal, opacity: p * 0.8, transformOrigin: "bottom", transform: `scaleY(${p})` }} />
            <div
              style={{
                ...card,
                position: "absolute",
                left: Math.min(Math.max(x - 130, 40), 1080 - 300),
                top,
                width: 260,
                padding: "20px 24px",
                background: color.tealSoft,
                boxShadow: "none",
                border: `3px solid #bfe5e5`,
                color: color.ink,
                opacity: p,
                transform: `translateY(${(1 - p) * 20}px)`
              }}
            >
              <p style={{ margin: 0, fontSize: 24, color: color.teal }}>{copy.months[study.month]}</p>
              <p style={{ margin: "6px 0 0", fontSize: 32, lineHeight: 1.15, fontWeight: 500 }}>{study.label}</p>
            </div>
          </div>
        );
      })}

      <p style={{ position: "absolute", left: 80, right: 80, top: 80, margin: 0, fontSize: 44, lineHeight: 1.2, color: color.ink, opacity: caption, transform: `translateY(${(1 - caption) * 16}px)` }}>{copy.caption}</p>
    </AbsoluteFill>
  );
}

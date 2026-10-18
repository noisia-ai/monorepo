"use client";

import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "./runtime";
import { color, font } from "./theme";
import { clamp, enter } from "./util";

export const HERO = { width: 1080, height: 1080, fps: 30, durationInFrames: 390 } as const;

export type HeroCopy = {
  question: string;
  clusters: [string, string, string, string, string];
  noise: string;
  approved: string;
  answerLabel: string;
  answer: string;
  quote: string;
};

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Cluster centers on the 1080 canvas; index 5 is the noise pile that gets filtered out.
const CENTERS = [
  { x: 300, y: 470 },
  { x: 560, y: 400 },
  { x: 800, y: 500 },
  { x: 420, y: 680 },
  { x: 700, y: 700 },
  { x: 960, y: 820 }
];
const HIGHLIGHT = 3;

const DOTS = (() => {
  const r = rng(17);
  return Array.from({ length: 150 }, (_, i) => {
    const cluster = i % 9 === 0 ? 5 : Math.floor(r() * 5);
    const angle = r() * Math.PI * 2;
    const radius = Math.sqrt(r()) * (cluster === 5 ? 60 : 78);
    return {
      sx: 80 + r() * 920,
      sy: 260 + r() * 640,
      tx: CENTERS[cluster]!.x + Math.cos(angle) * radius,
      ty: CENTERS[cluster]!.y + Math.sin(angle) * radius,
      cluster,
      delay: Math.floor(r() * 50),
      phase: r() * Math.PI * 2
    };
  });
})();

export function HeroComposition({ copy }: { copy: HeroCopy }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const fadeAll = interpolate(frame, [durationInFrames - 20, durationInFrames], [1, 0], clamp);
  const gather = interpolate(frame, [130, 200], [0, 1], { ...clamp, easing: (t) => 1 - Math.pow(1 - t, 3) });
  const labels = enter(frame, fps, 196, 20);
  const noiseOut = interpolate(frame, [215, 245], [1, 0.12], clamp);
  const focus = enter(frame, fps, 245, 16);
  const approved = enter(frame, fps, 262, 14);
  const line = interpolate(frame, [270, 300], [0, 1], clamp);
  const answer = enter(frame, fps, 292, 18);
  const question = enter(frame, fps, 4, 18);
  const typed = Math.floor(interpolate(frame, [8, 60], [0, copy.question.length], clamp));
  const hi = CENTERS[HIGHLIGHT]!;

  return (
    <AbsoluteFill style={{ background: "transparent", opacity: fadeAll }}>
      {/* the question */}
      <div
        style={{
          position: "absolute",
          left: 60,
          top: 60,
          width: 760,
          padding: "30px 38px",
          borderRadius: 32,
          background: "#fff",
          boxShadow: "0 18px 50px rgba(10,10,10,0.08)",
          opacity: question,
          transform: `translateY(${(1 - question) * 20}px)`
        }}
      >
        <p style={{ margin: 0, fontFamily: font, fontSize: 50, lineHeight: 1.2, color: color.ink }}>
          {copy.question.slice(0, typed)}
          <span style={{ opacity: frame % 30 < 15 && typed < copy.question.length ? 1 : 0, color: color.teal }}>|</span>
        </p>
      </div>

      {/* the conversation */}
      <svg width={1080} height={1080} style={{ position: "absolute", inset: 0 }} aria-hidden>
        {DOTS.map((dot, i) => {
          const appear = interpolate(frame, [30 + dot.delay, 50 + dot.delay], [0, 1], clamp);
          const wobble = (1 - gather) * 8;
          const x = dot.sx + (dot.tx - dot.sx) * gather + Math.cos(frame / 20 + dot.phase) * wobble;
          const y = dot.sy + (dot.ty - dot.sy) * gather + Math.sin(frame / 24 + dot.phase) * wobble;
          const isNoise = dot.cluster === 5;
          const isHi = dot.cluster === HIGHLIGHT;
          const fill = isNoise ? color.faint : isHi && focus > 0.05 ? color.teal : gather > 0.6 ? "#7cc4c4" : color.muted;
          const dim = !isHi && focus > 0 ? 1 - focus * 0.45 : 1;
          return <circle key={i} cx={x} cy={y} r={isHi ? 8 + focus * 2 : 7} fill={fill} opacity={appear * (isNoise ? noiseOut : dim)} />;
        })}
        {/* the line from the approved cluster to the answer */}
        <path
          d={`M ${hi.x + 60} ${hi.y + 76} C ${hi.x + 90} ${hi.y + 130}, 470 ${hi.y + 120}, 500 ${hi.y + 110}`}
          stroke={color.teal}
          strokeWidth={4}
          fill="none"
          strokeDasharray={600}
          strokeDashoffset={600 * (1 - line)}
          strokeLinecap="round"
        />
        <circle cx={hi.x} cy={hi.y} r={96} fill="none" stroke={color.teal} strokeWidth={4} opacity={focus} />
      </svg>

      {/* cluster labels */}
      {CENTERS.slice(0, 5).map((center, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: center.x,
            top: center.y - 128,
            transform: `translate(-50%, ${(1 - labels) * 12}px)`,
            fontFamily: font,
            fontSize: 40,
            fontWeight: i === HIGHLIGHT ? 500 : 400,
            color: i === HIGHLIGHT && focus > 0.1 ? color.teal : color.fg,
            opacity: labels * (i === HIGHLIGHT || focus === 0 ? 1 : 1 - focus * 0.5),
            whiteSpace: "nowrap",
            background: "rgba(255,255,255,0.85)",
            padding: "4px 14px",
            borderRadius: 999
          }}
        >
          {copy.clusters[i]}
        </span>
      ))}
      <span
        style={{
          position: "absolute",
          left: CENTERS[5]!.x,
          top: CENTERS[5]!.y - 100,
          transform: "translateX(-50%)",
          fontFamily: font,
          fontSize: 34,
          color: color.muted,
          opacity: labels * noiseOut * 1.4,
          textDecoration: "line-through"
        }}
      >
        {copy.noise}
      </span>

      {/* the human in the loop */}
      <span
        style={{
          position: "absolute",
          left: 40,
          top: hi.y + 118,
          fontFamily: font,
          fontSize: 32,
          fontWeight: 500,
          color: "#fff",
          background: color.ink,
          padding: "8px 16px",
          borderRadius: 999,
          opacity: approved,
          transform: `scale(${0.85 + approved * 0.15})`,
          whiteSpace: "nowrap"
        }}
      >
        ✓ {copy.approved}
      </span>

      {/* the answer */}
      <div
        style={{
          position: "absolute",
          left: 480,
          top: 790,
          width: 570,
          padding: "26px 30px",
          borderRadius: 30,
          background: color.tealSoft,
          opacity: answer,
          transform: `translateY(${(1 - answer) * 24}px)`
        }}
      >
        <p style={{ margin: 0, fontFamily: font, fontSize: 30, color: color.teal, fontWeight: 500 }}>{copy.answerLabel}</p>
        <p style={{ margin: "8px 0 0", fontFamily: font, fontSize: 42, lineHeight: 1.15, color: color.ink }}>{copy.answer}</p>
        <p style={{ margin: "12px 0 0", fontFamily: font, fontSize: 30, lineHeight: 1.3, color: color.muted }}>“{copy.quote}”</p>
      </div>
    </AbsoluteFill>
  );
}

"use client";

import type { CSSProperties, ReactNode } from "react";
import type { Scene } from "@/content/stories/schema";
import { interpolate, useCurrentFrame, useVideoConfig } from "./runtime";
import { color, font, SAFE } from "./theme";
import { clamp, countUp, enter, formatNumber, rise } from "./util";

type SceneProps<T extends Scene["type"]> = {
  scene: Extract<Scene, { type: T }>;
  locale: string;
  bottomSafe: number;
};

const text = (size: number, weight = 500, extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: font,
  fontSize: size,
  fontWeight: weight,
  lineHeight: 1.12,
  letterSpacing: 0,
  color: color.ink,
  margin: 0,
  ...extra
});

/** Fades the whole scene in and out at its edges and keeps content inside the safe area. */
function Shell({ bottomSafe, align = "center", children }: { bottomSafe: number; align?: "center" | "start"; children: ReactNode }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = interpolate(frame, [0, 8, durationInFrames - 8, durationInFrames], [0, 1, 1, 0], clamp);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: `${SAFE.top + 40}px ${SAFE.side}px ${bottomSafe}px`,
        display: "flex",
        flexDirection: "column",
        justifyContent: align === "center" ? "center" : "flex-start",
        gap: 40,
        opacity
      }}
    >
      {children}
    </div>
  );
}

function Words({ value, size, delay = 0, stagger = 3, color: tone = color.ink }: { value: string; size: number; delay?: number; stagger?: number; color?: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <p style={text(size, 500, { display: "flex", flexWrap: "wrap", columnGap: size * 0.26, rowGap: size * 0.04, color: tone })}>
      {value.split(" ").map((word, i) => (
        <span key={`${word}-${i}`} style={{ display: "inline-block", ...rise(frame, fps, delay + i * stagger, size * 0.4) }}>
          {word}
        </span>
      ))}
    </p>
  );
}

export function HookScene({ scene, bottomSafe }: SceneProps<"hook">) {
  const size = scene.text.length > 48 ? 92 : 112;
  return (
    <Shell bottomSafe={bottomSafe}>
      <Words value={scene.text} size={size} stagger={3} />
    </Shell>
  );
}

export function StatScene({ scene, locale, bottomSafe }: SceneProps<"stat">) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const shown = countUp(frame, scene.value, 6, 34);
  const digits = formatNumber(shown, scene.value, locale).length + scene.suffix.length;
  const size = digits > 6 ? 230 : 300;
  return (
    <Shell bottomSafe={bottomSafe}>
      <p style={text(size, 500, { lineHeight: 0.92, color: color.teal, fontVariantNumeric: "tabular-nums", ...rise(frame, fps, 0, 30) })}>
        {formatNumber(shown, scene.value, locale)}
        <span style={{ fontSize: size * 0.5 }}>{scene.suffix}</span>
      </p>
      <p style={text(64, 500, rise(frame, fps, 18))}>{scene.label}</p>
      {scene.context ? <p style={text(44, 400, { color: color.muted, ...rise(frame, fps, 30) })}>{scene.context}</p> : null}
    </Shell>
  );
}

function BarRow({ label, value, max, unit, delay, highlight, locale }: { label: string; value: number; max: number; unit: string; delay: number; highlight: boolean; locale: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = enter(frame, fps, delay, 22);
  const width = Math.max(0.02, Math.abs(value) / max) * 100 * p;
  const tone = highlight ? color.teal : color.faint;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, opacity: Math.min(1, p * 1.4) }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 24 }}>
        <span style={text(46, highlight ? 500 : 400, { color: highlight ? color.ink : color.fg })}>{label}</span>
        <span style={text(54, 500, { color: highlight ? color.teal : color.muted, fontVariantNumeric: "tabular-nums" })}>
          {formatNumber(countUp(frame, value, delay, 26), value, locale)}
          {unit}
        </span>
      </div>
      <div style={{ height: 26, borderRadius: 13, background: color.track, overflow: "hidden" }}>
        <div style={{ width: `${width}%`, height: "100%", borderRadius: 13, background: tone }} />
      </div>
    </div>
  );
}

export function CompareScene({ scene, locale, bottomSafe }: SceneProps<"compare">) {
  const max = Math.max(...scene.items.map((item) => Math.abs(item.value)), 1);
  return (
    <Shell bottomSafe={bottomSafe}>
      <div style={{ display: "flex", flexDirection: "column", gap: 54 }}>
        {scene.items.map((item, i) => (
          <BarRow key={item.label} {...item} max={max} unit={scene.unit} delay={6 + i * 9} highlight={Boolean(item.highlight)} locale={locale} />
        ))}
      </div>
    </Shell>
  );
}

export function JourneyScene({ scene, locale, bottomSafe }: SceneProps<"journey">) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const max = Math.max(...scene.steps.map((step) => Math.abs(step.value)), 1);
  // Diverging bars only when the steps really mix positive and negative values.
  const diverging = scene.steps.some((step) => step.value < 0) && scene.steps.some((step) => step.value > 0);
  return (
    <Shell bottomSafe={bottomSafe}>
      <div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
        {scene.steps.map((step, i) => {
          const delay = 4 + i * 8;
          const p = enter(frame, fps, delay, 20);
          const isHi = i === scene.highlightIndex;
          const negative = step.value < 0;
          const strong = negative ? color.coral : color.teal;
          const soft = negative ? "#f3c2b7" : "#a9dada";
          const share = (Math.abs(step.value) / max) * p;
          return (
            <div
              key={step.label}
              style={{ display: "grid", gridTemplateColumns: "300px 1fr 170px", alignItems: "center", gap: 24, opacity: Math.min(1, p * 1.5) }}
            >
              <span style={text(isHi ? 50 : 44, isHi ? 500 : 400, { color: isHi ? color.ink : color.fg })}>{step.label}</span>
              <div style={{ position: "relative", height: 44 }}>
                <div style={{ position: "absolute", inset: 0, borderRadius: 22, background: color.track }} />
                {diverging ? <div style={{ position: "absolute", left: "50%", top: -10, bottom: -10, width: 3, background: color.line }} /> : null}
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    borderRadius: 22,
                    background: isHi ? strong : soft,
                    width: `${(diverging ? 50 : 100) * share}%`,
                    left: diverging ? (negative ? `${50 - 50 * share}%` : "50%") : 0,
                    boxShadow: isHi ? `0 0 0 ${10 * p}px ${negative ? color.coralSoft : color.tealSoft}` : "none"
                  }}
                />
              </div>
              <span style={text(isHi ? 50 : 44, 500, { textAlign: "right", color: isHi ? strong : color.muted, fontVariantNumeric: "tabular-nums" })}>
                {step.value > 0 && diverging ? "+" : ""}
                {formatNumber(countUp(frame, step.value, delay, 24), step.value, locale)}
                {scene.unit}
              </span>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}

export function SplitScene({ scene, locale, bottomSafe }: SceneProps<"split">) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const side = (item: typeof scene.left, delay: number, tone: string) => (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 18, ...rise(frame, fps, delay) }}>
      <p style={text(170, 500, { color: tone, lineHeight: 0.95, fontVariantNumeric: "tabular-nums" })}>
        {formatNumber(countUp(frame, item.value, delay, 30), item.value, locale)}
        <span style={{ fontSize: 90 }}>{item.suffix}</span>
      </p>
      <p style={text(44, 400, { color: color.fg })}>{item.label}</p>
    </div>
  );
  return (
    <Shell bottomSafe={bottomSafe}>
      <div style={{ display: "flex", gap: 48, alignItems: "flex-start" }}>
        {side(scene.left, 4, color.teal)}
        <div style={{ width: 3, alignSelf: "stretch", background: color.line, transform: `scaleY(${enter(frame, fps, 10)})` }} />
        {side(scene.right, 16, color.coral)}
      </div>
      {scene.caption ? <p style={text(50, 500, rise(frame, fps, 34))}>{scene.caption}</p> : null}
    </Shell>
  );
}

export function TensionScene({ scene, locale, bottomSafe }: SceneProps<"tension">) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const strike = interpolate(frame, [44, 62], [0, 1], clamp);
  return (
    <Shell bottomSafe={bottomSafe}>
      <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
        <div style={{ position: "relative", alignSelf: "flex-start" }}>
          <Words value={scene.want} size={92} delay={2} />
          <div style={{ position: "absolute", left: 0, top: "54%", height: 8, width: `${strike * 100}%`, background: color.coral, borderRadius: 4 }} />
        </div>
        <Words value={scene.but} size={92} delay={30} color={color.coral} />
        {scene.value != null ? (
          <p style={text(56, 500, { color: color.muted, ...rise(frame, fps, 64) })}>
            {formatNumber(countUp(frame, scene.value, 64, 24), scene.value, locale)}%
          </p>
        ) : null}
      </div>
    </Shell>
  );
}

export function QuoteScene({ scene, bottomSafe }: SceneProps<"quote">) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const size = scene.text.length > 150 ? 58 : scene.text.length > 90 ? 68 : 80;
  return (
    <Shell bottomSafe={bottomSafe}>
      <div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
        <span style={text(220, 500, { color: color.teal, lineHeight: 0.6, height: 110, ...rise(frame, fps, 0, 20) })}>“</span>
        <p style={text(size, 400, { color: color.ink, lineHeight: 1.22, ...rise(frame, fps, 6) })}>{scene.text}</p>
        {scene.translation ? <p style={text(40, 400, { color: color.muted, ...rise(frame, fps, 20) })}>{scene.translation}</p> : null}
        <div style={{ display: "flex", gap: 18, alignItems: "center", ...rise(frame, fps, 26) }}>
          <span style={text(36, 500, { padding: "12px 26px", borderRadius: 999, background: color.tealSoft, color: color.teal })}>{scene.platform}</span>
          {scene.meta ? <span style={text(36, 400, { color: color.muted })}>{scene.meta}</span> : null}
        </div>
      </div>
    </Shell>
  );
}

export function TakeawayScene({ scene, bottomSafe }: SceneProps<"takeaway">) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = enter(frame, fps, 0, 22);
  return (
    <Shell bottomSafe={bottomSafe}>
      <div
        style={{
          padding: "64px 60px",
          borderRadius: 48,
          background: color.tealSoft,
          transform: `scale(${0.94 + p * 0.06})`,
          opacity: p
        }}
      >
        <Words value={scene.text} size={78} delay={6} stagger={2} />
      </div>
    </Shell>
  );
}

export function SceneView({ scene, locale, bottomSafe }: { scene: Scene; locale: string; bottomSafe: number }) {
  switch (scene.type) {
    case "hook":
      return <HookScene scene={scene} locale={locale} bottomSafe={bottomSafe} />;
    case "stat":
      return <StatScene scene={scene} locale={locale} bottomSafe={bottomSafe} />;
    case "compare":
      return <CompareScene scene={scene} locale={locale} bottomSafe={bottomSafe} />;
    case "journey":
      return <JourneyScene scene={scene} locale={locale} bottomSafe={bottomSafe} />;
    case "split":
      return <SplitScene scene={scene} locale={locale} bottomSafe={bottomSafe} />;
    case "tension":
      return <TensionScene scene={scene} locale={locale} bottomSafe={bottomSafe} />;
    case "quote":
      return <QuoteScene scene={scene} locale={locale} bottomSafe={bottomSafe} />;
    case "takeaway":
      return <TakeawayScene scene={scene} locale={locale} bottomSafe={bottomSafe} />;
  }
}

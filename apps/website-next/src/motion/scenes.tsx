"use client";

import type { CSSProperties, ReactNode } from "react";
import { Calendar } from "iconoir-react";
import type { Scene } from "@/content/stories/schema";
import { SourceIcon, sourceLabel } from "@/components/brand/SourceMark";
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
  const shift = interpolate(frame, [0, 12, durationInFrames - 10, durationInFrames], [36, 0, 0, -36], { ...clamp, easing: (t) => 1 - Math.pow(1 - t, 3) });
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: `${SAFE.top + 40}px ${SAFE.side}px ${bottomSafe}px`,
        display: "flex",
        flexDirection: "column",
        justifyContent: align === "center" ? "center" : "flex-start",
        gap: 44,
        opacity,
        transform: `translateY(${shift}px)`
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
  const size = scene.text.length > 48 ? 104 : 128;
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
      <p style={text(70, 500, rise(frame, fps, 18))}>{scene.label}</p>
      {scene.context ? <p style={text(48, 400, { color: color.muted, ...rise(frame, fps, 30) })}>{scene.context}</p> : null}
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
        <span style={text(54, highlight ? 500 : 400, { color: highlight ? color.ink : color.fg })}>{label}</span>
        <span style={text(62, 500, { color: highlight ? color.teal : color.muted, fontVariantNumeric: "tabular-nums" })}>
          {formatNumber(countUp(frame, value, delay, 26), value, locale)}
          {unit}
        </span>
      </div>
      <div style={{ height: 32, borderRadius: 16, background: color.track, overflow: "hidden" }}>
        <div style={{ width: `${width}%`, height: "100%", borderRadius: 16, background: tone }} />
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
      <p style={text(200, 500, { color: tone, lineHeight: 0.95, fontVariantNumeric: "tabular-nums" })}>
        {formatNumber(countUp(frame, item.value, delay, 30), item.value, locale)}
        <span style={{ fontSize: 100 }}>{item.suffix}</span>
      </p>
      <p style={text(50, 400, { color: color.fg })}>{item.label}</p>
    </div>
  );
  return (
    <Shell bottomSafe={bottomSafe}>
      <div style={{ display: "flex", gap: 48, alignItems: "flex-start" }}>
        {side(scene.left, 4, color.teal)}
        <div style={{ width: 3, alignSelf: "stretch", background: color.line, transform: `scaleY(${enter(frame, fps, 10)})` }} />
        {side(scene.right, 16, color.coral)}
      </div>
      {scene.caption ? <p style={text(58, 500, rise(frame, fps, 34))}>{scene.caption}</p> : null}
    </Shell>
  );
}

/** Words that get crossed out one by one, so the strike follows the text across line breaks. */
function StruckWords({ value, size, delay, strikeAt }: { value: string; size: number; delay: number; strikeAt: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = value.split(" ");
  return (
    <p style={text(size, 500, { display: "flex", flexWrap: "wrap", columnGap: size * 0.26, rowGap: size * 0.04 })}>
      {words.map((word, i) => {
        const strike = interpolate(frame, [strikeAt + i * 3, strikeAt + i * 3 + 10], [0, 1], clamp);
        return (
          <span
            key={`${word}-${i}`}
            style={{
              display: "inline-block",
              color: strike > 0.5 ? color.muted : color.ink,
              backgroundImage: `linear-gradient(${color.coral}, ${color.coral})`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "0 56%",
              backgroundSize: `${Math.round(strike * 100)}% ${Math.round(size * 0.07)}px`,
              ...rise(frame, fps, delay + i * 3, size * 0.4)
            }}
          >
            {word}
          </span>
        );
      })}
    </p>
  );
}

export function TensionScene({ scene, locale, bottomSafe }: SceneProps<"tension">) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Shell bottomSafe={bottomSafe}>
      <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
        <StruckWords value={scene.want} size={100} delay={2} strikeAt={44} />
        <Words value={scene.but} size={100} delay={30} color={color.coral} />
        {scene.value != null ? (
          <p style={text(56, 500, { color: color.muted, ...rise(frame, fps, 64) })}>
            {formatNumber(countUp(frame, scene.value, 64, 24), scene.value, locale)}%
          </p>
        ) : null}
      </div>
    </Shell>
  );
}

/** A mention as it was posted: chat bubble, then the platform's logo and when it was said. */
export function QuoteScene({ scene, locale, bottomSafe }: SceneProps<"quote">) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const size = scene.text.length > 150 ? 62 : scene.text.length > 90 ? 72 : 84;
  return (
    <Shell bottomSafe={bottomSafe}>
      <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
        <div style={{ position: "relative", marginLeft: 22, ...rise(frame, fps, 0, 30) }}>
          <svg width={44} height={40} viewBox="0 0 18 16" style={{ position: "absolute", left: -21, bottom: 0 }} aria-hidden>
            <path d="M18 0 C18 9 13 15 0 16 C8 12 9 6 9 0 Z" fill={color.bubble} />
          </svg>
          <div style={{ background: color.bubble, borderRadius: "56px 56px 56px 16px", padding: "48px 56px" }}>
            <p style={text(size, 400, { color: color.ink, lineHeight: 1.24 })}>{scene.text}</p>
            {scene.translation ? <p style={text(40, 400, { color: color.muted, lineHeight: 1.3, marginTop: 24 })}>{scene.translation}</p> : null}
          </div>
        </div>
        <div style={{ display: "flex", gap: 36, alignItems: "center", marginLeft: 22, ...rise(frame, fps, 16) }}>
          <span style={text(38, 500, { display: "inline-flex", alignItems: "center", gap: 14, color: color.fg })}>
            <SourceIcon name={scene.platform} size={46} />
            {sourceLabel(scene.platform, locale)}
          </span>
          {scene.meta ? (
            <span style={text(38, 400, { display: "inline-flex", alignItems: "center", gap: 12, color: color.muted })}>
              <Calendar width={40} height={40} strokeWidth={1.7} aria-hidden />
              {scene.meta}
            </span>
          ) : null}
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
        <Words value={scene.text} size={86} delay={6} stagger={2} />
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

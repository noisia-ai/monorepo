"use client";
/* eslint-disable @next/next/no-img-element -- the logo inside fixed-size mockups */

import { useState, type ReactNode } from "react";
import { Calendar, MediaVideo, Page, Presentation, StatsUpSquare, User } from "iconoir-react";
import { Stage } from "@/motion/runtime";
import { color, font } from "@/motion/theme";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SourceIcon } from "@/components/brand/SourceMark";
import { LOGO_RATIO } from "@/components/brand/Logo";
import type { FeedStory } from "@/components/feed/types";
import type { FormatKey, FormatMock } from "@/content/pages/offer";
import { PhoneStory } from "./PhoneStory";
import styles from "./offer.module.css";

const W = 1200;
const H = 1000;
const ICONS = { live: Presentation, document: Page, dashboard: StatsUpSquare, stories: MediaVideo } as const;

/**
 * The same finding in each format: a segmented control and, for each format, a mockup on a
 * fixed 1200×1000 canvas that the Stage scales to any width. Mockups are illustrative.
 */
export function FormatShowcase({ items, mock, story, label }: { items: { key: FormatKey; name: string; text: string }[]; mock: FormatMock; story?: FeedStory; label: string }) {
  const [active, setActive] = useState(0);
  const current = items[active]!.key;

  return (
    <div className={styles.showcase}>
      <div className={styles.showcaseControl}>
        <SegmentedControl options={items.map((item) => ({ key: item.key, label: item.name }))} active={active} onChange={setActive} label={label} />
      </div>
      <div className={styles.showcaseStage}>
        <Stage durationInFrames={1} width={W} height={H} label={items[active]!.name} className={styles.showcaseCanvas}>
          <Layer on={current === "live"}>
            <LiveMock copy={mock.live} />
          </Layer>
          <Layer on={current === "document"}>
            <DocumentMock copy={mock.document} />
          </Layer>
          <Layer on={current === "dashboard"}>
            <DashboardMock copy={mock.dashboard} />
          </Layer>
        </Stage>
        {/* The phone lives outside the scaled canvas: a Stage inside a Stage would be scaled twice. */}
        <div className={styles.phoneSlot} data-active={current === "stories"} aria-hidden={current !== "stories"}>
          {story && current === "stories" ? <PhoneStory story={story} /> : null}
        </div>
      </div>
      <div className={styles.showcasePanels}>
        {items.map((item, i) => {
          const Icon = ICONS[item.key];
          return (
            <div key={item.key} className={styles.showcasePanel} data-active={i === active} aria-hidden={i !== active}>
              <span className={styles.icon} aria-hidden>
                <Icon />
              </span>
              <p>
                <strong>{item.name}</strong>
                {item.text}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Layer({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity: on ? 1 : 0,
        transform: on ? "none" : "translateY(24px) scale(0.98)",
        transition: "opacity 520ms cubic-bezier(0.22,1,0.36,1), transform 620ms cubic-bezier(0.22,1,0.36,1)",
        pointerEvents: on ? "auto" : "none",
        fontFamily: font
      }}
    >
      {children}
    </div>
  );
}

const frame = { position: "absolute" as const, background: "#fff", borderRadius: 36, boxShadow: "0 30px 80px rgba(10,10,10,0.12)", overflow: "hidden" as const };

function LiveMock({ copy }: { copy: FormatMock["live"] }) {
  return (
    <div style={{ ...frame, left: 60, right: 60, top: 80, bottom: 80, background: "#11181c" }}>
      <div style={{ position: "absolute", left: 40, top: 32, display: "flex", alignItems: "center", gap: 14, color: "#fff", fontSize: 30 }}>
        <span style={{ width: 16, height: 16, borderRadius: 8, background: color.coral }} />
        {copy.badge}
      </div>
      <div style={{ position: "absolute", left: 40, top: 100, width: 760, bottom: 40, borderRadius: 24, background: "#fff", padding: "44px 48px" }}>
        <p style={{ margin: 0, fontSize: 48, fontWeight: 500, color: color.ink, lineHeight: 1.1 }}>{copy.slide}</p>
        <div style={{ marginTop: 46, display: "flex", flexDirection: "column", gap: 30 }}>
          {copy.bars.map((bar, k) => (
            <div key={bar} style={{ display: "grid", gridTemplateColumns: "200px 1fr", alignItems: "center", gap: 20 }}>
              <span style={{ fontSize: 32, color: color.fg }}>{bar}</span>
              <div style={{ height: 30, borderRadius: 15, background: color.track }}>
                <div style={{ width: `${[82, 46, 30][k]}%`, height: "100%", borderRadius: 15, background: k === 1 ? color.coral : color.teal }} />
              </div>
            </div>
          ))}
        </div>
        <img src="/brand/noisia.svg" alt="" width={150} height={Math.round(150 / LOGO_RATIO)} style={{ position: "absolute", left: 48, bottom: 36 }} />
      </div>
      {[0, 1, 2].map((k) => (
        <div key={k} style={{ position: "absolute", right: 40, top: 100 + k * 228, width: 240, height: 208, borderRadius: 22, background: ["#2a3a40", "#33464d", "#25343a"][k], display: "grid", placeItems: "center", color: "rgba(255,255,255,0.7)" }}>
          <User width={78} height={78} strokeWidth={1.4} />
        </div>
      ))}
    </div>
  );
}

function DocumentMock({ copy }: { copy: FormatMock["document"] }) {
  return (
    <div style={{ ...frame, left: 60, right: 60, top: 140, bottom: 140, padding: "56px 64px" }}>
      <p style={{ margin: 0, fontSize: 52, fontWeight: 500, color: color.ink, lineHeight: 1.1, maxWidth: 820 }}>{copy.title}</p>
      <div style={{ marginTop: 44, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 30 }}>
        {[
          { label: copy.trigger, quote: copy.quotes[0], tone: color.teal, soft: color.tealSoft, platform: "TikTok", month: "ago 2026" },
          { label: copy.barrier, quote: copy.quotes[1], tone: color.coral, soft: color.coralSoft, platform: "Instagram", month: "sep 2026" }
        ].map((col) => (
          <div key={col.label} style={{ borderRadius: 26, background: col.soft, padding: "28px 30px" }}>
            <p style={{ margin: 0, fontSize: 30, fontWeight: 500, color: col.tone }}>{col.label}</p>
            <div style={{ marginTop: 20, background: "#fff", borderRadius: "26px 26px 26px 8px", padding: "18px 22px", fontSize: 30, lineHeight: 1.25, color: color.ink, textWrap: "balance" }}>{col.quote}</div>
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 18, fontSize: 24, color: color.muted }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <SourceIcon name={col.platform} size={26} />
                {col.platform}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Calendar width={24} height={24} strokeWidth={1.7} />
                {col.month}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 64, right: 64, bottom: 36, display: "flex", alignItems: "center", gap: 16, fontSize: 22, color: color.muted }}>
        <img src="/brand/noisia.svg" alt="" width={110} height={Math.round(110 / LOGO_RATIO)} />
        <span>social intelligence architects</span>
      </div>
    </div>
  );
}

function DashboardMock({ copy }: { copy: FormatMock["dashboard"] }) {
  const plot = { x: 70, y: 40, w: 560, h: 560 };
  const tones = { teal: color.teal, coral: color.coral, grey: "#b9c4c4" };
  const stageTone = (stage: string) => (/emerg/i.test(stage) ? color.teal : /aceler|accel/i.test(stage) ? "#d08a00" : color.muted);
  return (
    <div style={{ ...frame, left: 40, right: 40, top: 70, bottom: 70, background: "#f7f8f8" }}>
      <div style={{ height: 70, background: "#fff", borderBottom: `2px solid ${color.line}`, display: "flex", alignItems: "center", gap: 14, padding: "0 32px" }}>
        {["#f26b5b", "#f5c04a", "#5ac36b"].map((c) => (
          <span key={c} style={{ width: 16, height: 16, borderRadius: 8, background: c }} />
        ))}
        <img src="/brand/noisia.svg" alt="" width={120} height={Math.round(120 / LOGO_RATIO)} style={{ marginLeft: 22 }} />
      </div>
      <div style={{ padding: 28, display: "grid", gridTemplateColumns: "1.35fr 1fr", gap: 22, height: "calc(100% - 70px)" }}>
        <div style={{ background: "#fff", borderRadius: 22, border: `2px solid ${color.line}`, padding: "22px 24px", position: "relative" }}>
          <p style={{ margin: 0, fontSize: 28, fontWeight: 500, color: color.ink }}>{copy.title}</p>
          <svg width={680} height={640} viewBox="0 0 680 640" style={{ position: "absolute", left: 10, top: 70 }} aria-hidden>
            <line x1={plot.x} y1={plot.y + plot.h} x2={plot.x + plot.w} y2={plot.y + plot.h} stroke={color.line} strokeWidth={3} />
            <line x1={plot.x} y1={plot.y} x2={plot.x} y2={plot.y + plot.h} stroke={color.line} strokeWidth={3} />
            <line x1={plot.x + plot.w / 2} y1={plot.y} x2={plot.x + plot.w / 2} y2={plot.y + plot.h} stroke={color.track} strokeWidth={2} strokeDasharray="8 8" />
            <line x1={plot.x} y1={plot.y + plot.h / 2} x2={plot.x + plot.w} y2={plot.y + plot.h / 2} stroke={color.track} strokeWidth={2} strokeDasharray="8 8" />
            {copy.bubbles.map((b) => {
              const cx = plot.x + b.x * plot.w;
              const cy = plot.y + (1 - b.y) * plot.h;
              const r = 18 + b.size * 46;
              return (
                <g key={b.name}>
                  <circle cx={cx} cy={cy} r={r} fill={tones[b.tone]} opacity={0.22} />
                  <circle cx={cx} cy={cy} r={Math.max(10, r * 0.32)} fill={tones[b.tone]} />
                  <text x={cx} y={cy - r - 10} textAnchor="middle" fontSize={24} fill={color.fg} fontFamily="inherit">
                    {b.name}
                  </text>
                </g>
              );
            })}
            <text x={plot.x + plot.w} y={plot.y + plot.h + 34} textAnchor="end" fontSize={22} fill={color.muted}>
              {copy.xLabel} →
            </text>
            <text x={plot.x - 14} y={plot.y + 10} textAnchor="end" fontSize={22} fill={color.muted} transform={`rotate(-90 ${plot.x - 14} ${plot.y + 10})`}>
              {copy.yLabel} →
            </text>
          </svg>
        </div>
        <div style={{ background: "#fff", borderRadius: 22, border: `2px solid ${color.line}`, padding: "22px 24px" }}>
          <p style={{ margin: 0, fontSize: 28, fontWeight: 500, color: color.ink }}>{copy.listTitle}</p>
          <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 14 }}>
            {copy.items.map(([topic, stage], k) => (
              <div key={topic} style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 14, borderBottom: `2px solid ${color.track}` }}>
                <span style={{ fontSize: 28, color: color.ink, lineHeight: 1.15 }}>{topic}</span>
                <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 22, fontWeight: 500, color: stageTone(stage), padding: "4px 12px", borderRadius: 999, border: `2px solid ${stageTone(stage)}` }}>{stage}</span>
                  <svg width={120} height={34} viewBox="0 0 120 34" aria-hidden>
                    <polyline
                      points={[0, 1, 2, 3, 4, 5].map((i) => `${i * 24},${30 - (i * (4 - k) + [2, 6, 3, 8, 6, 10][i]!) * (k === 3 ? 0.6 : 1)}`).join(" ")}
                      fill="none"
                      stroke={color.teal}
                      strokeWidth={3}
                    />
                  </svg>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

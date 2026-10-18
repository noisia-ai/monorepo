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
          <Layer on={current === "stories"}>
            <div style={{ position: "absolute", left: (W - 430) / 2, top: 40, width: 430, height: 920 }}>{story && current === "stories" ? <PhoneStory story={story} /> : null}</div>
          </Layer>
        </Stage>
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
            <div style={{ marginTop: 20, background: "#fff", borderRadius: "26px 26px 26px 8px", padding: "18px 22px", fontSize: 30, lineHeight: 1.25, color: color.ink }}>{col.quote}</div>
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
  const points = [30, 34, 31, 38, 44, 41, 52, 60, 57, 66, 72, 70];
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"} ${30 + i * 52} ${210 - v * 2.4}`).join(" ");
  return (
    <div style={{ ...frame, left: 40, right: 40, top: 70, bottom: 70, background: "#f7f8f8" }}>
      <div style={{ height: 70, background: "#fff", borderBottom: `2px solid ${color.line}`, display: "flex", alignItems: "center", gap: 14, padding: "0 32px" }}>
        {["#f26b5b", "#f5c04a", "#5ac36b"].map((c) => (
          <span key={c} style={{ width: 16, height: 16, borderRadius: 8, background: c }} />
        ))}
        <img src="/brand/noisia.svg" alt="" width={120} height={Math.round(120 / LOGO_RATIO)} style={{ marginLeft: 22 }} />
      </div>
      <div style={{ padding: 32, display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
          {copy.kpis.map(([name, value, delta]) => (
            <div key={name} style={{ background: "#fff", borderRadius: 22, padding: "22px 26px", border: `2px solid ${color.line}` }}>
              <p style={{ margin: 0, fontSize: 24, color: color.muted }}>{name}</p>
              <p style={{ margin: "8px 0 0", fontSize: 50, fontWeight: 500, color: color.ink }}>
                {value} <span style={{ fontSize: 26, color: delta.startsWith("−") ? color.coral : color.teal }}>{delta}</span>
              </p>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 20 }}>
          <div style={{ background: "#fff", borderRadius: 22, padding: "22px 26px", border: `2px solid ${color.line}` }}>
            <p style={{ margin: 0, fontSize: 26, color: color.fg, fontWeight: 500 }}>{copy.chart}</p>
            <svg width={640} height={230} viewBox="0 0 640 230" style={{ marginTop: 14 }} aria-hidden>
              <path d={`${path} L ${30 + 11 * 52} 220 L 30 220 Z`} fill={color.tealSoft} />
              <path d={path} fill="none" stroke={color.teal} strokeWidth={5} strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ background: "#fff", borderRadius: 22, padding: "22px 26px", border: `2px solid ${color.line}` }}>
            <p style={{ margin: 0, fontSize: 26, color: color.fg, fontWeight: 500 }}>{copy.topicsTitle}</p>
            <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 18 }}>
              {copy.topics.map(([topic, delta]) => (
                <div key={topic} style={{ display: "flex", justifyContent: "space-between", fontSize: 30, color: color.ink, borderBottom: `2px solid ${color.track}`, paddingBottom: 12 }}>
                  {topic}
                  <span style={{ fontWeight: 500, color: delta.startsWith("−") ? color.coral : color.teal }}>{delta}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

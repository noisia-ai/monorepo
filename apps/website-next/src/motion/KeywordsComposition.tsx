"use client";

import { Search } from "iconoir-react";
import { SourceIcon } from "@/components/brand/SourceMark";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "./runtime";
import { color, font } from "./theme";
import { clamp, enter } from "./util";

/**
 * Keyword search against reading the whole conversation (square 1080 canvas). The search only
 * catches the mentions that contain the word; Noisia reads all of them and groups them into
 * topics. The brand and mentions are illustrative.
 */

export const KEYWORDS = { frames: 300 } as const;

export type KeywordsCopy = {
  query: string;
  mentions: { text: string; hit: boolean; platform: string; topic: number }[];
  found: string;
  missed: string;
  them: string;
  us: string;
  topics: string[];
};

const POS = [
  { x: 50, y: 200 },
  { x: 550, y: 240 },
  { x: 50, y: 395 },
  { x: 550, y: 435 },
  { x: 50, y: 590 },
  { x: 550, y: 630 }
];

export function KeywordsComposition({ copy }: { copy: KeywordsCopy }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const fade = interpolate(frame, [durationInFrames - 22, durationInFrames - 2], [1, 0], clamp);
  const box = enter(frame, fps, 2, 18);
  const typed = Math.floor(interpolate(frame, [10, 40], [0, copy.query.length], clamp));
  const scan = enter(frame, fps, 96, 16);
  const switchUs = interpolate(frame, [168, 190], [0, 1], clamp);
  const group = interpolate(frame, [196, 236], [0, 1], { ...clamp, easing: (t) => 1 - Math.pow(1 - t, 3) });
  const hits = copy.mentions.filter((m) => m.hit).length;

  return (
    <AbsoluteFill style={{ opacity: fade, fontFamily: font }}>
      {/* the search box, then the label changes to "reading everything" */}
      <div
        style={{
          position: "absolute",
          left: 60,
          right: 60,
          top: 60,
          height: 96,
          borderRadius: 48,
          background: "#fff",
          boxShadow: "0 14px 40px rgba(10,10,10,0.08)",
          display: "flex",
          alignItems: "center",
          gap: 18,
          padding: "0 34px",
          opacity: box,
          transform: `translateY(${(1 - box) * 14}px)`
        }}
      >
        <Search width={40} height={40} strokeWidth={1.8} color={switchUs > 0.5 ? color.teal : color.ink} />
        <span style={{ fontSize: 38, color: color.ink, opacity: 1 - switchUs }}>
          “{copy.query.slice(0, typed)}”
        </span>
        <span style={{ position: "absolute", left: 110, fontSize: 36, fontWeight: 500, color: color.teal, opacity: switchUs }}>{copy.us}</span>
      </div>

      {copy.mentions.slice(0, 6).map((m, i) => {
        const p = enter(frame, fps, 20 + i * 9, 18);
        const caught = m.hit || switchUs > 0.5;
        const dim = !m.hit && scan > 0 && switchUs < 0.5;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: POS[i]!.x,
              top: POS[i]!.y,
              width: 480,
              opacity: p * (dim ? 0.35 : 1) * (1 - group * 0.85),
              // the bubbles fold away as the topics take their place
              transform: `translateY(${(1 - p) * 16}px) scale(${1 - group * 0.1})`
            }}
          >
            <div
              style={{
                background: caught && scan > 0.2 ? (switchUs > 0.5 ? color.tealSoft : "#fff") : color.bubble,
                border: `3px solid ${caught && scan > 0.2 ? (switchUs > 0.5 ? color.teal : color.ink) : "transparent"}`,
                borderRadius: "28px 28px 28px 10px",
                padding: "16px 22px",
                fontSize: 34,
                lineHeight: 1.25,
                color: color.ink
              }}
            >
              {m.text}
            </div>
            <div style={{ marginTop: 8, marginLeft: 6, display: "flex", alignItems: "center", gap: 10, fontSize: 24, color: dim ? color.coral : color.muted }}>
              <SourceIcon name={m.platform} size={26} />
              {scan > 0.3 && switchUs < 0.5 ? (m.hit ? copy.found : copy.missed) : null}
            </div>
          </div>
        );
      })}

      {/* the count under keyword search */}
      <div style={{ position: "absolute", left: 60, right: 60, top: 830, padding: "22px 30px", borderRadius: 28, background: color.coralSoft, opacity: scan * (1 - switchUs), transform: `translateY(${(1 - scan) * 14}px)` }}>
        <p style={{ margin: 0, fontSize: 34, color: color.ink }}>
          <strong style={{ color: color.coral }}>
            {hits} / {copy.mentions.length}
          </strong>{" "}
          {copy.them}
        </p>
      </div>

      {/* Noisia: every mention read and grouped into topics */}
      <div style={{ position: "absolute", left: 60, right: 60, top: 240, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, opacity: group }}>
        {copy.topics.map((topic, k) => {
          const members = copy.mentions.filter((m) => m.topic === k);
          return (
            <div key={topic} style={{ borderRadius: 30, background: "#fff", boxShadow: "0 14px 40px rgba(10,10,10,0.07)", padding: "24px 26px", transform: `scale(${0.92 + group * 0.08})` }}>
              <p style={{ margin: 0, fontSize: 32, fontWeight: 500, color: color.teal }}>{topic}</p>
              <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
                {members.map((m, j) => (
                  <span key={j} style={{ width: 54, height: 54, borderRadius: 18, background: color.tealSoft, display: "grid", placeItems: "center" }}>
                    <SourceIcon name={m.platform} size={28} />
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 60, right: 60, top: 830, padding: "22px 30px", borderRadius: 28, background: color.tealSoft, opacity: interpolate(frame, [226, 244], [0, 1], clamp) }}>
        <p style={{ margin: 0, fontSize: 34, color: color.ink }}>
          <strong style={{ color: color.teal }}>
            {copy.mentions.length} / {copy.mentions.length}
          </strong>{" "}
          {copy.found}
        </p>
      </div>
    </AbsoluteFill>
  );
}

"use client";

import type { Scene, StoryLocale } from "@/content/stories/schema";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "./runtime";
import { SceneView } from "./scenes";
import { CANVAS, OUTRO_FRAMES, SAFE, SCENE_FRAMES, color, font } from "./theme";
import { clamp, enter } from "./util";

export type StoryCompositionProps = {
  story: StoryLocale;
  locale: string;
  /** Text shown in the top-left chip, e.g. "Salud y farmacias · MX". */
  tag: string;
  /** Feed mode keeps the bottom free for the caption overlay; video mode draws the title itself. */
  mode: "feed" | "video";
};

export function sceneFrames(scene: Scene): number {
  return SCENE_FRAMES[scene.type] ?? 110;
}

export function storyDuration(story: StoryLocale): number {
  return story.scenes.reduce((sum, scene) => sum + sceneFrames(scene), 0) + OUTRO_FRAMES;
}

/** Frame where a static poster tells the most: the end of the first data scene. */
export function posterFrame(story: StoryLocale): number {
  let at = 0;
  for (const scene of story.scenes) {
    const length = sceneFrames(scene);
    if (scene.type !== "hook") return at + length - 14;
    at += length;
  }
  return Math.max(0, at - 14);
}

const PARTICLES = Array.from({ length: 46 }, (_, i) => {
  const r = (n: number) => {
    const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  return { x: r(1) * 1080, y: r(2) * 1920, size: 5 + r(3) * 7, speed: 0.12 + r(4) * 0.3, phase: r(5) * Math.PI * 2 };
});

/** Brand atmosphere: a slow cyan/red bloom with grain and drifting points of conversation. */
function Bloom() {
  const frame = useCurrentFrame();
  // Rounded so server and browser math agree to the pixel (avoids hydration mismatches).
  const drift = Math.round(Math.sin(frame / 90) * 40);
  return (
    <AbsoluteFill style={{ background: color.canvas, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          width: 1100,
          height: 1100,
          right: -520 + drift,
          top: -420,
          borderRadius: "50%",
          background: `radial-gradient(circle at 40% 40%, ${color.cyan}55, ${color.teal}22 45%, transparent 70%)`,
          filter: "blur(40px)"
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 900,
          height: 900,
          left: -480 - drift,
          bottom: -380,
          borderRadius: "50%",
          background: `radial-gradient(circle at 60% 50%, ${color.red}2e, ${color.coral}14 45%, transparent 70%)`,
          filter: "blur(50px)"
        }}
      />
      <svg width={1080} height={1920} style={{ position: "absolute", inset: 0 }} aria-hidden>
        {PARTICLES.map((p, i) => (
          <circle
            key={i}
            cx={Math.round((p.x + Math.cos(frame / 60 + p.phase) * 24) % 1080)}
            cy={Math.round((p.y - frame * p.speed * 2 + 1920) % 1920)}
            r={Math.round(p.size)}
            fill={i % 7 === 0 ? color.coral : color.teal}
            opacity={Math.round((0.08 + 0.06 * Math.sin(frame / 40 + p.phase)) * 100) / 100}
          />
        ))}
      </svg>
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: 0.07, mixBlendMode: "multiply" }} aria-hidden>
        <filter id="noisia-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#noisia-grain)" />
      </svg>
    </AbsoluteFill>
  );
}

/** Story-style progress segments, one per scene, plus the tag chip. */
function Chrome({ lengths, tag }: { lengths: number[]; tag: string }) {
  const frame = useCurrentFrame();
  let start = 0;
  return (
    <div style={{ position: "absolute", left: SAFE.side, right: SAFE.side, top: 56, display: "flex", flexDirection: "column", gap: 30 }}>
      <div style={{ display: "flex", gap: 10 }}>
        {lengths.map((length, i) => {
          const fill = interpolate(frame, [start, start + length], [0, 1], clamp);
          start += length;
          return (
            <div key={i} style={{ flex: 1, height: 8, borderRadius: 4, background: "rgba(10,10,10,0.08)", overflow: "hidden" }}>
              <div style={{ width: `${fill * 100}%`, height: "100%", background: color.ink, opacity: 0.55 }} />
            </div>
          );
        })}
      </div>
      <span
        style={{
          alignSelf: "flex-start",
          fontFamily: font,
          fontSize: 34,
          fontWeight: 500,
          color: color.teal,
          background: "rgba(255,255,255,0.8)",
          border: `2px solid ${color.tealSoft}`,
          borderRadius: 999,
          padding: "10px 24px"
        }}
      >
        {tag}
      </span>
    </div>
  );
}

function Outro({ locale }: { locale: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = enter(frame, fps, 0, 20);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 24, opacity: p }}>
      <span style={{ fontFamily: font, fontSize: 150, fontWeight: 700, color: color.ink, letterSpacing: -2, transform: `scale(${0.92 + p * 0.08})` }}>
        noisia
      </span>
      <span style={{ fontFamily: font, fontSize: 40, color: color.muted }}>{locale === "en" ? "social intelligence" : "inteligencia social"}</span>
    </AbsoluteFill>
  );
}

function VideoCaption({ story }: { story: StoryLocale }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = interpolate(frame, [0, 10, durationInFrames - OUTRO_FRAMES, durationInFrames - OUTRO_FRAMES + 8], [0, 1, 1, 0], clamp);
  return (
    <div style={{ position: "absolute", left: SAFE.side, right: SAFE.side, bottom: 120, opacity }}>
      <p style={{ fontFamily: font, fontSize: 56, fontWeight: 500, lineHeight: 1.15, color: color.ink, margin: 0 }}>{story.title}</p>
    </div>
  );
}

export function StoryComposition({ story, locale, tag, mode }: StoryCompositionProps) {
  const lengths = story.scenes.map(sceneFrames);
  const bottomSafe = mode === "feed" ? SAFE.bottomFeed : SAFE.bottomVideo;
  let from = 0;
  return (
    <AbsoluteFill style={{ width: CANVAS.width, height: CANVAS.height }}>
      <Bloom />
      {story.scenes.map((scene, i) => {
        const start = from;
        from += lengths[i]!;
        return (
          <Sequence key={i} from={start} durationInFrames={lengths[i]!}>
            <SceneView scene={scene} locale={locale} bottomSafe={bottomSafe} />
          </Sequence>
        );
      })}
      <Sequence from={from} durationInFrames={OUTRO_FRAMES}>
        <Outro locale={locale} />
      </Sequence>
      <Chrome lengths={[...lengths, OUTRO_FRAMES]} tag={tag} />
      {mode === "video" ? <VideoCaption story={story} /> : null}
    </AbsoluteFill>
  );
}

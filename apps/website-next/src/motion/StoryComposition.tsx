"use client";

import type { Scene, StoryLocale } from "@/content/stories/schema";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "./runtime";
import { SceneView } from "./scenes";
import { CANVAS, OUTRO_FRAMES, SAFE, SCENE_FRAMES, color, font } from "./theme";
import { clamp, enter } from "./util";
import { LOGO_RATIO } from "@/components/brand/Logo";
import { PhotoBackdrop, PhotoPalette } from "./PhotoStory";

export type StoryCompositionProps = {
  story: StoryLocale;
  locale: string;
  /** Text shown in the top-left chip, e.g. "Salud y farmacias · MX". */
  tag: string;
  /** Feed mode keeps the bottom free for the caption overlay; video mode draws the title itself. */
  mode: "feed" | "video";
  /** Optional photos (experiment): they fill the screen, one per scene, behind the scenes (PhotoStory). */
  image?: string | string[];
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

/**
 * Brand canvas: white, like every Noisia surface, with a very soft teal wash at the foot.
 * The chromatic offset stays reserved for the logo, so the scenes carry the color.
 */
function Canvas() {
  return <AbsoluteFill style={{ background: `linear-gradient(180deg, ${color.canvas} 0%, ${color.canvas} 55%, #f1f9f9 100%)` }} />;
}

/** Story-style progress segments, one per scene, plus the tag chip. */
function Chrome({ lengths, tag, onPhoto }: { lengths: number[]; tag: string; onPhoto?: boolean }) {
  const frame = useCurrentFrame();
  let start = 0;
  return (
    <div style={{ position: "absolute", left: SAFE.side, right: SAFE.side, top: 56, display: "flex", flexDirection: "column", gap: 30 }}>
      <div style={{ display: "flex", gap: 10 }}>
        {lengths.map((length, i) => {
          const fill = interpolate(frame, [start, start + length], [0, 1], clamp);
          start += length;
          return (
            <div key={i} style={{ flex: 1, height: 8, borderRadius: 4, background: onPhoto ? "rgba(255,255,255,0.3)" : "rgba(10,10,10,0.08)", overflow: "hidden" }}>
              <div style={{ width: `${fill * 100}%`, height: "100%", background: onPhoto ? "#ffffff" : color.ink, opacity: onPhoto ? 0.9 : 0.55 }} />
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
          color: onPhoto ? "#ffffff" : color.teal,
          background: onPhoto ? "rgba(6,18,24,0.35)" : "rgba(255,255,255,0.8)",
          border: `2px solid ${onPhoto ? "rgba(255,255,255,0.45)" : color.tealSoft}`,
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
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 36, opacity: p, background: color.canvas }}>
      {/* The real Noisia logo, never typed text. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size SVG inside the canvas */}
      <img src="/brand/noisia.svg" alt="Noisia" width={560} height={Math.round(560 / LOGO_RATIO)} style={{ transform: `scale(${0.92 + p * 0.08})` }} />
      <span style={{ fontFamily: font, fontSize: 40, color: color.muted }}>{locale === "en" ? "Social intelligence" : "Inteligencia social"}</span>
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

export function StoryComposition({ story, locale, tag, mode, image }: StoryCompositionProps) {
  const lengths = story.scenes.map(sceneFrames);
  const total = lengths.reduce((sum, length) => sum + length, 0) + OUTRO_FRAMES;
  const images = image ? (Array.isArray(image) ? image : [image]) : [];
  const onPhoto = images.length > 0;
  const bottomSafe = mode === "feed" ? SAFE.bottomFeed : SAFE.bottomVideo;
  let from = 0;
  const scenes = story.scenes.map((scene, i) => {
    const start = from;
    from += lengths[i]!;
    return (
      <Sequence key={i} from={start} durationInFrames={lengths[i]!}>
        <SceneView scene={scene} locale={locale} bottomSafe={bottomSafe} />
      </Sequence>
    );
  });
  return (
    <AbsoluteFill style={{ width: CANVAS.width, height: CANVAS.height }}>
      {onPhoto ? <PhotoBackdrop images={images} lengths={lengths} total={total} /> : <Canvas />}
      {onPhoto ? <PhotoPalette>{scenes}</PhotoPalette> : scenes}
      <Sequence from={from} durationInFrames={OUTRO_FRAMES}>
        <Outro locale={locale} />
      </Sequence>
      <Chrome lengths={[...lengths, OUTRO_FRAMES]} tag={tag} onPhoto={onPhoto} />
      {mode === "video" && !onPhoto ? <VideoCaption story={story} /> : null}
    </AbsoluteFill>
  );
}

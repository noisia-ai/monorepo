import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "../engine";
import type { Scene } from "../schema";
import { Fonts } from "../brand/Fonts";
import { OUTRO_FRAMES, SAFE, SCENE_FRAMES, VERTICAL, color, font } from "../brand/theme";
import { clamp } from "../brand/util";
import { Background } from "../common/Background";
import { Chrome } from "../common/Chrome";
import { Outro } from "../common/Outro";
import { SceneView } from "./scenes";
import { BaseCard } from "../common/Base";
import { Shell } from "../common/text";

/** Format 1 · Clip (VIDEO.md §5.1): a noisia.ai/insights story, unchanged, as a 9:16 video. */
export type ClipBase = { channels: string[]; period?: string; market?: string; method?: string };
export type ClipProps = { title: string; scenes: Scene[]; locale: "es" | "en"; tag?: string; showTitle: boolean; base?: ClipBase };
export const CLIP_BASE_FRAMES = SCENE_FRAMES.base;

export const sceneFrames = (scene: Scene) => SCENE_FRAMES[scene.type] ?? 110;
export const clipDuration = (scenes: Scene[], base?: ClipBase) =>
  scenes.reduce((sum, s) => sum + sceneFrames(s), 0) + (base ? CLIP_BASE_FRAMES : 0) + OUTRO_FRAMES;

function Title({ title }: { title: string }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = interpolate(frame, [0, 10, durationInFrames - OUTRO_FRAMES, durationInFrames - OUTRO_FRAMES + 8], [0, 1, 1, 0], clamp);
  return (
    <div style={{ position: "absolute", left: SAFE.side, right: SAFE.right, bottom: 120, opacity }}>
      <p style={{ fontFamily: font, fontSize: 56, fontWeight: 500, lineHeight: 1.15, color: color.ink, margin: 0 }}>{title}</p>
    </div>
  );
}

export function Clip({ title, scenes, locale, tag, showTitle, base }: ClipProps) {
  const lengths = [...scenes.map(sceneFrames), ...(base ? [CLIP_BASE_FRAMES] : [])];
  let from = 0;
  return (
    <AbsoluteFill style={{ width: VERTICAL.width, height: VERTICAL.height, background: color.canvas }}>
      <Fonts />
      <Background bg={{ kind: "wash" }} />
      {base ? (
        <Sequence from={lengths.slice(0, -1).reduce((a, b) => a + b, 0)} durationInFrames={CLIP_BASE_FRAMES}>
          <Shell bottomSafe={SAFE.bottomClip}>
            <BaseCard base={{ channels: base.channels.map((platform) => ({ platform })), period: base.period ?? "", market: base.market, method: base.method }} locale={locale} />
          </Shell>
        </Sequence>
      ) : null}
      {scenes.map((scene, i) => {
        const start = from;
        from += lengths[i];
        return (
          <Sequence key={i} from={start} durationInFrames={lengths[i]}>
            <SceneView scene={scene} locale={locale} bottomSafe={SAFE.bottomClip} />
          </Sequence>
        );
      })}
      <Sequence from={from + (base ? CLIP_BASE_FRAMES : 0)} durationInFrames={OUTRO_FRAMES}>
        <Outro locale={locale} />
      </Sequence>
      <Chrome lengths={[...lengths, OUTRO_FRAMES]} tag={tag} equal />
      {showTitle ? <Title title={title} /> : null}
    </AbsoluteFill>
  );
}

import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "../engine";
import type { SocialPiece, Timing } from "../schema";
import { Fonts } from "../brand/Fonts";
import { SAFE, SCENE_FRAMES, VERTICAL, color } from "../brand/theme";
import { progress } from "../brand/util";
import { Background } from "../common/Background";
import { Captions } from "../common/Captions";
import { Chrome } from "../common/Chrome";
import { Mix } from "../common/Mix";
import { Outro } from "../common/Outro";
import { SceneView } from "../clip/scenes";

/**
 * Format 2 · Social (VIDEO.md §5.2): LinkedIn, Reels, TikTok. It must work muted: the text on screen
 * or the captions tell everything. Voice is optional; with voice, timing comes from builders/audio.py.
 */
export const SOCIAL_OUTRO = 66;
export type SocialProps = { piece: SocialPiece; timing: Timing | null };

export function socialLengths(piece: SocialPiece, timing: Timing | null): number[] {
  return piece.scenes.map((s, i) => timing?.scenes[i]?.len ?? SCENE_FRAMES[s.type] ?? 110);
}
export const socialDuration = (piece: SocialPiece, timing: Timing | null) => socialLengths(piece, timing).reduce((a, b) => a + b, 0) + SOCIAL_OUTRO;

function SceneBackground({ bg }: { bg: Parameters<typeof Background>[0]["bg"] }) {
  const frame = useCurrentFrame();
  const { durationInFrames: d } = useVideoConfig();
  const o = Math.min(progress(frame, 0, 10), 1 - progress(frame, d - 10, 10));
  return (
    <AbsoluteFill style={{ opacity: o }}>
      <Background bg={bg} />
    </AbsoluteFill>
  );
}

export function Social({ piece, timing }: SocialProps) {
  const lengths = socialLengths(piece, timing);
  const voiced = Boolean(timing?.scenes.some((s) => s.clips.length));
  const bottomSafe = voiced ? SAFE.bottomPublish + 120 : SAFE.bottomPublish;
  let from = 0;
  return (
    <AbsoluteFill style={{ width: VERTICAL.width, height: VERTICAL.height, background: color.canvas }}>
      <Fonts />
      <Background bg={piece.background} />
      {piece.scenes.map((scene, i) => {
        const start = from;
        from += lengths[i];
        return (
          <Sequence key={i} from={start} durationInFrames={lengths[i]}>
            {scene.background ? <SceneBackground bg={scene.background} /> : null}
            <SceneView scene={scene} locale={piece.locale} bottomSafe={bottomSafe} />
            {timing?.scenes[i] ? <Captions clips={timing.scenes[i].clips} /> : null}
          </Sequence>
        );
      })}
      <Sequence from={from} durationInFrames={SOCIAL_OUTRO}>
        <Outro locale={piece.locale} />
      </Sequence>
      <Chrome lengths={[...lengths, SOCIAL_OUTRO]} tag={piece.tag} />
      {timing ? <Mix timing={timing} musicFree={0.35} /> : null}
    </AbsoluteFill>
  );
}

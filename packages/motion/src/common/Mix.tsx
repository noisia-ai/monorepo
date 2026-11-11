import { Audio, Sequence, interpolate, staticFile } from "../engine";
import type { Timing } from "../schema";

/**
 * The mix of VIDEO.md §5.3: narrator 0.95, quotes 1.0; music 0.26 free, 0.09 under a voice and
 * 0.02 in the climax, always with 7-frame ramps, never steps. Files live in the piece's folder.
 */
const LEVEL = { vo: 0.95, quote: 1.0, spark: 0.95 } as const;
const MUSIC = { free: 0.26, underVoice: 0.09, climax: 0.02, ramp: 7 } as const;

export function musicLevel(frame: number, voiced: [number, number][], quiet: [number, number][], free: number = MUSIC.free): number {
  const r = MUSIC.ramp;
  const inside = (ranges: [number, number][]) =>
    Math.max(0, ...ranges.map(([a, b]) => interpolate(frame, [a - r, a, b, b + r], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })));
  const q = inside(quiet);
  const v = inside(voiced);
  const level = free + (MUSIC.underVoice - free) * v;
  return level + (MUSIC.climax - level) * q;
}

export function Mix({ timing, quiet = [], musicFree }: { timing: Timing; quiet?: [number, number][]; musicFree?: number }) {
  const voiced: [number, number][] = [];
  const clips = timing.scenes.flatMap((sc) => sc.clips.map((c) => ({ ...c, at: sc.from + c.at })));
  for (const c of clips) voiced.push([c.at, c.at + c.len]);
  return (
    <>
      {clips.map((c, i) =>
        c.file ? (
          <Sequence key={i} from={c.at} durationInFrames={c.len + 2}>
            <Audio src={staticFile(`piece/${c.file}`)} volume={LEVEL[c.kind]} />
          </Sequence>
        ) : null
      )}
      {timing.music ? <Audio src={staticFile(`piece/${timing.music}`)} volume={(f) => musicLevel(f, voiced, quiet, musicFree)} /> : null}
    </>
  );
}

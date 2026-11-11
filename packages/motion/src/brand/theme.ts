// Brand constants for every video. Values are the engine tokens (pitch-kit/engine/noisia-tokens.css)
// and the website's src/motion/theme.ts; rules in packages/pitch-kit/VIDEO.md §2 and §4.
export const VERTICAL = { width: 1080, height: 1920, fps: 30 } as const;

export const color = {
  canvas: "#ffffff",
  ink: "#0a0a0a",
  fg: "#2b2b2b",
  muted: "#6d6d6d",
  faint: "#b5b5b5",
  line: "#e6e6e6",
  track: "#f1f1f1",
  bubble: "#eeeeee",
  teal: "#008a8a",
  tealSoft: "#e6f7f7",
  coral: "#e2543c",
  coralSoft: "#fdece8",
  cyan: "#00eeee",
  red: "#ee0b00",
  dark: "#061218",
  upcoming: "#c3c5c8"
} as const;

export const font = "'Google Sans', system-ui, sans-serif";

/** Safe areas on 1080×1920 (VIDEO.md §4.5). Right keeps clear of TikTok and Reels buttons. */
export const SAFE = { top: 150, side: 84, right: 160, bottomClip: 360, bottomPublish: 384 } as const;

/** The motion canon (VIDEO.md §4.4). */
export const MOTION = {
  spring: { damping: 18, mass: 0.7, stiffness: 120 },
  easeIn: [0.22, 1, 0.36, 1] as const,
  easePath: [0.65, 0, 0.35, 1] as const,
  wordStagger: 3,
  sceneIn: 12,
  sceneOut: 10
} as const;

/** Clip scene lengths in frames, the same as the website (src/motion/theme.ts). */
export const SCENE_FRAMES: Record<string, number> = {
  hook: 84,
  stat: 108,
  compare: 138,
  journey: 156,
  split: 120,
  tension: 126,
  quote: 156,
  takeaway: 108,
  base: 120
};
export const OUTRO_FRAMES = 54;

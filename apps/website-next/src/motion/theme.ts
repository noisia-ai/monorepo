// Visual constants for the motion compositions. Compositions render on a fixed
// 1080×1920 canvas (9:16) and the player scales them, so sizes here are canvas pixels.
export const CANVAS = { width: 1080, height: 1920, fps: 30 } as const;

export const color = {
  canvas: "#ffffff",
  ink: "#0a0a0a",
  fg: "#2b2b2b",
  muted: "#6d6d6d",
  faint: "#b5b5b5",
  line: "#e6e6e6",
  track: "#f1f1f1",
  teal: "#008a8a",
  tealSoft: "#e6f7f7",
  coral: "#e2543c",
  coralSoft: "#fdece8",
  cyan: "#00eeee",
  red: "#ee0b00",
  dark: "#061218"
} as const;

export const font = "var(--font-google-sans), 'Google Sans', system-ui, sans-serif";

// Safe area: the top strip holds the progress segments; in the feed the bottom of the
// frame sits under the caption overlay, so scenes keep their content above SAFE_BOTTOM.
export const SAFE = { top: 150, side: 84, bottomFeed: 640, bottomVideo: 360 } as const;

export const SCENE_FRAMES: Record<string, number> = {
  hook: 84,
  stat: 108,
  compare: 138,
  journey: 156,
  split: 120,
  tension: 126,
  quote: 156,
  takeaway: 108
};

export const OUTRO_FRAMES = 54;

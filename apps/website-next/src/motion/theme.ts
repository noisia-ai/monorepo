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
  bubble: "#eeeeee",
  teal: "#008a8a",
  tealSoft: "#e6f7f7",
  coral: "#e2543c",
  coralSoft: "#fdece8",
  cyan: "#00eeee",
  red: "#ee0b00",
  dark: "#061218"
} as const;

/**
 * The colors the scenes draw with, as CSS variables that fall back to the white canvas palette.
 * A photo story sets the variables to a light-on-dark palette (PHOTO_SCENE_VARS), so the same
 * animated scenes read over a photograph.
 */
const sceneVar = (name: string, fallback: string) => `var(--scene-${name}, ${fallback})`;
export const sceneColor = {
  ...color,
  ink: sceneVar("ink", color.ink),
  fg: sceneVar("fg", color.fg),
  muted: sceneVar("muted", color.muted),
  faint: sceneVar("faint", color.faint),
  line: sceneVar("line", color.line),
  track: sceneVar("track", color.track),
  bubble: sceneVar("bubble", color.bubble),
  teal: sceneVar("teal", color.teal),
  tealSoft: sceneVar("teal-soft", color.tealSoft),
  coral: sceneVar("coral", color.coral),
  coralSoft: sceneVar("coral-soft", color.coralSoft),
  tealPale: sceneVar("teal-pale", "#a9dada"),
  coralPale: sceneVar("coral-pale", "#f3c2b7")
};

export const PHOTO_SCENE_VARS: Record<string, string> = {
  "--scene-ink": "#ffffff",
  "--brand-black": "#ffffff",
  "--scene-fg": "rgba(255,255,255,0.92)",
  "--scene-muted": "rgba(255,255,255,0.74)",
  "--scene-faint": "rgba(255,255,255,0.5)",
  "--scene-line": "rgba(255,255,255,0.32)",
  "--scene-track": "rgba(255,255,255,0.16)",
  "--scene-bubble": "rgba(8,20,26,0.62)",
  "--scene-teal": "#62e3e3",
  "--scene-teal-soft": "rgba(0,120,124,0.62)",
  "--scene-coral": "#ff8a73",
  "--scene-coral-soft": "rgba(226,84,60,0.32)",
  "--scene-teal-pale": "rgba(170,236,236,0.55)",
  "--scene-coral-pale": "rgba(255,186,170,0.55)"
};

export const font = "var(--font-google-sans), 'Google Sans', system-ui, sans-serif";

// Safe area: the top strip holds the progress segments; in the feed the bottom of the
// frame sits under the caption overlay, so scenes keep their content above SAFE_BOTTOM.
/** bottomFeed leaves room for the round buttons on a phone (the text lives in the evidence sheet). */
export const SAFE = { top: 150, side: 84, bottomFeed: 380, bottomVideo: 360 } as const;

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

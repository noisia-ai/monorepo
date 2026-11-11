import { Easing, interpolate, spring } from "../engine";
import { MOTION } from "./theme";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const easeIn = Easing.bezier(...MOTION.easeIn);
export const easePath = Easing.bezier(...MOTION.easePath);

/** Spring that starts at `delay` frames, 0 → 1. */
export function enter(frame: number, fps: number, delay = 0, damping: number = MOTION.spring.damping): number {
  return spring({ frame: frame - delay, fps, config: { ...MOTION.spring, damping } });
}

/** Fade + lift for an element entering at `delay`. */
export function rise(frame: number, fps: number, delay = 0, distance = 40) {
  const p = enter(frame, fps, delay);
  return { opacity: p, transform: `translateY(${(1 - p) * distance}px)` };
}

/** 0 → 1 over `duration` frames after `at`, on the entry curve. */
export function progress(frame: number, at: number, duration: number, easing = easeIn): number {
  return interpolate(frame, [at, at + duration], [0, 1], { ...clamp, easing });
}

/** Animated number from `from` to `value` over `duration` frames after `delay`. */
export function countUp(frame: number, value: number, delay: number, duration = 28, from = 0): number {
  return interpolate(frame, [delay, delay + duration], [from, value], { ...clamp, easing: (t) => 1 - Math.pow(1 - t, 3) });
}

export function formatNumber(value: number, target: number, locale: string): string {
  const decimals = Number.isInteger(target) ? 0 : Math.min(2, String(target).split(".")[1]?.length ?? 1);
  return new Intl.NumberFormat(locale.startsWith("en") ? "en-US" : "es-MX", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

/** Deterministic random, so a frame always renders the same. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

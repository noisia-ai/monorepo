import { interpolate, spring } from "./runtime";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Spring that starts at `delay` frames, 0 → 1. */
export function enter(frame: number, fps: number, delay = 0, damping = 18): number {
  return spring({ frame: frame - delay, fps, config: { damping, mass: 0.7, stiffness: 120 } });
}

/** Fade + lift for an element entering at `delay`. */
export function rise(frame: number, fps: number, delay = 0, distance = 40) {
  const p = enter(frame, fps, delay);
  return { opacity: p, transform: `translateY(${(1 - p) * distance}px)` };
}

/** Animated number from 0 to `value` over `duration` frames after `delay`. */
export function countUp(frame: number, value: number, delay: number, duration = 28): number {
  return interpolate(frame, [delay, delay + duration], [0, value], {
    ...clamp,
    easing: (t) => 1 - Math.pow(1 - t, 3)
  });
}

export function formatNumber(value: number, target: number, locale: string): string {
  const decimals = Number.isInteger(target) ? 0 : Math.min(2, String(target).split(".")[1]?.length ?? 1);
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "es-MX", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

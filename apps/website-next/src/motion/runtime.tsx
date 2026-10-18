"use client";

/**
 * Noisia Motion: a tiny, deterministic, frame-based animation runtime.
 *
 * Compositions are pure functions of the current frame (same model as Remotion), so
 * the same source can play live in the browser, render any single frame on the
 * server (indexable, reduced-motion friendly) and be captured frame by frame into
 * a video file by a headless browser. No licensed dependency is involved.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";

type FrameContextValue = { frame: number; fps: number; durationInFrames: number; width: number; height: number };

const FrameContext = createContext<FrameContextValue>({ frame: 0, fps: 30, durationInFrames: 1, width: 1080, height: 1920 });

export function useCurrentFrame(): number {
  return useContext(FrameContext).frame;
}

export function useVideoConfig() {
  const { fps, durationInFrames, width, height } = useContext(FrameContext);
  return { fps, durationInFrames, width, height };
}

/** Renders children only inside [from, from + durationInFrames) with a local frame clock. */
export function Sequence({ from, durationInFrames, children }: { from: number; durationInFrames: number; children: ReactNode }) {
  const parent = useContext(FrameContext);
  const local = parent.frame - from;
  if (local < 0 || local >= durationInFrames) return null;
  return <FrameContext.Provider value={{ ...parent, frame: local, durationInFrames }}>{children}</FrameContext.Provider>;
}

export function AbsoluteFill({ style, children }: { style?: CSSProperties; children?: ReactNode }) {
  return <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", ...style }}>{children}</div>;
}

type Extrapolate = "clamp" | "extend";

export function interpolate(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  options: { extrapolateLeft?: Extrapolate; extrapolateRight?: Extrapolate; easing?: (t: number) => number } = {}
): number {
  const { extrapolateLeft = "extend", extrapolateRight = "extend", easing = (t: number) => t } = options;
  const last = inputRange.length - 1;
  if (input <= inputRange[0]! && extrapolateLeft === "clamp") return outputRange[0]!;
  if (input >= inputRange[last]! && extrapolateRight === "clamp") return outputRange[last]!;
  let i = 0;
  while (i < last - 1 && input > inputRange[i + 1]!) i++;
  const [a, b] = [inputRange[i]!, inputRange[i + 1]!];
  const [c, d] = [outputRange[i]!, outputRange[i + 1]!];
  const t = b === a ? 0 : (input - a) / (b - a);
  return c + (d - c) * easing(t);
}

/** Damped spring from 0 to 1, simulated deterministically up to `frame`. */
export function spring({
  frame,
  fps,
  config = {}
}: {
  frame: number;
  fps: number;
  config?: { damping?: number; mass?: number; stiffness?: number };
}): number {
  if (frame <= 0) return 0;
  const { damping = 10, mass = 1, stiffness = 100 } = config;
  const steps = 4;
  const dt = 1 / fps / steps;
  let x = 0;
  let v = 0;
  const total = Math.min(Math.round(frame * steps), 2400);
  for (let i = 0; i < total; i++) {
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a * dt;
    x += v * dt;
  }
  return x;
}

export const Easing = {
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
};

type StageProps = {
  durationInFrames: number;
  fps?: number;
  width?: number;
  height?: number;
  /** Plays live when true; otherwise renders `frame`. */
  playing?: boolean;
  frame?: number;
  loop?: boolean;
  onFrame?: (frame: number) => void;
  onEnded?: () => void;
  className?: string;
  label?: string;
  children: ReactNode;
};

/**
 * Hosts a composition at its native canvas size and scales it to fit the box
 * (like object-fit: contain). When `playing`, a requestAnimationFrame clock drives
 * the frame; time is wall-clock based so a slow device drops frames instead of
 * slowing the story down.
 */
export function Stage({
  durationInFrames,
  fps = 30,
  width = 1080,
  height = 1920,
  playing = false,
  frame: controlledFrame = 0,
  loop = true,
  onFrame,
  onEnded,
  className,
  label,
  children
}: StageProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [liveFrame, setLiveFrame] = useState(controlledFrame);
  const startRef = useRef<number | null>(null);
  const offsetRef = useRef(controlledFrame);
  const callbacks = useRef({ onFrame, onEnded });
  callbacks.current = { onFrame, onEnded };

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => {
      const { width: w, height: h } = box.getBoundingClientRect();
      setScale(Math.min(w / width, h / height));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [width, height]);

  // A new requested frame (e.g. the poster, or 0 when a story becomes active) moves the clock.
  useEffect(() => {
    setLiveFrame(controlledFrame);
    offsetRef.current = controlledFrame;
    startRef.current = null;
  }, [controlledFrame]);

  // Pausing keeps the current frame; playing resumes from it.
  useEffect(() => {
    if (!playing) {
      startRef.current = null;
      return;
    }
    let raf = 0;
    const tick = (now: number) => {
      if (startRef.current === null) startRef.current = now - (offsetRef.current / fps) * 1000;
      let next = Math.floor(((now - startRef.current) / 1000) * fps);
      if (next >= durationInFrames) {
        if (loop) {
          startRef.current = now;
          next = 0;
        } else {
          next = durationInFrames - 1;
          offsetRef.current = next;
          setLiveFrame(next);
          callbacks.current.onEnded?.();
          return;
        }
      }
      offsetRef.current = next;
      setLiveFrame(next);
      callbacks.current.onFrame?.(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      startRef.current = null;
    };
  }, [playing, durationInFrames, fps, loop]);

  const value = useMemo(
    () => ({ frame: liveFrame, fps, durationInFrames, width, height }),
    [liveFrame, fps, durationInFrames, width, height]
  );

  return (
    <div ref={boxRef} className={className} role="img" aria-label={label} style={{ position: className ? undefined : "relative", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width,
          height,
          transform: `translate(-50%, -50%) scale(${scale || 0.0001})`,
          transformOrigin: "center",
          visibility: scale ? "visible" : "hidden"
        }}
      >
        {/* Compositions mount only in the browser: they are visual, the readable text lives outside. */}
        {scale ? <FrameContext.Provider value={value}>{children}</FrameContext.Provider> : null}
      </div>
    </div>
  );
}

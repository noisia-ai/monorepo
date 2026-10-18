"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Shared playback rules for looping animations: play only while on screen, respect
 * "reduce motion" (live, not just on load), and let the reader pause (WCAG 2.2.2).
 */
export function usePlayback(ref: RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => setReduced(motion.matches);
    onMotion();
    motion.addEventListener("change", onMotion);
    const onScroll = () => {
      const box = ref.current?.getBoundingClientRect();
      if (box) setVisible(box.top < window.innerHeight * 0.9 && box.bottom > window.innerHeight * 0.1);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      motion.removeEventListener("change", onMotion);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ref]);

  const playing = visible && !paused && !reduced;
  return { playing, reduced, paused, toggle: () => setPaused((value) => !value) };
}

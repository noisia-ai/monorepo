"use client";

import { useEffect, useSyncExternalStore } from "react";

// Pages whose slug changes with the language register the URL of their translation here,
// so the header's language switch lands on the same page instead of a 404.
let current: string | null = null;
const listeners = new Set<() => void>();

function set(value: string | null) {
  current = value;
  listeners.forEach((listener) => listener());
}

export function useAlternateHref(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null
  );
}

export function SetAlternate({ href }: { href: string }) {
  useEffect(() => {
    set(href);
    return () => set(null);
  }, [href]);
  return null;
}

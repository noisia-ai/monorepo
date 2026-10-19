"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Apple-style entrances: every [data-reveal] element rises and fades in the first time it
 * enters the viewport. Hidden only when this script runs (html.js-reveal), so without
 * JavaScript, or with reduced motion, everything is simply visible.
 */
export function ScrollReveal() {
  const pathname = usePathname();
  useEffect(() => {
    const root = document.documentElement;
    if (!root.classList.contains("js-reveal")) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.revealed = "";
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 }
    );
    const scan = () => document.querySelectorAll<HTMLElement>("[data-reveal]:not([data-revealed])").forEach((el) => observer.observe(el));
    scan();
    // Client navigations and late content (galleries, tabs) bring new elements.
    const mutations = new MutationObserver(scan);
    const main = document.getElementById("main");
    if (main) mutations.observe(main, { childList: true, subtree: true });
    // Safety net: never leave content hidden if an observer misses it.
    const fallback = window.setTimeout(() => {
      document.querySelectorAll<HTMLElement>("[data-reveal]:not([data-revealed])").forEach((el) => {
        if (el.getBoundingClientRect().top < window.innerHeight) el.dataset.revealed = "";
      });
    }, 2500);
    return () => {
      observer.disconnect();
      mutations.disconnect();
      window.clearTimeout(fallback);
    };
  }, [pathname]);
  return null;
}

"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const FROM = { opacity: 0, transform: "translateY(56px) scale(0.985)" };
const TO = { opacity: 1, transform: "none" };

/**
 * Apple-style entrances: every [data-reveal] element rises and fades in the first time it
 * enters the viewport. It animates with the Web Animations API and never touches the
 * element's attributes, so React hydration never sees a difference from the server HTML.
 * Hidden only once this script runs (html.js-reveal); without JavaScript, or with reduced
 * motion, everything is simply visible.
 */
export function ScrollReveal() {
  const pathname = usePathname();
  useEffect(() => {
    const root = document.documentElement;
    if (!root.classList.contains("js-reveal")) return;
    const done = new WeakSet<Element>();
    const reveal = (el: HTMLElement) => {
      if (done.has(el)) return;
      done.add(el);
      const delay = parseFloat(getComputedStyle(el).getPropertyValue("--reveal-delay")) || 0;
      el.animate([FROM, TO], { duration: 1100, delay, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" });
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          reveal(entry.target as HTMLElement);
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 }
    );
    const scan = () =>
      document.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el) => {
        if (!done.has(el)) observer.observe(el);
      });
    scan();
    // Client navigations and late content (galleries, tabs) bring new elements.
    const mutations = new MutationObserver(scan);
    const main = document.getElementById("main");
    if (main) mutations.observe(main, { childList: true, subtree: true });
    // Safety net: never leave content hidden if an observer misses it.
    const fallback = window.setTimeout(() => {
      document.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el) => {
        if (el.getBoundingClientRect().top < window.innerHeight) reveal(el);
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

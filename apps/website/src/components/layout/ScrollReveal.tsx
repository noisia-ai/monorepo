"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function ScrollReveal() {
  const pathname = usePathname();

  useEffect(() => {
    document.documentElement.classList.add("has-scroll-reveal");

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sectionSelectors = ["[data-reveal]", ".section", ".page-intro"];
    const groupSelectors = [
      "[data-reveal-group]",
      ".hero-proof",
      ".surface-grid",
      ".methodology-grid",
      ".methodology-catalog-grid",
      ".source-cloud",
      ".tier-grid",
      ".content-grid",
      ".detail-layout",
      ".architecture-flow",
      ".editorial-list",
      ".sources-constellation",
      ".pipeline-flow",
      ".integrity-grid",
      ".evidence-strip__track",
      ".mlab__quotes",
      ".deliverables-tier--primary",
      ".foundation-cards",
      ".related-cases",
      ".process-trace",
      ".method-stats-strip",
      ".method-cases-list",
      ".method-foundations-list",
      ".method-wizard-v2__list",
      ".case-vignette-flow",
      ".case-why-block__list",
      ".case-methods-list",
      ".services-tiers-list",
      ".services-spec",
      ".services-no-list",
    ];

    const sections = Array.from(
      new Set(
        sectionSelectors.flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
      )
    );
    sections.forEach((section) => {
      if (!section.hasAttribute("data-reveal")) {
        section.setAttribute("data-auto-reveal", "");
      }
    });

    const groups = Array.from(
      new Set(
        groupSelectors.flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
      )
    );
    const items = groups.flatMap((group) =>
      (Array.from(group.children) as HTMLElement[]).map((item, index) => {
        item.classList.add("reveal-item");
        item.style.setProperty("--reveal-delay", `${index * 70}ms`);
        return item;
      })
    );

    sections.forEach((section) => section.classList.remove("is-visible"));
    items.forEach((item) => item.classList.remove("is-visible"));

    if (reducedMotion || !("IntersectionObserver" in window)) {
      sections.forEach((section) => section.classList.add("is-visible"));
      items.forEach((item) => item.classList.add("is-visible"));
      return;
    }

    let sectionObserver: IntersectionObserver | null = null;
    let itemObserver: IntersectionObserver | null = null;
    const frame = window.requestAnimationFrame(() => {
      sectionObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              sectionObserver?.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.04, rootMargin: "0px 0px 18% 0px" }
      );

      itemObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              itemObserver?.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.08, rootMargin: "0px 0px 10% 0px" }
      );

      sections.forEach((section) => sectionObserver?.observe(section));
      items.forEach((item) => itemObserver?.observe(item));
    });

    return () => {
      window.cancelAnimationFrame(frame);
      sectionObserver?.disconnect();
      itemObserver?.disconnect();
    };
  }, [pathname]);

  return null;
}

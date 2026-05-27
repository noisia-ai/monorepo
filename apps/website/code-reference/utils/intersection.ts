export const revealOnScroll = () => {
  document.documentElement.classList.add("has-scroll-reveal");

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    .matches;
  const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
  const groups = [
    ".landscape-grid",
    ".quote-column",
    ".chart-panel",
    ".timeline-layout",
    ".viral-flow",
    ".latam-map-wrap",
    ".market-grid",
    ".influence-grid",
    ".influence-matrix",
    ".bet-grid",
    ".closing-block"
  ];
  const items = groups.flatMap((selector) =>
    Array.from(document.querySelectorAll<HTMLElement>(selector)).flatMap((group) =>
      (Array.from(group.children) as HTMLElement[]).map((item, index) => {
        item.classList.add("reveal-item");
        item.style.setProperty("--reveal-delay", `${index * 70}ms`);
        return item;
      })
    )
  );

  if (reducedMotion || !("IntersectionObserver" in window)) {
    sections.forEach((section) => section.classList.add("is-visible"));
    items.forEach((item) => item.classList.add("is-visible"));
    return;
  }

  const sectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          sectionObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.04, rootMargin: "0px 0px 18% 0px" }
  );

  const itemObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          itemObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.08, rootMargin: "0px 0px 10% 0px" }
  );

  sections.forEach((section) => sectionObserver.observe(section));
  items.forEach((item) => itemObserver.observe(item));
};

export const countUp = (node: HTMLElement, target: number) => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    .matches;

  if (reducedMotion) {
    node.textContent = target.toFixed(1);
    return;
  }

  const duration = 900;
  const start = performance.now();

  const tick = (now: number) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    node.textContent = (target * eased).toFixed(1);

    if (progress < 1) requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
};

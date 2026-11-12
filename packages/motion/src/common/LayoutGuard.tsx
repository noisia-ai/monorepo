import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cancelRender, continueRender, delayRender, useCurrentFrame } from "../engine";

/**
 * QA that fails on its own (VIDEO.md §7): with `qa` on, every frame measures the blocks tagged
 * `data-qa="<scene>.<element>"` that are visible (opacity over 0.05) and stops the render, naming the
 * two elements and the frame, when two of them cross or one leaves the frame. build-video --qa renders
 * the transition frames, so an overlap fails the build instead of waiting for someone to spot it.
 *
 * Tag blocks, not words: a block is what must never touch another block. Nested tags are fine (a tag
 * inside another one is not compared with its parent).
 */
const MIN_OVERLAP = 6; // px on the 1080 canvas: a touch of anti-aliasing is not an overlap
const VISIBLE = 0.05;

const alpha = (n: Element) => parseFloat(getComputedStyle(n).opacity || "1");

/** What the eye gets: the ancestors' opacity, and the single-child wrappers inside the tag (a card's own fade). */
function opacityOf(el: Element, root: Element): number {
  let o = 1;
  for (let n: Element | null = el; n && n !== root.parentElement; n = n.parentElement) o *= alpha(n);
  for (let n = el; n.children.length === 1; ) {
    n = n.children[0];
    o *= alpha(n);
  }
  return o;
}

export function LayoutGuard({ on, width, height, children }: { on: boolean; width: number; height: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useCurrentFrame();
  useLayoutEffect(() => {
    if (!on || !ref.current) return;
    const root = ref.current;
    const handle = delayRender(`layout guard, frame ${frame}`);
    // Measure once fonts are in: a fallback font has other widths and would give false alarms.
    document.fonts.ready.then(() => {
      const box = root.getBoundingClientRect();
      const k = width / box.width; // stills render at a scale; compare on the canvas
      const els = Array.from(root.querySelectorAll<HTMLElement>("[data-qa]"))
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { el, name: el.dataset.qa!, x0: (r.left - box.left) * k, y0: (r.top - box.top) * k, x1: (r.right - box.left) * k, y1: (r.bottom - box.top) * k };
        })
        .filter((b) => b.x1 - b.x0 > 1 && b.y1 - b.y0 > 1 && opacityOf(b.el, root) > VISIBLE);
      const problems: string[] = [];
      for (const b of els) {
        if (b.x0 < -MIN_OVERLAP || b.y0 < -MIN_OVERLAP || b.x1 > width + MIN_OVERLAP || b.y1 > height + MIN_OVERLAP) problems.push(`${b.name} leaves the frame`);
      }
      for (let i = 0; i < els.length; i++)
        for (let j = i + 1; j < els.length; j++) {
          const a = els[i];
          const b = els[j];
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
          const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
          if (w > MIN_OVERLAP && h > MIN_OVERLAP) problems.push(`${a.name} crosses ${b.name} (${Math.round(w)}×${Math.round(h)} px)`);
        }
      if (problems.length) cancelRender(new Error(`layout guard, frame ${frame}: ${problems.join("; ")}`));
      else continueRender(handle);
    });
  }, [on, frame, width, height]);
  return (
    <div ref={ref} style={{ position: "absolute", inset: 0 }}>
      {children}
    </div>
  );
}

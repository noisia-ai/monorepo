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
// Leaving the frame only counts while the block still reads: an exit that slides out as it fades is
// a gesture, not a layout problem.
const LEGIBLE = 0.6;

const alpha = (n: Element) => parseFloat(getComputedStyle(n).opacity || "1");

/** How visible a block's content is: its own opacity times its most visible child. Text of its own
 *  counts as fully visible. A wrapper that stays mounted with every child faded out (the climax chat
 *  before it starts) reads as invisible, not as a full-size opaque box. */
function inner(el: Element): number {
  const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "");
  const kids = Array.from(el.children);
  const best = own || el instanceof SVGElement || el.tagName === "IMG" || !kids.length ? 1 : Math.max(0, ...kids.map(inner));
  return alpha(el) * best;
}

/** What the eye gets: the ancestors' opacity times what is visible inside the tag. */
function opacityOf(el: Element, root: Element): number {
  let o = 1;
  for (let n: Element | null = el.parentElement; n && n !== root.parentElement; n = n.parentElement) o *= alpha(n);
  return o * inner(el);
}

export function LayoutGuard({ on, width, height, bottom, children }: { on: boolean; width: number; height: number; bottom?: number; children: ReactNode }) {
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
          // A card animates its own child (translate, scale), and the tag's box does not move with
          // it: measure the union of the tag and its single-child chain, where the eye sees it.
          let r = el.getBoundingClientRect();
          let [x0, y0, x1, y1] = [r.left, r.top, r.right, r.bottom];
          for (let n: Element = el; n.children.length === 1; ) {
            n = n.children[0];
            r = n.getBoundingClientRect();
            [x0, y0, x1, y1] = [Math.min(x0, r.left), Math.min(y0, r.top), Math.max(x1, r.right), Math.max(y1, r.bottom)];
          }
          return { el, name: el.dataset.qa!, x0: (x0 - box.left) * k, y0: (y0 - box.top) * k, x1: (x1 - box.left) * k, y1: (y1 - box.top) * k };
        })
        .map((b) => ({ ...b, o: opacityOf(b.el, root) }))
        .filter((b) => b.x1 - b.x0 > 1 && b.y1 - b.y0 > 1 && b.o > VISIBLE);
      const problems: string[] = [];
      for (const b of els) {
        const out = b.x0 < -MIN_OVERLAP || b.y0 < -MIN_OVERLAP || b.x1 > width + MIN_OVERLAP || b.y1 > height + MIN_OVERLAP;
        if (out && b.o >= LEGIBLE) problems.push(`${b.name} leaves the frame`);
        // The caption band is kept free even when nobody speaks: a card that reaches it collides as
        // soon as the voice comes back.
        else if (bottom != null && b.name !== "captions" && b.y1 > bottom + MIN_OVERLAP) problems.push(`${b.name} reaches the caption band (bottom ${Math.round(b.y1)} > ${bottom})`);
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

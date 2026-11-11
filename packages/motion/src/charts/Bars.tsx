import { useCurrentFrame, useVideoConfig } from "../engine";
import { color } from "../brand/theme";
import { countUp, enter, formatNumber } from "../brand/util";
import { text } from "../common/text";

type Item = { label: string; value: number; highlight?: boolean };

/** Horizontal bars, staggered 9 frames, spring damping 22 (VIDEO.md §4.4). */
export function Bars({ items, unit = "", locale, delay = 6, size = 1 }: { items: Item[]; unit?: string; locale: string; delay?: number; size?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const max = Math.max(...items.map((item) => Math.abs(item.value)), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 54 * size }}>
      {items.map((item, i) => {
        const at = delay + i * 9;
        const p = enter(frame, fps, at, 22);
        const hi = Boolean(item.highlight);
        return (
          <div key={item.label} style={{ display: "flex", flexDirection: "column", gap: 14 * size, opacity: Math.min(1, p * 1.4) }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 24 }}>
              <span style={text(54 * size, hi ? 500 : 400, { color: hi ? color.ink : color.fg })}>{item.label}</span>
              <span style={text(62 * size, 500, { color: hi ? color.teal : color.muted, fontVariantNumeric: "tabular-nums" })}>
                {formatNumber(countUp(frame, item.value, at, 26), item.value, locale)}
                {unit}
              </span>
            </div>
            <div style={{ height: 32 * size, borderRadius: 16 * size, background: color.track, overflow: "hidden" }}>
              <div style={{ width: `${Math.max(0.02, Math.abs(item.value) / max) * 100 * p}%`, height: "100%", borderRadius: 16 * size, background: hi ? color.teal : color.faint }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

import { useCurrentFrame, useVideoConfig } from "../engine";
import { color } from "../brand/theme";
import { countUp, enter, formatNumber, rise } from "../brand/util";
import { text } from "../common/text";

type Side = { label: string; value: number; suffix: string };

/** Two panels face to face: teal is what pushes, coral what holds back. */
export function Split({ left, right, locale, delay = 4, size = 1 }: { left: Side; right: Side; locale: string; delay?: number; size?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const side = (item: Side, at: number, tone: string) => (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 18, ...rise(frame, fps, at) }}>
      <p style={text(170 * size, 500, { color: tone, lineHeight: 0.95, fontVariantNumeric: "tabular-nums" })}>
        {formatNumber(countUp(frame, item.value, at, 30), item.value, locale)}
        <span style={{ fontSize: 86 * size }}>{item.suffix}</span>
      </p>
      <p style={text(46 * size, 400, { color: color.fg })}>{item.label}</p>
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 48, alignItems: "flex-start" }}>
      {side(left, delay, color.teal)}
      <div style={{ width: 3, alignSelf: "stretch", background: color.line, transform: `scaleY(${enter(frame, fps, delay + 6)})` }} />
      {side(right, delay + 12, color.coral)}
    </div>
  );
}

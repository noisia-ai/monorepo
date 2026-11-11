import { useCurrentFrame, useVideoConfig } from "../engine";
import { color } from "../brand/theme";
import { countUp, enter, formatNumber, rise } from "../brand/util";
import { text } from "../common/text";

/** A hero number (it can count down, e.g. to the 0 of a climax) with an optional grid of dots. */
export function BigNumber({ value, from = 0, suffix = "", label, dots, locale, delay = 4, tone = color.teal }: {
  value: number; from?: number; suffix?: string; label: string; dots?: { total: number; on: number }; locale: string; delay?: number; tone?: string;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const shown = countUp(frame, value, delay, 34, from);
  const digits = formatNumber(shown, value, locale).length + suffix.length;
  const size = value === 0 ? 360 : digits > 6 ? 200 : 260;
  const cols = dots ? Math.ceil(Math.sqrt(dots.total * 1.6)) : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <p style={text(size, 500, { lineHeight: 0.92, color: tone, fontVariantNumeric: "tabular-nums", ...rise(frame, fps, delay - 4, 30) })}>
        {formatNumber(shown, value, locale)}
        <span style={{ fontSize: size * 0.45 }}>{suffix}</span>
      </p>
      <p style={text(58, 500, rise(frame, fps, delay + 14))}>{label}</p>
      {dots ? (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 10, marginTop: 12 }}>
          {Array.from({ length: dots.total }, (_, i) => {
            const p = enter(frame, fps, delay + 10 + (i % cols) + Math.floor(i / cols) * 2, 20);
            return <div key={i} style={{ aspectRatio: "1", borderRadius: "50%", background: i < dots.on ? tone : color.line, transform: `scale(${p})` }} />;
          })}
        </div>
      ) : null}
    </div>
  );
}

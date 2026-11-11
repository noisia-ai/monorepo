import { useCurrentFrame } from "../engine";
import { color } from "../brand/theme";
import { countUp, formatNumber } from "../brand/util";
import { text } from "../common/text";

/** A share of 100 that draws itself, with the number in the middle. */
export function Ring({ value, label, tone = "teal", locale, delay = 4, size = 420 }: { value: number; label: string; tone?: "teal" | "coral"; locale: string; delay?: number; size?: number }) {
  const frame = useCurrentFrame();
  const shown = countUp(frame, value, delay, 32);
  const stroke = size * 0.09;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ink = tone === "coral" ? color.coral : color.teal;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 56 }}>
      <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color.track} strokeWidth={stroke} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ink} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - shown / 100)} />
        </svg>
        <p style={text(size * 0.3, 500, { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: ink, fontVariantNumeric: "tabular-nums" })}>
          {formatNumber(shown, value, locale)}
          <span style={{ fontSize: size * 0.15 }}>%</span>
        </p>
      </div>
      <p style={text(50, 400, { color: color.fg, lineHeight: 1.2 })}>{label}</p>
    </div>
  );
}

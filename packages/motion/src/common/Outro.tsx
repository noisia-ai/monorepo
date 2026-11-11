import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "../engine";
import { Logo } from "../brand/Logo";
import { color, font } from "../brand/theme";
import { enter } from "../brand/util";

/** The close: the real logo fades in, scaling from 0.92 to 1 (VIDEO.md §4.4). */
export function Outro({ locale, delay = 0 }: { locale: string; delay?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = enter(frame, fps, delay, 20);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 36, opacity: p }}>
      <Logo width={560} style={{ transform: `scale(${0.92 + p * 0.08})` }} />
      <span style={{ fontFamily: font, fontSize: 40, color: color.muted }}>{locale === "en" ? "Social intelligence" : "Inteligencia social"}</span>
    </AbsoluteFill>
  );
}

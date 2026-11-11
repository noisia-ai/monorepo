import { Img, staticFile } from "../engine";

/** The real Noisia logo, never typed text (VIDEO.md §2). */
export const LOGO_RATIO = 913 / 319;

export function Logo({ width = 560, variant = "color", style }: { width?: number; variant?: "color" | "white"; style?: React.CSSProperties }) {
  return (
    <Img
      src={staticFile(variant === "white" ? "brand/noisia-white.svg" : "brand/noisia.svg")}
      style={{ width, height: Math.round(width / LOGO_RATIO), display: "block", ...style }}
    />
  );
}

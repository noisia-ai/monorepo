/* eslint-disable @next/next/no-img-element -- static SVG, no optimization needed */

/** The Noisia wordmark with its chromatic offset. Always the real logo, never typed text. */
export const LOGO_RATIO = 913 / 319;

export function Logo({ height = 24, variant = "color", className }: { height?: number; variant?: "color" | "white"; className?: string }) {
  return (
    <img
      src={variant === "white" ? "/brand/noisia-white.svg" : "/brand/noisia.svg"}
      alt="Noisia"
      width={Math.round(height * LOGO_RATIO)}
      height={height}
      className={className}
      draggable={false}
    />
  );
}

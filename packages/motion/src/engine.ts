/**
 * The one door to the animation engine. Every component imports from here and never from
 * "remotion" directly, so the same components can later run on the website's own runtime
 * (apps/website-next/src/motion/runtime.tsx), which exposes the same names (VIDEO.md §6).
 */
export {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  Sequence,
  continueRender,
  delayRender,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from "remotion";

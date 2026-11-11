import { AbsoluteFill, Img, staticFile } from "../engine";
import type { Background as Bg } from "../schema";
import { color } from "../brand/theme";

/**
 * The four backgrounds of VIDEO.md §4.1. The bloom is a still image on purpose: animated grain
 * took one video from 14.7 MB to 415 MB.
 */
export function Background({ bg }: { bg: Bg }) {
  switch (bg.kind) {
    case "bloom":
      return (
        <AbsoluteFill style={{ background: color.canvas }}>
          <Img src={staticFile(`backgrounds/${bg.name}.jpg`)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </AbsoluteFill>
      );
    case "wash":
      return <AbsoluteFill style={{ background: `linear-gradient(180deg, ${color.canvas} 0%, ${color.canvas} 55%, #f1f9f9 100%)` }} />;
    case "white":
      return <AbsoluteFill style={{ background: "#ffffff" }} />;
    case "image":
      return (
        <AbsoluteFill style={{ background: color.canvas }}>
          <Img src={staticFile(`piece/${bg.src}`)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <AbsoluteFill style={{ background: `rgba(255,255,255,${bg.veil})` }} />
        </AbsoluteFill>
      );
  }
}

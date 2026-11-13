import { AbsoluteFill, Sequence } from "../engine";
import { Fonts } from "../brand/Fonts";
import { WEBSITE, type Locale } from "./registry";

/**
 * A noisia.ai composition rendered by Remotion, for decks (credentials, COMMERCIAL.md §2.1).
 * `rotate` starts the loop on that frame: the GIF for a slide opens on the finished diagram (the
 * website's poster frame), which is all a PDF or Slides shows.
 */
export type WebsiteProps = { name: string; locale: Locale; rotate: number; catalog?: Record<string, { about: string; frames: number; poster: number }> };

export function Website({ name, locale, rotate }: WebsiteProps) {
  const e = WEBSITE[name];
  if (!e) throw new Error(`no website composition "${name}". Names: ${Object.keys(WEBSITE).join(", ")}`);
  const d = e.frames;
  return (
    // The website sets --font-google-sans with next/font; without it, "var(--font-google-sans), ..."
    // invalidates the whole font-family and the piece renders in a serif.
    <AbsoluteFill style={{ background: "#ffffff", ["--font-google-sans" as string]: "'Google Sans'" }}>
      <Fonts />
      {rotate > 0 ? (
        <>
          <Sequence from={-rotate} durationInFrames={d}>{e.render(locale)}</Sequence>
          <Sequence from={d - rotate} durationInFrames={rotate}>{e.render(locale)}</Sequence>
        </>
      ) : (
        e.render(locale)
      )}
    </AbsoluteFill>
  );
}

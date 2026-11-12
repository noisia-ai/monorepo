import { useCurrentFrame } from "../engine";
import type { Clip } from "../schema";
import { SAFE, color, font } from "../brand/theme";

/**
 * Word-by-word captions from the narrator's timestamps (VIDEO.md §5.3): one line of up to 30
 * characters, the spoken word in ink and the next ones in grey. Quotes have their own card and are
 * never captioned.
 */
export function Captions({ clips, bottom = SAFE.bottomPublish }: { clips: Clip[]; bottom?: number }) {
  const frame = useCurrentFrame();
  const clip = clips.find((c) => c.kind !== "quote" && c.words.length && frame >= c.at - 2 && frame <= c.at + c.len + 6);
  if (!clip) return null;
  const lines: Clip["words"][] = [];
  let cur: Clip["words"] = [];
  let n = 0;
  for (const w of clip.words) {
    cur.push(w);
    n += w[0].length + 1;
    if (n > 30 || /[.?!:]$/.test(w[0])) {
      lines.push(cur);
      cur = [];
      n = 0;
    }
  }
  if (cur.length) lines.push(cur);
  const t = frame - clip.at;
  const line = lines.find((l) => t <= l[l.length - 1][2] + 3) ?? lines[lines.length - 1];
  return (
    <div data-qa="captions" style={{ position: "absolute", left: SAFE.side, right: SAFE.side, bottom, textAlign: "center", fontFamily: font, fontSize: 46, lineHeight: 1.25, fontWeight: 700 }}>
      <span style={{ background: "rgba(255,255,255,.9)", padding: "8px 18px", borderRadius: 14, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}>
        {line.map((w, i) => (
          <span key={i} style={{ color: t >= w[1] ? color.ink : color.upcoming }}>
            {w[0]}
            {i < line.length - 1 ? " " : ""}
          </span>
        ))}
      </span>
    </div>
  );
}

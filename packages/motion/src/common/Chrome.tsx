import { interpolate, useCurrentFrame } from "../engine";
import { SAFE, color, font } from "../brand/theme";
import { clamp } from "../brand/util";

/** Progress segments, one per scene (equal in the clip, proportional elsewhere), and the tag chip. */
export function Chrome({ lengths, tag }: { lengths: number[]; tag?: string }) {
  const frame = useCurrentFrame();
  let start = 0;
  return (
    <div style={{ position: "absolute", left: SAFE.side, right: SAFE.side, top: 56, display: "flex", flexDirection: "column", gap: 30 }}>
      <div style={{ display: "flex", gap: 10 }}>
        {lengths.map((length, i) => {
          const fill = interpolate(frame, [start, start + length], [0, 1], clamp);
          start += length;
          return (
            <div key={i} style={{ flex: length, height: 8, borderRadius: 4, background: "rgba(10,10,10,0.08)", overflow: "hidden" }}>
              <div style={{ width: `${fill * 100}%`, height: "100%", background: color.ink, opacity: 0.55 }} />
            </div>
          );
        })}
      </div>
      {tag ? (
        <span
          style={{
            alignSelf: "flex-start",
            fontFamily: font,
            fontSize: 34,
            fontWeight: 500,
            color: color.teal,
            background: "rgba(255,255,255,0.8)",
            border: `2px solid ${color.tealSoft}`,
            borderRadius: 999,
            padding: "10px 24px"
          }}
        >
          {tag}
        </span>
      ) : null}
    </div>
  );
}

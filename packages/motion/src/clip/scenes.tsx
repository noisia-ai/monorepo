// The eight clip templates. Ported from apps/website-next/src/motion/scenes.tsx with the same
// timings and sizes, so a story looks the same on noisia.ai/insights and in the exported video.
import { interpolate, useCurrentFrame, useVideoConfig } from "../engine";
import type { Scene } from "../schema";
import { Icon, PlatformMark, platformLabel } from "../brand/marks";
import { color } from "../brand/theme";
import { clamp, countUp, enter, formatNumber, rise } from "../brand/util";
import { Shell, Words, bare, text } from "../common/text";
import { Bars } from "../charts/Bars";

type SceneProps<T extends Scene["type"]> = { scene: Extract<Scene, { type: T }>; locale: string; bottomSafe: number };

export function HookScene({ scene, bottomSafe }: SceneProps<"hook">) {
  const size = scene.text.length > 48 ? 104 : 128;
  return (
    <Shell bottomSafe={bottomSafe}>
      <Words value={scene.text} size={size} />
    </Shell>
  );
}

export function StatScene({ scene, locale, bottomSafe }: SceneProps<"stat">) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const shown = countUp(frame, scene.value, 6, 34);
  const digits = formatNumber(shown, scene.value, locale).length + scene.suffix.length;
  const size = digits > 6 ? 230 : 300;
  return (
    <Shell bottomSafe={bottomSafe}>
      <p style={text(size, 500, { lineHeight: 0.92, color: color.teal, fontVariantNumeric: "tabular-nums", ...rise(frame, fps, 0, 30) })}>
        {formatNumber(shown, scene.value, locale)}
        <span style={{ fontSize: size * 0.5 }}>{scene.suffix}</span>
      </p>
      <p style={text(70, 500, rise(frame, fps, 18))}>{scene.label}</p>
      {scene.context ? <p style={text(48, 400, { color: color.muted, ...rise(frame, fps, 30) })}>{scene.context}</p> : null}
    </Shell>
  );
}

export function CompareScene({ scene, locale, bottomSafe }: SceneProps<"compare">) {
  return (
    <Shell bottomSafe={bottomSafe}>
      <Bars items={scene.items} unit={scene.unit} locale={locale} />
    </Shell>
  );
}

export function JourneyScene({ scene, locale, bottomSafe }: SceneProps<"journey">) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const max = Math.max(...scene.steps.map((step) => Math.abs(step.value)), 1);
  const diverging = scene.steps.some((step) => step.value < 0) && scene.steps.some((step) => step.value > 0);
  return (
    <Shell bottomSafe={bottomSafe}>
      <div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
        {scene.steps.map((step, i) => {
          const delay = 4 + i * 8;
          const p = enter(frame, fps, delay, 20);
          const isHi = i === scene.highlightIndex;
          const negative = step.value < 0;
          const strong = negative ? color.coral : color.teal;
          const soft = negative ? "#f3c2b7" : "#a9dada";
          const share = (Math.abs(step.value) / max) * p;
          return (
            <div key={step.label} style={{ display: "grid", gridTemplateColumns: "300px 1fr 170px", alignItems: "center", gap: 24, opacity: Math.min(1, p * 1.5) }}>
              <span style={text(isHi ? 50 : 44, isHi ? 500 : 400, { color: isHi ? color.ink : color.fg })}>{step.label}</span>
              <div style={{ position: "relative", height: 44 }}>
                <div style={{ position: "absolute", inset: 0, borderRadius: 22, background: color.track }} />
                {diverging ? <div style={{ position: "absolute", left: "50%", top: -10, bottom: -10, width: 3, background: color.line }} /> : null}
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    borderRadius: 22,
                    background: isHi ? strong : soft,
                    width: `${(diverging ? 50 : 100) * share}%`,
                    left: diverging ? (negative ? `${50 - 50 * share}%` : "50%") : 0,
                    boxShadow: isHi ? `0 0 0 ${10 * p}px ${negative ? color.coralSoft : color.tealSoft}` : "none"
                  }}
                />
              </div>
              <span style={text(isHi ? 50 : 44, 500, { textAlign: "right", color: isHi ? strong : color.muted, fontVariantNumeric: "tabular-nums" })}>
                {step.value > 0 && diverging ? "+" : ""}
                {formatNumber(countUp(frame, step.value, delay, 24), step.value, locale)}
                {scene.unit}
              </span>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}

export function SplitScene({ scene, locale, bottomSafe }: SceneProps<"split">) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const side = (item: typeof scene.left, delay: number, tone: string) => (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 18, ...rise(frame, fps, delay) }}>
      <p style={text(200, 500, { color: tone, lineHeight: 0.95, fontVariantNumeric: "tabular-nums" })}>
        {formatNumber(countUp(frame, item.value, delay, 30), item.value, locale)}
        <span style={{ fontSize: 100 }}>{item.suffix}</span>
      </p>
      <p style={text(50, 400, { color: color.fg })}>{item.label}</p>
    </div>
  );
  return (
    <Shell bottomSafe={bottomSafe}>
      <div style={{ display: "flex", gap: 48, alignItems: "flex-start" }}>
        {side(scene.left, 4, color.teal)}
        <div style={{ width: 3, alignSelf: "stretch", background: color.line, transform: `scaleY(${enter(frame, fps, 10)})` }} />
        {side(scene.right, 16, color.coral)}
      </div>
      {scene.caption ? <p style={text(58, 500, rise(frame, fps, 34))}>{scene.caption}</p> : null}
    </Shell>
  );
}

function StruckWords({ value, size, delay, strikeAt }: { value: string; size: number; delay: number; strikeAt: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <p style={text(size, 500, { display: "flex", flexWrap: "wrap", columnGap: size * 0.26, rowGap: size * 0.04 })}>
      {value.split(" ").map((word, i) => {
        const strike = interpolate(frame, [strikeAt + i * 3, strikeAt + i * 3 + 10], [0, 1], clamp);
        return (
          <span
            key={`${word}-${i}`}
            style={{
              display: "inline-block",
              color: strike > 0.5 ? color.muted : color.ink,
              backgroundImage: `linear-gradient(${color.coral}, ${color.coral})`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "0 56%",
              backgroundSize: `${Math.round(strike * 100)}% ${Math.round(size * 0.07)}px`,
              ...rise(frame, fps, delay + i * 3, size * 0.4)
            }}
          >
            {word}
          </span>
        );
      })}
    </p>
  );
}

export function TensionScene({ scene, locale, bottomSafe }: SceneProps<"tension">) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Shell bottomSafe={bottomSafe}>
      <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
        <StruckWords value={scene.want} size={100} delay={2} strikeAt={44} />
        <Words value={scene.but} size={100} delay={30} tone={color.coral} />
        {scene.value != null ? (
          <p style={text(56, 500, { color: color.muted, ...rise(frame, fps, 64) })}>
            {formatNumber(countUp(frame, scene.value, 64, 24), scene.value, locale)}%
          </p>
        ) : null}
      </div>
    </Shell>
  );
}

/** A mention as it was posted: chat bubble, then the platform's logo and when it was said. */
export function QuoteScene({ scene, locale, bottomSafe }: SceneProps<"quote">) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const size = scene.text.length > 150 ? 62 : scene.text.length > 90 ? 72 : 84;
  return (
    <Shell bottomSafe={bottomSafe}>
      <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
        <div style={{ position: "relative", marginLeft: 22, ...rise(frame, fps, 0, 30) }}>
          <svg width={44} height={40} viewBox="0 0 18 16" style={{ position: "absolute", left: -21, bottom: 0 }} aria-hidden>
            <path d="M18 0 C18 9 13 15 0 16 C8 12 9 6 9 0 Z" fill={color.bubble} />
          </svg>
          <div style={{ background: color.bubble, borderRadius: "56px 56px 56px 16px", padding: "48px 56px" }}>
            <p style={text(size, 400, { color: color.ink, lineHeight: 1.24 })}>{bare(scene.text)}</p>
            {scene.translation ? <p style={text(40, 400, { color: color.muted, lineHeight: 1.3, marginTop: 24 })}>{scene.translation}</p> : null}
          </div>
        </div>
        <div style={{ display: "flex", gap: 36, alignItems: "center", marginLeft: 22, ...rise(frame, fps, 16) }}>
          <span style={text(38, 500, { display: "inline-flex", alignItems: "center", gap: 14, color: color.fg })}>
            <PlatformMark platform={scene.platform} size={46} />
            {platformLabel(scene.platform, locale)}
          </span>
          {scene.meta ? (
            <span style={text(38, 400, { display: "inline-flex", alignItems: "center", gap: 12, color: color.muted })}>
              <Icon name="calendar" size={40} stroke={color.muted} width={1.7} />
              {scene.meta}
            </span>
          ) : null}
        </div>
      </div>
    </Shell>
  );
}

export function TakeawayScene({ scene, bottomSafe }: SceneProps<"takeaway">) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = enter(frame, fps, 0, 22);
  return (
    <Shell bottomSafe={bottomSafe}>
      <div style={{ padding: "64px 60px", borderRadius: 48, background: color.tealSoft, transform: `scale(${0.94 + p * 0.06})`, opacity: p }}>
        <Words value={scene.text} size={86} delay={6} stagger={2} />
      </div>
    </Shell>
  );
}

export function SceneView({ scene, locale, bottomSafe }: { scene: Scene; locale: string; bottomSafe: number }) {
  const p = { locale, bottomSafe };
  switch (scene.type) {
    case "hook":
      return <HookScene scene={scene} {...p} />;
    case "stat":
      return <StatScene scene={scene} {...p} />;
    case "compare":
      return <CompareScene scene={scene} {...p} />;
    case "journey":
      return <JourneyScene scene={scene} {...p} />;
    case "split":
      return <SplitScene scene={scene} {...p} />;
    case "tension":
      return <TensionScene scene={scene} {...p} />;
    case "quote":
      return <QuoteScene scene={scene} {...p} />;
    case "takeaway":
      return <TakeawayScene scene={scene} {...p} />;
  }
}

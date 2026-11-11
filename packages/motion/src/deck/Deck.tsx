import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "../engine";
import type { DeckPiece } from "../schema";
import { Fonts } from "../brand/Fonts";
import { Icon, PlatformMark } from "../brand/marks";
import { Logo } from "../brand/Logo";
import { color, font } from "../brand/theme";
import { clamp, countUp, easePath, enter, formatNumber, progress, rng } from "../brand/util";

/**
 * Format 4 · Deck motion (VIDEO.md §5.4): a living diagram inside a slide. The canvas is exactly its
 * box on the 1920×1080 slide, the background is exact white, labels are short and carry no figures
 * (except a counter with its source). Title and explanation stay native in the slide.
 */
export type DeckProps = { piece: DeckPiece; rotate: number };
export const deckFrames = (piece: DeckPiece) => Math.round(piece.seconds * 30);

/** Where each pattern is complete: the GIF starts here, because the PDF only shows frame one. */
export const completeAt = (piece: DeckPiece) => Math.round(deckFrames(piece) * 0.7);
const LOOP_FADE = 20;

const t = (size: number, weight = 500, tone: string = color.ink) => ({ fontFamily: font, fontSize: size, fontWeight: weight, color: tone, margin: 0, lineHeight: 1.15 });

function LoopFade({ total: d, children }: { total: number; children: React.ReactNode }) {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{ opacity: 1 - progress(f, d - LOOP_FADE, LOOP_FADE, easePath) }}>{children}</AbsoluteFill>;
}

// ---------------------------------------------------------------- chained counter
function Counter({ piece }: { piece: Extract<DeckPiece, { pattern: "counter" }> }) {
  const f = useCurrentFrame();
  const d = deckFrames(piece);
  const span = (d * 0.7 - 20) / piece.steps.length;
  const idx = Math.min(piece.steps.length - 1, Math.max(0, Math.floor((f - 10) / span)));
  const prev = idx > 0 ? piece.steps[idx - 1].value : 0;
  const at = 10 + idx * span;
  const value = countUp(f, piece.steps[idx].value, at, Math.min(30, span * 0.6), prev);
  const size = Math.min(piece.box.h * 0.36, piece.box.w * 0.16);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 18 }}>
      <p style={{ ...t(size, 500, color.teal), fontVariantNumeric: "tabular-nums" }}>{formatNumber(value, piece.steps[idx].value, piece.locale)}</p>
      <div style={{ position: "relative", height: 34, width: "100%" }}>
        {piece.steps.map((s, i) => {
          // The outgoing label leaves before the next one arrives: two labels never overlap.
          const start = 10 + i * span + (i > 0 ? 6 : 0);
          const end = 10 + (i + 1) * span;
          const o = i === piece.steps.length - 1
            ? interpolate(f, [start, start + 10], [0, 1], clamp)
            : interpolate(f, [start, start + 10, end - 4, end + 4], [0, 1, 1, 0], clamp);
          return (
            <p key={i} style={{ ...t(25, 500, color.fg), position: "absolute", left: 0, right: 0, textAlign: "center", opacity: o, transform: `translateY(${(1 - o) * 10}px)` }}>
              {s.label}
            </p>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        {piece.steps.map((_, i) => (
          <div key={i} style={{ width: i === idx ? 34 : 12, height: 12, borderRadius: 6, background: i <= idx ? color.teal : color.line }} />
        ))}
      </div>
      {piece.source ? <p style={{ ...t(16, 400, color.muted), position: "absolute", bottom: 14, right: 18 }}>{piece.source}</p> : null}
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------- stepper
function Stepper({ piece }: { piece: Extract<DeckPiece, { pattern: "stepper" }> }) {
  const f = useCurrentFrame();
  const n = piece.steps.length;
  const span = (deckFrames(piece) * 0.7 - 12) / n;
  const fill = interpolate(f, [12, 12 + span * (n - 0.5)], [0, 1], { ...clamp, easing: easePath });
  const active = Math.min(n - 1, Math.max(0, Math.floor((f - 12) / span)));
  const dot = Math.min(64, piece.box.w / (n * 2.4));
  return (
    <AbsoluteFill style={{ justifyContent: "center", padding: "0 6%" }}>
      <div style={{ position: "relative", display: "flex", justifyContent: "space-between" }}>
        <div style={{ position: "absolute", left: dot / 2, right: dot / 2, top: dot / 2 - 2, height: 4, background: color.line, borderRadius: 2 }} />
        <div style={{ position: "absolute", left: dot / 2, top: dot / 2 - 2, height: 4, width: `calc((100% - ${dot}px) * ${fill})`, background: color.teal, borderRadius: 2 }} />
        {piece.steps.map((s, i) => {
          const p = enter(f, 30, 12 + i * span - 6);
          const on = i <= active && f >= 12;
          return (
            <div key={i} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, width: dot }}>
              <div style={{ width: dot, height: dot, borderRadius: "50%", background: on ? (i === active ? color.teal : color.tealSoft) : "#fff", border: `3px solid ${on ? color.teal : color.line}`, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${0.8 + 0.2 * p})` }}>
                {s.icon ? <Icon name={s.icon} size={dot * 0.5} stroke={i === active && on ? "#fff" : color.teal} width={1.8} /> : <span style={t(dot * 0.36, 500, i === active && on ? "#fff" : color.teal)}>{i + 1}</span>}
              </div>
              <p style={{ ...t(20, i === active ? 500 : 400, i === active ? color.ink : color.muted), width: dot * 2.6, textAlign: "center", opacity: 0.65 + 0.35 * p }}>{s.label}</p>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------- cycle
function Cycle({ piece }: { piece: Extract<DeckPiece, { pattern: "cycle" }> }) {
  const f = useCurrentFrame();
  const { w, h } = piece.box;
  const n = piece.stages.length;
  const R = Math.min(w, h) * 0.36;
  const cx = w / 2;
  const cy = h / 2;
  const draw = progress(f, 6, 50, easePath);
  const lap = interpolate(f, [30, deckFrames(piece) * 0.7], [0, 1], { ...clamp, easing: easePath });
  const angle = -Math.PI / 2 + lap * 2 * Math.PI;
  const circ = 2 * Math.PI * R;
  return (
    <AbsoluteFill>
      <svg width={w} height={h} style={{ position: "absolute" }}>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke={color.line} strokeWidth={4} strokeDasharray={circ} strokeDashoffset={circ * (1 - draw)} transform={`rotate(-90 ${cx} ${cy})`} />
        <circle cx={cx} cy={cy} r={R} fill="none" stroke={color.teal} strokeWidth={4} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - lap)} transform={`rotate(-90 ${cx} ${cy})`} />
        <circle cx={cx + R * Math.cos(angle)} cy={cy + R * Math.sin(angle)} r={11} fill={color.teal} opacity={f >= 30 ? 1 : 0} />
      </svg>
      {piece.stages.map((s, i) => {
        const a = -Math.PI / 2 + (i / n) * 2 * Math.PI;
        const p = enter(f, 30, 10 + i * 5);
        const reached = lap >= i / n - 0.001 && f >= 30;
        const x = cx + (R + 12) * Math.cos(a);
        const y = cy + (R + 12) * Math.sin(a);
        return (
          <div key={i} style={{ position: "absolute", left: x, top: y, transform: `translate(-50%, -50%) scale(${0.85 + 0.15 * p})`, opacity: p, background: reached ? color.tealSoft : "#fff", border: `2px solid ${reached ? color.teal : color.line}`, borderRadius: 999, padding: "8px 18px", ...t(20, 500, reached ? color.teal : color.fg), whiteSpace: "nowrap" }}>
            {s}
          </div>
        );
      })}
      {piece.center ? <p style={{ ...t(24, 500), position: "absolute", left: 0, right: 0, top: cy - 14, textAlign: "center", opacity: progress(f, 20, 20) }}>{piece.center}</p> : null}
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------- sources hub
function Hub({ piece }: { piece: Extract<DeckPiece, { pattern: "hub" }> }) {
  const f = useCurrentFrame();
  const { w, h } = piece.box;
  const n = piece.sources.length;
  const R = Math.min(w, h) * 0.38;
  const cx = w / 2;
  const cy = h / 2;
  const r = rng(n * 17);
  const node = Math.min(64, R * 0.34);
  return (
    <AbsoluteFill>
      <svg width={w} height={h} style={{ position: "absolute" }}>
        {piece.sources.map((_, i) => {
          const a = -Math.PI / 2 + (i / n) * 2 * Math.PI;
          const p = progress(f, 14 + i * 4, 26, easePath);
          const x = cx + R * Math.cos(a);
          const y = cy + R * Math.sin(a);
          return <line key={i} x1={x} y1={y} x2={x + (cx - x) * p} y2={y + (cy - y) * p} stroke={color.line} strokeWidth={2} />;
        })}
        {piece.sources.flatMap((_, i) =>
          [0, 1, 2].map((k) => {
            const a = -Math.PI / 2 + (i / n) * 2 * Math.PI;
            const period = 40 + Math.floor(r() * 20);
            const phase = ((f - 40 + k * (period / 3) + i * 7) % period) / period;
            if (f < 40) return null;
            const x = cx + R * Math.cos(a) * (1 - phase);
            const y = cy + R * Math.sin(a) * (1 - phase);
            return <circle key={`${i}-${k}`} cx={x} cy={y} r={5} fill={color.teal} opacity={Math.sin(phase * Math.PI)} />;
          })
        )}
      </svg>
      {piece.sources.map((s, i) => {
        const a = -Math.PI / 2 + (i / n) * 2 * Math.PI;
        const p = enter(f, 30, 6 + i * 4);
        return (
          <div key={s} style={{ position: "absolute", left: cx + R * Math.cos(a), top: cy + R * Math.sin(a), width: node, height: node, borderRadius: node * 0.3, background: "#fff", border: `2px solid ${color.line}`, display: "flex", alignItems: "center", justifyContent: "center", transform: `translate(-50%, -50%) scale(${p})` }}>
            <PlatformMark platform={s} size={node * 0.5} />
          </div>
        );
      })}
      <div style={{ position: "absolute", left: cx, top: cy, transform: `translate(-50%, -50%) scale(${enter(f, 30, 30)})`, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, background: "#fff", borderRadius: 999, padding: "18px 30px", boxShadow: `0 0 0 2px ${color.line}` }}>
        <Logo width={Math.min(220, R * 0.9)} />
        {piece.center ? <span style={t(18, 500, color.muted)}>{piece.center}</span> : null}
      </div>
    </AbsoluteFill>
  );
}

function Pattern({ piece }: { piece: DeckPiece }) {
  switch (piece.pattern) {
    case "counter":
      return <Counter piece={piece} />;
    case "stepper":
      return <Stepper piece={piece} />;
    case "cycle":
      return <Cycle piece={piece} />;
    case "hub":
      return <Hub piece={piece} />;
  }
}

/** `rotate` shifts the timeline so the first frame is the complete diagram (for the GIF). */
export function Deck({ piece, rotate }: DeckProps) {
  const total = deckFrames(piece);
  const body = (
    <LoopFade total={total}>
      <Pattern piece={piece} />
    </LoopFade>
  );
  return (
    <AbsoluteFill style={{ background: "#ffffff" }}>
      <Fonts />
      {rotate ? (
        <>
          <Sequence from={-rotate} durationInFrames={total}>
            {body}
          </Sequence>
          <Sequence from={total - rotate} durationInFrames={rotate}>
            {body}
          </Sequence>
        </>
      ) : (
        body
      )}
    </AbsoluteFill>
  );
}

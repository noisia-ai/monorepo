import type { CSSProperties } from "react";
import { useCurrentFrame } from "../engine";
import type { Clip, Quote } from "../schema";
import { Icon, PlatformMark, platformLabel } from "../brand/marks";
import { color, font } from "../brand/theme";
import { progress, enter } from "../brand/util";
import { bare } from "../common/text";

const label: CSSProperties = { display: "flex", alignItems: "center", gap: 12, fontFamily: font, fontSize: 24, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" };

/**
 * The proof: a real post with its platform logo and month (VIDEO.md §2). When it is voiced, its
 * words light up as they are said, mapped by normalised text and never by index (§5.3).
 */
export function ProofCard({ quote, clip, at, outAt, locale, big = false }: { quote: Quote; clip?: Clip; at: number; outAt?: number; locale: string; big?: boolean }) {
  const f = useCurrentFrame();
  const s = enter(f, 30, at - 8, 16);
  const out = outAt ? progress(f, outAt - 4, 14) : 0;
  const words = bare(quote.text).split(" ");
  const spoken = clip ? alignWords(words, clip) : null;
  return (
    <div
      style={{
        opacity: Math.min(1, s * 1.4) * (1 - out),
        transform: `translate(${-out * 160}px, ${(1 - s) * 80}px) rotate(${(1 - s) * -2}deg)`,
        background: "#fff",
        border: `2px solid ${color.line}`,
        borderRadius: 28,
        padding: big ? "44px 48px" : "32px 38px",
        fontFamily: font
      }}
    >
      <div style={{ ...label, color: color.teal, marginBottom: 14 }}>
        <Icon name="quote-message" size={30} stroke={color.teal} width={2} />
        {quote.voiced ? (locale === "en" ? "verified post, voiced" : "post verificado, con voz") : locale === "en" ? "verified post" : "post verificado"}
      </div>
      <div style={{ fontSize: big ? 60 : 44, lineHeight: 1.25, color: color.ink }}>
        “
        {words.map((w, i) => {
          const on = spoken ? f >= spoken[i] - 2 : true;
          return (
            <span key={i} style={{ opacity: on ? 1 : 0.2 }}>
              {w}
              {i < words.length - 1 ? " " : ""}
            </span>
          );
        })}
        ”
      </div>
      {quote.translation ? (
        <div style={{ fontSize: big ? 34 : 29, lineHeight: 1.35, color: color.muted, marginTop: 12, opacity: progress(f, (clip?.at ?? at) + 10, 14) }}>{quote.translation}</div>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 18, fontSize: 26, color: color.muted, fontWeight: 500 }}>
        <PlatformMark platform={quote.platform} size={38} />
        {platformLabel(quote.platform, locale)}
        {quote.meta ? <span>· {quote.meta}</span> : null}
      </div>
    </div>
  );
}

const norm = (w: string) => w.toLowerCase().normalize("NFD").replace(/[^\p{L}\p{N}]/gu, "");

/** Start frame of each written word, matched to the spoken words by normalised text. */
export function alignWords(words: string[], clip: Clip): number[] {
  const spoken = clip.words.map((w) => ({ n: norm(w[0]), at: clip.at + w[1] }));
  let j = 0;
  let last = clip.at;
  return words.map((w) => {
    const n = norm(w);
    for (let k = j; k < Math.min(spoken.length, j + 4); k++) {
      if (spoken[k].n === n) {
        j = k + 1;
        last = spoken[k].at;
        return last;
      }
    }
    return last;
  });
}

/** The Creative Spark: teal soft by default; dark only when it isolates the one line to take away. */
export function SparkCard({ line, sub, style, at, locale }: { line: string; sub?: string; style: "soft" | "dark"; at: number; locale: string }) {
  const f = useCurrentFrame();
  const s = enter(f, 30, at, 14);
  const dark = style === "dark";
  return (
    <div
      style={{
        opacity: s,
        transform: `translateY(${(1 - s) * 120}px) scale(${0.96 + 0.04 * s})`,
        background: dark ? color.ink : color.tealSoft,
        color: dark ? "#fff" : color.ink,
        borderRadius: dark ? 30 : 48,
        padding: dark ? "36px 40px" : "44px 48px",
        overflow: "hidden",
        position: "relative",
        fontFamily: font
      }}
    >
      {dark ? (
        <div style={{ position: "absolute", width: 700, height: 700, borderRadius: "50%", right: -300, top: -380, background: `radial-gradient(circle, rgba(0,238,238,${0.35 * progress(f, at, 30)}), rgba(0,238,238,0) 60%)` }} />
      ) : null}
      <div style={{ ...label, position: "relative", letterSpacing: ".12em", color: dark ? color.cyan : color.teal }}>
        <Icon name="light-bulb" size={30} stroke={dark ? color.cyan : color.teal} width={2} />
        {locale === "en" ? "Creative spark" : "Chispa creativa"}
      </div>
      <div style={{ position: "relative", fontSize: 60, lineHeight: 1.08, fontWeight: 700, marginTop: 16 }}>{line}</div>
      {sub ? (
        <div style={{ position: "relative", fontSize: 31, lineHeight: 1.38, color: dark ? "rgba(255,255,255,.72)" : color.fg, marginTop: 16, opacity: progress(f, at + 14, 16) }}>{sub}</div>
      ) : null}
    </div>
  );
}

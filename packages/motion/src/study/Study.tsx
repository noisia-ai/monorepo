import type { ReactNode } from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "../engine";
import type { Background as Bg, StudyPiece, StudyScene, TimedScene, Timing } from "../schema";
import { Fonts } from "../brand/Fonts";
import { Logo } from "../brand/Logo";
import { PlatformMark } from "../brand/marks";
import { SAFE, VERTICAL, color, font } from "../brand/theme";
import { countUp, enter, formatNumber, progress, rise, rng } from "../brand/util";
import { Background } from "../common/Background";
import { Captions } from "../common/Captions";
import { Chrome } from "../common/Chrome";
import { Mix } from "../common/Mix";
import { Words, bare, text } from "../common/text";
import { Chart } from "../charts/Chart";
import { BigNumber } from "../charts/BigNumber";
import { ProofCard, SparkCard } from "./cards";

/**
 * Format 3 · Study (VIDEO.md §5.3): the door to a study for someone who will not open the deck.
 * Every time comes from the real audio (builders/audio.py writes the timing); nothing is fixed here.
 */
export type StudyProps = { piece: StudyPiece; timing: Timing };

const CARD_TOP = 1010;
const clipOf = (t: TimedScene, kind: "vo" | "quote" | "spark", i = 0) => t.clips.filter((c) => c.kind === kind)[i];

function Fade({ children }: { children: ReactNode }) {
  const f = useCurrentFrame();
  const { durationInFrames: d } = useVideoConfig();
  const o = Math.min(progress(f, 0, 12), 1 - progress(f, d - 10, 10));
  return <AbsoluteFill style={{ opacity: o, transform: `translateY(${(1 - progress(f, 0, 12)) * 36 - progress(f, d - 10, 10) * 36}px)` }}>{children}</AbsoluteFill>;
}

function Top({ children }: { children: ReactNode }) {
  return <div style={{ position: "absolute", left: SAFE.side, right: SAFE.side, top: 226 }}>{children}</div>;
}

function ChapterLabel({ n, total, label }: { n: number; total: number; label: string }) {
  const f = useCurrentFrame();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, fontFamily: font, fontSize: 32, fontWeight: 700, color: color.teal, ...rise(f, 30, 2) }}>
      <span style={{ fontSize: 30, color: "#fff", background: color.teal, borderRadius: 10, padding: "4px 12px" }}>{String(n).padStart(2, "0")}</span>
      <span>{label}</span>
      <span style={{ color: color.upcoming, fontWeight: 500 }}>/ {String(total).padStart(2, "0")}</span>
    </div>
  );
}

function SceneBg({ bg }: { bg?: Bg }) {
  return bg ? <Background bg={bg} /> : null;
}

// ---------------------------------------------------------------- cold open
function Cold({ sc, t, locale }: { sc: Extract<StudyScene, { type: "cold" }>; t: TimedScene; locale: string }) {
  const f = useCurrentFrame();
  const q = clipOf(t, "quote");
  const v = clipOf(t, "vo");
  const wordsAt = t.marks.words_at ?? 60;
  const voAt = v?.at ?? wordsAt + 40;
  const coldOut = progress(f, wordsAt - 6, 14);
  const stormOut = progress(f, voAt + 10, 18);
  // One word per row, each inside the frame: x is random but leaves room for the word's width.
  const r = rng(sc.words.length * 31);
  const rows = sc.words.length;
  const pos = sc.words.map((w, i) => {
    const size = i % 3 === 0 ? 64 : 44;
    const widthPct = ((w.length * size * 0.56) / VERTICAL.width) * 100;
    const room = Math.max(0, 100 - 2 * 7.8 - widthPct);
    return [7.8 + r() * room, 14 + (i / rows) * 66 + r() * 2, (r() - 0.5) * 10, size];
  });
  return (
    <>
      <SceneBg bg={sc.background} />
      <div style={{ position: "absolute", left: SAFE.side, right: SAFE.side, top: 560, opacity: 1 - coldOut }}>
        <ProofCard quote={sc.quote} clip={q} at={q?.at ?? 12} locale={locale} big />
      </div>
      <AbsoluteFill style={{ opacity: 1 - stormOut }}>
        {sc.words.map((w, i) => {
          const s = enter(f, 30, wordsAt + i * 2, 12);
          const [x, y, rot, size] = pos[i];
          return (
            <span key={i} style={{ position: "absolute", left: `${x}%`, top: `${y}%`, transform: `rotate(${rot}deg) scale(${s})`, opacity: s, ...text(size, size > 50 ? 700 : 500, { color: i % 4 === 0 ? color.teal : color.fg, whiteSpace: "nowrap" }) }}>
              {w}
            </span>
          );
        })}
      </AbsoluteFill>
      {f >= voAt ? (
        <Top>
          <div style={{ marginTop: 200 }}>
            <Words value={sc.title} size={96} delay={voAt + 14} />
            <div style={{ marginTop: 60, ...rise(f, 30, voAt + 40) }}>
              <p style={text(150, 500, { color: color.teal, fontVariantNumeric: "tabular-nums", lineHeight: 1 })}>{formatNumber(countUp(f, sc.corpus.value, voAt + 40, 34), sc.corpus.value, locale)}</p>
              <p style={text(44, 400, { color: color.muted, marginTop: 12 })}>{sc.corpus.label}</p>
            </div>
          </div>
        </Top>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- chapter: insight → proof → spark
function Chapter({ sc, t, n, total, locale }: { sc: Extract<StudyScene, { type: "chapter" }>; t: TimedScene; n: number; total: number; locale: string }) {
  const q = clipOf(t, "quote");
  const quoteAt = t.marks.quote_at ?? q?.at ?? 0;
  const sparkAt = t.marks.spark_at ?? 0;
  return (
    <>
      <SceneBg bg={sc.background} />
      <Top>
        <ChapterLabel n={n} total={total} label={sc.label} />
        <div style={{ marginTop: 22 }}>
          <Words value={sc.head} size={sc.head.length > 60 ? 70 : 82} delay={6} />
        </div>
      </Top>
      {sc.chart ? (
        <div style={{ position: "absolute", left: SAFE.side, right: SAFE.side, top: 560 }}>
          <Chart chart={sc.chart} locale={locale} delay={t.marks.chart_at ?? 20} />
        </div>
      ) : null}
      <div style={{ position: "absolute", left: SAFE.side, right: SAFE.side, top: CARD_TOP }}>
        {sc.quote ? <ProofCard quote={sc.quote} clip={q} at={quoteAt} outAt={sparkAt} locale={locale} /> : null}
      </div>
      <div style={{ position: "absolute", left: SAFE.side, right: SAFE.side, top: CARD_TOP }}>
        <SparkCard line={sc.spark.line} sub={sc.spark.sub} style={sc.spark.style} at={sparkAt} locale={locale} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- climax: the white space
function Climax({ sc, t, n, total, locale }: { sc: Extract<StudyScene, { type: "climax" }>; t: TimedScene; n: number; total: number; locale: string }) {
  const f = useCurrentFrame();
  const zeroAt = t.marks.zero_at ?? 60;
  const chatAt = t.marks.chat_at ?? zeroAt + 60;
  const sparkAt = t.marks.spark_at ?? chatAt + 100;
  const countOut = progress(f, chatAt - 10, 14);
  const chatOut = progress(f, sparkAt - 4, 14);
  return (
    <>
      <SceneBg bg={sc.background} />
      <Top>
        <ChapterLabel n={n} total={total} label={sc.label} />
        <div style={{ marginTop: 22 }}>
          <Words value={sc.head} size={76} delay={6} />
        </div>
      </Top>
      <div style={{ position: "absolute", left: SAFE.side, right: SAFE.side, top: 640, opacity: 1 - countOut }}>
        <BigNumber value={0} from={sc.count.from} label={sc.count.label} locale={locale} delay={Math.max(8, zeroAt - 34)} tone={color.coral} />
      </div>
      <div style={{ position: "absolute", left: SAFE.side, right: SAFE.side, top: 560, display: "flex", flexDirection: "column", gap: 22, opacity: 1 - chatOut }}>
        {sc.chat.map((p, i) => {
          const s = enter(f, 30, chatAt + i * 16, 13);
          const mine = i % 2 === 1;
          return (
            <div key={i} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%", opacity: s, transform: `translateY(${(1 - s) * 40}px) scale(${0.9 + 0.1 * s})` }}>
              <div style={{ background: mine ? color.tealSoft : color.bubble, borderRadius: 34, padding: "22px 28px", ...text(36, 400, { lineHeight: 1.25 }) }}>{bare(p.text)}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, justifyContent: mine ? "flex-end" : "flex-start", ...text(22, 500, { color: color.muted }) }}>
                <PlatformMark platform={p.platform} size={26} />
                {p.meta}
              </div>
            </div>
          );
        })}
        {f >= chatAt + sc.chat.length * 16 ? (
          <div style={{ alignSelf: "flex-start", border: `3px dashed ${color.coral}`, borderRadius: 34, padding: "22px 28px", ...text(36, 500, { color: color.coral }), opacity: enter(f, 30, chatAt + sc.chat.length * 16, 13) }}>
            {sc.empty} {".".repeat(1 + (Math.floor(f / 8) % 3))}
          </div>
        ) : null}
        <div style={{ ...text(24, 500, { color: color.muted }), marginTop: 6 }}>{locale === "en" ? "real posts, as a group chat" : "posts reales, como chat de grupo"}</div>
      </div>
      <div style={{ position: "absolute", left: SAFE.side, right: SAFE.side, top: CARD_TOP }}>
        <SparkCard line={sc.spark.line} sub={sc.spark.sub} style={sc.spark.style} at={sparkAt} locale={locale} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- close
function Close({ sc, t, locale }: { sc: Extract<StudyScene, { type: "close" }>; t: TimedScene; locale: string }) {
  const f = useCurrentFrame();
  const v = clipOf(t, "vo");
  const logoAt = t.marks.logo_at ?? 200;
  const lines = progress(f, logoAt - 10, 14);
  const step = v ? Math.max(18, Math.floor(v.len / (sc.bet.length + 1))) : 30;
  return (
    <>
      <SceneBg bg={sc.background} />
      <div style={{ position: "absolute", left: SAFE.side, right: SAFE.side, top: 420, display: "flex", flexDirection: "column", gap: 34, opacity: 1 - lines }}>
        <p style={text(32, 700, { color: color.teal, letterSpacing: ".08em", textTransform: "uppercase", ...rise(f, 30, 4) })}>{locale === "en" ? "The bet" : "La apuesta"}</p>
        {sc.bet.map((b, i) => (
          <p key={i} style={text(i === 0 ? 84 : 66, 500, { lineHeight: 1.1, ...rise(f, 30, (v?.at ?? 8) + i * step) })}>
            {b}
          </p>
        ))}
      </div>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 36, opacity: enter(f, 30, logoAt, 20) }}>
        <Logo width={600} style={{ transform: `scale(${0.92 + 0.08 * enter(f, 30, logoAt, 20)})` }} />
        <span style={{ fontFamily: font, fontSize: 40, color: color.muted }}>{locale === "en" ? "Social intelligence" : "Inteligencia social"}</span>
      </AbsoluteFill>
    </>
  );
}

export function Study({ piece, timing }: StudyProps) {
  const chapters = piece.scenes.filter((s) => s.type === "chapter" || s.type === "climax").map((s) => s.id);
  const quiet: [number, number][] = [];
  piece.scenes.forEach((sc, i) => {
    const t = timing.scenes[i];
    if (sc.type === "climax" && t.marks.zero_at != null) quiet.push([t.from + t.marks.zero_at, t.from + (t.marks.spark_at ?? t.len)]);
  });
  return (
    <AbsoluteFill style={{ width: VERTICAL.width, height: VERTICAL.height, background: color.canvas }}>
      <Fonts />
      <Background bg={piece.background} />
      {piece.scenes.map((sc, i) => {
        const t = timing.scenes[i];
        const n = chapters.indexOf(sc.id) + 1;
        return (
          <Sequence key={sc.id} from={t.from} durationInFrames={t.len}>
            <Fade>
              {sc.type === "cold" ? <Cold sc={sc} t={t} locale={piece.locale} /> : null}
              {sc.type === "chapter" ? <Chapter sc={sc} t={t} n={n} total={chapters.length} locale={piece.locale} /> : null}
              {sc.type === "climax" ? <Climax sc={sc} t={t} n={n} total={chapters.length} locale={piece.locale} /> : null}
              {sc.type === "close" ? <Close sc={sc} t={t} locale={piece.locale} /> : null}
            </Fade>
            <Captions clips={t.clips} />
          </Sequence>
        );
      })}
      <Chrome lengths={timing.scenes.map((t) => t.len)} tag={piece.tag} />
      <Mix timing={timing} quiet={quiet} />
    </AbsoluteFill>
  );
}

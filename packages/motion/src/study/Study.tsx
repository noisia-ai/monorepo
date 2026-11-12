import type { ReactNode } from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "../engine";
import type { Background as Bg, Base, StudyPiece, StudyScene, TimedScene, Timing } from "../schema";
import { BaseCard, DataNote, mentionsLabel } from "../common/Base";
import { Fonts } from "../brand/Fonts";
import { Logo } from "../brand/Logo";
import { PlatformMark, platformLabel } from "../brand/marks";
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
import { LayoutGuard } from "../common/LayoutGuard";

/**
 * Format 3 · Study (VIDEO.md §5.3): the door to a study for someone who will not open the deck.
 * Every time comes from the real audio (builders/audio.py writes the timing); nothing is fixed here.
 */
export type StudyProps = { piece: StudyPiece; timing: Timing; qa?: boolean };

// The proof and Spark cards sit under the chart in the same column (flow, not a fixed y): they start
// at CARD_TOP at the earliest and further down when the chart and its note need the room. Whatever
// still does not fit, the layout guard catches in --qa (VIDEO.md §7).
const BODY_TOP = 560;
const CARD_TOP = 1010;
const CARD_GAP = 40;
const clipOf = (t: TimedScene, kind: "vo" | "quote" | "spark", i = 0) => t.clips.filter((c) => c.kind === kind)[i];

function Fade({ children }: { children: ReactNode }) {
  const f = useCurrentFrame();
  const { durationInFrames: d } = useVideoConfig();
  const o = Math.min(progress(f, 0, 12), 1 - progress(f, d - 10, 10));
  return <AbsoluteFill style={{ opacity: o, transform: `translateY(${(1 - progress(f, 0, 12)) * 36 - progress(f, d - 10, 10) * 36}px)` }}>{children}</AbsoluteFill>;
}

function Top({ children, qa }: { children: ReactNode; qa?: string }) {
  return (
    <div data-qa={qa} style={{ position: "absolute", left: SAFE.side, right: SAFE.side, top: 226 }}>
      {children}
    </div>
  );
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
function Cold({ sc, t, locale, base }: { sc: Extract<StudyScene, { type: "cold" }>; t: TimedScene; locale: string; base: Base }) {
  const f = useCurrentFrame();
  const q = clipOf(t, "quote");
  const v = clipOf(t, "vo");
  // Thesis first: title with the base (under the narrator) → word storm → the quote.
  const voAt = v?.at ?? 12;
  const wordsAt = t.marks.words_at ?? voAt + 120;
  const quoteAt = q?.at ?? t.marks.quote_at ?? wordsAt + 60;
  const titleOut = progress(f, wordsAt - 14, 12);
  const stormIn = f >= wordsAt;
  // Each phase is fully out before the next one comes in: never two phases on screen at once.
  const stormOut = progress(f, quoteAt - 16, 12);
  const quoteOn = f >= quoteAt;
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
      {quoteOn ? (
        <div data-qa={`${sc.id}.quote`} style={{ position: "absolute", left: SAFE.side, right: SAFE.side, top: BODY_TOP }}>
          <ProofCard quote={sc.quote} clip={q} at={quoteAt} locale={locale} big />
        </div>
      ) : null}
      <AbsoluteFill style={{ opacity: stormIn ? 1 - stormOut : 0 }}>
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
      {f >= voAt && titleOut < 1 ? (
        <Top qa={`${sc.id}.title`}>
          <div style={{ marginTop: 200, opacity: 1 - titleOut }}>
            <Words value={sc.title} size={96} delay={voAt} />
            <div style={{ marginTop: 60, ...rise(f, 30, voAt + 24) }}>
              {/* The corpus is the piece's base: the same number the base scene breaks down. */}
              <p style={text(150, 500, { color: color.teal, fontVariantNumeric: "tabular-nums", lineHeight: 1 })}>{mentionsLabel(Math.round(countUp(f, base.mentions, voAt + 24, 34)), locale, base.plus)}</p>
              <p style={text(44, 400, { color: color.muted, marginTop: 12 })}>
                {locale === "en" ? "mentions" : "menciones"} · {base.period}
              </p>
              <div style={{ display: "flex", gap: 14, marginTop: 20, ...rise(f, 30, voAt + 36) }}>
                {base.channels.map((c) => (
                  <PlatformMark key={c.platform} platform={c.platform} size={44} />
                ))}
              </div>
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
      <Top qa={`${sc.id}.head`}>
        <ChapterLabel n={n} total={total} label={sc.label} />
        <div style={{ marginTop: 22 }}>
          <Words value={sc.head} size={sc.head.length > 60 ? 70 : 82} delay={6} />
        </div>
      </Top>
      <div style={{ position: "absolute", left: SAFE.side, right: SAFE.side, top: BODY_TOP, display: "flex", flexDirection: "column" }}>
        <div style={{ minHeight: CARD_TOP - BODY_TOP - CARD_GAP }}>
          {sc.chart ? (
            <div data-qa={`${sc.id}.chart`}>
              <Chart chart={sc.chart} locale={locale} delay={t.marks.chart_at ?? 20} />
            </div>
          ) : null}
          {sc.chart && sc.note ? (
            <div data-qa={`${sc.id}.note`} style={{ marginTop: 26 }}>
              <DataNote note={sc.note} locale={locale} delay={(t.marks.chart_at ?? 20) + 26} />
            </div>
          ) : null}
        </div>
        {/* Quote and Spark share one cell: the quote leaves before the Spark lands (phases in a row). */}
        <div style={{ display: "grid", marginTop: CARD_GAP }}>
          {sc.quote ? (
            <div data-qa={`${sc.id}.quote`} style={{ gridArea: "1 / 1" }}>
              <ProofCard quote={sc.quote} clip={q} at={quoteAt} outAt={sparkAt - 10} locale={locale} />
            </div>
          ) : null}
          <div data-qa={`${sc.id}.spark`} style={{ gridArea: "1 / 1", alignSelf: "start" }}>
            <SparkCard line={sc.spark.line} sub={sc.spark.sub} style={sc.spark.style} at={sparkAt} locale={locale} />
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- base by channels
// The corpus was said in the cold open. This closes on channels: the share of every channel (bars) and
// what is said in the ones the narrator names (cards). Each card lands when the voice says its channel.
function ChannelStory({ sc, t, base, locale }: { sc: Extract<StudyScene, { type: "base" }>; t: TimedScene; base: Base; locale: string }) {
  const f = useCurrentFrame();
  const v = clipOf(t, "vo");
  const said = (re: RegExp, fallback: number) => {
    const w = v?.words.find(([word]) => re.test(word));
    return w && v ? v.at + w[1] : fallback;
  };
  const ranked = [...base.channels].sort((a, b) => (b.mentions ?? 0) - (a.mentions ?? 0));
  const sum = ranked.reduce((a, c) => a + (c.mentions ?? 0), 0) || 1;
  const max = Math.max(1, ...ranked.map((c) => c.mentions ?? 0));
  const topics = sc.channelTopics ?? [];
  const cardAt = topics.map((c, i) => said(new RegExp(`^${platformLabel(c.platform, locale)}\\b`, "i"), 40 + i * 90));
  const footAt = Math.max(60, ...cardAt) + 40;
  const pct = (n: number) => {
    const p = (n / sum) * 100;
    return p < 1 ? "<1%" : `${Math.round(p)}%`;
  };
  return (
    <>
      <SceneBg bg={sc.background} />
      <Top qa={`${sc.id}.channels`}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, ...text(30, 700, { color: color.teal, letterSpacing: ".08em", textTransform: "uppercase" }), ...rise(f, 30, 2) }}>
          {locale === "en" ? "Where it is discussed" : "Dónde se habla"}
        </div>
        <div style={{ marginTop: 22 }}>
          <Words value={sc.head ?? ""} size={82} delay={6} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 44 }}>
          {ranked.map((c, i) => {
            const p = enter(f, 30, 16 + i * 5, 20);
            const named = topics.findIndex((tc) => tc.platform === c.platform);
            const lit = i === 0 || (named >= 0 && f >= cardAt[named]);
            return (
              <div key={c.platform} style={{ display: "grid", gridTemplateColumns: "48px 210px 1fr 100px", alignItems: "center", gap: 16, height: 54, opacity: Math.min(1, p * 1.4) }}>
                <PlatformMark platform={c.platform} size={42} />
                <span style={text(36, lit ? 500 : 400, { color: lit ? color.ink : color.fg })}>{platformLabel(c.platform, locale)}</span>
                <div style={{ height: 22, borderRadius: 11, background: color.track, overflow: "hidden" }}>
                  <div style={{ width: `${((c.mentions ?? 0) / max) * 100 * p}%`, height: "100%", borderRadius: 11, background: lit ? color.teal : color.faint }} />
                </div>
                <span style={text(36, 500, { textAlign: "right", color: lit ? color.teal : color.muted, fontVariantNumeric: "tabular-nums" })}>{pct(c.mentions ?? 0)}</span>
              </div>
            );
          })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, topics.length)}, 1fr)`, gap: 20, marginTop: 36 }}>
          {topics.map((tc, i) => (
            <div key={tc.platform} style={{ background: "#fff", border: `2px solid ${color.line}`, borderRadius: 28, padding: "24px 28px 28px", ...rise(f, 30, cardAt[i]) }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, ...text(34, 700, { color: color.ink }) }}>
                <PlatformMark platform={tc.platform} size={38} />
                {locale === "en" ? "On " : "En "}
                {platformLabel(tc.platform, locale)}
              </div>
              {tc.items.map((it) => (
                <div key={it.label} style={{ marginTop: 16 }}>
                  <div style={text(52, 500, { color: color.teal, lineHeight: 1, fontVariantNumeric: "tabular-nums" })}>{Math.round(it.value)}%</div>
                  <div style={text(30, 400, { color: color.fg, lineHeight: 1.2, marginTop: 4 })}>{it.label}</div>
                  {it.vs ? <div style={text(26, 400, { color: color.muted, lineHeight: 1.2, marginTop: 4 })}>{it.vs}</div> : null}
                </div>
              ))}
            </div>
          ))}
        </div>
        <p style={text(26, 400, { color: color.muted, marginTop: 24, lineHeight: 1.35, ...rise(f, 30, footAt) })}>
          {mentionsLabel(base.mentions, locale, base.plus)} {locale === "en" ? "mentions analyzed" : "menciones analizadas"} · {[base.period, base.market, base.method].filter(Boolean).join(" · ")}
        </p>
      </Top>
    </>
  );
}

// ---------------------------------------------------------------- climax: the white space
function Climax({ sc, t, n, total, locale }: { sc: Extract<StudyScene, { type: "climax" }>; t: TimedScene; n: number; total: number; locale: string }) {
  const f = useCurrentFrame();
  const zeroAt = t.marks.zero_at ?? 60;
  const chatAt = t.marks.chat_at ?? zeroAt + 60;
  const sparkAt = t.marks.spark_at ?? chatAt + 100;
  // Phases in a row: the count leaves before the chat, the chat before the Spark.
  const countOut = progress(f, chatAt - 16, 12);
  const chatOut = progress(f, sparkAt - 8, 8);   // the chat stays to the last moment: the empty bubble is the climax
  return (
    <>
      <SceneBg bg={sc.background} />
      <Top qa={`${sc.id}.head`}>
        <ChapterLabel n={n} total={total} label={sc.label} />
        <div style={{ marginTop: 22 }}>
          <Words value={sc.head} size={76} delay={6} />
        </div>
      </Top>
      <div data-qa={`${sc.id}.count`} style={{ position: "absolute", left: SAFE.side, right: SAFE.side, top: 640, opacity: 1 - countOut }}>
        <BigNumber value={0} from={sc.count.from} label={sc.count.label} locale={locale} delay={Math.max(8, zeroAt - 34)} tone={color.coral} />
        {sc.note ? (
          <div style={{ marginTop: 26 }}>
            <DataNote note={sc.note} locale={locale} delay={zeroAt} />
          </div>
        ) : null}
      </div>
      <div data-qa={`${sc.id}.chat`} style={{ position: "absolute", left: SAFE.side, right: SAFE.side, top: BODY_TOP, display: "flex", flexDirection: "column", gap: 22, opacity: 1 - chatOut }}>
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
        {/* Tied to the chat: it used to show from frame 0, on top of the count's note. */}
        <div style={{ ...text(24, 500, { color: color.muted }), marginTop: 6, opacity: enter(f, 30, chatAt + sc.chat.length * 16, 13) }}>{locale === "en" ? "real posts, as a group chat" : "posts reales, como chat de grupo"}</div>
      </div>
      <div data-qa={`${sc.id}.spark`} style={{ position: "absolute", left: SAFE.side, right: SAFE.side, top: CARD_TOP }}>
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
      <div data-qa={`${sc.id}.bet`} style={{ position: "absolute", left: SAFE.side, right: SAFE.side, top: 420, display: "flex", flexDirection: "column", gap: 34, opacity: 1 - lines }}>
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

export function Study({ piece, timing, qa = false }: StudyProps) {
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
      <LayoutGuard on={qa} width={VERTICAL.width} height={VERTICAL.height}>
      {piece.scenes.map((sc, i) => {
        const t = timing.scenes[i];
        const n = chapters.indexOf(sc.id) + 1;
        return (
          <Sequence key={sc.id} from={t.from} durationInFrames={t.len}>
            <Fade>
              {sc.type === "cold" ? <Cold sc={sc} t={t} locale={piece.locale} base={piece.base} /> : null}
              {sc.type === "base" && sc.channelTopics ? <ChannelStory sc={sc} t={t} base={piece.base} locale={piece.locale} /> : null}
              {sc.type === "base" && !sc.channelTopics ? (
                <>
                  <SceneBg bg={sc.background} />
                  <div style={{ position: "absolute", left: SAFE.side, right: SAFE.side, top: 300 }}>
                    <BaseCard base={piece.base} locale={piece.locale} />
                  </div>
                </>
              ) : null}
              {sc.type === "chapter" ? <Chapter sc={sc} t={t} n={n} total={chapters.length} locale={piece.locale} /> : null}
              {sc.type === "climax" ? <Climax sc={sc} t={t} n={n} total={chapters.length} locale={piece.locale} /> : null}
              {sc.type === "close" ? <Close sc={sc} t={t} locale={piece.locale} /> : null}
            </Fade>
            <Captions clips={t.clips} />
          </Sequence>
        );
      })}
      </LayoutGuard>
      <Chrome lengths={timing.scenes.map((t) => t.len)} tag={piece.tag} />
      <Mix timing={timing} quiet={quiet} />
    </AbsoluteFill>
  );
}

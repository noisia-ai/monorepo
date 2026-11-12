import { useCurrentFrame, useVideoConfig } from "../engine";
import type { Base, Note } from "../schema";
import { Icon, PlatformMark, platformLabel } from "../brand/marks";
import { color } from "../brand/theme";
import { countUp, enter, formatNumber, rise } from "../brand/util";
import { text } from "./text";

/**
 * Every figure says what it stands on (VIDEO.md §2): the mentions, the period and, when known, the
 * channels. `DataNote` goes under each figure; `BaseCard` is the scene with the corpus and where it
 * was said most.
 */
export function mentionsLabel(n: number, locale: string, plus = false): string {
  const en = locale.startsWith("en");
  const v =
    n >= 1_000_000
      ? `${new Intl.NumberFormat(en ? "en-US" : "es-MX", { maximumFractionDigits: 2 }).format(n / 1_000_000)} M`
      : formatNumber(n, n, locale);
  return `${plus ? "+" : ""}${v}`;
}

export function DataNote({ note, locale, delay = 30, size = 40 }: { note: Note; locale: string; delay?: number; size?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const en = locale.startsWith("en");
  // An official figure carries its source instead of mentions.
  const words =
    note.mentions != null ? `${mentionsLabel(note.mentions, locale)} ${en ? "mentions" : "menciones"}${note.what ? ` ${note.what}` : ""}` : (note.source ?? "");
  return (
    // Two lines on purpose: what the figure stands on, then when and where. Wrapping by accident left
    // the icon alone on a line.
    <div style={{ display: "grid", gridTemplateColumns: `${size}px 1fr`, columnGap: 14, rowGap: 0, alignItems: "center", ...text(size, 400, { color: color.muted, lineHeight: 1.25 }), ...rise(frame, fps, delay, 20) }}>
      <Icon name="database" size={size} stroke={color.muted} width={1.7} />
      <span style={{ color: color.fg, fontWeight: 500 }}>{words}</span>
      <span />
      <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        {note.period}
        {note.mentions != null && note.source ? <span>· {note.source}</span> : null}
        {note.channels?.length ? (
          <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
            ·{" "}
            {note.channels.map((c) => (
              <PlatformMark key={c} platform={c} size={size} />
            ))}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export type BaseView = Omit<Base, "mentions" | "plus"> & { mentions?: number; plus?: boolean };

export function BaseCard({ base, locale, delay = 4 }: { base: BaseView; locale: string; delay?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const en = locale.startsWith("en");
  const counted = base.channels.every((c) => c.mentions != null);
  const ranked = counted ? [...base.channels].sort((a, b) => (b.mentions ?? 0) - (a.mentions ?? 0)) : base.channels;
  const max = Math.max(1, ...ranked.map((c) => c.mentions ?? 0));
  // The share is over the channels' own sum, so it adds up to 100 even when the total counts more
  // (duplicates, sources without a channel).
  const sum = ranked.reduce((a, c) => a + (c.mentions ?? 0), 0) || 1;
  const many = ranked.length > 6;
  const shown = countUp(frame, base.mentions ?? 0, delay + 4, 30);
  const meta = [base.period, base.market, base.method].filter(Boolean).join(" · ");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, ...text(32, 700, { color: color.teal, letterSpacing: ".08em", textTransform: "uppercase" }), ...rise(frame, fps, delay) }}>
        <Icon name="database" size={36} stroke={color.teal} width={2} />
        {en ? "The base" : "La base"}
      </div>
      <div style={rise(frame, fps, delay + 2, 30)}>
        {base.mentions != null ? (
          <>
            <p style={text(170, 500, { color: color.teal, lineHeight: 0.95, fontVariantNumeric: "tabular-nums" })}>{mentionsLabel(Math.round(shown), locale, base.plus)}</p>
            <p style={text(54, 500, { marginTop: 10 })}>{en ? "mentions analyzed" : "menciones analizadas"}</p>
          </>
        ) : null}
        <p style={text(base.mentions != null ? 40 : 64, base.mentions != null ? 400 : 500, { color: base.mentions != null ? color.muted : color.ink, marginTop: 10 })}>{meta}</p>
      </div>
      <p style={text(40, 500, { color: color.fg, marginTop: 16, ...rise(frame, fps, delay + 16) })}>
        {counted ? (en ? "Where it was said most" : "Dónde se habló más") : en ? `${ranked.length} channels` : `${ranked.length} canales`}
      </p>
      {counted ? (
        <div style={{ display: "flex", flexDirection: "column", gap: many ? 12 : 22 }}>
          {ranked.map((c, i) => {
            const p = enter(frame, fps, delay + 20 + i * 6, 22);
            const raw = ((c.mentions ?? 0) / sum) * 100;
            const share = raw > 0 && raw < 1 ? "<1%" : `${Math.round(raw)}%`;
            return (
              <div key={c.platform} style={{ display: "grid", gridTemplateColumns: "56px 230px 1fr 130px", alignItems: "center", gap: 18, height: many ? 50 : undefined, opacity: Math.min(1, p * 1.4) }}>
                <PlatformMark platform={c.platform} size={many ? 42 : 48} />
                <span style={text(40, i === 0 ? 500 : 400, { color: i === 0 ? color.ink : color.fg })}>{platformLabel(c.platform, locale)}</span>
                <div style={{ height: 26, borderRadius: 13, background: color.track, overflow: "hidden" }}>
                  <div style={{ width: `${((c.mentions ?? 0) / max) * 100 * p}%`, height: "100%", borderRadius: 13, background: i === 0 ? color.teal : color.faint }} />
                </div>
                <span style={text(40, 500, { textAlign: "right", color: i === 0 ? color.teal : color.muted, fontVariantNumeric: "tabular-nums" })}>{share}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
          {ranked.map((c, i) => (
            <span key={c.platform} style={{ display: "inline-flex", alignItems: "center", gap: 12, padding: "12px 22px", borderRadius: 999, border: `2px solid ${color.line}`, background: "#fff", ...text(40, 500, { color: color.fg }), transform: `scale(${enter(frame, fps, delay + 20 + i * 4)})` }}>
              <PlatformMark platform={c.platform} size={40} />
              {platformLabel(c.platform, locale)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

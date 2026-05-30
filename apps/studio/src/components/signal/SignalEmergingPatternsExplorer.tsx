"use client";

import { useMemo } from "react";

import { Icon } from "@/components/ui/Icon";
import type { EmergingPattern, FutureSignal, MarketAnalysis } from "@/lib/signal/contracts";

type SignalEmergingPatternsExplorerProps = {
  corpusId: string;
  futureSignals: FutureSignal[];
  marketAnalysis: MarketAnalysis | null;
  patterns: EmergingPattern[];
};

export function SignalEmergingPatternsExplorer({
  corpusId,
  futureSignals,
  marketAnalysis,
  patterns,
}: SignalEmergingPatternsExplorerProps) {
  const visiblePatterns = useMemo(() => dedupeEmergingPatterns(patterns), [patterns]);

  return (
    <div className="emerging-pattern-shell emerging-pattern-shell--editorial">
      {marketAnalysis ? (
        <section className="market-analysis-panel market-analysis-panel--formatted">
          <p className="signal-eyebrow">Market analysis</p>
          <h3>{marketAnalysis.headline}</h3>
          <p>{marketAnalysis.answer}</p>
          {marketAnalysis.implications.length > 0 ? (
            <div className="market-analysis-implications">
              {marketAnalysis.implications.map((item) => (
                <article key={item}>
                  <Icon name="sparkle" size={14} />
                  <span>{item}</span>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {futureSignals.length > 0 ? (
        <section className="future-signals-panel future-signals-panel--cards">
          <header>
            <p className="signal-eyebrow">Forecast</p>
            <h3>Future triggers / barriers</h3>
          </header>
          <div>
            {futureSignals.map((signal) => (
              <article key={signal.signal_id}>
                <span>{futureSignalLabel(signal.polarity)} · {horizonLabel(signal.horizon)}</span>
                <strong>{signal.title}</strong>
                <p>{signal.why_it_could_emerge}</p>
                <small>{signal.watch_metric}</small>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {visiblePatterns.length > 0 ? (
        <section className="unexpected-insights-header">
          <p className="signal-eyebrow">Unexpected insights</p>
          <h3>Signals worth inspecting outside T&B</h3>
          <p>
            These are corpus patterns that do not need to become a trigger or barrier to matter.
            Open one to inspect the related corpus mentions.
          </p>
        </section>
      ) : null}

      <div className="emerging-pattern-grid emerging-pattern-grid--three">
        {visiblePatterns.map((pattern) => (
          <a
            className="emerging-pattern-card"
            href={patternCorpusHref(corpusId, pattern)}
            key={pattern.pattern_id}
          >
            <header>
              <span>{pattern.pattern_id}</span>
              <strong>{friendlyPatternType(pattern.pattern_type)}</strong>
            </header>
            <h3>{pattern.title}</h3>
            <p>{truncate(pattern.why_it_matters, 210)}</p>
            <dl>
              <div><dt>Evidence</dt><dd>{formatCompact(pattern.evidence_count)}</dd></div>
              <div><dt>Confidence</dt><dd>{confidenceLabel(pattern.confidence)}</dd></div>
            </dl>
            {pattern.source_breakdown.length > 0 ? (
              <div className="emerging-pattern-sources">
                {pattern.source_breakdown.slice(0, 3).map((source) => (
                  <span key={source.source}>{source.source} · {formatCompact(source.count)}</span>
                ))}
              </div>
            ) : null}
          </a>
        ))}
      </div>
    </div>
  );
}

function dedupeEmergingPatterns(patterns: EmergingPattern[]) {
  const byTitle = new Map<string, EmergingPattern>();
  for (const pattern of patterns) {
    const key = pattern.title.toLowerCase().trim();
    const existing = byTitle.get(key);
    if (!existing || pattern.evidence_count > existing.evidence_count) byTitle.set(key, pattern);
  }
  return Array.from(byTitle.values()).sort((a, b) => b.evidence_count - a.evidence_count);
}

function futureSignalLabel(value: FutureSignal["polarity"]) {
  return value === "future_trigger" ? "Future trigger" : "Future barrier";
}

function horizonLabel(value: FutureSignal["horizon"]) {
  if (value === "30_90_days") return "30-90 days";
  if (value === "3_6_months") return "3-6 months";
  return "6-12 months";
}

function friendlyPatternType(value: EmergingPattern["pattern_type"]) {
  const labels: Record<EmergingPattern["pattern_type"], string> = {
    source_pattern: "Source pattern",
    unexpected_insight: "Unexpected insight",
    language_code: "Language code",
    cx_signal: "CX signal",
    product_signal: "Product signal",
    content_signal: "Content signal",
    hypothesis: "Hypothesis"
  };
  return labels[value];
}

function confidenceLabel(value: string) {
  if (value === "alta") return "High";
  if (value === "media") return "Medium";
  if (value === "baja_direccional") return "Directional";
  return value.replace(/_/g, " ");
}

function patternCorpusHref(corpusId: string, pattern: EmergingPattern) {
  const params = new URLSearchParams();
  params.set("search", pattern.title);
  const topSource = pattern.source_breakdown[0]?.source;
  if (topSource) params.set("source", topSource);
  return `/studio/corpora/${corpusId}/mentions?${params.toString()}`;
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function truncate(text: string, max: number) {
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, "")}...`;
}

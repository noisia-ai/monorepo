"use client";

import { CaretRight } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { SignalMetricHelp, type SignalMetricHelpContent } from "./SignalMetricHelp";

/** Shared presentation for governed and workspace-native Topics. Callers own
 * the metric labels and denominators; this layer does not infer missing data. */
export function SignalTopicsKpi({ help, label, secondary, tone, value }: {
  help: SignalMetricHelpContent; label: string; secondary: string;
  tone?: "positive" | "warning"; value: number | string;
}) {
  return <article className={tone ? `signal-v2-tn__kpi signal-v2-tn__kpi--${tone}` : "signal-v2-tn__kpi"}>
    <SignalMetricHelp content={help} label={label} />
    <strong>{value}</strong><small title={secondary}>{secondary}</small>
  </article>;
}

export function SignalTopicsRankingCard<View extends string>({
  activeView,
  children,
  eyebrow,
  onViewChange,
  title,
  viewLabel,
  views
}: {
  activeView: View;
  children?: ReactNode;
  eyebrow: ReactNode;
  onViewChange: (view: View) => void;
  title: ReactNode;
  viewLabel: string;
  views: ReadonlyArray<{ key: View; label: string }>;
}) {
  return <section className="signal-v2-card signal-v2-tn__ranking">
    <header className="signal-v2-card__heading">
      <div><small>{eyebrow}</small><h2>{title}</h2></div>
      <div className="signal-v2-tn__view-switch" role="group" aria-label={viewLabel}>
        {views.map((view) => <button type="button" key={view.key} aria-pressed={view.key === activeView}
          onClick={() => onViewChange(view.key)}>{view.label}</button>)}
      </div>
    </header>
    {children}
  </section>;
}

export function SignalTopicSentimentLegend({ counts, labels }: {
  counts: { negative: ReactNode; neutral: ReactNode; positive: ReactNode };
  labels: { negative: string; neutral: string; positive: string };
}) {
  return <div className="signal-v2-tn__sentiment-legend">
    {(["positive", "neutral", "negative"] as const).map((key) => <div key={key}>
      <i aria-hidden className={`is-${key}`} /><span>{labels[key]}</span><strong>{counts[key]}</strong>
    </div>)}
  </div>;
}

export function SignalTopicsRankingList({ entries, labels, selectedKey, onSelect }: {
  entries: Array<{ key: string; label: string; count: number; formattedCount: string; share: string; change?: ReactNode }>;
  labels: { term: string; count: string; share: string; change?: string };
  selectedKey: string | null; onSelect: (key: string) => void;
}) {
  const maximum = Math.max(1, ...entries.map(entry => entry.count));
  return <div className={`signal-v2-tn__ranking-metrics${labels.change === undefined ? " signal-v2-tn__ranking-metrics--native" : ""}`}>
    <div className="signal-v2-tn__rank-head">
      <span>{labels.term}</span><span>{labels.count}</span><span>{labels.share}</span>
      {labels.change === undefined ? null : <span>{labels.change}</span>}
    </div>
    <div className="signal-v2-tn__rank-list">{entries.map(entry => <button
      aria-pressed={entry.key === selectedKey} key={entry.key} onClick={() => onSelect(entry.key)} type="button">
      <span className="signal-v2-tn__term"><strong title={entry.label}>{entry.label}</strong>
        <i aria-hidden><b style={{ width: `${entry.count / maximum * 100}%` }} /></i></span>
      <b>{entry.formattedCount}</b><span>{entry.share}</span>
      {labels.change === undefined ? null : entry.change}
      <CaretRight size={14} />
    </button>)}</div>
  </div>;
}

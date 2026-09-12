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

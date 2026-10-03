export type HistoryRow = {
  canonical_signal_id: string;
  canonical_title: string;
  signal_type: string;
  signal_status: string;
  first_seen_at: string | null;
  last_seen_at: string | null;
  observation_id: string;
  window_start: string | null;
  window_end: string | null;
  frequency: number;
  intensity: string | null;
  sentiment: string | null;
  composite_score: string | null;
  confidence: string | null;
  rank: number | null;
  delta_vs_previous: string | null;
  evidence_count: number;
  evidence_quote: string | null;
};

export type HistoryTrendStatus = "emerging" | "rising" | "active" | "fading" | "dormant" | "recurring";

export function groupHistorySignals(rows: HistoryRow[]) {
  const map = new Map<string, {
    id: string;
    title: string;
    signal_type: string;
    status: string;
    trend_status: HistoryTrendStatus;
    first_seen_at: string | null;
    last_seen_at: string | null;
    observations: Array<{
      id: string;
      window_start: string | null;
      window_end: string | null;
      frequency: number;
      intensity: number | null;
      sentiment: number | null;
      composite_score: number | null;
      confidence: string | null;
      rank: number | null;
      delta_vs_previous: number | null;
      evidence_count: number;
      evidence_quote: string | null;
    }>;
  }>();

  for (const row of rows) {
    const signal = map.get(row.canonical_signal_id) ?? {
      id: row.canonical_signal_id,
      title: row.canonical_title,
      signal_type: row.signal_type,
      status: row.signal_status,
      trend_status: "active",
      first_seen_at: row.first_seen_at,
      last_seen_at: row.last_seen_at,
      observations: []
    };
    signal.observations.push({
      id: row.observation_id,
      window_start: row.window_start,
      window_end: row.window_end,
      frequency: row.frequency,
      intensity: numericOrNull(row.intensity),
      sentiment: numericOrNull(row.sentiment),
      composite_score: numericOrNull(row.composite_score),
      confidence: row.confidence,
      rank: row.rank,
      delta_vs_previous: numericOrNull(row.delta_vs_previous),
      evidence_count: row.evidence_count,
      evidence_quote: row.evidence_quote
    });
    map.set(row.canonical_signal_id, signal);
  }

  return Array.from(map.values()).map((signal) => ({
    ...signal,
    trend_status: classifyHistoryTrend(signal.observations)
  })).sort((a, b) => {
    const latestA = a.observations[a.observations.length - 1]?.frequency ?? 0;
    const latestB = b.observations[b.observations.length - 1]?.frequency ?? 0;
    return latestB - latestA;
  });
}

export function buildHistoryTimeline(signals: ReturnType<typeof groupHistorySignals>) {
  const buckets = new Map<string, { period: string; triggers: number; barriers: number; signals: number; evidence: number }>();
  for (const signal of signals) {
    for (const observation of signal.observations) {
      const period = (observation.window_start || observation.window_end || "").slice(0, 7) || "unknown";
      const bucket = buckets.get(period) ?? { period, triggers: 0, barriers: 0, signals: 0, evidence: 0 };
      if (signal.signal_type === "trigger") bucket.triggers += observation.frequency;
      if (signal.signal_type === "barrier") bucket.barriers += observation.frequency;
      bucket.signals += 1;
      bucket.evidence += observation.evidence_count;
      buckets.set(period, bucket);
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.period.localeCompare(b.period));
}

export function classifyHistoryTrend(observations: Array<{ frequency: number; delta_vs_previous: number | null }>): HistoryTrendStatus {
  if (observations.length === 0) return "dormant";
  const latest = observations[observations.length - 1];
  if (!latest) return "dormant";
  const previous = observations[observations.length - 2] ?? null;
  const delta = latest.delta_vs_previous ?? (previous ? latest.frequency - previous.frequency : latest.frequency);

  if (latest.frequency <= 0) return "dormant";
  if (observations.length === 1) return "emerging";
  if (delta < 0) return "fading";
  if (delta > 0) return "rising";
  if (observations.length >= 3) return "recurring";
  return "active";
}

function numericOrNull(value: string | null) {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

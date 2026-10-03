"use client";

import { useEffect, useMemo, useState } from "react";

import { useSignalDateRange, useSignalUiLanguage } from "@/components/signal/SignalReportShell";
import { Icon } from "@/components/ui/Icon";

type HistoryObservation = {
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
};

type HistorySignal = {
  id: string;
  title: string;
  signal_type: string;
  status: string;
  trend_status: string;
  first_seen_at: string | null;
  last_seen_at: string | null;
  observations: HistoryObservation[];
};

type TimelinePoint = {
  period: string;
  triggers: number;
  barriers: number;
  signals: number;
  evidence: number;
};

type ActivityPoint = TimelinePoint & {
  dateFrom: string;
  dateTo: string;
  others: number;
  total: number;
};

type HistoryPayload = {
  ok: boolean;
  signals: HistorySignal[];
  timeline: TimelinePoint[];
};

const copy = {
  en: {
    eyebrow: "Live Intelligence",
    title: "Signal history",
    body: "Persistent signals across the live corpus. This reads database observations, not the static report JSON.",
    loading: "Loading signal history...",
    empty: "No signal observations exist in this date range yet.",
    activeSignals: "signals tracked",
    evidence: "evidence links",
    periods: "periods",
    timelineTitle: "Monthly activity",
    timelineBody: "Click a month to apply that period to the whole dashboard.",
    filters: "Filters",
    allTypes: "All types",
    allMomentum: "All momentum",
    signalList: "Signals to watch",
    noMatches: "No signals match these filters.",
    signalMentions: "signal mentions",
    latestEvidence: "latest evidence",
    otherSignals: "other signals",
    rising: "rising",
    falling: "falling",
    stable: "stable",
    emerging: "emerging",
    dormant: "dormant",
    recurring: "recurring",
  },
  es: {
    eyebrow: "Live Intelligence",
    title: "Historia de señales",
    body: "Señales persistentes dentro del corpus vivo. Esto lee observaciones en base de datos, no el JSON estático del reporte.",
    loading: "Cargando historia de señales...",
    empty: "No hay observaciones de señales en este rango de fechas.",
    activeSignals: "señales trackeadas",
    evidence: "evidencias conectadas",
    periods: "periodos",
    timelineTitle: "Actividad mensual",
    timelineBody: "Haz clic en un mes para aplicar ese periodo a todo el dashboard.",
    filters: "Filtros",
    allTypes: "Todos los tipos",
    allMomentum: "Todo el momentum",
    signalList: "Señales a vigilar",
    noMatches: "No hay señales con estos filtros.",
    signalMentions: "menciones de señal",
    latestEvidence: "evidencia reciente",
    otherSignals: "otras señales",
    rising: "subiendo",
    falling: "bajando",
    stable: "estable",
    emerging: "emergente",
    dormant: "dormida",
    recurring: "recurrente",
  }
};

export function SignalHistoricalOverview({ outputId }: { outputId: string }) {
  const { uiLanguage } = useSignalUiLanguage();
  const { dateFrom, dateTo, queryString, setDateRange } = useSignalDateRange();
  const t = copy[uiLanguage];
  const [payload, setPayload] = useState<HistoryPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSignalType, setSelectedSignalType] = useState("");
  const [selectedTrend, setSelectedTrend] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(queryString);
    params.set("limit", "36");
    setIsLoading(true);
    fetch(`/api/signal/${outputId}/history?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then((res) => res.ok ? res.json() : Promise.reject(new Error(`History request failed: ${res.status}`)))
      .then((data) => setPayload(normalizeHistoryPayload(data)))
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setPayload({ ok: false, signals: [], timeline: [] });
      })
      .finally(() => setIsLoading(false));
    return () => controller.abort();
  }, [outputId, queryString]);

  const metrics = useMemo(() => {
    const signals = payload?.signals ?? [];
    const observations = signals.flatMap((signal) => signal.observations);
    return {
      signals: signals.length,
      evidence: observations.reduce((sum, item) => sum + item.evidence_count, 0),
      periods: new Set((payload?.timeline ?? []).map((item) => item.period)).size
    };
  }, [payload]);

  const activityTimeline = useMemo(() => buildActivityTimeline(payload?.signals ?? []), [payload]);
  const maxActivity = useMemo(() => Math.max(1, ...activityTimeline.map((point) => point.total)), [activityTimeline]);
  const hasSignals = (payload?.signals.length ?? 0) > 0;
  const trendSummary = useMemo(() => summarizeTrends(payload?.signals ?? [], t), [payload, t]);
  const visibleTrendSummary = useMemo(() => trendSummary.filter((item) => item.count > 0), [trendSummary]);
  const signalTypeOptions = useMemo(() => summarizeTypes(payload?.signals ?? []), [payload]);
  const trendOptions = useMemo(() => trendSummary.filter((item) => item.count > 0), [trendSummary]);
  const rankedSignals = useMemo(() => {
    return (payload?.signals ?? [])
      .filter((signal) => !selectedSignalType || signal.signal_type === selectedSignalType)
      .filter((signal) => !selectedTrend || trendKey(signal) === selectedTrend)
      .map((signal) => {
        const latest = signal.observations[signal.observations.length - 1] ?? null;
        return { signal, latest };
      })
      .sort((a, b) => (b.latest?.frequency ?? 0) - (a.latest?.frequency ?? 0))
      .slice(0, 12);
  }, [payload, selectedSignalType, selectedTrend]);

  function applyMonth(point: ActivityPoint) {
    setDateRange(point.dateFrom, point.dateTo);
  }

  return (
    <section className="signal-history-panel">
      <header>
        <div>
          <p className="signal-eyebrow">{t.eyebrow}</p>
          <h3>{t.title}</h3>
          <span>{t.body}</span>
        </div>
        <dl>
          <div><dt>{t.activeSignals}</dt><dd>{metrics.signals}</dd></div>
          <div><dt>{t.evidence}</dt><dd>{metrics.evidence}</dd></div>
          <div><dt>{t.periods}</dt><dd>{metrics.periods}</dd></div>
        </dl>
      </header>
      <div className="signal-history-momentum" aria-label="Signal momentum summary">
        {visibleTrendSummary.map((item) => (
          <button
            className={selectedTrend === item.key ? "is-active" : undefined}
            disabled={item.count === 0}
            key={item.key}
            onClick={() => setSelectedTrend((current) => current === item.key ? "" : item.key)}
            type="button"
          >
            <strong>{item.count}</strong>
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="signal-history-empty"><Icon name="refresh" size={16} /> {t.loading}</div>
      ) : !hasSignals ? (
        <div className="signal-history-empty"><Icon name="info" size={16} /> {t.empty}</div>
      ) : (
        <>
          <section className="signal-history-timeline" aria-label={t.timelineTitle}>
            <header>
              <div>
                <h4>{t.timelineTitle}</h4>
                <p>{t.timelineBody}</p>
              </div>
              <div className="signal-history-legend">
                <span><i className="signal-history-trigger" />Trigger</span>
                <span><i className="signal-history-barrier" />Barrier</span>
                <span><i className="signal-history-other" />{t.otherSignals}</span>
              </div>
            </header>
            <div className="signal-history-track">
              {activityTimeline.map((point) => {
                const triggerHeight = Math.max(4, (point.triggers / maxActivity) * 96);
                const barrierHeight = Math.max(4, (point.barriers / maxActivity) * 96);
                const otherHeight = Math.max(4, (point.others / maxActivity) * 96);
                const active = dateFrom === point.dateFrom && dateTo === point.dateTo;
              return (
                <button
                  aria-pressed={active}
                  className={active ? "is-active" : undefined}
                  key={point.period}
                  onClick={() => applyMonth(point)}
                  type="button"
                >
                  <div className="signal-history-bars" aria-hidden="true">
                    <i className="signal-history-trigger" style={{ height: `${triggerHeight}px` }} />
                    <i className="signal-history-barrier" style={{ height: `${barrierHeight}px` }} />
                    <i className="signal-history-other" style={{ height: `${otherHeight}px` }} />
                  </div>
                  <strong>{formatPeriod(point.period, uiLanguage)}</strong>
                  <span>{point.signals} signals · {point.total}</span>
                </button>
              );
            })}
            </div>
          </section>
          <div className="signal-history-workbench">
            <aside className="signal-history-filters">
              <strong>{t.filters}</strong>
              <div>
                <span>Type</span>
                <button className={!selectedSignalType ? "is-active" : undefined} onClick={() => setSelectedSignalType("")} type="button">
                  {t.allTypes}
                </button>
                {signalTypeOptions.map((item) => (
                  <button
                    className={selectedSignalType === item.type ? "is-active" : undefined}
                    key={item.type}
                    onClick={() => setSelectedSignalType((current) => current === item.type ? "" : item.type)}
                    type="button"
                  >
                    {prettifyKey(item.type)} <small>{item.count}</small>
                  </button>
                ))}
              </div>
              <div>
                <span>Momentum</span>
                <button className={!selectedTrend ? "is-active" : undefined} onClick={() => setSelectedTrend("")} type="button">
                  {t.allMomentum}
                </button>
                {trendOptions.map((item) => (
                  <button
                    className={selectedTrend === item.key ? "is-active" : undefined}
                    key={item.key}
                    onClick={() => setSelectedTrend((current) => current === item.key ? "" : item.key)}
                    type="button"
                  >
                    {item.label} <small>{item.count}</small>
                  </button>
                ))}
              </div>
            </aside>
            <section className="signal-history-list" aria-label={t.signalList}>
              <header>
                <h4>{t.signalList}</h4>
                <span>{rankedSignals.length} / {payload?.signals.length ?? 0}</span>
              </header>
              {rankedSignals.length === 0 ? (
                <div className="signal-history-empty"><Icon name="info" size={16} /> {t.noMatches}</div>
              ) : rankedSignals.map(({ signal, latest }) => {
                const delta = latest?.delta_vs_previous ?? 0;
                const direction = trendLabel(signal.trend_status, delta, t);
                const sparkMax = Math.max(1, ...signal.observations.map((observation) => observation.frequency));
                return (
                  <article key={signal.id}>
                    <div className="signal-history-row-main">
                      <header>
                        <span className={`signal-history-type signal-history-type--${signal.signal_type}`}>{signal.signal_type}</span>
                        <small>{direction}</small>
                      </header>
                      <strong>{signal.title}</strong>
                      {latest?.evidence_quote ? <p>{truncate(latest.evidence_quote, 150)}</p> : null}
                    </div>
                    <div className="signal-history-sparkline" aria-label={`${signal.title} history`}>
                      {signal.observations.map((observation) => (
                        <span
                          key={observation.id}
                          style={{ height: `${Math.max(6, (observation.frequency / sparkMax) * 48)}px` }}
                          title={`${formatObservationDate(observation.window_start, uiLanguage)}: ${observation.frequency}`}
                        />
                      ))}
                    </div>
                    <footer>
                      <span><strong>{latest?.frequency ?? 0}</strong>{t.signalMentions}</span>
                      <span><strong>{formatDelta(delta)}</strong>delta</span>
                      <span><strong>{latest?.evidence_count ?? 0}</strong>{t.latestEvidence}</span>
                    </footer>
                  </article>
                );
              })}
            </section>
          </div>
        </>
      )}
    </section>
  );
}

function normalizeHistoryPayload(input: unknown): HistoryPayload {
  const value = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  return {
    ok: value.ok === true,
    signals: arrayValue(value.signals).map((signal) => ({
      id: stringValue(signal.id),
      title: stringValue(signal.title),
      signal_type: stringValue(signal.signal_type),
      status: stringValue(signal.status),
      trend_status: stringValue(signal.trend_status) || "active",
      first_seen_at: stringValue(signal.first_seen_at) || null,
      last_seen_at: stringValue(signal.last_seen_at) || null,
      observations: arrayValue(signal.observations).map((observation) => ({
        id: stringValue(observation.id),
        window_start: stringValue(observation.window_start) || null,
        window_end: stringValue(observation.window_end) || null,
        frequency: numberValue(observation.frequency),
        intensity: nullableNumber(observation.intensity),
        sentiment: nullableNumber(observation.sentiment),
        composite_score: nullableNumber(observation.composite_score),
        confidence: stringValue(observation.confidence) || null,
        rank: nullableNumber(observation.rank),
        delta_vs_previous: nullableNumber(observation.delta_vs_previous),
        evidence_count: numberValue(observation.evidence_count),
        evidence_quote: stringValue(observation.evidence_quote) || null
      }))
    })),
    timeline: arrayValue(value.timeline).map((point) => ({
      period: stringValue(point.period),
      triggers: numberValue(point.triggers),
      barriers: numberValue(point.barriers),
      signals: numberValue(point.signals),
      evidence: numberValue(point.evidence)
    }))
  };
}

function trendLabel(trendStatus: string, delta: number, t: typeof copy.en) {
  if (trendStatus === "emerging") return t.emerging;
  if (trendStatus === "dormant") return t.dormant;
  if (trendStatus === "recurring") return t.recurring;
  if (trendStatus === "fading") return t.falling;
  if (trendStatus === "rising") return t.rising;
  return delta > 0 ? t.rising : delta < 0 ? t.falling : t.stable;
}

function trendKey(signal: HistorySignal) {
  if (signal.trend_status === "emerging") return "emerging";
  if (signal.trend_status === "dormant") return "dormant";
  if (signal.trend_status === "recurring") return "recurring";
  if (signal.trend_status === "fading") return "falling";
  if (signal.trend_status === "rising") return "rising";
  const latest = signal.observations[signal.observations.length - 1];
  const delta = latest?.delta_vs_previous ?? 0;
  return delta > 0 ? "rising" : delta < 0 ? "falling" : "stable";
}

function summarizeTrends(signals: HistorySignal[], t: typeof copy.en) {
  const labels = {
    rising: t.rising,
    falling: t.falling,
    emerging: t.emerging,
    dormant: t.dormant,
    recurring: t.recurring,
    stable: t.stable
  };
  const counts = new Map(Object.keys(labels).map((key) => [key, 0]));
  for (const signal of signals) {
    const key = trendKey(signal);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.entries(labels).map(([key, label]) => ({ key, label, count: counts.get(key) ?? 0 }));
}

function summarizeTypes(signals: HistorySignal[]) {
  const counts = new Map<string, number>();
  for (const signal of signals) {
    counts.set(signal.signal_type, (counts.get(signal.signal_type) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

function buildActivityTimeline(signals: HistorySignal[]): ActivityPoint[] {
  const buckets = new Map<string, {
    barriers: number;
    evidence: number;
    others: number;
    signalIds: Set<string>;
    triggers: number;
  }>();
  for (const signal of signals) {
    for (const observation of signal.observations) {
      const period = (observation.window_start || observation.window_end || "").slice(0, 7);
      if (!period) continue;
      const bucket = buckets.get(period) ?? { barriers: 0, evidence: 0, others: 0, signalIds: new Set<string>(), triggers: 0 };
      if (signal.signal_type === "trigger") bucket.triggers += observation.frequency;
      else if (signal.signal_type === "barrier") bucket.barriers += observation.frequency;
      else bucket.others += observation.frequency;
      bucket.signalIds.add(signal.id);
      bucket.evidence += observation.evidence_count;
      buckets.set(period, bucket);
    }
  }
  return Array.from(buckets.entries())
    .map(([period, bucket]) => {
      const dateFrom = `${period}-01`;
      return {
        barriers: bucket.barriers,
        dateFrom,
        dateTo: lastDayOfMonth(dateFrom),
        evidence: bucket.evidence,
        others: bucket.others,
        period,
        signals: bucket.signalIds.size,
        total: bucket.triggers + bucket.barriers + bucket.others,
        triggers: bucket.triggers
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period));
}

function lastDayOfMonth(dateFrom: string) {
  const date = new Date(`${dateFrom}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateFrom;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

function formatPeriod(period: string, locale: "en" | "es") {
  const date = new Date(`${period}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return period;
  return date.toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}

function formatObservationDate(value: string | null, locale: "en" | "es") {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function formatDelta(value: number) {
  if (!Number.isFinite(value) || value === 0) return "0";
  return value > 0 ? `+${value}` : String(value);
}

function prettifyKey(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function arrayValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

function numberValue(value: unknown) {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = numberValue(value);
  return Number.isFinite(number) ? number : null;
}

function truncate(value: string, max: number) {
  const clean = value.trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}...` : clean;
}

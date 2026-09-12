import type { SignalMetricValueStateV1, SignalWorkspaceTopicsOverviewV1 } from "@noisia/query-engine";

import type { SignalBrandMonitoringV1 } from "@/lib/signal-v2/brand-monitoring";

export function isNativeSignalTopicsOverviewV1(
  value: unknown,
  workspaceId: string
): value is SignalWorkspaceTopicsOverviewV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.contract_version === "signal-workspace-topics-serving-v1"
    && candidate.workspace_id === workspaceId;
}

/** Maps the workspace-native population into the established Signal dashboard.
 * It only fills metrics that the native population proves. Metrics without a
 * governed source remain explicitly unavailable. */
export function buildNativeSignalMonitoringV1(
  base: SignalBrandMonitoringV1,
  native: SignalWorkspaceTopicsOverviewV1
): SignalBrandMonitoringV1 {
  const start = native.filters.date_from ?? native.available_dates.date_from;
  const end = native.filters.date_to ?? native.available_dates.date_to;
  const currentState = native.is_current ? "fresh" : "stale";
  const metricState: SignalMetricValueStateV1 = native.is_current ? "available" : "stale";
  const partialReason = native.is_current
    ? "workspace_native_population_root_level"
    : "workspace_native_generation_stale";
  const points = native.series.map((point) => ({
    period_start: point.date,
    period_end: point.date,
    value: point.mention_count,
    denominator: native.denominator,
    sample_size: point.mention_count,
    state: metricState
  }));
  const selectedTopics = native.terms.filter((term) => term.selected);
  const topicBuckets = selectedTopics.map((term) => ({
    key: term.term_key,
    label: term.label,
    value: term.mention_count,
    denominator: native.denominator,
    sample_size: term.mention_count,
    state: metricState
  }));

  return {
    ...base,
    coverage: {
      date_from: native.available_dates.date_from,
      date_through: native.available_dates.date_to,
      mentions: native.denominator
    },
    filter: start && end ? {
      ...base.filter,
      date_range: { start, end },
      timezone: "UTC",
      granularity: "day",
      dimensions: {},
      search_query: undefined
    } : base.filter,
    comparison: { ...base.comparison, mode: "none", date_range: null },
    comparison_filter: null,
    freshness: {
      state: currentState,
      data: {
        source: native.source,
        observed_at: native.observed_at,
        generation_id: native.generation_id,
        unit: "canonical_mention"
      },
      interpretation: {
        source_engine_execution_id: native.source_engine_execution_id,
        coverage: native.interpretation_coverage,
        quality: native.quality
      }
    },
    volume: {
      state: native.is_current ? "fresh" : "stale",
      reason: native.is_current ? null : partialReason,
      points,
      previous_points: [],
      current_value: native.denominator,
      previous_value: null,
      delta: null,
      delta_ratio: null
    },
    conversation_structure: {
      ...base.conversation_structure,
      state: "not_available",
      reason: "workspace_native_conversation_structure_pending",
      points: [],
      previous_points: [],
      previous_summary: null
    },
    topics: {
      state: native.is_current ? "fresh" : "stale",
      reason: native.is_current ? null : partialReason,
      buckets: topicBuckets
    },
    narratives: {
      state: "not_available",
      reason: "workspace_narrative_consolidation_pending",
      buckets: []
    },
    partial_states: [
      { state: "partial", reason: partialReason },
      ...native.limitations.map((reason) => ({ state: "partial", reason }))
    ]
  };
}

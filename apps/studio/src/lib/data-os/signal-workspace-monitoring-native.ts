import type { SignalMetricValueStateV1, SignalWorkspaceOverviewV1 } from "@noisia/query-engine";

import type { SignalBrandMonitoringV1 } from "@/lib/signal-v2/brand-monitoring";

export function isNativeSignalTopicsOverviewV1(
  value: unknown,
  workspaceId: string
): value is SignalWorkspaceOverviewV1 {
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
  native: SignalWorkspaceOverviewV1
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
  const selectedTopics = native.terms.filter((term) => term.selected && term.kind !== "narrative");
  const selectedNarratives = native.terms.filter((term) => term.selected && term.kind === "narrative");
  const topicBuckets = selectedTopics.map((term) => ({
    key: term.term_key,
    label: term.label,
    value: term.mention_count,
    denominator: native.denominator,
    sample_size: term.mention_count,
    state: metricState
  }));
  const narrativeBuckets = selectedNarratives.map((term) => ({
    key: term.term_key,
    label: term.label,
    value: term.mention_count,
    denominator: native.denominator,
    sample_size: term.mention_count,
    state: metricState
  }));
  const imported = native.source === "workspace_imported";
  const hasEditorialConsolidation = native.coverage.noise !== null;
  const monitoring = native.monitoring?.contract_version === "signal-workspace-monitoring-v1"
    && native.monitoring.scope_digest === native.scope_digest
    && native.monitoring.denominator === native.denominator
    && native.monitoring.summary.mentions === native.denominator ? native.monitoring : null;
  const unavailable = { state: "not_available" as const, reason: "workspace_native_source_metadata_unavailable" };
  const metadataState = (known: number, total: number) => !native.is_current ? "stale" as const
    : known < total ? "partial" as const : "fresh" as const;
  const hasThreads = Boolean(monitoring && monitoring.source_coverage.thread_id_known > 0);
  const hasRoles = Boolean(monitoring && monitoring.source_coverage.content_type_known > 0);
  const emptySummary = { mentions: 0, conversations: null, root_posts: null, comments: null, classified_sentiment: 0 };
  const emptyAttention = { root_posts: 0, total_interactions: 0, median_interactions: 0, p90_interactions: 0,
    active_root_posts: 0, active_ratio: null, total_views: 0, viewed_root_posts: 0 };
  const sentimentKnown = monitoring?.source_coverage.sentiment_known ?? 0;
  const sentimentBuckets = monitoring && sentimentKnown > 0 ? (["positive", "neutral", "negative"] as const).map(key => ({
    key, label: key, value: monitoring.sentiment[key], denominator: native.denominator,
    sample_size: monitoring.sentiment[key], state: metricState
  })) : [];

  return {
    ...base,
    corpus: null,
    read_scope: { source: native.source, scope_digest: native.scope_digest },
    coverage: {
      date_from: native.available_dates.date_from,
      date_through: native.available_dates.date_to,
      mentions: native.denominator
    },
    filter: start && end ? {
      ...base.filter,
      date_range: { start, end },
      timezone: base.workspace.timezone,
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
        unit: "canonical_mention",
        ...(monitoring ? { source_coverage: monitoring.source_coverage, metadata_digest: monitoring.metadata_digest,
          scope_digest: monitoring.scope_digest, unknown_roles: monitoring.summary.unknown_roles } : {})
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
      ...(monitoring ? { state: metadataState(monitoring.source_coverage.content_type_known, native.denominator), reason: null }
        : { state: "not_available" as const, reason: "workspace_native_conversation_structure_pending" }),
      summary: monitoring ? { ...monitoring.summary, conversations: hasThreads ? monitoring.summary.conversations : null,
        root_posts: hasRoles ? monitoring.summary.root_posts : null, comments: hasRoles ? monitoring.summary.comments : null } : emptySummary,
      attention: monitoring?.attention ?? emptyAttention,
      points: monitoring?.series.map(point => ({ ...point, conversations: hasThreads ? point.conversations : null,
        root_posts: hasRoles ? point.root_posts : null, comments: hasRoles ? point.comments : null })) ?? [],
      previous_points: [],
      previous_summary: null
    },
    sentiment: { ...(sentimentKnown > 0 ? { state: metadataState(sentimentKnown, native.denominator), reason: null } : unavailable),
      buckets: sentimentBuckets, previous_buckets: [] },
    emotions: { ...(monitoring && monitoring.source_coverage.emotion_classified > 0
      ? { state: metadataState(monitoring.source_coverage.emotion_classified, native.denominator), reason: null }
      : { ...unavailable, reason: "workspace_native_source_emotions_unavailable" }),
      buckets: monitoring?.emotions.map(item => ({ key: item.key, label: item.key, value: item.count,
        denominator: native.denominator, sample_size: item.count, state: metricState })) ?? [] },
    platforms: { ...(monitoring ? { state: currentState, reason: null } : unavailable),
      buckets: monitoring?.platforms.map(item => ({ key: item.key, label: item.key, value: item.count,
        denominator: native.denominator, sample_size: item.count, state: metricState })) ?? [] },
    attention: { ...(monitoring?.attention ?? emptyAttention),
      ...(monitoring && (monitoring.source_coverage.engagement_known_root_posts > 0 || monitoring.source_coverage.views_known_root_posts > 0)
        ? { state: metadataState(monitoring.source_coverage.engagement_known_root_posts, monitoring.attention.root_posts), reason: null }
        : unavailable), previous: null, previous_total_interactions: null, interactions_delta_ratio: null },
    conversation_drivers: { ...(monitoring ? { state: currentState, reason: null } : unavailable), items: monitoring?.drivers ?? [] },
    highlights: { positive: monitoring?.highlights.positive.map(item => ({ ...item, explanation: "" })) ?? [],
      negative: monitoring?.highlights.negative.map(item => ({ ...item, explanation: "" })) ?? [] },
    monthly_insights: { contract_version: "signal-monthly-insights-v1", candidate_hash: null, cadence: "rolling_30_days",
      independent_of_page_filter: true, window: null, comparison_window: null, calculated_through: null,
      context: { state: "not_available", objectives: 0, briefs: 0, audiences: 0, approved_assertions: 0 },
      interpretation_state: "not_available", items: [] },
    interpretations: [],
    evidence_access: undefined,
    topics: {
      state: imported ? "not_available" : native.is_current ? "fresh" : "stale",
      reason: imported ? "workspace_imported_classification_pending" : native.is_current ? null : partialReason,
      buckets: topicBuckets
    },
    narratives: {
      state: hasEditorialConsolidation ? native.is_current ? "fresh" : "stale" : "not_available",
      reason: hasEditorialConsolidation ? native.is_current ? null : partialReason : "workspace_narrative_consolidation_pending",
      buckets: narrativeBuckets
    },
    partial_states: [
      { state: "partial", reason: partialReason },
      ...native.limitations.map((reason) => ({ state: "partial", reason })),
      ...(monitoring?.limitations.map(reason => ({ state: "partial", reason })) ?? [])
    ]
  };
}

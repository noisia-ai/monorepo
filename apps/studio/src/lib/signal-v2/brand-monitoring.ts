import type {
  SignalBreakdownV1,
  SignalComparisonV1,
  SignalFilterV1,
  SignalMetricPointV1,
  SignalMonthlyInsightPacketV1,
  SignalTimeSeriesV1
} from "@noisia/query-engine";
import {
  buildSignalMentionReadPredicateV1,
  buildSignalPopulationMentionReadPredicateV1,
  resolveSignalComparisonV1,
  signalFiltersHashV1,
  signalMonthlyInsightCandidateHashV1,
  validateSignalMonthlyInsightEditorialV1,
  SIGNAL_MONTHLY_INSIGHT_METRIC_GROUP_KEY
} from "@noisia/query-engine";

import { pool } from "@/lib/db";
import type { ResolvedSignalWorkspace } from "@/lib/data-os/signal-workspace";
import {
  buildSignalOperationalMentionReadPredicateV1,
  requireSignalOperationalReadScopeV1,
  type SignalOperationalReadScopeV1
} from "@/lib/data-os/signal-operational-read-scope";
import { loadSignalWorkspaceHomeV1 } from "@/lib/data-os/signal-workspace-home";
import {
  loadSignalClientEvidenceAccessV1,
  loadSignalBreakdownV1,
  loadSignalSeriesV1,
  type SignalClientEvidenceAccessV1,
  type SignalServingQueryable
} from "@/lib/data-os/signal-workspace-serving";

type MetricState = "fresh" | "stale" | "pending" | "partial" | "not_available";

export type BrandMonitoringHighlight = {
  id: string;
  occurred_at: string;
  title: string | null;
  text: string;
  url: string | null;
  platform: string;
  sentiment: number;
  engagement: number;
  reach: number | null;
  explanation: string;
};

export type BrandMonitoringBreakdown = {
  state: MetricState;
  reason: string | null;
  buckets: SignalBreakdownV1["buckets"];
};

export type BrandMonitoringSeries = {
  state: MetricState;
  reason: string | null;
  points: SignalMetricPointV1[];
};

export type BrandMonitoringConversationPoint = {
  period_start: string;
  mentions: number;
  conversations: number;
  root_posts: number;
  comments: number;
  sentiment: {
    positive: number;
    neutral: number;
    negative: number;
    classified: number;
  };
};

export type BrandMonitoringConversationSummary = {
  mentions: number;
  conversations: number;
  root_posts: number;
  comments: number;
  classified_sentiment: number;
};

export type BrandMonitoringAttention = {
  root_posts: number;
  total_interactions: number;
  median_interactions: number;
  p90_interactions: number;
  active_root_posts: number;
  active_ratio: number | null;
  total_views: number;
  viewed_root_posts: number;
};

export type BrandMonitoringThreadDriver = {
  id: string;
  title: string | null;
  text: string;
  url: string | null;
  platform: string;
  mention_count: number;
  root_post_count: number;
  comment_count: number;
  interaction_count: number;
  view_count: number;
};

export type BrandMonitoringMonthlyInsightKind =
  | "volume_momentum"
  | "conversation_concentration"
  | "conversation_depth"
  | "sentiment_balance"
  | "platform_concentration"
  | "attention_momentum";

export type BrandMonitoringMonthlyInsightTone =
  | "positive"
  | "negative"
  | "neutral"
  | "attention";

export type BrandMonitoringMonthlyInsightChart =
  | {
      type: "line";
      current: Array<{ period_start: string; value: number }>;
      previous: Array<{ period_start: string; value: number }>;
    }
  | {
      type: "bar";
      items: Array<{ key: string; value: number; secondary_value?: number }>;
    }
  | {
      type: "donut";
      items: Array<{ key: "positive" | "neutral" | "negative"; value: number }>;
      previous_items: Array<{ key: "positive" | "neutral" | "negative"; value: number }>;
    }
  | {
      type: "comparison";
      items: Array<{ key: string; current: number; previous: number | null }>;
    };

export type BrandMonitoringMonthlyInsight = {
  id: string;
  kind: BrandMonitoringMonthlyInsightKind;
  tone: BrandMonitoringMonthlyInsightTone;
  rank: number;
  metric: {
    current: number;
    previous: number | null;
    delta: number | null;
    delta_ratio: number | null;
    unit: "count" | "ratio";
  };
  chart: BrandMonitoringMonthlyInsightChart;
  evidence: {
    mention_ids: string[];
    evidence_count: number;
  };
  editorial: {
    state: "deterministic" | "claude" | "needs_review";
    short_title: string | null;
    headline: string | null;
    explanation: string | null;
    why_it_matters: string | null;
    confidence: "high" | "medium" | "low" | null;
    limitations: string[];
  };
};

export type BrandMonitoringMonthlyInsights = {
  contract_version: "signal-monthly-insights-v1";
  candidate_hash: string | null;
  cadence: "rolling_30_days";
  independent_of_page_filter: true;
  window: {
    start: string;
    end: string;
    days: number;
  } | null;
  comparison_window: {
    start: string;
    end: string;
    days: number;
  } | null;
  calculated_through: string | null;
  context: {
    state: "ready" | "partial" | "not_available";
    objectives: number;
    briefs: number;
    audiences: number;
    approved_assertions: number;
  };
  interpretation_state: "deterministic" | "claude" | "needs_review" | "not_available";
  items: BrandMonitoringMonthlyInsight[];
};

type BrandMonitoringConversationWindow = {
  state: MetricState;
  reason: string | null;
  points: BrandMonitoringConversationPoint[];
  summary: BrandMonitoringConversationSummary;
  attention: BrandMonitoringAttention;
};

export type SignalBrandMonitoringV1 = {
  contract_version: "signal-brand-monitoring-v1";
  workspace: {
    id: string;
    slug: string;
    timezone: string;
  };
  corpus: {
    id: string;
    name: string | null;
  } | null;
  read_scope?: Record<string, unknown>;
  coverage: {
    date_from: string | null;
    date_through: string | null;
    mentions: number;
  };
  filter: SignalFilterV1;
  comparison: SignalComparisonV1;
  comparison_filter: SignalFilterV1 | null;
  freshness: {
    state: string;
    data: Record<string, unknown>;
    interpretation: Record<string, unknown>;
  };
  volume: BrandMonitoringSeries & {
    previous_points: SignalMetricPointV1[];
    current_value: number | null;
    previous_value: number | null;
    delta: number | null;
    delta_ratio: number | null;
  };
  conversation_structure: BrandMonitoringConversationWindow & {
    previous_points: BrandMonitoringConversationPoint[];
    previous_summary: BrandMonitoringConversationSummary | null;
  };
  sentiment: BrandMonitoringBreakdown & {
    previous_buckets: SignalBreakdownV1["buckets"];
  };
  emotions: BrandMonitoringBreakdown;
  platforms: BrandMonitoringBreakdown;
  topics: BrandMonitoringBreakdown;
  narratives: BrandMonitoringBreakdown;
  attention: BrandMonitoringAttention & {
    state: MetricState;
    reason: string | null;
    previous: BrandMonitoringAttention | null;
    previous_total_interactions: number | null;
    interactions_delta_ratio: number | null;
  };
  conversation_drivers: {
    state: MetricState;
    reason: string | null;
    items: BrandMonitoringThreadDriver[];
  };
  monthly_insights: BrandMonitoringMonthlyInsights;
  interpretations: Array<Record<string, unknown>>;
  highlights: {
    positive: BrandMonitoringHighlight[];
    negative: BrandMonitoringHighlight[];
  };
  evidence_access?: SignalClientEvidenceAccessV1;
  partial_states: Array<Record<string, unknown>>;
};

export function buildEmptySignalBrandMonitoringV1(
  workspace: ResolvedSignalWorkspace
): SignalBrandMonitoringV1 {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const filter: SignalFilterV1 = {
    contract_version: "signal-backend-v1",
    date_range: { start: startDate.toISOString().slice(0, 10), end },
    timezone: workspace.timezone,
    granularity: "day",
    dimensions: {}
  };
  const comparison = resolveSignalComparisonV1({ filter, mode: "previous_period" });
  const unavailable = { state: "not_available" as const, reason: "workspace_has_no_sources" };
  const attention = emptyAttention();
  return {
    contract_version: "signal-brand-monitoring-v1",
    workspace: { id: workspace.id, slug: workspace.slug, timezone: workspace.timezone },
    corpus: { id: workspace.id, name: null },
    coverage: { date_from: null, date_through: null, mentions: 0 },
    filter,
    comparison,
    comparison_filter: null,
    freshness: {
      state: "not_available",
      data: { reason: "workspace_has_no_sources" },
      interpretation: { reason: "workspace_has_no_sources" }
    },
    volume: {
      ...unavailable,
      points: [],
      previous_points: [],
      current_value: null,
      previous_value: null,
      delta: null,
      delta_ratio: null
    },
    conversation_structure: {
      ...unavailable,
      points: [],
      summary: emptyConversationSummary(),
      attention,
      previous_points: [],
      previous_summary: null
    },
    sentiment: { ...unavailable, buckets: [], previous_buckets: [] },
    emotions: { ...unavailable, buckets: [] },
    platforms: { ...unavailable, buckets: [] },
    topics: { ...unavailable, buckets: [] },
    narratives: { ...unavailable, buckets: [] },
    attention: {
      ...attention,
      ...unavailable,
      previous: null,
      previous_total_interactions: null,
      interactions_delta_ratio: null
    },
    conversation_drivers: { ...unavailable, items: [] },
    monthly_insights: {
      contract_version: "signal-monthly-insights-v1",
      candidate_hash: null,
      cadence: "rolling_30_days",
      independent_of_page_filter: true,
      window: null,
      comparison_window: null,
      calculated_through: null,
      context: {
        state: "not_available",
        objectives: 0,
        briefs: 0,
        audiences: 0,
        approved_assertions: 0
      },
      interpretation_state: "not_available",
      items: []
    },
    interpretations: [],
    highlights: { positive: [], negative: [] },
    partial_states: [{ state: "not_available", reason: "workspace_has_no_sources" }]
  };
}

export async function loadSignalBrandMonitoringV1(args: {
  workspace: ResolvedSignalWorkspace;
  readScope?: SignalOperationalReadScopeV1;
  evidenceReadScope?: SignalOperationalReadScopeV1 | null;
  filter: SignalFilterV1;
  comparison?: SignalComparisonV1;
  isInternalUser: boolean;
}): Promise<SignalBrandMonitoringV1> {
  const comparison = args.comparison ?? resolveSignalComparisonV1({
    filter: args.filter,
    mode: "previous_period"
  });
  const comparisonFilter = comparison.date_range
    ? { ...args.filter, date_range: comparison.date_range }
    : null;
  const readScope = requireSignalOperationalReadScopeV1(args.workspace, args.readScope);
  const evidenceAccessRequested = Object.prototype.hasOwnProperty.call(
    args,
    "evidenceReadScope"
  );
  const evidenceReadScope = args.evidenceReadScope == null
    ? null
    : requireSignalOperationalReadScopeV1(args.workspace, args.evidenceReadScope);
  const homePromise = loadSignalWorkspaceHomeV1(args.workspace, args.isInternalUser, readScope);
  const monthlyInsightsPromise = homePromise.then((home) =>
    loadMonthlyInsights(
      args.workspace,
      home.coverage,
      {},
      readScope,
      evidenceAccessRequested ? evidenceReadScope : undefined
    )
  );
  const volumePromise = safeSeries(() => loadSignalSeriesV1({
    workspace: args.workspace,
    readScope,
    filter: args.filter,
    metricKey: "conversation.volume",
    metricVersion: 1,
    isInternalUser: args.isInternalUser
  }));
  const previousVolumePromise = comparisonFilter
    ? safeSeries(() => loadSignalSeriesV1({
        workspace: args.workspace,
        readScope,
        filter: comparisonFilter,
        metricKey: "conversation.volume",
        metricVersion: 1,
        isInternalUser: args.isInternalUser
      }))
    : Promise.resolve<BrandMonitoringSeries>({
        state: "not_available",
        reason: "comparison_disabled",
        points: []
      });
  const sentimentPromise = safeBreakdown(() => loadSignalBreakdownV1({
    workspace: args.workspace,
    readScope,
    filter: args.filter,
    metricKey: "sentiment.share",
    metricVersion: 1,
    dimension: "sentiment_polarity",
    isInternalUser: args.isInternalUser
  }));
  const previousSentimentPromise = comparisonFilter
    ? safeBreakdown(() => loadSignalBreakdownV1({
        workspace: args.workspace,
        readScope,
        filter: comparisonFilter,
        metricKey: "sentiment.share",
        metricVersion: 1,
        dimension: "sentiment_polarity",
        isInternalUser: args.isInternalUser
      }))
    : Promise.resolve<BrandMonitoringBreakdown>({
        state: "not_available",
        reason: "comparison_disabled",
        buckets: []
      });
  const emotionsPromise = safeBreakdown(() => loadSignalBreakdownV1({
    workspace: args.workspace,
    readScope,
    filter: args.filter,
    metricKey: "emotion.share",
    metricVersion: 1,
    dimension: "emotion",
    isInternalUser: args.isInternalUser
  }));
  const platformsPromise = safeBreakdown(() => loadSignalBreakdownV1({
    workspace: args.workspace,
    readScope,
    filter: args.filter,
    metricKey: "platform.share",
    metricVersion: 1,
    dimension: "platform",
    isInternalUser: args.isInternalUser
  }));
  const topicsPromise = safeBreakdown(() => loadSignalBreakdownV1({
    workspace: args.workspace,
    readScope,
    filter: args.filter,
    metricKey: "topic.volume",
    metricVersion: 1,
    dimension: "topic",
    isInternalUser: args.isInternalUser
  }));
  const narrativesPromise = safeBreakdown(() => loadSignalBreakdownV1({
    workspace: args.workspace,
    readScope,
    filter: args.filter,
    metricKey: "narrative.volume",
    metricVersion: 1,
    dimension: "narrative",
    isInternalUser: args.isInternalUser
  }));
  const conversationStructurePromise = safeConversationWindow(
    args.workspace,
    args.filter,
    readScope
  );
  const previousConversationStructurePromise = comparisonFilter
    ? safeConversationWindow(args.workspace, comparisonFilter, readScope)
    : Promise.resolve<BrandMonitoringConversationWindow | null>(null);
  const conversationDriversPromise = evidenceAccessRequested && !evidenceReadScope
    ? Promise.resolve<SignalBrandMonitoringV1["conversation_drivers"]>({
        state: "not_available",
        reason: "mentions_capability_not_available",
        items: []
      })
    : safeConversationDrivers(
        args.workspace,
        args.filter,
        readScope,
        evidenceReadScope ?? undefined
      );
  const highlightsPromise = evidenceAccessRequested && !evidenceReadScope
    ? Promise.resolve<SignalBrandMonitoringV1["highlights"]>({ positive: [], negative: [] })
    : loadConversationHighlights(
        args.workspace,
        args.filter,
        readScope,
        evidenceReadScope ?? undefined
      );
  const evidenceAccessPromise = evidenceAccessRequested
    ? loadSignalClientEvidenceAccessV1({
        workspace: args.workspace,
        metricReadScope: readScope,
        evidenceReadScope,
        filter: args.filter
      })
    : Promise.resolve<SignalClientEvidenceAccessV1 | undefined>(undefined);

  const [
    home,
    volume,
    previousVolume,
    sentiment,
    previousSentiment,
    emotions,
    platforms,
    topics,
    narratives,
    conversationStructure,
    previousConversationStructure,
    conversationDrivers,
    monthlyInsights,
    highlights,
    evidenceAccess
  ] = await Promise.all([
    homePromise,
    volumePromise,
    previousVolumePromise,
    sentimentPromise,
    previousSentimentPromise,
    emotionsPromise,
    platformsPromise,
    topicsPromise,
    narrativesPromise,
    conversationStructurePromise,
    previousConversationStructurePromise,
    conversationDriversPromise,
    monthlyInsightsPromise,
    highlightsPromise,
    evidenceAccessPromise
  ]);
  const currentVolume = sumSeries(volume.points);
  const previousVolumeValue = comparisonFilter ? sumSeries(previousVolume.points) : null;
  const volumeDelta = currentVolume != null && previousVolumeValue != null
    ? currentVolume - previousVolumeValue
    : null;
  const volumeDeltaRatio = currentVolume != null && previousVolumeValue != null && previousVolumeValue !== 0
    ? (currentVolume - previousVolumeValue) / previousVolumeValue
    : null;
  const previousInteractions = previousConversationStructure?.attention.total_interactions ?? null;
  const interactionsDeltaRatio = previousInteractions != null && previousInteractions !== 0
    ? (conversationStructure.attention.total_interactions - previousInteractions) / previousInteractions
    : null;

  return {
    contract_version: "signal-brand-monitoring-v1",
    workspace: {
      id: args.workspace.id,
      slug: args.workspace.slug,
      timezone: args.workspace.timezone
    },
    read_scope: readScope.descriptor,
    corpus: home.corpus ? { id: home.corpus.id, name: home.corpus.name } : null,
    coverage: home.coverage,
    filter: args.filter,
    comparison,
    comparison_filter: comparisonFilter,
    freshness: {
      state: home.freshness.overall_state,
      data: home.freshness.data,
      interpretation: home.freshness.interpretation
    },
    volume: {
      ...volume,
      previous_points: previousVolume.points,
      current_value: currentVolume,
      previous_value: previousVolumeValue,
      delta: volumeDelta,
      delta_ratio: volumeDeltaRatio
    },
    conversation_structure: {
      ...conversationStructure,
      previous_points: previousConversationStructure?.points ?? [],
      previous_summary: previousConversationStructure?.summary ?? null
    },
    sentiment: {
      ...sentiment,
      previous_buckets: previousSentiment.buckets
    },
    emotions,
    platforms,
    topics,
    narratives,
    attention: {
      ...conversationStructure.attention,
      state: conversationStructure.state,
      reason: conversationStructure.reason,
      previous: previousConversationStructure?.attention ?? null,
      previous_total_interactions: previousInteractions,
      interactions_delta_ratio: interactionsDeltaRatio
    },
    conversation_drivers: conversationDrivers,
    monthly_insights: monthlyInsights,
    interpretations: home.interpretations,
    highlights,
    ...(evidenceAccess ? { evidence_access: evidenceAccess } : {}),
    partial_states: home.partial_states
  };
}

export async function loadSignalBrandMonitoringModuleShadowV1(args: {
  workspace: ResolvedSignalWorkspace;
  populationId: string;
  filter: SignalFilterV1;
  queryable?: SignalServingQueryable;
}) {
  const corpus = operationalCorpus(args.workspace);
  if (!corpus) throw new Error("Signal workspace has no operational corpus for legacy shadow.");
  const legacy = await loadBrandMonitoringShadowScope(buildSignalMentionReadPredicateV1(
    args.filter,
    [corpus.id],
    args.workspace.id
  ), args.queryable);
  const governed = await loadSignalBrandMonitoringGovernedModuleProofV1(args);
  const reconciled = legacy.canonical_ids_hash === governed.canonical_ids_hash
    && legacy.row_denominator === governed.row_denominator
    && legacy.canonical_denominator === governed.canonical_denominator
    && legacy.sentiment_denominator === governed.sentiment_denominator
    && legacy.period_start === governed.period_start
    && legacy.period_end === governed.period_end
    && legacy.series_hash === governed.series_hash;
  return {
    reader: "brand-monitoring-conversation-window",
    legacy,
    governed,
    reconciled,
    state: reconciled ? "exact" as const : "diverged" as const
  };
}

/**
 * Executes only the population-owned Brand Monitoring reader proof. Multi-view
 * rehearsals use this entrypoint so they never consult the operational pointer
 * or require a legacy corpus merely to verify a governed binding.
 */
export async function loadSignalBrandMonitoringGovernedModuleProofV1(args: {
  workspace: ResolvedSignalWorkspace;
  populationId: string;
  filter: SignalFilterV1;
  queryable?: SignalServingQueryable;
}) {
  return loadBrandMonitoringShadowScope(buildSignalPopulationMentionReadPredicateV1(
    args.filter,
    args.populationId,
    args.workspace.id
  ), args.queryable);
}

async function loadBrandMonitoringShadowScope(
  predicate: ReturnType<typeof buildSignalMentionReadPredicateV1>,
  queryable?: SignalServingQueryable
) {
  const params = [...predicate.params, predicate.normalized_filter.timezone];
  const timezoneParameter = `$${params.length}`;
  const result = await (queryable ?? pool).query<{
    row_denominator: number;
    canonical_denominator: number;
    sentiment_denominator: number;
    period_start: string | null;
    period_end: string | null;
    canonical_ids_hash: string;
    series_hash: string;
  }>(`
    WITH scoped AS (
      SELECT
        m.id,
        COALESCE(m.canonical_mention_id, m.id) AS canonical_id,
        (m.published_at AT TIME ZONE ${timezoneParameter})::date AS local_date,
        date_trunc('${predicate.normalized_filter.granularity}',
          m.published_at AT TIME ZONE ${timezoneParameter})::date AS period_bucket,
        m.sentiment_score
      FROM mentions m
      WHERE ${predicate.sql}
    ), canonical AS (
      SELECT DISTINCT canonical_id FROM scoped
    ), daily AS (
      SELECT period_bucket AS period_start, count(*)::int AS mentions
      FROM scoped
      GROUP BY period_bucket
    )
    SELECT
      (SELECT count(*)::int FROM scoped) AS row_denominator,
      (SELECT count(*)::int FROM canonical) AS canonical_denominator,
      (SELECT count(*)::int FROM scoped WHERE sentiment_score IS NOT NULL)
        AS sentiment_denominator,
      (SELECT min(local_date)::text FROM scoped) AS period_start,
      (SELECT max(local_date)::text FROM scoped) AS period_end,
      'sha256:' || encode(sha256(convert_to(COALESCE((
        SELECT string_agg(canonical_id::text, ',' ORDER BY canonical_id::text)
        FROM canonical
      ), ''), 'UTF8')), 'hex') AS canonical_ids_hash,
      'sha256:' || encode(sha256(convert_to(COALESCE((
        SELECT string_agg(period_start::text || ':' || mentions::text, ',' ORDER BY period_start)
        FROM daily
      ), ''), 'UTF8')), 'hex') AS series_hash
  `, params);
  return result.rows[0] ?? {
    row_denominator: 0,
    canonical_denominator: 0,
    sentiment_denominator: 0,
    period_start: null,
    period_end: null,
    canonical_ids_hash: "",
    series_hash: ""
  };
}

export async function prepareSignalMonthlyInsightPacketV1(
  workspace: ResolvedSignalWorkspace
): Promise<SignalMonthlyInsightPacketV1> {
  const corpus = operationalCorpus(workspace);
  if (!corpus) throw new Error("Signal workspace has no operational corpus.");
  const coverageResult = await pool.query<{
    date_from: string | null;
    date_through: string | null;
    mentions: string | number;
  }>(`
    SELECT
      min(published_at)::date::text AS date_from,
      max(published_at)::date::text AS date_through,
      count(*)::int AS mentions
    FROM mentions
    WHERE study_corpus_id = $1::uuid
      AND inclusion_status = 'included'
  `, [corpus.id]);
  const coverage = {
    date_from: coverageResult.rows[0]?.date_from ?? null,
    date_through: coverageResult.rows[0]?.date_through ?? null,
    mentions: numberValue(coverageResult.rows[0]?.mentions)
  };
  const insights = await loadMonthlyInsights(workspace, coverage, {
    includeAllCandidates: true,
    loadEditorial: false
  });
  if (!insights.window || !insights.candidate_hash || insights.items.length === 0) {
    throw new Error("Monthly insight candidates are not available for this corpus.");
  }
  const candidates = insights.items.map(({ editorial, ...candidate }) => {
    void editorial;
    return candidate;
  });
  return {
    contract_version: "signal-monthly-insight-packet-v1",
    workspace_id: workspace.id,
    study_corpus_id: corpus.id,
    organization_id: workspace.organizationId,
    brand_id: workspace.subject.type === "brand" ? workspace.subject.id : null,
    timezone: workspace.timezone,
    window: insights.window,
    comparison_window: insights.comparison_window,
    candidate_hash: insights.candidate_hash,
    context: insights.context,
    candidates
  };
}

async function safeSeries(
  loader: () => Promise<Awaited<ReturnType<typeof loadSignalSeriesV1>>>
): Promise<BrandMonitoringSeries> {
  try {
    const result = await loader();
    if (result.status !== "ready") {
      return { state: result.status === "pending" ? "pending" : "not_available", reason: materializationReason(result), points: [] };
    }
    const payload = result.payload as SignalTimeSeriesV1;
    return {
      state: normalizeMetricState(payload.freshness.state),
      reason: payload.freshness.reason,
      points: payload.points
    };
  } catch (error) {
    return { state: "not_available", reason: errorMessage(error), points: [] };
  }
}

async function safeBreakdown(
  loader: () => Promise<Awaited<ReturnType<typeof loadSignalBreakdownV1>>>
): Promise<BrandMonitoringBreakdown> {
  try {
    const result = await loader();
    if (result.status !== "ready") {
      return { state: result.status === "pending" ? "pending" : "not_available", reason: materializationReason(result), buckets: [] };
    }
    const payload = result.payload as SignalBreakdownV1;
    return {
      state: normalizeMetricState(payload.freshness.state),
      reason: payload.freshness.reason,
      buckets: payload.buckets
    };
  } catch (error) {
    return { state: "not_available", reason: errorMessage(error), buckets: [] };
  }
}

function materializationReason(result: { payload?: unknown }) {
  if (result.payload && typeof result.payload === "object" && "reason" in result.payload) {
    return String(result.payload.reason);
  }
  return "materialization_not_ready";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "metric_not_available";
}

function normalizeMetricState(value: string): MetricState {
  if (value === "fresh" || value === "stale" || value === "partial" || value === "not_available") return value;
  return "partial";
}

function sumSeries(points: SignalMetricPointV1[]) {
  const values = points.map((point) => point.value).filter((value): value is number => value != null);
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) : null;
}

async function safeConversationWindow(
  workspace: ResolvedSignalWorkspace,
  filter: SignalFilterV1,
  readScope?: SignalOperationalReadScopeV1
): Promise<BrandMonitoringConversationWindow> {
  try {
    return await loadConversationWindow(workspace, filter, readScope);
  } catch (error) {
    return {
      state: "not_available",
      reason: errorMessage(error),
      points: [],
      summary: emptyConversationSummary(),
      attention: emptyAttention()
    };
  }
}

async function loadConversationWindow(
  workspace: ResolvedSignalWorkspace,
  filter: SignalFilterV1,
  readScope?: SignalOperationalReadScopeV1
): Promise<BrandMonitoringConversationWindow> {
  const scope = requireSignalOperationalReadScopeV1(workspace, readScope);
  const predicate = buildSignalOperationalMentionReadPredicateV1(scope, filter);
  const timezoneParameter = `$${predicate.params.length + 1}`;
  const startParameter = `$${predicate.params.length + 2}`;
  const endParameter = `$${predicate.params.length + 3}`;
  const bucket = signalDateBucketSql(filter.granularity, timezoneParameter);
  const periodStart = signalPeriodStartSql(filter.granularity, startParameter);
  const periodEnd = signalPeriodStartSql(filter.granularity, endParameter);
  const periodStep = filter.granularity === "day"
    ? "1 day"
    : filter.granularity === "week"
      ? "1 week"
      : "1 month";
  const interactions = interactionTotalSql();
  const views = safeNumericSql(
    "COALESCE(NULLIF(m.raw_metadata->'row'->>'views', ''), NULLIF(m.engagement->>'views', ''))"
  );

  const result = await pool.query<{
    period_start: string;
    mentions: string | number;
    conversations: string | number;
    root_posts: string | number;
    comments: string | number;
    positive: string | number;
    neutral: string | number;
    negative: string | number;
    classified: string | number;
    total_mentions: string | number;
    total_conversations: string | number;
    total_root_posts: string | number;
    total_comments: string | number;
    total_classified: string | number;
    total_interactions: string | number;
    median_interactions: string | number;
    p90_interactions: string | number;
    active_root_posts: string | number;
    total_views: string | number;
    viewed_root_posts: string | number;
  }>(`
    WITH scoped AS (
      SELECT
        m.id,
        ${bucket} AS period_start,
        COALESCE(NULLIF(m.raw_metadata->'row'->>'thread id', ''), m.id::text) AS thread_key,
        lower(COALESCE(NULLIF(m.content_type, ''), NULLIF(m.raw_metadata->'row'->>'specific type', ''), 'unknown')) = 'comment' AS is_comment,
        CASE
          WHEN m.sentiment_score > 0.2 THEN 'positive'
          WHEN m.sentiment_score < -0.2 THEN 'negative'
          WHEN m.sentiment_score IS NULL THEN NULL
          ELSE 'neutral'
        END AS sentiment,
        ${interactions} AS interactions,
        ${views} AS views
      FROM mentions m
      WHERE ${predicate.sql}
    ),
    periods AS (
      SELECT generate_series(
        ${periodStart},
        ${periodEnd},
        interval '${periodStep}'
      )::date AS period_start
    ),
    period_metrics AS (
      SELECT
        period_start,
        count(*)::int AS mentions,
        count(DISTINCT thread_key)::int AS conversations,
        count(*) FILTER (WHERE NOT is_comment)::int AS root_posts,
        count(*) FILTER (WHERE is_comment)::int AS comments,
        count(*) FILTER (WHERE sentiment = 'positive')::int AS positive,
        count(*) FILTER (WHERE sentiment = 'neutral')::int AS neutral,
        count(*) FILTER (WHERE sentiment = 'negative')::int AS negative,
        count(*) FILTER (WHERE sentiment IS NOT NULL)::int AS classified
      FROM scoped
      GROUP BY period_start
    ),
    window_metrics AS (
      SELECT
        count(*)::int AS total_mentions,
        count(DISTINCT thread_key)::int AS total_conversations,
        count(*) FILTER (WHERE NOT is_comment)::int AS total_root_posts,
        count(*) FILTER (WHERE is_comment)::int AS total_comments,
        count(*) FILTER (WHERE sentiment IS NOT NULL)::int AS total_classified,
        COALESCE(sum(interactions) FILTER (WHERE NOT is_comment), 0)::float8 AS total_interactions,
        COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY interactions) FILTER (WHERE NOT is_comment), 0)::float8 AS median_interactions,
        COALESCE(percentile_cont(0.9) WITHIN GROUP (ORDER BY interactions) FILTER (WHERE NOT is_comment), 0)::float8 AS p90_interactions,
        count(*) FILTER (WHERE NOT is_comment AND interactions > 0)::int AS active_root_posts,
        COALESCE(sum(views) FILTER (WHERE NOT is_comment), 0)::float8 AS total_views,
        count(*) FILTER (WHERE NOT is_comment AND views > 0)::int AS viewed_root_posts
      FROM scoped
    )
    SELECT
      periods.period_start::text,
      COALESCE(period_metrics.mentions, 0)::int AS mentions,
      COALESCE(period_metrics.conversations, 0)::int AS conversations,
      COALESCE(period_metrics.root_posts, 0)::int AS root_posts,
      COALESCE(period_metrics.comments, 0)::int AS comments,
      COALESCE(period_metrics.positive, 0)::int AS positive,
      COALESCE(period_metrics.neutral, 0)::int AS neutral,
      COALESCE(period_metrics.negative, 0)::int AS negative,
      COALESCE(period_metrics.classified, 0)::int AS classified,
      window_metrics.*
    FROM periods
    LEFT JOIN period_metrics USING (period_start)
    CROSS JOIN window_metrics
    ORDER BY periods.period_start
  `, [
    ...predicate.params,
    filter.timezone,
    filter.date_range.start,
    filter.date_range.end
  ]);

  const first = result.rows[0];
  const summary = first
    ? {
        mentions: numberValue(first.total_mentions),
        conversations: numberValue(first.total_conversations),
        root_posts: numberValue(first.total_root_posts),
        comments: numberValue(first.total_comments),
        classified_sentiment: numberValue(first.total_classified)
      }
    : emptyConversationSummary();
  const rootPosts = summary.root_posts;
  const attention = first
    ? {
        root_posts: rootPosts,
        total_interactions: numberValue(first.total_interactions),
        median_interactions: numberValue(first.median_interactions),
        p90_interactions: numberValue(first.p90_interactions),
        active_root_posts: numberValue(first.active_root_posts),
        active_ratio: rootPosts > 0 ? numberValue(first.active_root_posts) / rootPosts : null,
        total_views: numberValue(first.total_views),
        viewed_root_posts: numberValue(first.viewed_root_posts)
      }
    : emptyAttention();

  return {
    state: "fresh",
    reason: null,
    summary,
    attention,
    points: result.rows.map((row) => ({
      period_start: row.period_start,
      mentions: numberValue(row.mentions),
      conversations: numberValue(row.conversations),
      root_posts: numberValue(row.root_posts),
      comments: numberValue(row.comments),
      sentiment: {
        positive: numberValue(row.positive),
        neutral: numberValue(row.neutral),
        negative: numberValue(row.negative),
        classified: numberValue(row.classified)
      }
    }))
  };
}

async function safeConversationDrivers(
  workspace: ResolvedSignalWorkspace,
  filter: SignalFilterV1,
  readScope?: SignalOperationalReadScopeV1,
  evidenceReadScope?: SignalOperationalReadScopeV1
): Promise<SignalBrandMonitoringV1["conversation_drivers"]> {
  try {
    return {
      state: "fresh",
      reason: null,
      items: await loadConversationDrivers(
        workspace,
        filter,
        readScope,
        evidenceReadScope
      )
    };
  } catch (error) {
    return {
      state: "not_available",
      reason: errorMessage(error),
      items: []
    };
  }
}

async function loadConversationDrivers(
  workspace: ResolvedSignalWorkspace,
  filter: SignalFilterV1,
  readScope?: SignalOperationalReadScopeV1,
  evidenceReadScope?: SignalOperationalReadScopeV1
): Promise<BrandMonitoringThreadDriver[]> {
  const scope = requireSignalOperationalReadScopeV1(workspace, readScope);
  const predicate = buildSignalOperationalMentionReadPredicateV1(scope, filter);
  const evidencePredicate = evidenceReadScope
    ? buildSignalOperationalMentionReadPredicateV1(
        requireSignalOperationalReadScopeV1(workspace, evidenceReadScope),
        filter
      )
    : null;
  const evidenceSql = evidencePredicate
    ? rebasePredicateParameters(
        evidencePredicate.sql.replace(/\bm\./gu, "evidence_mention."),
        predicate.params.length
      )
    : null;
  const queryParams = [
    ...predicate.params,
    ...(evidencePredicate?.params ?? [])
  ];
  const limitParameter = `$${queryParams.length + 1}`;
  const interactions = interactionTotalSql();
  const views = safeNumericSql(
    "COALESCE(NULLIF(m.raw_metadata->'row'->>'views', ''), NULLIF(m.engagement->>'views', ''))"
  );
  const result = await pool.query<{
    id: string;
    title: string | null;
    text: string;
    url: string | null;
    platform: string;
    mention_count: string | number;
    root_post_count: string | number;
    comment_count: string | number;
    interaction_count: string | number;
    view_count: string | number;
  }>(`
    WITH scoped AS (
      SELECT
        m.id,
        m.published_at,
        m.title,
        COALESCE(NULLIF(m.text_snippet, ''), left(m.text_clean, 420), '') AS text,
        m.url,
        COALESCE(NULLIF(m.resolved_platform, ''), NULLIF(m.platform, ''), 'unknown') AS platform,
        COALESCE(NULLIF(m.raw_metadata->'row'->>'thread id', ''), m.id::text) AS thread_key,
        lower(COALESCE(NULLIF(m.content_type, ''), NULLIF(m.raw_metadata->'row'->>'specific type', ''), 'unknown')) = 'comment' AS is_comment,
        ${interactions} AS interactions,
        ${views} AS views
      FROM mentions m
      WHERE ${predicate.sql}
    ),
    evidence_scoped AS (
      SELECT scoped.*
      FROM scoped
      ${evidenceSql
        ? "JOIN mentions evidence_mention ON evidence_mention.id = scoped.id"
        : ""}
      WHERE ${evidenceSql ?? "true"}
    ),
    summaries AS (
      SELECT
        thread_key,
        count(*)::int AS mention_count,
        count(*) FILTER (WHERE NOT is_comment)::int AS root_post_count,
        count(*) FILTER (WHERE is_comment)::int AS comment_count,
        COALESCE(sum(interactions) FILTER (WHERE NOT is_comment), 0)::float8 AS interaction_count,
        COALESCE(sum(views) FILTER (WHERE NOT is_comment), 0)::float8 AS view_count
      FROM scoped
      GROUP BY thread_key
    ),
    representatives AS (
      SELECT DISTINCT ON (thread_key)
        thread_key,
        id::text,
        title,
        text,
        url,
        platform
      FROM evidence_scoped
      ORDER BY thread_key, is_comment, published_at, id
    )
    SELECT
      representatives.id,
      representatives.title,
      representatives.text,
      representatives.url,
      representatives.platform,
      summaries.mention_count,
      summaries.root_post_count,
      summaries.comment_count,
      summaries.interaction_count,
      summaries.view_count
    FROM summaries
    JOIN representatives USING (thread_key)
    ORDER BY summaries.mention_count DESC, summaries.comment_count DESC, representatives.id
    LIMIT ${limitParameter}::int
  `, [...queryParams, 6]);

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    text: row.text,
    url: row.url,
    platform: row.platform,
    mention_count: numberValue(row.mention_count),
    root_post_count: numberValue(row.root_post_count),
    comment_count: numberValue(row.comment_count),
    interaction_count: numberValue(row.interaction_count),
    view_count: numberValue(row.view_count)
  }));
}

async function loadConversationHighlights(
  workspace: ResolvedSignalWorkspace,
  filter: SignalFilterV1,
  readScope?: SignalOperationalReadScopeV1,
  evidenceReadScope?: SignalOperationalReadScopeV1
): Promise<SignalBrandMonitoringV1["highlights"]> {
  const scope = requireSignalOperationalReadScopeV1(workspace, readScope);
  const predicate = buildSignalOperationalMentionReadPredicateV1(scope, filter);
  const evidencePredicate = evidenceReadScope
    ? buildSignalOperationalMentionReadPredicateV1(
        requireSignalOperationalReadScopeV1(workspace, evidenceReadScope),
        filter
      )
    : null;
  const evidenceSql = evidencePredicate
    ? rebasePredicateParameters(evidencePredicate.sql, predicate.params.length)
    : null;

  const result = await pool.query<{
    id: string;
    occurred_at: Date;
    title: string | null;
    text: string;
    url: string | null;
    platform: string | null;
    sentiment: string | number;
    engagement: Record<string, unknown> | null;
  }>(`
    SELECT id::text,
      published_at AS occurred_at,
      title,
      COALESCE(NULLIF(text_snippet, ''), left(text_clean, 420)) AS text,
      url,
      COALESCE(NULLIF(resolved_platform, ''), platform, 'unknown') AS platform,
      sentiment_score AS sentiment,
      engagement
    FROM mentions m
    WHERE ${predicate.sql}
      ${evidenceSql ? `AND (${evidenceSql})` : ""}
      AND sentiment_score IS NOT NULL
    ORDER BY published_at DESC, id
    LIMIT 500
  `, [...predicate.params, ...(evidencePredicate?.params ?? [])]);

  const mapped = result.rows.map((row) => {
    const sentiment = Number(row.sentiment);
    const engagement = engagementTotal(row.engagement);
    const reach = engagementValue(row.engagement, "reach");
    return {
      id: row.id,
      occurred_at: row.occurred_at.toISOString(),
      title: row.title,
      text: row.text,
      url: row.url,
      platform: row.platform ?? "unknown",
      sentiment,
      engagement,
      reach,
      explanation: highlightExplanation(sentiment, engagement, reach),
      ranking: engagement + Math.abs(sentiment) * 10 + (reach ?? 0) * 0.001
    };
  });

  const ranked = (polarity: "positive" | "negative") => mapped
    .filter((item) => polarity === "positive" ? item.sentiment > 0.2 : item.sentiment < -0.2)
    .sort((a, b) => b.ranking - a.ranking || b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, 3)
    .map((item) => ({
      id: item.id,
      occurred_at: item.occurred_at,
      title: item.title,
      text: item.text,
      url: item.url,
      platform: item.platform,
      sentiment: item.sentiment,
      engagement: item.engagement,
      reach: item.reach,
      explanation: item.explanation
    }));

  return { positive: ranked("positive"), negative: ranked("negative") };
}

async function loadMonthlyInsights(
  workspace: ResolvedSignalWorkspace,
  coverage: SignalBrandMonitoringV1["coverage"],
  options: {
    includeAllCandidates?: boolean;
    loadEditorial?: boolean;
  } = {},
  readScope?: SignalOperationalReadScopeV1,
  evidenceReadScope?: SignalOperationalReadScopeV1 | null
): Promise<BrandMonitoringMonthlyInsights> {
  const scope = requireSignalOperationalReadScopeV1(workspace, readScope);
  const windows = monthlyInsightWindows(coverage, workspace.timezone);
  if (!windows) {
    return {
      contract_version: "signal-monthly-insights-v1",
      candidate_hash: null,
      cadence: "rolling_30_days",
      independent_of_page_filter: true,
      window: null,
      comparison_window: null,
      calculated_through: coverage.date_through,
      context: await loadMonthlyInsightContext(workspace, scope),
      interpretation_state: "not_available",
      items: []
    };
  }

  const [current, previous, drivers, previousDrivers, platforms, previousPlatforms, context] = await Promise.all([
    safeConversationWindow(workspace, windows.current, scope),
    windows.previous
      ? safeConversationWindow(workspace, windows.previous, scope)
      : Promise.resolve<BrandMonitoringConversationWindow | null>(null),
    evidenceReadScope === null
      ? Promise.resolve({
          state: "not_available" as const,
          reason: "mentions_capability_not_available",
          items: []
        })
      : safeConversationDrivers(workspace, windows.current, scope, evidenceReadScope),
    windows.previous
      ? evidenceReadScope === null
        ? Promise.resolve({
            state: "not_available" as const,
            reason: "mentions_capability_not_available",
            items: []
          })
        : safeConversationDrivers(workspace, windows.previous, scope, evidenceReadScope)
      : Promise.resolve({ state: "not_available" as const, reason: "comparison_unavailable", items: [] }),
    loadMonthlyPlatformMix(workspace, windows.current, scope),
    windows.previous
      ? loadMonthlyPlatformMix(workspace, windows.previous, scope)
      : Promise.resolve([]),
    loadMonthlyInsightContext(workspace, scope)
  ]);
  const candidates = buildMonthlyInsightCandidates({
    current,
    previous,
    drivers: drivers.items,
    previousDrivers: previousDrivers.items,
    platforms,
    previousPlatforms
  })
    .sort((left, right) => right.rank - left.rank || left.id.localeCompare(right.id))
    .slice(0, 7);
  const candidateHash = signalMonthlyInsightCandidateHashV1({
    window: windows.current.date_range,
    comparison_window: windows.previous?.date_range ?? null,
    context,
    items: candidates.map((candidate) => {
      const { editorial, ...hashCandidate } = candidate;
      void editorial;
      return hashCandidate;
    })
  });
  const editorial = options.loadEditorial === false
    ? null
    : await loadMonthlyInsightEditorial({
        workspace,
        readScope: scope,
        filter: windows.current,
        candidate_hash: candidateHash,
        candidate_ids: candidates.map((item) => item.id)
      });
  const editorialByCandidate = new Map(
    editorial?.items.map((item) => [item.candidate_id, item]) ?? []
  );
  const selectedIds = editorial
    ? new Set(editorial.items.map((item) => item.candidate_id))
    : null;
  const items = [...candidates]
    .filter((item) => options.includeAllCandidates || (
      selectedIds ? selectedIds.has(item.id) : isDeterministicallyUsefulMonthlyInsight(item)
    ))
    .map((item) => {
      const copy = editorialByCandidate.get(item.id);
      if (!copy) return item;
      return {
        ...item,
        rank: 1_000 - copy.priority,
        editorial: {
          state: "claude" as const,
          short_title: copy.short_title,
          headline: null,
          explanation: copy.explanation,
          why_it_matters: copy.why_it_matters,
          confidence: copy.confidence,
          limitations: copy.limitations
        }
      };
    })
    .sort((left, right) => right.rank - left.rank || left.id.localeCompare(right.id));

  return {
    contract_version: "signal-monthly-insights-v1",
    candidate_hash: candidateHash,
    cadence: "rolling_30_days",
    independent_of_page_filter: true,
    window: {
      start: windows.current.date_range.start,
      end: windows.current.date_range.end,
      days: inclusiveDays(
        windows.current.date_range.start,
        windows.current.date_range.end
      )
    },
    comparison_window: windows.previous
      ? {
          start: windows.previous.date_range.start,
          end: windows.previous.date_range.end,
          days: inclusiveDays(
            windows.previous.date_range.start,
            windows.previous.date_range.end
          )
        }
      : null,
    calculated_through: windows.current.date_range.end,
    context,
    interpretation_state: editorial
      ? "claude"
      : items.length > 0
        ? "deterministic"
        : "not_available",
    items
  };
}

async function loadMonthlyInsightEditorial(input: {
  workspace: ResolvedSignalWorkspace;
  readScope: SignalOperationalReadScopeV1;
  filter: SignalFilterV1;
  candidate_hash: string;
  candidate_ids: string[];
}) {
  if (input.candidate_ids.length === 0) return null;
  const scopePredicate = input.readScope.visibleSource === "governed_population"
    ? "interpretation.data_scope->>'population_id' = $2::text"
    : "interpretation.study_corpus_id = $2::uuid";
  const scopeId = input.readScope.visibleSource === "governed_population"
    ? input.readScope.population?.id
    : input.readScope.legacyCorpus?.id;
  if (!scopeId) return null;
  try {
    const result = await pool.query<{ content: unknown }>(`
      SELECT interpretation.content
      FROM metric_interpretations interpretation
      WHERE interpretation.workspace_id = $1::uuid
        AND ${scopePredicate}
        AND interpretation.metric_group_key = $3
        AND interpretation.filters_hash = $4
        AND interpretation.status = 'fresh'
        AND interpretation.review_status IN ('auto_published', 'approved')
        AND interpretation.generated_by = 'claude'
      ORDER BY interpretation.revision DESC, interpretation.created_at DESC
      LIMIT 1
    `, [
      input.workspace.id,
      scopeId,
      SIGNAL_MONTHLY_INSIGHT_METRIC_GROUP_KEY,
      signalFiltersHashV1(input.filter)
    ]);
    if (!result.rows[0]) return null;
    return validateSignalMonthlyInsightEditorialV1(result.rows[0].content, {
      candidate_hash: input.candidate_hash,
      candidate_ids: input.candidate_ids
    });
  } catch {
    return null;
  }
}

function buildMonthlyInsightCandidates(input: {
  current: BrandMonitoringConversationWindow;
  previous: BrandMonitoringConversationWindow | null;
  drivers: BrandMonitoringThreadDriver[];
  previousDrivers: BrandMonitoringThreadDriver[];
  platforms: Array<{ key: string; value: number }>;
  previousPlatforms: Array<{ key: string; value: number }>;
}) {
  const items: BrandMonitoringMonthlyInsight[] = [];
  const currentSummary = input.current.summary;
  const previousSummary = input.previous?.summary ?? null;
  const currentVolume = currentSummary.mentions;
  const previousVolume = previousSummary?.mentions ?? null;
  const volumeDelta = nullableDelta(currentVolume, previousVolume);
  const volumeDeltaRatio = nullableRatioDelta(currentVolume, previousVolume);

  if (input.current.points.length > 0) {
    items.push({
      id: "monthly-volume-momentum",
      kind: "volume_momentum",
      tone: ratioTone(volumeDeltaRatio),
      rank: 100 + Math.min(Math.abs(volumeDeltaRatio ?? 0), 5),
      metric: {
        current: currentVolume,
        previous: previousVolume,
        delta: volumeDelta,
        delta_ratio: volumeDeltaRatio,
        unit: "count"
      },
      chart: {
        type: "line",
        current: input.current.points.map((point) => ({
          period_start: point.period_start,
          value: point.mentions
        })),
        previous: input.previous?.points.map((point) => ({
          period_start: point.period_start,
          value: point.mentions
        })) ?? []
      },
      evidence: {
        mention_ids: [],
        evidence_count: currentVolume
      },
      editorial: emptyMonthlyEditorial()
    });
  }

  const topDrivers = input.drivers.slice(0, 5);
  const topThreeVolume = topDrivers
    .slice(0, 3)
    .reduce((sum, driver) => sum + driver.mention_count, 0);
  const previousTopThreeVolume = input.previousDrivers
    .slice(0, 3)
    .reduce((sum, driver) => sum + driver.mention_count, 0);
  if (currentVolume > 0 && topDrivers.length > 0) {
    const concentration = topThreeVolume / currentVolume;
    const previousConcentration = previousSummary && previousSummary.mentions > 0
      ? previousTopThreeVolume / previousSummary.mentions
      : null;
    items.push({
      id: "monthly-conversation-concentration",
      kind: "conversation_concentration",
      tone: concentration >= 0.5 ? "attention" : "neutral",
      rank: 90 + concentration,
      metric: {
        current: concentration,
        previous: previousConcentration,
        delta: previousConcentration == null ? null : concentration - previousConcentration,
        delta_ratio: nullableRatioDelta(concentration, previousConcentration),
        unit: "ratio"
      },
      chart: {
        type: "bar",
        items: topDrivers.map((driver) => ({
          key: compactDriverLabel(driver),
          value: driver.mention_count,
          secondary_value: driver.comment_count
        }))
      },
      evidence: {
        mention_ids: topDrivers.map((driver) => driver.id),
        evidence_count: topThreeVolume
      },
      editorial: emptyMonthlyEditorial()
    });
  }

  if (currentSummary.mentions > 0) {
    const currentDepth = currentSummary.comments / currentSummary.mentions;
    const previousDepth = previousSummary && previousSummary.mentions > 0
      ? previousSummary.comments / previousSummary.mentions
      : null;
    items.push({
      id: "monthly-conversation-depth",
      kind: "conversation_depth",
      tone: currentDepth >= 0.6 ? "attention" : "neutral",
      rank: 50 + Math.abs(currentDepth - (previousDepth ?? currentDepth)),
      metric: {
        current: currentDepth,
        previous: previousDepth,
        delta: previousDepth == null ? null : currentDepth - previousDepth,
        delta_ratio: nullableRatioDelta(currentDepth, previousDepth),
        unit: "ratio"
      },
      chart: {
        type: "comparison",
        items: [
          {
            key: "root_posts",
            current: currentSummary.root_posts,
            previous: previousSummary?.root_posts ?? null
          },
          {
            key: "comments",
            current: currentSummary.comments,
            previous: previousSummary?.comments ?? null
          }
        ]
      },
      evidence: {
        mention_ids: [],
        evidence_count: currentSummary.mentions
      },
      editorial: emptyMonthlyEditorial()
    });
  }

  const sentiment = sentimentTotals(input.current.points);
  const previousSentiment = input.previous ? sentimentTotals(input.previous.points) : null;
  if (sentiment.classified > 0) {
    const currentBalance = (sentiment.positive - sentiment.negative) / sentiment.classified;
    const previousBalance = previousSentiment && previousSentiment.classified > 0
      ? (previousSentiment.positive - previousSentiment.negative) / previousSentiment.classified
      : null;
    items.push({
      id: "monthly-sentiment-balance",
      kind: "sentiment_balance",
      tone: currentBalance > 0.1 ? "positive" : currentBalance < -0.1 ? "negative" : "neutral",
      rank: 80 + Math.abs(currentBalance),
      metric: {
        current: currentBalance,
        previous: previousBalance,
        delta: previousBalance == null ? null : currentBalance - previousBalance,
        delta_ratio: null,
        unit: "ratio"
      },
      chart: {
        type: "donut",
        items: sentimentItems(sentiment),
        previous_items: previousSentiment ? sentimentItems(previousSentiment) : []
      },
      evidence: {
        mention_ids: [],
        evidence_count: sentiment.classified
      },
      editorial: emptyMonthlyEditorial()
    });
  }

  const platformTotal = input.platforms.reduce((sum, platform) => sum + platform.value, 0);
  const previousPlatformTotal = input.previousPlatforms.reduce((sum, platform) => sum + platform.value, 0);
  if (
    platformTotal >= 10
    && previousPlatformTotal >= 10
    && input.platforms.length > 0
    && input.previousPlatforms.length > 0
  ) {
    const previousShares = new Map(
      input.previousPlatforms.map((platform) => [platform.key, platform.value / previousPlatformTotal])
    );
    const shifted = input.platforms
      .map((platform) => ({
        key: platform.key,
        current: platform.value / platformTotal,
        previous: previousShares.get(platform.key) ?? 0
      }))
      .sort((left, right) =>
        Math.abs(right.current - right.previous) - Math.abs(left.current - left.previous)
      );
    const leader = shifted[0]!;
    const leaderDelta = leader.current - leader.previous;
    if (Math.abs(leaderDelta) >= 0.08) {
    items.push({
      id: "monthly-platform-concentration",
      kind: "platform_concentration",
      tone: "attention",
      rank: 60 + Math.abs(leaderDelta),
      metric: {
        current: leader.current,
        previous: leader.previous,
        delta: leaderDelta,
        delta_ratio: nullableRatioDelta(leader.current, leader.previous),
        unit: "ratio"
      },
      chart: {
        type: "comparison",
        items: shifted.slice(0, 5).map((platform) => ({
          key: platform.key,
          current: platform.current,
          previous: platform.previous
        }))
      },
      evidence: {
        mention_ids: [],
        evidence_count: platformTotal
      },
      editorial: emptyMonthlyEditorial()
    });
    }
  }

  if (input.current.attention.root_posts > 0) {
    const currentAttention = input.current.attention.total_interactions;
    const previousAttention = input.previous?.attention.total_interactions ?? null;
    const attentionDelta = nullableDelta(currentAttention, previousAttention);
    const attentionDeltaRatio = nullableRatioDelta(currentAttention, previousAttention);
    items.push({
      id: "monthly-attention-momentum",
      kind: "attention_momentum",
      tone: ratioTone(attentionDeltaRatio),
      rank: 70 + Math.min(Math.abs(attentionDeltaRatio ?? 0), 5),
      metric: {
        current: currentAttention,
        previous: previousAttention,
        delta: attentionDelta,
        delta_ratio: attentionDeltaRatio,
        unit: "count"
      },
      chart: {
        type: "comparison",
        items: [
          {
            key: "root_posts",
            current: input.current.attention.root_posts,
            previous: input.previous?.attention.root_posts ?? null
          },
          {
            key: "active_share",
            current: input.current.attention.active_ratio ?? 0,
            previous: input.previous?.attention.active_ratio ?? null
          },
          {
            key: "interactions_per_active_post",
            current: input.current.attention.active_root_posts > 0
              ? currentAttention / input.current.attention.active_root_posts
              : 0,
            previous: input.previous && input.previous.attention.active_root_posts > 0
              ? input.previous.attention.total_interactions / input.previous.attention.active_root_posts
              : null
          }
        ]
      },
      evidence: {
        mention_ids: [],
        evidence_count: input.current.attention.root_posts
      },
      editorial: emptyMonthlyEditorial()
    });
  }

  return items;
}

function isDeterministicallyUsefulMonthlyInsight(item: BrandMonitoringMonthlyInsight) {
  if (item.kind === "sentiment_balance" || item.kind === "platform_concentration") return false;
  if (item.kind === "volume_momentum" || item.kind === "attention_momentum") {
    return item.metric.previous != null && Math.abs(item.metric.delta_ratio ?? 0) >= 0.12;
  }
  if (item.kind === "conversation_concentration") {
    return item.metric.current >= 0.25
      || Math.abs(item.metric.delta ?? 0) >= 0.08;
  }
  if (item.kind === "conversation_depth") {
    return item.metric.previous != null
      && Math.abs(item.metric.delta_ratio ?? 0) >= 0.15;
  }
  return false;
}

async function loadMonthlyPlatformMix(
  workspace: ResolvedSignalWorkspace,
  filter: SignalFilterV1,
  readScope?: SignalOperationalReadScopeV1
) {
  const scope = requireSignalOperationalReadScopeV1(workspace, readScope);
  const predicate = buildSignalOperationalMentionReadPredicateV1(scope, filter);
  const result = await pool.query<{ key: string; value: string | number }>(`
    SELECT
      COALESCE(NULLIF(m.resolved_platform, ''), NULLIF(m.platform, ''), 'unknown') AS key,
      count(*)::int AS value
    FROM mentions m
    WHERE ${predicate.sql}
    GROUP BY 1
    ORDER BY count(*) DESC, 1
    LIMIT 7
  `, predicate.params);
  return result.rows.map((row) => ({
    key: row.key,
    value: numberValue(row.value)
  }));
}

async function loadMonthlyInsightContext(
  workspace: ResolvedSignalWorkspace,
  readScope?: SignalOperationalReadScopeV1
): Promise<BrandMonitoringMonthlyInsights["context"]> {
  const scope = requireSignalOperationalReadScopeV1(workspace, readScope);
  const corpusId = scope.legacyCorpus?.id ?? null;
  const briefScopeSql = scope.visibleSource === "governed_population"
    ? ""
    : "AND brief.study_corpus_id = $2::uuid";
  const assertionCorpusSql = scope.visibleSource === "governed_population"
    ? "false"
    : "(link.target_type = 'study_corpus' AND link.target_id = $2::uuid)";
  const subjectColumn = workspace.subject.type === "brand" ? "brand_id" : "theme_id";
  try {
    const result = await pool.query<{
      objectives: string | number;
      briefs: string | number;
      audiences: string | number;
      approved_assertions: string | number;
    }>(`
      WITH profiles AS (
        SELECT id
        FROM brand_os_profiles
        WHERE ${subjectColumn} = $1::uuid
          AND status = 'active'
      ),
      briefs AS (
        SELECT brief.id, brief.objective_id, brief.knowledge_source_id
        FROM brand_os_briefs brief
        WHERE brief.brand_os_profile_id IN (SELECT id FROM profiles)
          ${briefScopeSql}
          AND brief.status = 'active'
      ),
      relevant_assertions AS (
        SELECT DISTINCT assertion.id
        FROM knowledge_assertions assertion
        JOIN knowledge_assertion_links link
          ON link.knowledge_assertion_id = assertion.id
        WHERE assertion.status IN ('accepted', 'approved', 'active')
          AND (
            ${assertionCorpusSql}
            OR (link.target_type = 'brand_os_brief' AND link.target_id IN (SELECT id FROM briefs))
            OR (link.target_type = 'brand_os_objective' AND link.target_id IN (
              SELECT objective_id FROM briefs WHERE objective_id IS NOT NULL
            ))
          )
      )
      SELECT
        (SELECT count(*)::int FROM brand_os_objectives objective
          WHERE objective.brand_os_profile_id IN (SELECT id FROM profiles)
            AND objective.status = 'active') AS objectives,
        (SELECT count(*)::int FROM briefs) AS briefs,
        (SELECT count(*)::int FROM brand_os_audiences audience
          WHERE audience.brand_os_profile_id IN (SELECT id FROM profiles)
            AND audience.status = 'active') AS audiences,
        (SELECT count(*)::int FROM relevant_assertions) AS approved_assertions
    `, [workspace.subject.id, corpusId]);
    const row = result.rows[0];
    const context = {
      objectives: numberValue(row?.objectives),
      briefs: numberValue(row?.briefs),
      audiences: numberValue(row?.audiences),
      approved_assertions: numberValue(row?.approved_assertions)
    };
    return {
      state: context.objectives > 0 && context.briefs > 0 ? "ready" : "partial",
      ...context
    };
  } catch {
    return {
      state: "not_available",
      objectives: 0,
      briefs: 0,
      audiences: 0,
      approved_assertions: 0
    };
  }
}

function monthlyInsightWindows(
  coverage: SignalBrandMonitoringV1["coverage"],
  timezone: string
): { current: SignalFilterV1; previous: SignalFilterV1 | null } | null {
  if (!coverage.date_from || !coverage.date_through) return null;
  const currentStart = maxIsoDate(coverage.date_from, shiftIsoDate(coverage.date_through, -29));
  const current: SignalFilterV1 = {
    contract_version: "signal-backend-v1",
    date_range: { start: currentStart, end: coverage.date_through },
    timezone,
    granularity: "day",
    dimensions: {}
  };
  const days = inclusiveDays(currentStart, coverage.date_through);
  const previousEnd = shiftIsoDate(currentStart, -1);
  const previousStart = shiftIsoDate(previousEnd, -(days - 1));
  const previous = previousStart >= coverage.date_from
    ? {
        ...current,
        date_range: { start: previousStart, end: previousEnd }
      }
    : null;
  return { current, previous };
}

function emptyMonthlyEditorial(): BrandMonitoringMonthlyInsight["editorial"] {
  return {
    state: "deterministic",
    short_title: null,
    headline: null,
    explanation: null,
    why_it_matters: null,
    confidence: null,
    limitations: []
  };
}

function sentimentTotals(points: BrandMonitoringConversationPoint[]) {
  return points.reduce((total, point) => ({
    positive: total.positive + point.sentiment.positive,
    neutral: total.neutral + point.sentiment.neutral,
    negative: total.negative + point.sentiment.negative,
    classified: total.classified + point.sentiment.classified
  }), { positive: 0, neutral: 0, negative: 0, classified: 0 });
}

function sentimentItems(input: ReturnType<typeof sentimentTotals>) {
  return (["positive", "neutral", "negative"] as const).map((key) => ({
    key,
    value: input[key]
  }));
}

function compactDriverLabel(driver: BrandMonitoringThreadDriver) {
  const title = driver.title?.replace(/\s+/gu, " ").trim() ?? "";
  const text = driver.text.replace(/\s+/gu, " ").trim();
  const value = isMeaningfulDriverLabel(title)
    ? title
    : isMeaningfulDriverLabel(text)
      ? text
      : `${driver.platform} conversation`;
  return value.length > 58 ? `${value.slice(0, 57).trimEnd()}…` : value;
}

function isMeaningfulDriverLabel(value: string) {
  return (value.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 6;
}

function nullableDelta(current: number, previous: number | null) {
  return previous == null ? null : current - previous;
}

function nullableRatioDelta(current: number, previous: number | null) {
  return previous == null || previous === 0 ? null : (current - previous) / previous;
}

function ratioTone(value: number | null): BrandMonitoringMonthlyInsightTone {
  if (value == null || value === 0) return "neutral";
  return value > 0 ? "positive" : "negative";
}

function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function inclusiveDays(start: string, end: string) {
  const startMs = new Date(`${start}T12:00:00Z`).getTime();
  const endMs = new Date(`${end}T12:00:00Z`).getTime();
  return Math.round((endMs - startMs) / 86_400_000) + 1;
}

function maxIsoDate(left: string, right: string) {
  return left > right ? left : right;
}

function engagementTotal(value: Record<string, unknown> | null) {
  return ["likes", "comments", "shares", "reposts", "saves", "engagement"]
    .map((key) => engagementValue(value, key) ?? 0)
    .reduce((sum, item) => sum + item, 0);
}

function engagementValue(value: Record<string, unknown> | null, key: string) {
  const parsed = Number(value?.[key]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function highlightExplanation(sentiment: number, engagement: number, reach: number | null) {
  const tone = sentiment > 0 ? "Señal positiva" : "Señal negativa";
  if (engagement > 0) return `${tone} priorizada por ${engagement.toLocaleString("es-MX")} interacciones observadas.`;
  if (reach && reach > 0) return `${tone} con alcance potencial observado, aunque sin interacción comparable.`;
  return `${tone} priorizada por intensidad y recencia; engagement no disponible.`;
}

function operationalCorpus(workspace: ResolvedSignalWorkspace) {
  return workspace.corpora.find((item) => item.role === "operational")
    ?? workspace.corpora.find((item) => item.role === "legacy");
}

function signalDateBucketSql(granularity: SignalFilterV1["granularity"], timezoneParameter: string) {
  return `date_trunc('${granularity}', m.published_at AT TIME ZONE ${timezoneParameter})::date`;
}

function signalPeriodStartSql(granularity: SignalFilterV1["granularity"], parameter: string) {
  return `date_trunc('${granularity}', ${parameter}::date)::date`;
}

function safeNumericSql(expression: string) {
  return `CASE
    WHEN replace(trim(COALESCE(${expression}, '')), ',', '') ~ '^[0-9]+(?:\\.[0-9]+)?$'
      THEN replace(trim(${expression}), ',', '')::numeric
    ELSE 0::numeric
  END`;
}

function interactionTotalSql() {
  const reportedTotal = safeNumericSql(
    "COALESCE(NULLIF(m.raw_metadata->'row'->>'total interactions', ''), NULLIF(m.raw_metadata->'row'->>'interactions', ''), NULLIF(m.engagement->>'interactions', ''))"
  );
  const observedComponents = ["likes", "comments", "shares", "reposts", "saves"]
    .map((key) => safeNumericSql(`m.engagement->>'${key}'`))
    .join(" + ");
  return `COALESCE(NULLIF(${reportedTotal}, 0), (${observedComponents}), 0::numeric)`;
}

function rebasePredicateParameters(sql: string, offset: number) {
  if (offset === 0) return sql;
  return sql.replace(/\$(\d+)/gu, (_match, rawIndex: string) => (
    `$${Number(rawIndex) + offset}`
  ));
}

function numberValue(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyConversationSummary(): BrandMonitoringConversationSummary {
  return {
    mentions: 0,
    conversations: 0,
    root_posts: 0,
    comments: 0,
    classified_sentiment: 0
  };
}

function emptyAttention(): BrandMonitoringAttention {
  return {
    root_posts: 0,
    total_interactions: 0,
    median_interactions: 0,
    p90_interactions: 0,
    active_root_posts: 0,
    active_ratio: null,
    total_views: 0,
    viewed_root_posts: 0
  };
}

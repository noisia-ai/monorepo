import {
  classifySignalPulseLifecycle,
  embedTexts,
  getEmbeddingModel,
  hasEmbeddingProvider,
  vectorLiteral
} from "@noisia/query-engine";
import { pool } from "../db/client";
import { loadAnalysisRagContext } from "./analysis-rag-context";
import {
  summarizeSignalPulseMarketingActivity,
  type SignalPulseMarketingActivityMonth,
  type SignalPulseMarketingActivityRow,
  type SignalPulseRepeatedMarketingLanguage
} from "./signal-pulse-marketing-activity";
import {
  marketingRecordSort,
  rankSignalPulseMarketingRecordsForCluster,
  type SignalPulseMarketingRecordCandidate,
  type SignalPulseMarketingRecordMatch
} from "./signal-pulse-marketing-record-match";
import { buildSignalPulsePatternFlags, type SignalPulsePatternFlag } from "./signal-pulse-pattern-flags";
import { loadSignalPulseSemanticPeriodSeriesRows } from "./signal-pulse-semantic-periods";

type SignalPulseContextScope = {
  study_corpus_id: string;
  organization_id: string | null;
  brand_id: string | null;
  analysis_plan: Record<string, unknown> | null;
  params: Record<string, unknown> | null;
};

export type SignalPulseKnowledgeMatch = {
  title: string | null;
  source_kind: string | null;
  text: string;
  similarity: number | null;
};

export type SignalPulseConversationMatch = {
  mention_id: string;
  text: string;
  platform: string;
  published_at: string | null;
  period_label: string | null;
  similarity: number | null;
};

export type SignalPulseStructuredSourceMonth = {
  month: string;
  source_type: string;
  provider: string;
  channel: string;
  records: number;
  metrics: Record<string, number>;
  entity_kinds: string[];
  objectives: string[];
  sample_entities: string[];
  sample_texts: string[];
};

export type SignalPulseStructuredSourceEvent = {
  month: string;
  source_type: string;
  provider: string;
  channel: string;
  metric: string;
  current_value: number;
  previous_value: number;
  delta_abs: number;
  delta_pct: number | null;
  direction: "up" | "down" | "flat";
};

export type SignalPulseMarketingContext = {
  marketing_brief: Record<string, unknown>;
  knowledge_sources: Array<{ type: string; content: Record<string, unknown> }>;
  source_inventory: Array<{
    source_type: string;
    provider: string;
    name: string;
    status: string;
    visibility: string;
  }>;
  performance_window: Array<{
    month: string;
    records: number;
    spend: number;
    impressions: number;
    clicks: number;
    engagement: number;
    avg_ctr: number | null;
    platforms: string[];
    channels: string[];
  }>;
  structured_source_window: SignalPulseStructuredSourceMonth[];
  marketing_activity_window: SignalPulseMarketingActivityMonth[];
  repeated_marketing_language: SignalPulseRepeatedMarketingLanguage[];
  rag: {
    semantic_available: boolean;
    embedding_model: string | null;
    retrieval_scope: string;
  };
};

export type SignalPulsePeriodSeriesPoint = {
  granularity?: "month" | "week";
  label: string;
  period_start: string;
  period_end: string;
  volume: number;
  delta_prev: number | null;
  engagement: number;
  sentiment_avg: number | null;
  source_mix: Record<string, number>;
  lifecycle_state: string;
};

export type SignalPulseWindowPattern = {
  current_period: string | null;
  current_volume: number;
  previous_volume: number;
  delta_prev: number | null;
  active_periods: number;
  first_active_period: string | null;
  last_active_period: string | null;
  peak_period: string | null;
  peak_volume: number;
  lifecycle_state: string;
};

export type SignalPulseInvestigationBrief = {
  current_cut: {
    period_label: string;
    volume: number;
    delta_prev: number | null;
    lifecycle_state: string;
    sentiment_avg: number | null;
    source_mix: Record<string, number>;
  } | null;
  window_pattern: SignalPulseWindowPattern;
  weekly_pattern: SignalPulseWindowPattern | null;
  strongest_periods: Array<{
    period_label: string;
    volume: number;
    delta_prev: number | null;
    lifecycle_state: string;
    source_mix: Record<string, number>;
  }>;
  weekly_pulses: Array<{
    period_label: string;
    volume: number;
    delta_prev: number | null;
    lifecycle_state: string;
    source_mix: Record<string, number>;
  }>;
  marketing_intersections: Array<{
    period_label: string;
    basis: string;
    campaign_count: number;
    matching_creative_count: number;
    performance_event_count: number;
    spend: number;
    impressions: number;
    engagement: number;
    top_campaigns: string[];
    top_matching_creatives: string[];
    structured_source_event_count?: number;
    top_structured_sources?: string[];
  }>;
  pattern_flags: SignalPulsePatternFlag[];
  evidence_map: {
    sample_ids: string[];
    semantic_mention_ids: string[];
    knowledge_titles: string[];
  };
  synthesis_questions: string[];
};

export type SignalPulseClusterPromptContext = {
  period_series: SignalPulsePeriodSeriesPoint[];
  weekly_series?: SignalPulsePeriodSeriesPoint[];
  window_pattern: SignalPulseWindowPattern;
  weekly_pattern?: SignalPulseWindowPattern;
  performance_context: {
    active_months: Array<SignalPulseMarketingContext["performance_window"][number]>;
    period_campaigns: Array<{
      period_label: string;
      period_start: string;
      period_end: string;
      platform: string;
      channel: string;
      entity_kind: string;
      entity_name: string | null;
      objective: string | null;
      spend: number;
      impressions: number;
      clicks: number;
      engagement: number;
      avg_ctr: number | null;
      records: number;
    }>;
    performance_events: Array<{
      month: string;
      metric: string;
      current_value: number;
      previous_value: number;
      delta_abs: number;
      delta_pct: number | null;
      direction: "up" | "down" | "flat";
    }>;
    structured_sources: SignalPulseStructuredSourceMonth[];
    structured_source_events: SignalPulseStructuredSourceEvent[];
    matching_creatives: SignalPulseMarketingRecordMatch[];
  };
  knowledge_matches: SignalPulseKnowledgeMatch[];
  conversation_matches: SignalPulseConversationMatch[];
  investigation_brief: SignalPulseInvestigationBrief;
};

export type ClusterContextInput = {
  id: string;
  term: string;
  currentTitle: string;
  mentionCount: number;
  platforms: string[];
  discoveryPeriods: string[];
  memberMentionIds: string[];
  samples: Array<{ id: string; text: string; platform: string; published_at: string | null }>;
};

export async function loadSignalPulseMarketingContext(ctx: SignalPulseContextScope): Promise<SignalPulseMarketingContext> {
  const [ragContext, sourceInventory, performanceWindow, structuredSourceWindow, marketingActivity] = await Promise.all([
    loadAnalysisRagContext(ctx.study_corpus_id, ctx.brand_id),
    loadSourceInventory(ctx.study_corpus_id),
    loadPerformanceWindow(ctx.study_corpus_id),
    loadStructuredSourceWindow(ctx.study_corpus_id),
    loadMarketingActivityWindow(ctx.study_corpus_id)
  ]);

  return {
    marketing_brief: buildMarketingBrief(ctx.analysis_plan, ctx.params),
    knowledge_sources: ragContext.knowledgeSources
      .filter((source) => source.type !== "query_strategy_brief")
      .slice(0, 10)
      .map((source) => ({ type: source.type, content: compactRecord(source.content, 900) })),
    source_inventory: sourceInventory,
    performance_window: performanceWindow,
    structured_source_window: structuredSourceWindow,
    marketing_activity_window: marketingActivity.months,
    repeated_marketing_language: marketingActivity.repeatedLanguage,
    rag: {
      semantic_available: hasEmbeddingProvider(),
      embedding_model: hasEmbeddingProvider() ? getEmbeddingModel() : null,
      retrieval_scope: "brand_knowledge_sources + structured data_sources/performance_records"
    }
  };
}

export async function loadSignalPulseClusterPromptContext(args: {
  ctx: SignalPulseContextScope;
  marketingContext: SignalPulseMarketingContext;
  cluster: ClusterContextInput;
}): Promise<SignalPulseClusterPromptContext> {
  const [periodSeries, weeklySeries, semanticMatches] = await Promise.all([
    loadClusterPeriodSeries({
      corpusId: args.ctx.study_corpus_id,
      term: args.cluster.term,
      memberMentionIds: args.cluster.memberMentionIds,
      granularity: "month"
    }),
    loadClusterPeriodSeries({
      corpusId: args.ctx.study_corpus_id,
      term: args.cluster.term,
      memberMentionIds: args.cluster.memberMentionIds,
      granularity: "week"
    }),
    retrieveSemanticMatches({
      ctx: args.ctx,
      cluster: args.cluster,
      marketingContext: args.marketingContext
    })
  ]);

  const windowPattern = summarizeWindowPattern(periodSeries);
  const weeklyPattern = summarizeWindowPattern(weeklySeries);
  const activeMonthLabels = periodSeries.filter((period) => period.volume > 0).map((period) => period.label);
  const activeMonths = new Set(activeMonthLabels);
  const structuredSourceEvents = summarizeStructuredSourceEvents(args.marketingContext.structured_source_window, activeMonthLabels);
  const activeStructuredSources = args.marketingContext.structured_source_window
    .filter((month) => activeMonths.has(month.month))
    .sort((a, b) => b.records - a.records || totalMetricValue(b.metrics) - totalMetricValue(a.metrics))
    .slice(0, 24);
  const [periodCampaigns, performanceEvents, matchingCreatives] = await Promise.all([
    loadPeriodCampaignContext({
      corpusId: args.ctx.study_corpus_id,
      periodLabels: activeMonthLabels
    }),
    Promise.resolve(summarizePerformanceEvents(args.marketingContext.performance_window, activeMonthLabels)),
    loadRelevantMarketingRecords({
      corpusId: args.ctx.study_corpus_id,
      cluster: args.cluster,
      periodLabels: activeMonthLabels,
      semanticMatches,
      marketingContext: args.marketingContext
    })
  ]);
  const investigationBrief = buildClusterInvestigationBrief({
    cluster: args.cluster,
    periodSeries,
    weeklySeries,
    windowPattern,
    weeklyPattern,
    periodCampaigns,
    performanceEvents,
    structuredSources: activeStructuredSources,
    structuredSourceEvents,
    matchingCreatives,
    semanticMatches
  });
  return {
    period_series: periodSeries,
    weekly_series: weeklySeries,
    window_pattern: windowPattern,
    weekly_pattern: weeklyPattern,
    performance_context: {
      active_months: args.marketingContext.performance_window.filter((month) => activeMonths.has(month.month)),
      period_campaigns: periodCampaigns,
      performance_events: performanceEvents,
      structured_sources: activeStructuredSources,
      structured_source_events: structuredSourceEvents,
      matching_creatives: matchingCreatives
    },
    knowledge_matches: semanticMatches.knowledge,
    conversation_matches: semanticMatches.conversation,
    investigation_brief: investigationBrief
  };
}

async function loadSourceInventory(corpusId: string) {
  const rows = (await pool.query<{
    source_type: string;
    provider: string;
    name: string;
    status: string;
    visibility: string;
  }>(
    `SELECT source_type, provider, name, status, visibility
     FROM data_sources
     WHERE study_corpus_id = $1
     ORDER BY updated_at DESC
     LIMIT 24`,
    [corpusId]
  )).rows;
  return rows.map((row) => ({
    source_type: row.source_type,
    provider: row.provider,
    name: row.name,
    status: row.status,
    visibility: row.visibility
  }));
}

async function loadPerformanceWindow(corpusId: string): Promise<SignalPulseMarketingContext["performance_window"]> {
  const rows = (await pool.query<{
    month: string;
    records: number;
    spend: string | null;
    impressions: string | null;
    clicks: string | null;
    engagement: string | null;
    avg_ctr: string | null;
    platforms: string[] | null;
    channels: string[] | null;
  }>(
    `
      SELECT
        to_char(date_trunc('month', record_date), 'YYYY-MM') AS month,
        COUNT(*)::int AS records,
        COALESCE(SUM(spend), 0)::text AS spend,
        COALESCE(SUM(impressions), 0)::text AS impressions,
        COALESCE(SUM(clicks), 0)::text AS clicks,
        COALESCE(SUM(engagement), 0)::text AS engagement,
        AVG(ctr)::text AS avg_ctr,
        array_remove(array_agg(DISTINCT platform), NULL) AS platforms,
        array_remove(array_agg(DISTINCT channel), NULL) AS channels
      FROM performance_records
      WHERE study_corpus_id = $1
      GROUP BY 1
      ORDER BY 1
      LIMIT 36
    `,
    [corpusId]
  )).rows;
  return rows.map((row) => ({
    month: row.month,
    records: Number(row.records ?? 0),
    spend: Number(row.spend ?? 0),
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    engagement: Number(row.engagement ?? 0),
    avg_ctr: numberOrNull(row.avg_ctr),
    platforms: row.platforms ?? [],
    channels: row.channels ?? []
  }));
}

async function loadStructuredSourceWindow(corpusId: string): Promise<SignalPulseStructuredSourceMonth[]> {
  const rows = (await pool.query<{
    month: string;
    source_type: string | null;
    provider: string | null;
    channel: string | null;
    records: number;
    spend: string | null;
    impressions: string | null;
    reach: string | null;
    clicks: string | null;
    video_views: string | null;
    engagement: string | null;
    conversions: string | null;
    avg_ctr: string | null;
    avg_cpm: string | null;
    avg_cpc: string | null;
    custom_metrics: Record<string, unknown> | null;
    entity_kinds: string[] | null;
    objectives: string[] | null;
    sample_entities: string[] | null;
    sample_texts: string[] | null;
  }>(
    `
      WITH base AS (
        SELECT
          to_char(date_trunc('month', pr.record_date), 'YYYY-MM') AS month,
          COALESCE(
            NULLIF(
              CASE
                WHEN ds.source_type = 'performance' AND pr.channel IN ('paid', 'organic') THEN 'social_performance'
                WHEN ds.source_type = 'performance' AND COALESCE(NULLIF(pr.channel, ''), 'unknown') NOT IN ('paid', 'organic', 'unknown') THEN pr.channel
                ELSE ds.source_type
              END,
              ''
            ),
            CASE
              WHEN pr.channel IN ('paid', 'organic') THEN 'social_performance'
              ELSE COALESCE(NULLIF(pr.channel, ''), 'performance')
            END
          ) AS source_type,
          COALESCE(NULLIF(ds.provider, ''), NULLIF(pr.platform, ''), 'unknown') AS provider,
          COALESCE(NULLIF(pr.channel, ''), 'unknown') AS channel,
          NULLIF(pr.entity_kind, '') AS entity_kind,
          NULLIF(COALESCE(pr.entity_name, pr.external_id), '') AS entity_name,
          NULLIF(pr.objective, '') AS objective,
          NULLIF(left(regexp_replace(pr.creative_text, '\\s+', ' ', 'g'), 220), '') AS creative_text,
          COALESCE(pr.spend, 0) AS spend,
          COALESCE(pr.impressions, 0) AS impressions,
          COALESCE(pr.reach, 0) AS reach,
          COALESCE(pr.clicks, 0) AS clicks,
          COALESCE(pr.video_views, 0) AS video_views,
          COALESCE(pr.engagement, 0) AS engagement,
          COALESCE(pr.conversions, 0) AS conversions,
          pr.ctr,
          pr.cpm,
          pr.cpc,
          COALESCE(pr.metrics, '{}'::jsonb) AS metrics
        FROM performance_records pr
        LEFT JOIN data_sources ds ON ds.id = pr.data_source_id
        WHERE pr.study_corpus_id = $1
      ),
      known AS (
        SELECT
          month,
          source_type,
          provider,
          channel,
          COUNT(*)::int AS records,
          COALESCE(SUM(spend), 0)::text AS spend,
          COALESCE(SUM(impressions), 0)::text AS impressions,
          COALESCE(SUM(reach), 0)::text AS reach,
          COALESCE(SUM(clicks), 0)::text AS clicks,
          COALESCE(SUM(video_views), 0)::text AS video_views,
          COALESCE(SUM(engagement), 0)::text AS engagement,
          COALESCE(SUM(conversions), 0)::text AS conversions,
          AVG(ctr)::text AS avg_ctr,
          AVG(cpm)::text AS avg_cpm,
          AVG(cpc)::text AS avg_cpc,
          array_remove(array_agg(DISTINCT entity_kind), NULL) AS entity_kinds,
          array_remove(array_agg(DISTINCT objective), NULL) AS objectives,
          array_remove(array_agg(DISTINCT entity_name), NULL) AS sample_entities,
          array_remove(array_agg(DISTINCT creative_text), NULL) AS sample_texts
        FROM base
        GROUP BY month, source_type, provider, channel
      ),
      metric_sums AS (
        SELECT
          base.month,
          base.source_type,
          base.provider,
          base.channel,
          metric.key AS metric_key,
          SUM(
            CASE
              WHEN metric.value ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN metric.value::numeric
              ELSE 0
            END
          ) AS metric_sum
        FROM base
        JOIN LATERAL jsonb_each_text(base.metrics) metric(key, value) ON true
        GROUP BY base.month, base.source_type, base.provider, base.channel, metric.key
      ),
      metric_totals AS (
        SELECT
          month,
          source_type,
          provider,
          channel,
          jsonb_object_agg(metric_key, metric_sum) AS custom_metrics
        FROM metric_sums
        GROUP BY month, source_type, provider, channel
      )
      SELECT
        known.*,
        COALESCE(metric_totals.custom_metrics, '{}'::jsonb) AS custom_metrics
      FROM known
      LEFT JOIN metric_totals
        ON metric_totals.month = known.month
       AND metric_totals.source_type = known.source_type
       AND metric_totals.provider = known.provider
       AND metric_totals.channel = known.channel
      ORDER BY known.month DESC, known.records DESC
      LIMIT 360
    `,
    [corpusId]
  )).rows;

  return rows
    .map((row) => ({
      month: row.month,
      source_type: row.source_type ?? "performance",
      provider: row.provider ?? "unknown",
      channel: row.channel ?? "unknown",
      records: Number(row.records ?? 0),
      metrics: compactMetricRecord({
        ...numericMetricsFromRecord(row.custom_metrics),
        spend: Number(row.spend ?? 0),
        impressions: Number(row.impressions ?? 0),
        reach: Number(row.reach ?? 0),
        clicks: Number(row.clicks ?? 0),
        video_views: Number(row.video_views ?? 0),
        engagement: Number(row.engagement ?? 0),
        conversions: Number(row.conversions ?? 0),
        ctr: numberOrNull(row.avg_ctr) ?? 0,
        cpm: numberOrNull(row.avg_cpm) ?? 0,
        cpc: numberOrNull(row.avg_cpc) ?? 0
      }),
      entity_kinds: (row.entity_kinds ?? []).filter(Boolean).slice(0, 8),
      objectives: (row.objectives ?? []).filter(Boolean).slice(0, 8),
      sample_entities: (row.sample_entities ?? []).filter(Boolean).slice(0, 8),
      sample_texts: (row.sample_texts ?? []).filter(Boolean).slice(0, 5)
    }))
    .sort((a, b) => a.month.localeCompare(b.month) || b.records - a.records);
}

async function loadMarketingActivityWindow(corpusId: string): Promise<{
  months: SignalPulseMarketingActivityMonth[];
  repeatedLanguage: SignalPulseRepeatedMarketingLanguage[];
}> {
  const rows = (await pool.query<{
    month: string;
    platform: string;
    channel: string;
    entity_kind: string;
    entity_name: string | null;
    objective: string | null;
    spend: string | null;
    impressions: string | null;
    clicks: string | null;
    engagement: string | null;
    creative_text: string | null;
  }>(
    `
      SELECT
        to_char(date_trunc('month', record_date), 'YYYY-MM') AS month,
        platform,
        channel,
        entity_kind,
        COALESCE(entity_name, external_id) AS entity_name,
        objective,
        COALESCE(spend, 0)::text AS spend,
        COALESCE(impressions, 0)::text AS impressions,
        COALESCE(clicks, 0)::text AS clicks,
        COALESCE(engagement, 0)::text AS engagement,
        creative_text
      FROM performance_records
      WHERE study_corpus_id = $1
      ORDER BY record_date DESC, COALESCE(spend, 0) DESC, COALESCE(impressions, 0) DESC, COALESCE(engagement, 0) DESC
      LIMIT 1800
    `,
    [corpusId]
  )).rows;

  return summarizeSignalPulseMarketingActivity(rows.map((row): SignalPulseMarketingActivityRow => ({
    month: row.month,
    platform: row.platform,
    channel: row.channel,
    entity_kind: row.entity_kind,
    entity_name: row.entity_name,
    objective: row.objective,
    spend: Number(row.spend ?? 0),
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    engagement: Number(row.engagement ?? 0),
    creative_text: row.creative_text
  })));
}

async function loadClusterPeriodSeries(args: {
  corpusId: string;
  term: string;
  memberMentionIds: string[];
  granularity: "month" | "week";
}): Promise<SignalPulseClusterPromptContext["period_series"]> {
  const semanticRows = await loadSignalPulseSemanticPeriodSeriesRows({
    corpusId: args.corpusId,
    memberMentionIds: args.memberMentionIds,
    granularity: args.granularity
  });
  if (semanticRows) {
    return buildPeriodSeries(semanticRows.map((row) => ({
      label: row.label,
      period_start: row.period_start,
      period_end: row.period_end,
      volume: row.volume,
      engagement: row.engagement,
      sentiment_avg: row.sentiment_avg,
      source_mix: row.source_mix
    })), args.granularity);
  }

  const pattern = `%${escapeLike(args.term)}%`;
  const rows = (await pool.query<{
    label: string;
    period_start: string;
    period_end: string;
    volume: number;
    engagement: string | null;
    sentiment_avg: string | null;
    source_mix: Record<string, number> | null;
  }>(
    `
      WITH periods AS (
        SELECT label, period_start, period_end
        FROM report_periods
        WHERE study_corpus_id = $1 AND granularity = $4
      ),
      matched AS (
        SELECT
          rp.label,
          rp.period_start::text,
          rp.period_end::text,
          m.id,
          m.sentiment_score,
          COALESCE(NULLIF(m.resolved_platform, ''), m.platform, 'unknown') AS platform,
          CASE
            WHEN COALESCE(m.engagement->>'total', m.engagement->>'interactions', m.engagement->>'engagement', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
            THEN COALESCE(m.engagement->>'total', m.engagement->>'interactions', m.engagement->>'engagement')::numeric
            ELSE 0
          END AS engagement_score
        FROM periods rp
        LEFT JOIN mentions m ON m.study_corpus_id = $1
          AND m.inclusion_status = 'included'
          AND m.published_at >= rp.period_start
          AND m.published_at < (rp.period_end + interval '1 day')
          AND (
            (cardinality($3::uuid[]) > 0 AND m.id = ANY($3::uuid[]))
            OR
            (cardinality($3::uuid[]) = 0 AND translate(lower(m.text_clean), 'áéíóúüñ', 'aeiouun') LIKE lower($2))
          )
      ),
      source_counts AS (
        SELECT label, platform, COUNT(id)::int AS count
        FROM matched
        WHERE id IS NOT NULL
        GROUP BY label, platform
      )
      SELECT
        p.label,
        p.period_start::text,
        p.period_end::text,
        COUNT(m.id)::int AS volume,
        COALESCE(SUM(m.engagement_score), 0)::text AS engagement,
        AVG(m.sentiment_score)::text AS sentiment_avg,
        COALESCE(
          (
            SELECT jsonb_object_agg(sc.platform, sc.count)
            FROM source_counts sc
            WHERE sc.label = p.label
          ),
          '{}'::jsonb
        ) AS source_mix
      FROM periods p
      LEFT JOIN matched m ON m.label = p.label
      GROUP BY p.label, p.period_start, p.period_end
      ORDER BY p.period_start
    `,
    [args.corpusId, pattern, args.memberMentionIds, args.granularity]
  )).rows;

  return buildPeriodSeries(rows.map((row) => ({
    label: row.label,
    period_start: row.period_start,
    period_end: row.period_end,
    volume: Number(row.volume ?? 0),
    engagement: Number(row.engagement ?? 0),
    sentiment_avg: numberOrNull(row.sentiment_avg),
    source_mix: row.source_mix ?? {}
  })), args.granularity);
}

function buildPeriodSeries(
  rows: Array<{
    label: string;
    period_start: string;
    period_end: string;
    volume: number;
    engagement: number;
    sentiment_avg: number | null;
    source_mix: Record<string, number>;
  }>,
  granularity: "month" | "week"
): SignalPulseClusterPromptContext["period_series"] {
  const volumes: number[] = [];
  return rows.map((row) => {
    const previous = volumes.at(-1) ?? 0;
    const volume = Number(row.volume ?? 0);
    volumes.push(volume);
    return {
      granularity,
      label: row.label,
      period_start: row.period_start,
      period_end: row.period_end,
      volume,
      delta_prev: volumes.length > 1 ? volume - previous : null,
      engagement: Number(row.engagement ?? 0),
      sentiment_avg: row.sentiment_avg,
      source_mix: row.source_mix,
      lifecycle_state: classifySignalPulseLifecycle({
        currentVolume: volume,
        previousVolume: previous,
        periodsSeen: volumes.filter((item) => item > 0).length,
        volatility: volatility(volumes)
      })
    };
  });
}

async function retrieveSemanticMatches(args: {
  ctx: SignalPulseContextScope;
  cluster: ClusterContextInput;
  marketingContext: SignalPulseMarketingContext;
}): Promise<{ knowledge: SignalPulseKnowledgeMatch[]; conversation: SignalPulseConversationMatch[] }> {
  if (!hasEmbeddingProvider()) return { knowledge: [], conversation: [] };
  const query = buildClusterSemanticQuery(args.cluster, args.marketingContext);
  if (!query) return { knowledge: [], conversation: [] };
  try {
    const embeddingModel = getEmbeddingModel();
    const [embedded] = await embedTexts({
      inputs: [{ id: args.cluster.id, text: query }],
      model: embeddingModel,
      batchSize: 1,
      inputType: "query"
    });
    if (!embedded) return { knowledge: [], conversation: [] };
    const [knowledgeRows, conversationRows] = await Promise.all([
      pool.query<{
        title: string | null;
        source_kind: string | null;
        text: string;
        similarity: string | null;
      }>(
        `
          SELECT
            COALESCE(bks.title, se.metadata->>'title') AS title,
            COALESCE(bks.source_kind, se.metadata->>'source_kind') AS source_kind,
            se.chunk_text AS text,
            (1 - (se.embedding <=> $2::vector))::text AS similarity
          FROM semantic_embeddings se
          LEFT JOIN brand_knowledge_sources bks ON bks.id = se.source_id
          WHERE se.scope_type = 'knowledge_source'
            AND se.embedding_model = $3
            AND (
              se.study_corpus_id = $1
              OR ($4::uuid IS NOT NULL AND se.brand_id = $4::uuid)
              OR ($5::uuid IS NOT NULL AND se.organization_id = $5::uuid)
            )
          ORDER BY se.embedding <=> $2::vector
          LIMIT 8
        `,
        [
          args.ctx.study_corpus_id,
          vectorLiteral(embedded.embedding),
          embeddingModel,
          args.ctx.brand_id,
          args.ctx.organization_id
        ]
      ),
      pool.query<{
        mention_id: string;
        text: string;
        platform: string | null;
        published_at: string | null;
        period_label: string | null;
        similarity: string | null;
      }>(
        `
          SELECT
            se.mention_id::text AS mention_id,
            COALESCE(NULLIF(m.text_clean, ''), se.chunk_text) AS text,
            COALESCE(NULLIF(m.resolved_platform, ''), NULLIF(m.platform, ''), se.metadata->>'platform', 'unknown') AS platform,
            COALESCE(m.published_at::date::text, se.metadata->>'published_at') AS published_at,
            rp.label AS period_label,
            (1 - (se.embedding <=> $2::vector))::text AS similarity
          FROM semantic_embeddings se
          LEFT JOIN mentions m ON m.id = se.mention_id
          LEFT JOIN report_periods rp
            ON rp.study_corpus_id = $1
           AND rp.granularity = 'month'
           AND m.published_at >= rp.period_start
           AND m.published_at < (rp.period_end + interval '1 day')
          WHERE se.scope_type = 'mention'
            AND se.study_corpus_id = $1
            AND se.embedding_model = $3
            AND se.mention_id IS NOT NULL
            AND (m.id IS NULL OR m.inclusion_status = 'included')
          ORDER BY se.embedding <=> $2::vector
          LIMIT 16
        `,
        [
          args.ctx.study_corpus_id,
          vectorLiteral(embedded.embedding),
          embeddingModel
        ]
      )
    ]);
    return {
      knowledge: knowledgeRows.rows.map((row) => ({
        title: row.title,
        source_kind: row.source_kind,
        text: row.text.slice(0, 900),
        similarity: numberOrNull(row.similarity)
      })),
      conversation: conversationRows.rows.map((row) => ({
        mention_id: row.mention_id,
        text: row.text.slice(0, 420),
        platform: row.platform ?? "unknown",
        published_at: row.published_at,
        period_label: row.period_label,
        similarity: numberOrNull(row.similarity)
      }))
    };
  } catch (error) {
    console.warn(`[signal-pulse-rag] semantic retrieval skipped: ${error instanceof Error ? error.message : String(error)}`);
    return { knowledge: [], conversation: [] };
  }
}

async function loadRelevantMarketingRecords(args: {
  corpusId: string;
  cluster: ClusterContextInput;
  periodLabels: string[];
  semanticMatches: { knowledge: SignalPulseKnowledgeMatch[]; conversation: SignalPulseConversationMatch[] };
  marketingContext: SignalPulseMarketingContext;
}): Promise<SignalPulseClusterPromptContext["performance_context"]["matching_creatives"]> {
  const labels = Array.from(new Set(args.periodLabels.filter(Boolean))).slice(0, 12);
  const rows = (await pool.query<{
    record_date: string;
    period_label: string | null;
    platform: string;
    channel: string;
    entity_kind: string;
    entity_name: string | null;
    objective: string | null;
    spend: string | null;
    impressions: string | null;
    clicks: string | null;
    engagement: string | null;
    creative_text: string | null;
  }>(
    `
      SELECT
        pr.record_date::text,
        to_char(date_trunc('month', pr.record_date), 'YYYY-MM') AS period_label,
        pr.platform,
        pr.channel,
        pr.entity_kind,
        COALESCE(pr.entity_name, pr.external_id) AS entity_name,
        pr.objective,
        COALESCE(pr.spend, 0)::text AS spend,
        COALESCE(pr.impressions, 0)::text AS impressions,
        COALESCE(pr.clicks, 0)::text AS clicks,
        COALESCE(pr.engagement, 0)::text AS engagement,
        pr.creative_text
      FROM performance_records pr
      WHERE pr.study_corpus_id = $1
        AND (
          cardinality($2::text[]) = 0
          OR to_char(date_trunc('month', pr.record_date), 'YYYY-MM') = ANY($2::text[])
        )
      ORDER BY
        CASE
          WHEN cardinality($2::text[]) > 0
           AND to_char(date_trunc('month', pr.record_date), 'YYYY-MM') = ANY($2::text[])
          THEN 0 ELSE 1
        END,
        pr.record_date DESC,
        COALESCE(pr.engagement, 0) DESC,
        COALESCE(pr.spend, 0) DESC,
        COALESCE(pr.impressions, 0) DESC
      LIMIT 600
    `,
    [args.corpusId, labels]
  )).rows;
  const candidates = rows.map((row): SignalPulseMarketingRecordCandidate => ({
    record_date: row.record_date,
    period_label: row.period_label,
    platform: row.platform,
    channel: row.channel,
    entity_kind: row.entity_kind,
    entity_name: row.entity_name,
    objective: row.objective,
    spend: Number(row.spend ?? 0),
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    engagement: Number(row.engagement ?? 0),
    creative_text: row.creative_text ? row.creative_text.slice(0, 360) : null
  }));
  return rankSignalPulseMarketingRecordsForCluster({
    cluster: args.cluster,
    semanticMatches: args.semanticMatches,
    marketingContext: args.marketingContext,
    records: candidates,
    periodLabels: labels,
    limit: 10
  });
}

async function loadPeriodCampaignContext(args: {
  corpusId: string;
  periodLabels: string[];
}): Promise<SignalPulseClusterPromptContext["performance_context"]["period_campaigns"]> {
  const labels = Array.from(new Set(args.periodLabels.filter(Boolean))).slice(0, 12);
  if (labels.length === 0) return [];
  const rows = (await pool.query<{
    period_label: string;
    period_start: string;
    period_end: string;
    platform: string;
    channel: string;
    entity_kind: string;
    entity_name: string | null;
    objective: string | null;
    spend: string | null;
    impressions: string | null;
    clicks: string | null;
    engagement: string | null;
    avg_ctr: string | null;
    records: number;
  }>(
    `
      WITH selected_periods AS (
        SELECT label, period_start, period_end
        FROM report_periods
        WHERE study_corpus_id = $1
          AND granularity = 'month'
          AND label = ANY($2::text[])
      )
      SELECT
        sp.label AS period_label,
        sp.period_start::text,
        sp.period_end::text,
        pr.platform,
        pr.channel,
        pr.entity_kind,
        COALESCE(pr.entity_name, pr.external_id) AS entity_name,
        pr.objective,
        COALESCE(SUM(pr.spend), 0)::text AS spend,
        COALESCE(SUM(pr.impressions), 0)::text AS impressions,
        COALESCE(SUM(pr.clicks), 0)::text AS clicks,
        COALESCE(SUM(pr.engagement), 0)::text AS engagement,
        AVG(pr.ctr)::text AS avg_ctr,
        COUNT(pr.id)::int AS records
      FROM selected_periods sp
      JOIN performance_records pr
        ON pr.study_corpus_id = $1
       AND pr.record_date >= sp.period_start
       AND pr.record_date <= sp.period_end
      GROUP BY sp.label, sp.period_start, sp.period_end, pr.platform, pr.channel, pr.entity_kind, pr.entity_name, pr.external_id, pr.objective
      ORDER BY sp.period_start DESC, COALESCE(SUM(pr.spend), 0) DESC, COALESCE(SUM(pr.impressions), 0) DESC, COALESCE(SUM(pr.engagement), 0) DESC
      LIMIT 24
    `,
    [args.corpusId, labels]
  )).rows;
  return rows.map((row) => ({
    period_label: row.period_label,
    period_start: row.period_start,
    period_end: row.period_end,
    platform: row.platform,
    channel: row.channel,
    entity_kind: row.entity_kind,
    entity_name: row.entity_name,
    objective: row.objective,
    spend: Number(row.spend ?? 0),
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    engagement: Number(row.engagement ?? 0),
    avg_ctr: numberOrNull(row.avg_ctr),
    records: Number(row.records ?? 0)
  }));
}

function buildClusterInvestigationBrief(args: {
  cluster: ClusterContextInput;
  periodSeries: SignalPulseClusterPromptContext["period_series"];
  weeklySeries: SignalPulseClusterPromptContext["period_series"];
  windowPattern: SignalPulseWindowPattern;
  weeklyPattern: SignalPulseWindowPattern;
  periodCampaigns: SignalPulseClusterPromptContext["performance_context"]["period_campaigns"];
  performanceEvents: SignalPulseClusterPromptContext["performance_context"]["performance_events"];
  structuredSources: SignalPulseStructuredSourceMonth[];
  structuredSourceEvents: SignalPulseStructuredSourceEvent[];
  matchingCreatives: SignalPulseMarketingRecordMatch[];
  semanticMatches: { knowledge: SignalPulseKnowledgeMatch[]; conversation: SignalPulseConversationMatch[] };
}): SignalPulseInvestigationBrief {
  const current = args.periodSeries.at(-1) ?? null;
  const strongestPeriods = args.periodSeries
    .filter((period) => period.volume > 0)
    .slice()
    .sort((a, b) => b.volume - a.volume || b.engagement - a.engagement)
    .slice(0, 4)
    .map((period) => ({
      period_label: period.label,
      volume: period.volume,
      delta_prev: period.delta_prev,
      lifecycle_state: period.lifecycle_state,
      source_mix: period.source_mix
    }));
  const weeklyPulses = args.weeklySeries
    .filter((period) => period.volume > 0 || Math.abs(period.delta_prev ?? 0) > 0)
    .slice()
    .sort((a, b) => Math.abs(b.delta_prev ?? 0) - Math.abs(a.delta_prev ?? 0) || b.volume - a.volume)
    .slice(0, 4)
    .map((period) => ({
      period_label: period.label,
      volume: period.volume,
      delta_prev: period.delta_prev,
      lifecycle_state: period.lifecycle_state,
      source_mix: period.source_mix
    }));
  const relevantPeriodLabels = Array.from(new Set([
    ...strongestPeriods.map((period) => period.period_label),
    current?.label,
    ...args.matchingCreatives.map((record) => record.period_label)
  ].filter((label): label is string => Boolean(label)))).slice(0, 8);
  const marketingIntersections = relevantPeriodLabels.map((periodLabel) => {
    const campaigns = args.periodCampaigns.filter((campaign) => campaign.period_label === periodLabel);
    const matches = args.matchingCreatives.filter((record) => record.period_label === periodLabel);
    const events = args.performanceEvents.filter((event) => event.month === periodLabel);
    const sourceEvents = args.structuredSourceEvents.filter((event) => event.month === periodLabel);
    const structuredSources = args.structuredSources.filter((source) => source.month === periodLabel);
    const basis = matches.some((record) => record.match_basis.includes("evidence_overlap"))
      ? "creative_or_campaign_language_overlaps_evidence"
      : matches.some((record) => record.match_basis.includes("repeated_marketing_language"))
        ? "repeated_marketing_language_overlap"
        : campaigns.length > 0 || events.length > 0 || sourceEvents.length > 0 || structuredSources.length > 0
          ? "same_period_marketing_activity"
          : "conversation_only_period";
    return {
      period_label: periodLabel,
      basis,
      campaign_count: campaigns.length,
      matching_creative_count: matches.length,
      performance_event_count: events.length + sourceEvents.length,
      spend: round(campaigns.reduce((sum, campaign) => sum + campaign.spend, 0), 2),
      impressions: round(campaigns.reduce((sum, campaign) => sum + campaign.impressions, 0), 2),
      engagement: round(campaigns.reduce((sum, campaign) => sum + campaign.engagement, 0), 2),
      top_campaigns: campaigns
        .slice()
        .sort((a, b) => b.spend - a.spend || b.engagement - a.engagement || b.impressions - a.impressions)
        .map((campaign) => [campaign.entity_name, campaign.objective, campaign.platform, campaign.channel].filter(Boolean).join(" · "))
        .filter(Boolean)
        .slice(0, 4),
      top_matching_creatives: matches
        .slice()
        .sort(marketingRecordSort)
        .map((record) => record.creative_text || record.entity_name || record.objective)
        .filter((value): value is string => Boolean(value))
        .slice(0, 4),
      structured_source_event_count: sourceEvents.length,
      top_structured_sources: structuredSources
        .slice()
        .sort((a, b) => b.records - a.records || totalMetricValue(b.metrics) - totalMetricValue(a.metrics))
        .map(formatStructuredSourceLabel)
        .slice(0, 4)
    };
  }).filter((intersection) => (
    intersection.campaign_count > 0
    || intersection.matching_creative_count > 0
    || intersection.performance_event_count > 0
    || (intersection.structured_source_event_count ?? 0) > 0
    || intersection.basis === "conversation_only_period"
  ));
  const currentCutVolume = current?.volume ?? 0;
  const windowVolume = args.periodSeries.reduce((sum, period) => sum + period.volume, 0);
  const hasDirectMarketingOverlap = args.matchingCreatives.some((record) => (
    record.match_basis.includes("evidence_overlap")
    || record.match_basis.includes("repeated_marketing_language")
    || record.match_basis.includes("knowledge_or_brief_overlap")
  ));
  const patternFlags = buildSignalPulsePatternFlags({
    periodSeries: args.periodSeries,
    weeklySeries: args.weeklySeries,
    windowPattern: args.windowPattern,
    weeklyPattern: args.weeklyPattern,
    marketingIntersections,
    hasDirectMarketingOverlap
  });
  return {
    current_cut: current ? {
      period_label: current.label,
      volume: current.volume,
      delta_prev: current.delta_prev,
      lifecycle_state: current.lifecycle_state,
      sentiment_avg: current.sentiment_avg,
      source_mix: current.source_mix
    } : null,
    window_pattern: args.windowPattern,
    weekly_pattern: args.weeklySeries.length > 0 ? args.weeklyPattern : null,
    strongest_periods: strongestPeriods,
    weekly_pulses: weeklyPulses,
    marketing_intersections: marketingIntersections.slice(0, 8),
    pattern_flags: patternFlags,
    evidence_map: {
      sample_ids: args.cluster.samples.map((sample) => sample.id).filter(Boolean).slice(0, 12),
      semantic_mention_ids: args.semanticMatches.conversation.map((match) => match.mention_id).filter(Boolean).slice(0, 12),
      knowledge_titles: args.semanticMatches.knowledge
        .map((match) => match.title || match.source_kind || null)
        .filter((value): value is string => Boolean(value))
        .slice(0, 8)
    },
    synthesis_questions: buildSynthesisQuestions({
      currentCutVolume,
      windowVolume,
      hasDirectMarketingOverlap,
      strongestPeriods,
      marketingIntersections
    })
  };
}

function buildSynthesisQuestions(args: {
  currentCutVolume: number;
  windowVolume: number;
  hasDirectMarketingOverlap: boolean;
  strongestPeriods: SignalPulseInvestigationBrief["strongest_periods"];
  marketingIntersections: SignalPulseInvestigationBrief["marketing_intersections"];
}) {
  const questions = [
    "Qué cambia en el corte actual versus el patrón de la ventana completa?",
    "Qué evidencia textual con mention_id sostiene una lectura humana y no sólo una keyword?",
    "Hay conexión comprobable con campañas, claims, pauta u orgánico, o debe marcarse no_connection?"
  ];
  if (args.windowVolume > args.currentCutVolume && args.strongestPeriods.length > 1) {
    questions.push("El aprendizaje principal es repetición, saturación, reactivación o anomalía histórica?");
  }
  if (args.hasDirectMarketingOverlap) {
    questions.push("El overlap con piezas/campañas apunta a riesgo creativo, claim a testear o gap de pauta?");
  } else if (args.marketingIntersections.some((item) => item.basis === "same_period_marketing_activity")) {
    questions.push("Sólo hay coexistencia temporal con marketing; evitar causalidad si no hay overlap de lenguaje/evidencia.");
  }
  return questions.slice(0, 6);
}

function summarizePerformanceEvents(
  performanceWindow: SignalPulseMarketingContext["performance_window"],
  periodLabels: string[]
): SignalPulseClusterPromptContext["performance_context"]["performance_events"] {
  const labels = new Set(periodLabels);
  const events: SignalPulseClusterPromptContext["performance_context"]["performance_events"] = [];
  for (let index = 0; index < performanceWindow.length; index += 1) {
    const current = performanceWindow[index];
    if (!current || !labels.has(current.month)) continue;
    const previous = performanceWindow[index - 1] ?? null;
    for (const metric of ["spend", "impressions", "clicks", "engagement", "avg_ctr"] as const) {
      const currentValue = Number(current[metric] ?? 0);
      const previousValue = Number(previous?.[metric] ?? 0);
      if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) continue;
      const deltaAbs = round(currentValue - previousValue, metric === "avg_ctr" ? 5 : 2);
      if (deltaAbs === 0) continue;
      const deltaPct = previousValue !== 0 ? round((deltaAbs / previousValue) * 100, 2) : null;
      events.push({
        month: current.month,
        metric,
        current_value: currentValue,
        previous_value: previousValue,
        delta_abs: deltaAbs,
        delta_pct: deltaPct,
        direction: deltaAbs > 0 ? "up" : "down"
      });
    }
  }
  return events
    .sort((a, b) => Math.abs(b.delta_pct ?? b.delta_abs) - Math.abs(a.delta_pct ?? a.delta_abs))
    .slice(0, 12);
}

function summarizeStructuredSourceEvents(
  structuredWindow: SignalPulseStructuredSourceMonth[],
  periodLabels: string[]
): SignalPulseStructuredSourceEvent[] {
  const labels = new Set(periodLabels);
  const grouped = new Map<string, Array<SignalPulseStructuredSourceMonth & { metric: string; value: number }>>();
  for (const month of structuredWindow) {
    for (const [metric, rawValue] of Object.entries(month.metrics)) {
      if (!isStructuredMetricUseful(metric)) continue;
      const value = Number(rawValue);
      if (!Number.isFinite(value)) continue;
      const key = [month.source_type, month.provider, month.channel, metric].join("|");
      const entries = grouped.get(key) ?? [];
      entries.push({ ...month, metric, value });
      grouped.set(key, entries);
    }
  }

  const events: SignalPulseStructuredSourceEvent[] = [];
  for (const entries of grouped.values()) {
    const sorted = entries.sort((a, b) => a.month.localeCompare(b.month));
    for (let index = 0; index < sorted.length; index += 1) {
      const current = sorted[index];
      if (!current || !labels.has(current.month)) continue;
      const previous = sorted[index - 1] ?? null;
      const previousValue = Number(previous?.value ?? 0);
      const currentValue = Number(current.value ?? 0);
      if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) continue;
      const deltaAbs = round(currentValue - previousValue, current.metric === "ctr" ? 5 : 2);
      if (deltaAbs === 0) continue;
      const deltaPct = previousValue !== 0 ? round((deltaAbs / previousValue) * 100, 2) : null;
      events.push({
        month: current.month,
        source_type: current.source_type,
        provider: current.provider,
        channel: current.channel,
        metric: current.metric,
        current_value: currentValue,
        previous_value: previousValue,
        delta_abs: deltaAbs,
        delta_pct: deltaPct,
        direction: deltaAbs > 0 ? "up" : "down"
      });
    }
  }

  return events
    .sort((a, b) => Math.abs(b.delta_pct ?? b.delta_abs) - Math.abs(a.delta_pct ?? a.delta_abs))
    .slice(0, 24);
}

function buildMarketingBrief(analysisPlan: Record<string, unknown> | null, params: Record<string, unknown> | null) {
  const plan = recordValue(analysisPlan);
  const marketingBrief = recordValue(plan.marketing_brief);
  return compactRecord({
    ...marketingBrief,
    business_question: plan.business_question ?? params?.business_question,
    target_window_months: plan.target_window_months ?? params?.window_months,
    budget_cap_usd: plan.budget_cap_usd ?? params?.budget_cap_usd
  }, 1200);
}

function buildClusterSemanticQuery(cluster: ClusterContextInput, marketingContext: SignalPulseMarketingContext) {
  return [
    "Signal Pulse semantic retrieval query.",
    "Retrieve brand, campaign, claim, performance and conversation evidence that explains the cluster. Avoid generic keyword-only matches.",
    `provisional_term: ${cluster.term}`,
    `provisional_title: ${cluster.currentTitle}`,
    cluster.term,
    cluster.currentTitle,
    cluster.platforms.join(" "),
    cluster.discoveryPeriods.join(" "),
    ...cluster.samples.slice(0, 12).map((sample) => `${sample.published_at ?? "sin_fecha"} ${sample.platform}: ${sample.text}`),
    JSON.stringify(marketingContext.marketing_brief).slice(0, 1600),
    JSON.stringify(marketingContext.source_inventory.slice(0, 12)).slice(0, 1200),
    JSON.stringify(marketingContext.repeated_marketing_language.slice(0, 8)).slice(0, 1600),
    JSON.stringify(marketingContext.marketing_activity_window.slice(-6)).slice(0, 2200),
    JSON.stringify(marketingContext.structured_source_window.slice(-18)).slice(0, 2600)
  ].filter(Boolean).join("\n").slice(0, 7000);
}

function summarizeWindowPattern(series: SignalPulseClusterPromptContext["period_series"]): SignalPulseClusterPromptContext["window_pattern"] {
  const active = series.filter((period) => period.volume > 0);
  const current = series.at(-1) ?? null;
  const previous = series.at(-2) ?? null;
  const peak = series.slice().sort((a, b) => b.volume - a.volume)[0] ?? null;
  return {
    current_period: current?.label ?? null,
    current_volume: current?.volume ?? 0,
    previous_volume: previous?.volume ?? 0,
    delta_prev: current && previous ? current.volume - previous.volume : null,
    active_periods: active.length,
    first_active_period: active[0]?.label ?? null,
    last_active_period: active.at(-1)?.label ?? null,
    peak_period: peak?.label ?? null,
    peak_volume: peak?.volume ?? 0,
    lifecycle_state: current?.lifecycle_state ?? "dormant"
  };
}

function compactRecord(value: unknown, maxStringLength: number): Record<string, unknown> {
  const source = recordValue(value);
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    if (typeof item === "string") {
      output[key] = item.slice(0, maxStringLength);
    } else if (Array.isArray(item)) {
      output[key] = item.slice(0, 12).map((entry) => typeof entry === "string" ? entry.slice(0, 260) : entry);
    } else if (item && typeof item === "object") {
      output[key] = compactRecord(item, Math.min(500, maxStringLength));
    } else if (item !== undefined) {
      output[key] = item;
    }
  }
  return output;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numericMetricsFromRecord(value: Record<string, unknown> | null | undefined) {
  const output: Record<string, number> = {};
  for (const [key, item] of Object.entries(value ?? {})) {
    const number = Number(item);
    if (Number.isFinite(number)) output[key] = number;
  }
  return output;
}

function compactMetricRecord(value: Record<string, number>) {
  const output: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!Number.isFinite(item)) continue;
    if (item === 0 && !["ctr", "cpm", "cpc"].includes(key)) continue;
    output[key] = round(item, ["ctr", "cpm", "cpc"].includes(key) ? 5 : 2);
  }
  return output;
}

function totalMetricValue(metrics: Record<string, number>) {
  return Object.entries(metrics)
    .filter(([key]) => !["ctr", "cpm", "cpc"].includes(key))
    .reduce((sum, [, value]) => sum + Math.max(0, Number(value) || 0), 0);
}

function formatStructuredSourceLabel(source: SignalPulseStructuredSourceMonth) {
  const strongestMetrics = Object.entries(source.metrics)
    .filter(([metric]) => isStructuredMetricUseful(metric))
    .sort(([, a], [, b]) => Math.abs(Number(b) || 0) - Math.abs(Number(a) || 0))
    .slice(0, 3)
    .map(([metric, value]) => `${metric}:${round(Number(value) || 0, metric === "ctr" ? 5 : 2)}`)
    .join(", ");
  return [
    source.source_type,
    source.provider,
    source.channel,
    source.sample_entities[0],
    strongestMetrics
  ].filter(Boolean).join(" · ");
}

function isStructuredMetricUseful(metric: string) {
  return !["records", "cpm", "cpc"].includes(metric);
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function volatility(values: number[]) {
  if (values.length < 3) return 0;
  const average = values.reduce((sum, item) => sum + item, 0) / values.length;
  if (average <= 0) return 0;
  const variance = values.reduce((sum, item) => sum + ((item - average) ** 2), 0) / values.length;
  return Math.max(0, Math.min(1, Math.sqrt(variance) / average));
}

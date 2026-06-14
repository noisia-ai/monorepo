import {
  classifySignalPulseLifecycle,
  embedTexts,
  getEmbeddingModel,
  hasEmbeddingProvider,
  vectorLiteral
} from "@noisia/query-engine";
import { pool } from "../db/client";
import { loadAnalysisRagContext } from "./analysis-rag-context";

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

export type SignalPulseClusterPromptContext = {
  period_series: SignalPulsePeriodSeriesPoint[];
  weekly_series?: SignalPulsePeriodSeriesPoint[];
  window_pattern: SignalPulseWindowPattern;
  weekly_pattern?: SignalPulseWindowPattern;
  performance_context: {
    active_months: Array<SignalPulseMarketingContext["performance_window"][number]>;
    matching_creatives: Array<{
      record_date: string;
      platform: string;
      channel: string;
      entity_kind: string;
      entity_name: string | null;
      objective: string | null;
      spend: number;
      impressions: number;
      clicks: number;
      engagement: number;
      creative_text: string | null;
    }>;
  };
  knowledge_matches: SignalPulseKnowledgeMatch[];
};

type ClusterContextInput = {
  id: string;
  term: string;
  currentTitle: string;
  mentionCount: number;
  platforms: string[];
  discoveryPeriods: string[];
  memberMentionIds: string[];
  samples: Array<{ text: string; platform: string; published_at: string | null }>;
};

export async function loadSignalPulseMarketingContext(ctx: SignalPulseContextScope): Promise<SignalPulseMarketingContext> {
  const [ragContext, sourceInventory, performanceWindow] = await Promise.all([
    loadAnalysisRagContext(ctx.study_corpus_id, ctx.brand_id),
    loadSourceInventory(ctx.study_corpus_id),
    loadPerformanceWindow(ctx.study_corpus_id)
  ]);

  return {
    marketing_brief: buildMarketingBrief(ctx.analysis_plan, ctx.params),
    knowledge_sources: ragContext.knowledgeSources
      .filter((source) => source.type !== "query_strategy_brief")
      .slice(0, 10)
      .map((source) => ({ type: source.type, content: compactRecord(source.content, 900) })),
    source_inventory: sourceInventory,
    performance_window: performanceWindow,
    rag: {
      semantic_available: hasEmbeddingProvider(),
      embedding_model: hasEmbeddingProvider() ? getEmbeddingModel() : null,
      retrieval_scope: "brand_knowledge_sources + structured performance_records"
    }
  };
}

export async function loadSignalPulseClusterPromptContext(args: {
  ctx: SignalPulseContextScope;
  marketingContext: SignalPulseMarketingContext;
  cluster: ClusterContextInput;
}): Promise<SignalPulseClusterPromptContext> {
  const [periodSeries, weeklySeries, knowledgeMatches, matchingCreatives] = await Promise.all([
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
    retrieveKnowledgeMatches({
      ctx: args.ctx,
      cluster: args.cluster,
      marketingBrief: args.marketingContext.marketing_brief
    }),
    loadMatchingCreatives({
      corpusId: args.ctx.study_corpus_id,
      term: args.cluster.term
    })
  ]);

  const windowPattern = summarizeWindowPattern(periodSeries);
  const weeklyPattern = summarizeWindowPattern(weeklySeries);
  const activeMonths = new Set(periodSeries.filter((period) => period.volume > 0).map((period) => period.label));
  return {
    period_series: periodSeries,
    weekly_series: weeklySeries,
    window_pattern: windowPattern,
    weekly_pattern: weeklyPattern,
    performance_context: {
      active_months: args.marketingContext.performance_window.filter((month) => activeMonths.has(month.month)),
      matching_creatives: matchingCreatives
    },
    knowledge_matches: knowledgeMatches
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

async function loadClusterPeriodSeries(args: {
  corpusId: string;
  term: string;
  memberMentionIds: string[];
  granularity: "month" | "week";
}): Promise<SignalPulseClusterPromptContext["period_series"]> {
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

  const volumes: number[] = [];
  return rows.map((row) => {
    const previous = volumes.at(-1) ?? 0;
    const volume = Number(row.volume ?? 0);
    volumes.push(volume);
    return {
      granularity: args.granularity,
      label: row.label,
      period_start: row.period_start,
      period_end: row.period_end,
      volume,
      delta_prev: volumes.length > 1 ? volume - previous : null,
      engagement: Number(row.engagement ?? 0),
      sentiment_avg: numberOrNull(row.sentiment_avg),
      source_mix: row.source_mix ?? {},
      lifecycle_state: classifySignalPulseLifecycle({
        currentVolume: volume,
        previousVolume: previous,
        periodsSeen: volumes.filter((item) => item > 0).length,
        volatility: volatility(volumes)
      })
    };
  });
}

async function retrieveKnowledgeMatches(args: {
  ctx: SignalPulseContextScope;
  cluster: ClusterContextInput;
  marketingBrief: Record<string, unknown>;
}): Promise<SignalPulseKnowledgeMatch[]> {
  if (!hasEmbeddingProvider()) return [];
  const query = buildClusterKnowledgeQuery(args.cluster, args.marketingBrief);
  if (!query) return [];
  try {
    const embeddingModel = getEmbeddingModel();
    const [embedded] = await embedTexts({
      inputs: [{ id: args.cluster.id, text: query }],
      model: embeddingModel,
      batchSize: 1,
      inputType: "query"
    });
    if (!embedded) return [];
    const rows = (await pool.query<{
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
        LIMIT 6
      `,
      [
        args.ctx.study_corpus_id,
        vectorLiteral(embedded.embedding),
        embeddingModel,
        args.ctx.brand_id,
        args.ctx.organization_id
      ]
    )).rows;
    return rows.map((row) => ({
      title: row.title,
      source_kind: row.source_kind,
      text: row.text.slice(0, 900),
      similarity: numberOrNull(row.similarity)
    }));
  } catch (error) {
    console.warn(`[signal-pulse-rag] knowledge retrieval skipped: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function loadMatchingCreatives(args: {
  corpusId: string;
  term: string;
}): Promise<SignalPulseClusterPromptContext["performance_context"]["matching_creatives"]> {
  const normalized = normalizeText(args.term);
  if (normalized.length < 4) return [];
  const pattern = `%${escapeLike(normalized)}%`;
  const rows = (await pool.query<{
    record_date: string;
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
        record_date::text,
        platform,
        channel,
        entity_kind,
        entity_name,
        objective,
        COALESCE(spend, 0)::text AS spend,
        COALESCE(impressions, 0)::text AS impressions,
        COALESCE(clicks, 0)::text AS clicks,
        COALESCE(engagement, 0)::text AS engagement,
        creative_text
      FROM performance_records
      WHERE study_corpus_id = $1
        AND translate(lower(COALESCE(creative_text, '') || ' ' || COALESCE(entity_name, '') || ' ' || COALESCE(objective, '')), 'áéíóúüñ', 'aeiouun') LIKE $2
      ORDER BY record_date DESC, COALESCE(engagement, 0) DESC, COALESCE(spend, 0) DESC
      LIMIT 8
    `,
    [args.corpusId, pattern]
  )).rows;
  return rows.map((row) => ({
    record_date: row.record_date,
    platform: row.platform,
    channel: row.channel,
    entity_kind: row.entity_kind,
    entity_name: row.entity_name,
    objective: row.objective,
    spend: Number(row.spend ?? 0),
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    engagement: Number(row.engagement ?? 0),
    creative_text: row.creative_text ? row.creative_text.slice(0, 320) : null
  }));
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

function buildClusterKnowledgeQuery(cluster: ClusterContextInput, marketingBrief: Record<string, unknown>) {
  return [
    cluster.term,
    cluster.currentTitle,
    cluster.platforms.join(" "),
    cluster.discoveryPeriods.join(" "),
    ...cluster.samples.slice(0, 3).map((sample) => sample.text),
    JSON.stringify(marketingBrief).slice(0, 1200)
  ].filter(Boolean).join("\n").slice(0, 3600);
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

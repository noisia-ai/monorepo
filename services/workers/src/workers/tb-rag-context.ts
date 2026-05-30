import type { TbRagPromptContext } from "@noisia/query-engine";
import type { QueryResultRow } from "pg";
import { pool } from "../db/client";
import { loadAnalysisRagContext } from "./analysis-rag-context";
import { describeCorpusSqlVirtualSchema, runCorpusSql, type CorpusSqlResult } from "./corpus-sql";

type AnalysisScopeRow = {
  study_corpus_id: string;
  brand_id: string | null;
};

export async function loadTbRagPromptContext(tbAnalysisId: string): Promise<TbRagPromptContext> {
  const scope = await loadAnalysisScope(tbAnalysisId);
  const rag = await loadAnalysisRagContext(scope.study_corpus_id, scope.brand_id);

  return {
    query_strategy_brief: rag.queryStrategyBrief,
    knowledge_sources: rag.knowledgeSources
      .filter((source) => source.type !== "query_strategy_brief")
      .slice(0, 8)
      .map((source) => ({
        type: source.type,
        content: compactForPrompt(source.content)
      })),
    corpus_intelligence: await loadCorpusIntelligenceSnapshot(tbAnalysisId)
  };
}

async function loadAnalysisScope(tbAnalysisId: string): Promise<AnalysisScopeRow> {
  const result = await pool.query<AnalysisScopeRow>(
    `SELECT ta.study_corpus_id, sc.brand_id
     FROM tb_analyses ta
     JOIN study_corpora sc ON sc.id = ta.study_corpus_id
     WHERE ta.id = $1`,
    [tbAnalysisId]
  );
  const row = result.rows[0];
  if (!row) throw new Error(`tb_analyses ${tbAnalysisId} not found`);
  return row;
}

function compactForPrompt(value: unknown) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    title: typeof record.title === "string" ? record.title : undefined,
    summary: typeof record.summary === "string" ? record.summary.slice(0, 900) : undefined,
    recommended_use: Array.isArray(record.recommended_use) ? record.recommended_use.slice(0, 6) : undefined,
    priority_topics: Array.isArray(record.priority_topics) ? record.priority_topics.slice(0, 8) : undefined,
    competitor_clues: Array.isArray(record.competitor_clues) ? record.competitor_clues.slice(0, 8) : undefined,
    raw_text_excerpt:
      typeof record.raw_text_excerpt === "string"
        ? record.raw_text_excerpt.slice(0, 900)
        : typeof record.raw_text === "string"
          ? record.raw_text.slice(0, 900)
          : undefined
  };
}

async function loadCorpusIntelligenceSnapshot(tbAnalysisId: string) {
  const [overview, channels, entityMix, findingQuant, openSignals, temporal] = await Promise.all([
    safeRunCorpusSql<{
      total_mentions: number;
      period_start: string | null;
      period_end: string | null;
      coded_mentions: number;
      uncoded_mentions: number;
    }>({
      label: "overview",
      tbAnalysisId,
      sql: `
        SELECT
          COUNT(DISTINCT sm.mention_id)::int AS total_mentions,
          MIN(sm.published_at)::text AS period_start,
          MAX(sm.published_at)::text AS period_end,
          COUNT(DISTINCT fc.mention_id)::int AS coded_mentions,
          (COUNT(DISTINCT sm.mention_id) - COUNT(DISTINCT fc.mention_id))::int AS uncoded_mentions
        FROM scoped_mentions sm
        LEFT JOIN finding_codings fc ON fc.mention_id = sm.mention_id
      `,
      limit: 1
    }),
    safeRunCorpusSql<{ platform: string | null; mention_count: number; coded_count: number }>({
      label: "channels",
      tbAnalysisId,
      sql: `
        SELECT
          CASE
            WHEN lower(COALESCE(sm.raw_metadata #>> '{row,domain group}', '')) LIKE '%tiktok%'
              OR lower(COALESCE(sm.raw_metadata #>> '{row,domain}', '')) LIKE '%tiktok%'
              OR lower(COALESCE(sm.source_url, '')) LIKE '%tiktok%' THEN 'tiktok'
            WHEN lower(COALESCE(sm.raw_metadata #>> '{row,domain group}', '')) LIKE '%instagram%'
              OR lower(COALESCE(sm.raw_metadata #>> '{row,domain}', '')) LIKE '%instagram%'
              OR lower(COALESCE(sm.source_url, '')) LIKE '%instagram%' THEN 'instagram'
            WHEN lower(COALESCE(sm.raw_metadata #>> '{row,domain group}', '')) LIKE '%twitter%'
              OR lower(COALESCE(sm.raw_metadata #>> '{row,domain group}', '')) = 'x'
              OR lower(COALESCE(sm.raw_metadata #>> '{row,domain}', '')) LIKE '%twitter%'
              OR lower(COALESCE(sm.raw_metadata #>> '{row,domain}', '')) LIKE '%x.com%'
              OR lower(COALESCE(sm.source_url, '')) LIKE '%twitter.com%'
              OR lower(COALESCE(sm.source_url, '')) LIKE '%x.com%' THEN 'x'
            WHEN lower(COALESCE(sm.raw_metadata #>> '{row,domain group}', '')) LIKE '%facebook%'
              OR lower(COALESCE(sm.raw_metadata #>> '{row,domain}', '')) LIKE '%facebook%'
              OR lower(COALESCE(sm.source_url, '')) LIKE '%facebook%' THEN 'facebook'
            WHEN lower(COALESCE(sm.raw_metadata #>> '{row,domain group}', '')) LIKE '%youtube%'
              OR lower(COALESCE(sm.raw_metadata #>> '{row,domain}', '')) LIKE '%youtube%'
              OR lower(COALESCE(sm.source_url, '')) LIKE '%youtube%'
              OR lower(COALESCE(sm.source_url, '')) LIKE '%youtu.be%' THEN 'youtube'
            WHEN lower(COALESCE(sm.raw_metadata #>> '{row,domain group}', '')) LIKE '%reddit%'
              OR lower(COALESCE(sm.raw_metadata #>> '{row,domain}', '')) LIKE '%reddit%'
              OR lower(COALESCE(sm.source_url, '')) LIKE '%reddit%' THEN 'reddit'
            ELSE sm.platform
          END AS platform,
          COUNT(DISTINCT sm.mention_id)::int AS mention_count,
          COUNT(DISTINCT fc.mention_id)::int AS coded_count
        FROM scoped_mentions sm
        LEFT JOIN finding_codings fc ON fc.mention_id = sm.mention_id
        GROUP BY 1
        ORDER BY mention_count DESC
      `,
      limit: 12
    }),
    safeRunCorpusSql<{ entity_kind: string | null; entity_label: string | null; mention_count: number }>({
      label: "entity_mix",
      tbAnalysisId,
      sql: `
        SELECT
          COALESCE(sm.entity_kind, sm.mention_type, 'unknown') AS entity_kind,
          COALESCE(sm.entity_label, sm.mention_type, 'Sin etiqueta') AS entity_label,
          COUNT(DISTINCT sm.mention_id)::int AS mention_count
        FROM scoped_mentions sm
        GROUP BY 1, 2
        ORDER BY mention_count DESC
      `,
      limit: 20
    }),
    safeRunCorpusSql<{
      finding_id: string;
      finding_name: string;
      polarity: string;
      layer: string | null;
      mention_count: number;
      avg_intensity: number | null;
      first_seen: string | null;
      last_seen: string | null;
      dominant_channel: string | null;
    }>({
      label: "finding_quantification",
      tbAnalysisId,
      sql: `
        WITH finding_counts AS (
          SELECT
            fc.finding_id,
            fc.finding_name,
            fc.polarity,
            fc.layer,
            COUNT(DISTINCT fc.mention_id)::int AS mention_count,
            AVG(fc.intensity_score)::float AS avg_intensity,
            MIN(fc.published_at)::text AS first_seen,
            MAX(fc.published_at)::text AS last_seen
          FROM finding_codings fc
          WHERE fc.finding_id IS NOT NULL
          GROUP BY fc.finding_id, fc.finding_name, fc.polarity, fc.layer
        ),
        channel_rank AS (
          SELECT
            finding_id,
            CASE
              WHEN lower(COALESCE(raw_metadata #>> '{row,domain group}', '')) LIKE '%tiktok%'
                OR lower(COALESCE(raw_metadata #>> '{row,domain}', '')) LIKE '%tiktok%'
                OR lower(COALESCE(source_url, '')) LIKE '%tiktok%' THEN 'tiktok'
              WHEN lower(COALESCE(raw_metadata #>> '{row,domain group}', '')) LIKE '%instagram%'
                OR lower(COALESCE(raw_metadata #>> '{row,domain}', '')) LIKE '%instagram%'
                OR lower(COALESCE(source_url, '')) LIKE '%instagram%' THEN 'instagram'
              WHEN lower(COALESCE(raw_metadata #>> '{row,domain group}', '')) LIKE '%twitter%'
                OR lower(COALESCE(raw_metadata #>> '{row,domain group}', '')) = 'x'
                OR lower(COALESCE(raw_metadata #>> '{row,domain}', '')) LIKE '%twitter%'
                OR lower(COALESCE(raw_metadata #>> '{row,domain}', '')) LIKE '%x.com%'
                OR lower(COALESCE(source_url, '')) LIKE '%twitter.com%'
                OR lower(COALESCE(source_url, '')) LIKE '%x.com%' THEN 'x'
              ELSE platform
            END AS platform,
            COUNT(*)::int AS mentions,
            ROW_NUMBER() OVER (PARTITION BY finding_id ORDER BY COUNT(*) DESC) AS rn
          FROM finding_codings
          WHERE finding_id IS NOT NULL
          GROUP BY finding_id, 2
        )
        SELECT
          f.finding_id,
          f.finding_name,
          f.polarity,
          f.layer,
          f.mention_count,
          f.avg_intensity,
          f.first_seen,
          f.last_seen,
          c.platform AS dominant_channel
        FROM finding_counts f
        LEFT JOIN channel_rank c ON c.finding_id = f.finding_id AND c.rn = 1
        ORDER BY f.mention_count DESC
      `,
      limit: 40
    }),
    safeRunCorpusSql<{ tag: string; mention_count: number; sample_quote: string | null; dominant_channel: string | null }>({
      label: "open_signal_candidates",
      tbAnalysisId,
      sql: `
        WITH noisy_tags AS (
          SELECT
            lower(trim(tag)) AS tag,
            fc.mention_id,
            CASE
              WHEN lower(COALESCE(fc.raw_metadata #>> '{row,domain group}', '')) LIKE '%tiktok%'
                OR lower(COALESCE(fc.raw_metadata #>> '{row,domain}', '')) LIKE '%tiktok%'
                OR lower(COALESCE(fc.source_url, '')) LIKE '%tiktok%' THEN 'tiktok'
              WHEN lower(COALESCE(fc.raw_metadata #>> '{row,domain group}', '')) LIKE '%instagram%'
                OR lower(COALESCE(fc.raw_metadata #>> '{row,domain}', '')) LIKE '%instagram%'
                OR lower(COALESCE(fc.source_url, '')) LIKE '%instagram%' THEN 'instagram'
              WHEN lower(COALESCE(fc.raw_metadata #>> '{row,domain group}', '')) LIKE '%twitter%'
                OR lower(COALESCE(fc.raw_metadata #>> '{row,domain group}', '')) = 'x'
                OR lower(COALESCE(fc.raw_metadata #>> '{row,domain}', '')) LIKE '%twitter%'
                OR lower(COALESCE(fc.raw_metadata #>> '{row,domain}', '')) LIKE '%x.com%'
                OR lower(COALESCE(fc.source_url, '')) LIKE '%twitter.com%'
                OR lower(COALESCE(fc.source_url, '')) LIKE '%x.com%' THEN 'x'
              ELSE fc.platform
            END AS platform,
            fc.text_clean
          FROM finding_codings fc
          CROSS JOIN LATERAL unnest(fc.emergent_tags) AS tags(tag)
          WHERE (fc.finding_id IS NULL OR fc.polarity = 'irrelevant' OR fc.ambiguous = true)
            AND lower(trim(tag)) <> 'irrelevant'
            AND length(trim(tag)) > 2
        ),
        tag_counts AS (
          SELECT tag, COUNT(DISTINCT mention_id)::int AS mention_count, MIN(text_clean) AS sample_quote
          FROM noisy_tags
          GROUP BY tag
        ),
        channel_rank AS (
          SELECT tag, platform, COUNT(*)::int AS mentions,
                 ROW_NUMBER() OVER (PARTITION BY tag ORDER BY COUNT(*) DESC) AS rn
          FROM noisy_tags
          GROUP BY tag, platform
        )
        SELECT
          t.tag,
          t.mention_count,
          t.sample_quote,
          c.platform AS dominant_channel
        FROM tag_counts t
        LEFT JOIN channel_rank c ON c.tag = t.tag AND c.rn = 1
        ORDER BY t.mention_count DESC
      `,
      limit: 24,
      timeoutMs: 30_000
    }),
    safeRunCorpusSql<{ month: string; mention_count: number; coded_count: number }>({
      label: "temporal_coverage",
      tbAnalysisId,
      sql: `
        SELECT
          to_char(date_trunc('month', sm.published_at), 'YYYY-MM') AS month,
          COUNT(DISTINCT sm.mention_id)::int AS mention_count,
          COUNT(DISTINCT fc.mention_id)::int AS coded_count
        FROM scoped_mentions sm
        LEFT JOIN finding_codings fc ON fc.mention_id = sm.mention_id
        WHERE sm.published_at IS NOT NULL
        GROUP BY month
        ORDER BY month ASC
      `,
      limit: 36
    })
  ]);

  return {
    source: "corpus_sql",
    virtual_schema: describeCorpusSqlVirtualSchema(),
    coverage: overview.rows[0] ?? null,
    channel_distribution: channels.rows,
    entity_mix: entityMix.rows,
    finding_quantification: findingQuant.rows,
    open_signal_candidates: openSignals.rows,
    temporal_coverage: temporal.rows
  };
}

async function safeRunCorpusSql<T extends QueryResultRow>(
  args: Parameters<typeof runCorpusSql<T>>[0] & { label: string }
): Promise<CorpusSqlResult<T>> {
  const { label, ...sqlArgs } = args;
  try {
    return await runCorpusSql<T>(sqlArgs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[tb-rag-context] corpus_sql ${label} skipped: ${message}`);
    return { rows: [], rowCount: 0, limit: sqlArgs.limit ?? 500 };
  }
}

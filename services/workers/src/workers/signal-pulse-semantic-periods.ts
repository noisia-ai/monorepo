import { pool } from "../db/client";

const SIGNAL_PERIOD_SEMANTIC_SEED_LIMIT = 8;
const SIGNAL_PERIOD_SEMANTIC_NEIGHBOR_LIMIT = 180;
const SIGNAL_PERIOD_SEMANTIC_MIN_SIMILARITY = 0.74;

export type SignalPulseSemanticPeriodRow = {
  label: string;
  period_start: string;
  period_end: string;
  volume: number;
  engagement: number;
  sentiment_avg: number | null;
  source_mix: Record<string, number>;
};

export type SignalPulseSemanticPeriodMentions = {
  count: number;
  sentiment_avg: number | null;
  engagement_sum: number;
  source_mix: Record<string, number>;
  samples: Array<{ id: string; quote: string | null; platform: string | null; published_at: string | null }>;
  match_strategy: "semantic_neighborhood_v1";
};

export async function hasSignalPulseSemanticSeeds(args: {
  corpusId: string;
  memberMentionIds: string[];
}) {
  if (args.memberMentionIds.length === 0) return false;
  const row = (await pool.query<{ count: number }>(
    `
      SELECT COUNT(*)::int AS count
      FROM semantic_embeddings se
      WHERE se.study_corpus_id = $1
        AND se.scope_type = 'mention'
        AND se.mention_id = ANY($2::uuid[])
    `,
    [args.corpusId, args.memberMentionIds]
  )).rows[0];
  return Number(row?.count ?? 0) > 0;
}

export async function loadSignalPulseSemanticPeriodMentions(args: {
  corpusId: string;
  memberMentionIds: string[];
  periodStart: string;
  periodEnd: string;
  semanticSeedsAvailable?: boolean;
}): Promise<SignalPulseSemanticPeriodMentions | null> {
  const hasSeeds = args.semanticSeedsAvailable ?? await hasSignalPulseSemanticSeeds({
    corpusId: args.corpusId,
    memberMentionIds: args.memberMentionIds
  });
  if (!hasSeeds) return null;

  const rows = await queryRowsWithTimeout<{
    count: number;
    sentiment_avg: string | null;
    engagement_sum: string | null;
    source_mix: Record<string, number> | null;
    samples: Array<{ id: string; quote: string | null; platform: string | null; published_at: string | null }> | null;
  }>(
    `
      WITH seed_embeddings AS (
        SELECT se.embedding, se.embedding_model
        FROM semantic_embeddings se
        WHERE se.study_corpus_id = $1
          AND se.scope_type = 'mention'
          AND se.mention_id = ANY($4::uuid[])
        ORDER BY se.created_at DESC
        LIMIT ${SIGNAL_PERIOD_SEMANTIC_SEED_LIMIT}
      ),
      semantic_neighbors AS (
        SELECT DISTINCT ON (neighbor.mention_id)
          neighbor.mention_id,
          (1 - (neighbor.embedding <=> seed.embedding)) AS similarity
        FROM seed_embeddings seed
        JOIN LATERAL (
          SELECT se.mention_id, se.embedding
          FROM semantic_embeddings se
          JOIN mentions m ON m.id = se.mention_id
          WHERE se.study_corpus_id = $1
            AND se.scope_type = 'mention'
            AND se.embedding_model = seed.embedding_model
            AND m.inclusion_status = 'included'
            AND m.published_at >= $2::date
            AND m.published_at < ($3::date + interval '1 day')
            AND length(m.text_clean) >= 24
          ORDER BY se.embedding <=> seed.embedding
          LIMIT ${SIGNAL_PERIOD_SEMANTIC_NEIGHBOR_LIMIT}
        ) neighbor ON true
        WHERE (1 - (neighbor.embedding <=> seed.embedding)) >= $5
        ORDER BY neighbor.mention_id, similarity DESC
      ),
      matched AS (
        SELECT
          m.id,
          m.text_clean,
          m.text_snippet,
          COALESCE(NULLIF(m.resolved_platform, ''), m.platform, 'unknown') AS platform,
          m.published_at,
          m.sentiment_score,
          CASE
            WHEN COALESCE(m.engagement->>'total', m.engagement->>'interactions', m.engagement->>'engagement', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
            THEN COALESCE(m.engagement->>'total', m.engagement->>'interactions', m.engagement->>'engagement')::numeric
            ELSE 0
          END AS engagement_score
        FROM semantic_neighbors sn
        JOIN mentions m ON m.id = sn.mention_id
      ),
      source_counts AS (
        SELECT platform, COUNT(*)::int AS count
        FROM matched
        GROUP BY platform
      ),
      sample_rows AS (
        SELECT id::text, COALESCE(text_snippet, left(text_clean, 280)) AS quote, platform, published_at::text
        FROM matched
        ORDER BY engagement_score DESC NULLS LAST, published_at DESC
        LIMIT 8
      )
      SELECT
        (SELECT COUNT(*)::int FROM matched) AS count,
        (SELECT AVG(sentiment_score)::text FROM matched WHERE sentiment_score IS NOT NULL) AS sentiment_avg,
        (SELECT COALESCE(SUM(engagement_score), 0)::text FROM matched) AS engagement_sum,
        (SELECT COALESCE(jsonb_object_agg(platform, count), '{}'::jsonb) FROM source_counts) AS source_mix,
        (SELECT COALESCE(jsonb_agg(sample_rows), '[]'::jsonb) FROM sample_rows) AS samples
    `,
    [
      args.corpusId,
      args.periodStart,
      args.periodEnd,
      args.memberMentionIds,
      SIGNAL_PERIOD_SEMANTIC_MIN_SIMILARITY
    ]
  );
  const row = rows[0];
  return {
    count: Number(row?.count ?? 0),
    sentiment_avg: numberOrNull(row?.sentiment_avg),
    engagement_sum: Number(row?.engagement_sum ?? 0),
    source_mix: row?.source_mix ?? {},
    samples: Array.isArray(row?.samples) ? row.samples : [],
    match_strategy: "semantic_neighborhood_v1"
  };
}

export async function loadSignalPulseSemanticPeriodSeriesRows(args: {
  corpusId: string;
  memberMentionIds: string[];
  granularity: "month" | "week";
}): Promise<SignalPulseSemanticPeriodRow[] | null> {
  const hasSeeds = await hasSignalPulseSemanticSeeds({
    corpusId: args.corpusId,
    memberMentionIds: args.memberMentionIds
  });
  if (!hasSeeds) return null;

  const rows = await queryRowsWithTimeout<{
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
        WHERE study_corpus_id = $1 AND granularity = $3
      ),
      seed_embeddings AS (
        SELECT se.embedding, se.embedding_model
        FROM semantic_embeddings se
        WHERE se.study_corpus_id = $1
          AND se.scope_type = 'mention'
          AND se.mention_id = ANY($2::uuid[])
        ORDER BY se.created_at DESC
        LIMIT ${SIGNAL_PERIOD_SEMANTIC_SEED_LIMIT}
      ),
      semantic_neighbors AS (
        SELECT DISTINCT ON (p.label, neighbor.mention_id)
          p.label,
          p.period_start,
          p.period_end,
          neighbor.mention_id,
          (1 - (neighbor.embedding <=> seed.embedding)) AS similarity
        FROM periods p
        CROSS JOIN seed_embeddings seed
        JOIN LATERAL (
          SELECT se.mention_id, se.embedding
          FROM semantic_embeddings se
          JOIN mentions m ON m.id = se.mention_id
          WHERE se.study_corpus_id = $1
            AND se.scope_type = 'mention'
            AND se.embedding_model = seed.embedding_model
            AND m.inclusion_status = 'included'
            AND m.published_at >= p.period_start
            AND m.published_at < (p.period_end + interval '1 day')
            AND length(m.text_clean) >= 24
          ORDER BY se.embedding <=> seed.embedding
          LIMIT ${SIGNAL_PERIOD_SEMANTIC_NEIGHBOR_LIMIT}
        ) neighbor ON true
        WHERE (1 - (neighbor.embedding <=> seed.embedding)) >= $4
        ORDER BY p.label, neighbor.mention_id, similarity DESC
      ),
      matched AS (
        SELECT
          sn.label,
          sn.period_start,
          sn.period_end,
          m.id,
          m.sentiment_score,
          COALESCE(NULLIF(m.resolved_platform, ''), m.platform, 'unknown') AS platform,
          CASE
            WHEN COALESCE(m.engagement->>'total', m.engagement->>'interactions', m.engagement->>'engagement', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
            THEN COALESCE(m.engagement->>'total', m.engagement->>'interactions', m.engagement->>'engagement')::numeric
            ELSE 0
          END AS engagement_score
        FROM semantic_neighbors sn
        JOIN mentions m ON m.id = sn.mention_id
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
    [
      args.corpusId,
      args.memberMentionIds,
      args.granularity,
      SIGNAL_PERIOD_SEMANTIC_MIN_SIMILARITY
    ]
  );

  return rows.map((row) => ({
    label: row.label,
    period_start: row.period_start,
    period_end: row.period_end,
    volume: Number(row.volume ?? 0),
    engagement: Number(row.engagement ?? 0),
    sentiment_avg: numberOrNull(row.sentiment_avg),
    source_mix: row.source_mix ?? {}
  }));
}

async function queryRowsWithTimeout<T extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '120s'");
    const result = await client.query<T>(sql, params);
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

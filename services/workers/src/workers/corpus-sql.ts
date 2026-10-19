import type { QueryResultRow } from "pg";

import { pool } from "../db/client";

export type CorpusSqlResult<T extends QueryResultRow = QueryResultRow> = {
  rows: T[];
  rowCount: number;
  limit: number;
};

type CorpusSqlArgs = {
  tbAnalysisId: string;
  sql: string;
  limit?: number;
  timeoutMs?: number;
};

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;
const DEFAULT_TIMEOUT_MS = 15_000;
const ALLOWED_SOURCES = ["scoped_mentions", "findings", "finding_codings"] as const;
const BLOCKED_TOKENS = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|call|execute|prepare|deallocate|set|reset|vacuum|analyze|listen|notify)\b/i;

/**
 * Read-only SQL surface for Corpus Intelligence.
 *
 * The caller can query only virtual CTEs that are already scoped server-side to
 * the tb_analysis snapshot. Raw production table names are intentionally not
 * exposed to prompts. The outer SELECT applies a hard LIMIT and statement
 * timeout even when the inner query forgets to.
 */
export async function runCorpusSql<T extends QueryResultRow = QueryResultRow>({
  tbAnalysisId,
  sql,
  limit = DEFAULT_LIMIT,
  timeoutMs = DEFAULT_TIMEOUT_MS
}: CorpusSqlArgs): Promise<CorpusSqlResult<T>> {
  const cleanSql = validateCorpusSql(sql);
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT);
  const safeTimeout = Math.min(Math.max(500, Math.floor(timeoutMs)), 30_000);
  const client = await pool.connect();

  try {
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL statement_timeout = '${safeTimeout}ms'`);
    const result = await client.query<T>(
      `
        WITH analysis_scope AS (
          SELECT id AS tb_analysis_id, study_corpus_id, snapshot_id,
            workspace_id, strategic_contract_version
          FROM tb_analyses
          WHERE id = $1::uuid
          LIMIT 1
        ),
        scoped_roots AS (
          SELECT csm.mention_id
          FROM analysis_scope s
          JOIN corpus_snapshot_mentions csm ON csm.snapshot_id=s.snapshot_id
          WHERE s.strategic_contract_version IS DISTINCT FROM 'signal-tb-strategic-v2'
          UNION ALL
          SELECT sealed.mention_id
          FROM analysis_scope s
          JOIN signal_strategic_run_controls control
            ON control.tb_analysis_id=s.tb_analysis_id
          JOIN signal_strategic_sealed_sample_items sealed
            ON sealed.run_control_id=control.id
          WHERE s.strategic_contract_version='signal-tb-strategic-v2'
        ),
        scoped_mentions AS (
          SELECT
            m.id AS mention_id,
            m.text_clean,
            m.text_snippet,
            NULLIF(m.platform, '') AS platform,
            NULLIF(m.platform, '') AS content_type,
            m.url AS source_url,
            m.published_at,
            m.language,
            m.sentiment_source,
            m.sentiment_score,
            CASE WHEN s.strategic_contract_version='signal-tb-strategic-v2'
              THEN semantic.scope ELSE ib.mention_type END AS mention_type,
            CASE WHEN s.strategic_contract_version='signal-tb-strategic-v2'
              THEN semantic.scope ELSE ib.entity_kind END AS entity_kind,
            CASE WHEN s.strategic_contract_version='signal-tb-strategic-v2'
              THEN semantic.entity_label ELSE ib.entity_label END AS entity_label,
            CASE WHEN s.strategic_contract_version='signal-tb-strategic-v2'
                   AND semantic.scope='competitor'
              THEN semantic.entity_id ELSE ib.competitor_id END AS competitor_id,
            m.inclusion_status,
            m.engagement,
            m.raw_metadata
          FROM analysis_scope s
          JOIN scoped_roots root ON true
          JOIN mentions m ON m.id = root.mention_id
          LEFT JOIN import_batches ib
            ON ib.id=m.source_file_id
           AND s.strategic_contract_version IS DISTINCT FROM 'signal-tb-strategic-v2'
          LEFT JOIN LATERAL (
            SELECT assertion.scope,assertion.entity_id,assertion.entity_label
            FROM signal_mention_attributions assertion
            WHERE assertion.workspace_id=s.workspace_id
              AND assertion.mention_id=m.id
              AND assertion.attribution_basis='mention_semantic'
              AND assertion.is_current=true
              AND assertion.review_status='approved'
              AND assertion.eligibility_status='eligible'
              AND s.strategic_contract_version='signal-tb-strategic-v2'
            ORDER BY CASE assertion.scope
              WHEN 'primary_brand' THEN 0 WHEN 'competitor' THEN 1
              WHEN 'category' THEN 2 WHEN 'reference' THEN 3 ELSE 4 END,
              assertion.entity_id NULLS LAST,assertion.id
            LIMIT 1
          ) semantic ON true
        ),
        findings AS (
          SELECT
            f.id AS finding_uuid,
            f.finding_id,
            f.polarity,
            f.layer,
            f.nombre_comercial,
            f.frecuencia,
            f.intensidad_promedio,
            f.capacidad_predictiva,
            f.score_compuesto,
            f.movilidad,
            f.confidence,
            f.period_start,
            f.period_end
          FROM analysis_scope s
          JOIN tb_findings f ON f.tb_analysis_id = s.tb_analysis_id
        ),
        finding_codings AS (
          SELECT
            c.mention_id,
            f.finding_id,
            f.nombre_comercial AS finding_name,
            c.polarity,
            c.layer,
            c.intensity_score,
            c.emergent_tags,
            c.ambiguous,
            sm.platform,
            sm.published_at,
            sm.mention_type,
            sm.entity_kind,
            sm.entity_label,
            sm.content_type,
            sm.source_url,
            sm.raw_metadata,
            sm.text_clean
          FROM analysis_scope s
          JOIN tb_mention_codings c ON c.tb_analysis_id = s.tb_analysis_id
          JOIN scoped_mentions sm ON sm.mention_id = c.mention_id
          LEFT JOIN tb_findings f ON f.id = c.finding_id
        )
        SELECT *
        FROM (${cleanSql}) corpus_sql_result
        LIMIT ${safeLimit}
      `,
      [tbAnalysisId]
    );
    await client.query("COMMIT");
    return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length, limit: safeLimit };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function describeCorpusSqlVirtualSchema() {
  return {
    allowed_sources: ALLOWED_SOURCES,
    rules: [
      "SELECT only",
      "No raw tables; use scoped_mentions, findings, finding_codings",
      "Scope is forced by tb_analysis_id server-side",
      `LIMIT is forced, max ${MAX_LIMIT}`,
      "Statement timeout is enforced"
    ],
    scoped_mentions: [
      "mention_id", "text_clean", "text_snippet", "platform", "published_at", "language",
      "sentiment_source", "sentiment_score", "content_type", "mention_type", "entity_kind", "entity_label",
      "competitor_id", "inclusion_status", "engagement", "source_url", "raw_metadata"
    ],
    findings: [
      "finding_uuid", "finding_id", "polarity", "layer", "nombre_comercial", "frecuencia",
      "intensidad_promedio", "capacidad_predictiva", "score_compuesto", "movilidad",
      "confidence", "period_start", "period_end"
    ],
    finding_codings: [
      "mention_id", "finding_id", "finding_name", "polarity", "layer", "intensity_score",
      "emergent_tags", "ambiguous", "platform", "published_at", "mention_type", "content_type",
      "entity_kind", "entity_label", "source_url", "raw_metadata", "text_clean"
    ]
  };
}

function validateCorpusSql(sql: string) {
  const clean = sql.trim().replace(/;+\s*$/, "");
  if (!/^(select|with)\b/i.test(clean)) {
    throw new Error("corpus_sql only allows SELECT statements.");
  }
  if (clean.includes(";") || /--|\/\*/.test(clean)) {
    throw new Error("corpus_sql does not allow multiple statements or SQL comments.");
  }
  if (BLOCKED_TOKENS.test(clean)) {
    throw new Error("corpus_sql blocked a non-readonly token.");
  }
  if (/\b(from|join)\s+(pg_[a-z_]*|information_schema|public\.|mentions|tb_[a-z_]*|brand_knowledge_sources|published_outputs|users|organizations|brands|competitors)\b/i.test(clean)) {
    throw new Error("corpus_sql only allows virtual scoped sources, not raw tables.");
  }
  if (!ALLOWED_SOURCES.some((source) => new RegExp(`\\b${source}\\b`, "i").test(clean))) {
    throw new Error("corpus_sql must query one of: scoped_mentions, findings, finding_codings.");
  }
  return clean;
}

import type { Job } from "bullmq";

import { getEngineMethodologySpec, isEngineRunnableMethodologySlug } from "@noisia/query-engine";
import { pool } from "../db/client";
import {
  enqueueEngineStep,
  markEngineStepCompleted,
  markEngineStepFailed,
  markEngineStepRunning,
  releaseEngineCorpusLock
} from "./engine-shared";
import { buildEngineCorpusScopeIds } from "./engine-scope";
import { safeJsonStringifyForPostgres, sanitizeUnicodeForPostgresText } from "./postgres-json";

type EngineStepJobData = {
  engineAnalysisId: string;
  pipelineStepId: string;
};

type AnalysisRow = {
  study_corpus_id: string;
  base_corpus_id: string | null;
  snapshot_id: string | null;
  methodology_slug: string;
  params: Record<string, unknown> | null;
};

type UnitRow = {
  external_ref: string;
  study_corpus_id: string;
  entity_id: string | null;
  entity_hint: string | null;
  text: string;
  platform: string | null;
  published_at: string | null;
};

type UnitLoadResult = {
  units: UnitRow[];
  eligibleUnits: number;
};

export async function engineRetrieveJob(job: Job<EngineStepJobData>) {
  const { engineAnalysisId, pipelineStepId } = job.data;
  await markEngineStepRunning(pipelineStepId);
  await job.updateProgress(10);

  try {
    const analysis = await loadAnalysis(engineAnalysisId);
    if (!isEngineRunnableMethodologySlug(analysis.methodology_slug)) {
      throw new Error(`Unsupported or read-only engine methodology slug: ${analysis.methodology_slug}`);
    }
    const spec = getEngineMethodologySpec(analysis.methodology_slug);
    const maxUnits = readMaxUnits(analysis.params);
    const loaded = await loadUnits(engineAnalysisId, analysis, maxUnits);
    const units = loaded.units;
    const truncated = loaded.eligibleUnits > units.length;
    if (truncated) {
      await appendLimitation(
        engineAnalysisId,
        `Engine ${analysis.methodology_slug} coded ${units.length}/${loaded.eligibleUnits} eligible mentions because max_units=${maxUnits}; output must be treated as directional unless the study package intentionally sets a larger budget.`
      );
    }
    await job.updateProgress(70);

    await pool.query(
      `UPDATE engine_analyses
       SET meta_json = COALESCE(meta_json, '{}'::jsonb) || $1::jsonb,
           updated_at = NOW()
       WHERE id = $2`,
      [
        safeJsonStringifyForPostgres({
          retrieval: {
            unit_kind: spec.unitKind,
            max_units: maxUnits,
            eligible_units: loaded.eligibleUnits,
            retrieved_units: units.length,
            truncated,
            materialized_run_map: true,
            materialized_run_map_table: "engine_run_mention_map",
            units_in_meta: false,
            selection_policy: analysis.snapshot_id
              ? "snapshot_scoped_materialized_run_map_ranked_by_provenance_quality"
              : "live_corpus_materialized_run_map_ranked_by_provenance_quality",
            snapshot_id: analysis.snapshot_id,
            unit_preview: units.slice(0, 5).map((unit) => ({
              external_ref: unit.external_ref,
              study_corpus_id: unit.study_corpus_id,
              entity_id: unit.entity_id,
              entity_hint: unit.entity_hint,
              platform: unit.platform,
              published_at: unit.published_at
            }))
          }
        }),
        engineAnalysisId
      ]
    );

    await markEngineStepCompleted({
      pipelineStepId,
      resultSummary: {
        unit_kind: spec.unitKind,
        units: units.length,
        eligible_units: loaded.eligibleUnits,
        max_units: maxUnits,
        truncated
      }
    });

    const next = await enqueueEngineStep({ engineAnalysisId, step: "code" });
    await job.updateProgress(100);
    return { units: units.length, next_step_job_id: next.jobId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markEngineStepFailed({ pipelineStepId, errorMessage: msg });
    await releaseEngineCorpusLock(engineAnalysisId);
    throw err;
  }
}

async function loadAnalysis(engineAnalysisId: string): Promise<AnalysisRow> {
  const r = await pool.query<AnalysisRow>(
    `SELECT
       ea.study_corpus_id,
       sc.base_corpus_id,
       ea.snapshot_id,
       ea.methodology_slug,
       ea.params
     FROM engine_analyses ea
     JOIN study_corpora sc ON sc.id = ea.study_corpus_id
     WHERE ea.id = $1`,
    [engineAnalysisId]
  );
  const row = r.rows[0];
  if (!row) throw new Error(`engine_analyses ${engineAnalysisId} not found`);
  return row;
}

async function loadUnits(
  engineAnalysisId: string,
  analysis: AnalysisRow,
  limit: number
): Promise<UnitLoadResult> {
  await materializeRunMentionMap(engineAnalysisId, analysis);
  const eligibleUnits = await countRunMentionMap(engineAnalysisId);
  const r = await pool.query<UnitRow>(
    `SELECT
       m.id::text AS external_ref,
       m.study_corpus_id::text AS study_corpus_id,
       COALESCE(
         erm.entity_id,
         erm.corpus_entity_id::text,
         ib.corpus_entity_id::text,
         ib.competitor_id::text,
         ib.entity_kind || ':' || regexp_replace(lower(COALESCE(ib.entity_label, ib.mention_type, 'unknown')), '[^a-z0-9]+', '-', 'g')
       ) AS entity_id,
       COALESCE(ce.name, ib.entity_label, m.batch_entity_label, ib.mention_type, erm.scope) AS entity_hint,
       m.text_clean AS text,
       COALESCE(m.resolved_platform, m.platform) AS platform,
       m.published_at::text AS published_at
     FROM engine_run_mention_map erm
     JOIN mentions m ON m.id = erm.mention_id
     LEFT JOIN import_batches ib ON ib.id = COALESCE(erm.import_batch_id, m.source_file_id)
     LEFT JOIN corpus_entities ce ON ce.id = erm.corpus_entity_id
     WHERE erm.engine_analysis_id = $1
       AND length(m.text_clean) >= 24
     ORDER BY erm.selection_rank ASC
     LIMIT $2`,
    [engineAnalysisId, limit]
  );

  return {
    eligibleUnits,
    units: r.rows.map((unit) => sanitizeUnit(unit))
  };
}

async function materializeRunMentionMap(engineAnalysisId: string, analysis: AnalysisRow) {
  const corpusIds = buildEngineCorpusScopeIds(analysis);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // The provenance CTE below scans every mention_query_sources row for the lens
    // (tens of thousands once CSV + scope fan-out + backfill provenance pile up) and
    // builds a jsonb aggregate per mention. Under engine worker concurrency it can run
    // past the role-level statement_timeout (2min) and get cancelled, failing retrieve
    // with "canceling statement due to statement timeout". Give this transaction more
    // headroom; it stays scoped to the tx and reverts on COMMIT/ROLLBACK.
    await client.query(`SET LOCAL statement_timeout = '${readMaterializeTimeoutMs()}'`);
    await client.query(`DELETE FROM engine_run_mention_map WHERE engine_analysis_id = $1`, [engineAnalysisId]);
    await client.query(
      `WITH candidates AS (
         SELECT
           m.id AS mention_id,
           m.study_corpus_id AS source_study_corpus_id,
           mqs.query_pack_id,
           mqs.query_iteration_id,
           COALESCE(mqs.import_batch_id, m.source_file_id) AS import_batch_id,
           mqs.lens_slug,
           mqs.signal_intent,
           mqs.scope,
           COALESCE(mqs.entity_id, mqs.corpus_entity_id::text) AS entity_id,
           mqs.corpus_entity_id,
           COALESCE(mqs.match_quality, 0) AS match_quality,
           COALESCE(m.quality_score, 0) AS quality_score,
           m.published_at,
           ROW_NUMBER() OVER (
             PARTITION BY m.id
             ORDER BY
               COALESCE(mqs.match_quality, 0) DESC,
               COALESCE(m.quality_score, 0) DESC,
               m.published_at DESC,
               mqs.created_at DESC,
               mqs.id DESC
           ) AS mention_rank
         FROM mention_query_sources mqs
         JOIN mentions m ON m.id = mqs.mention_id
         WHERE m.inclusion_status = 'included'
           AND m.study_corpus_id = ANY($1::uuid[])
           AND mqs.lens_slug = $2
           AND (
             $3::uuid IS NULL
             OR m.study_corpus_id <> $4::uuid
             OR EXISTS (
               SELECT 1
               FROM corpus_snapshot_mentions csm
               WHERE csm.snapshot_id = $3::uuid
                 AND csm.mention_id = m.id
             )
           )
           AND length(m.text_clean) >= 24
       ),
       provenance AS (
         SELECT
           mention_id,
           jsonb_agg(
             jsonb_build_object(
               'query_pack_id', query_pack_id,
               'query_iteration_id', query_iteration_id,
               'import_batch_id', import_batch_id,
               'lens_slug', lens_slug,
               'signal_intent', signal_intent,
               'scope', scope,
               'entity_id', entity_id,
               'corpus_entity_id', corpus_entity_id,
               'match_quality', match_quality
             )
             ORDER BY match_quality DESC, quality_score DESC
           ) AS sources
         FROM candidates
         GROUP BY mention_id
       ),
       selected AS (
         SELECT candidates.*, provenance.sources AS provenance_sources
         FROM candidates
         JOIN provenance ON provenance.mention_id = candidates.mention_id
         WHERE candidates.mention_rank = 1
       ),
       ranked AS (
         SELECT
           *,
           ROW_NUMBER() OVER (
             ORDER BY match_quality DESC, quality_score DESC, published_at DESC, mention_id
           ) AS selection_rank
         FROM selected
       )
       INSERT INTO engine_run_mention_map (
         engine_analysis_id,
         study_corpus_id,
         mention_id,
         source_study_corpus_id,
         query_pack_id,
         query_iteration_id,
         import_batch_id,
         lens_slug,
         signal_intent,
         scope,
         entity_id,
         corpus_entity_id,
         match_quality,
         quality_score,
         selection_rank,
         metadata
       )
       SELECT
         $5::uuid AS engine_analysis_id,
         $4::uuid AS study_corpus_id,
         mention_id,
         source_study_corpus_id,
         query_pack_id,
         query_iteration_id,
         import_batch_id,
         lens_slug,
         signal_intent,
         scope,
         entity_id,
         corpus_entity_id,
         match_quality,
         quality_score,
         selection_rank,
         jsonb_build_object(
           'snapshot_id', $3::uuid,
           'source_study_corpus_id', source_study_corpus_id,
           'source_policy', CASE WHEN source_study_corpus_id = $4::uuid THEN 'primary' ELSE 'baseline' END,
           'provenance_sources', provenance_sources
         )
       FROM ranked`,
      [corpusIds, analysis.methodology_slug, analysis.snapshot_id, analysis.study_corpus_id, engineAnalysisId]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function countRunMentionMap(engineAnalysisId: string): Promise<number> {
  const r = await pool.query<{ eligible_units: number }>(
    `SELECT COUNT(*)::int AS eligible_units
     FROM engine_run_mention_map
     WHERE engine_analysis_id = $1`,
    [engineAnalysisId]
  );
  return Number(r.rows[0]?.eligible_units ?? 0);
}

function sanitizeUnit(unit: UnitRow): UnitRow {
  return {
    ...unit,
    entity_hint: unit.entity_hint ? sanitizeUnicodeForPostgresText(unit.entity_hint) : null,
    text: truncateCodePoints(sanitizeUnicodeForPostgresText(unit.text), 1800),
    platform: unit.platform ? sanitizeUnicodeForPostgresText(unit.platform) : null
  };
}

function readMaterializeTimeoutMs(): number {
  const raw = Number(process.env.ENGINE_RETRIEVE_STATEMENT_TIMEOUT_MS ?? 480_000);
  if (!Number.isFinite(raw) || raw <= 0) return 480_000;
  // Clamp to a sane window: at least 60s, at most 30min.
  return Math.min(1_800_000, Math.max(60_000, Math.floor(raw)));
}

function readMaxUnits(params: Record<string, unknown> | null): number {
  const raw = Number(params?.max_units ?? process.env.ENGINE_MAX_UNITS ?? 180);
  if (!Number.isFinite(raw)) return 180;
  const hardCap = Number(process.env.ENGINE_MAX_UNITS_HARD_CAP ?? 100000);
  const boundedHardCap = Number.isFinite(hardCap) && hardCap > 0 ? Math.floor(hardCap) : 100000;
  return Math.min(boundedHardCap, Math.max(30, Math.floor(raw)));
}

function truncateCodePoints(value: string, maxCodePoints: number): string {
  return Array.from(value).slice(0, maxCodePoints).join("");
}

async function appendLimitation(engineAnalysisId: string, text: string) {
  await pool.query(
    `UPDATE engine_analyses
     SET limitations = COALESCE(limitations, '[]'::jsonb) || $1::jsonb,
         updated_at = NOW()
     WHERE id = $2`,
    [safeJsonStringifyForPostgres([text]), engineAnalysisId]
  );
}

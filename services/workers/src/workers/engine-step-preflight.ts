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

type EngineStepJobData = {
  engineAnalysisId: string;
  pipelineStepId: string;
};

type AnalysisContext = {
  study_corpus_id: string;
  base_corpus_id: string | null;
  methodology_slug: string;
  business_question: string | null;
};

type EntityRow = {
  entity_id: string;
  entity_name: string;
  entity_kind: string;
  mention_count: number;
};

export async function enginePreflightJob(job: Job<EngineStepJobData>) {
  const { engineAnalysisId, pipelineStepId } = job.data;
  await markEngineStepRunning(pipelineStepId);
  await job.updateProgress(10);

  try {
    const ctx = await loadAnalysisContext(engineAnalysisId);
    if (!isEngineRunnableMethodologySlug(ctx.methodology_slug)) {
      throw new Error(`Unsupported or read-only engine methodology slug: ${ctx.methodology_slug}`);
    }
    const spec = getEngineMethodologySpec(ctx.methodology_slug);
    const [entities, mentionTotal, authorTotal] = await Promise.all([
      loadEntities(ctx),
      countIncludedMentions(ctx),
      countAuthors(ctx)
    ]);
    await job.updateProgress(55);

    const competitorEntities = entities.filter((entity) => entity.entity_kind === "competitor" || entity.entity_kind === "competitor_pool");
    const limitations: string[] = [];
    if (mentionTotal === 0) limitations.push("No hay menciones incluidas para correr esta metodología.");
    if (spec.requiresCompetitors && competitorEntities.length === 0) {
      limitations.push("La metodología requiere entidades competitivas atribuidas.");
    }
    if (spec.requiresAuthorsMetadata && authorTotal === 0) {
      limitations.push("La metodología requiere metadata de autores para producir un resultado completo.");
    }
    const belowMinimum = entities.filter((entity) => entity.mention_count > 0 && entity.mention_count < spec.minMentionsPerEntity);
    if (belowMinimum.length > 0) {
      limitations.push(`Hay ${belowMinimum.length} entidades por debajo del mínimo direccional de ${spec.minMentionsPerEntity} menciones.`);
    }

    await pool.query(
      `UPDATE engine_analyses
       SET limitations = $1::jsonb,
           meta_json = COALESCE(meta_json, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $3`,
      [
        JSON.stringify(limitations),
        JSON.stringify({
          preflight: {
            mention_total: mentionTotal,
            author_total: authorTotal,
            entities,
            spec: {
              slug: spec.slug,
              unit_kind: spec.unitKind,
              requires_competitors: spec.requiresCompetitors,
              requires_authors_metadata: spec.requiresAuthorsMetadata === true,
              min_mentions_per_entity: spec.minMentionsPerEntity
            }
          }
        }),
        engineAnalysisId
      ]
    );

    await markEngineStepCompleted({
      pipelineStepId,
      resultSummary: {
        mention_total: mentionTotal,
        entities: entities.length,
        limitations
      }
    });

    if (mentionTotal === 0) {
      await pool.query(
        `UPDATE engine_analyses
         SET status = 'aborted_preflight',
             failed_at = NOW(),
             failure_reason = $1,
             updated_at = NOW()
         WHERE id = $2`,
        ["Engine preflight: no included mentions", engineAnalysisId]
      );
      await releaseEngineCorpusLock(engineAnalysisId);
      await job.updateProgress(100);
      return { decision: "ABORTAR", limitations };
    }

    const next = await enqueueEngineStep({ engineAnalysisId, step: "retrieve" });
    await job.updateProgress(100);
    return { decision: "PROCEDER", next_step_job_id: next.jobId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markEngineStepFailed({ pipelineStepId, errorMessage: msg });
    await releaseEngineCorpusLock(engineAnalysisId);
    throw err;
  }
}

async function loadAnalysisContext(engineAnalysisId: string): Promise<AnalysisContext> {
  const r = await pool.query<AnalysisContext>(
    `SELECT
       ea.study_corpus_id,
       sc.base_corpus_id,
       ea.methodology_slug,
       COALESCE(ea.business_question, sc.business_question) AS business_question
     FROM engine_analyses ea
     JOIN study_corpora sc ON sc.id = ea.study_corpus_id
     WHERE ea.id = $1`,
    [engineAnalysisId]
  );
  const row = r.rows[0];
  if (!row) throw new Error(`engine_analyses ${engineAnalysisId} not found`);
  return row;
}

async function loadEntities(ctx: AnalysisContext): Promise<EntityRow[]> {
  const entityRows = await pool.query<EntityRow>(
    `SELECT
       ce.id::text AS entity_id,
       ce.name AS entity_name,
       ce.entity_kind,
       COUNT(DISTINCT m.id)::int AS mention_count
     FROM corpus_entities ce
     LEFT JOIN mention_query_sources mqs ON mqs.corpus_entity_id = ce.id AND mqs.lens_slug = $3
     LEFT JOIN mentions m ON m.id = mqs.mention_id AND m.inclusion_status = 'included'
     WHERE (ce.study_corpus_id = $1 OR ce.study_corpus_id = $2) AND ce.status = 'active'
     GROUP BY ce.id, ce.name, ce.entity_kind
     ORDER BY mention_count DESC, ce.priority NULLS LAST, ce.name ASC`,
    [ctx.study_corpus_id, ctx.base_corpus_id, ctx.methodology_slug]
  );
  if (entityRows.rows.length > 0) return entityRows.rows;

  const importRows = await pool.query<EntityRow>(
    `SELECT
       COALESCE(mqs.entity_id, ib.corpus_entity_id::text, ib.competitor_id::text, ib.entity_kind || ':' || regexp_replace(lower(COALESCE(ib.entity_label, ib.mention_type, 'unknown')), '[^a-z0-9]+', '-', 'g')) AS entity_id,
       COALESCE(ib.entity_label, ib.mention_type, mqs.scope, 'Sin entidad') AS entity_name,
       COALESCE(ib.entity_kind, CASE WHEN ib.mention_type = 'brand' THEN 'primary_brand' WHEN ib.mention_type = 'competitor' THEN 'competitor_pool' WHEN ib.mention_type = 'industry' THEN 'category' ELSE 'unknown' END) AS entity_kind,
       COUNT(DISTINCT mqs.mention_id)::int AS mention_count
     FROM mention_query_sources mqs
     JOIN mentions m ON m.id = mqs.mention_id AND m.inclusion_status = 'included'
     LEFT JOIN import_batches ib ON ib.id = mqs.import_batch_id
     WHERE (mqs.study_corpus_id = $1 OR mqs.study_corpus_id = $2)
       AND mqs.lens_slug = $3
     GROUP BY 1, 2, 3
     ORDER BY mention_count DESC`,
    [ctx.study_corpus_id, ctx.base_corpus_id, ctx.methodology_slug]
  );
  return importRows.rows;
}

async function countIncludedMentions(ctx: AnalysisContext): Promise<number> {
  const r = await pool.query<{ total: number }>(
    `SELECT COUNT(DISTINCT mentions.id)::int AS total
     FROM mentions
     JOIN mention_query_sources mqs ON mqs.mention_id = mentions.id
     WHERE inclusion_status = 'included'
       AND (mentions.study_corpus_id = $1 OR mentions.study_corpus_id = $2)
       AND mqs.lens_slug = $3`,
    [ctx.study_corpus_id, ctx.base_corpus_id, ctx.methodology_slug]
  );
  return r.rows[0]?.total ?? 0;
}

async function countAuthors(ctx: AnalysisContext): Promise<number> {
  const r = await pool.query<{ total: number }>(
    `SELECT COUNT(DISTINCT author_id)::int AS total
     FROM mentions
     JOIN mention_query_sources mqs ON mqs.mention_id = mentions.id
     WHERE inclusion_status = 'included'
       AND author_id IS NOT NULL
       AND (mentions.study_corpus_id = $1 OR mentions.study_corpus_id = $2)
       AND mqs.lens_slug = $3`,
    [ctx.study_corpus_id, ctx.base_corpus_id, ctx.methodology_slug]
  );
  return r.rows[0]?.total ?? 0;
}

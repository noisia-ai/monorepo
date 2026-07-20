import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import type { Job } from "bullmq";
import { z } from "zod";

import {
  aggregateQueryPackMetrics,
  buildQueryPackEvaluatorPrompt,
  computeQueryPackMetrics,
  isQueryPackReady,
  QUERY_PACK_EVALUATOR_PIPELINE_VERSION,
  QUERY_PACK_IMPORTED_SAMPLE_SIZE,
  QUERY_PACK_MIN_DIAGNOSTIC_SAMPLE_SIZE,
  QUERY_PACK_MIN_IMPORTED_SAMPLE_SIZE,
  type QueryPackClassification,
  type QueryPackMention,
  type QueryPackMetrics
} from "@noisia/query-engine";
import { pool } from "../db/client";
import { loadAnalysisRagContext } from "./analysis-rag-context";
import {
  aliasQueryPackSample,
  restoreQueryPackClassificationIds
} from "./query-pack-classification-ids";

type EvaluateSampleJobData = {
  corpusId: string;
  queryIterationId: string;
  requestedByUserId: string;
};

type IterationRow = {
  id: string;
  iteration_number: number;
  business_question: string | null;
  audience_segment: string | null;
  geo_focus: string[] | null;
  target_window_months: number | null;
  context_form: unknown;
  brand_id: string | null;
  theme_id: string | null;
  brand_name: string | null;
  brand_display_name: string | null;
  brand_industry: string | null;
  brand_industry_sub: string | null;
  brand_countries: string[] | null;
  brand_seed_handles: string[] | null;
  brand_description: string | null;
  theme_name: string | null;
  theme_description: string | null;
  theme_industry_focus: string[] | null;
  theme_geo_focus: string[] | null;
  methodology_slug: string;
  methodology_name: string;
};

type QueryPackRow = {
  id: string;
  lens_slug: string;
  signal_intent: string;
  scope: string;
  objective: string | null;
  query_text: string | null;
  query_components: Record<string, unknown> | null;
  seeds: Record<string, unknown> | null;
  evaluation: Record<string, unknown> | null;
};

type MentionRow = QueryPackMention & {
  source_file_id: string | null;
  import_batch_id: string | null;
  source_system: string;
  published_at: string;
};

type EvaluationAttempt = {
  attempt: number;
  kind: "imported_evidence";
  query_text: string;
  sample_source: "imported_corpus";
  population_size: number;
  sample_size: number;
  unique_sample_size: number;
  import_batch_ids: string[];
  metrics: QueryPackMetrics | null;
  notes: string;
  proposed_adjustments: string[];
  classifications: QueryPackClassification[];
  model: string;
  pipeline_version: string;
  evaluated_at: string;
};

type PackResult = {
  pack_id: string;
  scope: string;
  signal_intent: string;
  status: "ready" | "needs_adjustment" | "insufficient_sample" | "failed";
  query_text: string;
  metrics: QueryPackMetrics | null;
  attempt: EvaluationAttempt | null;
  notes: string;
  proposed_adjustments: string[];
  failure_reason?: string;
};

const classificationSchema = z.object({
  mention_id: z.string().min(1),
  relevance: z.enum(["relevant", "partial", "noise"]),
  signal_types: z.array(z.string().min(1).max(120)).max(8),
  reason: z.string().min(1).max(1200)
});

const evaluatorSchema = z.object({
  classifications: z.array(classificationSchema).min(1).max(QUERY_PACK_IMPORTED_SAMPLE_SIZE + 5),
  notes: z.string().min(1).max(5000),
  proposed_adjustments: z.array(z.string().min(1).max(1200)).max(12)
});

export async function evaluateSampleJob(job: Job<EvaluateSampleJobData>) {
  await job.updateProgress(5);
  const iteration = await loadIteration(job.data.queryIterationId, job.data.corpusId);
  const packs = await loadProductionQueryPacks(iteration, job.data.queryIterationId, job.data.corpusId);
  if (packs.length === 0) throw new Error("No production query packs exist for this iteration.");

  await markEvaluationStarted(job.data.queryIterationId, packs.map((pack) => pack.id));
  const validationRunId = await createQueryValidationRun(job.data);

  try {
    const subject = buildSubject(iteration);
    const ragContext = await loadAnalysisRagContext(job.data.corpusId, iteration.brand_id);
    const model = process.env.ANTHROPIC_MODEL_DEFAULT ?? "claude-sonnet-4-6";
    const results: PackResult[] = [];

    for (let index = 0; index < packs.length; index += 1) {
      const pack = packs[index];
      if (!pack) continue;
      let result: PackResult;
      try {
        result = await evaluatePack({
          corpusId: job.data.corpusId,
          iteration,
          pack,
          subject,
          ragContext,
          model,
          validationRunId
        });
      } catch (error) {
        result = {
          pack_id: pack.id,
          scope: pack.scope,
          signal_intent: pack.signal_intent,
          status: "failed",
          query_text: pack.query_text ?? "",
          metrics: null,
          attempt: null,
          notes: "La evaluación de la evidencia importada falló; no se generaron scores.",
          proposed_adjustments: [],
          failure_reason: errorMessage(error)
        };
      }
      results.push(result);
      await persistPackResult(pack, result);
      await job.updateProgress(12 + Math.round(((index + 1) / packs.length) * 75));
    }

    const validMetrics = results.flatMap((result) => result.metrics ? [result.metrics] : []);
    const aggregate = validMetrics.length === results.length
      ? aggregateQueryPackMetrics(validMetrics)
      : null;
    const allReady = results.every((result) => result.status === "ready");
    const status = results.some((result) => result.status === "failed")
      ? "failed"
      : allReady
        ? "ready"
        : "needs_adjustment";
    const summary = {
      status,
      notes: buildRollupNotes(results),
      proposed_adjustments: [...new Set(results.flatMap((result) => result.proposed_adjustments))],
      pack_results: results.map((result) => ({
        pack_id: result.pack_id,
        scope: result.scope,
        signal_intent: result.signal_intent,
        status: result.status,
        population_size: result.attempt?.population_size ?? 0,
        sample_size: result.attempt?.sample_size ?? 0,
        import_batch_ids: result.attempt?.import_batch_ids ?? [],
        metrics: result.metrics,
        notes: result.notes,
        proposed_adjustments: result.proposed_adjustments,
        failure_reason: result.failure_reason ?? null
      })),
      evidence_source: "imported_corpus",
      model,
      pipeline_version: QUERY_PACK_EVALUATOR_PIPELINE_VERSION
    };

    await persistIterationRollup(job.data.queryIterationId, aggregate, summary);
    await completeQueryValidationRun(validationRunId, status, summary);
    await job.updateProgress(100);
    return {
      query_iteration_id: job.data.queryIterationId,
      status,
      all_required_packs_ready: allReady,
      aggregate_metrics: aggregate,
      pack_results: summary.pack_results
    };
  } catch (error) {
    await failQueryValidationRun(validationRunId, error);
    throw error;
  }
}

async function evaluatePack(input: {
  corpusId: string;
  iteration: IterationRow;
  pack: QueryPackRow;
  subject: Record<string, unknown>;
  ragContext: Awaited<ReturnType<typeof loadAnalysisRagContext>>;
  model: string;
  validationRunId: string;
}): Promise<PackResult> {
  const evidence = await loadImportedPackEvidence(input.corpusId, input.pack.id);
  const queryText = input.pack.query_text?.trim() ?? "";
  if (evidence.populationSize < QUERY_PACK_MIN_DIAGNOSTIC_SAMPLE_SIZE) {
    return {
      pack_id: input.pack.id,
      scope: input.pack.scope,
      signal_intent: input.pack.signal_intent,
      status: "insufficient_sample",
      query_text: queryText,
      metrics: null,
      attempt: null,
      notes: `Este pack tiene ${evidence.populationSize} menciones importadas. Se necesitan al menos ${QUERY_PACK_MIN_IMPORTED_SAMPLE_SIZE} para un score aprobable y ${QUERY_PACK_MIN_DIAGNOSTIC_SAMPLE_SIZE} para un diagnóstico preliminar.`,
      proposed_adjustments: ["Importar una extracción mayor y volver a evaluar este pack."]
    };
  }

  const evaluation = await classifyPackSample({
    iteration: input.iteration,
    pack: input.pack,
    subject: input.subject,
    ragContext: input.ragContext,
    sample: evidence.mentions,
    model: input.model
  });
  const metrics = computeQueryPackMetrics({
    sample: evidence.mentions,
    classifications: evaluation.classifications,
    targetLanguages: ["es"],
    targetCountries: [...(input.iteration.geo_focus ?? []), ...(input.iteration.brand_countries ?? [])]
  });
  const enoughEvidence = evidence.populationSize >= QUERY_PACK_MIN_IMPORTED_SAMPLE_SIZE;
  const ready = enoughEvidence && isQueryPackReady(metrics);
  const attempt: EvaluationAttempt = {
    attempt: 1,
    kind: "imported_evidence",
    query_text: queryText,
    sample_source: "imported_corpus",
    population_size: evidence.populationSize,
    sample_size: evidence.mentions.length,
    unique_sample_size: evidence.mentions.length,
    import_batch_ids: evidence.importBatchIds,
    metrics,
    notes: evaluation.notes,
    proposed_adjustments: evaluation.proposed_adjustments,
    classifications: evaluation.classifications,
    model: input.model,
    pipeline_version: QUERY_PACK_EVALUATOR_PIPELINE_VERSION,
    evaluated_at: new Date().toISOString()
  };
  await persistQueryValidationAttempt({
    validationRunId: input.validationRunId,
    packId: input.pack.id,
    attempt,
    sample: evidence.mentions,
    status: ready ? "ready" : enoughEvidence ? "needs_adjustment" : "insufficient_sample"
  });

  return {
    pack_id: input.pack.id,
    scope: input.pack.scope,
    signal_intent: input.pack.signal_intent,
    status: ready ? "ready" : enoughEvidence ? "needs_adjustment" : "insufficient_sample",
    query_text: queryText,
    metrics,
    attempt,
    notes: enoughEvidence
      ? evaluation.notes
      : `${evaluation.notes}\nLa clasificación es preliminar porque la población ligada al pack es menor a ${QUERY_PACK_MIN_IMPORTED_SAMPLE_SIZE}.`,
    proposed_adjustments: evaluation.proposed_adjustments
  };
}

async function classifyPackSample(input: {
  iteration: IterationRow;
  pack: QueryPackRow;
  subject: Record<string, unknown>;
  ragContext: Awaited<ReturnType<typeof loadAnalysisRagContext>>;
  sample: MentionRow[];
  model: string;
}) {
  const { aliasedSample, originalIdByAlias } = aliasQueryPackSample(input.sample);
  const result = await generateObject({
    model: anthropic(input.model),
    schema: evaluatorSchema,
    prompt: buildQueryPackEvaluatorPrompt({
      pack: {
        scope: input.pack.scope,
        signalIntent: input.pack.signal_intent,
        objective: input.pack.objective,
        queryText: input.pack.query_text ?? ""
      },
      study: {
        methodologySlug: input.iteration.methodology_slug,
        businessQuestion: input.iteration.business_question,
        audienceSegment: input.iteration.audience_segment,
        geoFocus: input.iteration.geo_focus ?? []
      },
      subject: input.subject,
      queryStrategyBrief: input.ragContext.queryStrategyBrief ?? undefined,
      knowledgeSources: input.ragContext.knowledgeSources.slice(0, 8),
      sample: aliasedSample
    }),
    temperature: 0,
    maxRetries: 2
  });
  return {
    ...result.object,
    classifications: restoreQueryPackClassificationIds(result.object.classifications, originalIdByAlias)
  };
}

async function loadImportedPackEvidence(corpusId: string, packId: string) {
  const countResult = await pool.query<{ population_size: number; import_batch_ids: string[] | null }>(
    `
      SELECT
        COUNT(DISTINCT m.id)::int AS population_size,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT mqs.import_batch_id::text), NULL) AS import_batch_ids
      FROM mentions m
      JOIN mention_query_sources mqs ON mqs.mention_id = m.id
      WHERE m.study_corpus_id = $1
        AND mqs.query_pack_id = $2
        AND m.inclusion_status = 'included'
    `,
    [corpusId, packId]
  );
  const sampleResult = await pool.query<MentionRow>(
    `
      SELECT
        m.id::text AS id,
        LEFT(COALESCE(m.text_snippet, m.text_clean, m.text_raw, ''), 500) AS text_snippet,
        COALESCE(m.resolved_platform, m.platform, 'unknown') AS platform,
        NULLIF(BTRIM(m.language), '') AS language,
        NULLIF(BTRIM(m.country), '') AS country,
        m.sentiment_source,
        m.source_file_id::text AS source_file_id,
        mqs.import_batch_id::text AS import_batch_id,
        m.source_system,
        m.published_at::text AS published_at
      FROM mentions m
      JOIN mention_query_sources mqs ON mqs.mention_id = m.id
      WHERE m.study_corpus_id = $1
        AND mqs.query_pack_id = $2
        AND m.inclusion_status = 'included'
      ORDER BY md5(m.id::text || $2::text)
      LIMIT $3
    `,
    [corpusId, packId, QUERY_PACK_IMPORTED_SAMPLE_SIZE]
  );
  return {
    populationSize: Number(countResult.rows[0]?.population_size ?? 0),
    importBatchIds: countResult.rows[0]?.import_batch_ids ?? [],
    mentions: sampleResult.rows
  };
}

async function loadIteration(iterationId: string, corpusId: string): Promise<IterationRow> {
  const result = await pool.query<IterationRow>(
    `SELECT qi.id, qi.iteration_number, sc.business_question, sc.audience_segment, sc.geo_focus,
            sc.target_window_months, sc.context_form, sc.brand_id, sc.theme_id,
            b.name AS brand_name, b.display_name AS brand_display_name, b.industry AS brand_industry,
            b.industry_sub AS brand_industry_sub, b.countries AS brand_countries,
            b.brand_seed_handles, b.description AS brand_description,
            t.name AS theme_name, t.description AS theme_description,
            t.industry_focus AS theme_industry_focus, t.geo_focus AS theme_geo_focus,
            m.slug AS methodology_slug, m.name AS methodology_name
       FROM query_iterations qi
       JOIN study_corpora sc ON sc.id = qi.study_corpus_id
       JOIN methodologies m ON m.id = sc.methodology_id
       LEFT JOIN brands b ON b.id = sc.brand_id
       LEFT JOIN themes t ON t.id = sc.theme_id
      WHERE qi.id = $1 AND qi.study_corpus_id = $2 LIMIT 1`,
    [iterationId, corpusId]
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Query iteration not found: ${iterationId}`);
  return row;
}

async function loadProductionQueryPacks(iteration: IterationRow, iterationId: string, corpusId: string) {
  const lensSlug = iteration.methodology_slug === "signal-pulse" ? "signal-pulse" : "triggers-barriers";
  const result = await pool.query<QueryPackRow>(
    `SELECT id, lens_slug, signal_intent, scope, objective, query_text, query_components, seeds, evaluation
       FROM query_packs
      WHERE study_corpus_id = $1 AND query_iteration_id = $2 AND lens_slug = $3
      ORDER BY CASE scope WHEN 'brand' THEN 1 WHEN 'competitors' THEN 2 WHEN 'category' THEN 3 ELSE 4 END`,
    [corpusId, iterationId, lensSlug]
  );
  return result.rows;
}

async function createQueryValidationRun(input: EvaluateSampleJobData) {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO query_validation_runs (
       study_corpus_id, query_iteration_id, status, source_system, source_project_id,
       sample_size_per_pack, max_attempts, pipeline_version, requested_by_user_id
     ) VALUES ($1, $2, 'running', 'imported_corpus', NULL, $3, 1, $4, $5) RETURNING id`,
    [input.corpusId, input.queryIterationId, QUERY_PACK_IMPORTED_SAMPLE_SIZE, QUERY_PACK_EVALUATOR_PIPELINE_VERSION, input.requestedByUserId]
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Could not create the imported-evidence validation run.");
  await pool.query(
    `UPDATE query_iterations
        SET latest_query_validation_run_id = $1, approved_query_validation_run_id = NULL,
            insights_manager_decision = NULL, insights_manager_user_id = NULL, decision_at = NULL
      WHERE id = $2`,
    [id, input.queryIterationId]
  );
  return id;
}

async function persistQueryValidationAttempt(input: {
  validationRunId: string;
  packId: string;
  attempt: EvaluationAttempt;
  sample: MentionRow[];
  status: "ready" | "needs_adjustment" | "insufficient_sample";
}) {
  const attemptResult = await pool.query<{ id: string }>(
    `INSERT INTO query_validation_attempts (
       query_validation_run_id, query_pack_id, attempt_number, query_text, sample_size,
       attempt_kind, unique_sample_size, status, metrics, notes, proposed_adjustments, model, evaluated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12,$13::timestamptz) RETURNING id`,
    [input.validationRunId, input.packId, input.attempt.attempt, input.attempt.query_text,
      input.attempt.sample_size, input.attempt.kind, input.attempt.unique_sample_size, input.status,
      JSON.stringify(input.attempt.metrics), input.attempt.notes,
      JSON.stringify(input.attempt.proposed_adjustments), input.attempt.model, input.attempt.evaluated_at]
  );
  const attemptId = attemptResult.rows[0]?.id;
  if (!attemptId) throw new Error("Could not persist the imported-evidence attempt.");

  const mentionById = new Map(input.sample.map((mention) => [mention.id, mention]));
  const rows = input.attempt.classifications.map((classification) => {
    const mention = mentionById.get(classification.mention_id);
    return {
      external_mention_id: classification.mention_id,
      relevance: classification.relevance,
      signal_types: classification.signal_types,
      reason: classification.reason,
      mention_metadata: {
        internal_mention_id: mention?.id ?? null,
        source_file_id: mention?.source_file_id ?? null,
        import_batch_id: mention?.import_batch_id ?? null,
        source_system: mention?.source_system ?? null,
        published_at: mention?.published_at ?? null,
        platform: mention?.platform ?? null,
        language: mention?.language ?? null,
        country: mention?.country ?? null,
        sentiment_source: mention?.sentiment_source ?? null,
        text_snippet: mention?.text_snippet ?? null
      }
    };
  });
  if (rows.length === 0) return;
  await pool.query(
    `INSERT INTO query_validation_mentions (
       query_validation_attempt_id, external_mention_id, relevance, signal_types, reason, mention_metadata
     ) SELECT $1::uuid, item.external_mention_id, item.relevance, item.signal_types, item.reason, item.mention_metadata
         FROM jsonb_to_recordset($2::jsonb) AS item(
           external_mention_id text, relevance text, signal_types text[], reason text, mention_metadata jsonb
         )`,
    [attemptId, JSON.stringify(rows)]
  );
}

async function completeQueryValidationRun(id: string, status: string, summary: unknown) {
  await pool.query(
    `UPDATE query_validation_runs SET status=$1, summary=$2::jsonb, completed_at=now() WHERE id=$3`,
    [status, JSON.stringify(summary), id]
  );
}

async function failQueryValidationRun(id: string, error: unknown) {
  await pool.query(
    `UPDATE query_validation_runs
        SET status='failed', summary=jsonb_build_object('error',$1::text), completed_at=now()
      WHERE id=$2 AND status='running'`,
    [errorMessage(error), id]
  );
}

async function markEvaluationStarted(iterationId: string, packIds: string[]) {
  await pool.query(
    `UPDATE query_iterations
        SET mentions_returned=NULL, quality_score=NULL, density_score=NULL, noise_score=NULL,
            ai_evaluation_notes=$1
      WHERE id=$2`,
    [JSON.stringify({ status: "evaluating", evidence_source: "imported_corpus", pipeline_version: QUERY_PACK_EVALUATOR_PIPELINE_VERSION }), iterationId]
  );
  await pool.query(
    `UPDATE query_packs
        SET evaluation=COALESCE(evaluation,'{}'::jsonb) || jsonb_build_object(
              'status','evaluating','evidence_source','imported_corpus','pipeline_version',$1::text,'started_at',now()),
            quality_score=NULL, density_score=NULL, noise_score=NULL, evaluated_at=NULL, updated_at=now()
      WHERE id=ANY($2::uuid[])`,
    [QUERY_PACK_EVALUATOR_PIPELINE_VERSION, packIds]
  );
}

async function persistPackResult(pack: QueryPackRow, result: PackResult) {
  await pool.query(
    `UPDATE query_packs
        SET evaluation=$1::jsonb, mentions_returned=$2, quality_score=$3, density_score=$4,
            noise_score=$5, evaluated_at=now(), updated_at=now()
      WHERE id=$6`,
    [JSON.stringify({
      status: result.status,
      notes: result.notes,
      proposed_adjustments: result.proposed_adjustments,
      failure_reason: result.failure_reason ?? null,
      attempts: result.attempt ? [result.attempt] : [],
      evaluated_query_text: result.query_text,
      evidence_source: "imported_corpus",
      pipeline_version: QUERY_PACK_EVALUATOR_PIPELINE_VERSION,
      history: buildEvaluationHistory(pack.evaluation)
    }), result.attempt?.population_size ?? 0, result.metrics?.quality_score ?? null,
      result.metrics?.density_score ?? null, result.metrics?.noise_score ?? null, result.pack_id]
  );
}

async function persistIterationRollup(iterationId: string, metrics: QueryPackMetrics | null, notes: unknown) {
  await pool.query(
    `UPDATE query_iterations
        SET mentions_returned=$1, quality_score=$2, density_score=$3, noise_score=$4,
            ai_evaluation_notes=$5, pipeline_version=$6
      WHERE id=$7`,
    [metrics?.sample_size ?? 0, metrics?.quality_score ?? null, metrics?.density_score ?? null,
      metrics?.noise_score ?? null, JSON.stringify(notes), QUERY_PACK_EVALUATOR_PIPELINE_VERSION, iterationId]
  );
}

function buildSubject(row: IterationRow): Record<string, unknown> {
  if (row.brand_id) return {
    type: "brand", name: row.brand_display_name ?? row.brand_name ?? "Marca", id: row.brand_id,
    industry: row.brand_industry, industrySub: row.brand_industry_sub,
    countries: row.brand_countries ?? [], brandSeedHandles: row.brand_seed_handles ?? [],
    description: row.brand_description
  };
  return {
    type: "theme", name: row.theme_name ?? "Theme", id: row.theme_id,
    industry: row.theme_industry_focus?.[0] ?? null, countries: row.theme_geo_focus ?? [],
    description: row.theme_description
  };
}

function buildRollupNotes(results: PackResult[]) {
  const labels = results.map((result) => `${result.scope}: ${result.status}`);
  return `Evaluación post-ingesta por pack (${labels.join(" · ")}). Cada score usa menciones importadas y ligadas al query_pack_id exacto; no consulta APIs de proveedores ni certifica el corpus completo.`;
}

function buildEvaluationHistory(evaluation: Record<string, unknown> | null) {
  if (!evaluation || Object.keys(evaluation).length === 0) return [];
  const existing = Array.isArray(evaluation.history)
    ? evaluation.history.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
  const { history: _history, ...snapshot } = evaluation;
  return [...existing, snapshot].slice(-5);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

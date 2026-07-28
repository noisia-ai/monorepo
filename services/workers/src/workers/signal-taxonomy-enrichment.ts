import { createHash } from "node:crypto";

import { anthropic } from "@ai-sdk/anthropic";
import type { Job } from "bullmq";
import { generateObject } from "ai";
import { z } from "zod";

import {
  getEmbeddingModel,
  normalizeSignalTaxonomyClassificationV1,
  signalTaxonomyAssignmentDispositionV1,
  SIGNAL_TAXONOMY_ENRICHMENT_MAX_BATCH_SIZE,
  vectorLiteral,
  embedTexts,
  type SignalTaxonomyEnrichmentJobDataV1,
  type SignalTaxonomyMentionClassificationV1
} from "@noisia/query-engine";

import { pool } from "../db/client";
import { estimateModelCostUsd, positiveTokenInteger } from "./engine-cost";
import {
  executeSignalTaxonomyBatchesV1,
  isSignalTaxonomyLlmEnabled,
  type SignalTaxonomyBatchExecution
} from "./signal-taxonomy-enrichment-runtime";

type TaxonomyRunScope = {
  run_id: string;
  run_status: string;
  workspace_id: string;
  study_corpus_id: string;
  profile_id: string;
  profile_status: string;
  kind: "topic" | "narrative";
  input_corpus_revision: number;
  current_corpus_revision: number;
  model_version_id: string;
  model_version: string;
  organization_id: string;
  brand_id: string | null;
  budget_cap_usd: string | null;
};

type TaxonomyTerm = {
  id: string;
  term_key: string;
  label: string;
  definition: string | null;
  statement: string | null;
  examples: string[];
  exclusions: string[];
};

type MentionForClassification = {
  id: string;
  text: string;
  published_at: string | null;
  platform: string | null;
  language: string | null;
};

type RagContextRef = {
  source_id: string;
  chunk_hash: string;
  embedding_model: string;
  text: string;
  similarity: number;
};

const evidenceSchema = z.object({
  quote: z.string().min(1).max(500),
  start: z.number().int().nonnegative().nullable(),
  end: z.number().int().nonnegative().nullable()
});
const assignmentSchema = z.object({
  term_key: z.string().min(1),
  score: z.number().min(0).max(1),
  confidence: z.enum(["low", "medium", "high"]),
  evidence: z.array(evidenceSchema).min(1).max(5)
});
const classificationSchema = z.object({
  mention_id: z.string().uuid(),
  assignments: z.array(assignmentSchema).max(12),
  unclassified_reason: z.string().min(1).max(500).nullable()
});
const responseSchema = z.object({
  classifications: z.array(classificationSchema)
    .min(1)
    .max(SIGNAL_TAXONOMY_ENRICHMENT_MAX_BATCH_SIZE)
});

export async function signalTaxonomyEnrichmentJob(
  job: Job<SignalTaxonomyEnrichmentJobDataV1>
) {
  const lockClient = await pool.connect();
  const lockKey = `signal-taxonomy:${job.data.workspace_id}:${job.data.profile_id}`;
  let locked = false;
  try {
    const lock = await lockClient.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked`,
      [lockKey]
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) throw new Error("signal_taxonomy_lock_unavailable");

    const scope = await loadAndStartRun(job);
    if (!scope) return { reconciliation_only: true };
    if (scope.run_status === "completed" || scope.run_status === "skipped") {
      return { run_id: scope.run_id, reconciliation_only: true };
    }
    if (scope.profile_status !== "active") {
      return completeRun(scope.run_id, "skipped", {
        reason: "taxonomy_profile_not_active"
      });
    }
    if (scope.input_corpus_revision !== scope.current_corpus_revision) {
      return completeRun(scope.run_id, "skipped", {
        reason: "corpus_revision_advanced",
        input_corpus_revision: scope.input_corpus_revision,
        current_corpus_revision: scope.current_corpus_revision
      });
    }
    if (!isSignalTaxonomyLlmEnabled()) {
      return completeRun(scope.run_id, "skipped", {
        reason: "paid_taxonomy_providers_not_enabled"
      });
    }
    const budgetCapUsd = Number(scope.budget_cap_usd ?? job.data.budget_cap_usd);
    if (!Number.isFinite(budgetCapUsd) || budgetCapUsd <= 0) {
      throw new Error("signal_taxonomy_budget_cap_required");
    }

    const [terms, mentions] = await Promise.all([
      loadTerms(scope.profile_id),
      loadPendingMentions(scope)
    ]);
    if (terms.length === 0) {
      throw new Error("signal_taxonomy_profile_has_no_active_terms");
    }
    if (mentions.length === 0) {
      return completeRun(scope.run_id, "completed", {
        classified_mentions: 0,
        tag_assertions: 0,
        reason: "no_pending_mentions"
      });
    }

    const batches = chunk(mentions, SIGNAL_TAXONOMY_ENRICHMENT_MAX_BATCH_SIZE);
    const model = process.env.NOISIA_SIGNAL_TAXONOMY_MODEL
      ?? process.env.ANTHROPIC_MODEL_DEFAULT
      ?? "claude-sonnet-4-6";
    const result = await executeSignalTaxonomyBatchesV1({
      batches,
      budget_cap_usd: budgetCapUsd,
      estimate: (batch) => estimateBatchCost(batch, terms, model),
      classify: (batch) => classifyBatch({
        scope,
        terms,
        mentions: batch,
        model
      }),
      persist: (batch, execution) => persistBatch({
        scope,
        mentions: batch,
        execution
      }),
      heartbeat: async (progress) => {
        await job.updateProgress(progress);
        await pool.query(`
          UPDATE signal_refresh_runs
          SET heartbeat_at = now(), updated_at = now()
          WHERE id = $1::uuid AND status = 'running'
        `, [scope.run_id]);
      }
    });
    const accepted = await emitClassificationInvalidation(scope);
    return completeRun(scope.run_id, "completed", {
      ...result,
      classified_mentions: mentions.length,
      invalidation_id: accepted?.id ?? null
    }, result);
  } catch (error) {
    const finalAttempt = job.attemptsMade + 1 >= Number(job.opts.attempts ?? 1);
    await pool.query(`
      UPDATE signal_refresh_runs
      SET status = $2, completed_at = CASE WHEN $2 = 'dead_letter' THEN now() ELSE NULL END,
        heartbeat_at = now(), attempt = GREATEST(attempt, $3),
        error_code = $4,
        error_summary = jsonb_build_object('message', $5),
        updated_at = now()
      WHERE id = $1::uuid
        AND run_type = 'taxonomy_enrichment'
        AND status NOT IN ('completed', 'skipped')
    `, [
      job.data.run_id,
      finalAttempt ? "dead_letter" : "failed",
      job.attemptsMade + 1,
      safeErrorCode(error),
      safeErrorMessage(error)
    ]).catch(() => undefined);
    throw error;
  } finally {
    if (locked) {
      await lockClient.query(
        `SELECT pg_advisory_unlock(hashtextextended($1, 0))`,
        [lockKey]
      ).catch(() => undefined);
    }
    lockClient.release();
  }
}

async function loadAndStartRun(job: Job<SignalTaxonomyEnrichmentJobDataV1>) {
  const result = await pool.query<TaxonomyRunScope>(`
    UPDATE signal_refresh_runs run
    SET status = CASE
          WHEN run.status IN ('completed', 'skipped') THEN run.status
          ELSE 'running'
        END,
        bullmq_job_id = $2,
        attempt = GREATEST(run.attempt, $3),
        started_at = COALESCE(run.started_at, now()),
        heartbeat_at = now(),
        error_code = NULL,
        error_summary = '{}'::jsonb,
        updated_at = now()
    FROM signal_taxonomy_profiles profile
    JOIN tagging_model_versions model ON model.id = profile.model_version_id
    JOIN signal_workspaces workspace ON workspace.id = profile.workspace_id
    JOIN study_corpora corpus ON corpus.id = run.study_corpus_id
    WHERE run.id = $1::uuid
      AND run.run_type = 'taxonomy_enrichment'
      AND run.workspace_id = $4::uuid
      AND run.study_corpus_id = $5::uuid
      AND run.taxonomy_profile_id = $6::uuid
      AND profile.id = run.taxonomy_profile_id
    RETURNING run.id::text AS run_id, run.status AS run_status,
      run.workspace_id::text, run.study_corpus_id::text,
      profile.id::text AS profile_id, profile.status AS profile_status,
      profile.kind, run.input_corpus_revision,
      corpus.corpus_revision AS current_corpus_revision,
      model.id::text AS model_version_id, model.version AS model_version,
      workspace.organization_id::text, workspace.brand_id::text,
      run.budget_cap_usd::text
  `, [
    job.data.run_id,
    job.id ?? null,
    job.attemptsMade + 1,
    job.data.workspace_id,
    job.data.study_corpus_id,
    job.data.profile_id
  ]);
  return result.rows[0] ?? null;
}

async function loadTerms(profileId: string) {
  const result = await pool.query<TaxonomyTerm>(`
    SELECT term.id::text, term.term_key, term.label,
      term.description AS definition,
      NULLIF(term.metadata->>'statement', '') AS statement,
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(term.metadata->'examples', '[]'::jsonb))),
        ARRAY[]::text[]
      ) AS examples,
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(term.metadata->'exclusions', '[]'::jsonb))),
        ARRAY[]::text[]
      ) AS exclusions
    FROM signal_taxonomy_profiles profile
    JOIN taxonomy_terms term ON term.taxonomy_id = profile.taxonomy_id
    WHERE profile.id = $1::uuid
      AND profile.status = 'active'
      AND term.status = 'active'
    ORDER BY term.term_key
  `, [profileId]);
  return result.rows;
}

async function loadPendingMentions(scope: TaxonomyRunScope) {
  const result = await pool.query<MentionForClassification>(`
    SELECT mention.id::text, left(mention.text_clean, 3000) AS text,
      mention.published_at::text, mention.platform, mention.language
    FROM mentions mention
    WHERE mention.study_corpus_id = $1::uuid
      AND mention.inclusion_status = 'included'
      AND NOT EXISTS (
        SELECT 1
        FROM record_feature_values feature
        WHERE feature.subject_type = 'mention'
          AND feature.subject_id = mention.id
          AND feature.feature_key = $2
          AND feature.source = $3
      )
    ORDER BY mention.published_at NULLS LAST, mention.id
    LIMIT 10000
  `, [
    scope.study_corpus_id,
    classificationFeatureKey(scope.profile_id),
    classificationSource(scope.profile_id)
  ]);
  return result.rows;
}

async function classifyBatch(args: {
  scope: TaxonomyRunScope;
  terms: TaxonomyTerm[];
  mentions: MentionForClassification[];
  model: string;
}): Promise<SignalTaxonomyBatchExecution> {
  const contextRefs = await loadVersionedRagContext(args.scope, args.mentions);
  const result = await generateObject({
    model: anthropic(args.model),
    schema: responseSchema,
    temperature: 0,
    maxRetries: 0,
    prompt: [
      "Clasifica menciones de social listening usando exclusivamente el perfil aprobado.",
      "Topic responde de qué se habla. Narrative responde qué afirmación, historia o marco se construye.",
      "No conviertas triggers, barriers, decision layers, observed signals, findings, opportunities o recomendaciones en topics/narratives.",
      "No calcules números ni métricas. Devuelve una clasificación para cada mention_id exacto.",
      "Toda asignación requiere una cita textual exacta de la mención.",
      "Si nada aplica, assignments debe estar vacío y unclassified_reason debe explicar por qué.",
      `Tipo: ${args.scope.kind}`,
      `Perfil: ${args.scope.profile_id}`,
      `Revisión del corpus: ${args.scope.input_corpus_revision}`,
      `Términos aprobados: ${JSON.stringify(args.terms)}`,
      `Contexto RAG versionado recuperado por Voyage: ${JSON.stringify(contextRefs)}`,
      `Menciones: ${JSON.stringify(args.mentions)}`
    ].join("\n")
  });
  const allowedTerms = args.terms.map((term) => term.term_key);
  const classifications = result.object.classifications.map((item) =>
    normalizeSignalTaxonomyClassificationV1(item, allowedTerms)
  );
  assertCompleteBatch(args.mentions, classifications);
  const inputTokens = positiveTokenInteger(result.usage.inputTokens);
  const outputTokens = positiveTokenInteger(result.usage.outputTokens);
  const claudeCost = estimateModelCostUsd({
    provider: "anthropic",
    model: args.model,
    inputTokens,
    outputTokens
  }) ?? Number.POSITIVE_INFINITY;
  return {
    classifications,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: claudeCost + estimateVoyageCost(args.mentions),
    context_refs: contextRefs.map(({ text: _text, ...ref }) => ref)
  };
}

async function loadVersionedRagContext(
  scope: TaxonomyRunScope,
  mentions: MentionForClassification[]
) {
  const queryText = mentions.map((mention) => mention.text).join("\n").slice(0, 12_000);
  const embeddingModel = getEmbeddingModel("voyage");
  const [embedded] = await embedTexts({
    provider: "voyage",
    model: embeddingModel,
    inputType: "query",
    inputs: [{ id: "taxonomy-batch", text: queryText }]
  });
  if (!embedded) return [];
  const result = await pool.query<{
    source_id: string;
    chunk_hash: string;
    embedding_model: string;
    text: string;
    similarity: string;
  }>(`
    SELECT embedding.source_id::text, embedding.chunk_hash,
      embedding.embedding_model, left(embedding.chunk_text, 1200) AS text,
      (1 - (embedding.embedding <=> $3::vector))::text AS similarity
    FROM semantic_embeddings embedding
    WHERE embedding.scope_type = 'knowledge_source'
      AND embedding.embedding_model = $4
      AND (
        embedding.study_corpus_id = $1::uuid
        OR ($2::uuid IS NOT NULL AND embedding.brand_id = $2::uuid)
      )
    ORDER BY embedding.embedding <=> $3::vector, embedding.id
    LIMIT 8
  `, [
    scope.study_corpus_id,
    scope.brand_id,
    vectorLiteral(embedded.embedding),
    embeddingModel
  ]);
  return result.rows.map((row): RagContextRef => ({
    ...row,
    similarity: Number(row.similarity)
  }));
}

async function persistBatch(args: {
  scope: TaxonomyRunScope;
  mentions: MentionForClassification[];
  execution: SignalTaxonomyBatchExecution;
}) {
  const classifications = args.execution
    .classifications as SignalTaxonomyMentionClassificationV1[];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const classification of classifications) {
      for (const assignment of classification.assignments) {
        const reviewStatus = signalTaxonomyAssignmentDispositionV1(assignment);
        const persistedTag = await client.query<{ id: string }>(`
          INSERT INTO record_tags (
            organization_id, brand_id, study_corpus_id,
            subject_type, subject_id, taxonomy_term_id,
            value, score, confidence, evidence, source,
            model_version_id, signal_taxonomy_profile_id, review_status
          )
          SELECT $1::uuid, $2::uuid, $3::uuid,
            'mention', $4::uuid, term.id,
            term.term_key, $5, $6, $7::jsonb, $8,
            $9::uuid, $10::uuid, $12
          FROM taxonomy_terms term
          JOIN signal_taxonomy_profiles profile
            ON profile.taxonomy_id = term.taxonomy_id
          WHERE profile.id = $10::uuid
            AND term.term_key = $11
            AND term.status = 'active'
          ON CONFLICT (
            subject_id, signal_taxonomy_profile_id,
            taxonomy_term_id, model_version_id
          ) WHERE subject_type = 'mention'
            AND signal_taxonomy_profile_id IS NOT NULL
          DO UPDATE SET
            value = EXCLUDED.value,
            score = EXCLUDED.score,
            confidence = EXCLUDED.confidence,
            evidence = EXCLUDED.evidence
          WHERE record_tags.review_status NOT IN ('approved', 'rejected')
          RETURNING id::text
        `, [
          args.scope.organization_id,
          args.scope.brand_id,
          args.scope.study_corpus_id,
          classification.mention_id,
          assignment.score,
          assignment.confidence,
          JSON.stringify({
            contract_version: "signal-topics-narratives-v1",
            profile_id: args.scope.profile_id,
            corpus_revision: args.scope.input_corpus_revision,
            quotes: assignment.evidence,
            context_refs: args.execution.context_refs
          }),
          classificationSource(args.scope.profile_id),
          args.scope.model_version_id,
          args.scope.profile_id,
          assignment.term_key,
          reviewStatus
        ]);
        const tagId = persistedTag.rows[0]?.id;
        if (tagId) {
          await client.query(`
            INSERT INTO lineage_edges (
              source_type, source_id, target_type, target_id,
              relation_type, metadata
            ) VALUES
              ('mention', $1::uuid, 'record_tag', $2::uuid,
                'classified_as', jsonb_build_object(
                  'taxonomy_profile_id', $3::uuid,
                  'review_status', $6
                )),
              ('signal_taxonomy_profile', $3::uuid, 'record_tag', $2::uuid,
                'governs', '{}'::jsonb),
              ('tagging_model_version', $4::uuid, 'record_tag', $2::uuid,
                'generated', jsonb_build_object(
                  'corpus_revision', $5::int
                ))
            ON CONFLICT (
              source_type, source_id, target_type, target_id, relation_type
            ) DO UPDATE SET metadata = lineage_edges.metadata || EXCLUDED.metadata
          `, [
            classification.mention_id,
            tagId,
            args.scope.profile_id,
            args.scope.model_version_id,
            args.scope.input_corpus_revision,
            reviewStatus
          ]);
        }
      }
      await client.query(`
        INSERT INTO record_feature_values (
          organization_id, brand_id, study_corpus_id,
          subject_type, subject_id, feature_key, feature_value,
          value_type, confidence, source, model_version_id
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid,
          'mention', $4::uuid, $5, $6::jsonb,
          'signal_taxonomy_classification_v1', $7, $8, $9::uuid
        )
        ON CONFLICT (subject_type, subject_id, feature_key, source)
        DO UPDATE SET
          feature_value = EXCLUDED.feature_value,
          confidence = EXCLUDED.confidence,
          model_version_id = EXCLUDED.model_version_id
      `, [
        args.scope.organization_id,
        args.scope.brand_id,
        args.scope.study_corpus_id,
        classification.mention_id,
        classificationFeatureKey(args.scope.profile_id),
        JSON.stringify({
          contract_version: "signal-topics-narratives-v1",
          profile_id: args.scope.profile_id,
          kind: args.scope.kind,
          corpus_revision: args.scope.input_corpus_revision,
          assignment_count: classification.assignments.length,
          unclassified_reason: classification.unclassified_reason,
          context_refs: args.execution.context_refs
        }),
        highestConfidence(classification),
        classificationSource(args.scope.profile_id),
        args.scope.model_version_id
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function emitClassificationInvalidation(scope: TaxonomyRunScope) {
  const result = await pool.query<{ id: string }>(`
    WITH watermark AS (
      SELECT id
      FROM signal_data_watermarks
      WHERE workspace_id = $1::uuid AND study_corpus_id = $2::uuid
      ORDER BY accepted_at DESC, id
      LIMIT 1
    ), affected AS (
      SELECT
        min((mention.published_at AT TIME ZONE workspace.timezone)::date)
          AS affected_from,
        max((mention.published_at AT TIME ZONE workspace.timezone)::date)
          AS affected_through
      FROM signal_workspaces workspace
      JOIN record_feature_values feature
        ON feature.study_corpus_id = $2::uuid
       AND feature.subject_type = 'mention'
       AND feature.feature_key =
         'signal_taxonomy_classification:' || $5::uuid::text
       AND feature.source = 'signal_taxonomy_profile:' || $5::uuid::text
      JOIN mentions mention
        ON mention.id = feature.subject_id
       AND mention.study_corpus_id = feature.study_corpus_id
      WHERE workspace.id = $1::uuid
    )
    INSERT INTO signal_data_invalidations (
      workspace_id, study_corpus_id, data_watermark_id,
      source_key, idempotency_key, reason,
      affected_from, affected_through, scope
    )
    SELECT $1::uuid, $2::uuid, watermark.id,
      $3, $4, 'taxonomy_classification_accepted',
      affected.affected_from, affected.affected_through,
      jsonb_build_object(
        'taxonomy_profile_id', $5::uuid,
        'taxonomy_kind', $6,
        'corpus_revision', $7::int
      )
    FROM watermark CROSS JOIN affected
    ON CONFLICT (idempotency_key) DO UPDATE
      SET scope = signal_data_invalidations.scope || EXCLUDED.scope
    RETURNING id::text
  `, [
    scope.workspace_id,
    scope.study_corpus_id,
    `signal-taxonomy:${scope.kind}`,
    sha256(`taxonomy-invalidation:${scope.profile_id}:${scope.input_corpus_revision}`),
    scope.profile_id,
    scope.kind,
    scope.input_corpus_revision
  ]);
  return result.rows[0] ?? null;
}

async function completeRun(
  runId: string,
  status: "completed" | "skipped",
  summary: Record<string, unknown>,
  usage?: { cost_usd: number; input_tokens: number; output_tokens: number }
) {
  await pool.query(`
    UPDATE signal_refresh_runs
    SET status = $2, completed_at = now(), heartbeat_at = now(),
      result_summary = $3::jsonb,
      actual_cost_usd = $4, input_tokens = $5, output_tokens = $6,
      error_code = NULL, error_summary = '{}'::jsonb, updated_at = now()
    WHERE id = $1::uuid AND run_type = 'taxonomy_enrichment'
  `, [
    runId,
    status,
    JSON.stringify(summary),
    usage?.cost_usd ?? 0,
    usage?.input_tokens ?? 0,
    usage?.output_tokens ?? 0
  ]);
  return { run_id: runId, status, ...summary };
}

function assertCompleteBatch(
  mentions: MentionForClassification[],
  classifications: SignalTaxonomyMentionClassificationV1[]
) {
  const expected = new Set(mentions.map((mention) => mention.id));
  const seen = new Set<string>();
  for (const classification of classifications) {
    if (!expected.has(classification.mention_id)) {
      throw new Error("signal_taxonomy_unknown_mention_id");
    }
    if (seen.has(classification.mention_id)) {
      throw new Error("signal_taxonomy_duplicate_mention_id");
    }
    seen.add(classification.mention_id);
  }
  if (seen.size !== expected.size) {
    throw new Error("signal_taxonomy_incomplete_batch");
  }
}

function estimateBatchCost(
  mentions: MentionForClassification[],
  terms: TaxonomyTerm[],
  model: string
) {
  const estimatedInputTokens = Math.ceil(
    (JSON.stringify(mentions).length + JSON.stringify(terms).length + 8_000) / 4
  );
  const estimatedOutputTokens = Math.max(800, mentions.length * 180);
  return (estimateModelCostUsd({
    provider: "anthropic",
    model,
    inputTokens: estimatedInputTokens,
    outputTokens: estimatedOutputTokens
  }) ?? 10) + estimateVoyageCost(mentions);
}

function estimateVoyageCost(mentions: MentionForClassification[]) {
  const usdPerMillion = finiteNonnegative(
    process.env.NOISIA_SIGNAL_TAXONOMY_VOYAGE_USD_PER_MILLION_TOKENS,
    0.12
  );
  const tokens = Math.ceil(mentions.reduce((sum, mention) => sum + mention.text.length, 0) / 4);
  return (tokens / 1_000_000) * usdPerMillion;
}

function highestConfidence(classification: SignalTaxonomyMentionClassificationV1) {
  if (classification.assignments.some((item) => item.confidence === "high")) return "high";
  if (classification.assignments.some((item) => item.confidence === "medium")) return "medium";
  if (classification.assignments.some((item) => item.confidence === "low")) return "low";
  return "not_applicable";
}

function classificationFeatureKey(profileId: string) {
  return `signal_taxonomy_classification:${profileId}`;
}

function classificationSource(profileId: string) {
  return `signal_taxonomy_profile:${profileId}`;
}

function chunk<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function finiteNonnegative(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("signal_taxonomy_")) return message.slice(0, 120);
  return "signal_taxonomy_enrichment_failed";
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/postgres(?:ql)?:\/\/\S+/giu, "[redacted-database-url]")
    .replace(/(?:sk-ant|pa-)[A-Za-z0-9_-]+/gu, "[redacted-provider-key]")
    .slice(0, 500);
}

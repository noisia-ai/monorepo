import { createHash } from "node:crypto";

import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { Job } from "bullmq";

import {
  buildEngineCodingPrompt,
  buildEngineFixtureCodings,
  getEngineMethodologySpec,
  isEngineFixtureCodingEnabled,
  isEngineLlmEnabled,
  isEngineModelAllowed,
  isEngineRunnableMethodologySlug,
  parseEngineCodingResponse
} from "@noisia/query-engine";
import { pool } from "../db/client";
import {
  enqueueEngineStep,
  markEngineStepCompleted,
  markEngineStepFailed,
  markEngineStepRunning,
  recordEngineCostEvent,
  releaseEngineCorpusLock
} from "./engine-shared";
import {
  readRetrievedUnitLimit,
  readRetrievedUnits,
  shouldReadUnitsFromRunMap,
  type EngineUnit
} from "./engine-scope";
import { normalizeEngineCodingIntensity } from "./engine-coding-utils";
import { safeJsonStringifyForPostgres, sanitizeUnicodeForPostgresText } from "./postgres-json";

type EngineStepJobData = {
  engineAnalysisId: string;
  pipelineStepId: string;
};

type AnalysisRow = {
  id: string;
  study_corpus_id: string;
  methodology_slug: string;
  business_question: string | null;
  params: Record<string, unknown> | null;
  meta_json: Record<string, unknown>;
  brand_name: string | null;
  theme_name: string | null;
};

type EngineUnitReader = {
  totalUnits: number;
  source: "run_map" | "legacy_meta";
  loadBatch: (offset: number, limit: number) => Promise<EngineUnit[]>;
};

export async function engineCodeJob(job: Job<EngineStepJobData>) {
  const { engineAnalysisId, pipelineStepId } = job.data;
  await markEngineStepRunning(pipelineStepId);
  await job.updateProgress(8);

  try {
    const analysis = await loadAnalysis(engineAnalysisId);
    if (!isEngineRunnableMethodologySlug(analysis.methodology_slug)) {
      throw new Error(`Unsupported or read-only engine methodology slug: ${analysis.methodology_slug}`);
    }
    const spec = getEngineMethodologySpec(analysis.methodology_slug);
    const unitReader = await createRetrievedUnitReader(analysis);
    const totalUnits = unitReader.totalUnits;
    await pool.query(`DELETE FROM engine_codings WHERE engine_analysis_id = $1`, [engineAnalysisId]);
    await job.updateProgress(20);

    const allowFixtureCoding = analysis.params?.allow_fixture_coding === true;
    if (totalUnits > 0 && allowFixtureCoding && isEngineFixtureCodingEnabled()) {
      const fixtureBatchSize = Math.max(100, Math.min(1000, Number(process.env.ENGINE_FIXTURE_BATCH_SIZE ?? 500)));
      let coded = 0;
      let labelCount = 0;
      for (let offset = 0; offset < totalUnits; offset += fixtureBatchSize) {
        const batch = await unitReader.loadBatch(offset, fixtureBatchSize);
        if (batch.length === 0) break;
        const labels = buildEngineFixtureCodings(analysis.methodology_slug, batch.map((unit) => ({
          external_ref: unit.external_ref,
          entity_hint: unit.entity_hint,
          text: unit.text,
          platform: unit.platform,
          published_at: unit.published_at
        })));
        labelCount += labels.length;
        coded += await insertLabels({
          engineAnalysisId,
          analysis,
          labels,
          unitByRef: new Map(batch.map((unit) => [unit.external_ref, unit]))
        });
      }
      if (labelCount === 0) {
        await recordEngineCostEvent({
          engineAnalysisId,
          pipelineStepId,
          provider: "fixture",
          model: null,
          operation: "engine_code_fixture_unsupported",
          usage: null,
          metadata: {
            methodology_slug: analysis.methodology_slug,
            units: totalUnits,
            source: unitReader.source
          }
        });
      } else {
        const reason = "Engine fixture coding used for no-cost beta QA. Do not treat this as client-ready synthesis.";
        await recordEngineCostEvent({
          engineAnalysisId,
          pipelineStepId,
          provider: "fixture",
          model: null,
          operation: "engine_code_fixture",
          usage: null,
          metadata: {
            methodology_slug: analysis.methodology_slug,
            units: totalUnits,
            labels: labelCount,
            non_ambiguous: coded,
            source: unitReader.source
          }
        });
        await appendLimitation(engineAnalysisId, reason);
        await markEngineCodingMeta(engineAnalysisId, {
          provider: "fixture",
          fixture: true,
          warning: reason,
          coded,
          units: totalUnits,
          labels: labelCount,
          source: unitReader.source
        });
        await markEngineStepCompleted({
          pipelineStepId,
          resultSummary: { coded, units: totalUnits, fixture: true, source: unitReader.source }
        });
        const next = await enqueueEngineStep({ engineAnalysisId, step: "score" });
        await job.updateProgress(100);
        return { coded, fixture: true, next_step_job_id: next.jobId };
      }
    }

    if (totalUnits === 0 || !process.env.ANTHROPIC_API_KEY || !isEngineLlmEnabled()) {
      const reason = totalUnits === 0
        ? "No retrieved units available for engine coding."
        : !process.env.ANTHROPIC_API_KEY
          ? "Engine LLM coding skipped because ANTHROPIC_API_KEY is not configured."
          : "Engine LLM coding skipped because NOISIA_ENGINE_LLM_ENABLED is not true.";
      await recordEngineCostEvent({
        engineAnalysisId,
        pipelineStepId,
        provider: "anthropic",
        model: process.env.ANTHROPIC_MODEL_ENGINE ?? process.env.ANTHROPIC_MODEL_DEFAULT ?? null,
        operation: "engine_code_skipped",
        usage: null,
        metadata: { reason, units: totalUnits, source: unitReader.source }
      });
      await appendLimitation(engineAnalysisId, reason);
      throw new Error(reason);
    }

    const model = process.env.ANTHROPIC_MODEL_ENGINE ?? process.env.ANTHROPIC_MODEL_DEFAULT ?? "claude-sonnet-4-6";
    if (!isEngineModelAllowed(model)) {
      const reason = `Engine LLM coding skipped because model "${model}" is not allowed without NOISIA_ENGINE_ALLOW_OPUS=true.`;
      await recordEngineCostEvent({
        engineAnalysisId,
        pipelineStepId,
        provider: "anthropic",
        model,
        operation: "engine_code_model_blocked",
        usage: null,
        metadata: { reason, units: totalUnits, source: unitReader.source }
      });
      await appendLimitation(engineAnalysisId, reason);
      throw new Error(reason);
    }
    const batchSize = Math.max(8, Math.min(36, Number(process.env.ENGINE_CODING_BATCH_SIZE ?? 18)));
    const batchTimeoutMs = Math.max(30_000, Number(process.env.ENGINE_CODING_BATCH_TIMEOUT_MS ?? 120_000));
    const batchDelayMs = readNonNegativeInteger(process.env.ENGINE_CODING_BATCH_DELAY_MS) ?? 0;
    const batchCount = Math.ceil(totalUnits / batchSize);
    const maxBatchRetries = readNonNegativeInteger(process.env.ENGINE_CODING_BATCH_RETRIES) ?? 1;
    // A lens has ~100+ Claude batches; a handful can fail transiently (overload,
    // 120s abort, malformed JSON from the model). Skip those and keep going
    // instead of nuking the whole lens — only abort if nothing coded or too many
    // batches failed to trust the output.
    const maxFailedBatchFraction = readFractionEnv(process.env.ENGINE_CODING_MAX_FAILED_FRACTION, 0.35);
    let coded = 0;
    let failedBatches = 0;
    for (let offset = 0; offset < totalUnits; offset += batchSize) {
      const batch = await unitReader.loadBatch(offset, batchSize);
      if (batch.length === 0) break;
      const batchIndex = Math.floor(offset / batchSize);
      const prompt = buildEngineCodingPrompt(spec, {
        brandName: analysis.brand_name ?? analysis.theme_name ?? "Study subject",
        businessQuestion: analysis.business_question,
        params: analysis.params,
        ragContext: analysis.meta_json.preflight ?? null,
        units: batch.map((unit) => ({
          external_ref: unit.external_ref,
          entity_hint: unit.entity_hint,
          text: unit.text,
          platform: unit.platform,
          published_at: unit.published_at
        }))
      });
      const unitByRef = new Map(batch.map((unit) => [unit.external_ref, unit]));

      let batchError: string | null = null;
      for (let attempt = 0; attempt <= maxBatchRetries; attempt++) {
        try {
          console.log(
            `[engine-code] ${analysis.methodology_slug} batch ${batchIndex + 1}/${batchCount}${attempt > 0 ? ` (retry ${attempt})` : ""} (${batch.length} units, timeout ${batchTimeoutMs}ms)`
          );
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), batchTimeoutMs);
          const response = await generateText({
            model: anthropic(model),
            prompt,
            temperature: 0,
            abortSignal: controller.signal
          }).finally(() => clearTimeout(timeout));
          await recordEngineCostEvent({
            engineAnalysisId,
            pipelineStepId,
            provider: "anthropic",
            model,
            operation: "engine_code_batch",
            usage: readAiSdkUsage(response),
            metadata: {
              batch_index: batchIndex,
              batch_units: batch.length,
              total_units: totalUnits,
              attempt,
              source: unitReader.source,
              methodology_slug: analysis.methodology_slug,
              prompt_hash: sha256(prompt),
              response_hash: sha256(response.text)
            }
          });
          const labels = parseEngineCodingResponse(response.text);
          coded += await insertLabels({ engineAnalysisId, analysis, labels, unitByRef });
          batchError = null;
          break;
        } catch (batchErr) {
          batchError = batchErr instanceof Error ? batchErr.message : String(batchErr);
          console.warn(
            `[engine-code] ${analysis.methodology_slug} batch ${batchIndex + 1} attempt ${attempt + 1} failed: ${batchError}`
          );
          if (attempt < maxBatchRetries) await sleep(1500 * (attempt + 1));
        }
      }

      if (batchError) {
        failedBatches += 1;
        await recordEngineCostEvent({
          engineAnalysisId,
          pipelineStepId,
          provider: "anthropic",
          model,
          operation: "engine_code_batch_skipped",
          usage: null,
          metadata: {
            batch_index: batchIndex,
            batch_units: batch.length,
            methodology_slug: analysis.methodology_slug,
            reason: batchError.slice(0, 300)
          }
        });
      }

      await job.updateProgress(Math.min(90, 20 + Math.round(((offset + batch.length) / totalUnits) * 70)));
      if (batchDelayMs > 0 && offset + batch.length < totalUnits) {
        await sleep(batchDelayMs);
      }
    }

    if (coded === 0) {
      const reason = `Engine coding produced 0 usable labels across ${batchCount} batches (${failedBatches} failed).`;
      await appendLimitation(engineAnalysisId, reason);
      throw new Error(reason);
    }
    if (batchCount > 0 && failedBatches / batchCount > maxFailedBatchFraction) {
      const reason = `Engine coding failed ${failedBatches}/${batchCount} batches (> ${Math.round(maxFailedBatchFraction * 100)}% threshold); rerun the lens.`;
      await appendLimitation(engineAnalysisId, reason);
      throw new Error(reason);
    }
    if (failedBatches > 0) {
      await appendLimitation(
        engineAnalysisId,
        `Engine coding skipped ${failedBatches}/${batchCount} batches after transient model/parse errors; synthesis is based on the ${coded} coded units.`
      );
    }

    await markEngineCodingMeta(engineAnalysisId, {
      provider: "anthropic",
      fixture: false,
      model,
      coded,
      units: totalUnits,
      batches: batchCount,
      failed_batches: failedBatches,
      source: unitReader.source
    });
    await markEngineStepCompleted({
      pipelineStepId,
      resultSummary: { coded, units: totalUnits, model, source: unitReader.source }
    });
    const next = await enqueueEngineStep({ engineAnalysisId, step: "score" });
    await job.updateProgress(100);
    return { coded, next_step_job_id: next.jobId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markEngineStepFailed({ pipelineStepId, errorMessage: msg });
    await releaseEngineCorpusLock(engineAnalysisId);
    throw err;
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function insertLabels(args: {
  engineAnalysisId: string;
  analysis: AnalysisRow;
  labels: Array<{
    external_ref: string;
    finding_key: string;
    dimensions: Record<string, string | number | boolean>;
    intensity: number;
    span: string;
    ambiguous?: boolean;
  }>;
  unitByRef: Map<string, EngineUnit>;
}) {
  let coded = 0;
  for (const label of args.labels) {
    const unit = args.unitByRef.get(label.external_ref);
    if (!unit) continue;
    await pool.query(
      `INSERT INTO engine_codings (
         engine_analysis_id, study_corpus_id, methodology_slug, mention_id, entity_id,
         labels, intensity, span, ambiguous
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
      [
        args.engineAnalysisId,
        unit.study_corpus_id ?? args.analysis.study_corpus_id,
        args.analysis.methodology_slug,
        unit.external_ref,
        unit.entity_id,
        safeJsonStringifyForPostgres({ finding_key: label.finding_key, dimensions: label.dimensions }),
        normalizeEngineCodingIntensity(label.intensity),
        sanitizeUnicodeForPostgresText(label.span),
        label.ambiguous === true
      ]
    );
    if (label.ambiguous !== true) coded += 1;
  }
  return coded;
}

async function loadAnalysis(engineAnalysisId: string): Promise<AnalysisRow> {
  const r = await pool.query<AnalysisRow>(
    `SELECT
       ea.id,
       ea.study_corpus_id,
       ea.methodology_slug,
       ea.business_question,
       ea.params,
       ea.meta_json,
       b.display_name AS brand_name,
       t.name AS theme_name
     FROM engine_analyses ea
     JOIN study_corpora sc ON sc.id = ea.study_corpus_id
     LEFT JOIN brands b ON b.id = sc.brand_id
     LEFT JOIN themes t ON t.id = sc.theme_id
     WHERE ea.id = $1`,
    [engineAnalysisId]
  );
  const row = r.rows[0];
  if (!row) throw new Error(`engine_analyses ${engineAnalysisId} not found`);
  return row;
}

async function createRetrievedUnitReader(analysis: AnalysisRow): Promise<EngineUnitReader> {
  if (!shouldReadUnitsFromRunMap(analysis.meta_json)) {
    const units = readRetrievedUnits(analysis.meta_json);
    return {
      totalUnits: units.length,
      source: "legacy_meta",
      loadBatch: async (offset, limit) => units.slice(offset, offset + limit)
    };
  }

  const limit = readRetrievedUnitLimit(analysis.meta_json, readPositiveInteger(process.env.ENGINE_MAX_UNITS) ?? 180);
  const counted = await pool.query<{ total_units: number }>(
    `SELECT COUNT(*)::int AS total_units
     FROM engine_run_mention_map erm
     JOIN mentions m ON m.id = erm.mention_id
     WHERE erm.engine_analysis_id = $1
       AND length(m.text_clean) >= 24`,
    [analysis.id]
  );
  const totalUnits = Math.min(limit, Number(counted.rows[0]?.total_units ?? 0));

  return {
    totalUnits,
    source: "run_map",
    loadBatch: (offset, batchLimit) => loadRunMapUnitBatch(analysis.id, offset, Math.min(batchLimit, Math.max(0, totalUnits - offset)))
  };
}

async function loadRunMapUnitBatch(
  engineAnalysisId: string,
  offset: number,
  limit: number
): Promise<EngineUnit[]> {
  if (limit <= 0) return [];
  const r = await pool.query<{
    external_ref: string;
    study_corpus_id: string | null;
    entity_id: string | null;
    entity_hint: string | null;
    text: string;
    platform: string | null;
    published_at: string | null;
  }>(
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
     LIMIT $2
     OFFSET $3`,
    [engineAnalysisId, limit, offset]
  );

  return r.rows
    .map((unit) => ({
      external_ref: unit.external_ref,
      study_corpus_id: unit.study_corpus_id,
      entity_id: unit.entity_id,
      entity_hint: unit.entity_hint ? sanitizeForLlm(sanitizeUnicodeForPostgresText(unit.entity_hint)) : null,
      text: sanitizeForLlm(truncateCodePoints(sanitizeUnicodeForPostgresText(unit.text), 1800)),
      platform: unit.platform ? sanitizeForLlm(sanitizeUnicodeForPostgresText(unit.platform)) : null,
      published_at: unit.published_at
    }))
    .filter((unit) => unit.external_ref && unit.text);
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

async function markEngineCodingMeta(engineAnalysisId: string, coding: Record<string, unknown>) {
  await pool.query(
    `UPDATE engine_analyses
     SET meta_json = COALESCE(meta_json, '{}'::jsonb) || $1::jsonb,
         updated_at = NOW()
     WHERE id = $2`,
    [safeJsonStringifyForPostgres({ engine_coding: coding }), engineAnalysisId]
  );
}

function readAiSdkUsage(response: unknown) {
  const record = response && typeof response === "object" && "usage" in response
    ? response.usage as Record<string, unknown>
    : {};
  return {
    inputTokens: numberOrNull(record.inputTokens ?? record.promptTokens),
    outputTokens: numberOrNull(record.outputTokens ?? record.completionTokens),
    totalTokens: numberOrNull(record.totalTokens)
  };
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readPositiveInteger(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.floor(number);
}

function readNonNegativeInteger(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.floor(number);
}

function readFractionEnv(value: unknown, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) return fallback;
  return number;
}

// Strip characters that can make the Anthropic HTTP request body invalid JSON:
// unpaired surrogates and C0/C1 control chars (keep \n and \t).
function sanitizeForLlm(value: string): string {
  return value
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, " ");
}

function truncateCodePoints(value: string, maxCodePoints: number): string {
  return Array.from(value).slice(0, maxCodePoints).join("");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

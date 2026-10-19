import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { Job } from "bullmq";

import {
  type EngineSignalFindingInput,
  type EngineSignalOwnership,
  type EngineSignalConfidence,
  isEngineLlmEnabled,
  isEngineModelAllowed
} from "@noisia/query-engine";
import { pool } from "../db/client";
import {
  applyEngineEditorialSynthesis,
  buildEngineEditorialSynthesisPrompt,
  buildEngineSynthesisPayload,
  engineEditorialSynthesisRequiredError,
  isDeterministicEngineSynthesisAllowed,
  parseEngineEditorialSynthesisResponse
} from "./engine-synthesis";
import {
  enqueueEngineStep,
  markEngineStepCompleted,
  markEngineStepFailed,
  markEngineStepRunning,
  recordEngineCostEvent,
  releaseEngineCorpusLock
} from "./engine-shared";

type EngineStepJobData = {
  engineAnalysisId: string;
  pipelineStepId: string;
};

type SummaryRow = {
  findings: number;
  high_confidence: number;
  medium_confidence: number;
  directional_confidence: number;
};

type AnalysisRow = {
  id: string;
  methodology_slug: string;
  methodology_version: string;
  limitations: unknown;
  meta_json: Record<string, unknown> | null;
};

type FindingRow = {
  id: string;
  finding_key: string;
  name: string;
  dimensions: Record<string, unknown> | null;
  frequency: number;
  intensity: string | null;
  sentiment: string | null;
  share_pct: string | null;
  composite_score: string | null;
  ownership: string | null;
  confidence: string | null;
  evidence_count: number;
  mention_ids: string[] | null;
  quote: string | null;
};

export async function engineSynthesizeJob(job: Job<EngineStepJobData>) {
  const { engineAnalysisId, pipelineStepId } = job.data;
  await markEngineStepRunning(pipelineStepId);
  await job.updateProgress(20);

  try {
    const analysis = await loadAnalysis(engineAnalysisId);
    const summary = await loadSummary(engineAnalysisId);
    const findings = (await loadFindings(engineAnalysisId)).map(normalizeFindingRow);
    const basePayload = buildEngineSynthesisPayload({
      analysis,
      summary,
      findings
    });
    let synthesis: Record<string, unknown> = basePayload.synthesis;
    let engineBlock = basePayload.engine_block;
    let resultSummary: Record<string, unknown> = basePayload.result_summary;

    const editorial = await maybeApplyEditorialSynthesis({
      analysis,
      engineAnalysisId,
      pipelineStepId,
      engineBlock,
      findings
    });
    if (editorial) {
      engineBlock = editorial.engineBlock;
      synthesis = {
        ...synthesis,
        headline: engineBlock.summary,
        editorial_synthesis: editorial.meta,
        engine_block_ready: engineBlock.charts.length > 0 && engineBlock.findings.length > 0
      };
      resultSummary = {
        ...resultSummary,
        headline: engineBlock.summary,
        editorial_synthesis: editorial.meta,
        conclusions: engineBlock.methodology_view.conclusions.length,
        readiness: engineBlock.methodology_view.readiness.status
      };
    }

    await pool.query(
      `UPDATE engine_analyses
       SET meta_json = COALESCE(meta_json, '{}'::jsonb) || $1::jsonb,
           updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify({ synthesis, engine_block: engineBlock }), engineAnalysisId]
    );
    await job.updateProgress(80);

    await markEngineStepCompleted({
      pipelineStepId,
      resultSummary
    });
    const next = await enqueueEngineStep({ engineAnalysisId, step: "quality_gates" });
    await job.updateProgress(100);
    return { synthesis, engine_block: engineBlock, next_step_job_id: next.jobId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markEngineStepFailed({ pipelineStepId, errorMessage: msg });
    await releaseEngineCorpusLock(engineAnalysisId);
    throw err;
  }
}

async function loadAnalysis(engineAnalysisId: string): Promise<AnalysisRow> {
  const r = await pool.query<AnalysisRow>(
    `SELECT id, methodology_slug, methodology_version, limitations, meta_json
     FROM engine_analyses
     WHERE id = $1`,
    [engineAnalysisId]
  );
  const row = r.rows[0];
  if (!row) throw new Error(`engine_analyses ${engineAnalysisId} not found`);
  return row;
}

async function loadSummary(engineAnalysisId: string): Promise<SummaryRow> {
  const r = await pool.query<SummaryRow>(
    `SELECT
       COUNT(*)::int AS findings,
       COUNT(*) FILTER (WHERE confidence = 'alta')::int AS high_confidence,
       COUNT(*) FILTER (WHERE confidence = 'media')::int AS medium_confidence,
       COUNT(*) FILTER (WHERE confidence = 'baja_direccional')::int AS directional_confidence
     FROM engine_findings
     WHERE engine_analysis_id = $1`,
    [engineAnalysisId]
  );
  return r.rows[0] ?? { findings: 0, high_confidence: 0, medium_confidence: 0, directional_confidence: 0 };
}

async function loadFindings(engineAnalysisId: string): Promise<FindingRow[]> {
  const r = await pool.query<FindingRow>(
    `SELECT
       f.id,
       f.finding_key,
       f.name,
       f.dimensions,
       f.frequency,
       f.intensity::text,
       f.sentiment::text,
       f.share_pct::text,
       f.composite_score::text,
       f.ownership,
       f.confidence,
       COUNT(c.id)::int AS evidence_count,
       COALESCE(array_remove(array_agg(c.mention_id::text ORDER BY c.position), NULL), ARRAY[]::text[]) AS mention_ids,
       (array_remove(array_agg(m.text_clean ORDER BY c.is_protagonist DESC, c.position ASC), NULL))[1] AS quote
     FROM engine_findings f
     LEFT JOIN engine_finding_citations c ON c.finding_id = f.id
     LEFT JOIN mentions m ON m.id = c.mention_id
     WHERE f.engine_analysis_id = $1
     GROUP BY f.id
     ORDER BY f.position ASC, f.composite_score DESC NULLS LAST`,
    [engineAnalysisId]
  );
  return r.rows;
}

async function maybeApplyEditorialSynthesis(args: {
  analysis: AnalysisRow;
  engineAnalysisId: string;
  pipelineStepId: string;
  engineBlock: ReturnType<typeof buildEngineSynthesisPayload>["engine_block"];
  findings: EngineSignalFindingInput[];
}) {
  if (args.findings.length === 0) return null;
  const engineCoding = asRecord(asRecord(args.analysis.meta_json).engine_coding);
  if (engineCoding.fixture === true || engineCoding.provider === "fixture") {
    return {
      engineBlock: args.engineBlock,
      meta: {
        provider: "deterministic",
        skipped: true,
        reason: "fixture_coding"
      }
    };
  }
  if (!process.env.ANTHROPIC_API_KEY || !isEngineLlmEnabled()) {
    const reason = !process.env.ANTHROPIC_API_KEY ? "anthropic_key_missing" : "engine_llm_disabled";
    if (!isDeterministicEngineSynthesisAllowed()) {
      throw new Error(engineEditorialSynthesisRequiredError(reason));
    }
    return {
      engineBlock: args.engineBlock,
      meta: {
        provider: "deterministic",
        skipped: true,
        reason
      }
    };
  }

  const model = process.env.ANTHROPIC_MODEL_ENGINE_SYNTHESIS
    ?? process.env.ANTHROPIC_MODEL_ENGINE
    ?? process.env.ANTHROPIC_MODEL_DEFAULT
    ?? "claude-sonnet-4-6";
  if (!isEngineModelAllowed(model)) {
    const reason = `model_blocked:${model}`;
    if (!isDeterministicEngineSynthesisAllowed()) {
      throw new Error(engineEditorialSynthesisRequiredError(reason));
    }
    return {
      engineBlock: args.engineBlock,
      meta: {
        provider: "deterministic",
        skipped: true,
        reason
      }
    };
  }

  const prompt = buildEngineEditorialSynthesisPrompt({
    analysis: args.analysis,
    block: args.engineBlock,
    findings: args.findings
  });

  try {
    const response = await generateText({
      model: anthropic(model),
      prompt,
      temperature: 0.2
    });
    await recordEngineCostEvent({
      engineAnalysisId: args.engineAnalysisId,
      pipelineStepId: args.pipelineStepId,
      provider: "anthropic",
      model,
      operation: "engine_synthesize_editorial",
      usage: readAiSdkUsage(response),
      metadata: {
        methodology_slug: args.analysis.methodology_slug,
        findings: args.findings.length
      }
    });
    const parsed = parseEngineEditorialSynthesisResponse(response.text);
    await persistEditorialFindingUpdates(args.engineAnalysisId, parsed.finding_titles);
    return {
      engineBlock: applyEngineEditorialSynthesis(args.engineBlock, parsed),
      meta: {
        provider: "anthropic",
        model,
        findings: args.findings.length,
        edited_findings: parsed.finding_titles.length,
        conclusions: parsed.conclusions.length
      }
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await recordEngineCostEvent({
      engineAnalysisId: args.engineAnalysisId,
      pipelineStepId: args.pipelineStepId,
      provider: "anthropic",
      model,
      operation: "engine_synthesize_editorial_failed",
      usage: null,
      metadata: {
        methodology_slug: args.analysis.methodology_slug,
        reason: reason.slice(0, 500)
      }
    });
    if (!isDeterministicEngineSynthesisAllowed()) {
      throw new Error(engineEditorialSynthesisRequiredError(reason.slice(0, 500)));
    }
    return {
      engineBlock: args.engineBlock,
      meta: {
        provider: "deterministic",
        fallback_from: "anthropic",
        reason: reason.slice(0, 500)
      }
    };
  }
}

async function persistEditorialFindingUpdates(
  engineAnalysisId: string,
  findingTitles: Array<{
    finding_id: string;
    title: string;
    reader_takeaway: string | null;
    confidence_note: string | null;
  }>
) {
  for (const item of findingTitles) {
    if (!item.finding_id || !item.title) continue;
    await pool.query(
      `UPDATE engine_findings
       SET name = $1,
           dimensions = COALESCE(dimensions, '{}'::jsonb) || $2::jsonb
       WHERE engine_analysis_id = $3
         AND finding_key = $4`,
      [
        item.title,
        JSON.stringify({
          editorial_takeaway: item.reader_takeaway,
          editorial_confidence_note: item.confidence_note
        }),
        engineAnalysisId,
        item.finding_id
      ]
    );
  }
}

function normalizeFindingRow(row: FindingRow): EngineSignalFindingInput {
  return {
    id: row.id,
    findingKey: row.finding_key,
    name: row.name,
    dimensions: row.dimensions ?? {},
    frequency: Number(row.frequency ?? 0),
    intensity: numberOrNull(row.intensity),
    sentiment: numberOrNull(row.sentiment),
    sharePct: numberOrNull(row.share_pct),
    compositeScore: numberOrNull(row.composite_score),
    ownership: coerceOwnership(row.ownership),
    confidence: coerceConfidence(row.confidence),
    evidenceCount: Number(row.evidence_count ?? 0),
    mentionIds: row.mention_ids ?? [],
    quote: row.quote
  };
}

function coerceConfidence(value: unknown): EngineSignalConfidence {
  if (value === "alta" || value === "media" || value === "baja_direccional") return value;
  return "baja_direccional";
}

function coerceOwnership(value: unknown): EngineSignalOwnership | null {
  if (
    value === "brand_owned" ||
    value === "competitor_owned" ||
    value === "category_wide" ||
    value === "shared" ||
    value === "insufficient_evidence"
  ) {
    return value;
  }
  return null;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
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

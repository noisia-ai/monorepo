import type { Job } from "bullmq";

import {
  aggregateEngineCodings,
  getEngineMethodologySpec,
  isEngineRunnableMethodologySlug,
  scoreAudienceSegmentLens,
  scoreBrandPositioningMap,
  scoreCategoryOpportunityMap,
  scoreCompetitiveWave,
  scoreCulturalCodesDecoding,
  scoreDecisionVelocity,
  scoreInfluenceArchitecture,
  scoreJourneyFrictionMapping,
  scoreNarrativeOwnership,
  scoreSentimentAdvocacy,
  scoreTrustRiskBenchmark,
  scoreValuePerceptionMatrix,
  scoreWhiteSpaceAnalysis
} from "@noisia/query-engine";
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

type AnalysisRow = {
  id: string;
  study_corpus_id: string;
  methodology_slug: string;
};

type CodingRow = {
  mention_id: string | null;
  entity_id: string | null;
  entity_kind: string | null;
  labels: Record<string, unknown>;
  intensity: string | null;
  span: string | null;
  platform: string | null;
  sentiment_score: string | null;
  published_at: Date | string | null;
  quality_score: number | null;
};

export async function engineScoreJob(job: Job<EngineStepJobData>) {
  const { engineAnalysisId, pipelineStepId } = job.data;
  await markEngineStepRunning(pipelineStepId);
  await job.updateProgress(10);

  try {
    const analysis = await loadAnalysis(engineAnalysisId);
    if (!isEngineRunnableMethodologySlug(analysis.methodology_slug)) {
      throw new Error(`Unsupported or read-only engine methodology slug: ${analysis.methodology_slug}`);
    }
    const spec = getEngineMethodologySpec(analysis.methodology_slug);
    const rows = await loadCodings(engineAnalysisId);
    await pool.query(`DELETE FROM engine_findings WHERE engine_analysis_id = $1`, [engineAnalysisId]);
    await job.updateProgress(30);

    const findings = aggregateEngineCodings(rows.map(toAggregateInput));
    const methodologyScores = buildMethodologyScores(analysis.methodology_slug, findings, rows);
    let citations = 0;

    for (const findingAggregate of findings) {
      const methodologyScore = methodologyScores.get(aggregateKey(findingAggregate.findingKey, findingAggregate.entityId));
      const dimensions = methodologyScore
        ? { ...findingAggregate.dimensions, ...methodologyScore.dimensions }
        : findingAggregate.dimensions;
      const [finding] = (
        await pool.query<{ id: string }>(
          `INSERT INTO engine_findings (
             engine_analysis_id, study_corpus_id, methodology_slug, finding_key, entity_id,
             unit_kind, name, dimensions, frequency, intensity, sentiment, share_pct,
             composite_score, ownership, differentiation_index, confidence, confidence_factors,
             period_start, period_end, position
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19, $20)
           RETURNING id`,
          [
            engineAnalysisId,
            analysis.study_corpus_id,
            analysis.methodology_slug,
            findingAggregate.findingKey,
            findingAggregate.entityId,
            spec.unitKind,
            findingAggregate.name,
            JSON.stringify(dimensions),
            findingAggregate.frequency,
            findingAggregate.intensity,
            findingAggregate.sentiment,
            methodologyScore?.sharePct ?? findingAggregate.sharePct,
            findingAggregate.compositeScore,
            methodologyScore?.ownership ?? null,
            methodologyScore?.differentiationIndex ?? null,
            findingAggregate.confidence,
            JSON.stringify(findingAggregate.confidenceFactors),
            findingAggregate.periodStart,
            findingAggregate.periodEnd,
            findingAggregate.position
          ]
        )
      ).rows;

      if (finding?.id) {
        for (const citation of findingAggregate.citations) {
          await pool.query(
            `INSERT INTO engine_finding_citations (finding_id, mention_id, is_protagonist, position)
             VALUES ($1, $2, $3, $4)`,
            [finding.id, citation.mentionId, citation.position === 1, citation.position]
          );
          citations += 1;
        }
      }
    }

    await markEngineStepCompleted({
      pipelineStepId,
      resultSummary: {
        codings: rows.length,
        findings: findings.length,
        citations
      }
    });
    const next = await enqueueEngineStep({ engineAnalysisId, step: "synthesize" });
    await job.updateProgress(100);
    return { findings: findings.length, citations, next_step_job_id: next.jobId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markEngineStepFailed({ pipelineStepId, errorMessage: msg });
    await releaseEngineCorpusLock(engineAnalysisId);
    throw err;
  }
}

async function loadAnalysis(engineAnalysisId: string): Promise<AnalysisRow> {
  const r = await pool.query<AnalysisRow>(
    `SELECT id, study_corpus_id, methodology_slug
     FROM engine_analyses
     WHERE id = $1`,
    [engineAnalysisId]
  );
  const row = r.rows[0];
  if (!row) throw new Error(`engine_analyses ${engineAnalysisId} not found`);
  return row;
}

async function loadCodings(engineAnalysisId: string): Promise<CodingRow[]> {
  const r = await pool.query<CodingRow>(
     `SELECT
       c.mention_id::text,
       c.entity_id,
       COALESCE(
         ce.entity_kind,
         ib.entity_kind,
         CASE
           WHEN ib.mention_type = 'brand' THEN 'primary_brand'
           WHEN ib.mention_type = 'competitor' THEN 'competitor_pool'
           WHEN ib.mention_type = 'industry' THEN 'category'
           ELSE NULL
         END
       ) AS entity_kind,
       c.labels,
       c.intensity::text,
       c.span,
       COALESCE(m.resolved_platform, m.platform) AS platform,
       m.sentiment_score::text,
       m.published_at,
       m.quality_score
     FROM engine_codings c
     LEFT JOIN mentions m ON m.id = c.mention_id
     LEFT JOIN import_batches ib ON ib.id = m.source_file_id
     LEFT JOIN corpus_entities ce ON ce.id::text = c.entity_id
     WHERE c.engine_analysis_id = $1
       AND c.ambiguous = false`,
    [engineAnalysisId]
  );
  return r.rows;
}

function toAggregateInput(row: CodingRow) {
  const labels = asRecord(row.labels);
  return {
    findingKey: stringValue(labels.finding_key) || "uncategorized",
    entityId: row.entity_id,
    dimensions: asRecord(labels.dimensions),
    intensity: numberOrNull(row.intensity),
    sentiment: numberOrNull(row.sentiment_score),
    platform: row.platform,
    publishedAt: row.published_at,
    qualityScore: row.quality_score,
    mentionId: row.mention_id,
    span: row.span
  };
}

function buildMethodologyScores(
  methodologySlug: string,
  findings: ReturnType<typeof aggregateEngineCodings>,
  rows: CodingRow[]
) {
  const entityKindByAggregate = new Map<string, string | null>();
  for (const row of rows) {
    const labels = asRecord(row.labels);
    const key = aggregateKey(stringValue(labels.finding_key) || "uncategorized", row.entity_id);
    if (!entityKindByAggregate.has(key)) entityKindByAggregate.set(key, row.entity_kind);
  }

  if (methodologySlug !== "narrative-ownership") {
    if (methodologySlug === "competitive-wave") {
      const scores = scoreCompetitiveWave(findings.map((finding) => ({
        findingKey: finding.findingKey,
        entityId: finding.entityId,
        frequency: finding.frequency,
        dimensions: finding.dimensions,
        intensity: finding.intensity,
        sentiment: finding.sentiment
      })));
      return scoreMap(scores, { ownership: false });
    }
    if (methodologySlug === "cultural-codes-decoding") {
      const scores = scoreCulturalCodesDecoding(findings.map((finding) => ({
        findingKey: finding.findingKey,
        entityId: finding.entityId,
        entityKind: entityKindByAggregate.get(aggregateKey(finding.findingKey, finding.entityId)) ?? null,
        frequency: finding.frequency,
        dimensions: finding.dimensions,
        intensity: finding.intensity
      })));
      return scoreMap(scores, { ownership: true });
    }
    if (methodologySlug === "influence-architecture") {
      const scores = scoreInfluenceArchitecture(findings.map((finding) => ({
        findingKey: finding.findingKey,
        entityId: finding.entityId,
        frequency: finding.frequency,
        dimensions: finding.dimensions,
        intensity: finding.intensity
      })));
      return scoreMap(scores, { ownership: false });
    }
    if (methodologySlug === "decision-velocity") {
      const scores = scoreDecisionVelocity(findings.map((finding) => ({
        findingKey: finding.findingKey,
        entityId: finding.entityId,
        frequency: finding.frequency,
        dimensions: finding.dimensions,
        intensity: finding.intensity
      })));
      return scoreMap(scores, { ownership: false });
    }
    if (methodologySlug === "journey-friction-mapping") {
      const scores = scoreJourneyFrictionMapping(findings.map((finding) => ({
        findingKey: finding.findingKey,
        entityId: finding.entityId,
        frequency: finding.frequency,
        dimensions: finding.dimensions,
        intensity: finding.intensity,
        sentiment: finding.sentiment
      })));
      return scoreMap(scores, { ownership: false });
    }
    if (methodologySlug === "value-perception-matrix") {
      const scores = scoreValuePerceptionMatrix(findings.map((finding) => ({
        findingKey: finding.findingKey,
        entityId: finding.entityId,
        entityKind: entityKindByAggregate.get(aggregateKey(finding.findingKey, finding.entityId)) ?? null,
        frequency: finding.frequency,
        dimensions: finding.dimensions,
        intensity: finding.intensity,
        sentiment: finding.sentiment
      })));
      return scoreMap(scores, { ownership: true });
    }
    if (methodologySlug === "trust-risk-benchmark") {
      const scores = scoreTrustRiskBenchmark(findings.map((finding) => ({
        findingKey: finding.findingKey,
        entityId: finding.entityId,
        entityKind: entityKindByAggregate.get(aggregateKey(finding.findingKey, finding.entityId)) ?? null,
        frequency: finding.frequency,
        dimensions: finding.dimensions,
        sentiment: finding.sentiment
      })));
      return new Map(scores.map((score) => [
        aggregateKey(score.findingKey, score.entityId),
        {
          sharePct: undefined,
          ownership: score.ownership,
          differentiationIndex: score.differentiationIndex,
          dimensions: score.dimensions
        }
      ]));
    }
    if (methodologySlug === "brand-positioning-map") {
      const scores = scoreBrandPositioningMap(findings.map((finding) => ({
        findingKey: finding.findingKey,
        entityId: finding.entityId,
        frequency: finding.frequency,
        dimensions: finding.dimensions,
        intensity: finding.intensity,
        sentiment: finding.sentiment
      })));
      return scoreMap(scores, { ownership: false });
    }
    if (methodologySlug === "category-opportunity-map") {
      const scores = scoreCategoryOpportunityMap(findings.map((finding) => ({
        findingKey: finding.findingKey,
        entityId: finding.entityId,
        entityKind: entityKindByAggregate.get(aggregateKey(finding.findingKey, finding.entityId)) ?? null,
        frequency: finding.frequency,
        dimensions: finding.dimensions,
        intensity: finding.intensity,
        sentiment: finding.sentiment
      })));
      return scoreMap(scores, { ownership: true });
    }
    if (methodologySlug === "white-space-analysis") {
      const scores = scoreWhiteSpaceAnalysis(findings.map((finding) => ({
        findingKey: finding.findingKey,
        entityId: finding.entityId,
        frequency: finding.frequency,
        dimensions: finding.dimensions,
        intensity: finding.intensity,
        sentiment: finding.sentiment
      })));
      return scoreMap(scores, { ownership: false });
    }
    if (methodologySlug === "audience-segment-lens") {
      const scores = scoreAudienceSegmentLens(findings.map((finding) => ({
        findingKey: finding.findingKey,
        entityId: finding.entityId,
        frequency: finding.frequency,
        dimensions: finding.dimensions,
        intensity: finding.intensity,
        sentiment: finding.sentiment
      })));
      return scoreMap(scores, { ownership: false });
    }
    if (methodologySlug !== "sentiment-advocacy-proxy") {
      return new Map<string, {
        sharePct?: number;
        ownership: string | null;
        differentiationIndex: number | null;
        dimensions: Record<string, unknown>;
      }>();
    }
    const scores = scoreSentimentAdvocacy(findings.map((finding) => ({
      findingKey: finding.findingKey,
      entityId: finding.entityId,
      frequency: finding.frequency,
      dimensions: finding.dimensions,
      sentiment: finding.sentiment,
      intensity: finding.intensity
    })));
    return scoreMap(scores, { ownership: false });
  }

  const scores = scoreNarrativeOwnership(findings.map((finding) => ({
    findingKey: finding.findingKey,
    entityId: finding.entityId,
    entityKind: entityKindByAggregate.get(aggregateKey(finding.findingKey, finding.entityId)) ?? null,
    frequency: finding.frequency,
    dimensions: finding.dimensions
  })));

  return new Map(scores.map((score) => [
    aggregateKey(score.findingKey, score.entityId),
    {
      sharePct: score.sharePct,
      ownership: score.ownership,
      differentiationIndex: score.differentiationIndex,
      dimensions: score.dimensions
    }
  ]));
}

function scoreMap(
  scores: Array<{
    findingKey: string;
    entityId: string | null;
    sharePct?: number;
    ownership?: string | null;
    differentiationIndex?: number | null;
    dimensions: Record<string, unknown>;
  }>,
  options: { ownership: boolean }
) {
  return new Map(scores.map((score) => [
    aggregateKey(score.findingKey, score.entityId),
    {
      sharePct: score.sharePct,
      ownership: options.ownership ? score.ownership ?? null : null,
      differentiationIndex: options.ownership ? score.differentiationIndex ?? null : null,
      dimensions: score.dimensions
    }
  ]));
}

function aggregateKey(findingKey: string, entityId: string | null) {
  return `${findingKey}::${entityId ?? ""}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

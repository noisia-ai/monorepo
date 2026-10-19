import type { Job } from "bullmq";

import { pool } from "../db/client";
import {
  markEngineStepCompleted,
  markEngineStepFailed,
  markEngineStepRunning,
  releaseEngineCorpusLock
} from "./engine-shared";
import { buildEngineQualityChecks, type EngineQualityGateSummary } from "./engine-quality";
import { persistEngineSignalObservations } from "./live-intelligence";

type EngineStepJobData = {
  engineAnalysisId: string;
  pipelineStepId: string;
};

export async function engineQualityGatesJob(job: Job<EngineStepJobData>) {
  const { engineAnalysisId, pipelineStepId } = job.data;
  await markEngineStepRunning(pipelineStepId);
  await job.updateProgress(20);

  try {
    const gates = await loadGateSummary(engineAnalysisId);
    const checks = buildEngineQualityChecks(gates);
    const passed = checks.filter((check) => check.passed).length;
    const liveIntelligence = await persistEngineSignalObservations(engineAnalysisId);
    await pool.query(
      `UPDATE engine_analyses
       SET status = 'needs_review',
           current_step = 'review',
           meta_json = COALESCE(meta_json, '{}'::jsonb) || $1::jsonb,
           updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify({ quality_gates: checks, live_intelligence: liveIntelligence }), engineAnalysisId]
    );
    await markEngineStepCompleted({
      pipelineStepId,
      resultSummary: { passed, total: checks.length, checks, live_intelligence: liveIntelligence }
    });
    await releaseEngineCorpusLock(engineAnalysisId);
    await job.updateProgress(100);
    return { status: "needs_review", passed, total: checks.length, live_intelligence: liveIntelligence };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markEngineStepFailed({ pipelineStepId, errorMessage: msg });
    await releaseEngineCorpusLock(engineAnalysisId);
    throw err;
  }
}

async function loadGateSummary(engineAnalysisId: string): Promise<EngineQualityGateSummary> {
  const r = await pool.query<EngineQualityGateSummary>(
    `SELECT
       ea.methodology_slug,
       MAX(
         CASE
           WHEN COALESCE(ea.meta_json->'retrieval'->>'retrieved_units', '') ~ '^[0-9]+$'
             THEN (ea.meta_json->'retrieval'->>'retrieved_units')::int
           WHEN jsonb_typeof(ea.meta_json->'retrieval'->'units') = 'array'
             THEN jsonb_array_length(ea.meta_json->'retrieval'->'units')
           ELSE 0
         END
       )::int AS retrieval_units,
       MAX(
         CASE
           WHEN COALESCE(ea.meta_json->'retrieval'->>'eligible_units', '') ~ '^[0-9]+$'
             THEN (ea.meta_json->'retrieval'->>'eligible_units')::int
           ELSE NULL
         END
       )::int AS retrieval_eligible_units,
       MAX(
         CASE
           WHEN COALESCE(ea.meta_json->'retrieval'->>'max_units', '') ~ '^[0-9]+$'
             THEN (ea.meta_json->'retrieval'->>'max_units')::int
           ELSE NULL
         END
       )::int AS retrieval_max_units,
       BOOL_OR(COALESCE((ea.meta_json->'retrieval'->>'truncated')::boolean, false)) AS retrieval_truncated,
       COUNT(f.id)::int AS findings,
       COUNT(f.id) FILTER (WHERE f.confidence IS NOT NULL)::int AS findings_with_confidence,
       COUNT(DISTINCT f.id) FILTER (WHERE c.id IS NOT NULL)::int AS findings_with_citation,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'narrative-ownership'
           AND f.ownership IS NOT NULL
           AND f.dimensions ? 'narrative_total'
       )::int AS narrative_ownership_scored,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'narrative-ownership'
           AND f.ownership IN ('brand_owned', 'competitor_owned', 'category_wide')
           AND lower(COALESCE(f.dimensions->>'valence', '')) IN ('negativa', 'negative')
       )::int AS narrative_owned_negative,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'narrative-ownership'
           AND f.finding_key = 'insufficient_signal'
       )::int AS insufficient_signal_findings,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'sentiment-advocacy-proxy'
           AND f.dimensions ? 'advocacy_proxy'
       )::int AS sentiment_advocacy_scored,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'sentiment-advocacy-proxy'
           AND f.dimensions->>'is_survey_nps' = 'false'
       )::int AS sentiment_proxy_non_survey,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'trust-risk-benchmark'
           AND f.dimensions ? 'trust_score'
           AND f.dimensions ? 'risk_score'
       )::int AS trust_risk_scored,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'trust-risk-benchmark'
           AND f.dimensions->>'sensitive_risk_requires_evidence' = 'true'
       )::int AS sensitive_risk_findings,
       COUNT(DISTINCT f.id) FILTER (
         WHERE f.methodology_slug = 'trust-risk-benchmark'
           AND f.dimensions->>'sensitive_risk_requires_evidence' = 'true'
           AND c.id IS NOT NULL
       )::int AS sensitive_risk_with_citation,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'value-perception-matrix'
           AND f.dimensions ? 'value_ownership_share'
           AND f.dimensions ? 'value_score'
       )::int AS vpm_scored,
       COUNT(DISTINCT f.entity_id) FILTER (
         WHERE f.methodology_slug = 'value-perception-matrix'
           AND f.entity_id IS NOT NULL
       )::int AS vpm_entities,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'value-perception-matrix'
           AND f.dimensions->>'whitespace_candidate' = 'true'
       )::int AS vpm_whitespace_candidates,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'journey-friction-mapping'
           AND f.dimensions ? 'choke_score'
           AND f.dimensions ? 'accelerator_score'
       )::int AS jfm_scored,
       COUNT(DISTINCT f.dimensions->>'journey_phase') FILTER (
         WHERE f.methodology_slug = 'journey-friction-mapping'
           AND COALESCE(f.dimensions->>'journey_phase', '') <> ''
       )::int AS jfm_phase_count,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'journey-friction-mapping'
           AND f.dimensions->>'visibility' = 'invisible'
       )::int AS jfm_invisible_findings,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'category-opportunity-map'
           AND f.dimensions ? 'opportunity_score'
       )::int AS category_opportunity_scored,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'category-opportunity-map'
           AND f.dimensions->>'coverage_evidence_status' = 'coverage_evidence_present'
       )::int AS category_opportunity_coverage_evidence,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'white-space-analysis'
           AND f.dimensions ? 'whitespace_score'
       )::int AS white_space_scored,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'white-space-analysis'
           AND f.dimensions->>'absence_evidence_status' = 'directional_from_competitive_corpus'
       )::int AS white_space_absence_evidence,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'white-space-analysis'
           AND COALESCE((f.dimensions->>'brand_permission_score')::numeric, 0) >= 0.6
       )::int AS white_space_permission_evidence,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'brand-positioning-map'
           AND f.dimensions ? 'perceptual_x'
           AND f.dimensions ? 'perceptual_y'
       )::int AS brand_positioning_scored,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'brand-positioning-map'
           AND f.dimensions->>'axis_defined' = 'true'
       )::int AS brand_positioning_axis_defined,
       COUNT(DISTINCT f.entity_id) FILTER (
         WHERE f.methodology_slug = 'brand-positioning-map'
           AND f.entity_id IS NOT NULL
       )::int AS brand_positioning_entities,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'cultural-codes-decoding'
           AND f.dimensions ? 'cultural_intensity'
       )::int AS cultural_codes_scored,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'cultural-codes-decoding'
           AND f.dimensions->>'cultural_level_present' = 'true'
       )::int AS cultural_codes_level_present,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'cultural-codes-decoding'
           AND f.dimensions->>'opposition_present' = 'true'
       )::int AS cultural_codes_oppositions,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'cultural-codes-decoding'
           AND f.dimensions->>'long_text_evidence_status' <> 'requires_source_validation'
       )::int AS cultural_codes_long_text_validated,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'competitive-wave'
           AND f.dimensions ? 'wave_x'
           AND f.dimensions ? 'wave_y'
       )::int AS competitive_wave_scored,
       COUNT(DISTINCT f.entity_id) FILTER (
         WHERE f.methodology_slug = 'competitive-wave'
           AND f.entity_id IS NOT NULL
       )::int AS competitive_wave_entities,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'competitive-wave'
           AND f.dimensions->>'wave_publishable' = 'true'
       )::int AS competitive_wave_publishable,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'audience-segment-lens'
           AND f.dimensions ? 'segment_skew'
       )::int AS audience_segment_scored,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'audience-segment-lens'
           AND f.dimensions->>'segment_source' <> 'missing'
       )::int AS audience_segment_source_present,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'audience-segment-lens'
           AND f.dimensions->>'sensitive_inference_used' = 'true'
       )::int AS audience_segment_sensitive_inference,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'influence-architecture'
           AND f.dimensions ? 'influence_score'
       )::int AS influence_architecture_scored,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'influence-architecture'
           AND f.dimensions->>'graph_centrality_available' = 'true'
       )::int AS influence_graph_ready,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'influence-architecture'
           AND f.dimensions->>'author_metadata_status' <> 'required_for_real_graph'
       )::int AS influence_author_metadata_ready,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'decision-velocity'
           AND f.dimensions ? 'velocity_index'
       )::int AS decision_velocity_scored,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'decision-velocity'
           AND f.dimensions->>'benchmark_status' <> 'benchmark_required_for_publication'
       )::int AS decision_velocity_benchmarked,
       COUNT(f.id) FILTER (
         WHERE f.methodology_slug = 'decision-velocity'
           AND f.dimensions->>'ab_hypothesis_status' <> 'requires_experiment'
       )::int AS decision_velocity_ab_ready
     FROM engine_analyses ea
     LEFT JOIN engine_findings f ON f.engine_analysis_id = ea.id
     LEFT JOIN engine_finding_citations c ON c.finding_id = f.id
     WHERE ea.id = $1
     GROUP BY ea.methodology_slug`,
    [engineAnalysisId]
  );
  return r.rows[0] ?? {
    methodology_slug: "unknown",
    retrieval_units: 0,
    retrieval_eligible_units: 0,
    retrieval_max_units: null,
    retrieval_truncated: false,
    findings: 0,
    findings_with_confidence: 0,
    findings_with_citation: 0,
    narrative_ownership_scored: 0,
    narrative_owned_negative: 0,
    insufficient_signal_findings: 0,
    sentiment_advocacy_scored: 0,
    sentiment_proxy_non_survey: 0,
    trust_risk_scored: 0,
    sensitive_risk_findings: 0,
    sensitive_risk_with_citation: 0,
    vpm_scored: 0,
    vpm_entities: 0,
    vpm_whitespace_candidates: 0,
    jfm_scored: 0,
    jfm_phase_count: 0,
    jfm_invisible_findings: 0,
    category_opportunity_scored: 0,
    category_opportunity_coverage_evidence: 0,
    white_space_scored: 0,
    white_space_absence_evidence: 0,
    white_space_permission_evidence: 0,
    brand_positioning_scored: 0,
    brand_positioning_axis_defined: 0,
    brand_positioning_entities: 0,
    cultural_codes_scored: 0,
    cultural_codes_level_present: 0,
    cultural_codes_oppositions: 0,
    cultural_codes_long_text_validated: 0,
    competitive_wave_scored: 0,
    competitive_wave_entities: 0,
    competitive_wave_publishable: 0,
    audience_segment_scored: 0,
    audience_segment_source_present: 0,
    audience_segment_sensitive_inference: 0,
    influence_architecture_scored: 0,
    influence_graph_ready: 0,
    influence_author_metadata_ready: 0,
    decision_velocity_scored: 0,
    decision_velocity_benchmarked: 0,
    decision_velocity_ab_ready: 0
  };
}

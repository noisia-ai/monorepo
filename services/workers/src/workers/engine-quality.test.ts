import assert from "node:assert/strict";
import test from "node:test";

import { buildEngineQualityChecks } from "./engine-quality";

test("engine quality checks keep generic traceability and confidence gates", () => {
  const checks = buildEngineQualityChecks({
    methodology_slug: "value-perception-matrix",
    retrieval_units: 3,
    retrieval_eligible_units: 3,
    retrieval_max_units: 180,
    retrieval_truncated: false,
    findings: 3,
    findings_with_confidence: 3,
    findings_with_citation: 2,
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
    jfm_invisible_findings: 0
  });

  assert.equal(checks.find((check) => check.id === "traceability")?.passed, false);
  assert.equal(checks.find((check) => check.id === "confidence_calibrated")?.passed, true);
  assert.equal(checks.find((check) => check.id === "retrieval_budget_declared")?.passed, true);
  assert.equal(checks.some((check) => check.id === "narrative_ownership_scored"), false);
});

test("engine quality checks fail when retrieval was truncated by runtime budget", () => {
  const checks = buildEngineQualityChecks({
    methodology_slug: "narrative-ownership",
    retrieval_units: 180,
    retrieval_eligible_units: 7396,
    retrieval_max_units: 180,
    retrieval_truncated: true,
    findings: 4,
    findings_with_confidence: 4,
    findings_with_citation: 4,
    narrative_ownership_scored: 4,
    narrative_owned_negative: 1,
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
    jfm_invisible_findings: 0
  });

  const budget = checks.find((check) => check.id === "retrieval_budget_declared");
  assert.equal(budget?.passed, false);
  assert.match(budget?.detail ?? "", /180\/7396/);
});

test("Narrative Ownership gates require deterministic ownership scoring", () => {
  const checks = buildEngineQualityChecks({
    methodology_slug: "narrative-ownership",
    findings: 4,
    findings_with_confidence: 4,
    findings_with_citation: 4,
    narrative_ownership_scored: 4,
    narrative_owned_negative: 1,
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
    jfm_invisible_findings: 0
  });

  assert.equal(checks.find((check) => check.id === "narrative_ownership_scored")?.passed, true);
  assert.equal(checks.find((check) => check.id === "narrative_emergent_not_imposed")?.passed, true);
  assert.match(checks.find((check) => check.id === "owned_negative_flagged")?.detail ?? "", /1 narrativas negativas/);
});

test("Narrative Ownership gates fail when insufficient signal leaked into findings", () => {
  const checks = buildEngineQualityChecks({
    methodology_slug: "narrative-ownership",
    findings: 2,
    findings_with_confidence: 2,
    findings_with_citation: 2,
    narrative_ownership_scored: 1,
    narrative_owned_negative: 0,
    insufficient_signal_findings: 1,
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
    jfm_invisible_findings: 0
  });

  assert.equal(checks.find((check) => check.id === "narrative_ownership_scored")?.passed, false);
  assert.equal(checks.find((check) => check.id === "narrative_emergent_not_imposed")?.passed, false);
});

test("Sentiment Advocacy gates require non-survey proxy scoring and driver evidence", () => {
  const checks = buildEngineQualityChecks({
    methodology_slug: "sentiment-advocacy-proxy",
    findings: 3,
    findings_with_confidence: 3,
    findings_with_citation: 2,
    narrative_ownership_scored: 0,
    narrative_owned_negative: 0,
    insufficient_signal_findings: 0,
    sentiment_advocacy_scored: 3,
    sentiment_proxy_non_survey: 3,
    trust_risk_scored: 0,
    sensitive_risk_findings: 0,
    sensitive_risk_with_citation: 0,
    vpm_scored: 0,
    vpm_entities: 0,
    vpm_whitespace_candidates: 0,
    jfm_scored: 0,
    jfm_phase_count: 0,
    jfm_invisible_findings: 0
  });

  assert.equal(checks.find((check) => check.id === "sentiment_advocacy_scored")?.passed, true);
  assert.equal(checks.find((check) => check.id === "no_survey_claim")?.passed, true);
  assert.equal(checks.find((check) => check.id === "driver_evidence_required")?.passed, false);
});

test("Trust Risk gates block sensitive risk without evidence", () => {
  const checks = buildEngineQualityChecks({
    methodology_slug: "trust-risk-benchmark",
    findings: 4,
    findings_with_confidence: 4,
    findings_with_citation: 3,
    narrative_ownership_scored: 0,
    narrative_owned_negative: 0,
    insufficient_signal_findings: 0,
    sentiment_advocacy_scored: 0,
    sentiment_proxy_non_survey: 0,
    trust_risk_scored: 4,
    sensitive_risk_findings: 2,
    sensitive_risk_with_citation: 1,
    vpm_scored: 0,
    vpm_entities: 0,
    vpm_whitespace_candidates: 0,
    jfm_scored: 0,
    jfm_phase_count: 0,
    jfm_invisible_findings: 0
  });

  assert.equal(checks.find((check) => check.id === "trust_risk_scored")?.passed, true);
  assert.equal(checks.find((check) => check.id === "risk_quote_required")?.passed, false);
  assert.equal(checks.find((check) => check.id === "no_unverified_accusations")?.passed, false);
});

test("VPM gates keep whitespace candidates directional until absence evidence exists", () => {
  const checks = buildEngineQualityChecks({
    methodology_slug: "value-perception-matrix",
    findings: 5,
    findings_with_confidence: 5,
    findings_with_citation: 5,
    narrative_ownership_scored: 0,
    narrative_owned_negative: 0,
    insufficient_signal_findings: 0,
    sentiment_advocacy_scored: 0,
    sentiment_proxy_non_survey: 0,
    trust_risk_scored: 0,
    sensitive_risk_findings: 0,
    sensitive_risk_with_citation: 0,
    vpm_scored: 5,
    vpm_entities: 2,
    vpm_whitespace_candidates: 1,
    jfm_scored: 0,
    jfm_phase_count: 0,
    jfm_invisible_findings: 0
  });

  assert.equal(checks.find((check) => check.id === "vpm_scored")?.passed, true);
  assert.equal(checks.find((check) => check.id === "balance_per_entity")?.passed, true);
  assert.equal(checks.find((check) => check.id === "whitespace_has_absence_evidence")?.passed, false);
});

test("JFM gates require phase coverage and articulable friction", () => {
  const checks = buildEngineQualityChecks({
    methodology_slug: "journey-friction-mapping",
    findings: 3,
    findings_with_confidence: 3,
    findings_with_citation: 3,
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
    jfm_scored: 3,
    jfm_phase_count: 1,
    jfm_invisible_findings: 1
  });

  assert.equal(checks.find((check) => check.id === "journey_friction_scored")?.passed, true);
  assert.equal(checks.find((check) => check.id === "journey_phase_coverage")?.passed, false);
  assert.equal(checks.find((check) => check.id === "articulable_only")?.passed, false);
});

test("Category Opportunity gates require coverage evidence", () => {
  const checks = buildEngineQualityChecks({
    methodology_slug: "category-opportunity-map",
    findings: 2,
    findings_with_confidence: 2,
    findings_with_citation: 2,
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
    category_opportunity_scored: 2,
    category_opportunity_coverage_evidence: 1
  });

  assert.equal(checks.find((check) => check.id === "demand_evidence_required")?.passed, true);
  assert.equal(checks.find((check) => check.id === "coverage_evidence_required")?.passed, false);
});

test("White Space gates separate scoring from real absence evidence", () => {
  const checks = buildEngineQualityChecks({
    methodology_slug: "white-space-analysis",
    findings: 2,
    findings_with_confidence: 2,
    findings_with_citation: 2,
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
    white_space_scored: 2,
    white_space_absence_evidence: 2,
    white_space_permission_evidence: 1
  });

  assert.equal(checks.find((check) => check.id === "demand_and_absence_evidence")?.passed, true);
  assert.equal(checks.find((check) => check.id === "brand_permission_evidence")?.passed, false);
  assert.equal(checks.find((check) => check.id === "no_conjecture_whitespace")?.passed, true);
});

test("Brand Positioning gates require defined axes and multiple entities", () => {
  const checks = buildEngineQualityChecks({
    methodology_slug: "brand-positioning-map",
    findings: 3,
    findings_with_confidence: 3,
    findings_with_citation: 3,
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
    brand_positioning_axis_defined: 2,
    brand_positioning_entities: 1
  });

  assert.equal(checks.find((check) => check.id === "axis_defined")?.passed, false);
  assert.equal(checks.find((check) => check.id === "competitor_required")?.passed, false);
});

test("Cultural Codes gates keep deep readings blocked without long-text validation", () => {
  const checks = buildEngineQualityChecks({
    methodology_slug: "cultural-codes-decoding",
    findings: 2,
    findings_with_confidence: 2,
    findings_with_citation: 2,
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
    cultural_codes_scored: 2,
    cultural_codes_level_present: 2,
    cultural_codes_oppositions: 2,
    cultural_codes_long_text_validated: 1
  });

  assert.equal(checks.find((check) => check.id === "codes_emerge_from_corpus")?.passed, true);
  assert.equal(checks.find((check) => check.id === "long_quote_evidence")?.passed, false);
});

test("Competitive Wave gates require at least three publishable entities", () => {
  const checks = buildEngineQualityChecks({
    methodology_slug: "competitive-wave",
    findings: 4,
    findings_with_confidence: 4,
    findings_with_citation: 4,
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
    competitive_wave_scored: 4,
    competitive_wave_entities: 2,
    competitive_wave_publishable: 0
  });

  assert.equal(checks.find((check) => check.id === "axis_balance")?.passed, true);
  assert.equal(checks.find((check) => check.id === "competitor_required")?.passed, false);
});

test("Audience, Influence and Decision gates expose missing metadata or benchmark", () => {
  const audience = buildEngineQualityChecks({
    methodology_slug: "audience-segment-lens",
    findings: 2,
    findings_with_confidence: 2,
    findings_with_citation: 2,
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
    audience_segment_scored: 2,
    audience_segment_source_present: 1,
    audience_segment_sensitive_inference: 1
  });
  assert.equal(audience.find((check) => check.id === "segment_source_required")?.passed, false);
  assert.equal(audience.find((check) => check.id === "no_sensitive_inference")?.passed, false);

  const influence = buildEngineQualityChecks({
    methodology_slug: "influence-architecture",
    findings: 1,
    findings_with_confidence: 1,
    findings_with_citation: 1,
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
    influence_architecture_scored: 1,
    influence_graph_ready: 0,
    influence_author_metadata_ready: 0
  });
  assert.equal(influence.find((check) => check.id === "author_metadata_required")?.passed, false);
  assert.equal(influence.find((check) => check.id === "no_influence_without_source")?.passed, false);

  const decision = buildEngineQualityChecks({
    methodology_slug: "decision-velocity",
    findings: 1,
    findings_with_confidence: 1,
    findings_with_citation: 1,
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
    decision_velocity_scored: 1,
    decision_velocity_benchmarked: 0,
    decision_velocity_ab_ready: 0
  });
  assert.equal(decision.find((check) => check.id === "phase_system_dual_coding")?.passed, true);
  assert.equal(decision.find((check) => check.id === "benchmark_referenced")?.passed, false);
  assert.equal(decision.find((check) => check.id === "testable_hypotheses")?.passed, false);
});

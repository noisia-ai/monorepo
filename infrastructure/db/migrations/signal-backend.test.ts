import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("SB-02 migration establishes stable Signal workspace identity and governed corpus scope", async () => {
  const migration = await readFile(resolve(process.cwd(), "migrations/0047_signal_workspace_identity.sql"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS signal_workspaces/);
  assert.match(migration, /signal_workspaces_exactly_one_subject/);
  assert.match(migration, /uq_signal_workspaces_org_slug/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS signal_workspace_corpora/);
  assert.match(migration, /'operational', 'strategic', 'legacy'/);
  assert.match(migration, /uq_signal_workspace_corpora_active/);
  assert.match(migration, /enforce_signal_workspace_subject_organization/);
  assert.match(migration, /enforce_signal_workspace_corpus_scope/);
});

test("SB-02 backfill is dry-run by default, remote guarded, redacted and idempotent", async () => {
  const script = await readFile(resolve(process.cwd(), "../../apps/studio/scripts/backfill-signal-workspaces.ts"), "utf8");
  assert.match(script, /NOISIA_SIGNAL_WORKSPACE_BACKFILL_ALLOW_REMOTE/);
  assert.match(script, /requireSafeDatabaseReadTarget/);
  assert.match(script, /requireSafeDatabaseWriteTarget/);
  assert.match(script, /ON CONFLICT DO NOTHING/);
  assert.match(script, /identifiers_redacted: true/);
  assert.match(script, /sw\.organization_id = ec\.organization_id/);
});

test("SB-03 persists disabled refresh policy, independent freshness and idempotent invalidation", async () => {
  const migration = await readFile(resolve(process.cwd(), "migrations/0048_signal_recurring_refresh.sql"), "utf8");
  for (const table of [
    "signal_refresh_policies",
    "signal_data_watermarks",
    "signal_refresh_runs",
    "signal_data_invalidations",
    "signal_interpretation_freshness"
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /enabled boolean NOT NULL DEFAULT false/);
  assert.match(migration, /source_freshness_state/);
  assert.match(migration, /data_freshness_state/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION record_signal_data_acceptance/);
  assert.match(migration, /Completed import batch does not belong to the corpus/);
  assert.match(migration, /ON CONFLICT \(workspace_id, study_corpus_id, source_key\)/);
  assert.match(migration, /ON CONFLICT \(idempotency_key\) DO NOTHING/);
  assert.match(migration, /'targets', jsonb_build_array\('metric_materializations', 'interpretation_freshness'\)/);
});

test("SB-03 wires existing imports and source syncs to the shared acceptance function", async () => {
  const [workerImport, knowledgeSync, studioImport, performanceSync, refreshWorker, envExample] = await Promise.all([
    readFile(resolve(process.cwd(), "../../services/workers/src/workers/mentions-csv-ingest.ts"), "utf8"),
    readFile(resolve(process.cwd(), "../../services/workers/src/workers/process-knowledge-sources.ts"), "utf8"),
    readFile(resolve(process.cwd(), "../../apps/studio/src/app/api/corpora/[id]/mentions/csv-upload/route.ts"), "utf8"),
    readFile(resolve(process.cwd(), "../../apps/studio/src/app/api/corpora/[id]/sources/performance-upload/route.ts"), "utf8"),
    readFile(resolve(process.cwd(), "../../services/workers/src/workers/signal-refresh.ts"), "utf8"),
    readFile(resolve(process.cwd(), "../../apps/studio/.env.example"), "utf8")
  ]);
  for (const source of [workerImport, knowledgeSync, studioImport, performanceSync]) {
    assert.match(source, /recordSignalDataAcceptance/);
  }
  assert.match(refreshWorker, /pg_try_advisory_lock/);
  assert.match(refreshWorker, /FOR UPDATE(?: OF policy)? SKIP LOCKED/);
  assert.match(refreshWorker, /materialization\.period_id IS NULL/);
  assert.match(refreshWorker, /dead_letter/);
  assert.match(envExample, /NOISIA_SIGNAL_REFRESH_SCHEDULER_ENABLED=false/);
});

test("SB-04 versions the canonical metric registry and blocks silent formula changes", async () => {
  const migration = await readFile(resolve(process.cwd(), "migrations/0049_signal_metric_catalog_v1.sql"), "utf8");
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS signal_metric/u);
  assert.match(migration, /ALTER TABLE metric_definitions/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1/);
  assert.match(migration, /uq_metric_definitions_key_version UNIQUE \(metric_key, version\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION protect_metric_definition_formula_version/);
  assert.match(migration, /Metric formula changes require a new metric version/);
  assert.match(migration, /idx_metric_definitions_group_version/);
});

test("SB-04 seed reuses metric_definitions and semantic_models idempotently", async () => {
  const [seed, backfill, listening, knowledge] = await Promise.all([
    readFile(resolve(process.cwd(), "seeds/signal-metric-catalog.ts"), "utf8"),
    readFile(resolve(process.cwd(), "scripts/data-os-backfill.ts"), "utf8"),
    readFile(resolve(process.cwd(), "../../packages/query-engine/src/listening-data-os.ts"), "utf8"),
    readFile(resolve(process.cwd(), "../../services/workers/src/workers/process-knowledge-sources.ts"), "utf8")
  ]);
  assert.match(seed, /SIGNAL_METRIC_DEFINITIONS_V1/);
  assert.match(seed, /INSERT INTO metric_definitions/);
  assert.match(seed, /INSERT INTO semantic_models/);
  assert.match(seed, /signal_social_listening_v1/);
  assert.match(seed, /ON CONFLICT \(metric_key, version\) DO UPDATE/);
  for (const writer of [backfill, listening, knowledge]) {
    assert.match(writer, /ON CONFLICT \(metric_key, version\)/);
    assert.doesNotMatch(writer, /ON CONFLICT \(metric_key\)(?!,)/u);
  }
});

test("SB-05 extends canonical materializations with typed deterministic Signal state", async () => {
  const migration = await readFile(resolve(process.cwd(), "migrations/0050_signal_metric_materializations_v1.sql"), "utf8");
  assert.match(migration, /ALTER TABLE metric_materializations/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS signal_metric_material/u);
  for (const field of [
    "workspace_id", "materialization_key", "metric_version", "period_start",
    "normalized_filter", "typed_payload", "denominator", "sample_size",
    "quality_state", "data_watermark_hash", "materialization_state", "cache_scope"
  ]) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${field}`));
  }
  assert.match(migration, /'fresh', 'stale', 'pending', 'partial', 'not_available'/);
  assert.match(migration, /uq_metric_materializations_signal_key/);
  assert.match(migration, /idx_metric_materializations_signal_series/);
  assert.match(migration, /idx_mentions_signal_materialization/);
  assert.match(migration, /chart_aggregates is legacy projection only/);
});

test("SB-05 worker recalculates selective periods from accepted watermarks without payload or Claude", async () => {
  const [materializer, invalidator, queue] = await Promise.all([
    readFile(resolve(process.cwd(), "../../services/workers/src/workers/signal-materialization.ts"), "utf8"),
    readFile(resolve(process.cwd(), "../../services/workers/src/workers/signal-refresh.ts"), "utf8"),
    readFile(resolve(process.cwd(), "../../services/workers/src/queues/data-os.ts"), "utf8")
  ]);
  assert.match(materializer, /buildSignalMetricMaterializationPlanV1/);
  assert.match(materializer, /SIGNAL_METRIC_DEFINITIONS_V1/);
  assert.match(materializer, /INSERT INTO metric_materializations/);
  assert.match(materializer, /ON CONFLICT \(materialization_key\)/);
  assert.match(materializer, /dataWatermarkHashV1/);
  assert.match(materializer, /\["day", "week", "month"\]/);
  assert.match(materializer, /SELECT DISTINCT normalized_filter/);
  assert.match(materializer, /period_end >= \$3::date/);
  assert.doesNotMatch(materializer, /published_outputs|chart_aggregates|Claude|Anthropic/u);
  assert.match(invalidator, /materialization\.period_end >= \$2::date/);
  assert.match(invalidator, /materialization_state = CASE/);
  assert.match(invalidator, /SIGNAL_MATERIALIZE_JOB_NAME/);
  assert.match(queue, /signalMaterializationJob/);
});

test("post-SB-06 hardening adds a durable refresh outbox, policy freshness and one operational corpus", async () => {
  const [migration, scheduler, fixture, backfill] = await Promise.all([
    readFile(resolve(process.cwd(), "migrations/0051_signal_backend_foundation_hardening.sql"), "utf8"),
    readFile(resolve(process.cwd(), "../../services/workers/src/workers/signal-refresh.ts"), "utf8"),
    readFile(resolve(process.cwd(), "fixtures/signal-materialization-reconciliation.sql"), "utf8"),
    readFile(resolve(process.cwd(), "../../apps/studio/scripts/backfill-signal-workspaces.ts"), "utf8")
  ]);
  assert.match(migration, /uq_signal_workspace_corpora_one_operational/);
  assert.match(migration, /idx_signal_refresh_runs_outbox_recovery/);
  assert.match(migration, /signal_refresh_freshness_tolerance/);
  assert.match(migration, /derive_signal_watermark_freshness/);
  assert.match(scheduler, /enqueueRecoverableSignalRefreshRun/);
  assert.match(scheduler, /error_code = 'enqueue_failed'/);
  assert.match(scheduler, /conversation_velocity_dependency_through/);
  assert.match(backfill, /row_number\(\) OVER/);
  assert.match(backfill, /superseded_operational_corpus/);
  assert.match(fixture, /aggregate\/drill-down reconciliation failed/);
  assert.match(fixture, /governed topic quality reconciliation failed/);
});

test("SB-07 persists versioned, budget-bounded interpretations without weakening analysis artifacts", async () => {
  const [migration, worker, contract, serving, analysisMigration] = await Promise.all([
    readFile(resolve(process.cwd(), "migrations/0052_signal_metric_interpretations_v1.sql"), "utf8"),
    readFile(resolve(process.cwd(), "../../services/workers/src/workers/signal-interpretation.ts"), "utf8"),
    readFile(resolve(process.cwd(), "../../packages/query-engine/src/signal-interpretation-v1.ts"), "utf8"),
    readFile(resolve(process.cwd(), "../../apps/studio/src/lib/data-os/signal-workspace-serving.ts"), "utf8"),
    readFile(resolve(process.cwd(), "migrations/0046_analysis_artifact_evidence_graph.sql"), "utf8")
  ]);
  for (const table of [
    "metric_interpretation_runs",
    "metric_interpretations",
    "metric_interpretation_evidence"
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /actual_cost_usd <= budget_cap_usd/);
  assert.match(migration, /materialization_id uuid NOT NULL REFERENCES metric_materializations/);
  assert.match(worker, /FROM metric_materializations/);
  assert.match(worker, /executeSignalInterpretationV1/);
  assert.match(contract, /Every number written in a claim must have an exact numeric_ref/);
  assert.match(serving, /FROM metric_interpretations interpretation/);
  assert.match(analysisMigration, /analysis_artifacts_exactly_one_analysis/);
  assert.doesNotMatch(migration, /ALTER TABLE analysis_artifacts/);
});

test("SB-08 enforces exact governed T&B evidence and immutable published review", async () => {
  const [migration, hierarchy, persistence, reviewWriter] = await Promise.all([
    readFile(resolve(process.cwd(), "migrations/0053_tb_structured_evidence_review.sql"), "utf8"),
    readFile(resolve(process.cwd(), "../../services/workers/src/workers/tb-step-3-hierarchy.ts"), "utf8"),
    readFile(resolve(process.cwd(), "../../services/workers/src/workers/tb-analysis-artifact-persistence.ts"), "utf8"),
    readFile(resolve(process.cwd(), "../../apps/studio/src/lib/data-os/analysis-artifact-graph.ts"), "utf8")
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS tb_finding_structured_evidence_refs/);
  assert.match(migration, /evidence_quality_status <> 'accepted'/);
  assert.match(migration, /structured_evidence_cross_corpus/);
  assert.match(migration, /published_analysis_artifact_immutable/);
  assert.match(hierarchy, /validateTbStructuredEvidenceRefs/);
  assert.match(hierarchy, /'claim_specific'/);
  assert.match(persistence, /governed_ref\.source_type/);
  assert.match(persistence, /'storage_ref'/);
  assert.match(persistence, /'source_sync_run'/);
  assert.match(reviewWriter, /current\.revision \+ 1/);
  assert.match(reviewWriter, /supersedes_artifact_id/);
});

test("SB-09 freezes T&B scope and human-promotes immutable strategic releases", async () => {
  const [migration, temporalWorker, comparativeWorker, releaseServing, invarianceFixture] = await Promise.all([
    readFile(resolve(process.cwd(), "migrations/0054_tb_temporal_strategic_releases.sql"), "utf8"),
    readFile(resolve(process.cwd(), "../../services/workers/src/workers/tb-temporal-materialization.ts"), "utf8"),
    readFile(resolve(process.cwd(), "../../services/workers/src/workers/tb-step-5-comparative.ts"), "utf8"),
    readFile(resolve(process.cwd(), "../../apps/studio/src/lib/data-os/signal-strategic-releases.ts"), "utf8"),
    readFile(resolve(process.cwd(), "fixtures/tb-temporal-release-invariance.sql"), "utf8")
  ]);

  for (const table of [
    "tb_temporal_metrics",
    "tb_finding_temporal_comparisons",
    "signal_workspace_releases",
    "signal_workspace_release_artifacts",
    "signal_workspace_current_releases"
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /protect_tb_analysis_frozen_scope/);
  assert.match(migration, /signal_release_human_reviewer_required/);
  assert.match(migration, /published_signal_workspace_release_immutable/);
  assert.match(migration, /released_tb_temporal_materialization_immutable/);
  assert.match(temporalWorker, /JOIN corpus_snapshot_mentions/);
  assert.match(temporalWorker, /evaluateTbComparisonCompatibilityV1/);
  assert.match(comparativeWorker, /ta_scope\.snapshot_id = snapshot_mention\.snapshot_id/);
  assert.doesNotMatch(comparativeWorker, /SUM\(COALESCE\(ib\.included_count/);
  assert.match(releaseServing, /promote_signal_workspace_release/);
  assert.doesNotMatch(releaseServing, /published_outputs|payload/);
  assert.match(invarianceFixture, /not a member of snapshot 1/);
  assert.match(invarianceFixture, /recomputed_value <> published_value/);
});

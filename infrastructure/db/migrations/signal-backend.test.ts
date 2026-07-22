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
  assert.match(refreshWorker, /FOR UPDATE SKIP LOCKED/);
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

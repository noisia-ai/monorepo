import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const migrationsDir = resolve(process.cwd(), "migrations");

async function migration(tag: string) {
  return readFile(resolve(migrationsDir, `${tag}.sql`), "utf8");
}

async function listRouteFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) return listRouteFiles(fullPath);
      return entry.name === "route.ts" ? [fullPath] : [];
    })
  );
  return nested.flat().sort();
}

test("live intelligence migrations are journaled in order", async () => {
  const journal = JSON.parse(await readFile(resolve(migrationsDir, "meta/_journal.json"), "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const expected = [
    { idx: 25, tag: "0025_engine_methodologies" },
    { idx: 26, tag: "0026_live_intelligence_store" },
    { idx: 27, tag: "0027_query_pack_provenance_backfill" },
    { idx: 28, tag: "0028_signal_observation_run_uniqueness" },
    { idx: 29, tag: "0029_engine_cost_ledger" },
    { idx: 30, tag: "0030_monthly_cut_and_composer" },
    { idx: 31, tag: "0031_study_analysis_plan" },
    { idx: 32, tag: "0032_import_batch_query_pack_link" },
    { idx: 33, tag: "0033_engine_run_mention_map" },
    { idx: 34, tag: "0034_signal_pulse_foundation" },
    { idx: 35, tag: "0035_data_os_foundation" },
    { idx: 36, tag: "0036_data_os_observations" },
    { idx: 37, tag: "0037_engine_validation_separation" },
    { idx: 38, tag: "0038_query_validation_lineage" },
    { idx: 39, tag: "0039_query_validation_imported_evidence" },
    { idx: 40, tag: "0040_data_os_semantic_observation_contract" },
    { idx: 41, tag: "0041_tb_data_os_coding_bridge" },
    { idx: 42, tag: "0042_data_os_static_catalog_semantics" },
    { idx: 43, tag: "0043_data_os_asset_records_metric_catalog" },
    { idx: 44, tag: "0044_query_pack_entity_identity" },
    { idx: 45, tag: "0045_signal_serving_entities" },
    { idx: 46, tag: "0046_analysis_artifact_evidence_graph" },
    { idx: 47, tag: "0047_signal_workspace_identity" },
    { idx: 48, tag: "0048_signal_recurring_refresh" },
    { idx: 49, tag: "0049_signal_metric_catalog_v1" },
    { idx: 50, tag: "0050_signal_metric_materializations_v1" },
    { idx: 51, tag: "0051_signal_backend_foundation_hardening" },
    { idx: 52, tag: "0052_signal_metric_interpretations_v1" },
    { idx: 53, tag: "0053_tb_structured_evidence_review" },
    { idx: 54, tag: "0054_tb_temporal_strategic_releases" },
    { idx: 55, tag: "0055_signal_v2_front_ready_indexes" }
  ];
  const tail = journal.entries
    .slice(-expected.length)
    .map((entry) => ({ idx: entry.idx, tag: entry.tag }));

  assert.deepEqual(tail, expected);
});

test("engine and live intelligence migrations include every required table", async () => {
  const engineSql = await migration("0025_engine_methodologies");
  const liveSql = await migration("0026_live_intelligence_store");

  for (const table of [
    "engine_analyses",
    "engine_findings",
    "engine_codings",
    "engine_finding_citations",
    "engine_pipeline_steps"
  ]) {
    assert.match(engineSql, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`));
  }

  for (const table of [
    "query_packs",
    "mention_query_sources",
    "canonical_signals",
    "signal_observations",
    "signal_observation_evidence"
  ]) {
    assert.match(liveSql, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`));
  }

  const costSql = await migration("0029_engine_cost_ledger");
  assert.match(costSql, /CREATE TABLE IF NOT EXISTS "engine_cost_events"/);
  assert.match(costSql, /REFERENCES "engine_analyses"\("id"\) ON DELETE CASCADE/);

  const runMapSql = await migration("0033_engine_run_mention_map");
  assert.match(runMapSql, /CREATE TABLE IF NOT EXISTS "engine_run_mention_map"/);
  assert.match(runMapSql, /REFERENCES "engine_analyses"\("id"\) ON DELETE CASCADE/);
  assert.match(runMapSql, /REFERENCES "query_packs"\("id"\) ON DELETE SET NULL/);

  const signalPulseSql = await migration("0034_signal_pulse_foundation");
  for (const table of [
    "report_periods",
    "signal_period_metrics",
    "marketing_moves",
    "chart_aggregates",
    "performance_records",
    "data_sources",
    "source_sync_runs"
  ]) {
    assert.match(signalPulseSql, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`));
  }
  assert.match(signalPulseSql, /ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'signal'/);
  assert.match(signalPulseSql, /ADD COLUMN IF NOT EXISTS "visibility_config" jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(signalPulseSql, /CREATE UNIQUE INDEX IF NOT EXISTS "uq_signal_observation_signal_engine_analysis_window"/);

  const dataOsSql = await migration("0035_data_os_foundation");
  for (const table of [
    "data_assets",
    "data_contracts",
    "data_quality_results",
    "brand_os_profiles",
    "brand_os_objectives",
    "brand_os_briefs",
    "knowledge_chunks",
    "knowledge_assertions",
    "knowledge_assertion_review_events",
    "taxonomies",
    "taxonomy_terms",
    "tagging_rule_sets",
    "tagging_model_versions",
    "intelligence_entities",
    "record_entity_links",
    "record_tags",
    "record_feature_values",
    "lineage_edges",
    "metric_definitions",
    "semantic_models",
    "dashboard_data_refs"
  ]) {
    assert.match(dataOsSql, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`));
  }

  const observationsSql = await migration("0036_data_os_observations");
  assert.match(observationsSql, /CREATE TABLE IF NOT EXISTS "data_observations"/);
  assert.match(observationsSql, /"metric_key" text NOT NULL/);
  assert.match(observationsSql, /"period_start" date/);
  assert.match(observationsSql, /REFERENCES "brand_knowledge_sources"\("id"\) ON DELETE SET NULL/);
  assert.match(observationsSql, /CREATE INDEX IF NOT EXISTS "idx_data_observations_corpus_period_metric"/);

  const assetRecordsSql = await migration("0043_data_os_asset_records_metric_catalog");
  assert.match(assetRecordsSql, /CREATE TABLE IF NOT EXISTS "data_asset_records"/);
  assert.match(assetRecordsSql, /"record_data" jsonb NOT NULL/);
  assert.match(assetRecordsSql, /"period_semantics" text NOT NULL DEFAULT 'unknown'/);
  assert.match(assetRecordsSql, /"quality_status" text NOT NULL DEFAULT 'accepted'/);
  assert.match(assetRecordsSql, /'duration_seconds'/);

  const queryPackIdentitySql = await migration("0044_query_pack_entity_identity");
  assert.match(queryPackIdentitySql, /ADD COLUMN IF NOT EXISTS "entity_key" text/);
  assert.match(queryPackIdentitySql, /"query_components"->>'entity_key'/);
  assert.match(queryPackIdentitySql, /CREATE INDEX IF NOT EXISTS "idx_query_packs_scope_entity"/);
  assert.match(queryPackIdentitySql, /CREATE UNIQUE INDEX IF NOT EXISTS "uq_query_packs_iteration_lens_intent_scope_entity"/);

  const signalServingEntitiesSql = await migration("0045_signal_serving_entities");
  for (const table of [
    "tb_strategic_opportunities",
    "tb_opportunity_findings",
    "tb_action_studio",
    "tb_action_findings"
  ]) {
    assert.match(signalServingEntitiesSql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(signalServingEntitiesSql, /CONSTRAINT uq_tb_strategic_opportunities_analysis_id UNIQUE/);
  assert.match(signalServingEntitiesSql, /CONSTRAINT uq_tb_action_studio_analysis_id UNIQUE/);
  assert.match(signalServingEntitiesSql, /REFERENCES tb_findings\(id\) ON DELETE CASCADE/);

  const analysisArtifactGraphSql = await migration("0046_analysis_artifact_evidence_graph");
  for (const table of [
    "analysis_artifacts",
    "analysis_evidence_groups",
    "analysis_evidence_links",
    "analysis_artifact_relations",
    "analysis_artifact_review_events",
    "published_output_artifacts"
  ]) {
    assert.match(analysisArtifactGraphSql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(analysisArtifactGraphSql, /analysis_artifacts_exactly_one_analysis/);
  assert.match(analysisArtifactGraphSql, /analysis_artifacts_source_pair/);
  assert.match(analysisArtifactGraphSql, /analysis_evidence_links_weight_range/);
  assert.match(analysisArtifactGraphSql, /REFERENCES published_outputs\(id\) ON DELETE CASCADE/);
  assert.match(analysisArtifactGraphSql, /REFERENCES analysis_artifacts\(id\) ON DELETE CASCADE/);

  const validationSql = await migration("0037_engine_validation_separation");
  assert.match(validationSql, /ADD COLUMN IF NOT EXISTS "corpus_revision" integer NOT NULL DEFAULT 1/);
  assert.match(validationSql, /ADD COLUMN IF NOT EXISTS "latest_assessed_revision" integer/);
  for (const table of [
    "query_validation_runs",
    "query_validation_attempts",
    "query_validation_mentions",
    "corpus_assessments",
    "corpus_assessment_mentions"
  ]) {
    assert.match(validationSql, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`));
  }

  const validationLineageSql = await migration("0038_query_validation_lineage");
  assert.match(validationLineageSql, /ADD COLUMN IF NOT EXISTS "latest_query_validation_run_id" uuid/);
  assert.match(validationLineageSql, /ADD COLUMN IF NOT EXISTS "approved_query_validation_run_id" uuid/);
  assert.match(validationLineageSql, /ADD COLUMN IF NOT EXISTS "attempt_kind" text NOT NULL DEFAULT 'refinement'/);
  assert.match(validationLineageSql, /ADD COLUMN IF NOT EXISTS "query_validation_run_id" uuid/);
});

test("analysis artifacts stay transactional, reviewable and revision-bound at publish", async () => {
  const repoRoot = resolve(process.cwd(), "../..");
  const workerPersistence = await readFile(
    resolve(repoRoot, "services/workers/src/workers/tb-analysis-artifact-persistence.ts"),
    "utf8"
  );
  const step6 = await readFile(
    resolve(repoRoot, "services/workers/src/workers/tb-step-6-synthesis.ts"),
    "utf8"
  );
  const graph = await readFile(
    resolve(repoRoot, "apps/studio/src/lib/data-os/analysis-artifact-graph.ts"),
    "utf8"
  );
  const approvalRoute = await readFile(
    resolve(repoRoot, "apps/studio/src/app/api/corpora/[id]/tb-analysis/[analysisId]/approve/route.ts"),
    "utf8"
  );
  const publishRoute = await readFile(
    resolve(repoRoot, "apps/studio/src/app/api/corpora/[id]/tb-analysis/[analysisId]/signal-output/route.ts"),
    "utf8"
  );
  const reviewRoute = await readFile(
    resolve(
      repoRoot,
      "apps/studio/src/app/api/data-os/corpora/[id]/artifacts/[artifactId]/review/route.ts"
    ),
    "utf8"
  );
  const structuredEvidenceMigration = await migration("0053_tb_structured_evidence_review");
  const backfill = await readFile(
    resolve(repoRoot, "apps/studio/scripts/backfill-signal-serving.ts"),
    "utf8"
  );

  assert.match(step6, /replaceTbAnalysisArtifactGraph\(client, args\.tbAnalysisId\)/);
  assert.match(step6, /client\.query\("BEGIN"\)/);
  assert.match(workerPersistence, /JOIN tb_finding_citations citation/);
  assert.match(workerPersistence, /'claim_specific', false/);
  assert.match(workerPersistence, /tb_finding_structured_evidence_refs/);
  assert.match(workerPersistence, /'import_batch'/);
  assert.match(workerPersistence, /Reviewed analysis artifacts are immutable/);
  assert.match(graph, /artifact_revision = artifact\.revision/);
  assert.match(graph, /review_status IN \('accepted', 'corrected', 'limited'\)/);
  assert.match(approvalRoute, /approveTbAnalysisWithArtifacts/);
  assert.match(publishRoute, /persistPublishedAnalysisArtifacts/);
  assert.match(reviewRoute, /reviewAnalysisArtifact/);
  assert.match(reviewRoute, /loadDataOsCorpusContext/);
  assert.match(structuredEvidenceMigration, /validate_tb_finding_structured_evidence_ref/);
  assert.match(structuredEvidenceMigration, /structured_evidence_cross_corpus/);
  assert.match(structuredEvidenceMigration, /protect_published_analysis_artifact_revision/);
  assert.match(structuredEvidenceMigration, /published_analysis_artifact_immutable/);
  assert.match(backfill, /materializeHistoricalArtifactGraph/);
  assert.match(backfill, /persistPublishedAnalysisArtifacts/);
});

test("Data OS API routes stay behind shared auth and feature flag loaders", async () => {
  const dataOsApiRoot = resolve(process.cwd(), "../../apps/studio/src/app/api/data-os");
  const loader = await readFile(resolve(dataOsApiRoot, "_lib/load.ts"), "utf8");
  const routeFiles = await listRouteFiles(dataOsApiRoot);
  const reviewQueueRouteFile = routeFiles.find((routeFile) => routeFile.includes("/review-queue/"));
  const readinessRouteFile = routeFiles.find((routeFile) => routeFile.endsWith("/readiness/route.ts"));

  assert.equal(routeFiles.length, 25);
  assert.match(loader, /getAuthenticatedAppUser/);
  assert.match(loader, /canManageCorpus/);
  assert.match(loader, /canViewClientOutputs/);
  assert.match(loader, /getCorpusForUser/);
  assert.match(loader, /getSignalOutputForUser/);
  assert.match(loader, /isDataOsServingEnabled/);
  assert.match(loader, /isSignalPulseLiveApiEnabled/);
  assert.match(loader, /disabledDataOsResponse/);
  assert.match(loader, /disabledSignalPulseLiveResponse/);
  assert.match(loader, /resolveSignalPulseVisibility/);
  assert.match(loader, /requiredVisibility/);

  for (const routeFile of routeFiles) {
    const route = await readFile(routeFile, "utf8");
    assert.match(route, /export async function GET/, `${routeFile} must expose an explicit GET handler.`);
    assert.doesNotMatch(route, /getAuthenticatedAppUser|canManageCorpus|canViewClientOutputs|pool\.query|@\/lib\/db/);

    if (routeFile.includes("/corpora/")) {
      assert.match(route, /loadDataOsCorpusContext/, `${routeFile} must use the corpus Data OS loader.`);
      assert.doesNotMatch(route, /loadDataOsPulseContext/);
    }
    if (routeFile.includes("/pulse/")) {
      assert.match(route, /loadDataOsPulseContext/, `${routeFile} must use the Pulse Data OS loader.`);
      assert.doesNotMatch(route, /loadDataOsCorpusContext/);
    }
    if (routeFile.includes("/signal/")) {
      assert.match(route, /loadSignalWorkspaceContext/, `${routeFile} must use the Signal workspace authZ loader.`);
      assert.doesNotMatch(route, /loadDataOsCorpusContext|loadDataOsPulseContext/);
      assert.doesNotMatch(route, /published_outputs|raw_metadata|chart_aggregates/);
    }
  }

  assert.ok(reviewQueueRouteFile, "Data OS review queue route must exist.");
  const reviewQueueRoute = await readFile(reviewQueueRouteFile, "utf8");
  assert.match(reviewQueueRoute, /export async function POST/);
  assert.match(reviewQueueRoute, /reviewDataOsTag/);
  assert.match(reviewQueueRoute, /reviewDataOsAssertion/);
  assert.match(reviewQueueRoute, /validationError/);

  assert.ok(readinessRouteFile, "Data OS corpus readiness route must exist.");
  const readinessRoute = await readFile(readinessRouteFile, "utf8");
  assert.match(readinessRoute, /loadDataOsCorpusContext/);
  assert.match(readinessRoute, /getDataOsCorpusReadiness/);
});

test("Data OS review sample CLI requires explicit human and remote write approval", async () => {
  const rootPackage = JSON.parse(await readFile(resolve(process.cwd(), "../../package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const dbPackage = JSON.parse(await readFile(resolve(process.cwd(), "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const reviewSample = await readFile(resolve(process.cwd(), "scripts/data-os-review-sample.ts"), "utf8");
  const envExample = await readFile(resolve(process.cwd(), "../../apps/studio/.env.example"), "utf8");
  const runbook = await readFile(resolve(process.cwd(), "../../docs/product/23_NOISIA_DATA_OS_STAGING_RUNBOOK.md"), "utf8");
  const handoff = await readFile(resolve(process.cwd(), "../../docs/product/25_NOISIA_DATA_OS_STAGING_HANDOFF.md"), "utf8");

  assert.equal(rootPackage.scripts?.["data-os:review-sample"], "corepack pnpm --filter @noisia/db data-os:review-sample");
  assert.equal(dbPackage.scripts?.["data-os:review-sample"], "tsx scripts/data-os-review-sample.ts");
  assert.match(reviewSample, /requireSafeDatabaseWriteTarget/);
  assert.match(reviewSample, /isLocalDatabaseUrl/);
  assert.match(reviewSample, /NOISIA_DATA_OS_REVIEW_ALLOW_REMOTE/);
  assert.match(reviewSample, /NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED/);
  assert.match(reviewSample, /NOISIA_DATA_OS_REVIEW_SAMPLE_AUTO_SELECT_LOCAL/);
  assert.match(reviewSample, /NOISIA_DATA_OS_REVIEW_TAG_ID/);
  assert.match(reviewSample, /NOISIA_DATA_OS_REVIEW_ASSERTION_ID/);
  assert.match(reviewSample, /tag_review_events/);
  assert.match(reviewSample, /knowledge_assertion_review_events/);
  assert.match(reviewSample, /set_redacted/);
  assert.match(envExample, /NOISIA_DATA_OS_REVIEW_ALLOW_REMOTE=false/);
  assert.match(envExample, /NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=false/);
  assert.match(envExample, /NOISIA_DATA_OS_REVIEW_SAMPLE_AUTO_SELECT_LOCAL=false/);
  assert.match(runbook, /corepack pnpm data-os:review-sample/);
  assert.match(runbook, /Review Humano M[ií]nimo/);
  assert.match(handoff, /NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_IDS=true/);
  assert.match(handoff, /NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_CONTEXT=true/);
  assert.match(handoff, /NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true/);
  assert.match(handoff, /corepack pnpm data-os:staging-finalize/);
});

test("Data OS staging check prevalidates human review sample ids without printing values", async () => {
  const repoRoot = resolve(process.cwd(), "../..");
  const baseEnv = {
    ...process.env,
    DATABASE_URL: "postgres://user:pass@staging.example.com:5432/noisia_staging",
    NOISIA_DATA_OS_BACKFILL_CORPUS_ID: "11111111-1111-4111-8111-111111111111",
    NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED: "true",
    NOISIA_DATA_OS_SHADOW_OUTPUT_ID: "22222222-2222-4222-8222-222222222222",
    NOISIA_DATA_OS_STAGING_SHADOW_APPROVED: "true",
    NOISIA_REMOTE_DATABASE_TARGET: "staging"
  };

  await assert.rejects(
    execFile("bash", ["scripts/data-os-staging-check.sh"], {
      cwd: repoRoot,
      env: baseEnv
    }),
    (error: unknown) => {
      const stdout = String((error as { stdout?: unknown }).stdout ?? "");
      assert.match(stdout, /NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true/);
      assert.match(stdout, /NOISIA_DATA_OS_REVIEW_TAG_ID=missing/);
      assert.match(stdout, /NOISIA_DATA_OS_REVIEW_ASSERTION_ID=missing/);
      assert.match(stdout, /ready_for_staging_shadow=false/);
      assert.doesNotMatch(stdout, /11111111-1111-4111-8111-111111111111/);
      assert.doesNotMatch(stdout, /22222222-2222-4222-8222-222222222222/);
      return true;
    }
  );

  await assert.rejects(
    execFile("bash", ["scripts/data-os-staging-check.sh"], {
      cwd: repoRoot,
      env: {
        ...baseEnv,
        NOISIA_DATA_OS_REVIEW_ASSERTION_ID: "33333333-3333-4333-8333-333333333333",
        NOISIA_DATA_OS_REVIEW_TAG_ID: "not-a-uuid"
      }
    }),
    (error: unknown) => {
      const stdout = String((error as { stdout?: unknown }).stdout ?? "");
      assert.match(stdout, /NOISIA_DATA_OS_REVIEW_TAG_ID=set/);
      assert.match(stdout, /NOISIA_DATA_OS_REVIEW_TAG_ID_FORMAT=invalid_uuid/);
      assert.match(stdout, /NOISIA_DATA_OS_REVIEW_ASSERTION_ID_FORMAT=uuid/);
      assert.doesNotMatch(stdout, /33333333-3333-4333-8333-333333333333/);
      return true;
    }
  );
});

test("Data OS staging check refuses placeholder and non-Postgres database URLs", async () => {
  const repoRoot = resolve(process.cwd(), "../..");
  const baseEnv = {
    ...process.env,
    NOISIA_DATA_OS_BACKFILL_CORPUS_ID: "11111111-1111-4111-8111-111111111111",
    NOISIA_DATA_OS_SHADOW_OUTPUT_ID: "22222222-2222-4222-8222-222222222222",
    NOISIA_DATA_OS_STAGING_SHADOW_APPROVED: "true",
    NOISIA_REMOTE_DATABASE_TARGET: "staging"
  };

  await assert.rejects(
    execFile("bash", ["scripts/data-os-staging-check.sh"], {
      cwd: repoRoot,
      env: {
        ...baseEnv,
        DATABASE_URL: "<staging_or_preview_database_url>"
      }
    }),
    (error: unknown) => {
      const stdout = String((error as { stdout?: unknown }).stdout ?? "");
      assert.match(stdout, /DATABASE_URL=set/);
      assert.match(stdout, /DATABASE_URL_FORMAT=placeholder_refused/);
      assert.match(stdout, /ready_for_staging_shadow=false/);
      assert.match(stdout, /missing_or_invalid=.*DATABASE_URL_PLACEHOLDER/);
      assert.doesNotMatch(stdout, /staging_or_preview_database_url/);
      assert.doesNotMatch(stdout, /DATABASE_URL_ENVIRONMENT=remote_redacted/);
      return true;
    }
  );

  await assert.rejects(
    execFile("bash", ["scripts/data-os-staging-check.sh"], {
      cwd: repoRoot,
      env: {
        ...baseEnv,
        DATABASE_URL: "https://staging.example.com/noisia"
      }
    }),
    (error: unknown) => {
      const stdout = String((error as { stdout?: unknown }).stdout ?? "");
      assert.match(stdout, /DATABASE_URL=set/);
      assert.match(stdout, /DATABASE_URL_FORMAT=invalid_postgres_url/);
      assert.match(stdout, /ready_for_staging_shadow=false/);
      assert.match(stdout, /missing_or_invalid=.*DATABASE_URL_FORMAT/);
      assert.doesNotMatch(stdout, /https:\/\/staging\.example\.com/);
      assert.doesNotMatch(stdout, /DATABASE_URL_ENVIRONMENT=remote_redacted/);
      return true;
    }
  );
});

test("T&B period backfill joins codings to the internal finding UUID", async () => {
  const sql = await migration("0014_tb_finding_periods");

  assert.match(sql, /AND f\.id = stats\.finding_id/);
  assert.doesNotMatch(sql, /AND f\.finding_id = stats\.finding_id/);
});

test("live intelligence migrations preserve additive safety contracts", async () => {
  const migrations = [
    await migration("0025_engine_methodologies"),
    await migration("0026_live_intelligence_store"),
    await migration("0027_query_pack_provenance_backfill"),
    await migration("0028_signal_observation_run_uniqueness"),
    await migration("0029_engine_cost_ledger"),
    await migration("0030_monthly_cut_and_composer"),
    await migration("0031_study_analysis_plan"),
    await migration("0032_import_batch_query_pack_link"),
    await migration("0033_engine_run_mention_map"),
    await migration("0034_signal_pulse_foundation"),
    await migration("0035_data_os_foundation")
  ].join("\n");

  assert.doesNotMatch(migrations, /\bDROP\s+(TABLE|COLUMN|DATABASE)\b/i);
  assert.doesNotMatch(migrations, /\bTRUNCATE\b/i);
  assert.match(migrations, /ADD COLUMN IF NOT EXISTS "engine_analysis_id"/);
  assert.match(migrations, /ADD COLUMN IF NOT EXISTS "query_pack_id"/);
  assert.match(migrations, /CREATE UNIQUE INDEX IF NOT EXISTS "uq_engine_run_mention_map_analysis_mention"/);
  assert.match(migrations, /CREATE UNIQUE INDEX IF NOT EXISTS "uq_query_packs_iteration_lens_intent_scope"/);
  assert.match(migrations, /CREATE UNIQUE INDEX IF NOT EXISTS "uq_canonical_signal_scope_key"[\s\S]+COALESCE\("organization_id"::text, ''\)/);
  assert.match(migrations, /CREATE UNIQUE INDEX IF NOT EXISTS "uq_signal_observation_signal_snapshot"/);
  assert.match(migrations, /CREATE UNIQUE INDEX IF NOT EXISTS "uq_signal_observation_signal_tb_analysis"/);
  assert.match(migrations, /CREATE UNIQUE INDEX IF NOT EXISTS "uq_signal_observation_signal_engine_analysis"/);
  assert.match(migrations, /CREATE UNIQUE INDEX IF NOT EXISTS "uq_signal_observation_signal_engine_analysis_window"/);
  assert.match(migrations, /ADD COLUMN IF NOT EXISTS "analysis_plan"/);
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS "performance_records"/);
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS "data_sources"/);
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS "data_assets"/);
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS "taxonomies"/);
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS "brand_os_briefs"/);
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS "knowledge_assertion_review_events"/);
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS "tagging_rule_sets"/);
  assert.match(migrations, /"tagging_rule_set_id" uuid REFERENCES "tagging_rule_sets"/);
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS "record_tags"/);
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS "lineage_edges"/);
});

test("query-pack backfill preserves provenance from import batches to mentions", async () => {
  const sql = await migration("0027_query_pack_provenance_backfill");

  assert.match(sql, /INSERT INTO "query_packs"/);
  assert.match(sql, /INSERT INTO "mention_query_sources"/);
  assert.match(sql, /JOIN matched_pack mp ON mp\.import_batch_id = mn\.source_file_id/);
  assert.match(sql, /ON CONFLICT DO NOTHING/);
  assert.match(sql, /UPDATE "query_packs" qp/);
});

test("local migration smoke uses a pgvector-enabled disposable database", async () => {
  const compose = await readFile(resolve(process.cwd(), "../docker/docker-compose.yml"), "utf8");
  const rootPackage = JSON.parse(await readFile(resolve(process.cwd(), "../../package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const dbPackage = JSON.parse(await readFile(resolve(process.cwd(), "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const applyExisting = await readFile(resolve(process.cwd(), "scripts/apply-existing-migrations.ts"), "utf8");
  const smokeLocal = await readFile(resolve(process.cwd(), "scripts/smoke-local.ts"), "utf8");

  assert.match(compose, /postgres-smoke:/);
  assert.match(compose, /image: pgvector\/pgvector:pg16/);
  assert.match(compose, /"55432:5432"/);
  assert.equal(rootPackage.scripts?.["db:smoke:local"], "corepack pnpm --filter @noisia/db db:smoke:local");
  assert.equal(dbPackage.scripts?.["db:smoke:local"], "tsx scripts/smoke-local.ts");
  assert.equal(dbPackage.scripts?.["db:apply:existing"], "tsx scripts/apply-existing-migrations.ts");
  assert.match(applyExisting, /0035_data_os_foundation\.sql/);
  assert.match(applyExisting, /0036_data_os_observations\.sql/);
  assert.match(applyExisting, /0037_engine_validation_separation\.sql/);
  assert.match(applyExisting, /0038_query_validation_lineage\.sql/);
  assert.match(applyExisting, /0039_query_validation_imported_evidence\.sql/);
  assert.match(applyExisting, /0040_data_os_semantic_observation_contract\.sql/);
  assert.match(applyExisting, /0041_tb_data_os_coding_bridge\.sql/);
  assert.match(applyExisting, /0042_data_os_static_catalog_semantics\.sql/);
  assert.match(applyExisting, /0043_data_os_asset_records_metric_catalog\.sql/);
  assert.match(applyExisting, /0044_query_pack_entity_identity\.sql/);
  assert.match(applyExisting, /0045_signal_serving_entities\.sql/);
  assert.doesNotMatch(applyExisting, /0034_signal_pulse_foundation\.sql/);
  assert.match(applyExisting, /NOISIA_DB_APPLY_EXISTING_ALLOW_REMOTE/);
  assert.match(smokeLocal, /run\("corepack", \["pnpm", "exec", "tsx", "scripts\/smoke-migrations\.ts"\]/);
});

test("Data OS backfill is wired, safe by default and idempotent", async () => {
  const rootPackage = JSON.parse(await readFile(resolve(process.cwd(), "../../package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const dbPackage = JSON.parse(await readFile(resolve(process.cwd(), "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const script = await readFile(resolve(process.cwd(), "scripts/data-os-backfill.ts"), "utf8");
  const candidates = await readFile(resolve(process.cwd(), "scripts/data-os-candidates.ts"), "utf8");
  const analyze = await readFile(resolve(process.cwd(), "scripts/data-os-analyze.ts"), "utf8");
  const completionAuditScript = await readFile(resolve(process.cwd(), "scripts/data-os-completion-audit.ts"), "utf8");
  const evidence = await readFile(resolve(process.cwd(), "scripts/data-os-evidence.ts"), "utf8");
  const prSummary = await readFile(resolve(process.cwd(), "scripts/data-os-pr-summary.ts"), "utf8");
  const releaseGate = await readFile(resolve(process.cwd(), "scripts/data-os-release-gate.ts"), "utf8");
  const reviewQueue = await readFile(resolve(process.cwd(), "scripts/data-os-review-queue.ts"), "utf8");
  const evidencePackValidator = await readFile(resolve(process.cwd(), "scripts/validate-data-os-evidence-pack.ts"), "utf8");
  const localSmokeValidator = await readFile(resolve(process.cwd(), "scripts/validate-data-os-local-smoke.ts"), "utf8");
  const preflight = await readFile(resolve(process.cwd(), "scripts/data-os-preflight.ts"), "utf8");
  const shadowQa = await readFile(resolve(process.cwd(), "scripts/data-os-shadow-qa.ts"), "utf8");
  const shadowRun = await readFile(resolve(process.cwd(), "scripts/data-os-shadow-run.ts"), "utf8");
  const smoke = await readFile(resolve(process.cwd(), "scripts/data-os-smoke.ts"), "utf8");
  const localSmoke = await readFile(resolve(process.cwd(), "../../scripts/data-os-local-smoke.sh"), "utf8");
  const stagingCheck = await readFile(resolve(process.cwd(), "../../scripts/data-os-staging-check.sh"), "utf8");
  const stagingFinalize = await readFile(resolve(process.cwd(), "../../scripts/data-os-staging-finalize.sh"), "utf8");
  const stagingShadow = await readFile(resolve(process.cwd(), "../../scripts/data-os-staging-shadow.sh"), "utf8");
  const servingSmoke = await readFile(resolve(process.cwd(), "../../apps/studio/scripts/data-os-serving-smoke.ts"), "utf8");
  const studioDataOsQueue = await readFile(resolve(process.cwd(), "../../apps/studio/src/lib/queue/data-os.ts"), "utf8");
  const studioDataOsQueueTest = await readFile(resolve(process.cwd(), "../../apps/studio/src/lib/queue/data-os.test.ts"), "utf8");
  const queryEngineIndex = await readFile(resolve(process.cwd(), "../../packages/query-engine/src/index.ts"), "utf8");
  const dataOsContract = await readFile(resolve(process.cwd(), "../../packages/query-engine/src/data-os.ts"), "utf8");
  const dataOsContractTest = await readFile(resolve(process.cwd(), "../../packages/query-engine/src/data-os.test.ts"), "utf8");
  const workerIndex = await readFile(resolve(process.cwd(), "../../services/workers/src/index.ts"), "utf8");
  const dataOsQueue = await readFile(resolve(process.cwd(), "../../services/workers/src/queues/data-os.ts"), "utf8");
  const dataOsWorker = await readFile(resolve(process.cwd(), "../../services/workers/src/workers/data-os-shadow.ts"), "utf8");
  const dataOsWorkerTest = await readFile(resolve(process.cwd(), "../../services/workers/src/workers/data-os-shadow.test.ts"), "utf8");

  assert.equal(dbPackage.scripts?.["data-os:backfill"], "tsx scripts/data-os-backfill.ts");
  assert.equal(dbPackage.scripts?.["data-os:analyze"], "tsx scripts/data-os-analyze.ts");
  assert.equal(dbPackage.scripts?.["data-os:candidates"], "tsx scripts/data-os-candidates.ts");
  assert.equal(dbPackage.scripts?.["data-os:completion-audit"], "tsx scripts/data-os-completion-audit.ts");
  assert.equal(dbPackage.scripts?.["data-os:evidence"], "tsx scripts/data-os-evidence.ts");
  assert.equal(dbPackage.scripts?.["data-os:preflight"], "tsx scripts/data-os-preflight.ts");
  assert.equal(dbPackage.scripts?.["data-os:pr-summary"], "tsx scripts/data-os-pr-summary.ts");
  assert.equal(dbPackage.scripts?.["data-os:release-gate"], "tsx scripts/data-os-release-gate.ts");
  assert.equal(dbPackage.scripts?.["data-os:review-queue"], "tsx scripts/data-os-review-queue.ts");
  assert.equal(dbPackage.scripts?.["data-os:shadow-qa"], "tsx scripts/data-os-shadow-qa.ts");
  assert.equal(dbPackage.scripts?.["data-os:shadow-run"], "tsx scripts/data-os-shadow-run.ts");
  assert.equal(dbPackage.scripts?.["data-os:smoke"], "tsx scripts/data-os-smoke.ts");
  assert.equal(dbPackage.scripts?.["data-os:validate-evidence-pack"], "tsx scripts/validate-data-os-evidence-pack.ts");
  assert.equal(dbPackage.scripts?.["data-os:validate-local-smoke"], "tsx scripts/validate-data-os-local-smoke.ts");
  assert.equal(rootPackage.scripts?.["db:apply:existing"], "corepack pnpm --filter @noisia/db db:apply:existing");
  assert.equal(rootPackage.scripts?.["data-os:analyze"], "corepack pnpm --filter @noisia/db data-os:analyze");
  assert.equal(rootPackage.scripts?.["data-os:backfill"], "corepack pnpm --filter @noisia/db data-os:backfill");
  assert.equal(rootPackage.scripts?.["data-os:candidates"], "corepack pnpm --filter @noisia/db data-os:candidates");
  assert.equal(
    rootPackage.scripts?.["data-os:completion-audit"],
    "corepack pnpm --filter @noisia/db data-os:completion-audit"
  );
  assert.equal(rootPackage.scripts?.["data-os:evidence"], "corepack pnpm --filter @noisia/db data-os:evidence");
  assert.equal(rootPackage.scripts?.["data-os:local-smoke"], "bash scripts/data-os-local-smoke.sh");
  assert.equal(rootPackage.scripts?.["data-os:preflight"], "corepack pnpm --filter @noisia/db data-os:preflight");
  assert.equal(rootPackage.scripts?.["data-os:pr-summary"], "corepack pnpm --filter @noisia/db data-os:pr-summary");
  assert.equal(rootPackage.scripts?.["data-os:release-gate"], "corepack pnpm --filter @noisia/db data-os:release-gate");
  assert.equal(rootPackage.scripts?.["data-os:review-queue"], "corepack pnpm --filter @noisia/db data-os:review-queue");
  assert.equal(rootPackage.scripts?.["data-os:shadow-qa"], "corepack pnpm --filter @noisia/db data-os:shadow-qa");
  assert.equal(rootPackage.scripts?.["data-os:shadow-run"], "corepack pnpm --filter @noisia/db data-os:shadow-run");
  assert.equal(rootPackage.scripts?.["data-os:serving-smoke"], "corepack pnpm --filter @noisia/studio data-os:serving-smoke");
  assert.equal(rootPackage.scripts?.["data-os:smoke"], "corepack pnpm --filter @noisia/db data-os:smoke");
  assert.equal(rootPackage.scripts?.["data-os:staging-check"], "bash scripts/data-os-staging-check.sh");
  assert.equal(rootPackage.scripts?.["data-os:staging-finalize"], "bash scripts/data-os-staging-finalize.sh");
  assert.equal(rootPackage.scripts?.["data-os:staging-shadow"], "bash scripts/data-os-staging-shadow.sh");
  assert.equal(
    rootPackage.scripts?.["data-os:validate-evidence-pack"],
    "corepack pnpm --filter @noisia/db data-os:validate-evidence-pack"
  );
  assert.equal(
    rootPackage.scripts?.["data-os:validate-local-smoke"],
    "corepack pnpm --filter @noisia/db data-os:validate-local-smoke"
  );
  assert.equal(rootPackage.scripts?.["data-os:verify"], "corepack pnpm --filter @noisia/db data-os:verify");
  assert.match(script, /requireBackfillEnabled\(\)/);
  assert.match(script, /NOISIA_DATA_OS_BACKFILL_ENABLED/);
  assert.match(script, /requireSafeDatabaseWriteTarget\(databaseUrl/);
  assert.match(script, /allowRemoteEnv: "NOISIA_DATA_OS_BACKFILL_ALLOW_REMOTE"/);
  assert.match(script, /NOISIA_DATA_OS_BACKFILL_CORPUS_ID/);
  assert.match(script, /INSERT INTO taxonomies/);
  assert.match(script, /ON CONFLICT \(taxonomy_key\) DO UPDATE/);
  assert.match(script, /TAGGING_RULE_SET_KEY/);
  assert.match(script, /INSERT INTO tagging_rule_sets/);
  assert.match(script, /uq_tagging_rule_sets_key_version/);
  assert.match(script, /tagging_rule_set_id/);
  assert.match(script, /INSERT INTO data_assets/);
  assert.match(script, /ON CONFLICT ON CONSTRAINT uq_data_assets_scope_name_layer DO UPDATE/);
  assert.match(script, /ASSET_FIELD_DEFINITIONS/);
  assert.match(script, /ensureAssetFields/);
  assert.match(script, /INSERT INTO data_asset_fields/);
  assert.match(script, /ON CONFLICT ON CONSTRAINT uq_data_asset_fields_asset_field DO UPDATE/);
  assert.match(script, /INSERT INTO knowledge_chunks/);
  assert.match(script, /ON CONFLICT ON CONSTRAINT uq_knowledge_chunks_source_index DO UPDATE/);
  assert.match(script, /INSERT INTO brand_os_briefs/);
  assert.match(script, /uq_brand_os_briefs_profile_corpus_type_title/);
  assert.match(script, /INSERT INTO brand_os_links/);
  assert.match(script, /INSERT INTO knowledge_assertion_links/);
  assert.match(script, /INSERT INTO knowledge_usage_events/);
  assert.match(script, /knowledge_assertions\.status IN \('active', 'rejected', 'needs_review'\)/);
  assert.match(script, /brand_os_links_seen/);
  assert.match(script, /brand_os_briefs_seen/);
  assert.match(script, /knowledge_assertion_links_seen/);
  assert.match(script, /knowledge_usage_events_seen/);
  assert.match(script, /INSERT INTO data_quality_results/);
  assert.match(script, /ON CONFLICT ON CONSTRAINT uq_data_quality_results_asset_key DO UPDATE/);
  assert.match(script, /INSERT INTO lineage_edges/);
  assert.match(script, /ON CONFLICT ON CONSTRAINT uq_lineage_edges_relation DO UPDATE/);
  assert.match(script, /upsertLineageEdge/);
  assert.match(script, /backfillSourceAndAssetLineage/);
  assert.match(script, /source_sync_run/);
  assert.match(script, /import_batch/);
  assert.match(script, /brand_knowledge_source/);
  assert.match(script, /dashboard_data_ref/);
  assert.match(script, /published_output/);
  assert.match(script, /backfillMentionTagsAndFeatures/);
  assert.match(script, /MENTION_TAG_RULES/);
  assert.match(script, /trigger/);
  assert.match(script, /barrier/);
  assert.match(script, /journey_stage/);
  assert.match(script, /value_perception/);
  assert.match(script, /audience/);
  assert.match(script, /demographic/);
  assert.match(script, /tags_by_taxonomy/);
  assert.match(script, /INSERT INTO record_tags/);
  assert.match(script, /ON CONFLICT \(subject_type, subject_id, taxonomy_term_id, source\) DO UPDATE/);
  assert.match(script, /INSERT INTO record_feature_values/);
  assert.match(script, /mention_operational_context/);
  assert.match(candidates, /NOISIA_DATA_OS_CANDIDATES_ALLOW_REMOTE/);
  assert.match(candidates, /ready_for_preflight/);
  assert.match(candidates, /NOISIA_DATA_OS_BACKFILL_CORPUS_ID/);
  assert.match(candidates, /NOISIA_DATA_OS_SHADOW_OUTPUT_ID/);
  assert.match(candidates, /po\.kind = 'signal_pulse'/);
  assert.match(analyze, /NOISIA_DATA_OS_ANALYZE_ALLOW_REMOTE/);
  assert.match(analyze, /ANALYZE/);
  assert.match(analyze, /ready_for_serving_reads/);
  assert.match(analyze, /lineage_edges/);
  assert.match(completionAuditScript, /ready_for_goal_completion/);
  assert.match(completionAuditScript, /NOISIA_DATA_OS_EVIDENCE_PACK_DIR/);
  assert.match(completionAuditScript, /release-gate\.ready_for_production_review=true/);
  assert.match(completionAuditScript, /Local checks may be green, but the Goal is not complete/);
  assert.match(completionAuditScript, /external_path_redacted/);
  assert.match(completionAuditScript, /sensitive_output_redacted/);
  assert.match(completionAuditScript, /pr_safe/);
  assert.match(completionAuditScript, /docs\/product\/26_NOISIA_DATA_OS_COMPLETION_AUDIT\.md/);
  assert.match(evidence, /NOISIA_DATA_OS_EVIDENCE_ALLOW_REMOTE/);
  assert.match(evidence, /NOISIA_DATA_OS_EVIDENCE_FORMAT/);
  assert.match(evidence, /ready_for_pr_review/);
  assert.match(evidence, /corepack pnpm data-os:analyze/);
  assert.match(evidence, /ready_for_internal_shadow/);
  assert.match(evidence, /record_feature_values/);
  assert.match(evidence, /tagging_rule_sets/);
  assert.match(evidence, /tagging_model_versions_with_rule_set/);
  assert.match(evidence, /tagging_present/);
  assert.match(evidence, /tag_assertion_review_queue/);
  assert.match(evidence, /review_queue/);
  assert.match(evidence, /ready_for_human_review/);
  assert.match(evidence, /required_before_client_visible/);
  assert.match(evidence, /record_tags_with_evidence/);
  assert.match(evidence, /record_tag_taxonomies/);
  assert.match(evidence, /knowledge_assertions_with_evidence/);
  assert.match(evidence, /data_asset_fields/);
  assert.match(evidence, /data_assets_without_fields/);
  assert.match(evidence, /source_lineage_edges/);
  assert.match(evidence, /asset_lineage_edges/);
  assert.match(evidence, /dashboard_lineage_edges/);
  assert.match(evidence, /dashboard_refs_with_source_id/);
  assert.match(evidence, /brand_os_briefs/);
  assert.match(evidence, /brand_os_links/);
  assert.match(evidence, /knowledge_assertion_links/);
  assert.match(evidence, /knowledge_usage_events/);
  assert.match(evidence, /knowledge_catalog_linked/);
  assert.match(evidence, /payload_fallback_required/);
  assert.match(evidence, /live_payload_parity/);
  assert.match(evidence, /Live report periods are behind published payload/);
  assert.match(evidence, /rollback_flags/);
  assert.match(evidence, /NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED/);
  assert.match(prSummary, /PR summary must not include corpus, output, brand, tag or assertion UUID values/);
  assert.match(prSummary, /PR summary must not include/);
  assert.match(prSummary, /## PR-Safe Evidence/);
  assert.match(prSummary, /Do not paste raw `shadow-run\.log`, `analyze\.json` or `evidence\.json`/);
  assert.match(evidence, /architecture_decision/);
  assert.match(evidence, /customer_intelligence_lakehouse_cdp_like/);
  assert.match(evidence, /not_customer_360_identity_resolution_or_reverse_etl/);
  assert.match(evidence, /live_apis_behind_flags_shadow_mode_with_published_outputs_payload_fallback/);
  assert.match(evidence, /id redacted/);
  assert.match(evidence, /Identifiers: redacted for PR/);
  assert.match(releaseGate, /architecture_decision_confirmed/);
  assert.match(releaseGate, /architecture_decision must be an object/);
  assert.match(releaseGate, /ready_for_production_review/);
  assert.match(releaseGate, /displayEvidenceDir/);
  assert.match(releaseGate, /resolveEvidenceDirReference/);
  assert.match(releaseGate, /RELEASE_TARGETS/);
  assert.match(releaseGate, /published Signal Pulse output/);
  assert.match(releaseGate, /data_catalog_quality_and_lineage/);
  assert.match(releaseGate, /brand_os_and_knowledge_catalogs/);
  assert.match(releaseGate, /brand_os_briefs/);
  assert.match(releaseGate, /catalog_assets/);
  assert.match(releaseGate, /catalog_failed_quality/);
  assert.match(releaseGate, /tagging_rule_set_governance/);
  assert.match(releaseGate, /tag_assertion_review_queue_ready/);
  assert.match(releaseGate, /human_review_sample_complete/);
  assert.match(releaseGate, /review-sample\.json/);
  assert.match(releaseGate, /validateReviewSample/);
  assert.match(releaseGate, /ready_for_release_review_sample/);
  assert.match(releaseGate, /review-sample\.json must not include corpus, tag or assertion UUID values/);
  assert.match(releaseGate, /tag_review_events/);
  assert.match(releaseGate, /knowledge_assertion_review_events/);
  assert.match(releaseGate, /evidence\.json review_queue must be an object/);
  assert.match(releaseGate, /tagging_model_versions_with_rule_set/);
  assert.match(releaseGate, /safe_next_and_rollback_flags/);
  assert.match(releaseGate, /live_render_flag_guarded/);
  assert.match(releaseGate, /disabled_api_payload_fallback/);
  assert.match(releaseGate, /live_payload_parity/);
  assert.match(releaseGate, /serving-smoke\.json live_payload_parity\.live_behind_payload must be false/);
  assert.match(releaseGate, /visibility_checks/);
  assert.match(releaseGate, /client_source_health_hidden/);
  assert.match(releaseGate, /internal_dashboard_refs_preserved/);
  assert.match(releaseGate, /post_backfill_analyze/);
  assert.match(releaseGate, /brand_os_knowledge_links/);
  assert.match(releaseGate, /analyze\.json/);
  assert.match(releaseGate, /NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED/);
  assert.match(releaseGate, /NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED/);
  assert.match(releaseGate, /evidence-pack-validation\.json/);
  assert.match(releaseGate, /ready_for_release_gate/);
  assert.match(releaseGate, /evidence-pack-validation\.json target/);
  assert.match(releaseGate, /evidence_dir must match/);
  assert.match(releaseGate, /checked_files/);
  assert.match(releaseGate, /NOISIA_DATA_OS_BACKFILL_CORPUS_ID_FORMAT=uuid/);
  assert.match(releaseGate, /Schema apply requested/);
  assert.match(releaseGate, /apply-schema\.log/);
  assert.match(releaseGate, /validateArtifactManifest/);
  assert.match(releaseGate, /artifact_manifest_current/);
  assert.match(releaseGate, /checksum changed after evidence-pack-validation\.json was generated/);
  assert.match(releaseGate, /validateNoDatabaseUrls/);
  assert.match(releaseGate, /SENSITIVE_ARTIFACT_PATTERNS/);
  assert.match(releaseGate, /README\.md must not include corpus or output UUID values/);
  assert.match(releaseGate, /serving-smoke\.json must redact corpus_id/);
  assert.match(releaseGate, /serving-smoke\.json must not include corpus or output UUID values/);
  assert.match(releaseGate, /evidence\.md must not include corpus or output UUID values/);
  assert.match(releaseGate, /evidence\.md must state identifiers are redacted for PR/);
  assert.match(evidencePackValidator, /NOISIA_DATA_OS_EVIDENCE_PACK_DIR/);
  assert.match(evidencePackValidator, /displayEvidenceDir/);
  assert.match(evidencePackValidator, /buildArtifactManifest/);
  assert.match(evidencePackValidator, /artifact_manifest_algorithm/);
  assert.match(evidencePackValidator, /ready_for_pr_review/);
  assert.match(evidencePackValidator, /ready_for_serving_shadow/);
  assert.match(evidencePackValidator, /ready_for_live_api_shadow/);
  assert.match(evidencePackValidator, /NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED/);
  assert.match(evidencePackValidator, /analyze\.json/);
  assert.match(evidencePackValidator, /ready_for_serving_reads/);
  assert.match(evidencePackValidator, /fallback_checks/);
  assert.match(evidencePackValidator, /live_payload_parity/);
  assert.match(evidencePackValidator, /serving-smoke\.json live_payload_parity\.live_behind_payload must be false/);
  assert.match(evidencePackValidator, /visibility_checks/);
  assert.match(evidencePackValidator, /client_source_health_hidden/);
  assert.match(evidencePackValidator, /internal_dashboard_refs_preserved/);
  assert.match(evidencePackValidator, /catalog_assets/);
  assert.match(evidencePackValidator, /catalog_fields/);
  assert.match(evidencePackValidator, /catalog_failed_quality/);
  assert.match(evidencePackValidator, /lineage_edges/);
  assert.match(evidencePackValidator, /NOISIA_DATA_OS_SHADOW_MODE/);
  assert.match(evidencePackValidator, /dashboard_refs_with_source_id/);
  assert.match(evidencePackValidator, /brand_os_briefs/);
  assert.match(evidencePackValidator, /brand_os_links/);
  assert.match(evidencePackValidator, /knowledge_assertion_links/);
  assert.match(evidencePackValidator, /knowledge_usage_events/);
  assert.match(evidencePackValidator, /NOISIA_DATA_OS_SHADOW_OUTPUT_ID_FORMAT=uuid/);
  assert.match(evidencePackValidator, /serving-smoke\.json must redact corpus_id/);
  assert.match(evidencePackValidator, /serving-smoke\.json must not include corpus or output UUID values/);
  assert.match(localSmokeValidator, /serving-smoke\.json must redact corpus_id/);
  assert.match(localSmokeValidator, /serving-smoke\.json must not include corpus or output UUID values/);
  assert.match(servingSmoke, /corpus_id: "set_redacted"/);
  assert.match(servingSmoke, /output_id: "set_redacted"/);
  assert.match(servingSmoke, /contains_sensitive_ids: false/);
  assert.match(evidencePackValidator, /Schema apply requested/);
  assert.match(evidencePackValidator, /apply-schema\.log/);
  assert.match(evidencePackValidator, /validateNoDatabaseUrls/);
  assert.match(evidencePackValidator, /SENSITIVE_ARTIFACT_PATTERNS/);
  assert.match(evidencePackValidator, /README\.md must not include corpus or output UUID values/);
  assert.match(evidencePackValidator, /evidence\.md must not include corpus or output UUID values/);
  assert.match(evidencePackValidator, /evidence\.md must state identifiers are redacted for PR/);
  assert.match(evidencePackValidator, /evidence\.md must include the Data OS architecture decision/);
  assert.match(evidencePackValidator, /evidence\.json architecture_decision must be an object/);
  assert.match(evidencePackValidator, /evidence\.md must include the Data OS review queue/);
  assert.match(evidencePackValidator, /evidence\.json review_queue must be an object/);
  assert.match(evidencePackValidator, /evidence-pack-validation\.json|evidence\.json/);
  assert.match(localSmokeValidator, /NOISIA_DATA_OS_LOCAL_SMOKE_EVIDENCE_DIR/);
  assert.match(localSmokeValidator, /displayEvidenceDir/);
  assert.match(localSmokeValidator, /\.data", "data-os-local-smoke/);
  assert.match(localSmokeValidator, /parseCapturedJsonObjects/);
  assert.match(localSmokeValidator, /parseLastJsonObject/);
  assert.match(localSmokeValidator, /validateNoDatabaseUrls/);
  assert.match(localSmokeValidator, /SENSITIVE_ARTIFACT_PATTERNS/);
  assert.match(localSmokeValidator, /README\.md must not include corpus or output UUID values/);
  assert.match(localSmokeValidator, /does not replace the staging\/preview evidence pack/);
  assert.match(localSmokeValidator, /ready_for_staging_preflight/);
  assert.match(localSmokeValidator, /ready_for_release_gate: false/);
  assert.match(localSmokeValidator, /evidence\.json architecture_decision must be an object/);
  assert.match(localSmokeValidator, /evidence\.json review_queue must be an object/);
  assert.match(localSmokeValidator, /review-sample\.json/);
  assert.match(localSmokeValidator, /auto_selected_local/);
  assert.match(localSmokeValidator, /tag_review_events/);
  assert.match(localSmokeValidator, /knowledge_assertion_review_events/);
  assert.match(localSmokeValidator, /customer_intelligence_lakehouse_cdp_like/);
  assert.match(localSmokeValidator, /data_assets_without_fields/);
  assert.match(localSmokeValidator, /knowledge_assertion_links/);
  assert.match(localSmokeValidator, /data_os_disabled_fallback/);
  assert.match(localSmokeValidator, /visibility_checks/);
  assert.match(localSmokeValidator, /client_source_health_hidden/);
  assert.match(localSmokeValidator, /internal_dashboard_refs_preserved/);
  assert.match(preflight, /NOISIA_DATA_OS_BACKFILL_CORPUS_ID/);
  assert.match(preflight, /NOISIA_DATA_OS_PREFLIGHT_ALLOW_REMOTE/);
  assert.match(preflight, /ready_for_backfill/);
  assert.match(preflight, /Output must be Signal Pulse/);
  assert.match(shadowQa, /NOISIA_DATA_OS_SHADOW_OUTPUT_ID/);
  assert.match(shadowQa, /NOISIA_DATA_OS_SHADOW_ALLOW_REMOTE/);
  assert.match(shadowQa, /ready_for_live_switch/);
  assert.match(shadowQa, /Missing dashboard_data_refs/);
  assert.match(shadowQa, /data_asset_fields/);
  assert.match(shadowQa, /data_assets_without_fields/);
  assert.match(shadowQa, /tagging_rule_sets/);
  assert.match(shadowQa, /tagging_model_versions_with_rule_set/);
  assert.match(shadowQa, /record_feature_values/);
  assert.match(shadowQa, /source_lineage_edges/);
  assert.match(shadowQa, /asset_lineage_edges/);
  assert.match(shadowQa, /dashboard_lineage_edges/);
  assert.match(shadowQa, /dashboard_refs_with_source_id/);
  assert.match(shadowQa, /brand_os_briefs/);
  assert.match(shadowQa, /brand_os_links/);
  assert.match(shadowQa, /knowledge_assertion_links/);
  assert.match(shadowQa, /knowledge_usage_events/);
  assert.match(shadowRun, /NOISIA_DATA_OS_SHADOW_RUN_ENABLED/);
  assert.match(shadowRun, /NOISIA_DATA_OS_SHADOW_RUN_STRICT/);
  assert.match(shadowRun, /spawn\("corepack", \["pnpm", "exec", "tsx", script\]/);
  assert.match(shadowRun, /NOISIA_DATA_OS_PREFLIGHT_ALLOW_REMOTE/);
  assert.match(shadowRun, /NOISIA_DATA_OS_BACKFILL_ALLOW_REMOTE/);
  assert.match(shadowRun, /NOISIA_DATA_OS_VERIFY_DB: "true"/);
  assert.match(shadowRun, /ready_for_live_api_shadow/);
  assert.match(shadowRun, /NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED/);
  assert.match(smoke, /requireSafeDatabaseWriteTarget\(databaseUrl/);
  assert.match(smoke, /allowRemoteEnv: "NOISIA_DATA_OS_SMOKE_ALLOW_REMOTE"/);
  assert.match(smoke, /run\("corepack", \["pnpm", "exec", "tsx", "scripts\/data-os-preflight\.ts"\]/);
  assert.match(smoke, /run\("corepack", \["pnpm", "exec", "tsx", "scripts\/data-os-backfill\.ts"\]/);
  assert.match(smoke, /scripts\/data-os-preflight\.ts/);
  assert.match(smoke, /NOISIA_DATA_OS_BACKFILL_ENABLED: "true"/);
  assert.match(smoke, /NOISIA_DATA_OS_BACKFILL_CORPUS_ID: IDS\.corpus/);
  assert.match(smoke, /record_tags_trigger/);
  assert.match(smoke, /tagging_rule_sets/);
  assert.match(smoke, /tagging_model_versions_with_rule_set/);
  assert.match(smoke, /data_asset_fields/);
  assert.match(smoke, /data_assets_without_fields/);
  assert.match(smoke, /record_tags_barrier/);
  assert.match(smoke, /record_tags_journey_stage/);
  assert.match(smoke, /record_tags_value_perception/);
  assert.match(smoke, /record_tags_audience/);
  assert.match(smoke, /record_tags_demographic/);
  assert.match(smoke, /record_feature_values/);
  assert.match(smoke, /lineage_data_source_to_asset/);
  assert.match(smoke, /lineage_import_batch_to_asset/);
  assert.match(smoke, /lineage_knowledge_source_to_asset/);
  assert.match(smoke, /lineage_asset_to_dashboard_ref/);
  assert.match(smoke, /lineage_dashboard_ref_to_output/);
  assert.match(smoke, /dashboard_data_refs_with_source_id/);
  assert.match(smoke, /brand_os_briefs/);
  assert.match(smoke, /brand_os_links/);
  assert.match(smoke, /knowledge_assertion_links/);
  assert.match(smoke, /knowledge_usage_events/);
  assert.match(smoke, /Data OS smoke verification failed/);
  assert.match(localSmoke, /corepack pnpm/);
  assert.match(localSmoke, /NOISIA_DATA_OS_LOCAL_SMOKE_EVIDENCE_DIR/);
  assert.match(localSmoke, /\.data\/data-os-local-smoke/);
  assert.match(localSmoke, /run_capture migrations\.log/);
  assert.match(localSmoke, /run_capture smoke\.log/);
  assert.match(localSmoke, /run_capture shadow-run\.log/);
  assert.match(localSmoke, /run_capture analyze\.json/);
  assert.match(localSmoke, /run_capture review-queue\.json/);
  assert.match(localSmoke, /run_capture review-sample\.json/);
  assert.match(localSmoke, /run_capture evidence\.json/);
  assert.match(localSmoke, /run_capture serving-smoke\.json/);
  assert.match(localSmoke, /run_capture local-smoke-validation\.json/);
  assert.match(localSmoke, /redacted_command_summary/);
  assert.match(localSmoke, /corepack pnpm --filter @noisia\/db db:smoke:local/);
  assert.match(localSmoke, /corepack pnpm --filter @noisia\/db data-os:smoke/);
  assert.match(localSmoke, /corepack pnpm --filter @noisia\/db data-os:shadow-run/);
  assert.match(localSmoke, /corepack pnpm --filter @noisia\/db data-os:analyze/);
  assert.match(localSmoke, /corepack pnpm --filter @noisia\/db data-os:review-queue/);
  assert.match(localSmoke, /corepack pnpm --filter @noisia\/db data-os:review-sample/);
  assert.match(localSmoke, /NOISIA_DATA_OS_REVIEW_SAMPLE_AUTO_SELECT_LOCAL=true/);
  assert.match(localSmoke, /corepack pnpm --filter @noisia\/db data-os:evidence/);
  assert.match(localSmoke, /corepack pnpm --filter @noisia\/studio data-os:serving-smoke/);
  assert.match(localSmoke, /corepack pnpm --filter @noisia\/db data-os:validate-local-smoke/);
  assert.match(localSmoke, /run_pnpm db:smoke:local:down/);
  assert.match(localSmoke, /DATABASE_URL="\$SMOKE_DATABASE_URL"/);
  assert.match(stagingCheck, /Noisia Data OS staging environment check/);
  assert.match(stagingCheck, /Values are intentionally redacted/);
  assert.match(stagingCheck, /LOCAL_DATA_OS_VERIFY=passed/);
  assert.match(stagingCheck, /corepack pnpm --silent data-os:verify/);
  assert.match(stagingCheck, /check_required DATABASE_URL/);
  assert.match(stagingCheck, /DATABASE_URL_FORMAT=postgres_url/);
  assert.match(stagingCheck, /DATABASE_URL_FORMAT=placeholder_refused/);
  assert.match(stagingCheck, /DATABASE_URL_FORMAT=invalid_postgres_url/);
  assert.match(stagingCheck, /DATABASE_URL_ENVIRONMENT=production_like_refused/);
  assert.match(stagingCheck, /DATABASE_URL_PRODUCTION_LIKE/);
  assert.match(stagingCheck, /NOISIA_REMOTE_DATABASE_TARGET/);
  assert.match(stagingCheck, /NOISIA_DATA_OS_BACKFILL_CORPUS_ID/);
  assert.match(stagingCheck, /NOISIA_DATA_OS_SHADOW_OUTPUT_ID/);
  assert.match(stagingCheck, /check_uuid_if_set/);
  assert.match(stagingCheck, /NOISIA_DATA_OS_BACKFILL_CORPUS_ID_FORMAT/);
  assert.match(stagingCheck, /NOISIA_DATA_OS_SHADOW_OUTPUT_ID_FORMAT/);
  assert.match(stagingCheck, /NOISIA_DATA_OS_STAGING_SHADOW_APPROVED/);
  assert.match(stagingCheck, /release_gate_artifact=will_write:release-gate\.json/);
  assert.match(stagingCheck, /ready_for_staging_shadow=true/);
  assert.match(stagingCheck, /corepack pnpm data-os:staging-shadow/);
  assert.match(stagingFinalize, /NOISIA_DATA_OS_STAGING_EVIDENCE_DIR/);
  assert.match(stagingFinalize, /NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED/);
  assert.match(stagingFinalize, /NOISIA_DATA_OS_REVIEW_TAG_ID/);
  assert.match(stagingFinalize, /NOISIA_DATA_OS_REVIEW_ASSERTION_ID/);
  assert.match(stagingFinalize, /run_capture staging-check\.txt/);
  assert.match(stagingFinalize, /run_capture review-queue\.json/);
  assert.match(stagingFinalize, /data-os:review-queue/);
  assert.match(stagingFinalize, /NOISIA_DATA_OS_REVIEW_QUEUE_ALLOW_REMOTE=true/);
  assert.match(stagingFinalize, /data-os:review-sample/);
  assert.match(stagingFinalize, /NOISIA_DATA_OS_REVIEW_ALLOW_REMOTE=true/);
  assert.match(stagingFinalize, /data-os:serving-smoke/);
  assert.match(stagingFinalize, /redacted_command_summary/);
  assert.match(stagingFinalize, /data-os:validate-evidence-pack/);
  assert.match(stagingFinalize, /data-os:release-gate/);
  assert.match(stagingFinalize, /pr-summary\.md/);
  assert.match(stagingFinalize, /data-os:pr-summary/);
  assert.match(stagingFinalize, /completion-audit\.json/);
  assert.match(stagingFinalize, /data-os:completion-audit/);
  assert.ok(
    stagingFinalize.includes("append_release_gate_summary\n\nrun_capture evidence-pack-validation.json"),
    "staging finalize must write the release gate README summary before evidence validation"
  );
  assert.match(stagingFinalize, /run_capture_without_summary release-gate\.json/);
  assert.match(stagingFinalize, /Corpus: set \(redacted\)/);
  assert.match(stagingFinalize, /Output: set \(redacted\)/);
  assert.match(stagingShadow, /NOISIA_DATA_OS_STAGING_SHADOW_APPROVED/);
  assert.match(stagingShadow, /NOISIA_DATA_OS_STAGING_EVIDENCE_DIR/);
  assert.ok(
    stagingShadow.indexOf("corepack pnpm --silent data-os:staging-check") < stagingShadow.indexOf("EVIDENCE_DIR="),
    "staging shadow must run data-os:staging-check before creating the evidence directory"
  );
  assert.ok(
    stagingShadow.indexOf("@noisia/db data-os:preflight") < stagingShadow.indexOf("EVIDENCE_DIR="),
    "staging shadow must run data-os:preflight before creating the evidence directory"
  );
  assert.ok(
    stagingShadow.indexOf("@noisia/db db:apply:existing") < stagingShadow.indexOf("@noisia/db data-os:preflight"),
    "staging shadow must apply schema before the output/corpus preflight when requested"
  );
  assert.ok(
    stagingShadow.indexOf("@noisia/db db:apply:existing") < stagingShadow.indexOf("EVIDENCE_DIR="),
    "staging shadow must apply schema before creating the evidence directory when requested"
  );
  assert.match(stagingShadow, /NOISIA_DATA_OS_PREFLIGHT_ALLOW_REMOTE=true/);
  assert.match(stagingShadow, /Schema apply failed before evidence package creation/);
  assert.match(stagingShadow, /apply-schema\.log/);
  assert.match(stagingShadow, /Signal Pulse output\/corpus preflight failed before evidence package creation/);
  assert.match(stagingShadow, /\.data\/data-os-evidence/);
  assert.match(stagingShadow, /run_capture/);
  assert.match(stagingShadow, /redacted_command_summary/);
  assert.match(stagingShadow, /pnpm --silent/);
  assert.match(stagingShadow, /README\.md/);
  assert.match(stagingShadow, /staging-check\.txt/);
  assert.match(stagingShadow, /data-os:staging-check/);
  assert.match(stagingShadow, /candidates\.json/);
  assert.match(stagingShadow, /shadow-run\.log/);
  assert.match(stagingShadow, /analyze\.json/);
  assert.match(stagingShadow, /serving-smoke\.json/);
  assert.match(stagingShadow, /review-queue\.json/);
  assert.match(stagingShadow, /data-os:review-queue/);
  assert.match(stagingShadow, /NOISIA_DATA_OS_REVIEW_QUEUE_ALLOW_REMOTE=true/);
  assert.match(stagingShadow, /evidence\.json/);
  assert.match(stagingShadow, /evidence\.md/);
  assert.match(stagingShadow, /evidence-pack-validation\.json/);
  assert.match(stagingShadow, /data-os:validate-evidence-pack/);
  assert.match(stagingShadow, /release-gate\.json/);
  assert.match(stagingShadow, /data-os:release-gate/);
  assert.match(stagingShadow, /pr-summary\.md/);
  assert.match(stagingShadow, /data-os:pr-summary/);
  assert.match(stagingShadow, /completion-audit\.json/);
  assert.match(stagingShadow, /data-os:completion-audit/);
  assert.ok(
    stagingShadow.includes("append_release_gate_summary\n\nrun_capture evidence-pack-validation.json"),
    "staging shadow must write the release gate README summary before evidence validation"
  );
  assert.match(stagingShadow, /run_capture_without_summary release-gate\.json/);
  assert.match(stagingShadow, /Evidence package:/);
  assert.match(stagingShadow, /Corpus: set \(redacted\)/);
  assert.match(stagingShadow, /Output: set \(redacted\)/);
  assert.match(stagingShadow, /NOISIA_REMOTE_DATABASE_TARGET/);
  assert.match(stagingShadow, /NOISIA_DATA_OS_STAGING_SHADOW_APPLY_SCHEMA/);
  assert.match(stagingShadow, /NOISIA_DB_APPLY_EXISTING_ALLOW_REMOTE=true/);
  assert.match(stagingShadow, /NOISIA_DATA_OS_CANDIDATES_ALLOW_REMOTE=true/);
  assert.match(stagingShadow, /NOISIA_DATA_OS_SHADOW_RUN_ENABLED=true/);
  assert.match(stagingShadow, /NOISIA_DATA_OS_ANALYZE_ALLOW_REMOTE=true/);
  assert.match(stagingShadow, /NOISIA_DATA_OS_SERVING_SMOKE_ALLOW_REMOTE=true/);
  assert.match(stagingShadow, /NOISIA_DATA_OS_REVIEW_QUEUE_ALLOW_REMOTE=true/);
  assert.match(stagingShadow, /NOISIA_DATA_OS_EVIDENCE_ALLOW_REMOTE=true/);
  assert.match(stagingShadow, /corepack pnpm data-os:review-queue/);
  assert.match(stagingShadow, /corepack pnpm data-os:staging-finalize/);
  assert.match(stagingShadow, /do not attach it to PR evidence/);
  assert.match(stagingShadow, /Data OS staging shadow completed\./);
  assert.match(reviewQueue, /requireSafeDatabaseReadTarget/);
  assert.match(reviewQueue, /NOISIA_DATA_OS_REVIEW_QUEUE_ALLOW_REMOTE/);
  assert.match(reviewQueue, /NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_IDS/);
  assert.match(reviewQueue, /NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_CONTEXT/);
  assert.match(reviewQueue, /do_not_commit_or_paste_when_sensitive/);
  assert.match(reviewQueue, /suggested_exports/);
  assert.match(reviewQueue, /corepack pnpm data-os:staging-finalize/);
  assert.match(servingSmoke, /source_health_fields/);
  assert.match(servingSmoke, /loadPublishedPayloadCounts/);
  assert.match(servingSmoke, /live_payload_parity/);
  assert.match(servingSmoke, /Signal Pulse live DB is behind published payload/);
  assert.match(servingSmoke, /source_health_assets_without_fields/);
  assert.match(servingSmoke, /getDataOsBrandOs/);
  assert.match(servingSmoke, /getDataOsCatalog/);
  assert.match(servingSmoke, /getDataOsKnowledge/);
  assert.match(servingSmoke, /getDataOsReviewQueue/);
  assert.match(servingSmoke, /listDataOsLineage/);
  assert.match(servingSmoke, /disabledDataOsResponse/);
  assert.match(servingSmoke, /disabledSignalPulseLiveResponse/);
  assert.match(servingSmoke, /fallback_checks/);
  assert.match(servingSmoke, /visibility_checks/);
  assert.match(servingSmoke, /applyPulseLiveVisibility/);
  assert.match(servingSmoke, /client_source_health_hidden/);
  assert.match(servingSmoke, /internal_dashboard_refs_preserved/);
  assert.match(servingSmoke, /brand_os_profiles/);
  assert.match(servingSmoke, /brand_os_briefs/);
  assert.match(servingSmoke, /catalog_assets/);
  assert.match(servingSmoke, /knowledge_assertions/);
  assert.match(servingSmoke, /brand_os_links/);
  assert.match(servingSmoke, /knowledge_assertion_links/);
  assert.match(servingSmoke, /knowledge_usage_events/);
  assert.match(servingSmoke, /review_queue_ready_for_human_review/);
  assert.match(servingSmoke, /review_queue_required_before_client_visible/);
  assert.match(servingSmoke, /review_queue_tags_with_evidence/);
  assert.match(servingSmoke, /review_queue_assertions_with_evidence/);
  assert.match(servingSmoke, /lineage_edges/);
  assert.match(servingSmoke, /field_count/);
  assert.match(studioDataOsQueue, /enqueueDataOsShadowRun/);
  assert.match(studioDataOsQueue, /DATA_OS_SHADOW_RUN_JOB_NAME/);
  assert.match(studioDataOsQueue, /NOISIA_DATA_OS_QUEUE_NAME/);
  assert.match(studioDataOsQueueTest, /buildDataOsShadowRunJobOptions/);
  assert.match(queryEngineIndex, /export \* from "\.\/data-os"/);
  assert.match(dataOsContract, /DATA_OS_QUEUE_NAME = "noisia-data-os"/);
  assert.match(dataOsContract, /DATA_OS_SHADOW_RUN_JOB_NAME = "data_os_shadow_run"/);
  assert.match(dataOsContract, /DATA_OS_ALLOWED_REMOTE_TARGETS/);
  assert.match(dataOsContract, /isDataOsRemoteTargetAllowed/);
  assert.match(dataOsContract, /NOISIA_DATA_OS_WORKER_ENABLED/);
  assert.match(dataOsContract, /NOISIA_DATA_OS_WORKER_RUNS_ENABLED/);
  assert.match(dataOsContractTest, /flags default closed/);
  assert.match(dataOsContractTest, /NOISIA_REMOTE_DATABASE_TARGET: "production"/);
  assert.match(workerIndex, /isDataOsWorkerEnabled/);
  assert.match(workerIndex, /startDataOsWorker/);
  assert.match(workerIndex, /Data OS worker disabled/);
  assert.match(dataOsQueue, /DATA_OS_QUEUE_NAME/);
  assert.match(dataOsQueue, /DATA_OS_SHADOW_RUN_JOB_NAME/);
  assert.match(dataOsQueue, /NOISIA_DATA_OS_QUEUE_NAME/);
  assert.match(dataOsWorker, /NOISIA_DATA_OS_WORKER_RUNS_ENABLED/);
  assert.match(dataOsWorker, /isDataOsWorkerRemoteApproved/);
  assert.match(dataOsWorker, /NOISIA_DATA_OS_SHADOW_RUN_ENABLED: "true"/);
  assert.match(dataOsWorker, /NOISIA_DATA_OS_ANALYZE_ALLOW_REMOTE/);
  assert.match(dataOsWorker, /data-os:shadow-run/);
  assert.match(dataOsWorker, /data-os:analyze/);
  assert.match(dataOsWorker, /data-os:serving-smoke/);
  assert.match(dataOsWorker, /data-os:review-queue/);
  assert.match(dataOsWorker, /NOISIA_DATA_OS_REVIEW_QUEUE_ALLOW_REMOTE/);
  assert.match(dataOsWorker, /NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_IDS: "false"/);
  assert.match(dataOsWorker, /NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_CONTEXT: "false"/);
  assert.match(dataOsWorker, /data-os:evidence/);
  assert.match(dataOsWorkerTest, /fail closed without the execution gate/);
  assert.match(dataOsWorkerTest, /remote approval adds only the reviewed remote overrides/);
  assert.match(dataOsWorkerTest, /focused serving smoke debugging/);
  assert.match(dataOsWorkerTest, /unscopedRemote\.NOISIA_DATA_OS_PREFLIGHT_ALLOW_REMOTE/);
});

test("Data OS readiness verifier covers migration, routes, flags and optional DB checks", async () => {
  const dbPackage = JSON.parse(await readFile(resolve(process.cwd(), "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const script = await readFile(resolve(process.cwd(), "scripts/verify-data-os-readiness.ts"), "utf8");
  const envExample = await readFile(resolve(process.cwd(), "../../apps/studio/.env.example"), "utf8");
  const gitignore = await readFile(resolve(process.cwd(), "../../.gitignore"), "utf8");

  assert.equal(dbPackage.scripts?.["data-os:verify"], "tsx scripts/verify-data-os-readiness.ts");
  assert.match(script, /0035_data_os_foundation/);
  assert.match(script, /data-os:analyze/);
  assert.match(script, /data-os:candidates/);
  assert.match(script, /data-os:completion-audit/);
  assert.match(script, /data-os:evidence/);
  assert.match(script, /data-os:preflight/);
  assert.match(script, /data-os:release-gate/);
  assert.match(script, /data-os:review-queue/);
  assert.match(script, /data-os:shadow-qa/);
  assert.match(script, /data-os:shadow-run/);
  assert.match(script, /data-os:staging-check/);
  assert.match(script, /data-os:staging-finalize/);
  assert.match(script, /data-os:staging-shadow/);
  assert.match(script, /data-os:validate-evidence-pack/);
  assert.match(script, /data-os:smoke/);
  assert.match(script, /REQUIRED_ROOT_SCRIPTS/);
  assert.match(script, /AGENTS\.md/);
  assert.match(script, /\.github\/CODEOWNERS/);
  assert.match(script, /\.github\/pull_request_template/);
  assert.match(script, /\.github\/workflows\/ci\.yml/);
  assert.match(script, /AGENT_GUARDRAILS/);
  assert.match(script, /docs", "BRANCHES\.md/);
  assert.match(script, /04_DATABASE_SCHEMA/);
  assert.match(script, /06_TECHNICAL_DECISIONS/);
  assert.match(script, /08_API_CONTRACTS/);
  assert.match(script, /23_NOISIA_DATA_OS_STAGING_RUNBOOK/);
  assert.match(script, /25_NOISIA_DATA_OS_STAGING_HANDOFF/);
  assert.match(script, /26_NOISIA_DATA_OS_COMPLETION_AUDIT/);
  assert.match(script, /31_SIGNAL_PRODUCT_NORTH_STAR/);
  assert.match(script, /32_SIGNAL_BACKEND_EXECUTION_ROADMAP/);
  assert.match(script, /009-signal-always-on-strategic-dashboard/);
  assert.match(script, /verifyRootScripts/);
  assert.match(script, /verifyStudioScripts/);
  assert.match(script, /verifyImplementationContracts/);
  assert.match(script, /ready_for_live_api_shadow: true/);
  assert.match(script, /ready_for_serving_shadow/);
  assert.match(script, /ready_for_pr_review/);
  assert.match(script, /tagging_rule_sets/);
  assert.match(script, /tagging_model_versions_with_rule_set/);
  assert.match(script, /AGENTS Data OS priority/);
  assert.match(script, /AGENTS Signal North Star pointer/);
  assert.match(script, /Signal North Star two-speed product contract/);
  assert.match(script, /Signal ADR deterministic metrics decision/);
  assert.match(script, /Signal backend roadmap first task contract/);
  assert.match(script, /Signal backend roadmap front-ready gate/);
  assert.match(script, /AGENTS Studio build gate/);
  assert.match(script, /PR template Studio build gate/);
  assert.match(script, /CI Studio production build step/);
  assert.match(script, /CI Studio production build command/);
  assert.match(script, /PR template CI Studio build gate/);
  assert.match(script, /staging runbook Studio build gate/);
  assert.match(script, /AGENTS Data OS staging check gate/);
  assert.match(script, /AGENTS staging check redaction note/);
  assert.match(script, /AGENTS Data OS staging shadow gate/);
  assert.match(script, /AGENTS Data OS handoff pointer/);
  assert.match(script, /AGENTS Data OS completion audit pointer/);
  assert.match(script, /AGENTS local evidence is not staging evidence guard/);
  assert.match(script, /AGENTS completion requires staging evidence guard/);
  assert.match(script, /Data OS benchmark database format release gate/);
  assert.match(script, /NOISIA_DATA_OS_STAGING_SHADOW_APPROVED/);
  assert.match(script, /NOISIA_DATA_OS_STAGING_EVIDENCE_DIR/);
  assert.match(script, /\.data\/data-os-evidence/);
  assert.match(script, /staging check production-like URL refusal/);
  assert.match(script, /spec production-like URL refusal/);
  assert.match(script, /staging runbook production-like URL refusal/);
  assert.match(script, /spec staging precheck before evidence pack/);
  assert.match(script, /spec staging pair preflight before evidence pack/);
  assert.match(script, /spec staging schema apply before pair preflight/);
  assert.match(script, /staging runbook precheck before evidence pack/);
  assert.match(script, /staging runbook pair preflight before evidence pack/);
  assert.match(script, /staging runbook schema apply before pair preflight/);
  assert.match(script, /staging handoff typecheck gate/);
  assert.match(script, /staging handoff Studio build gate/);
  assert.match(script, /staging handoff verifier gate/);
  assert.match(script, /staging handoff database URL env/);
  assert.match(script, /staging handoff remote target env/);
  assert.match(script, /staging handoff corpus env/);
  assert.match(script, /staging handoff output env/);
  assert.match(script, /staging handoff shadow approval env/);
  assert.match(script, /staging handoff remote redacted gate/);
  assert.match(script, /staging handoff staging shadow command/);
  assert.match(script, /staging handoff private review queue ID disclosure/);
  assert.match(script, /staging handoff private review queue context disclosure/);
  assert.match(script, /staging handoff human review approval/);
  assert.match(script, /staging handoff finalize command/);
  assert.match(script, /staging handoff release gate artifact/);
  assert.match(script, /staging handoff production review gate/);
  assert.match(script, /staging handoff PR summary artifact/);
  assert.match(script, /staging handoff completion audit artifact/);
  assert.match(script, /staging handoff sensitive artifact warning/);
  assert.match(script, /staging handoff live render guarded flag/);
  assert.match(script, /staging handoff rollback live API flag/);
  assert.match(script, /completion audit title/);
  assert.match(script, /completion audit release gate artifact/);
  assert.match(script, /completion audit production review gate/);
  assert.match(script, /completion audit local\/throwaway insufficiency/);
  assert.match(script, /completion audit Data Catalog requirement/);
  assert.match(script, /completion audit Brand OS requirement/);
  assert.match(script, /completion audit Knowledge Catalog requirement/);
  assert.match(script, /completion audit taxonomy\/tag requirement/);
  assert.match(script, /completion audit quality lineage requirement/);
  assert.match(script, /completion audit serving API requirement/);
  assert.match(script, /completion audit shadow mode requirement/);
  assert.match(script, /completion audit human review requirement/);
  assert.match(script, /completion audit staging shadow command/);
  assert.match(script, /completion audit staging finalize command/);
  assert.match(script, /completion audit artifact self-reference/);
  assert.match(script, /completion audit remote database evidence/);
  assert.match(script, /completion audit database format staging check evidence/);
  assert.match(script, /completion audit database format JSON evidence/);
  assert.match(script, /completion audit database format release gate/);
  assert.match(script, /completion audit review sample gate/);
  assert.match(script, /completion audit checksum manifest/);
  assert.match(script, /completion audit non-completion section/);
  assert.match(script, /completion audit live render no-go/);
  assert.match(script, /gitignore local evidence data directory/);
  assert.match(script, /gitignore captured command logs/);
  assert.match(script, /CI Data OS readiness step/);
  assert.match(script, /CI Data OS local smoke validation command/);
  assert.match(script, /CI Node 20 runtime/);
  assert.match(script, /PR template Data OS evidence section/);
  assert.match(script, /PR template staging check command/);
  assert.match(script, /PR template staging remote database environment gate/);
  assert.match(script, /PR template staging database format gate/);
  assert.match(script, /PR template staging check artifact/);
  assert.match(script, /PR template staging shadow evidence pack gate/);
  assert.match(script, /PR template evidence pack validation command/);
  assert.match(script, /PR template raw shadow-run warning/);
  assert.match(script, /PR template raw analyze warning/);
  assert.match(script, /PR template raw evidence JSON warning/);
  assert.match(script, /PR template evidence markdown architecture decision gate/);
  assert.match(script, /PR template evidence markdown ID redaction gate/);
  assert.match(script, /PR template sensitive artifact scan gate/);
  assert.match(script, /PR template artifact manifest checksum gate/);
  assert.match(script, /PR template PR summary database format gate/);
  assert.match(script, /PR template completion audit database format gate/);
  assert.match(script, /PR template local smoke validation gate/);
  assert.match(script, /PR template local smoke staging preflight readiness/);
  assert.match(script, /PR template Data Catalog lineage evidence gate/);
  assert.match(script, /PR template Brand OS Knowledge link evidence gate/);
  assert.match(script, /PR template review queue evidence gate/);
  assert.match(script, /PR template review queue human review gate/);
  assert.match(script, /PR template review queue client-visible gate/);
  assert.match(script, /PR template tag review event gate/);
  assert.match(script, /PR template assertion review event gate/);
  assert.match(script, /PR template review sample artifact/);
  assert.match(script, /PR template review sample readiness gate/);
  assert.match(script, /PR template review sample event gate/);
  assert.match(script, /PR template safe next\/rollback flags gate/);
  assert.match(script, /PR template release gate command/);
  assert.match(script, /PR template release gate artifact/);
  assert.match(script, /PR template completion audit artifact/);
  assert.match(script, /PR template completion audit command/);
  assert.match(script, /PR template completion audit gate/);
  assert.match(script, /PR template evidence pack path/);
  assert.match(script, /local smoke analyze command/);
  assert.match(script, /local smoke validation artifact/);
  assert.match(script, /local smoke validation command/);
  assert.match(script, /staging shadow staging check artifact/);
  assert.match(script, /staging shadow staging check command/);
  assert.match(script, /staging shadow prechecks before evidence directory/);
  assert.match(script, /staging shadow console corpus\/output redaction/);
  assert.match(script, /staging shadow analyze artifact/);
  assert.match(script, /staging shadow release gate artifact/);
  assert.match(script, /staging shadow completion audit artifact/);
  assert.match(script, /staging shadow completion audit command/);
  assert.match(script, /staging finalize completion audit artifact/);
  assert.match(script, /staging finalize completion audit command/);
  assert.match(script, /staging shadow requires review sample artifact before final evidence/);
  assert.match(script, /spec staging check command/);
  assert.match(script, /spec staging check UUID format gate/);
  assert.match(script, /spec staging check database format gate/);
  assert.match(script, /staging runbook staging check command/);
  assert.match(script, /staging runbook staging check readiness/);
  assert.match(script, /staging runbook UUID format gate/);
  assert.match(script, /staging runbook review sample tag id UUID gate/);
  assert.match(script, /staging runbook review sample assertion id UUID gate/);
  assert.match(script, /staging runbook staging check artifact/);
  assert.match(script, /staging runbook serving smoke review queue readiness/);
  assert.match(script, /staging check review sample approval status/);
  assert.match(script, /staging check review sample tag id precheck/);
  assert.match(script, /staging check review sample assertion id precheck/);
  assert.match(script, /staging check review action validation helper/);
  assert.match(script, /spec release gate artifact/);
  assert.match(script, /spec release gate artifact checksum guard/);
  assert.match(script, /spec release gate database format gate/);
  assert.match(script, /staging runbook release gate artifact/);
  assert.match(script, /staging runbook completion audit artifact/);
  assert.match(script, /staging runbook completion audit command/);
  assert.match(script, /staging runbook completion audit gate/);
  assert.match(script, /staging runbook artifact manifest checksum output/);
  assert.match(script, /staging runbook artifact checksum drift guard/);
  assert.match(script, /analyze remote guard/);
  assert.match(script, /evidence required analyze attachment/);
  assert.match(script, /evidence pack validator staging check artifact/);
  assert.match(script, /evidence pack validator staging check target match/);
  assert.match(script, /evidence pack validator release gate readiness output/);
  assert.match(script, /evidence pack validator staging check readiness/);
  assert.match(script, /evidence pack validator staging check redaction guard/);
  assert.match(script, /evidence pack validator staging check UUID format gate/);
  assert.match(script, /evidence pack validator staging check review approval gate/);
  assert.match(script, /evidence pack validator staging check review tag id UUID gate/);
  assert.match(script, /evidence pack validator staging check review assertion id UUID gate/);
  assert.match(script, /evidence pack validator artifact database URL scan/);
  assert.match(script, /evidence pack validator sensitive artifact scan/);
  assert.match(script, /evidence pack validator repo-relative evidence path output/);
  assert.match(script, /evidence pack validator remote database environment gate/);
  assert.match(script, /evidence pack validator database environment output/);
  assert.match(script, /evidence pack validator artifact manifest builder/);
  assert.match(script, /evidence pack validator artifact manifest output/);
  assert.match(script, /release gate disabled API fallback gate/);
  assert.match(script, /release gate post-backfill analyze gate/);
  assert.match(script, /release gate staging check artifact/);
  assert.match(script, /release gate staging check target match/);
  assert.match(script, /release gate staging check readiness/);
  assert.match(script, /release gate staging check redaction guard/);
  assert.match(script, /release gate staging check UUID format gate/);
  assert.match(script, /release gate staging check review approval gate/);
  assert.match(script, /release gate staging check review tag id UUID gate/);
  assert.match(script, /release gate staging check review assertion id UUID gate/);
  assert.match(script, /release gate Brand OS Knowledge links gate/);
  assert.match(script, /release gate review queue gate/);
  assert.match(script, /release gate review sample artifact/);
  assert.match(script, /release gate review sample validator/);
  assert.match(script, /release gate review sample readiness check/);
  assert.match(script, /release gate review sample UUID guard/);
  assert.match(script, /release gate review queue object/);
  assert.match(script, /release gate validator release-readiness check/);
  assert.match(script, /release gate validator target match/);
  assert.match(script, /release gate validator evidence dir match/);
  assert.match(script, /release gate validator checked files audit/);
  assert.match(script, /release gate artifact manifest verifier/);
  assert.match(script, /release gate artifact manifest gate/);
  assert.match(script, /release gate artifact checksum drift guard/);
  assert.match(script, /release gate evidence artifact database URL scan/);
  assert.match(script, /release gate sensitive artifact scan/);
  assert.match(script, /release gate repo-relative evidence path output/);
  assert.match(script, /release gate repo-relative evidence dir validation/);
  assert.match(script, /release gate remote database environment gate/);
  assert.match(script, /release gate validator remote database environment check/);
  assert.match(script, /backfill Brand OS Knowledge links/);
  assert.match(script, /evidence knowledge catalog linked gate/);
  assert.match(script, /serving smoke Brand OS Knowledge link counts/);
  assert.match(script, /serving smoke review queue check/);
  assert.match(script, /serving smoke review queue readiness count/);
  assert.match(script, /serving smoke review queue client-visible requirement/);
  assert.match(script, /serving smoke review queue tag evidence count/);
  assert.match(script, /serving smoke review queue assertion evidence count/);
  assert.match(script, /CODEOWNERS Data OS API path/);
  assert.match(script, /guardrails Data OS section/);
  assert.match(script, /guardrails release gate/);
  assert.match(script, /guardrails staging evidence pack path/);
  assert.match(script, /guardrails staging check artifact/);
  assert.match(script, /guardrails staging check database format gate/);
  assert.match(script, /guardrails release database format gate/);
  assert.match(script, /guardrails Data OS worker remote target gate/);
  assert.match(script, /branches doc Data OS branch/);
  assert.match(script, /branches doc release gate merge requirement/);
  assert.match(script, /branches doc database format release gate/);
  assert.match(script, /branches doc database format gate name/);
  assert.match(script, /technical decisions Data OS section/);
  assert.match(script, /technical decisions database format release gate/);
  assert.match(script, /database schema Data OS section/);
  assert.match(script, /database schema release gate/);
  assert.match(script, /database schema database format release gate/);
  assert.match(script, /database schema missing/);
  assert.match(script, /API contracts Data OS section/);
  assert.match(script, /API contracts Pulse output read auth/);
  assert.match(script, /API contracts Pulse visibility guard/);
  assert.match(script, /API contracts Pulse source health visibility/);
  assert.match(script, /API contracts demographic corpus filter/);
  assert.match(script, /API contracts tag review audit trail/);
  assert.match(script, /API contracts assertion review audit trail/);
  assert.match(script, /API contracts review queue status write/);
  assert.match(script, /API contracts assertion review status write/);
  assert.match(script, /POST \/api\/data-os\/corpora\/:id\/review-queue/);
  assert.match(script, /GET \/api\/data-os\/pulse\/:outputId\/metrics/);
  assert.match(script, /NOISIA_DATA_OS_SERVING_SMOKE_ALLOW_REMOTE/);
  assert.match(script, /serving smoke Data OS disabled fallback check/);
  assert.match(script, /serving smoke Signal Pulse disabled fallback check/);
  assert.match(script, /serving smoke visibility checks output/);
  assert.match(script, /evidence pack validator visibility checks/);
  assert.match(script, /release gate visibility checks/);
  assert.match(script, /evidence pack validator disabled API fallback checks/);
  assert.match(script, /evidence pack validator serving review queue readiness/);
  assert.match(script, /evidence pack validator serving review queue tag review event count/);
  assert.match(script, /evidence pack validator serving review queue assertion review event count/);
  assert.match(script, /evidence pack validator review sample artifact/);
  assert.match(script, /evidence pack validator review sample validator/);
  assert.match(script, /evidence pack validator review sample readiness check/);
  assert.match(script, /evidence pack validator review sample UUID guard/);
  assert.match(script, /release gate serving review queue readiness/);
  assert.match(script, /release gate human review sample gate/);
  assert.match(script, /release gate production readiness output/);
  assert.match(script, /PulseDataOsShadowBadge/);
  assert.match(script, /Pulse page live Data OS read/);
  assert.match(script, /Pulse page payload parity counts/);
  assert.match(script, /Pulse page live-vs-payload drift guard/);
  assert.match(script, /Pulse page live-behind-payload warning/);
  assert.match(script, /Pulse page payload parity readiness metric/);
  assert.match(script, /Pulse page live render source resolver/);
  assert.match(script, /Pulse page live render adapter/);
  assert.match(script, /Pulse page live render mode/);
  assert.match(script, /Pulse page payload fallback render mode/);
  assert.match(script, /Pulse page payload-linked evidence fallback/);
  assert.match(script, /Pulse page live render flag helper/);
  assert.match(script, /NOISIA_DB_APPLY_EXISTING_ALLOW_REMOTE=true/);
  assert.match(script, /published_outputs\.payload/);
  assert.match(script, /spec Pulse output read auth/);
  assert.match(script, /spec Pulse visibility guard/);
  assert.match(script, /spec Pulse source health visibility guard/);
  assert.match(script, /spec serving smoke visibility checks/);
  assert.match(script, /API contracts Signal Pulse live render flag/);
  assert.match(script, /spec evidence markdown ID redaction/);
  assert.match(script, /spec evidence markdown UUID guard/);
  assert.match(script, /spec demographic taxonomy\/filter/);
  assert.match(script, /spec review queue gate/);
  assert.match(script, /spec review queue object/);
  assert.match(script, /spec review queue mutation endpoint/);
  assert.match(script, /spec tag review audit trail/);
  assert.match(script, /spec assertion review audit trail/);
  assert.match(script, /spec human review readiness/);
  assert.match(script, /spec client-visible review requirement/);
  assert.match(script, /staging runbook demographic tag gate/);
  assert.match(script, /staging runbook visibility checks/);
  assert.match(script, /staging runbook markdown evidence redaction/);
  assert.match(script, /staging runbook markdown UUID guard/);
  assert.match(script, /staging runbook review queue evidence/);
  assert.match(script, /staging runbook review queue mutation/);
  assert.match(script, /staging runbook human review readiness/);
  assert.match(script, /staging runbook client-visible review requirement/);
  assert.match(script, /staging runbook tag review event gate/);
  assert.match(script, /staging runbook assertion review event gate/);
  assert.match(script, /local smoke validator demographic tag gate/);
  assert.match(script, /local smoke validator visibility checks/);
  assert.match(script, /local smoke validator sensitive artifact scan/);
  assert.match(script, /local smoke validator repo-relative evidence path output/);
  assert.match(script, /local smoke validator review queue object/);
  assert.match(script, /local smoke validator serving review queue readiness/);
  assert.match(script, /local smoke validator serving review queue tag evidence count/);
  assert.match(script, /local smoke validator serving review queue assertion evidence count/);
  assert.match(script, /serving smoke review queue tag review event count/);
  assert.match(script, /serving smoke review queue assertion review event count/);
  assert.match(script, /evidence demographic tag count/);
  assert.match(script, /evidence tag review event count/);
  assert.match(script, /evidence review queue object/);
  assert.match(script, /evidence markdown review queue section/);
  assert.match(script, /evidence human review readiness/);
  assert.match(script, /evidence client-visible review requirement/);
  assert.match(script, /evidence assertion review event count/);
  assert.match(script, /evidence pack validator markdown review queue/);
  assert.match(script, /evidence pack validator review queue object/);
  assert.match(script, /smoke demographic tag count/);
  assert.match(script, /backfill demographic taxonomy\/rules/);
  assert.match(script, /backfill taxonomy-grouped feature values/);
  assert.match(script, /serving demographic filter normalization/);
  assert.match(script, /serving demographic corpus filter/);
  assert.match(script, /Pulse live output read authZ guard/);
  assert.match(script, /Pulse live visibility resolver/);
  assert.match(script, /Pulse live required visibility guard/);
  assert.match(script, /Pulse live route applies visibility/);
  assert.match(script, /Pulse live corpus route requires corpus visibility/);
  assert.match(script, /serving Pulse live visibility sanitizer/);
  assert.match(script, /serving Pulse live hidden section fallback/);
  assert.match(script, /serving Pulse internal dashboard refs filter/);
  assert.match(script, /Pulse page Data OS operations panel/);
  assert.match(script, /Pulse page Data OS review queue read/);
  assert.match(script, /Pulse page tag review event status/);
  assert.match(script, /Pulse page assertion review event status/);
  assert.match(script, /serving review queue API/);
  assert.match(script, /serving review queue readiness/);
  assert.match(script, /serving review queue mutation/);
  assert.match(script, /serving assertion review queue mutation/);
  assert.match(script, /serving tag review audit trail/);
  assert.match(script, /serving assertion review audit trail/);
  assert.match(script, /serving review action status map/);
  assert.match(script, /serving assertion action status map/);
  assert.match(script, /Data OS review queue POST handler/);
  assert.match(script, /Data OS review queue writes tag review events through serving layer/);
  assert.match(script, /Data OS review queue writes assertion review events through serving layer/);
  assert.match(script, /Data OS review queue POST validation/);
  assert.match(script, /optionalSearchParam/);
  assert.match(script, /period_id::text/);
  assert.match(script, /apps\/studio\/src\/lib\/queue\/data-os\.ts/);
  assert.match(script, /Studio Data OS queue enqueue helper/);
  assert.match(script, /packages\/query-engine\/src\/data-os\.ts/);
  assert.match(script, /Data OS allowed remote target contract/);
  assert.match(script, /Data OS remote target helper/);
  assert.match(script, /Data OS shared worker rejects production target test/);
  assert.match(script, /services\/workers\/src\/queues\/data-os\.ts/);
  assert.match(script, /services\/workers\/src\/workers\/data-os-shadow\.ts/);
  assert.match(script, /Data OS worker execution gate/);
  assert.match(script, /Data OS worker unscoped remote approval test/);
  assert.match(script, /Data OS worker shadow-run step/);
  assert.match(script, /Data OS worker analyze step/);
  assert.match(script, /Data OS worker analyze remote guard/);
  assert.match(script, /apps\/studio\/src\/app\/api\/data-os\/corpora\/\[id\]\/sources\/route\.ts/);
  assert.match(script, /apps\/studio\/src\/app\/api\/data-os\/corpora\/\[id\]\/brand-os\/route\.ts/);
  assert.match(script, /apps\/studio\/src\/app\/api\/data-os\/corpora\/\[id\]\/catalog\/route\.ts/);
  assert.match(script, /apps\/studio\/src\/app\/api\/data-os\/corpora\/\[id\]\/knowledge\/route\.ts/);
  assert.match(script, /apps\/studio\/src\/app\/api\/data-os\/corpora\/\[id\]\/lineage\/route\.ts/);
  assert.match(script, /apps\/studio\/src\/app\/api\/data-os\/corpora\/\[id\]\/review-queue\/route\.ts/);
  assert.match(script, /apps\/studio\/src\/app\/api\/data-os\/pulse\/\[outputId\]\/live\/route\.ts/);
  assert.match(script, /apps\/studio\/src\/app\/api\/data-os\/pulse\/\[outputId\]\/corpus\/route\.ts/);
  assert.match(script, /NOISIA_DATA_OS_VERIFY_DB/);
  assert.match(script, /NOISIA_DATA_OS_VERIFY_ALLOW_REMOTE/);
  assert.match(script, /NOISIA_DATA_OS_VERIFY_CORPUS_ID/);
  assert.match(script, /databaseUrlLooksProductionLike/);
  assert.match(script, /production-like environment markers/);
  assert.match(script, /requireSafeDatabaseWriteTarget\(databaseUrl/);

  for (const line of [
    "NOISIA_DATA_OS_ENABLED=false",
    "NOISIA_DATA_OS_BACKFILL_ENABLED=false",
    "NOISIA_DATA_OS_SERVING_ENABLED=false",
    "NOISIA_DATA_OS_TAGGING_ENABLED=false",
    "NOISIA_DATA_OS_SHADOW_MODE=true",
    "NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED=false",
    "NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED=false",
    "NOISIA_DATA_OS_WORKER_ENABLED=false",
    "NOISIA_DATA_OS_WORKER_RUNS_ENABLED=false",
    "NOISIA_DATA_OS_WORKER_REMOTE_APPROVED=false",
    "NOISIA_DATA_OS_WORKER_CONCURRENCY=1",
    "NOISIA_DATA_OS_QUEUE_NAME=",
    "NOISIA_DATA_OS_ANALYZE_ALLOW_REMOTE=false",
    "NOISIA_DATA_OS_BACKFILL_ALLOW_REMOTE=false",
    "NOISIA_DATA_OS_CANDIDATES_ALLOW_REMOTE=false",
    "NOISIA_DATA_OS_EVIDENCE_ALLOW_REMOTE=false",
    "NOISIA_DATA_OS_PREFLIGHT_ALLOW_REMOTE=false",
    "NOISIA_DATA_OS_PREFLIGHT_STRICT=false",
    "NOISIA_DATA_OS_SHADOW_ALLOW_REMOTE=false",
    "NOISIA_DATA_OS_SHADOW_STRICT=false",
    "NOISIA_DATA_OS_SHADOW_RUN_ENABLED=false",
    "NOISIA_DATA_OS_SHADOW_RUN_STRICT=true",
    "NOISIA_DATA_OS_SERVING_SMOKE_ALLOW_REMOTE=false",
    "NOISIA_DATA_OS_BACKFILL_CORPUS_ID=",
    "NOISIA_DATA_OS_SHADOW_OUTPUT_ID=",
    "NOISIA_DATA_OS_SERVING_SMOKE_CORPUS_ID=",
    "NOISIA_DATA_OS_SERVING_SMOKE_OUTPUT_ID=",
    "NOISIA_DATA_OS_STAGING_SHADOW_APPROVED=false",
    "NOISIA_DATA_OS_STAGING_SHADOW_APPLY_SCHEMA=false",
    "NOISIA_DATA_OS_STAGING_SHADOW_SKIP_CANDIDATES=false",
    "NOISIA_DATA_OS_EVIDENCE_PACK_DIR=",
    "NOISIA_DATA_OS_LOCAL_SMOKE_EVIDENCE_DIR=",
    "NOISIA_DATA_OS_STAGING_EVIDENCE_DIR=",
    "NOISIA_DATA_OS_SMOKE_ALLOW_REMOTE=false",
    "NOISIA_DATA_OS_VERIFY_DB=false",
    "NOISIA_DATA_OS_VERIFY_ALLOW_REMOTE=false",
    "NOISIA_REMOTE_DATABASE_TARGET=",
    "NOISIA_DB_APPLY_EXISTING_ALLOW_REMOTE=false"
  ]) {
    assert.match(envExample, new RegExp(line));
  }

  assert.match(gitignore, /^\.data$/m);
  assert.match(gitignore, /^\*\.log$/m);
  assert.match(gitignore, /^\.env\*$/m);
  assert.match(gitignore, /^!\.env\.example$/m);
  assert.match(gitignore, /^!\*\*\/\.env\.example$/m);
});

async function writeValidStagingEvidencePack(
  dir: string,
  databaseEnvironment = "remote_redacted",
  schemaApplyRequested = false
) {
  await writeFile(
    resolve(dir, "README.md"),
    [
      "# Noisia Data OS Staging Shadow Evidence",
      "Target: staging",
      `Schema apply requested: ${schemaApplyRequested ? "true" : "false"}`,
      "Candidates skipped: false",
      ...(schemaApplyRequested ? ["", "## apply-schema.log", "", "```bash", "corepack pnpm db:apply:existing", "```"] : []),
      "",
      "This directory is local evidence for PR/review and must not be committed."
    ].join("\n")
  );
  if (schemaApplyRequested) {
    await writeFile(resolve(dir, "apply-schema.log"), "Applied existing migrations for staging target.\n");
  }
  await writeFile(
    resolve(dir, "shadow-run.log"),
    JSON.stringify({
      ready_for_live_api_shadow: true,
      ready_for_live_switch: true,
      next_flags: {
        NOISIA_DATA_OS_ENABLED: "true",
        NOISIA_DATA_OS_SERVING_ENABLED: "true",
        NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED: "true",
        NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED: "false",
        NOISIA_DATA_OS_SHADOW_MODE: "true"
      }
    })
  );
  await writeFile(
    resolve(dir, "staging-check.txt"),
    [
      "Noisia Data OS staging environment check",
      "Values are intentionally redacted; this command only reports set/missing.",
      "",
      "LOCAL_DATA_OS_VERIFY=passed",
      "DATABASE_URL=set",
      "DATABASE_URL_FORMAT=postgres_url",
      `DATABASE_URL_ENVIRONMENT=${databaseEnvironment}`,
      "NOISIA_REMOTE_DATABASE_TARGET=staging",
      "NOISIA_DATA_OS_BACKFILL_CORPUS_ID=set",
      "NOISIA_DATA_OS_BACKFILL_CORPUS_ID_FORMAT=uuid",
      "NOISIA_DATA_OS_SHADOW_OUTPUT_ID=set",
      "NOISIA_DATA_OS_SHADOW_OUTPUT_ID_FORMAT=uuid",
      "NOISIA_DATA_OS_STAGING_SHADOW_APPROVED=true",
      "NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true",
      "NOISIA_DATA_OS_REVIEW_TAG_ID=set",
      "NOISIA_DATA_OS_REVIEW_TAG_ID_FORMAT=uuid",
      "NOISIA_DATA_OS_REVIEW_ASSERTION_ID=set",
      "NOISIA_DATA_OS_REVIEW_ASSERTION_ID_FORMAT=uuid",
      "release_gate_artifact=will_write:release-gate.json",
      "",
      "ready_for_staging_shadow=true"
    ].join("\n")
  );
  await writeFile(
    resolve(dir, "evidence.md"),
    [
      "# Noisia Data OS PR Evidence",
      "Output: Sample Signal Pulse (id redacted)",
      "Corpus: Sample Corpus (id redacted)",
      "Identifiers: redacted for PR; use local `evidence.json` in the `.data` evidence pack for audit only.",
      "Ready for PR review: true",
      "Ready for internal shadow: true",
      "",
      "## Architecture Decision",
      "",
      "Benchmark: `docs/product/24_NOISIA_DATA_OS_TECH_BENCHMARK.md`",
      "Product category: `customer_intelligence_lakehouse_cdp_like`",
      "Primary store Cut 1: `supabase_postgres_drizzle`",
      "CDP boundary: `not_customer_360_identity_resolution_or_reverse_etl`",
      "Serving contract: `live_apis_behind_flags_shadow_mode_with_published_outputs_payload_fallback`",
      "",
      "## Review Queue",
      "",
      "Ready for human review: true",
      "Required before client-visible activation: true",
      "Record tags with evidence: 32/32",
      "Record tags unreviewed: 32",
      "Low-confidence record tags: 8",
      "Tag taxonomies covered: 9",
      "Tag review events: 2",
      "Knowledge assertions with evidence: 9/9",
      "Candidate knowledge assertions: 9",
      "Knowledge assertion review events: 1"
    ].join("\n")
  );
  await writeFile(
    resolve(dir, "evidence.json"),
    JSON.stringify({
      ok: true,
      ready_for_pr_review: true,
      ready_for_internal_shadow: true,
      failures: [],
      warnings: [],
      architecture_decision: {
        benchmark_doc: "docs/product/24_NOISIA_DATA_OS_TECH_BENCHMARK.md",
        product_category: "customer_intelligence_lakehouse_cdp_like",
        primary_store_cut_1: "supabase_postgres_drizzle",
        cdp_boundary: "not_customer_360_identity_resolution_or_reverse_etl",
        serving_contract: "live_apis_behind_flags_shadow_mode_with_published_outputs_payload_fallback"
      },
      counts: {
        data_assets: 10,
        data_asset_fields: 65,
        data_assets_without_fields: 0,
        data_contracts: 10,
        data_quality_results: 10,
        data_quality_failed: 0,
        lineage_edges: 26,
        source_lineage_edges: 8,
        asset_lineage_edges: 7,
        dashboard_lineage_edges: 8,
        taxonomies: 13,
        tagging_rule_sets: 1,
        tagging_model_versions_with_rule_set: 1,
        record_tags: 32,
        record_tags_unreviewed: 32,
        record_tags_with_evidence: 32,
        record_tags_low_confidence: 8,
        record_tag_taxonomies: 9,
        tag_review_events: 2,
        record_feature_values: 2,
        brand_os_profiles: 1,
        brand_os_objectives: 1,
        brand_os_briefs: 2,
        brand_os_links: 4,
        knowledge_chunks: 1,
        knowledge_assertions: 9,
        knowledge_assertions_candidate: 9,
        knowledge_assertions_with_evidence: 9,
        knowledge_assertion_links: 9,
        knowledge_assertion_review_events: 1,
        knowledge_usage_events: 9,
        dashboard_refs_with_source_id: 4,
        dashboard_refs: 4
      },
      gates: {
        signal_pulse_output: true,
        corpus_match: true,
        live_signal_tables: true,
        data_catalog: true,
        quality_clean: true,
        lineage_present: true,
        taxonomy_catalog: true,
        tagging_present: true,
        tag_assertion_review_queue: true,
        brand_os_present: true,
        knowledge_catalog_linked: true,
        dashboard_refs_complete: true,
        live_payload_parity: true,
        payload_fallback_required: true
      },
      review_queue: {
        ready_for_human_review: true,
        required_before_client_visible: true,
        record_tags_total: 32,
        record_tags_with_evidence: 32,
        record_tags_unreviewed: 32,
        record_tags_low_confidence: 8,
        record_tag_taxonomies: 9,
        tag_review_events: 2,
        knowledge_assertions_total: 9,
        knowledge_assertions_candidate: 9,
        knowledge_assertions_with_evidence: 9,
        knowledge_assertion_review_events: 1,
        note: "Deterministic tags and candidate knowledge assertions must be sampled by a human before client-visible activation."
      },
      output: { status: "published" },
      next_flags: {
        NOISIA_DATA_OS_ENABLED: "true",
        NOISIA_DATA_OS_SERVING_ENABLED: "true",
        NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED: "true",
        NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED: "false",
        NOISIA_DATA_OS_SHADOW_MODE: "true"
      },
      rollback_flags: {
        NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED: "false",
        NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED: "false",
        NOISIA_DATA_OS_SERVING_ENABLED: "false",
        NOISIA_DATA_OS_ENABLED: "false",
        NOISIA_DATA_OS_SHADOW_MODE: "true"
      }
    })
  );
  await writeFile(
    resolve(dir, "analyze.json"),
    JSON.stringify({
      ok: true,
      operation: "data-os:analyze",
      ready_for_serving_reads: true,
      tables_analyzed: 34,
      analyzed_tables: ["data_assets", "record_tags", "lineage_edges", "dashboard_data_refs", "mentions", "brand_os_briefs"]
    })
  );
  await writeFile(
    resolve(dir, "serving-smoke.json"),
    JSON.stringify({
      ok: true,
      corpus_id: "set_redacted",
      output_id: "set_redacted",
      contains_sensitive_ids: false,
      ready_for_serving_shadow: true,
      failures: [],
      counts: {
        sources: 1,
        source_health_assets: 10,
        source_health_fields: 65,
        source_health_assets_without_fields: 0,
        source_health_failed: 0,
        catalog_assets: 10,
        catalog_fields: 65,
        catalog_contracts: 10,
        catalog_quality_results: 10,
        catalog_assets_without_fields: 0,
        catalog_failed_quality: 0,
        lineage_edges: 35,
        brand_os_profiles: 1,
        brand_os_objectives: 1,
        brand_os_briefs: 2,
        brand_os_links: 4,
        brand_os_seed_terms: 2,
        knowledge_sources: 1,
        knowledge_chunks: 1,
        knowledge_assertions: 9,
        knowledge_assertion_links: 9,
        knowledge_usage_events: 9,
        review_queue_tags: 25,
        review_queue_tag_taxonomies: 9,
        review_queue_tag_review_events: 2,
        review_queue_tags_with_evidence: 32,
        review_queue_assertions: 9,
        review_queue_assertion_review_events: 1,
        review_queue_assertions_with_evidence: 9,
        review_queue_ready_for_human_review: true,
        review_queue_required_before_client_visible: true,
        taxonomies: 13,
        tags: 25,
        periods: 1,
        signals: 1,
        payload_periods: 1,
        payload_signals: 1,
        payload_dashboard_refs: 4,
        live_payload_period_delta: 0,
        live_payload_signal_delta: 0,
        live_payload_dashboard_ref_delta: 0,
        live_behind_payload: false,
        dashboard_data_refs: 4
      },
      live_payload_parity: {
        live_behind_payload: false,
        live_counts: {
          dashboard_refs: 4,
          periods: 1,
          signals: 1
        },
        payload_counts: {
          dashboard_refs: 4,
          periods: 1,
          signals: 1
        },
        deltas: {
          dashboard_refs: 0,
          periods: 0,
          signals: 0
        }
      },
      fallback_checks: {
        data_os_disabled_status: 503,
        data_os_disabled_fallback: "published_outputs.payload",
        data_os_disabled_ready: true,
        signal_pulse_live_disabled_status: 503,
        signal_pulse_live_disabled_fallback: "published_outputs.payload",
        signal_pulse_live_disabled_ready: true
      },
      visibility_checks: {
        client_source_health_hidden: true,
        client_internal_dashboard_refs_hidden: true,
        internal_source_health_visible: true,
        internal_dashboard_refs_preserved: true
      }
    })
  );
  await writeFile(
    resolve(dir, "review-queue.json"),
    JSON.stringify({
      ok: true,
      corpus_id: "set_redacted",
      contains_sensitive_review_ids: false,
      contains_private_review_context: false,
      do_not_commit_or_paste_when_sensitive: false,
      summary: {
        record_tags_total: 32,
        record_tags_unreviewed: 32,
        record_tags_reviewed: 0,
        record_tags_with_evidence: 32,
        record_tag_taxonomies: 9,
        tag_review_events: 0,
        knowledge_assertions_candidate: 9,
        knowledge_assertions_with_evidence: 9,
        knowledge_assertion_review_events: 0,
        ready_for_human_review: true,
        required_before_client_visible: true
      },
      tags: [
        {
          confidence: "medium",
          evidence_count: 2,
          evidence_preview: "redacted_set_NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_CONTEXT_true_to_inspect_locally",
          id: "set_redacted",
          mention_platform: "TikTok",
          mention_preview: "redacted_set_NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_CONTEXT_true_to_inspect_locally",
          review_status: "unreviewed",
          source: "data_os_backfill_deterministic",
          taxonomy_key: "trigger",
          term_key: "trust",
          term_label: "Trust",
          value: "redacted_set_NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_CONTEXT_true_to_inspect_locally"
        }
      ],
      assertions: [
        {
          assertion_text: "redacted_set_NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_CONTEXT_true_to_inspect_locally",
          assertion_type: "brand_context",
          confidence: "medium",
          evidence_count: 1,
          evidence_preview: "redacted_set_NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_CONTEXT_true_to_inspect_locally",
          id: "set_redacted",
          knowledge_source_title: "redacted_set_NOISIA_DATA_OS_REVIEW_QUEUE_SHOW_CONTEXT_true_to_inspect_locally",
          link_count: 3,
          status: "candidate",
          usage_event_count: 1
        }
      ],
      suggested_exports: {
        NOISIA_DATA_OS_REVIEW_CORPUS_ID: "<study_corpus_id>",
        NOISIA_DATA_OS_REVIEW_TAG_ID: "<record_tag_id>",
        NOISIA_DATA_OS_REVIEW_ASSERTION_ID: "<knowledge_assertion_id>",
        NOISIA_DATA_OS_REVIEW_TAG_ACTION: "approve",
        NOISIA_DATA_OS_REVIEW_ASSERTION_ACTION: "approve",
        NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED: "true"
      },
      next_command: "corepack pnpm data-os:staging-finalize"
    })
  );
  await writeFile(
    resolve(dir, "review-sample.json"),
    JSON.stringify({
      ok: true,
      auto_selected_local: false,
      corpus_id: "set_redacted",
      human_review_sample: {
        tag: {
          action: "approve",
          confidence: "medium",
          evidence_count: 2,
          next_status: "approved",
          previous_status: "unreviewed",
          review_event_created: true,
          taxonomy_key: "trigger"
        },
        assertion: {
          action: "approve",
          assertion_type: "brand_context",
          confidence: "medium",
          evidence_count: 1,
          next_status: "active",
          previous_status: "candidate",
          review_event_created: true
        },
        reviewer_user_id: null
      },
      notes_present: true,
      ready_for_release_review_sample: true,
      summary_after: {
        knowledge_assertion_review_events: 1,
        record_tags_reviewed: 1,
        tag_review_events: 1
      }
    })
  );
  await writeFile(
    resolve(dir, "candidates.json"),
    JSON.stringify({
      ok: true,
      recommended: {
        ready_for_preflight: true,
        ready_for_backfill: true,
        ready_for_shadow_qa: true,
        failures: []
      }
    })
  );
}

async function rewriteStagingCheck(dir: string, rewrite: (contents: string) => string) {
  const filePath = resolve(dir, "staging-check.txt");
  const contents = await readFile(filePath, "utf8");
  await writeFile(filePath, rewrite(contents));
}

test("Data OS release gate accepts a validated staging evidence pack", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-data-os-release-"));

  try {
    await writeValidStagingEvidencePack(dir);

    const validationResult = await execFile(
      "corepack",
      ["pnpm", "exec", "tsx", "scripts/validate-data-os-evidence-pack.ts", dir],
      { cwd: process.cwd() }
    );
    await writeFile(resolve(dir, "evidence-pack-validation.json"), validationResult.stdout);

    const result = await execFile("corepack", ["pnpm", "exec", "tsx", "scripts/data-os-release-gate.ts", dir], {
      cwd: process.cwd()
    });
    const report = JSON.parse(result.stdout) as {
      database_environment: string;
      database_format: string;
      gates: string[];
      ok: boolean;
      ready_for_production_review: boolean;
      target: string;
    };
    assert.equal(report.ok, true);
    assert.equal(report.ready_for_production_review, true);
    assert.equal(report.target, "staging");
    assert.equal(report.database_environment, "remote_redacted");
    assert.equal(report.database_format, "postgres_url");
    assert.ok(report.gates.includes("artifact_manifest_current"));
    assert.ok(report.gates.includes("architecture_decision_confirmed"));
    assert.ok(report.gates.includes("tag_assertion_review_queue_ready"));
    assert.ok(report.gates.includes("human_review_sample_complete"));
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("Data OS PR summary emits paste-safe markdown from a validated staging evidence pack", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-data-os-pr-summary-"));

  try {
    await writeValidStagingEvidencePack(dir);

    const validationResult = await execFile(
      "corepack",
      ["pnpm", "exec", "tsx", "scripts/validate-data-os-evidence-pack.ts", dir],
      { cwd: process.cwd() }
    );
    await writeFile(resolve(dir, "evidence-pack-validation.json"), validationResult.stdout);

    const releaseResult = await execFile("corepack", ["pnpm", "exec", "tsx", "scripts/data-os-release-gate.ts", dir], {
      cwd: process.cwd()
    });
    await writeFile(resolve(dir, "release-gate.json"), releaseResult.stdout);

    const summaryResult = await execFile("corepack", ["pnpm", "exec", "tsx", "scripts/data-os-pr-summary.ts", dir], {
      cwd: process.cwd()
    });

    assert.match(summaryResult.stdout, /# Noisia Data OS PR Summary/);
    assert.match(summaryResult.stdout, /Evidence pack: `external_path_redacted`/);
    assert.match(summaryResult.stdout, /## PR-Safe Evidence/);
    assert.match(summaryResult.stdout, /Ready for PR review: true/);
    assert.match(summaryResult.stdout, /Database format: postgres_url/);
    assert.match(summaryResult.stdout, /Release gate: ready_for_production_review=true/);
    assert.match(summaryResult.stdout, /Release gates checked: .*database_format_postgres_url/);
    assert.match(summaryResult.stdout, /Release gates checked: .*local_data_os_verify_precheck/);
    assert.match(summaryResult.stdout, /Do not paste raw `shadow-run\.log`, `analyze\.json` or `evidence\.json`/);
    assert.doesNotMatch(
      summaryResult.stdout,
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
    );
    assert.doesNotMatch(summaryResult.stdout, /postgres(?:ql)?:\/\//i);
    assert.doesNotMatch(summaryResult.stdout, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("Data OS PR summary rejects production release gates without local verifier evidence", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-data-os-pr-summary-local-verify-"));

  try {
    await writeValidStagingEvidencePack(dir);

    const validationResult = await execFile(
      "corepack",
      ["pnpm", "exec", "tsx", "scripts/validate-data-os-evidence-pack.ts", dir],
      { cwd: process.cwd() }
    );
    await writeFile(resolve(dir, "evidence-pack-validation.json"), validationResult.stdout);

    const releaseResult = await execFile("corepack", ["pnpm", "exec", "tsx", "scripts/data-os-release-gate.ts", dir], {
      cwd: process.cwd()
    });
    const releaseGate = JSON.parse(releaseResult.stdout) as { gates?: string[] };
    releaseGate.gates = (releaseGate.gates ?? []).filter((gate) => gate !== "local_data_os_verify_precheck");
    await writeFile(resolve(dir, "release-gate.json"), JSON.stringify(releaseGate));

    await assert.rejects(
      execFile("corepack", ["pnpm", "exec", "tsx", "scripts/data-os-pr-summary.ts", dir], {
        cwd: process.cwd()
      }),
      /local_data_os_verify_precheck/
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("Data OS PR summary rejects production release gates without database format evidence", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-data-os-pr-summary-db-format-"));

  try {
    await writeValidStagingEvidencePack(dir);

    const validationResult = await execFile(
      "corepack",
      ["pnpm", "exec", "tsx", "scripts/validate-data-os-evidence-pack.ts", dir],
      { cwd: process.cwd() }
    );
    await writeFile(resolve(dir, "evidence-pack-validation.json"), validationResult.stdout);

    const releaseResult = await execFile("corepack", ["pnpm", "exec", "tsx", "scripts/data-os-release-gate.ts", dir], {
      cwd: process.cwd()
    });
    const releaseGate = JSON.parse(releaseResult.stdout) as { database_format?: string };
    delete releaseGate.database_format;
    await writeFile(resolve(dir, "release-gate.json"), JSON.stringify(releaseGate));

    await assert.rejects(
      execFile("corepack", ["pnpm", "exec", "tsx", "scripts/data-os-pr-summary.ts", dir], {
        cwd: process.cwd()
      }),
      /database_format=postgres_url/
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("Data OS completion audit only passes with a validated staging release gate and PR summary", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-data-os-completion-audit-"));

  try {
    const missingResult = await execFile("corepack", ["pnpm", "exec", "tsx", "scripts/data-os-completion-audit.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, NOISIA_DATA_OS_EVIDENCE_PACK_DIR: "" }
    });
    const missingReport = JSON.parse(missingResult.stdout) as {
      missing_evidence: string[];
      ready_for_goal_completion: boolean;
    };
    assert.equal(missingReport.ready_for_goal_completion, false);
    assert.ok(missingReport.missing_evidence.includes("NOISIA_DATA_OS_EVIDENCE_PACK_DIR or explicit evidence pack path"));

    await writeValidStagingEvidencePack(dir);

    const validationResult = await execFile(
      "corepack",
      ["pnpm", "exec", "tsx", "scripts/validate-data-os-evidence-pack.ts", dir],
      { cwd: process.cwd() }
    );
    await writeFile(resolve(dir, "evidence-pack-validation.json"), validationResult.stdout);

    const releaseResult = await execFile("corepack", ["pnpm", "exec", "tsx", "scripts/data-os-release-gate.ts", dir], {
      cwd: process.cwd()
    });
    await writeFile(resolve(dir, "release-gate.json"), releaseResult.stdout);

    const summaryResult = await execFile("corepack", ["pnpm", "exec", "tsx", "scripts/data-os-pr-summary.ts", dir], {
      cwd: process.cwd()
    });
    await writeFile(resolve(dir, "pr-summary.md"), summaryResult.stdout);

    const auditResult = await execFile("corepack", ["pnpm", "exec", "tsx", "scripts/data-os-completion-audit.ts", dir], {
      cwd: process.cwd()
    });
    const audit = JSON.parse(auditResult.stdout) as {
      completion_source: string;
      evidence_dir: string;
      missing_evidence: string[];
      pr_safe: boolean;
      ready_for_goal_completion: boolean;
      requirement_checks: Array<{
        evidence: string;
        ok: boolean;
        requirement: string;
      }>;
      sensitive_output_redacted: boolean;
    };
    assert.equal(audit.ready_for_goal_completion, true);
    assert.deepEqual(audit.missing_evidence, []);
    assert.ok(audit.requirement_checks.length >= 30);
    assert.ok(audit.requirement_checks.every((check) => check.ok === true));
    assert.ok(audit.requirement_checks.some((check) => check.requirement === "release-gate.data_catalog_quality_and_lineage"));
    assert.ok(audit.requirement_checks.some((check) => check.requirement === "release-gate.brand_os_and_knowledge_catalogs"));
    assert.ok(audit.requirement_checks.some((check) => check.requirement === "release-gate.human_review_sample_complete"));
    assert.ok(audit.requirement_checks.some((check) => check.requirement === "release-gate.serving_shadow_ready"));
    assert.ok(audit.requirement_checks.some((check) => check.requirement === "release-gate.local_data_os_verify_precheck"));
    assert.ok(audit.requirement_checks.some((check) => check.requirement === "release-gate.database_format_postgres_url"));
    assert.ok(audit.requirement_checks.some((check) => check.requirement === "release-gate.artifact_manifest_current"));
    assert.ok(audit.requirement_checks.some((check) => check.requirement === "pr-summary release gates checked"));
    assert.ok(audit.requirement_checks.some((check) => check.requirement === "pr-summary local verifier gate"));
    assert.ok(audit.requirement_checks.some((check) => check.requirement === "pr-summary database format"));
    assert.equal(audit.completion_source, "docs/product/26_NOISIA_DATA_OS_COMPLETION_AUDIT.md");
    assert.equal(audit.evidence_dir, "external_path_redacted");
    assert.equal(audit.pr_safe, true);
    assert.equal(audit.sensitive_output_redacted, true);
    assert.doesNotMatch(auditResult.stdout, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("Data OS completion audit rejects stale PR summaries without release gate details", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-data-os-stale-pr-summary-"));

  try {
    await writeValidStagingEvidencePack(dir);

    const validationResult = await execFile(
      "corepack",
      ["pnpm", "exec", "tsx", "scripts/validate-data-os-evidence-pack.ts", dir],
      { cwd: process.cwd() }
    );
    await writeFile(resolve(dir, "evidence-pack-validation.json"), validationResult.stdout);

    const releaseResult = await execFile("corepack", ["pnpm", "exec", "tsx", "scripts/data-os-release-gate.ts", dir], {
      cwd: process.cwd()
    });
    await writeFile(resolve(dir, "release-gate.json"), releaseResult.stdout);

    const summaryResult = await execFile("corepack", ["pnpm", "exec", "tsx", "scripts/data-os-pr-summary.ts", dir], {
      cwd: process.cwd()
    });
    await writeFile(
      resolve(dir, "pr-summary.md"),
      summaryResult.stdout.replace("local_data_os_verify_precheck", "stale_summary_missing_local_verifier")
    );

    const auditResult = await execFile("corepack", ["pnpm", "exec", "tsx", "scripts/data-os-completion-audit.ts", dir], {
      cwd: process.cwd()
    });
    const audit = JSON.parse(auditResult.stdout) as {
      missing_evidence: string[];
      ready_for_goal_completion: boolean;
    };

    assert.equal(audit.ready_for_goal_completion, false);
    assert.ok(audit.missing_evidence.includes("pr-summary local verifier gate"));
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("Data OS completion audit rejects stale PR summaries without database format details", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-data-os-stale-pr-summary-db-format-"));

  try {
    await writeValidStagingEvidencePack(dir);

    const validationResult = await execFile(
      "corepack",
      ["pnpm", "exec", "tsx", "scripts/validate-data-os-evidence-pack.ts", dir],
      { cwd: process.cwd() }
    );
    await writeFile(resolve(dir, "evidence-pack-validation.json"), validationResult.stdout);

    const releaseResult = await execFile("corepack", ["pnpm", "exec", "tsx", "scripts/data-os-release-gate.ts", dir], {
      cwd: process.cwd()
    });
    await writeFile(resolve(dir, "release-gate.json"), releaseResult.stdout);

    const summaryResult = await execFile("corepack", ["pnpm", "exec", "tsx", "scripts/data-os-pr-summary.ts", dir], {
      cwd: process.cwd()
    });
    await writeFile(
      resolve(dir, "pr-summary.md"),
      summaryResult.stdout.replace(/^Database format: postgres_url\n/m, "")
    );

    const auditResult = await execFile("corepack", ["pnpm", "exec", "tsx", "scripts/data-os-completion-audit.ts", dir], {
      cwd: process.cwd()
    });
    const audit = JSON.parse(auditResult.stdout) as {
      missing_evidence: string[];
      ready_for_goal_completion: boolean;
    };

    assert.equal(audit.ready_for_goal_completion, false);
    assert.ok(audit.missing_evidence.includes("pr-summary database format"));
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("Data OS evidence pack validator keeps Signal Pulse live render disabled during shadow rollout", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-data-os-render-flag-"));

  try {
    await writeValidStagingEvidencePack(dir);
    const shadowRunPath = resolve(dir, "shadow-run.log");
    const shadowRun = JSON.parse(await readFile(shadowRunPath, "utf8")) as {
      next_flags?: Record<string, string>;
    };
    await writeFile(
      shadowRunPath,
      JSON.stringify({
        ...shadowRun,
        next_flags: {
          ...shadowRun.next_flags,
          NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED: "true"
        }
      })
    );

    await assert.rejects(
      execFile("corepack", ["pnpm", "exec", "tsx", "scripts/validate-data-os-evidence-pack.ts", dir], {
        cwd: process.cwd()
      }),
      /NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED=false/
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("Data OS evidence pack validator rejects UUIDs in README summaries", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-data-os-readme-id-leak-"));

  try {
    await writeValidStagingEvidencePack(dir);
    await writeFile(
      resolve(dir, "README.md"),
      [
        "# Noisia Data OS Staging Shadow Evidence",
        "Target: staging",
        "Schema apply requested: false",
        "Candidates skipped: false",
        "Corpus: 123e4567-e89b-42d3-a456-426614174000",
        "Output: set (redacted)",
        "",
        "This directory is local evidence for PR/review and must not be committed."
      ].join("\n")
    );

    await assert.rejects(
      execFile("corepack", ["pnpm", "exec", "tsx", "scripts/validate-data-os-evidence-pack.ts", dir], {
        cwd: process.cwd()
      }),
      /README\.md must not include corpus or output UUID values/
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("Data OS evidence pack validator rejects staging packs without human review precheck", async () => {
  const cases = [
    {
      expected: /NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true for release evidence/,
      label: "missing-review-approval",
      rewrite: (contents: string) => contents.replace("NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true\n", "")
    },
    {
      expected: /NOISIA_DATA_OS_REVIEW_TAG_ID_FORMAT=uuid/,
      label: "missing-review-tag-id-format",
      rewrite: (contents: string) => contents.replace("NOISIA_DATA_OS_REVIEW_TAG_ID_FORMAT=uuid\n", "")
    },
    {
      expected: /NOISIA_DATA_OS_REVIEW_ASSERTION_ID_FORMAT=uuid/,
      label: "missing-review-assertion-id-format",
      rewrite: (contents: string) => contents.replace("NOISIA_DATA_OS_REVIEW_ASSERTION_ID_FORMAT=uuid\n", "")
    }
  ];

  for (const testCase of cases) {
    const dir = await mkdtemp(resolve(tmpdir(), `noisia-data-os-${testCase.label}-`));

    try {
      await writeValidStagingEvidencePack(dir);
      await rewriteStagingCheck(dir, testCase.rewrite);

      await assert.rejects(
        execFile("corepack", ["pnpm", "exec", "tsx", "scripts/validate-data-os-evidence-pack.ts", dir], {
          cwd: process.cwd()
        }),
        testCase.expected
      );
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  }
});

test("Data OS evidence pack validator rejects staging packs without local verifier precheck", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-data-os-local-verify-precheck-"));

  try {
    await writeValidStagingEvidencePack(dir);
    await rewriteStagingCheck(dir, (contents) => contents.replace("LOCAL_DATA_OS_VERIFY=passed\n", ""));

    await assert.rejects(
      execFile("corepack", ["pnpm", "exec", "tsx", "scripts/validate-data-os-evidence-pack.ts", dir], {
        cwd: process.cwd()
      }),
      /LOCAL_DATA_OS_VERIFY=passed/
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("Data OS release gate rejects staging evidence without review ID precheck", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-data-os-release-review-precheck-"));

  try {
    await writeValidStagingEvidencePack(dir);

    const validationResult = await execFile(
      "corepack",
      ["pnpm", "exec", "tsx", "scripts/validate-data-os-evidence-pack.ts", dir],
      { cwd: process.cwd() }
    );
    await writeFile(resolve(dir, "evidence-pack-validation.json"), validationResult.stdout);
    await rewriteStagingCheck(dir, (contents) => contents.replace("NOISIA_DATA_OS_REVIEW_TAG_ID_FORMAT=uuid\n", ""));

    await assert.rejects(
      execFile("corepack", ["pnpm", "exec", "tsx", "scripts/data-os-release-gate.ts", dir], {
        cwd: process.cwd()
      }),
      /NOISIA_DATA_OS_REVIEW_TAG_ID_FORMAT=uuid/
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("Data OS evidence pack validator rejects unredacted review queue artifacts", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-data-os-review-queue-leak-"));

  try {
    await writeValidStagingEvidencePack(dir);
    await writeFile(
      resolve(dir, "review-queue.json"),
      JSON.stringify({
        ok: true,
        corpus_id: "123e4567-e89b-42d3-a456-426614174000",
        contains_sensitive_review_ids: true,
        contains_private_review_context: true,
        do_not_commit_or_paste_when_sensitive: true,
        summary: {
          ready_for_human_review: true,
          required_before_client_visible: true
        },
        tags: [],
        assertions: []
      })
    );

    await assert.rejects(
      execFile("corepack", ["pnpm", "exec", "tsx", "scripts/validate-data-os-evidence-pack.ts", dir], {
        cwd: process.cwd()
      }),
      /review-queue\.json must redact corpus_id|review-queue\.json must not contain sensitive review IDs|review-queue\.json must not include corpus, tag or assertion UUID values/
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("Data OS evidence pack validator rejects unredacted serving smoke artifacts", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-data-os-serving-smoke-leak-"));

  try {
    await writeValidStagingEvidencePack(dir);
    const servingSmoke = JSON.parse(await readFile(resolve(dir, "serving-smoke.json"), "utf8")) as Record<
      string,
      unknown
    >;
    servingSmoke.corpus_id = "123e4567-e89b-42d3-a456-426614174000";
    servingSmoke.output_id = "123e4567-e89b-42d3-a456-426614174001";
    servingSmoke.contains_sensitive_ids = true;
    await writeFile(resolve(dir, "serving-smoke.json"), JSON.stringify(servingSmoke));

    await assert.rejects(
      execFile("corepack", ["pnpm", "exec", "tsx", "scripts/validate-data-os-evidence-pack.ts", dir], {
        cwd: process.cwd()
      }),
      /serving-smoke\.json must redact corpus_id|serving-smoke\.json must not contain sensitive IDs|serving-smoke\.json must not include corpus or output UUID values/
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("Data OS release gate tracks schema apply log when requested", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-data-os-schema-apply-"));

  try {
    await writeValidStagingEvidencePack(dir, "remote_redacted", true);

    const validationResult = await execFile(
      "corepack",
      ["pnpm", "exec", "tsx", "scripts/validate-data-os-evidence-pack.ts", dir],
      { cwd: process.cwd() }
    );
    const report = JSON.parse(validationResult.stdout) as {
      artifact_manifest: { file: string }[];
      checked_files: string[];
      database_format: string;
      ok: boolean;
      ready_for_release_gate: boolean;
    };

    assert.equal(report.ok, true);
    assert.equal(report.ready_for_release_gate, true);
    assert.equal(report.database_format, "postgres_url");
    assert.ok(report.checked_files.includes("apply-schema.log"));
    assert.ok(report.artifact_manifest.some((artifact) => artifact.file === "apply-schema.log"));

    await writeFile(resolve(dir, "evidence-pack-validation.json"), validationResult.stdout);
    const result = await execFile("corepack", ["pnpm", "exec", "tsx", "scripts/data-os-release-gate.ts", dir], {
      cwd: process.cwd()
    });
    const releaseReport = JSON.parse(result.stdout) as {
      ok: boolean;
      ready_for_production_review: boolean;
    };
    assert.equal(releaseReport.ok, true);
    assert.equal(releaseReport.ready_for_production_review, true);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("Data OS evidence pack validator rejects missing schema apply log when requested", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-data-os-missing-schema-apply-"));

  try {
    await writeValidStagingEvidencePack(dir, "remote_redacted", true);
    await rm(resolve(dir, "apply-schema.log"));

    await assert.rejects(
      execFile("corepack", ["pnpm", "exec", "tsx", "scripts/validate-data-os-evidence-pack.ts", dir], {
        cwd: process.cwd()
      }),
      /Missing evidence artifact: apply-schema\.log/
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("Data OS evidence pack validator rejects missing human review sample artifact", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-data-os-missing-review-sample-"));

  try {
    await writeValidStagingEvidencePack(dir);
    await rm(resolve(dir, "review-sample.json"));

    await assert.rejects(
      execFile("corepack", ["pnpm", "exec", "tsx", "scripts/validate-data-os-evidence-pack.ts", dir], {
        cwd: process.cwd()
      }),
      /Missing evidence artifact: review-sample\.json/
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("Data OS release gate rejects evidence artifacts changed after validation", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-data-os-tampered-evidence-"));

  try {
    await writeValidStagingEvidencePack(dir);

    const validationResult = await execFile(
      "corepack",
      ["pnpm", "exec", "tsx", "scripts/validate-data-os-evidence-pack.ts", dir],
      { cwd: process.cwd() }
    );
    await writeFile(resolve(dir, "evidence-pack-validation.json"), validationResult.stdout);
    await writeFile(
      resolve(dir, "evidence.md"),
      "Ready for PR review: true\nReady for internal shadow: true\n\nReviewed after validation.\n"
    );

    await assert.rejects(
      execFile("corepack", ["pnpm", "exec", "tsx", "scripts/data-os-release-gate.ts", dir], {
        cwd: process.cwd()
      }),
      /evidence\.md (byte length|checksum) changed after evidence-pack-validation\.json was generated/
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("Data OS release gate rejects local database evidence mislabeled as staging", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-data-os-local-staging-"));

  try {
    await writeValidStagingEvidencePack(dir, "local_redacted");

    await assert.rejects(
      execFile("corepack", ["pnpm", "exec", "tsx", "scripts/validate-data-os-evidence-pack.ts", dir], {
        cwd: process.cwd()
      }),
      /staging evidence must come from DATABASE_URL_ENVIRONMENT=remote_redacted/
    );

    await writeFile(
      resolve(dir, "evidence-pack-validation.json"),
      JSON.stringify({
        ok: true,
        ready_for_pr_review: true,
        ready_for_internal_shadow: true,
        ready_for_release_gate: true,
        target: "staging",
        database_environment: "local_redacted",
        evidence_dir: dir,
        candidates_checked: true,
        checked_files: [
          "README.md",
          "candidates.json",
          "staging-check.txt",
          "shadow-run.log",
          "analyze.json",
          "serving-smoke.json",
          "review-queue.json",
          "review-sample.json",
          "evidence.json",
          "evidence.md"
        ]
      })
    );

    await assert.rejects(
      execFile("corepack", ["pnpm", "exec", "tsx", "scripts/data-os-release-gate.ts", dir], {
        cwd: process.cwd()
      }),
      /Release gate requires DATABASE_URL_ENVIRONMENT=remote_redacted/
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("Data OS evidence gates reject staging checks without database URL format proof", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-data-os-missing-db-format-"));

  try {
    await writeValidStagingEvidencePack(dir);
    const stagingCheck = await readFile(resolve(dir, "staging-check.txt"), "utf8");
    await writeFile(resolve(dir, "staging-check.txt"), stagingCheck.replace("DATABASE_URL_FORMAT=postgres_url\n", ""));

    await assert.rejects(
      execFile("corepack", ["pnpm", "exec", "tsx", "scripts/validate-data-os-evidence-pack.ts", dir], {
        cwd: process.cwd()
      }),
      /staging-check\.txt must include DATABASE_URL_FORMAT=postgres_url/
    );

    await writeFile(
      resolve(dir, "evidence-pack-validation.json"),
      JSON.stringify({
        ok: true,
        ready_for_pr_review: true,
        ready_for_internal_shadow: true,
        ready_for_release_gate: true,
        target: "staging",
        database_environment: "remote_redacted",
        evidence_dir: dir,
        candidates_checked: true,
        checked_files: [
          "README.md",
          "candidates.json",
          "staging-check.txt",
          "shadow-run.log",
          "analyze.json",
          "serving-smoke.json",
          "review-queue.json",
          "review-sample.json",
          "evidence.json",
          "evidence.md"
        ]
      })
    );

    await assert.rejects(
      execFile("corepack", ["pnpm", "exec", "tsx", "scripts/data-os-release-gate.ts", dir], {
        cwd: process.cwd()
      }),
      /staging-check\.txt must include DATABASE_URL_FORMAT=postgres_url/
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("Data OS evidence pack validator rejects leaked database URLs in artifacts", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-data-os-leak-"));

  try {
    await writeFile(
      resolve(dir, "README.md"),
      [
        "# Noisia Data OS Staging Shadow Evidence",
        "Target: staging",
        "Candidates skipped: true",
        "",
        "This directory is local evidence for PR/review and must not be committed."
      ].join("\n")
    );
    await writeFile(
      resolve(dir, "staging-check.txt"),
      [
        "Noisia Data OS staging environment check",
        "Values are intentionally redacted; this command only reports set/missing.",
        "",
        "DATABASE_URL=set",
        "DATABASE_URL_FORMAT=postgres_url",
        "DATABASE_URL_ENVIRONMENT=remote_redacted",
        "NOISIA_REMOTE_DATABASE_TARGET=staging",
        "LOCAL_DATA_OS_VERIFY=passed",
        "NOISIA_DATA_OS_BACKFILL_CORPUS_ID=set",
        "NOISIA_DATA_OS_BACKFILL_CORPUS_ID_FORMAT=uuid",
        "NOISIA_DATA_OS_SHADOW_OUTPUT_ID=set",
        "NOISIA_DATA_OS_SHADOW_OUTPUT_ID_FORMAT=uuid",
        "NOISIA_DATA_OS_STAGING_SHADOW_APPROVED=true",
        "NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true",
        "NOISIA_DATA_OS_REVIEW_TAG_ID=set",
        "NOISIA_DATA_OS_REVIEW_TAG_ID_FORMAT=uuid",
        "NOISIA_DATA_OS_REVIEW_ASSERTION_ID=set",
        "NOISIA_DATA_OS_REVIEW_ASSERTION_ID_FORMAT=uuid",
        "",
        "ready_for_staging_shadow=true"
      ].join("\n")
    );
    await writeFile(resolve(dir, "shadow-run.log"), "leaked postgres://user:pass@db.example.com:5432/noisia_staging");
    await writeFile(resolve(dir, "analyze.json"), "{}");
    await writeFile(resolve(dir, "serving-smoke.json"), "{}");
    await writeFile(resolve(dir, "review-queue.json"), "{}");
    await writeFile(
      resolve(dir, "review-sample.json"),
      JSON.stringify({
        ok: true,
        human_review_sample: {
          tag: { evidence_count: 1, review_event_created: true },
          assertion: { evidence_count: 1, review_event_created: true }
        },
        ready_for_release_review_sample: true
      })
    );
    await writeFile(resolve(dir, "evidence.json"), "{}");
    await writeFile(resolve(dir, "evidence.md"), "");

    await assert.rejects(
      execFile("corepack", ["pnpm", "exec", "tsx", "scripts/validate-data-os-evidence-pack.ts", dir], {
        cwd: process.cwd()
      }),
      /shadow-run\.log must not include a database URL/
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("Data OS evidence pack validator rejects leaked API keys in artifacts", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-data-os-secret-leak-"));

  try {
    await writeFile(
      resolve(dir, "README.md"),
      [
        "# Noisia Data OS Staging Shadow Evidence",
        "Target: staging",
        "Candidates skipped: true",
        "",
        "This directory is local evidence for PR/review and must not be committed."
      ].join("\n")
    );
    await writeFile(
      resolve(dir, "staging-check.txt"),
      [
        "Noisia Data OS staging environment check",
        "Values are intentionally redacted; this command only reports set/missing.",
        "",
        "DATABASE_URL=set",
        "DATABASE_URL_FORMAT=postgres_url",
        "DATABASE_URL_ENVIRONMENT=remote_redacted",
        "NOISIA_REMOTE_DATABASE_TARGET=staging",
        "LOCAL_DATA_OS_VERIFY=passed",
        "NOISIA_DATA_OS_BACKFILL_CORPUS_ID=set",
        "NOISIA_DATA_OS_BACKFILL_CORPUS_ID_FORMAT=uuid",
        "NOISIA_DATA_OS_SHADOW_OUTPUT_ID=set",
        "NOISIA_DATA_OS_SHADOW_OUTPUT_ID_FORMAT=uuid",
        "NOISIA_DATA_OS_STAGING_SHADOW_APPROVED=true",
        "NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true",
        "NOISIA_DATA_OS_REVIEW_TAG_ID=set",
        "NOISIA_DATA_OS_REVIEW_TAG_ID_FORMAT=uuid",
        "NOISIA_DATA_OS_REVIEW_ASSERTION_ID=set",
        "NOISIA_DATA_OS_REVIEW_ASSERTION_ID_FORMAT=uuid",
        "",
        "ready_for_staging_shadow=true"
      ].join("\n")
    );
    await writeFile(resolve(dir, "shadow-run.log"), "{}");
    await writeFile(resolve(dir, "analyze.json"), "{}");
    await writeFile(resolve(dir, "serving-smoke.json"), "{}");
    await writeFile(resolve(dir, "review-queue.json"), "{}");
    await writeFile(
      resolve(dir, "review-sample.json"),
      JSON.stringify({
        ok: true,
        human_review_sample: {
          tag: { evidence_count: 1, review_event_created: true },
          assertion: { evidence_count: 1, review_event_created: true }
        },
        ready_for_release_review_sample: true
      })
    );
    await writeFile(resolve(dir, "evidence.json"), "{}");
    const syntheticOpenAiKey = ["sk", "proj", "1234567890abcdefghijklmnopqrstuv"].join("-");
    await writeFile(resolve(dir, "evidence.md"), `OPENAI_API_KEY=${syntheticOpenAiKey}`);

    await assert.rejects(
      execFile("corepack", ["pnpm", "exec", "tsx", "scripts/validate-data-os-evidence-pack.ts", dir], {
        cwd: process.cwd()
      }),
      /evidence\.md must not include OpenAI API key/
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("Data OS evidence pack validator rejects UUIDs in PR-ready markdown", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-data-os-pr-id-leak-"));

  try {
    await writeFile(
      resolve(dir, "README.md"),
      [
        "# Noisia Data OS Staging Shadow Evidence",
        "Target: staging",
        "Candidates skipped: true",
        "",
        "This directory is local evidence for PR/review and must not be committed."
      ].join("\n")
    );
    await writeFile(
      resolve(dir, "staging-check.txt"),
      [
        "Noisia Data OS staging environment check",
        "Values are intentionally redacted; this command only reports set/missing.",
        "",
        "DATABASE_URL=set",
        "DATABASE_URL_FORMAT=postgres_url",
        "DATABASE_URL_ENVIRONMENT=remote_redacted",
        "NOISIA_REMOTE_DATABASE_TARGET=staging",
        "LOCAL_DATA_OS_VERIFY=passed",
        "NOISIA_DATA_OS_BACKFILL_CORPUS_ID=set",
        "NOISIA_DATA_OS_BACKFILL_CORPUS_ID_FORMAT=uuid",
        "NOISIA_DATA_OS_SHADOW_OUTPUT_ID=set",
        "NOISIA_DATA_OS_SHADOW_OUTPUT_ID_FORMAT=uuid",
        "NOISIA_DATA_OS_STAGING_SHADOW_APPROVED=true",
        "NOISIA_DATA_OS_REVIEW_SAMPLE_APPROVED=true",
        "NOISIA_DATA_OS_REVIEW_TAG_ID=set",
        "NOISIA_DATA_OS_REVIEW_TAG_ID_FORMAT=uuid",
        "NOISIA_DATA_OS_REVIEW_ASSERTION_ID=set",
        "NOISIA_DATA_OS_REVIEW_ASSERTION_ID_FORMAT=uuid",
        "",
        "ready_for_staging_shadow=true"
      ].join("\n")
    );
    await writeFile(
      resolve(dir, "shadow-run.log"),
      JSON.stringify({
        ready_for_live_api_shadow: true,
        ready_for_live_switch: true,
        next_flags: {
          NOISIA_DATA_OS_ENABLED: "true",
          NOISIA_DATA_OS_SERVING_ENABLED: "true",
          NOISIA_SIGNAL_PULSE_LIVE_API_ENABLED: "true",
          NOISIA_SIGNAL_PULSE_LIVE_RENDER_ENABLED: "false",
          NOISIA_DATA_OS_SHADOW_MODE: "true"
        }
      })
    );
    await writeFile(resolve(dir, "analyze.json"), "{}");
    await writeFile(resolve(dir, "serving-smoke.json"), "{}");
    await writeFile(resolve(dir, "review-queue.json"), "{}");
    await writeFile(
      resolve(dir, "review-sample.json"),
      JSON.stringify({
        ok: true,
        human_review_sample: {
          tag: { evidence_count: 1, review_event_created: true },
          assertion: { evidence_count: 1, review_event_created: true }
        },
        ready_for_release_review_sample: true
      })
    );
    await writeFile(resolve(dir, "evidence.json"), "{}");
    await writeFile(
      resolve(dir, "evidence.md"),
      [
        "Ready for PR review: true",
        "Ready for internal shadow: true",
        "Identifiers: redacted for PR",
        "",
        "## Architecture Decision",
        "",
        "Benchmark: `docs/product/24_NOISIA_DATA_OS_TECH_BENCHMARK.md`",
        "Product category: `customer_intelligence_lakehouse_cdp_like`",
        "Primary store Cut 1: `supabase_postgres_drizzle`",
        "CDP boundary: `not_customer_360_identity_resolution_or_reverse_etl`",
        "Serving contract: `live_apis_behind_flags_shadow_mode_with_published_outputs_payload_fallback`",
        "",
        "## Review Queue",
        "",
        "Ready for human review: true",
        "Required before client-visible activation: true",
        "Output: Sample (123e4567-e89b-42d3-a456-426614174000)"
      ].join("\n")
    );

    await assert.rejects(
      execFile("corepack", ["pnpm", "exec", "tsx", "scripts/validate-data-os-evidence-pack.ts", dir], {
        cwd: process.cwd()
      }),
      /evidence\.md must not include corpus or output UUID values/
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("Data OS local smoke validator rejects leaked database URLs in artifacts", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-data-os-local-leak-"));

  try {
    await writeFile(
      resolve(dir, "README.md"),
      [
        "# Noisia Data OS Local Smoke Evidence",
        "Target: local disposable Postgres",
        "",
        "This is synthetic local preflight evidence.",
        "It does not replace the staging/preview evidence pack required by data-os:release-gate.",
        "This directory lives under .data by default and must not be committed."
      ].join("\n")
    );
    await writeFile(resolve(dir, "migrations.log"), "leaked postgres://user:pass@localhost:5432/noisia_smoke");
    await writeFile(resolve(dir, "smoke.log"), "");
    await writeFile(resolve(dir, "shadow-run.log"), "");
    await writeFile(resolve(dir, "analyze.json"), "{}");
    await writeFile(resolve(dir, "review-queue.json"), "{}");
    await writeFile(resolve(dir, "review-sample.json"), "{}");
    await writeFile(resolve(dir, "evidence.json"), "{}");
    await writeFile(resolve(dir, "serving-smoke.json"), "{}");

    await assert.rejects(
      execFile("corepack", ["pnpm", "exec", "tsx", "scripts/validate-data-os-local-smoke.ts", dir], {
        cwd: process.cwd()
      }),
      /migrations\.log must not include a database URL/
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("Data OS local smoke validator rejects leaked secret env values in artifacts", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "noisia-data-os-local-secret-leak-"));

  try {
    await writeFile(
      resolve(dir, "README.md"),
      [
        "# Noisia Data OS Local Smoke Evidence",
        "Target: local disposable Postgres",
        "",
        "This is synthetic local preflight evidence.",
        "It does not replace the staging/preview evidence pack required by data-os:release-gate.",
        "This directory lives under .data by default and must not be committed."
      ].join("\n")
    );
    await writeFile(resolve(dir, "migrations.log"), "ok");
    const syntheticAnthropicKey = ["sk", "ant", "1234567890abcdefghijklmnopqrstuv"].join("-");
    await writeFile(resolve(dir, "smoke.log"), `ANTHROPIC_API_KEY=${syntheticAnthropicKey}`);
    await writeFile(resolve(dir, "shadow-run.log"), "");
    await writeFile(resolve(dir, "analyze.json"), "{}");
    await writeFile(resolve(dir, "review-queue.json"), "{}");
    await writeFile(resolve(dir, "review-sample.json"), "{}");
    await writeFile(resolve(dir, "evidence.json"), "{}");
    await writeFile(resolve(dir, "serving-smoke.json"), "{}");

    await assert.rejects(
      execFile("corepack", ["pnpm", "exec", "tsx", "scripts/validate-data-os-local-smoke.ts", dir], {
        cwd: process.cwd()
      }),
      /smoke\.log must not include OpenAI API key|smoke\.log must not include secret environment value/
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const migrationsDir = resolve(process.cwd(), "migrations");

async function migration(tag: string) {
  return readFile(resolve(migrationsDir, `${tag}.sql`), "utf8");
}

test("live intelligence migrations are journaled in order", async () => {
  const journal = JSON.parse(await readFile(resolve(migrationsDir, "meta/_journal.json"), "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const tail = journal.entries.slice(-9).map((entry) => ({ idx: entry.idx, tag: entry.tag }));

  assert.deepEqual(tail, [
    { idx: 25, tag: "0025_engine_methodologies" },
    { idx: 26, tag: "0026_live_intelligence_store" },
    { idx: 27, tag: "0027_query_pack_provenance_backfill" },
    { idx: 28, tag: "0028_signal_observation_run_uniqueness" },
    { idx: 29, tag: "0029_engine_cost_ledger" },
    { idx: 30, tag: "0030_monthly_cut_and_composer" },
    { idx: 31, tag: "0031_study_analysis_plan" },
    { idx: 32, tag: "0032_import_batch_query_pack_link" },
    { idx: 33, tag: "0033_engine_run_mention_map" }
  ]);
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
    await migration("0033_engine_run_mention_map")
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
  assert.match(migrations, /ADD COLUMN IF NOT EXISTS "analysis_plan"/);
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

  assert.match(compose, /postgres-smoke:/);
  assert.match(compose, /image: pgvector\/pgvector:pg16/);
  assert.match(compose, /"55432:5432"/);
  assert.equal(rootPackage.scripts?.["db:smoke:local"], "pnpm --filter @noisia/db db:smoke:local");
  assert.equal(dbPackage.scripts?.["db:smoke:local"], "tsx scripts/smoke-local.ts");
});

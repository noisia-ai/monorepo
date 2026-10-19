import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import pg from "pg";

const execFileAsync = promisify(execFile);
const DATABASE_URL_ENV = "NOISIA_SIGNAL_SEMANTIC_SCOPE_RUNNER_INTEGRATION_URL";
const APPROVAL_ENV = "NOISIA_SIGNAL_SEMANTIC_SCOPE_RUNNER_INTEGRATION_APPROVED";
const dbRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationDir = join(dbRoot, "migrations");
const legacyRunner = join(dbRoot, "scripts", "apply-signal-workspace-data-plane-migration.ts");
const semanticRunner = join(dbRoot, "scripts", "apply-signal-semantic-scope-migration.ts");

function integrationUrl() {
  const value = process.env[DATABASE_URL_ENV]?.trim();
  if (!value || process.env[APPROVAL_ENV] !== "true") return null;
  const parsed = new URL(value);
  assert.ok(new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname));
  assert.match(parsed.pathname, /(runner|smoke|throwaway)/u);
  return value;
}

async function resetThrough0058(databaseUrl: string) {
  const client = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const files = (await readdir(migrationDir))
      .filter((file) => /^\d{4}_.+\.sql$/u.test(file) && Number(file.slice(0, 4)) <= 58)
      .sort();
    for (const file of files) {
      await client.query(await readFile(join(migrationDir, file), "utf8"));
    }
  } finally {
    await client.end();
  }
}

async function runLegacyChain(databaseUrl: string) {
  await execFileAsync(process.execPath, ["--import", "tsx", legacyRunner], {
    cwd: dbRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DATABASE_SSL: "false",
      NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_MIGRATION_MODE: "apply",
      NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_SCHEMA_APPLY_APPROVED: "true"
    },
    maxBuffer: 4 * 1024 * 1024
  });
}

async function runSemantic(
  databaseUrl: string,
  mode: "preflight" | "apply" | "verify",
  expectedV1?: string
) {
  const result = await execFileAsync(process.execPath, ["--import", "tsx", semanticRunner], {
    cwd: dbRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DATABASE_SSL: "false",
      NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_MIGRATION_MODE: mode,
      NOISIA_SIGNAL_SEMANTIC_SCOPE_SCHEMA_APPLY_APPROVED:
        mode === "apply" ? "true" : "false",
      NOISIA_SIGNAL_SEMANTIC_SCOPE_EXPECTED_V1_STATE_DIGEST: expectedV1 ?? ""
    },
    maxBuffer: 4 * 1024 * 1024
  });
  return JSON.parse(result.stdout) as {
    ok: boolean;
    mode: string;
    writes_performed: boolean;
    migration_before: { state: string; checksum: string };
    migration_after: { state: string; checksum: string };
    operational_v1_before: { aggregate_hash: string; canonical_reader_count: number };
    operational_v1_after: { aggregate_hash: string; canonical_reader_count: number };
    operational_v1_unchanged: boolean;
    semantic_state: {
      active_workspaces: number;
      attribution_rows: number;
      source_intent_non_eligible_rows: number;
      mention_semantic_rows: number;
      v2_definition_rows: number;
      v2_pointer_rows: number;
      v2_membership_rows: number;
    } | null;
    actions: Array<{ migration: string; action: string }>;
    ledger: { migration_0064_rows: number };
  };
}

async function seedV1Fixture(databaseUrl: string) {
  const client = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await client.connect();
  try {
    await client.query(`
      INSERT INTO organizations (id, slug, legal_name, display_name, status)
      VALUES (
        '64100000-0000-4000-8000-000000000001',
        'semantic-runner-org', 'Semantic runner org', 'Semantic runner org', 'active'
      );
      INSERT INTO users (
        id, email, full_name, user_type, primary_role, organization_id, status
      ) VALUES (
        '64100000-0000-4000-8000-000000000002',
        'semantic-runner@example.test', 'Semantic runner',
        'client', 'brand_manager',
        '64100000-0000-4000-8000-000000000001', 'active'
      );
      INSERT INTO brands (
        id, organization_id, slug, name, display_name, countries, status
      ) VALUES (
        '64100000-0000-4000-8000-000000000003',
        '64100000-0000-4000-8000-000000000001',
        'semantic-runner-brand', 'Semantic runner brand', 'Semantic runner brand',
        ARRAY['MX']::char(2)[], 'active'
      );
      INSERT INTO data_sources (
        id, workspace_id, organization_id, brand_id, source_type, provider,
        connection_method, name, governed_scope, governed_entity_type,
        governed_entity_id, scope_policy_version, scope_review_status,
        scope_approved_by_user_id, scope_approval_source, scope_approved_at,
        role, status
      )
      SELECT
        '64100000-0000-4000-8000-000000000004', workspace.id,
        workspace.organization_id, workspace.brand_id,
        'social-listening', 'fixture', 'csv', 'Semantic runner source',
        'primary_brand', 'brand', workspace.brand_id,
        'workspace-source-scope-v1', 'approved',
        '64100000-0000-4000-8000-000000000002', 'fixture', now(),
        '{"ownership":"workspace"}'::jsonb, 'active'
      FROM signal_workspaces workspace
      WHERE workspace.brand_id = '64100000-0000-4000-8000-000000000003';
      INSERT INTO import_batches (
        id, workspace_id, data_source_id, mention_type, entity_kind, entity_label,
        source_system, imported_by_user_id, status, source_file_name
      )
      SELECT
        '64100000-0000-4000-8000-000000000005', source.workspace_id, source.id,
        'brand', 'primary_brand', 'Semantic runner brand', 'fixture',
        '64100000-0000-4000-8000-000000000002', 'completed', 'runner.csv'
      FROM data_sources source
      WHERE source.id = '64100000-0000-4000-8000-000000000004';
      INSERT INTO mentions (
        id, workspace_id, data_source_id, canonical_mention_id,
        provider_record_id, external_id, source_system, source_file_id,
        text_hash, text_clean, text_snippet, text_length, language,
        published_at, platform, resolved_platform, quality_score, inclusion_status
      )
      SELECT
        '64100000-0000-4000-8000-000000000006', batch.workspace_id,
        batch.data_source_id, '64100000-0000-4000-8000-000000000006',
        'semantic-runner-record', 'semantic-runner-record', 'fixture', batch.id,
        repeat('6', 64), 'Deterministic runner fixture', 'Runner fixture', 28, 'es',
        '2026-08-01T12:00:00Z', 'x', 'x', 9, 'included'
      FROM import_batches batch
      WHERE batch.id = '64100000-0000-4000-8000-000000000005';
    `);
  } finally {
    await client.end();
  }
}

test("0064 runner has independent remote approval and restore guards", async () => {
  const baseEnv = {
    ...process.env,
    DATABASE_URL: "postgres://runner:placeholder@example.invalid/preview_clone",
    DATABASE_SSL: "false",
    NOISIA_REMOTE_DATABASE_TARGET: "preview",
    NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_MIGRATION_MODE: "apply",
    NOISIA_SIGNAL_SEMANTIC_SCOPE_PREFLIGHT_ALLOW_REMOTE: "true",
    NOISIA_SIGNAL_SEMANTIC_SCOPE_NO_APP_CONNECTIONS_CONFIRMED: "true",
    NOISIA_SIGNAL_SEMANTIC_SCOPE_RESTORE_VERIFIED: "true",
    NOISIA_SIGNAL_SEMANTIC_SCOPE_RESTORE_REFERENCE: "fixture restore point",
    NOISIA_SIGNAL_SEMANTIC_SCOPE_RESTORE_POINT_AT: new Date().toISOString()
  };
  await assert.rejects(
    execFileAsync(process.execPath, ["--import", "tsx", semanticRunner], {
      cwd: dbRoot,
      env: baseEnv
    }),
    /NOISIA_SIGNAL_SEMANTIC_SCOPE_SCHEMA_APPLY_APPROVED=true/u
  );
});

test("0064 runner preserves V1 and is resumable without a second write", async (t) => {
  const databaseUrl = integrationUrl();
  if (!databaseUrl) {
    t.skip(`Set ${DATABASE_URL_ENV} and ${APPROVAL_ENV}=true for disposable Postgres.`);
    return;
  }

  await resetThrough0058(databaseUrl);
  await runLegacyChain(databaseUrl);
  await seedV1Fixture(databaseUrl);

  const preflight = await runSemantic(databaseUrl, "preflight");
  assert.equal(preflight.writes_performed, false);
  assert.equal(preflight.migration_before.state, "absent");
  assert.equal(preflight.operational_v1_before.canonical_reader_count, 1);

  const applied = await runSemantic(
    databaseUrl,
    "apply",
    preflight.operational_v1_before.aggregate_hash
  );
  assert.equal(applied.writes_performed, true);
  assert.equal(applied.operational_v1_unchanged, true);
  assert.deepEqual(applied.operational_v1_after, preflight.operational_v1_before);
  assert.equal(applied.migration_after.state, "complete");
  assert.equal(applied.semantic_state?.active_workspaces, 1);
  assert.equal(applied.semantic_state?.v2_definition_rows, 1);
  assert.equal(applied.semantic_state?.v2_pointer_rows, 0);
  assert.equal(applied.semantic_state?.v2_membership_rows, 0);
  assert.equal(applied.semantic_state?.mention_semantic_rows, 0);
  assert.equal(
    applied.semantic_state?.source_intent_non_eligible_rows,
    applied.semantic_state?.attribution_rows
  );
  assert.equal(applied.ledger.migration_0064_rows, 1);

  const verified = await runSemantic(
    databaseUrl,
    "verify",
    preflight.operational_v1_before.aggregate_hash
  );
  assert.equal(verified.writes_performed, false);
  assert.equal(verified.migration_before.state, "complete");
  assert.equal(verified.operational_v1_unchanged, true);

  const retry = await runSemantic(
    databaseUrl,
    "apply",
    preflight.operational_v1_before.aggregate_hash
  );
  assert.equal(retry.writes_performed, false);
  assert.deepEqual(retry.actions, [{
    migration: "0064_signal_semantic_scope_hardening.sql",
    action: "verified_existing"
  }]);
  assert.equal(retry.ledger.migration_0064_rows, 1);
});

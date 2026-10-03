import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import pg from "pg";

const execFileAsync = promisify(execFile);
const DATABASE_URL_ENV = "NOISIA_SIGNAL_SEMANTIC_RESOLUTION_RUNNER_INTEGRATION_URL";
const APPROVAL_ENV = "NOISIA_SIGNAL_SEMANTIC_RESOLUTION_RUNNER_INTEGRATION_APPROVED";
const dbRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationDir = join(dbRoot, "migrations");
const legacyRunner = join(dbRoot, "scripts", "apply-signal-workspace-data-plane-migration.ts");
const semanticScopeRunner = join(dbRoot, "scripts", "apply-signal-semantic-scope-migration.ts");
const resolutionRunner = join(dbRoot, "scripts", "apply-signal-semantic-resolution-migration.ts");

function integrationUrl() {
  const value = process.env[DATABASE_URL_ENV]?.trim();
  if (!value || process.env[APPROVAL_ENV] !== "true") return null;
  const parsed = new URL(value);
  assert.ok(new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname));
  assert.match(parsed.pathname, /(resolution|runner|smoke|throwaway)/u);
  return value;
}

test("0065 runner requires its own remote approval", async () => {
  await assert.rejects(execFileAsync(process.execPath, ["--import", "tsx", resolutionRunner], {
    cwd: dbRoot,
    env: {
      ...process.env,
      DATABASE_URL: "postgres://runner:placeholder@example.invalid/preview_clone",
      DATABASE_SSL: "false",
      NOISIA_REMOTE_DATABASE_TARGET: "preview",
      NOISIA_SIGNAL_SEMANTIC_RESOLUTION_MIGRATION_MODE: "apply",
      NOISIA_SIGNAL_SEMANTIC_RESOLUTION_PREFLIGHT_ALLOW_REMOTE: "true",
      NOISIA_SIGNAL_SEMANTIC_RESOLUTION_TARGET_FINGERPRINT:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      NOISIA_SIGNAL_SEMANTIC_RESOLUTION_NO_APP_CONNECTIONS_CONFIRMED: "true",
      NOISIA_SIGNAL_SEMANTIC_RESOLUTION_RESTORE_VERIFIED: "true",
      NOISIA_SIGNAL_SEMANTIC_RESOLUTION_RESTORE_REFERENCE: "fixture restore point",
      NOISIA_SIGNAL_SEMANTIC_RESOLUTION_RESTORE_POINT_AT: new Date().toISOString()
    }
  }), /TARGET_FINGERPRINT|SCHEMA_APPLY_APPROVED/u);
});

test("0065 runner is fail-closed, concurrent-safe and read-only on verify", {
  timeout: 240_000
}, async (t) => {
  const databaseUrl = integrationUrl();
  if (!databaseUrl) {
    t.skip(`Set ${DATABASE_URL_ENV} and ${APPROVAL_ENV}=true for disposable Postgres.`);
    return;
  }

  await resetThrough0058(databaseUrl);
  await runLegacyChain(databaseUrl);
  await seedLaikaV1Fixture(databaseUrl);
  await runSemanticScope(databaseUrl);
  await seedSemanticCandidate(databaseUrl);

  const preflight = await runResolution(databaseUrl, "preflight");
  assert.equal(preflight.writes_performed, false);
  assert.equal(preflight.migration_before.state, "absent");
  assert.equal(preflight.protected_state_before.laika.workspace_count, 1);
  assert.equal(preflight.protected_state_before.laika.assertion_count, 1);
  assert.equal(preflight.protected_state_before.resolution.run_count, 0);

  const [left, right] = await Promise.all([
    runResolution(databaseUrl, "apply", preflight.protected_state_before.aggregate_hash),
    runResolution(databaseUrl, "apply", preflight.protected_state_before.aggregate_hash)
  ]);
  assert.equal(Number(left.writes_performed) + Number(right.writes_performed), 1);
  const actions = [...left.actions, ...right.actions].map((action) => action.action).sort();
  assert.deepEqual(actions, ["applied", "verified_existing"]);
  assert.equal(left.ledger.migration_0065_rows, 1);
  assert.equal(right.ledger.migration_0065_rows, 1);

  const verified = await runResolution(
    databaseUrl,
    "verify",
    preflight.protected_state_before.aggregate_hash
  );
  assert.equal(verified.writes_performed, false);
  assert.equal(verified.migration_after.state, "complete");
  assert.equal(verified.function_contract.matches, true);
  assert.equal(verified.protected_state_unchanged, true);
  assert.deepEqual(verified.protected_state_after, preflight.protected_state_before);
  assert.equal(verified.protected_state_after.resolution.run_count, 0);
  assert.equal(verified.protected_state_after.resolution.item_count, 0);

  const client = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await client.connect();
  try {
    await client.query(`
      UPDATE signal_workspace_data_plane_migration_ledger
      SET checksum_sha256 = $1
      WHERE ordinal = 65
    `, [hash("wrong-checksum")]);
  } finally {
    await client.end();
  }
  await assert.rejects(
    runResolution(databaseUrl, "verify", preflight.protected_state_before.aggregate_hash),
    /matching ledger row/u
  );

  await resetThrough0058(databaseUrl);
  await runLegacyChain(databaseUrl);
  await seedLaikaV1Fixture(databaseUrl);
  await runSemanticScope(databaseUrl);
  await seedSemanticCandidate(databaseUrl);
  const partialClient = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await partialClient.connect();
  try {
    await partialClient.query("CREATE TABLE signal_semantic_resolution_runs (id uuid PRIMARY KEY)");
  } finally {
    await partialClient.end();
  }
  await assert.rejects(runResolution(databaseUrl, "preflight"), /partially applied/u);
});

async function resetThrough0058(databaseUrl: string) {
  const client = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const files = (await readdir(migrationDir))
      .filter((file) => /^\d{4}_.+\.sql$/u.test(file) && Number(file.slice(0, 4)) <= 58)
      .sort();
    for (const file of files) await client.query(await readFile(join(migrationDir, file), "utf8"));
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
    maxBuffer: 8 * 1024 * 1024
  });
}

async function runSemanticScope(databaseUrl: string) {
  await execFileAsync(process.execPath, ["--import", "tsx", semanticScopeRunner], {
    cwd: dbRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DATABASE_SSL: "false",
      NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_MIGRATION_MODE: "apply",
      NOISIA_SIGNAL_SEMANTIC_SCOPE_SCHEMA_APPLY_APPROVED: "true"
    },
    maxBuffer: 8 * 1024 * 1024
  });
}

async function runResolution(
  databaseUrl: string,
  mode: "preflight" | "apply" | "verify",
  expectedState = ""
) {
  const result = await execFileAsync(process.execPath, ["--import", "tsx", resolutionRunner], {
    cwd: dbRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DATABASE_SSL: "false",
      NOISIA_SIGNAL_SEMANTIC_RESOLUTION_MIGRATION_MODE: mode,
      NOISIA_SIGNAL_SEMANTIC_RESOLUTION_SCHEMA_APPLY_APPROVED:
        mode === "apply" ? "true" : "false",
      NOISIA_SIGNAL_SEMANTIC_RESOLUTION_EXPECTED_STATE_DIGEST: expectedState
    },
    maxBuffer: 8 * 1024 * 1024
  });
  return JSON.parse(result.stdout) as {
    writes_performed: boolean;
    migration_before: { state: string };
    migration_after: { state: string };
    protected_state_before: ProtectedState;
    protected_state_after: ProtectedState;
    protected_state_unchanged: boolean;
    function_contract: { matches: boolean };
    actions: Array<{ migration: string; action: string }>;
    ledger: { migration_0065_rows: number };
  };
}

type ProtectedState = {
  aggregate_hash: string;
  laika: { workspace_count: number; assertion_count: number };
  resolution: { run_count: number; item_count: number };
};

async function seedLaikaV1Fixture(databaseUrl: string) {
  const client = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await client.connect();
  try {
    await client.query(`
      INSERT INTO organizations (id, slug, legal_name, display_name, status)
      VALUES ('65100000-0000-4000-8000-000000000001', 'resolution-runner-org',
        'Resolution runner org', 'Resolution runner org', 'active');
      INSERT INTO users (
        id, email, full_name, user_type, primary_role, organization_id, status
      ) VALUES ('65100000-0000-4000-8000-000000000002',
        'resolution-runner@example.test', 'Resolution runner', 'internal', 'admin',
        '65100000-0000-4000-8000-000000000001', 'active');
      INSERT INTO brands (
        id, organization_id, slug, name, display_name, countries, status
      ) VALUES ('65100000-0000-4000-8000-000000000003',
        '65100000-0000-4000-8000-000000000001', 'laika',
        'Laika fixture', 'Laika fixture', ARRAY['MX']::char(2)[], 'active');
      INSERT INTO data_sources (
        id, workspace_id, organization_id, brand_id, source_type, provider,
        connection_method, name, governed_scope, governed_entity_type,
        governed_entity_id, scope_policy_version, scope_review_status,
        scope_approved_by_user_id, scope_approval_source, scope_approved_at,
        role, status
      ) SELECT '65100000-0000-4000-8000-000000000004', workspace.id,
        workspace.organization_id, workspace.brand_id, 'social-listening', 'fixture', 'csv',
        'Resolution runner source', 'primary_brand', 'brand', workspace.brand_id,
        'workspace-source-scope-v1', 'approved',
        '65100000-0000-4000-8000-000000000002', 'fixture', now(),
        '{"ownership":"workspace"}'::jsonb, 'active'
      FROM signal_workspaces workspace
      WHERE workspace.brand_id = '65100000-0000-4000-8000-000000000003';
      INSERT INTO import_batches (
        id, workspace_id, data_source_id, mention_type, entity_kind, entity_label,
        source_system, imported_by_user_id, status, source_file_name
      ) SELECT '65100000-0000-4000-8000-000000000005', source.workspace_id, source.id,
        'brand', 'primary_brand', 'Laika fixture', 'fixture',
        '65100000-0000-4000-8000-000000000002', 'completed', 'runner.csv'
      FROM data_sources source WHERE source.id = '65100000-0000-4000-8000-000000000004';
      INSERT INTO mentions (
        id, workspace_id, data_source_id, canonical_mention_id,
        provider_record_id, external_id, source_system, source_file_id,
        text_hash, text_clean, text_snippet, text_length, language,
        published_at, platform, resolved_platform, quality_score, inclusion_status
      ) SELECT '65100000-0000-4000-8000-000000000006', batch.workspace_id,
        batch.data_source_id, '65100000-0000-4000-8000-000000000006',
        'resolution-runner-record', 'resolution-runner-record', 'fixture', batch.id,
        repeat('6', 64), 'Laika fixture', 'Laika fixture', 13, 'es',
        '2026-08-01T12:00:00Z', 'x', 'x', 9, 'included'
      FROM import_batches batch WHERE batch.id = '65100000-0000-4000-8000-000000000005';
      SELECT record_signal_mention_import_provenance(
        '65100000-0000-4000-8000-000000000006',
        '65100000-0000-4000-8000-000000000005'
      );
    `);
  } finally {
    await client.end();
  }
}

async function seedSemanticCandidate(databaseUrl: string) {
  const client = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await client.connect();
  try {
    await client.query(`
      SELECT create_signal_mention_semantic_assertion(
        workspace.id,
        '65100000-0000-4000-8000-000000000006',
        '65100000-0000-4000-8000-000000000004',
        '65100000-0000-4000-8000-000000000005',
        'primary_brand', 'brand', workspace.brand_id, 'Laika fixture', 0.99,
        'explicit_primary_brand', $1, 'signal-semantic-governed-identity', '1', NULL, $2
      ) FROM signal_workspaces workspace
      WHERE workspace.brand_id = '65100000-0000-4000-8000-000000000003';
    `, [hash("evidence"), hash("assertion")]);
  } finally {
    await client.end();
  }
}

function hash(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

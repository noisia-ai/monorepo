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
const DATABASE_URL_ENV = "NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_RUNNER_INTEGRATION_URL";
const APPROVAL_ENV = "NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_RUNNER_INTEGRATION_APPROVED";
const dbRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationDir = join(dbRoot, "migrations");
const runner = join(dbRoot, "scripts", "apply-signal-semantic-base-isolation-migration.ts");

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function integrationUrl() {
  const value = process.env[DATABASE_URL_ENV]?.trim();
  if (!value || process.env[APPROVAL_ENV] !== "true") return null;
  const parsed = new URL(value);
  assert.ok(new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname));
  assert.match(parsed.pathname, /(runner|smoke|throwaway)/u);
  return value;
}

async function resetThrough0069(databaseUrl: string) {
  const client = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const files = (await readdir(migrationDir))
      .filter((file) => /^\d{4}_.+\.sql$/u.test(file) && Number(file.slice(0, 4)) <= 69)
      .sort();
    for (const file of files) await client.query(await readFile(join(migrationDir, file), "utf8"));
    await client.query(`
      CREATE TABLE signal_workspace_data_plane_migration_ledger (
        migration_name text PRIMARY KEY,
        ordinal integer NOT NULL UNIQUE,
        checksum_sha256 text NOT NULL,
        disposition text NOT NULL,
        runner_version text NOT NULL,
        target_fingerprint text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT signal_workspace_data_plane_migration_checksum
          CHECK (checksum_sha256 ~ '^sha256:[0-9a-f]{64}$'),
        CONSTRAINT signal_workspace_data_plane_migration_disposition
          CHECK (disposition IN ('applied','adopted','prerequisite_repaired'))
      )
    `);
    for (const file of files.filter((file) => Number(file.slice(0, 4)) >= 59)) {
      const ordinal = Number(file.slice(0, 4));
      const sql = await readFile(join(migrationDir, file), "utf8");
      await client.query(`
        INSERT INTO signal_workspace_data_plane_migration_ledger (
          migration_name,ordinal,checksum_sha256,disposition,runner_version,target_fingerprint
        ) VALUES ($1,$2,$3,'applied','fixture','sha256:${"0".repeat(64)}')
      `, [file, ordinal, sha256(sql)]);
    }
  } finally {
    await client.end();
  }
}

async function run(
  databaseUrl: string,
  mode: "preflight" | "apply" | "verify",
  expectedState = ""
) {
  const result = await execFileAsync(process.execPath, ["--import", "tsx", runner], {
    cwd: dbRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DATABASE_SSL: "false",
      NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_MIGRATION_MODE: mode,
      NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_SCHEMA_APPLY_APPROVED:
        mode === "apply" ? "true" : "false",
      NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_EXPECTED_STATE_DIGEST: expectedState
    },
    maxBuffer: 16 * 1024 * 1024
  });
  return JSON.parse(result.stdout) as {
    ok: boolean;
    mode: string;
    writes_performed: boolean;
    actions: Array<{ migration: string; action: string }>;
    migration_after: { state: string };
    ledger_after: Array<{ ordinal: number }>;
    protected_state_before: { aggregate_hash: string };
    protected_state_after: { aggregate_hash: string };
    protected_state_equal: boolean;
    semantic_base_normalized: boolean;
  };
}

test("0070 runner applies once, verifies read-only and retries without a second write", {
  timeout: 240_000
}, async (t) => {
  const databaseUrl = integrationUrl();
  if (!databaseUrl) {
    t.skip(`Set ${DATABASE_URL_ENV} and ${APPROVAL_ENV}=true for disposable Postgres.`);
    return;
  }
  await resetThrough0069(databaseUrl);
  const preflight = await run(databaseUrl, "preflight");
  assert.equal(preflight.writes_performed, false);
  assert.equal(preflight.migration_after.state, "absent");

  const applied = await run(databaseUrl, "apply", preflight.protected_state_before.aggregate_hash);
  assert.equal(applied.writes_performed, true);
  assert.equal(applied.migration_after.state, "complete");
  assert.equal(applied.protected_state_equal, true);
  assert.equal(applied.semantic_base_normalized, true);
  assert.equal(applied.ledger_after.filter((row) => row.ordinal === 70).length, 1);

  const verified = await run(databaseUrl, "verify");
  assert.equal(verified.writes_performed, false);
  assert.equal(verified.migration_after.state, "complete");
  assert.equal(verified.protected_state_equal, true);

  const retry = await run(databaseUrl, "apply", verified.protected_state_before.aggregate_hash);
  assert.equal(retry.writes_performed, false);
  assert.deepEqual(retry.actions, [{
    migration: "0070_signal_semantic_base_isolation.sql",
    action: "verified_existing"
  }]);
  assert.equal(retry.ledger_after.filter((row) => row.ordinal === 70).length, 1);
});

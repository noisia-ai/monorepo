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
const DATABASE_URL_ENV = "NOISIA_SIGNAL_GOVERNED_SERVING_INTEGRITY_RUNNER_INTEGRATION_URL";
const APPROVAL_ENV = "NOISIA_SIGNAL_GOVERNED_SERVING_INTEGRITY_RUNNER_INTEGRATION_APPROVED";
const ENV_PREFIX = "NOISIA_SIGNAL_GOVERNED_SERVING_INTEGRITY_MIGRATION";
const EXPECTED_CHECKSUM =
  "sha256:1c974ec09871c28a439bb23a7753b6b0a9d8915539493bff3c364515bbbd4738";
const dbRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationDir = join(dbRoot, "migrations");
const runner = join(dbRoot, "scripts", "apply-signal-governed-serving-integrity-migration.ts");

type RunnerOutput = {
  ok: boolean;
  mode: "preflight" | "apply" | "verify";
  migration: { checksum: string };
  migration_before: { state: string };
  migration_after: { state: string; present: number; required: number; missing: string[] };
  writes_performed: boolean;
  actions: Array<{ migration: string; action: string }>;
  ledger_after: Array<{ ordinal: number; checksum_sha256: string }>;
  protected_state_before: { aggregate_hash: string };
  protected_state_after: { aggregate_hash: string };
  protected_state_equal: boolean;
  shadow_or_cutover_executed: boolean;
};

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

async function resetThrough0071(databaseUrl: string) {
  const client = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const files = (await readdir(migrationDir))
      .filter((file) => /^\d{4}_.+\.sql$/u.test(file) && Number(file.slice(0, 4)) <= 71)
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
      await client.query(`
        INSERT INTO signal_workspace_data_plane_migration_ledger (
          migration_name,ordinal,checksum_sha256,disposition,runner_version,target_fingerprint
        ) VALUES ($1,$2,$3,'applied','fixture','sha256:${"0".repeat(64)}')
      `, [file, Number(file.slice(0, 4)), sha256(await readFile(join(migrationDir, file), "utf8"))]);
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
      [`${ENV_PREFIX}_MODE`]: mode,
      [`${ENV_PREFIX}_APPLY_APPROVED`]: mode === "apply" ? "true" : "false",
      [`${ENV_PREFIX}_EXPECTED_STATE_DIGEST`]: expectedState
    },
    maxBuffer: 32 * 1024 * 1024
  });
  return JSON.parse(result.stdout) as RunnerOutput;
}

async function withClient<T>(databaseUrl: string, action: (client: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end();
  }
}

test("0072 runner is guarded, concurrent-safe, resumable and read-only on verify", {
  timeout: 420_000
}, async (t) => {
  const databaseUrl = integrationUrl();
  if (!databaseUrl) {
    t.skip(`Set ${DATABASE_URL_ENV} and ${APPROVAL_ENV}=true for disposable Postgres.`);
    return;
  }

  await resetThrough0071(databaseUrl);
  const preflight = await run(databaseUrl, "preflight");
  assert.equal(preflight.ok, true);
  assert.equal(preflight.migration.checksum, EXPECTED_CHECKSUM);
  assert.equal(preflight.migration_after.state, "absent");
  assert.equal(preflight.writes_performed, false);
  assert.equal(preflight.protected_state_equal, true);

  const concurrent = await Promise.all([
    run(databaseUrl, "apply", preflight.protected_state_before.aggregate_hash),
    run(databaseUrl, "apply", preflight.protected_state_before.aggregate_hash)
  ]);
  assert.deepEqual(
    concurrent.flatMap((entry) => entry.actions.map((action) => action.action)).sort(),
    ["applied", "verified_existing"]
  );
  for (const result of concurrent) {
    assert.equal(result.migration_after.state, "complete");
    assert.equal(result.migration_after.present, result.migration_after.required);
    assert.deepEqual(result.migration_after.missing, []);
    assert.equal(result.protected_state_equal, true);
  }
  assert.equal(concurrent.filter((entry) => entry.writes_performed).length, 1);

  const verified = await run(databaseUrl, "verify");
  assert.equal(verified.writes_performed, false);
  assert.equal(verified.migration_after.state, "complete");
  assert.equal(verified.protected_state_equal, true);
  assert.equal(verified.shadow_or_cutover_executed, false);
  assert.equal(verified.ledger_after.filter((row) => row.ordinal === 72).length, 1);
  assert.equal(
    verified.ledger_after.find((row) => row.ordinal === 72)?.checksum_sha256,
    EXPECTED_CHECKSUM
  );

  const retry = await run(databaseUrl, "apply", verified.protected_state_before.aggregate_hash);
  assert.equal(retry.writes_performed, false);
  assert.deepEqual(retry.actions, [{
    migration: "0072_signal_governed_brand_binding_set_integrity.sql",
    action: "verified_existing"
  }]);
  assert.equal(retry.ledger_after.filter((row) => row.ordinal === 72).length, 1);

  await withClient(databaseUrl, async (client) => {
    await client.query(`
      UPDATE signal_workspace_data_plane_migration_ledger
      SET checksum_sha256=$1 WHERE ordinal=72
    `, [sha256("incompatible-0072")]);
  });
  await assert.rejects(run(databaseUrl, "verify"), /checksum is incompatible/u);

  await resetThrough0071(databaseUrl);
  await withClient(databaseUrl, async (client) => {
    const sql = await readFile(
      join(migrationDir, "0072_signal_governed_brand_binding_set_integrity.sql"),
      "utf8"
    );
    await client.query(sql);
    await client.query(`
      DROP TRIGGER trg_signal_governed_brand_referenced_binding_history
      ON signal_governed_view_bindings
    `);
  });
  await assert.rejects(run(databaseUrl, "preflight"), /0072 is partial/u);
});

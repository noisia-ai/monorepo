import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import pg from "pg";

const execFileAsync = promisify(execFile);
const DATABASE_URL_ENV = "NOISIA_SIGNAL_MIGRATION_RUNNER_INTEGRATION_URL";
const APPROVAL_ENV = "NOISIA_SIGNAL_MIGRATION_RUNNER_INTEGRATION_APPROVED";
const dbRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationDir = join(dbRoot, "migrations");
const runner = join(dbRoot, "scripts", "apply-signal-workspace-data-plane-migration.ts");

function integrationUrl() {
  const value = process.env[DATABASE_URL_ENV]?.trim();
  if (!value || process.env[APPROVAL_ENV] !== "true") return null;
  const parsed = new URL(value);
  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname)) {
    throw new Error("Migration runner integration only accepts a disposable local Postgres.");
  }
  if (!/(runner|smoke|throwaway)/u.test(parsed.pathname)) {
    throw new Error("Disposable integration database name must contain runner, smoke or throwaway.");
  }
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
    assert.equal(files.at(-1)?.startsWith("0058_"), true);
    for (const file of files) {
      const sql = await readFile(join(migrationDir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Failed applying ${file}: ${String(error)}`);
      }
    }
  } finally {
    await client.end();
  }
}

async function runRunner(
  databaseUrl: string,
  mode: "preflight" | "apply" | "verify",
  options: { repairAutolink?: boolean } = {}
) {
  const result = await execFileAsync(
    process.execPath,
    ["--import", "tsx", runner],
    {
      cwd: dbRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        DATABASE_SSL: "false",
        NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_MIGRATION_MODE: mode,
        NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_SCHEMA_APPLY_APPROVED:
          mode === "apply" ? "true" : "false",
        NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_0056_REPAIR_APPROVED:
          options.repairAutolink ? "true" : "false"
      },
      maxBuffer: 4 * 1024 * 1024
    }
  );
  return JSON.parse(result.stdout) as {
    ok: boolean;
    writes_performed: boolean;
    migrations_before: Array<{ state: string }>;
    migrations_after: Array<{ state: string }>;
    actions: Array<{ migration: string; action: string }>;
  };
}

test("remote apply requires isolation proof in addition to a preview label", async () => {
  await assert.rejects(
    execFileAsync(
      process.execPath,
      ["--import", "tsx", runner],
      {
        cwd: dbRoot,
        env: {
          ...process.env,
          DATABASE_URL: "postgres://runner:placeholder@example.invalid/preview_clone",
          DATABASE_SSL: "false",
          NOISIA_REMOTE_DATABASE_TARGET: "preview",
          NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_MIGRATION_MODE: "apply",
          NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_PREFLIGHT_ALLOW_REMOTE: "true",
          NOISIA_DB_APPLY_SIGNAL_WORKSPACE_DATA_PLANE_ALLOW_REMOTE: "true",
          NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_SCHEMA_APPLY_APPROVED: "true",
          NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_ISOLATED_TARGET_CONFIRMED: "false"
        }
      }
    ),
    /NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_ISOLATED_TARGET_CONFIRMED=true/u
  );
});

test("0059-0063 runner is fail-closed, concurrent-safe, resumable and idempotent", async (t) => {
  const databaseUrl = integrationUrl();
  if (!databaseUrl) {
    t.skip(`Set ${DATABASE_URL_ENV} and ${APPROVAL_ENV}=true for disposable Postgres integration.`);
    return;
  }

  await resetThrough0058(databaseUrl);
  const preflight = await runRunner(databaseUrl, "preflight");
  assert.equal(preflight.ok, true);
  assert.equal(preflight.writes_performed, false);
  assert.deepEqual(preflight.migrations_before.map((migration) => migration.state), [
    "absent", "absent", "absent", "absent", "absent"
  ]);

  const [first, second] = await Promise.all([
    runRunner(databaseUrl, "apply"),
    runRunner(databaseUrl, "apply")
  ]);
  for (const result of [first, second]) {
    assert.equal(result.ok, true);
    assert.deepEqual(result.migrations_after.map((migration) => migration.state), [
      "complete", "complete", "complete", "complete", "complete"
    ]);
  }
  const concurrentActions = [...first.actions, ...second.actions].map((action) => action.action);
  assert.equal(concurrentActions.filter((action) => action === "applied").length, 5);
  assert.equal(concurrentActions.filter((action) => action === "verified_existing").length, 5);

  const client = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await client.connect();
  try {
    const ledger = await client.query<{
      count: number;
      checksums: number;
      ordinals: number;
    }>(`
      SELECT
        count(*)::int AS count,
        count(DISTINCT checksum_sha256)::int AS checksums,
        count(DISTINCT ordinal)::int AS ordinals
      FROM signal_workspace_data_plane_migration_ledger
    `);
    assert.deepEqual(ledger.rows[0], { count: 5, checksums: 5, ordinals: 5 });
    const order = await client.query<{ ordinal: number }>(`
      SELECT ordinal FROM signal_workspace_data_plane_migration_ledger ORDER BY ordinal
    `);
    assert.deepEqual(order.rows.map((row) => row.ordinal), [59, 60, 61, 62, 63]);
  } finally {
    await client.end();
  }

  const retry = await runRunner(databaseUrl, "apply");
  assert.deepEqual(retry.actions.map((action) => action.action), [
    "verified_existing",
    "verified_existing",
    "verified_existing",
    "verified_existing",
    "verified_existing"
  ]);
  const verified = await runRunner(databaseUrl, "verify");
  assert.equal(verified.ok, true);
  assert.equal(verified.writes_performed, false);

  const drift = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await drift.connect();
  try {
    await drift.query(`
      DROP TRIGGER trg_study_corpora_signal_workspace_membership ON study_corpora
    `);
  } finally {
    await drift.end();
  }
  await assert.rejects(
    runRunner(databaseUrl, "apply", { repairAutolink: true }),
    /0056 compatibility autolink is partially applied/u
  );

  const absent = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await absent.connect();
  try {
    await absent.query("DROP FUNCTION attach_study_corpus_to_signal_workspace()");
  } finally {
    await absent.end();
  }
  const repaired = await runRunner(databaseUrl, "apply", { repairAutolink: true });
  assert.equal(repaired.actions[0]?.action, "prerequisite_repaired");

  const tamper = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await tamper.connect();
  try {
    await tamper.query(`
      UPDATE signal_workspace_data_plane_migration_ledger
      SET checksum_sha256 = $1
      WHERE ordinal = 63
    `, [`sha256:${"0".repeat(64)}`]);
  } finally {
    await tamper.end();
  }
  await assert.rejects(
    runRunner(databaseUrl, "apply"),
    /Checksum mismatch for recorded migration 0063_signal_strategic_run_outbox_recovery\.sql/u
  );
});

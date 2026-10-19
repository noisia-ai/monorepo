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
const DATABASE_URL_ENV = "NOISIA_SIGNAL_STRATEGIC_GATE_D_RUNNER_INTEGRATION_URL";
const APPROVAL_ENV = "NOISIA_SIGNAL_STRATEGIC_GATE_D_RUNNER_INTEGRATION_APPROVED";
const ENV_PREFIX = "NOISIA_SIGNAL_STRATEGIC_GATE_D_MIGRATION";
const EXPECTED_CHECKSUM =
  "sha256:1eb15739c17a17fb4c4f9924971447fbcb6a26bcfa6cfc68cf7847f5b5e13d69";
const dbRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationDir = join(dbRoot, "migrations");
const runner = join(dbRoot, "scripts", "apply-signal-strategic-gate-d-migration.ts");

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
  protected_state_after: {
    aggregate_hash: string;
    new_contract_rows: Record<string, number>;
  };
  protected_state_equal: boolean;
  shadow_or_cutover_executed: boolean;
  observability: {
    protected_state_hash_contract: string;
    statement_timeout_ms: number;
    read_only_after_reused_repeatable_read_snapshot: boolean;
  };
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

async function resetThrough0073(databaseUrl: string) {
  const client = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const files = (await readdir(migrationDir))
      .filter((file) => /^\d{4}_.+\.sql$/u.test(file) && Number(file.slice(0, 4)) <= 73)
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
    await seedLegacyBrandHistory(client);
  } finally {
    await client.end();
  }
}

async function seedLegacyBrandHistory(client: pg.Client) {
  const ids = {
    organization: "73100000-0000-4000-8000-000000000001",
    actor: "73100000-0000-4000-8000-000000000002",
    brand: "73100000-0000-4000-8000-000000000003",
    bundle: "73100000-0000-4000-8000-000000000005"
  };
  await client.query(`INSERT INTO organizations(id,slug,legal_name,status)
    VALUES ($1::uuid,'runner-legacy-brand','Runner Legacy Brand','active')`, [ids.organization]);
  await client.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,organization_id,status)
    VALUES ($1::uuid,'runner-legacy@example.test','Runner Legacy','noisia_internal','admin',$2::uuid,'active')`,
  [ids.actor, ids.organization]);
  await client.query(`INSERT INTO brands(id,organization_id,slug,name,status)
    VALUES ($1::uuid,$2::uuid,'runner-legacy-brand','Runner Legacy Brand','active')`,
  [ids.brand, ids.organization]);
  const workspaceId = (await client.query<{ id: string }>(`
    SELECT id::text FROM signal_workspaces WHERE brand_id=$1::uuid
  `, [ids.brand])).rows[0]!.id;
  await client.query(`INSERT INTO signal_population_policy_bundles(
    id,workspace_id,policy_key,policy_version,status,authorized_modules,allowed_scopes,
    acceptance_status,quality_contract_status,eligibility_policy,deduplication_policy,
    visibility_class,denominator_key,definition_hash,created_by_user_id,
    activated_by_user_id,activated_at
  ) VALUES ($1::uuid,$2::uuid,'runner-legacy-brand',1,'active',
    ARRAY['brand-monitoring','mentions','topics-narratives']::text[],ARRAY[]::text[],
    'any','not_available','workspace-reservoir','canonical-root','operator-only',
    'workspace-canonical-roots',$3,$4::uuid,$4::uuid,now())`,
  [ids.bundle, workspaceId, sha256("runner-legacy-bundle"), ids.actor]);
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

test("0074 runner is guarded, concurrent-safe, resumable and read-only on verify", {
  timeout: 420_000
}, async (t) => {
  const databaseUrl = integrationUrl();
  if (!databaseUrl) {
    t.skip(`Set ${DATABASE_URL_ENV} and ${APPROVAL_ENV}=true for disposable Postgres.`);
    return;
  }

  await resetThrough0073(databaseUrl);
  const runnerSource = await readFile(runner, "utf8");
  assert.match(runnerSource, /WITH row_hashes AS MATERIALIZED/u);
  assert.match(runnerSource, /ORDER BY row_hash/u);
  assert.doesNotMatch(runnerSource, /ORDER BY to_jsonb\(protected_row\)::text/u);
  const preflight = await run(databaseUrl, "preflight");
  assert.equal(preflight.ok, true);
  assert.equal(preflight.migration.checksum, EXPECTED_CHECKSUM);
  assert.equal(preflight.migration_after.state, "absent");
  assert.equal(preflight.writes_performed, false);
  assert.equal(preflight.protected_state_equal, true);
  assert.equal(
    preflight.observability.protected_state_hash_contract,
    "sha256-sorted-row-sha256-bytea-v1"
  );
  assert.equal(preflight.observability.statement_timeout_ms, 120_000);
  assert.equal(preflight.observability.read_only_after_reused_repeatable_read_snapshot, true);

  await assert.rejects(
    run(databaseUrl, "apply", sha256("stale-protected-state")),
    /Protected state changed after the 0074 preflight/u
  );
  const stillAbsent = await run(databaseUrl, "preflight");
  assert.equal(stillAbsent.migration_after.state, "absent");

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
  assert.deepEqual(
    Object.values(verified.protected_state_after.new_contract_rows),
    Object.values(verified.protected_state_after.new_contract_rows).map(() => 0)
  );
  assert.equal(verified.shadow_or_cutover_executed, false);
  assert.equal(verified.observability.read_only_after_reused_repeatable_read_snapshot, true);
  assert.equal(verified.ledger_after.filter((row) => row.ordinal === 74).length, 1);
  assert.equal(
    verified.ledger_after.find((row) => row.ordinal === 74)?.checksum_sha256,
    EXPECTED_CHECKSUM
  );

  const retry = await run(databaseUrl, "apply", verified.protected_state_before.aggregate_hash);
  assert.equal(retry.writes_performed, false);
  assert.deepEqual(retry.actions, [{
    migration: "0074_signal_strategic_gate_d_preflight.sql",
    action: "verified_existing"
  }]);
  assert.equal(retry.ledger_after.filter((row) => row.ordinal === 74).length, 1);

  await withClient(databaseUrl, async (client) => {
    await client.query(`
      UPDATE signal_workspace_data_plane_migration_ledger
      SET checksum_sha256=$1 WHERE ordinal=74
    `, [sha256("incompatible-0074")]);
  });
  await assert.rejects(run(databaseUrl, "verify"), /checksum is incompatible/u);

  await resetThrough0073(databaseUrl);
  await withClient(databaseUrl, async (client) => {
    const sql = await readFile(
      join(migrationDir, "0074_signal_strategic_gate_d_preflight.sql"),
      "utf8"
    );
    await client.query(sql);
    await client.query(`
      DROP TRIGGER trg_protect_signal_strategic_run_control_delete_v1
      ON signal_strategic_run_controls
    `);
  });
  await assert.rejects(run(databaseUrl, "preflight"), /0074 is partial/u);
});

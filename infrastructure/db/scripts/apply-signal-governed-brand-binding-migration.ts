import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  databaseUrlLooksProductionLike,
  getDatabaseSslConfig,
  isLocalDatabaseUrl,
  requireSafeDatabaseReadTarget,
  requireSafeDatabaseWriteTarget
} from "../seeds/connection.js";
import { requireEnv } from "../seeds/env.js";

const RUNNER_VERSION = "signal-governed-brand-binding-migration-rehearsal-v1";
const LEDGER = "signal_workspace_data_plane_migration_ledger";
const LOCK_KEY = "noisia:signal-governed-brand-binding:0071";
const FILENAME = "0071_signal_governed_brand_binding_withdrawal.sql";
const CHECKSUM = "sha256:df1381a270083b0fc91943e1a7be438b9fa4fd71c736ce2b2ad3ed85e1c44b11";
const EXPECTED_DIRECT_FINGERPRINT =
  "sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19";
const EXPECTED_POOLER_FINGERPRINT =
  "sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815";
const EXPECTED_PROJECT_REF_HASH =
  "sha256:030c5a33e3b28881c4d77983a6049bbfa16c995da232454081cbccfcfa78aa32";
const EXPECTED_V1_DIGEST =
  "sha256:2e46c7565d2835e616824b1f9866faaea5f0a96b55a3c99978d58271baa0466e";
const EXPECTED_BASE_DIGEST =
  "sha256:1e66cf5906fb4163aee1fc1e408ab630fab2068a55382503c821ef7882b26880";

const ENV_PREFIX = "NOISIA_SIGNAL_GOVERNED_BINDING_MIGRATION";
type Mode = "preflight" | "apply" | "verify";
type MigrationState = "absent" | "partial" | "complete";

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function readMode(): Mode {
  const value = (process.env[`${ENV_PREFIX}_MODE`] ?? "preflight").trim().toLowerCase();
  if (value === "preflight" || value === "apply" || value === "verify") return value;
  throw new Error(`${ENV_PREFIX}_MODE must be preflight, apply or verify.`);
}

function targetFingerprint(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  return sha256([
    parsed.protocol, parsed.hostname.toLowerCase(), parsed.port || "5432",
    parsed.pathname.replace(/^\//u, ""), parsed.username
  ].join("|"));
}

function projectRefHash(databaseUrl: string, kind: "direct" | "pooler") {
  const parsed = new URL(databaseUrl);
  const value = kind === "direct"
    ? /^db\.([a-z0-9]+)\.supabase\.co$/u.exec(parsed.hostname.toLowerCase())?.[1]
    : /^postgres\.([a-z0-9]+)$/u.exec(decodeURIComponent(parsed.username).toLowerCase())?.[1];
  if (!value) throw new Error(`${kind} connection does not expose a project ref.`);
  return sha256(value);
}

function assertRestorePoint() {
  if (process.env[`${ENV_PREFIX}_RESTORE_VERIFIED`] !== "true") {
    throw new Error(`${ENV_PREFIX}_RESTORE_VERIFIED=true is required.`);
  }
  const reference = process.env[`${ENV_PREFIX}_RESTORE_REFERENCE`]?.trim() ?? "";
  const parsedAt = Date.parse(process.env[`${ENV_PREFIX}_RESTORE_POINT_AT`]?.trim() ?? "");
  const ageMs = Date.now() - parsedAt;
  if (reference.length < 8 || !Number.isFinite(parsedAt) || ageMs < 0
    || ageMs > 7 * 24 * 60 * 60 * 1000) {
    throw new Error("A verified restore point no older than seven days is required.");
  }
  return {
    reference,
    restore_point_at: new Date(parsedAt).toISOString(),
    age_hours: Math.round(ageMs / 36e5 * 10) / 10,
    verified: true
  };
}

function assertTarget(databaseUrl: string, poolerUrl: string | null, mode: Mode) {
  const local = isLocalDatabaseUrl(databaseUrl);
  if (local) return { local, target: "local", restore: null };
  const declared = (process.env.NOISIA_REMOTE_DATABASE_TARGET ?? "").trim().toLowerCase();
  const directFingerprint = targetFingerprint(databaseUrl);
  if (!(["preview", "staging"] as string[]).includes(declared)
    || databaseUrlLooksProductionLike(databaseUrl)
    || directFingerprint !== EXPECTED_DIRECT_FINGERPRINT
    || process.env[`${ENV_PREFIX}_TARGET_FINGERPRINT`] !== directFingerprint
    || !poolerUrl || targetFingerprint(poolerUrl) !== EXPECTED_POOLER_FINGERPRINT
    || projectRefHash(databaseUrl, "direct") !== EXPECTED_PROJECT_REF_HASH
    || projectRefHash(poolerUrl, "pooler") !== EXPECTED_PROJECT_REF_HASH) {
    throw new Error("0071 target identity is not the audited noisia-staging project.");
  }
  if (process.env[`${ENV_PREFIX}_ALLOW_REMOTE`] !== "true"
    || process.env[`${ENV_PREFIX}_NO_APP_CONNECTIONS_CONFIRMED`] !== "true") {
    throw new Error("Remote preflight approval and no-app confirmation are required.");
  }
  requireSafeDatabaseReadTarget(databaseUrl, {
    operation: "inspect governed brand binding migration 0071",
    allowRemoteEnv: `${ENV_PREFIX}_ALLOW_REMOTE`
  });
  if (mode === "apply") {
    if (process.env[`${ENV_PREFIX}_APPLY_APPROVED`] !== "true"
      || process.env[`${ENV_PREFIX}_ALLOW_REMOTE_APPLY`] !== "true"
      || process.env[`${ENV_PREFIX}_ISOLATED_TARGET_CONFIRMED`] !== "true"
      || !/^sha256:[0-9a-f]{64}$/u.test(process.env[`${ENV_PREFIX}_EXPECTED_STATE_DIGEST`] ?? "")) {
      throw new Error("0071 remote apply requires its specific approval, isolation and preflight digest.");
    }
    requireSafeDatabaseWriteTarget(databaseUrl, {
      operation: "apply governed brand binding migration 0071",
      allowRemoteEnv: `${ENV_PREFIX}_ALLOW_REMOTE_APPLY`
    });
  }
  return { local, target: declared, restore: assertRestorePoint() };
}

async function hasFunction(client: pg.Client, signature: string, token: string) {
  const result = await client.query<{ present: boolean }>(`
    SELECT COALESCE(position($2 in pg_get_functiondef(to_regprocedure($1))) > 0,false) AS present
  `, [`public.${signature}`, token]);
  return result.rows[0]?.present === true;
}

async function inspectMigration(client: pg.Client) {
  const checks = [
    ["column:event.request_digest", await scalar<boolean>(client, `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_schema='public'
        AND table_name='signal_governed_view_binding_events' AND column_name='request_digest')`)],
    ["column:event.next_nullable", await scalar<boolean>(client, `SELECT is_nullable='YES'
      FROM information_schema.columns WHERE table_schema='public'
        AND table_name='signal_governed_view_binding_events' AND column_name='next_binding_id'`)],
    ["table:set_operations", (await client.query("SELECT to_regclass('public.signal_governed_brand_binding_set_operations') IS NOT NULL AS present")).rows[0]?.present === true],
    ["table:set_items", (await client.query("SELECT to_regclass('public.signal_governed_brand_binding_set_operation_items') IS NOT NULL AS present")).rows[0]?.present === true],
    ["function:withdraw", await hasFunction(client,
      "withdraw_signal_governed_view_binding(uuid,text,text,uuid,uuid,text,text)", "withdraw-to-bridge")],
    ["function:binding_digest", await hasFunction(client,
      "signal_governed_view_binding_digest_v1(uuid)", "binding.binding_version")],
    ["function:event_contract", await hasFunction(client,
      "enforce_signal_governed_view_binding_event_contract()", "Bridge withdrawal")],
    ["function:set_operation", await hasFunction(client,
      "enforce_signal_governed_brand_binding_set_operation()", "cross-workspace or unauthorized")],
    ["function:set_item", await hasFunction(client,
      "enforce_signal_governed_brand_binding_set_item()", "incompatible with its operation")],
    ["function:append_only", await hasFunction(client,
      "prevent_signal_governed_brand_binding_set_mutation()", "append-only")],
    ["constraint:event_shape", await constraintExists(client, "signal_governed_view_binding_event_transition_shape")],
    ["constraint:event_digest", await constraintExists(client, "signal_governed_view_binding_event_request_digest")],
    ["constraint:set_hashes", await constraintExists(client, "signal_governed_brand_binding_set_hashes")],
    ["index:set_history", await scalar<boolean>(client,
      "SELECT to_regclass('public.idx_signal_governed_brand_binding_set_history') IS NOT NULL")]
  ] as Array<[string, boolean]>;
  const present = checks.filter(([, value]) => value).length;
  const state: MigrationState = present === 0 ? "absent" : present === checks.length ? "complete" : "partial";
  return { state, required: checks.length, present, missing: checks.filter(([, value]) => !value).map(([key]) => key) };
}

async function constraintExists(client: pg.Client, name: string) {
  return scalar<boolean>(client, "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=$1)", [name]);
}

async function readLedger(client: pg.Client) {
  return (await client.query(`
    SELECT migration_name,ordinal,checksum_sha256,disposition,runner_version,target_fingerprint
    FROM ${LEDGER} WHERE ordinal BETWEEN 59 AND 71 ORDER BY ordinal
  `)).rows;
}

async function assertPrerequisites(client: pg.Client, migration: Awaited<ReturnType<typeof inspectMigration>>) {
  const ledger = await readLedger(client);
  for (const [ordinal, checksum] of [
    [68, "sha256:77785c5e5507b41d72e8a9e9ed649aa2ce229063609087d95af54d33ff20121f"],
    [69, "sha256:2f8bfa4139edf8c8f2add1f4a3c5e8068b801aeee911a2258c679fd018241eff"],
    [70, "sha256:b73a230a7c21e90936d55059625cb7014d682e832212276fead593d266f3e910"]
  ] as const) {
    if (!ledger.some((row) => row.ordinal === ordinal && row.checksum_sha256 === checksum)) {
      throw new Error(`Prerequisite ledger/checksum ${ordinal} is missing.`);
    }
  }
  const recorded = ledger.filter((row) => row.ordinal === 71);
  if (migration.state === "partial" || recorded.length > 1
    || (recorded.length === 0 && migration.state === "complete")
    || (recorded.length === 1 && (migration.state !== "complete"
      || recorded[0]?.migration_name !== FILENAME || recorded[0]?.checksum_sha256 !== CHECKSUM))) {
    throw new Error("0071 ledger and sentinels disagree or are partial.");
  }
  return ledger;
}

async function digestQuery(client: pg.Client, fromSql: string, orderSql: string) {
  return (await client.query(`
    SELECT count(*)::int AS row_count,
      'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
        to_jsonb(row_value.*)::text,E'\\n' ORDER BY ${orderSql}),''),'UTF8')),'hex') AS content_hash
    FROM ${fromSql} row_value
  `)).rows[0]!;
}

async function inspectProtectedState(client: pg.Client) {
  const v1 = (await client.query(`
    WITH v1 AS (
      SELECT definition.id,definition.workspace_id
      FROM signal_population_definitions definition
      JOIN signal_workspace_population_pointers pointer ON pointer.population_id=definition.id
      WHERE pointer.purpose='operational' AND definition.population_key='primary-brand-operational'
        AND definition.definition->>'contract_version' IS DISTINCT FROM 'signal-operational-primary-brand-semantic-v2'
    ), members AS (
      SELECT concat_ws('|',v1.workspace_id::text,v1.id::text,membership.mention_id::text,
        membership.membership_status,COALESCE(membership.removed_at::text,'∅')) AS value
      FROM v1 LEFT JOIN signal_population_memberships membership ON membership.population_id=v1.id
    )
    SELECT (SELECT count(*)::int FROM signal_population_memberships m JOIN v1 ON v1.id=m.population_id) AS membership_count,
      (SELECT count(*)::int FROM signal_population_memberships m JOIN v1 ON v1.id=m.population_id
        WHERE m.membership_status='included' AND m.removed_at IS NULL) AS included_count,
      'sha256:' || encode(sha256(convert_to(COALESCE((SELECT string_agg(value,E'\\n' ORDER BY value) FROM members),''),'UTF8')),'hex') AS digest
  `)).rows[0]!;
  const base = (await client.query(`
    WITH base AS (
      SELECT definition.id,definition.membership_digest FROM brands brand
      JOIN signal_workspaces workspace ON workspace.brand_id=brand.id
      JOIN signal_population_definitions definition ON definition.workspace_id=workspace.id
      WHERE brand.slug='laika' AND definition.definition->>'contract_version'='signal-operational-primary-brand-semantic-v2'
    ), members AS (
      SELECT membership.mention_id FROM base JOIN signal_population_memberships membership
        ON membership.population_id=base.id
      WHERE membership.membership_status='included' AND membership.removed_at IS NULL
    ) SELECT (SELECT count(*)::int FROM members) AS membership_count,
      (SELECT membership_digest FROM base) AS membership_digest,
      'sha256:' || encode(sha256(convert_to(COALESCE((SELECT string_agg(mention_id::text,',' ORDER BY mention_id) FROM members),''),'UTF8')),'hex') AS computed_digest
  `)).rows[0]!;
  const domains = {
    pointers: await digestQuery(client, "signal_workspace_population_pointers", "row_value.workspace_id,row_value.purpose"),
    v1_definitions: await digestQuery(client, `(SELECT definition.* FROM signal_population_definitions definition
      WHERE definition.population_key='primary-brand-operational')`, "row_value.workspace_id,row_value.id"),
    semantic_base: await digestQuery(client, `(SELECT definition.* FROM signal_population_definitions definition
      WHERE definition.definition->>'contract_version'='signal-operational-primary-brand-semantic-v2')`, "row_value.workspace_id,row_value.id"),
    semantic_assertions: await digestQuery(client, "signal_mention_attributions", "row_value.workspace_id,row_value.mention_id,row_value.id"),
    review_events: await digestQuery(client, "signal_mention_attribution_review_events", "row_value.workspace_id,row_value.created_at,row_value.id"),
    derivations: await digestQuery(client, "signal_governed_view_population_derivations", "row_value.workspace_id,row_value.module_key,row_value.view_key"),
    compilations: await digestQuery(client, "signal_population_policy_compilations", "row_value.workspace_id,row_value.module_key,row_value.view_key,row_value.compilation_version"),
    governed_bindings: await digestQuery(client, "signal_governed_view_bindings", "row_value.workspace_id,row_value.module_key,row_value.view_key,row_value.binding_version"),
    bundle: await digestQuery(client, `(SELECT bundle.* FROM signal_population_policy_bundles bundle
      WHERE bundle.policy_key='operational-brand-governed' AND bundle.policy_version=1)`, "row_value.workspace_id,row_value.id"),
    running_syncs: await digestQuery(client, "(SELECT * FROM source_sync_runs WHERE status='running')", "row_value.id")
  };
  const protectedState = { operational_v1: v1, semantic_base_memberships: base, ...domains };
  return { ...protectedState, aggregate_hash: sha256(stableJson(protectedState)) };
}

function assertAuthorizedState(state: Awaited<ReturnType<typeof inspectProtectedState>>, local: boolean) {
  if (local) return;
  if (state.operational_v1.digest !== EXPECTED_V1_DIGEST
    || state.semantic_base_memberships.membership_count !== 276
    || state.semantic_base_memberships.membership_digest !== EXPECTED_BASE_DIGEST
    || state.semantic_base_memberships.computed_digest !== EXPECTED_BASE_DIGEST
    || state.governed_bindings.row_count !== 0) {
    throw new Error("Remote protected state differs from the authorized Backend 05A input.");
  }
}

async function inspectActivity(client: pg.Client) {
  const activity = (await client.query(`
    SELECT count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid()
      AND state IS DISTINCT FROM 'idle')::int AS active_incompatible,
      count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid()
      AND COALESCE(application_name,'') ~* '(studio|worker|bullmq)')::int AS named_apps,
      count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid()
      AND state IS DISTINCT FROM 'idle' AND query !~* '^\\s*(select|show|set|begin|commit|rollback)')::int AS active_writers
    FROM pg_stat_activity WHERE datname=current_database()
  `)).rows[0]!;
  if (activity.active_incompatible > 0 || activity.named_apps > 0 || activity.active_writers > 0) {
    throw new Error("Studio, Workers or another writer is connected to noisia-staging.");
  }
  return { ...activity, application_names_redacted: true };
}

async function inspectPeer(databaseUrl: string) {
  const client = new pg.Client({ connectionString: databaseUrl, ssl: getDatabaseSslConfig(), application_name: "noisia-binding-0071-pooler" });
  await client.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const state = {
      database_name_hash: sha256((await client.query("SELECT current_database() AS name")).rows[0]!.name),
      migration: await inspectMigration(client),
      ledger_digest: sha256(stableJson(await readLedger(client))),
      protected_state_hash: (await inspectProtectedState(client)).aggregate_hash
    };
    await client.query("ROLLBACK");
    return state;
  } finally {
    await client.end();
  }
}

async function scalar<T>(client: pg.Client, sql: string, params: unknown[] = []) {
  const result = await client.query<Record<string, T>>(sql, params);
  return Object.values(result.rows[0] ?? {})[0] as T;
}

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const poolerUrl = process.env[`${ENV_PREFIX}_POOLER_DATABASE_URL`]?.trim() || null;
  const mode = readMode();
  const target = assertTarget(databaseUrl, poolerUrl, mode);
  const fingerprint = targetFingerprint(databaseUrl);
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const migrationSql = await readFile(join(root, "migrations", FILENAME), "utf8");
  if (sha256(migrationSql) !== CHECKSUM) throw new Error("0071 local checksum mismatch.");
  const client = new pg.Client({ connectionString: databaseUrl, ssl: getDatabaseSslConfig(), application_name: "noisia-binding-0071-direct" });
  await client.connect();
  let readOnly = false;
  try {
    await client.query("SET statement_timeout='15min'; SET lock_timeout='15s'");
    if (mode !== "apply") {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      readOnly = true;
    }
    const migrationBefore = await inspectMigration(client);
    const ledgerBefore = await assertPrerequisites(client, migrationBefore);
    const activity = await inspectActivity(client);
    const protectedBefore = await inspectProtectedState(client);
    assertAuthorizedState(protectedBefore, target.local);
    const directIdentity = {
      database_name_hash: sha256((await client.query("SELECT current_database() AS name")).rows[0]!.name),
      migration: migrationBefore,
      ledger_digest: sha256(stableJson(ledgerBefore)),
      protected_state_hash: protectedBefore.aggregate_hash
    };
    const peer = !target.local && poolerUrl ? await inspectPeer(poolerUrl) : null;
    if (peer && stableJson(peer) !== stableJson(directIdentity)) {
      throw new Error("Direct and pooler connections expose different database state.");
    }
    let writesPerformed = false;
    let actions: Array<{ migration: string; action: string }> = [];
    if (mode === "apply") {
      if (process.env[`${ENV_PREFIX}_EXPECTED_STATE_DIGEST`] !== protectedBefore.aggregate_hash) {
        throw new Error("Protected state changed after the 0071 preflight.");
      }
      await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [LOCK_KEY]);
      try {
        if (migrationBefore.state !== "absent" || ledgerBefore.some((row) => row.ordinal === 71)) {
          throw new Error("0071 is not cleanly absent; automatic reapply is refused.");
        }
        await client.query("BEGIN");
        try {
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [LOCK_KEY]);
          await client.query(migrationSql);
          const afterMigration = await inspectMigration(client);
          if (afterMigration.state !== "complete") throw new Error(`0071 sentinels failed: ${afterMigration.missing.join(", ")}.`);
          if ((await inspectProtectedState(client)).aggregate_hash !== protectedBefore.aggregate_hash) {
            throw new Error("0071 changed protected product state.");
          }
          await client.query(`INSERT INTO ${LEDGER} (
            migration_name,ordinal,checksum_sha256,disposition,runner_version,target_fingerprint
          ) VALUES ($1,71,$2,'applied',$3,$4)`, [FILENAME, CHECKSUM, RUNNER_VERSION, fingerprint]);
          await client.query("COMMIT");
          writesPerformed = true;
          actions = [{ migration: FILENAME, action: "applied" }];
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      } finally {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [LOCK_KEY]);
      }
    }
    const migrationAfter = await inspectMigration(client);
    const ledgerAfter = await readLedger(client);
    const protectedAfter = await inspectProtectedState(client);
    assertAuthorizedState(protectedAfter, target.local);
    if (mode === "verify") {
      const row = ledgerAfter.filter((entry) => entry.ordinal === 71);
      if (migrationAfter.state !== "complete" || row.length !== 1
        || row[0]?.migration_name !== FILENAME || row[0]?.checksum_sha256 !== CHECKSUM) {
        throw new Error("0071 verify requires complete sentinels and one exact ledger row.");
      }
    }
    if (protectedAfter.aggregate_hash !== protectedBefore.aggregate_hash) {
      throw new Error("Protected state changed during the 0071 runner.");
    }
    if (readOnly) {
      await client.query("ROLLBACK");
      readOnly = false;
    }
    console.log(JSON.stringify({
      ok: true,
      runner_version: RUNNER_VERSION,
      mode,
      target: target.target,
      target_fingerprint: fingerprint,
      project_ref_hash: target.local ? null : EXPECTED_PROJECT_REF_HASH,
      target_identity: { direct: directIdentity, pooler: peer, same_project: peer !== null, same_database_state: peer !== null },
      restore_point: target.restore,
      migration: { ordinal: 71, filename: FILENAME, checksum: CHECKSUM },
      migration_before: migrationBefore,
      migration_after: migrationAfter,
      ledger_before: ledgerBefore,
      ledger_after: ledgerAfter,
      writes_performed: writesPerformed,
      actions,
      connections: activity,
      protected_state_before: protectedBefore,
      protected_state_after: protectedAfter,
      protected_state_equal: protectedBefore.aggregate_hash === protectedAfter.aggregate_hash,
      governed_bindings_created: false,
      pointers_changed: false,
      readers_changed: false,
      workers_llm_tb_executed: false,
      production_touched: false
    }, null, 2));
  } finally {
    if (readOnly) await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

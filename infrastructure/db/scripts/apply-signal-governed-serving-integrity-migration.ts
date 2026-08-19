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

const RUNNER_VERSION = "signal-governed-serving-integrity-migration-v1";
const LEDGER = "signal_workspace_data_plane_migration_ledger";
const LOCK_KEY = "noisia:signal-governed-serving-integrity:0072";
const FILENAME = "0072_signal_governed_brand_binding_set_integrity.sql";
const ORDINAL = 72;
const CHECKSUM = "sha256:1c974ec09871c28a439bb23a7753b6b0a9d8915539493bff3c364515bbbd4738";
const EXPECTED_DIRECT_FINGERPRINT =
  "sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19";
const EXPECTED_POOLER_FINGERPRINT =
  "sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815";
const EXPECTED_PROJECT_REF_HASH =
  "sha256:030c5a33e3b28881c4d77983a6049bbfa16c995da232454081cbccfcfa78aa32";

const ENV_PREFIX = "NOISIA_SIGNAL_GOVERNED_SERVING_INTEGRITY_MIGRATION";
const MODE_ENV = `${ENV_PREFIX}_MODE`;
const POOLER_URL_ENV = `${ENV_PREFIX}_POOLER_DATABASE_URL`;
const PREFLIGHT_ALLOW_REMOTE_ENV = `${ENV_PREFIX}_PREFLIGHT_ALLOW_REMOTE`;
const APPLY_ALLOW_REMOTE_ENV = `${ENV_PREFIX}_ALLOW_REMOTE_APPLY`;
const APPLY_APPROVED_ENV = `${ENV_PREFIX}_APPLY_APPROVED`;
const TARGET_FINGERPRINT_ENV = `${ENV_PREFIX}_TARGET_FINGERPRINT`;
const EXPECTED_STATE_DIGEST_ENV = `${ENV_PREFIX}_EXPECTED_STATE_DIGEST`;
const ISOLATED_TARGET_ENV = `${ENV_PREFIX}_ISOLATED_TARGET_CONFIRMED`;
const NO_APP_CONNECTIONS_ENV = `${ENV_PREFIX}_NO_APP_CONNECTIONS_CONFIRMED`;
const RESTORE_VERIFIED_ENV = `${ENV_PREFIX}_RESTORE_VERIFIED`;
const RESTORE_REFERENCE_ENV = `${ENV_PREFIX}_RESTORE_REFERENCE`;
const RESTORE_POINT_AT_ENV = `${ENV_PREFIX}_RESTORE_POINT_AT`;

type Mode = "preflight" | "apply" | "verify";
type MigrationState = "absent" | "partial" | "complete";

type LedgerRow = {
  migration_name: string;
  ordinal: number;
  checksum_sha256: string;
  disposition: string;
  runner_version: string;
  target_fingerprint: string;
};

type Check = { key: string; present: boolean; marker: boolean };

const PROTECTED_TABLES = [
  "signal_population_definitions",
  "signal_population_memberships",
  "signal_workspace_population_pointers",
  "signal_mention_attributions",
  "signal_mention_attribution_review_events",
  "signal_population_policy_bundles",
  "signal_population_policy_entities",
  "signal_population_policy_compilations",
  "signal_quality_policies",
  "signal_retention_policies",
  "signal_licensing_policies",
  "signal_licensing_policy_usages",
  "signal_provenance_policy_bindings",
  "signal_data_governance_policy_events",
  "signal_governed_view_population_derivations",
  "signal_data_governance_evaluations",
  "signal_data_governance_evaluation_items",
  "signal_data_governance_invalidations",
  "signal_governed_view_bindings",
  "signal_governed_view_binding_events",
  "signal_governed_brand_binding_set_operations",
  "signal_governed_brand_binding_set_operation_items",
  "signal_snapshot_watermarks",
  "metric_materializations",
  "signal_operational_shadow_requests",
  "signal_operational_serving_shadow_results",
  "source_sync_runs"
] as const;

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
  const value = (process.env[MODE_ENV] ?? "preflight").trim().toLowerCase();
  if (value === "preflight" || value === "apply" || value === "verify") return value;
  throw new Error(`${MODE_ENV} must be preflight, apply or verify.`);
}

function targetFingerprint(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  return sha256([
    parsed.protocol,
    parsed.hostname.toLowerCase(),
    parsed.port || "5432",
    parsed.pathname.replace(/^\//u, ""),
    parsed.username
  ].join("|"));
}

function projectRefHash(databaseUrl: string, kind: "direct" | "pooler") {
  const parsed = new URL(databaseUrl);
  const projectRef = kind === "direct"
    ? /^db\.([a-z0-9]+)\.supabase\.co$/u.exec(parsed.hostname.toLowerCase())?.[1]
    : /^postgres\.([a-z0-9]+)$/u.exec(decodeURIComponent(parsed.username).toLowerCase())?.[1];
  if (!projectRef) throw new Error(`${kind} connection does not expose a project ref.`);
  return sha256(projectRef);
}

function assertFreshRestorePoint() {
  if (process.env[RESTORE_VERIFIED_ENV] !== "true") {
    throw new Error(`${RESTORE_VERIFIED_ENV}=true is required.`);
  }
  const reference = process.env[RESTORE_REFERENCE_ENV]?.trim() ?? "";
  const restoreAt = Date.parse(process.env[RESTORE_POINT_AT_ENV]?.trim() ?? "");
  const ageMs = Date.now() - restoreAt;
  if (reference.length < 8 || !Number.isFinite(restoreAt) || ageMs < 0
    || ageMs > 24 * 60 * 60 * 1000) {
    throw new Error("A non-empty verified restore point no older than 24 hours is required.");
  }
  return {
    reference,
    restore_point_at: new Date(restoreAt).toISOString(),
    age_hours: Math.round(ageMs / 36e5 * 10) / 10,
    verified: true
  };
}

function assertTarget(
  databaseUrl: string,
  poolerUrl: string | null,
  mode: Mode,
  fingerprint: string
) {
  const local = isLocalDatabaseUrl(databaseUrl);
  if (local) {
    if (mode === "apply" && process.env[APPLY_APPROVED_ENV] !== "true") {
      throw new Error(`${APPLY_APPROVED_ENV}=true is required even for a local apply.`);
    }
    return { local, target: "local", restore_point: null };
  }

  const declared = (process.env.NOISIA_REMOTE_DATABASE_TARGET ?? "").trim().toLowerCase();
  if (declared !== "preview" && declared !== "staging") {
    throw new Error("0072 remote rehearsal requires an explicitly classified preview or staging target.");
  }
  if (databaseUrlLooksProductionLike(databaseUrl)) throw new Error("Refusing production-like target.");
  if (process.env[PREFLIGHT_ALLOW_REMOTE_ENV] !== "true"
    || process.env[NO_APP_CONNECTIONS_ENV] !== "true") {
    throw new Error("0072 remote inspection requires its explicit allow flag and no-app acknowledgement.");
  }
  if (fingerprint !== EXPECTED_DIRECT_FINGERPRINT
    || process.env[TARGET_FINGERPRINT_ENV] !== fingerprint
    || !poolerUrl
    || targetFingerprint(poolerUrl) !== EXPECTED_POOLER_FINGERPRINT
    || projectRefHash(databaseUrl, "direct") !== EXPECTED_PROJECT_REF_HASH
    || projectRefHash(poolerUrl, "pooler") !== EXPECTED_PROJECT_REF_HASH) {
    throw new Error("0072 target identity is not the audited noisia-staging project.");
  }
  const restorePoint = assertFreshRestorePoint();
  requireSafeDatabaseReadTarget(databaseUrl, {
    operation: "inspect governed serving integrity migration 0072",
    allowRemoteEnv: PREFLIGHT_ALLOW_REMOTE_ENV
  });

  if (mode === "apply") {
    if (process.env[APPLY_APPROVED_ENV] !== "true"
      || process.env[APPLY_ALLOW_REMOTE_ENV] !== "true"
      || process.env[ISOLATED_TARGET_ENV] !== "true"
      || !/^sha256:[0-9a-f]{64}$/u.test(process.env[EXPECTED_STATE_DIGEST_ENV] ?? "")) {
      throw new Error("0072 apply requires its specific approval, isolation and preflight digest.");
    }
    requireSafeDatabaseWriteTarget(databaseUrl, {
      operation: "apply governed serving integrity migration 0072",
      allowRemoteEnv: APPLY_ALLOW_REMOTE_ENV
    });
  }

  return { local, target: declared, restore_point: restorePoint };
}

async function functionContainsAll(client: pg.Client, signature: string, tokens: string[]) {
  const definition = await client.query<{ definition: string | null }>(`
    SELECT pg_get_functiondef(to_regprocedure($1)) AS definition
  `, [`public.${signature}`]);
  const value = definition.rows[0]?.definition ?? "";
  return tokens.every((token) => value.includes(token));
}

async function triggerContainsAll(client: pg.Client, name: string, tokens: string[]) {
  const result = await client.query<{ definition: string | null }>(`
    SELECT pg_get_triggerdef(oid,true) AS definition
    FROM pg_trigger WHERE tgname=$1 AND NOT tgisinternal
  `, [name]);
  if (result.rowCount !== 1) return false;
  const value = result.rows[0]?.definition ?? "";
  return tokens.every((token) => value.includes(token));
}

async function inspectMigration(client: pg.Client) {
  const checks: Check[] = [
    {
      key: "function:item_exact_authority",
      marker: true,
      present: await functionContainsAll(client,
        "enforce_signal_governed_brand_binding_set_item()", [
          "event.actor_user_id IS DISTINCT FROM operation.actor_user_id",
          "next_binding.policy_bundle_id IS DISTINCT FROM operation.policy_bundle_id",
          "previous_binding.policy_bundle_id IS DISTINCT FROM operation.policy_bundle_id",
          "incompatible with its operation authority"
        ])
    },
    {
      key: "function:canonical_cardinality",
      marker: true,
      present: await functionContainsAll(client,
        "enforce_signal_governed_brand_binding_set_cardinality()", [
          "observed_count <> 3",
          "brand-monitoring",
          "topics-narratives",
          "requires exactly the three canonical brand modules"
        ])
    },
    {
      key: "trigger:canonical_cardinality_deferred",
      marker: true,
      present: await triggerContainsAll(client,
        "trg_signal_governed_brand_binding_set_cardinality", [
          "CREATE CONSTRAINT TRIGGER",
          "AFTER INSERT",
          "DEFERRABLE INITIALLY DEFERRED",
          "enforce_signal_governed_brand_binding_set_cardinality()"
        ])
    },
    {
      key: "function:referenced_binding_history",
      marker: true,
      present: await functionContainsAll(client,
        "protect_signal_governed_brand_referenced_binding_history()", [
          "OLD.binding_status = 'current'",
          "NEW.binding_status = 'retired'",
          "ARRAY['binding_status','effective_to']",
          "immutable except for its current-to-retired lifecycle transition"
        ])
    },
    {
      key: "trigger:referenced_binding_history",
      marker: true,
      present: await triggerContainsAll(client,
        "trg_signal_governed_brand_referenced_binding_history", [
          "BEFORE DELETE OR UPDATE",
          "signal_governed_view_bindings",
          "protect_signal_governed_brand_referenced_binding_history()"
        ])
    },
    {
      key: "trigger:item_authority",
      marker: false,
      present: await triggerContainsAll(client,
        "trg_signal_governed_brand_binding_set_item", [
          "BEFORE INSERT",
          "signal_governed_brand_binding_set_operation_items",
          "enforce_signal_governed_brand_binding_set_item()"
        ])
    },
    {
      key: "trigger:operations_append_only",
      marker: false,
      present: await triggerContainsAll(client,
        "trg_signal_governed_brand_binding_set_operations_append_only", [
          "BEFORE DELETE OR UPDATE",
          "signal_governed_brand_binding_set_operations",
          "prevent_signal_governed_brand_binding_set_mutation()"
        ])
    },
    {
      key: "trigger:items_append_only",
      marker: false,
      present: await triggerContainsAll(client,
        "trg_signal_governed_brand_binding_set_items_append_only", [
          "BEFORE DELETE OR UPDATE",
          "signal_governed_brand_binding_set_operation_items",
          "prevent_signal_governed_brand_binding_set_mutation()"
        ])
    },
    {
      key: "trigger:events_append_only",
      marker: false,
      present: await triggerContainsAll(client,
        "trg_signal_governed_view_binding_events_append_only", [
          "BEFORE DELETE OR UPDATE",
          "signal_governed_view_binding_events",
          "prevent_signal_governed_view_binding_event_mutation()"
        ])
    }
  ];
  const markerCount = checks.filter((check) => check.marker && check.present).length;
  const present = checks.filter((check) => check.present).length;
  const state: MigrationState = markerCount === 0
    ? "absent"
    : present === checks.length ? "complete" : "partial";
  return {
    state,
    required: checks.length,
    present,
    marker_required: checks.filter((check) => check.marker).length,
    marker_present: markerCount,
    checks: Object.fromEntries(checks.map((check) => [check.key, check.present])),
    missing: checks.filter((check) => !check.present).map((check) => check.key)
  };
}

async function readLedger(client: pg.Client) {
  return (await client.query<LedgerRow>(`
    SELECT migration_name,ordinal,checksum_sha256,disposition,runner_version,target_fingerprint
    FROM ${LEDGER} WHERE ordinal >= 59 ORDER BY ordinal
  `)).rows;
}

async function assertPrerequisites(
  client: pg.Client,
  migration: Awaited<ReturnType<typeof inspectMigration>>
) {
  const ledger = await readLedger(client);
  const missing = Array.from({ length: 13 }, (_, index) => index + 59)
    .filter((ordinal) => !ledger.some((row) => row.ordinal === ordinal));
  if (missing.length > 0) throw new Error(`Missing prerequisite ledger ordinals: ${missing.join(",")}.`);
  if (ledger.some((row) => row.ordinal > ORDINAL)) {
    throw new Error("Unexpected migration exists after 0072.");
  }
  for (const [ordinal, checksum] of [
    [68, "sha256:77785c5e5507b41d72e8a9e9ed649aa2ce229063609087d95af54d33ff20121f"],
    [69, "sha256:2f8bfa4139edf8c8f2add1f4a3c5e8068b801aeee911a2258c679fd018241eff"],
    [70, "sha256:b73a230a7c21e90936d55059625cb7014d682e832212276fead593d266f3e910"],
    [71, "sha256:df1381a270083b0fc91943e1a7be438b9fa4fd71c736ce2b2ad3ed85e1c44b11"]
  ] as const) {
    if (ledger.find((row) => row.ordinal === ordinal)?.checksum_sha256 !== checksum) {
      throw new Error(`Prerequisite checksum drift for ${ordinal}.`);
    }
  }
  const recorded = ledger.filter((row) => row.ordinal === ORDINAL);
  if (migration.state === "partial") {
    throw new Error(`0072 is partial: ${migration.missing.join(", ")}.`);
  }
  if (recorded.length > 1
    || (recorded.length === 0 && migration.state === "complete")
    || (recorded.length === 1 && (migration.state !== "complete"
      || recorded[0]?.migration_name !== FILENAME
      || recorded[0]?.checksum_sha256 !== CHECKSUM))) {
    throw new Error("0072 ledger and sentinels disagree or its checksum is incompatible.");
  }
  return ledger;
}

async function digestTable(client: pg.Client, table: string) {
  const exists = (await client.query<{ present: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS present", [`public.${table}`]
  )).rows[0]?.present === true;
  if (!exists) throw new Error(`Protected table ${table} is missing.`);
  return (await client.query<{ row_count: number; content_hash: string }>(`
    SELECT count(*)::int AS row_count,
      'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
        to_jsonb(protected_row)::text,E'\\n' ORDER BY to_jsonb(protected_row)::text
      ),''),'UTF8')),'hex') AS content_hash
    FROM ${table} protected_row
  `)).rows[0]!;
}

async function inspectProtectedState(client: pg.Client) {
  const domains: Record<string, { row_count: number; content_hash: string }> = {};
  for (const table of PROTECTED_TABLES) domains[table] = await digestTable(client, table);

  const summary = (await client.query<{
    operational_v1_definitions: number;
    operational_v1_pointers: number;
    operational_v1_memberships: number;
    operational_v1_included: number;
    semantic_base_definitions: number;
    semantic_base_memberships: number;
    semantic_base_included: number;
    governed_current_bindings: number;
    current_compilations: number;
    review_events: number;
  }>(`
    WITH v1 AS (
      SELECT definition.id
      FROM signal_population_definitions definition
      WHERE definition.population_key='primary-brand-operational'
        AND definition.definition->>'contract_version'
          IS DISTINCT FROM 'signal-operational-primary-brand-semantic-v2'
    ), semantic_base AS (
      SELECT definition.id
      FROM signal_population_definitions definition
      WHERE definition.definition->>'contract_version'
        = 'signal-operational-primary-brand-semantic-v2'
    )
    SELECT
      (SELECT count(*)::int FROM v1) AS operational_v1_definitions,
      (SELECT count(*)::int FROM signal_workspace_population_pointers pointer
        JOIN v1 ON v1.id=pointer.population_id) AS operational_v1_pointers,
      (SELECT count(*)::int FROM signal_population_memberships membership
        JOIN v1 ON v1.id=membership.population_id) AS operational_v1_memberships,
      (SELECT count(*)::int FROM signal_population_memberships membership
        JOIN v1 ON v1.id=membership.population_id
        WHERE membership.membership_status='included' AND membership.removed_at IS NULL)
        AS operational_v1_included,
      (SELECT count(*)::int FROM semantic_base) AS semantic_base_definitions,
      (SELECT count(*)::int FROM signal_population_memberships membership
        JOIN semantic_base ON semantic_base.id=membership.population_id) AS semantic_base_memberships,
      (SELECT count(*)::int FROM signal_population_memberships membership
        JOIN semantic_base ON semantic_base.id=membership.population_id
        WHERE membership.membership_status='included' AND membership.removed_at IS NULL)
        AS semantic_base_included,
      (SELECT count(*)::int FROM signal_governed_view_bindings
        WHERE binding_status='current' AND effective_to IS NULL) AS governed_current_bindings,
      (SELECT count(*)::int FROM signal_population_policy_compilations
        WHERE is_current) AS current_compilations,
      (SELECT count(*)::int FROM signal_mention_attribution_review_events) AS review_events
  `)).rows[0]!;
  const protectedState = { summary, domains };
  return { ...protectedState, aggregate_hash: sha256(stableJson(protectedState)) };
}

async function inspectConnections(client: pg.Client, enforceIsolation: boolean) {
  const activity = (await client.query<{
    active_incompatible: number;
    named_apps: number;
    active_writers: number;
  }>(`
    SELECT
      count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid()
        AND state IS DISTINCT FROM 'idle'
        AND application_name<>'noisia-governed-serving-integrity-0072')::int
        AS active_incompatible,
      count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid()
        AND COALESCE(application_name,'') ~* '(studio|worker|bullmq)')::int AS named_apps,
      count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid()
        AND state IS DISTINCT FROM 'idle'
        AND query !~* '^\\s*(select|show|set|begin|commit|rollback)')::int AS active_writers
    FROM pg_stat_activity WHERE datname=current_database()
  `)).rows[0]!;
  if (enforceIsolation && (activity.active_incompatible > 0
    || activity.named_apps > 0 || activity.active_writers > 0)) {
    throw new Error("Studio, Workers or another incompatible writer is connected to the target.");
  }
  return { ...activity, application_names_redacted: true };
}

async function inspectIdentity(client: pg.Client) {
  const migration = await inspectMigration(client);
  const ledger = await readLedger(client);
  const protectedState = await inspectProtectedState(client);
  const databaseName = (await client.query<{ name: string }>(
    "SELECT current_database() AS name"
  )).rows[0]!.name;
  return {
    database_name_hash: sha256(databaseName),
    migration,
    ledger_digest: sha256(stableJson(ledger)),
    protected_state_hash: protectedState.aggregate_hash
  };
}

async function inspectPeer(databaseUrl: string) {
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig(),
    application_name: "noisia-governed-serving-integrity-0072-peer"
  });
  await client.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const identity = await inspectIdentity(client);
    await client.query("ROLLBACK");
    return identity;
  } finally {
    await client.end();
  }
}

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const poolerUrl = process.env[POOLER_URL_ENV]?.trim() || null;
  const mode = readMode();
  const fingerprint = targetFingerprint(databaseUrl);
  const target = assertTarget(databaseUrl, poolerUrl, mode, fingerprint);
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const migrationSql = await readFile(join(root, "migrations", FILENAME), "utf8");
  if (sha256(migrationSql) !== CHECKSUM) throw new Error("0072 local checksum mismatch.");

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig(),
    application_name: "noisia-governed-serving-integrity-0072"
  });
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
    const connections = await inspectConnections(client, !target.local);
    const protectedBefore = await inspectProtectedState(client);
    const directIdentity = {
      database_name_hash: sha256((await client.query<{ name: string }>(
        "SELECT current_database() AS name"
      )).rows[0]!.name),
      migration: migrationBefore,
      ledger_digest: sha256(stableJson(ledgerBefore)),
      protected_state_hash: protectedBefore.aggregate_hash
    };
    const peerIdentity = !target.local && poolerUrl ? await inspectPeer(poolerUrl) : null;
    if (peerIdentity && stableJson(peerIdentity) !== stableJson(directIdentity)) {
      throw new Error("Direct and pooler connections expose different database state.");
    }

    let writesPerformed = false;
    let actions: Array<{ migration: string; action: "applied" | "verified_existing" }> = [];
    if (mode === "apply") {
      if (process.env[EXPECTED_STATE_DIGEST_ENV] !== protectedBefore.aggregate_hash) {
        throw new Error("Protected state changed after the 0072 preflight.");
      }
      await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [LOCK_KEY]);
      try {
        const lockedMigration = await inspectMigration(client);
        const lockedLedger = await assertPrerequisites(client, lockedMigration);
        const lockedProtected = await inspectProtectedState(client);
        if (lockedProtected.aggregate_hash !== protectedBefore.aggregate_hash) {
          throw new Error("Protected product state changed while waiting for the 0072 lock.");
        }
        if (lockedMigration.state === "complete") {
          actions = [{ migration: FILENAME, action: "verified_existing" }];
        } else {
          if (lockedMigration.state !== "absent"
            || lockedLedger.some((row) => row.ordinal === ORDINAL)) {
            throw new Error("0072 is not cleanly absent.");
          }
          await client.query("BEGIN");
          try {
            await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [LOCK_KEY]);
            await client.query(migrationSql);
            const migrationApplied = await inspectMigration(client);
            if (migrationApplied.state !== "complete") {
              throw new Error(`0072 sentinels failed: ${migrationApplied.missing.join(", ")}.`);
            }
            if ((await inspectProtectedState(client)).aggregate_hash !== protectedBefore.aggregate_hash) {
              throw new Error("0072 changed protected product state.");
            }
            await client.query(`INSERT INTO ${LEDGER} (
              migration_name,ordinal,checksum_sha256,disposition,runner_version,target_fingerprint
            ) VALUES ($1,$2,$3,'applied',$4,$5)`, [
              FILENAME, ORDINAL, CHECKSUM, RUNNER_VERSION, fingerprint
            ]);
            await client.query("COMMIT");
            writesPerformed = true;
            actions = [{ migration: FILENAME, action: "applied" }];
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          }
        }
      } finally {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [LOCK_KEY]);
      }
    }

    const migrationAfter = await inspectMigration(client);
    const ledgerAfter = await readLedger(client);
    const protectedAfter = await inspectProtectedState(client);
    if (mode === "verify") {
      const recorded = ledgerAfter.filter((row) => row.ordinal === ORDINAL);
      if (migrationAfter.state !== "complete" || recorded.length !== 1
        || recorded[0]?.migration_name !== FILENAME
        || recorded[0]?.checksum_sha256 !== CHECKSUM) {
        throw new Error("0072 verify requires complete sentinels and one exact ledger row.");
      }
    }
    if (protectedAfter.aggregate_hash !== protectedBefore.aggregate_hash) {
      throw new Error("Protected state changed during the 0072 runner.");
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
      target_identity: {
        direct: directIdentity,
        pooler: peerIdentity,
        same_project: target.local ? null : peerIdentity !== null,
        same_database_state: target.local ? null : peerIdentity !== null
      },
      restore_point: target.restore_point,
      migration: { ordinal: ORDINAL, filename: FILENAME, checksum: CHECKSUM },
      migration_before: migrationBefore,
      migration_after: migrationAfter,
      ledger_before: ledgerBefore,
      ledger_after: ledgerAfter,
      writes_performed: writesPerformed,
      actions,
      connections,
      protected_state_before: protectedBefore,
      protected_state_after: protectedAfter,
      protected_state_equal: protectedBefore.aggregate_hash === protectedAfter.aggregate_hash,
      governed_bindings_created_by_runner: false,
      pointers_changed: false,
      readers_changed: false,
      shadow_or_cutover_executed: false,
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

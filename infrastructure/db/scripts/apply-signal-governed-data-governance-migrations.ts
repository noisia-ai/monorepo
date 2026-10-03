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

const RUNNER_VERSION = "signal-governed-data-governance-migration-rehearsal-v1";
const LEDGER = "signal_workspace_data_plane_migration_ledger";
const LOCK_KEY = "noisia:signal-governed-data-governance:0068-0069";
const EXPECTED_REMOTE_FINGERPRINT =
  "sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19";

const MIGRATIONS = [
  {
    ordinal: 68,
    filename: "0068_signal_governed_views_population_policies.sql",
    checksum: "sha256:77785c5e5507b41d72e8a9e9ed649aa2ce229063609087d95af54d33ff20121f"
  },
  {
    ordinal: 69,
    filename: "0069_signal_data_governance_policies.sql",
    checksum: "sha256:2f8bfa4139edf8c8f2add1f4a3c5e8068b801aeee911a2258c679fd018241eff"
  }
] as const;

const MODE_ENV = "NOISIA_SIGNAL_GOVERNED_GOVERNANCE_MIGRATION_MODE";
const PREFLIGHT_ALLOW_REMOTE_ENV =
  "NOISIA_SIGNAL_GOVERNED_GOVERNANCE_PREFLIGHT_ALLOW_REMOTE";
const APPLY_ALLOW_REMOTE_ENV =
  "NOISIA_DB_APPLY_SIGNAL_GOVERNED_GOVERNANCE_ALLOW_REMOTE";
const APPLY_APPROVED_ENV =
  "NOISIA_SIGNAL_GOVERNED_GOVERNANCE_SCHEMA_APPLY_APPROVED";
const TARGET_FINGERPRINT_ENV =
  "NOISIA_SIGNAL_GOVERNED_GOVERNANCE_TARGET_FINGERPRINT";
const EXPECTED_STATE_DIGEST_ENV =
  "NOISIA_SIGNAL_GOVERNED_GOVERNANCE_EXPECTED_STATE_DIGEST";
const ISOLATED_TARGET_ENV =
  "NOISIA_SIGNAL_GOVERNED_GOVERNANCE_ISOLATED_TARGET_CONFIRMED";
const RESTORE_REFERENCE_ENV =
  "NOISIA_SIGNAL_GOVERNED_GOVERNANCE_RESTORE_REFERENCE";
const RESTORE_POINT_AT_ENV =
  "NOISIA_SIGNAL_GOVERNED_GOVERNANCE_RESTORE_POINT_AT";
const RESTORE_VERIFIED_ENV =
  "NOISIA_SIGNAL_GOVERNED_GOVERNANCE_RESTORE_VERIFIED";
const NO_APP_CONNECTIONS_ENV =
  "NOISIA_SIGNAL_GOVERNED_GOVERNANCE_NO_APP_CONNECTIONS_CONFIRMED";
const RUNNING_SYNCS_ACK_ENV =
  "NOISIA_SIGNAL_GOVERNED_GOVERNANCE_RUNNING_SYNCS_ACKNOWLEDGED";

type Mode = "preflight" | "apply" | "verify";
type MigrationState = "absent" | "partial" | "complete";
type Sentinel =
  | { kind: "table" | "index" | "trigger"; name: string }
  | { kind: "column" | "constraint"; relation: string; name: string }
  | { kind: "function"; signature: string; contains: string };

const SENTINELS_0068: Sentinel[] = [
  { kind: "table", name: "signal_population_policy_bundles" },
  { kind: "table", name: "signal_population_policy_entities" },
  { kind: "table", name: "signal_population_policy_compilations" },
  { kind: "table", name: "signal_governed_view_bindings" },
  { kind: "table", name: "signal_governed_view_binding_events" },
  { kind: "column", relation: "signal_population_policy_bundles", name: "definition_hash" },
  { kind: "column", relation: "signal_population_policy_compilations", name: "population_id" },
  { kind: "column", relation: "signal_governed_view_bindings", name: "module_key" },
  { kind: "column", relation: "signal_governed_view_bindings", name: "view_key" },
  { kind: "index", name: "uq_signal_population_policy_compilation_current" },
  { kind: "index", name: "uq_signal_governed_view_binding_current" },
  { kind: "trigger", name: "trg_signal_population_policy_compilation_contract" },
  { kind: "trigger", name: "trg_signal_governed_view_binding_contract" },
  {
    kind: "function",
    signature: "signal_population_policy_bundle_definition_hash(uuid)",
    contains: "signal-governed-views-v1"
  },
  {
    kind: "function",
    signature: "promote_signal_governed_view_binding(uuid,text,text,uuid,uuid,uuid,text,text)",
    contains: "idempotency"
  }
];

const SENTINELS_0069: Sentinel[] = [
  { kind: "table", name: "signal_quality_policies" },
  { kind: "table", name: "signal_retention_policies" },
  { kind: "table", name: "signal_licensing_policies" },
  { kind: "table", name: "signal_licensing_policy_usages" },
  { kind: "table", name: "signal_provenance_policy_bindings" },
  { kind: "table", name: "signal_data_governance_policy_events" },
  { kind: "table", name: "signal_governed_view_population_derivations" },
  { kind: "table", name: "signal_data_governance_evaluations" },
  { kind: "table", name: "signal_data_governance_evaluation_items" },
  { kind: "table", name: "signal_data_governance_invalidations" },
  { kind: "column", relation: "signal_population_policy_bundles", name: "quality_policy_id" },
  { kind: "column", relation: "signal_population_policy_bundles", name: "required_usage_purposes" },
  { kind: "column", relation: "signal_data_governance_evaluations", name: "module_key" },
  { kind: "column", relation: "signal_data_governance_evaluations", name: "view_key" },
  { kind: "column", relation: "signal_data_governance_evaluations", name: "next_policy_transition_at" },
  { kind: "column", relation: "signal_population_policy_compilations", name: "governance_evaluation_id" },
  { kind: "column", relation: "signal_population_policy_compilations", name: "next_policy_transition_at" },
  { kind: "index", name: "uq_signal_quality_policy_active" },
  { kind: "index", name: "uq_signal_retention_policy_active" },
  { kind: "index", name: "uq_signal_licensing_policy_active" },
  { kind: "index", name: "uq_signal_provenance_policy_binding_active" },
  { kind: "index", name: "idx_signal_governed_view_population_derivations_base" },
  { kind: "trigger", name: "trg_signal_data_governance_policy_event_contract" },
  { kind: "trigger", name: "trg_signal_population_policy_compilation_governance" },
  { kind: "trigger", name: "trg_signal_data_governance_provenance_invalidate" },
  {
    kind: "function",
    signature: "ensure_signal_governed_view_population_derivation(uuid,uuid,uuid,text,text,text,text,uuid)",
    contains: "signal-governed-view-resolved-population-v1"
  },
  {
    kind: "function",
    signature: "signal_data_governance_next_transition(uuid)",
    contains: "retain_until"
  },
  {
    kind: "function",
    signature: "activate_signal_data_governance_object(uuid,uuid,text,uuid,text,text)",
    contains: "pg_advisory_xact_lock"
  },
  {
    kind: "function",
    signature: "invalidate_signal_data_governance_compilations(uuid,text,text,text,uuid,uuid,uuid,uuid,text[])",
    contains: "signal_data_invalidations"
  }
];

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
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

function assertRestorePoint() {
  if (process.env[RESTORE_VERIFIED_ENV] !== "true") {
    throw new Error(`${RESTORE_VERIFIED_ENV}=true is required.`);
  }
  const reference = process.env[RESTORE_REFERENCE_ENV]?.trim() ?? "";
  if (reference.length < 8) throw new Error(`${RESTORE_REFERENCE_ENV} must identify a restore point.`);
  const restoreAt = Date.parse(process.env[RESTORE_POINT_AT_ENV]?.trim() ?? "");
  const ageMs = Date.now() - restoreAt;
  if (!Number.isFinite(restoreAt) || ageMs < 0 || ageMs > 7 * 24 * 60 * 60 * 1000) {
    throw new Error(`${RESTORE_POINT_AT_ENV} must be a verified ISO timestamp no older than seven days.`);
  }
  return {
    reference,
    restore_point_at: new Date(restoreAt).toISOString(),
    age_hours: Math.round(ageMs / 36e5 * 10) / 10,
    verified: true
  };
}

function assertTarget(databaseUrl: string, mode: Mode, fingerprint: string) {
  const local = isLocalDatabaseUrl(databaseUrl);
  const target = (process.env.NOISIA_REMOTE_DATABASE_TARGET ?? "").trim().toLowerCase();
  let restorePoint: ReturnType<typeof assertRestorePoint> | null = null;
  if (!local) {
    if (target !== "preview" && target !== "staging") {
      throw new Error("Remote governed-governance rehearsal requires preview or staging.");
    }
    if (databaseUrlLooksProductionLike(databaseUrl)) {
      throw new Error("Refusing a production-like DATABASE_URL.");
    }
    if (fingerprint !== EXPECTED_REMOTE_FINGERPRINT
      || process.env[TARGET_FINGERPRINT_ENV] !== fingerprint) {
      throw new Error("Remote target fingerprint does not match audited noisia-staging.");
    }
    if (process.env[PREFLIGHT_ALLOW_REMOTE_ENV] !== "true") {
      throw new Error(`${PREFLIGHT_ALLOW_REMOTE_ENV}=true is required.`);
    }
    if (process.env[NO_APP_CONNECTIONS_ENV] !== "true") {
      throw new Error(`${NO_APP_CONNECTIONS_ENV}=true is required after connection inspection.`);
    }
    restorePoint = assertRestorePoint();
    requireSafeDatabaseReadTarget(databaseUrl, {
      operation: "inspect governed-view/data-governance migrations 0068-0069",
      allowRemoteEnv: PREFLIGHT_ALLOW_REMOTE_ENV
    });
  }
  if (mode === "apply") {
    if (process.env[APPLY_APPROVED_ENV] !== "true") {
      throw new Error(`${APPLY_APPROVED_ENV}=true is required.`);
    }
    if (!local) {
      if (process.env[APPLY_ALLOW_REMOTE_ENV] !== "true") {
        throw new Error(`${APPLY_ALLOW_REMOTE_ENV}=true is required.`);
      }
      if (process.env[ISOLATED_TARGET_ENV] !== "true") {
        throw new Error(`${ISOLATED_TARGET_ENV}=true is required.`);
      }
      if (!/^sha256:[0-9a-f]{64}$/u.test(process.env[EXPECTED_STATE_DIGEST_ENV] ?? "")) {
        throw new Error(`${EXPECTED_STATE_DIGEST_ENV} must copy the preflight protected-state digest.`);
      }
      requireSafeDatabaseWriteTarget(databaseUrl, {
        operation: "apply governed-view/data-governance migrations 0068-0069",
        allowRemoteEnv: APPLY_ALLOW_REMOTE_ENV
      });
    }
  }
  return { local, target: local ? "local" : target, restorePoint };
}

async function sentinelExists(client: pg.Client, sentinel: Sentinel) {
  if (sentinel.kind === "table") {
    const result = await client.query<{ present: boolean }>(
      "SELECT to_regclass('public.' || $1) IS NOT NULL AS present", [sentinel.name]
    );
    return result.rows[0]?.present === true;
  }
  if (sentinel.kind === "index") {
    const result = await client.query<{ present: boolean }>(`
      SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=$1) AS present
    `, [sentinel.name]);
    return result.rows[0]?.present === true;
  }
  if (sentinel.kind === "trigger") {
    const result = await client.query<{ present: boolean }>(`
      SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname=$1 AND NOT tgisinternal) AS present
    `, [sentinel.name]);
    return result.rows[0]?.present === true;
  }
  if (sentinel.kind === "column") {
    const result = await client.query<{ present: boolean }>(`
      SELECT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1 AND column_name=$2) AS present
    `, [sentinel.relation, sentinel.name]);
    return result.rows[0]?.present === true;
  }
  if (sentinel.kind === "constraint") {
    const result = await client.query<{ present: boolean }>(`
      SELECT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
        JOIN pg_namespace n ON n.oid=r.relnamespace
        WHERE n.nspname='public' AND r.relname=$1 AND c.conname=$2) AS present
    `, [sentinel.relation, sentinel.name]);
    return result.rows[0]?.present === true;
  }
  if (sentinel.kind !== "function") return false;
  const result = await client.query<{ present: boolean }>(`
    SELECT COALESCE(position($2 in pg_get_functiondef(to_regprocedure($1))) > 0, false) AS present
  `, [`public.${sentinel.signature}`, sentinel.contains]);
  return result.rows[0]?.present === true;
}

function sentinelKey(sentinel: Sentinel) {
  if (sentinel.kind === "column" || sentinel.kind === "constraint") {
    return `${sentinel.kind}:${sentinel.relation}.${sentinel.name}`;
  }
  if (sentinel.kind === "function") return `function:${sentinel.signature}`;
  return `${sentinel.kind}:${sentinel.name}`;
}

async function inspectSentinels(client: pg.Client, sentinels: Sentinel[]) {
  const checks: Array<{ key: string; present: boolean }> = [];
  for (const sentinel of sentinels) {
    checks.push({ key: sentinelKey(sentinel), present: await sentinelExists(client, sentinel) });
  }
  const present = checks.filter((item) => item.present).length;
  const state: MigrationState = present === 0
    ? "absent"
    : present === checks.length ? "complete" : "partial";
  return {
    state,
    required: checks.length,
    present,
    missing: checks.filter((item) => !item.present).map((item) => item.key)
  };
}

async function readLedger(client: pg.Client) {
  return (await client.query<{
    migration_name: string;
    ordinal: number;
    checksum_sha256: string;
    disposition: string;
    runner_version: string;
    target_fingerprint: string;
  }>(`
    SELECT migration_name, ordinal, checksum_sha256, disposition, runner_version, target_fingerprint
    FROM ${LEDGER} WHERE ordinal BETWEEN 59 AND 69 ORDER BY ordinal
  `)).rows;
}

async function inspectConnections(client: pg.Client) {
  return (await client.query<{
    other_client_connections: number;
    active_other_client_connections: number;
    named_noisia_connections: number;
    long_running_active_connections: number;
  }>(`
    SELECT
      count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid())::int
        AS other_client_connections,
      count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid()
        AND state IS DISTINCT FROM 'idle'
        AND application_name<>'noisia-governed-governance-0068-0069')::int
        AS active_other_client_connections,
      count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid()
        AND COALESCE(application_name,'') ~* '(noisia|studio|worker|bullmq)'
        AND application_name<>'noisia-governed-governance-0068-0069')::int
        AS named_noisia_connections,
      count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid()
        AND state IS DISTINCT FROM 'idle'
        AND COALESCE(now()-xact_start, interval '0') > interval '5 minutes'
        AND application_name<>'noisia-governed-governance-0068-0069')::int
        AS long_running_active_connections
    FROM pg_stat_activity WHERE datname=current_database()
  `)).rows[0]!;
}

async function inspectRunningSyncs(client: pg.Client) {
  return (await client.query<{ count: number; oldest_started_at: string | null; digest: string }>(`
    SELECT count(*)::int AS count, min(started_at)::text AS oldest_started_at,
      'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
        concat_ws('|', id::text, workspace_id::text, data_source_id::text, status,
          created_at::text, started_at::text, finished_at::text), E'\\n' ORDER BY id
      ), ''), 'UTF8')), 'hex') AS digest
    FROM source_sync_runs WHERE status='running'
  `)).rows[0]!;
}

async function digestQuery(client: pg.Client, fromSql: string, orderSql: string) {
  const result = await client.query<{ row_count: number; content_hash: string }>(`
    SELECT count(*)::int AS row_count,
      'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
        to_jsonb(row_value.*)::text, E'\\n' ORDER BY ${orderSql}
      ), ''), 'UTF8')), 'hex') AS content_hash
    FROM ${fromSql} row_value
  `);
  return result.rows[0]!;
}

async function inspectProtectedState(client: pg.Client) {
  const pointers = await digestQuery(
    client,
    "signal_workspace_population_pointers",
    "row_value.workspace_id, row_value.purpose"
  );
  const definitions = await digestQuery(
    client,
    "signal_population_definitions",
    "row_value.workspace_id, row_value.population_key, row_value.version"
  );
  const memberships = await digestQuery(
    client,
    "signal_population_memberships",
    "row_value.workspace_id, row_value.population_id, row_value.mention_id"
  );
  const attributions = await digestQuery(
    client,
    "signal_mention_attributions",
    "row_value.workspace_id, row_value.mention_id, row_value.id"
  );
  const reviewEvents = await digestQuery(
    client,
    "signal_mention_attribution_review_events",
    "row_value.workspace_id, row_value.attribution_id, row_value.created_at, row_value.id"
  );
  const governanceEvents = await digestQuery(
    client,
    "signal_mention_governance_events",
    "row_value.workspace_id, row_value.mention_id, row_value.created_at, row_value.id"
  );
  const materializations = await digestQuery(
    client,
    "metric_materializations",
    "row_value.workspace_id, row_value.metric_key, row_value.period_start, row_value.period_end, row_value.id"
  );
  const releases = await digestQuery(
    client,
    "signal_workspace_current_releases",
    "row_value.workspace_id"
  );
  const v1 = (await client.query<{
    definition_count: number;
    pointer_count: number;
    membership_count: number;
    included_count: number;
    canonical_reader_count: number;
    digest: string;
  }>(`
    WITH v1 AS (
      SELECT definition.id, definition.workspace_id
      FROM signal_population_definitions definition
      JOIN signal_workspace_population_pointers pointer
        ON pointer.population_id=definition.id AND pointer.workspace_id=definition.workspace_id
      WHERE pointer.purpose='operational'
        AND definition.population_key='primary-brand-operational'
        AND definition.definition->>'contract_version'
          IS DISTINCT FROM 'signal-operational-primary-brand-semantic-v2'
    ), rows AS (
      SELECT concat_ws('|', v1.workspace_id::text, v1.id::text,
        membership.mention_id::text, membership.membership_status,
        COALESCE(membership.removed_at::text,'∅')) AS value
      FROM v1 LEFT JOIN signal_population_memberships membership ON membership.population_id=v1.id
    )
    SELECT
      (SELECT count(*)::int FROM v1) AS definition_count,
      (SELECT count(*)::int FROM signal_workspace_population_pointers pointer
        JOIN v1 ON v1.id=pointer.population_id) AS pointer_count,
      (SELECT count(*)::int FROM signal_population_memberships membership
        JOIN v1 ON v1.id=membership.population_id) AS membership_count,
      (SELECT count(*)::int FROM signal_population_memberships membership
        JOIN v1 ON v1.id=membership.population_id
        WHERE membership.membership_status='included' AND membership.removed_at IS NULL) AS included_count,
      (SELECT count(*)::int FROM signal_population_memberships membership
        JOIN v1 ON v1.id=membership.population_id JOIN mentions mention ON mention.id=membership.mention_id
        WHERE membership.membership_status='included' AND membership.removed_at IS NULL
          AND mention.canonical_mention_id=mention.id) AS canonical_reader_count,
      'sha256:' || encode(sha256(convert_to(COALESCE((SELECT string_agg(value, E'\\n' ORDER BY value)
        FROM rows), ''), 'UTF8')), 'hex') AS digest
  `)).rows[0]!;
  const semantic = (await client.query<{
    source_intent_count: number;
    semantic_assertion_count: number;
    approved_count: number;
    rejected_count: number;
    pending_count: number;
  }>(`
    SELECT
      count(*) FILTER (WHERE attribution_basis='source_intent')::int AS source_intent_count,
      count(*) FILTER (WHERE attribution_basis='mention_semantic')::int AS semantic_assertion_count,
      count(*) FILTER (WHERE attribution_basis='mention_semantic' AND review_status='approved')::int AS approved_count,
      count(*) FILTER (WHERE attribution_basis='mention_semantic' AND review_status='rejected')::int AS rejected_count,
      count(*) FILTER (WHERE attribution_basis='mention_semantic' AND review_status='pending')::int AS pending_count
    FROM signal_mention_attributions
  `)).rows[0]!;
  const runningSyncs = await inspectRunningSyncs(client);
  const state = {
    operational_v1: v1,
    population_pointers: pointers,
    population_definitions: definitions,
    population_memberships: memberships,
    semantic_attributions: { ...semantic, ...attributions },
    review_events: reviewEvents,
    mention_governance_events: governanceEvents,
    metric_materializations: materializations,
    current_releases: releases,
    running_syncs: { ...runningSyncs, rows_modified: false }
  };
  return { ...state, aggregate_hash: sha256(JSON.stringify(state)) };
}

async function inspectCreatedRows(client: pg.Client) {
  const tables = [
    "signal_population_policy_bundles",
    "signal_population_policy_entities",
    "signal_population_policy_compilations",
    "signal_governed_view_bindings",
    "signal_governed_view_binding_events",
    "signal_quality_policies",
    "signal_retention_policies",
    "signal_licensing_policies",
    "signal_licensing_policy_usages",
    "signal_provenance_policy_bindings",
    "signal_data_governance_policy_events",
    "signal_governed_view_population_derivations",
    "signal_data_governance_evaluations",
    "signal_data_governance_evaluation_items",
    "signal_data_governance_invalidations"
  ];
  const result: Record<string, number | null> = {};
  for (const table of tables) {
    const exists = (await client.query<{ exists: boolean }>(
      "SELECT to_regclass('public.' || $1) IS NOT NULL AS exists", [table]
    )).rows[0]?.exists === true;
    result[table] = exists
      ? Number((await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`)).rows[0]?.count ?? 0)
      : null;
  }
  return result;
}

async function loadMigrations() {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  return Promise.all(MIGRATIONS.map(async (migration) => {
    const sql = await readFile(join(root, "migrations", migration.filename), "utf8");
    const checksum = sha256(sql);
    if (checksum !== migration.checksum) {
      throw new Error(`${migration.filename} checksum mismatch: expected ${migration.checksum}, observed ${checksum}.`);
    }
    return { ...migration, sql };
  }));
}

async function assertPrerequisites(client: pg.Client, migrationFiles: Awaited<ReturnType<typeof loadMigrations>>) {
  const ledger = await readLedger(client);
  const required = [59, 60, 61, 62, 63, 64, 65, 66, 67];
  const missing = required.filter((ordinal) => !ledger.some((row) => row.ordinal === ordinal));
  const unexpected = ledger.filter((row) => row.ordinal > 69);
  if (missing.length > 0) throw new Error(`Missing prerequisite ledger ordinals: ${missing.join(",")}.`);
  if (unexpected.length > 0) throw new Error("Unexpected ledger entries exist after 0069.");
  const migrationState = {
    migration_0068: await inspectSentinels(client, SENTINELS_0068),
    migration_0069: await inspectSentinels(client, SENTINELS_0069)
  };
  for (const [key, value] of Object.entries(migrationState)) {
    if (value.state === "partial") throw new Error(`${key} is partial: ${value.missing.join(", ")}.`);
  }
  for (const migration of migrationFiles) {
    const rows = ledger.filter((row) => row.ordinal === migration.ordinal);
    const state = migration.ordinal === 68
      ? migrationState.migration_0068.state
      : migrationState.migration_0069.state;
    if (rows.length > 1
      || (rows.length === 1 && (rows[0]?.migration_name !== migration.filename
        || rows[0]?.checksum_sha256 !== migration.checksum))
      || (rows.length === 1 && state !== "complete")
      || (rows.length === 0 && state === "complete")) {
      throw new Error(`Ledger/sentinel mismatch for ordinal ${migration.ordinal}.`);
    }
  }
  if (ledger.some((row) => row.ordinal === 69) && !ledger.some((row) => row.ordinal === 68)) {
    throw new Error("0069 cannot be recorded without 0068.");
  }
  for (const row of ledger) {
    if (row.ordinal >= 68) continue;
    const filename = join(dirname(dirname(fileURLToPath(import.meta.url))), "migrations", row.migration_name);
    let localSql: string;
    try {
      localSql = await readFile(filename, "utf8");
    } catch {
      throw new Error(`Local prerequisite migration is missing: ${row.migration_name}.`);
    }
    const localChecksum = sha256(localSql);
    if (localChecksum !== row.checksum_sha256) {
      throw new Error(`Prerequisite checksum drift for ordinal ${row.ordinal}.`);
    }
  }
  return { ledger, migrationState };
}

async function recordMigration(
  client: pg.Client,
  migration: Awaited<ReturnType<typeof loadMigrations>>[number],
  fingerprint: string
) {
  await client.query(`
    INSERT INTO ${LEDGER} (
      migration_name, ordinal, checksum_sha256, disposition, runner_version, target_fingerprint
    ) VALUES ($1, $2, $3, 'applied', $4, $5)
  `, [migration.filename, migration.ordinal, migration.checksum, RUNNER_VERSION, fingerprint]);
}

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const mode = readMode();
  const fingerprint = targetFingerprint(databaseUrl);
  const target = assertTarget(databaseUrl, mode, fingerprint);
  const migrations = await loadMigrations();
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig(),
    application_name: "noisia-governed-governance-0068-0069"
  });
  await client.connect();
  let readOnly = false;
  try {
    await client.query("SET statement_timeout='15min'");
    await client.query("SET lock_timeout='15s'");
    if (mode !== "apply") {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      readOnly = true;
    }
    const prerequisites = await assertPrerequisites(client, migrations);
    const connections = await inspectConnections(client);
    if (connections.active_other_client_connections > 0
      || connections.named_noisia_connections > 0
      || connections.long_running_active_connections > 0) {
      throw new Error("Studio, Workers or another active client is connected.");
    }
    const protectedBefore = await inspectProtectedState(client);
    const createdRowsBefore = await inspectCreatedRows(client);
    const runningSyncs = protectedBefore.running_syncs;
    let actions: Array<{ migration: string; action: string }> = [];
    let writesPerformed = false;

    if (mode === "apply") {
      if (runningSyncs.count > 0 && process.env[RUNNING_SYNCS_ACK_ENV] !== "true") {
        throw new Error(`${RUNNING_SYNCS_ACK_ENV}=true is required to acknowledge stale syncs without changing them.`);
      }
      if (process.env[EXPECTED_STATE_DIGEST_ENV] !== protectedBefore.aggregate_hash) {
        throw new Error("Protected state changed after preflight; refusing apply.");
      }
      await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [LOCK_KEY]);
      try {
        for (const migration of migrations) {
          const sentinels = migration.ordinal === 68 ? SENTINELS_0068 : SENTINELS_0069;
          const state = await inspectSentinels(client, sentinels);
          const ledger = await readLedger(client);
          const recorded = ledger.filter((row) => row.ordinal === migration.ordinal);
          if (recorded.length > 0) {
            if (recorded.length !== 1 || recorded[0]?.migration_name !== migration.filename
              || recorded[0]?.checksum_sha256 !== migration.checksum || state.state !== "complete") {
              throw new Error(`Recorded migration ${migration.ordinal} is incompatible or incomplete.`);
            }
            actions.push({ migration: migration.filename, action: "verified_existing" });
            continue;
          }
          if (state.state !== "absent") throw new Error(`${migration.filename} is not cleanly absent.`);
          await client.query("BEGIN");
          try {
            await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [LOCK_KEY]);
            await client.query(migration.sql);
            const after = await inspectSentinels(client, sentinels);
            if (after.state !== "complete") {
              throw new Error(`${migration.filename} failed sentinels: ${after.missing.join(", ")}.`);
            }
            const protectedAfterMigration = await inspectProtectedState(client);
            if (protectedAfterMigration.aggregate_hash !== protectedBefore.aggregate_hash) {
              throw new Error(`${migration.filename} changed protected V1/Review/reader state.`);
            }
            await recordMigration(client, migration, fingerprint);
            await client.query("COMMIT");
            actions.push({ migration: migration.filename, action: "applied" });
            writesPerformed = true;
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          }
        }
      } finally {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [LOCK_KEY]);
      }
    }

    const migrationAfter = {
      migration_0068: await inspectSentinels(client, SENTINELS_0068),
      migration_0069: await inspectSentinels(client, SENTINELS_0069)
    };
    const protectedAfter = await inspectProtectedState(client);
    const createdRowsAfter = await inspectCreatedRows(client);
    const ledgerAfter = await readLedger(client);
    if (mode === "verify") {
      if (migrationAfter.migration_0068.state !== "complete"
        || migrationAfter.migration_0069.state !== "complete") {
        throw new Error("Verify requires 0068 and 0069 complete.");
      }
      for (const migration of migrations) {
        const rows = ledgerAfter.filter((row) => row.ordinal === migration.ordinal);
        if (rows.length !== 1 || rows[0]?.migration_name !== migration.filename
          || rows[0]?.checksum_sha256 !== migration.checksum) {
          throw new Error(`Verify requires exactly one matching ledger row for ${migration.ordinal}.`);
        }
      }
      const expected = process.env[EXPECTED_STATE_DIGEST_ENV];
      if (expected && expected !== protectedAfter.aggregate_hash) {
        throw new Error("Verify protected-state digest differs from preflight.");
      }
    }
    if (protectedAfter.aggregate_hash !== protectedBefore.aggregate_hash) {
      throw new Error("Protected V1/Review/reader state changed during the rehearsal.");
    }
    const createdNonZero = Object.entries(createdRowsAfter).filter(([, count]) => count !== null && count !== 0);
    if (createdNonZero.length > 0) {
      throw new Error(`Migrations created operational rows unexpectedly: ${createdNonZero.map(([key]) => key).join(", ")}.`);
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
      restore_point: target.restorePoint,
      migrations: migrations.map(({ ordinal, filename, checksum }) => ({ ordinal, filename, checksum })),
      writes_performed: writesPerformed,
      policies_loaded: false,
      bundles_created: false,
      bindings_created: false,
      pointers_changed: false,
      readers_changed: false,
      workers_or_llm_executed: false,
      actions,
      connections: { ...connections, application_names_redacted: true },
      running_syncs: runningSyncs,
      prerequisites,
      migration_after: migrationAfter,
      ledger_after: ledgerAfter,
      protected_state_before: protectedBefore,
      protected_state_after: protectedAfter,
      protected_state_equal: protectedBefore.aggregate_hash === protectedAfter.aggregate_hash,
      created_rows_before: createdRowsBefore,
      created_rows_after: createdRowsAfter
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

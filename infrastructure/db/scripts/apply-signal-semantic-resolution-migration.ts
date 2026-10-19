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

const RUNNER_VERSION = "signal-semantic-resolution-migration-rehearsal-v1";
const MIGRATION_FILENAME = "0065_signal_semantic_resolution.sql";
const EXPECTED_CHECKSUM =
  "sha256:8c65c3f538221325d301710124497beaacdda8fc334cd5b4152e174e52a490fa";
const LEDGER = "signal_workspace_data_plane_migration_ledger";
const LOCK_KEY = "noisia:signal-semantic-resolution:0065";
const MODE_ENV = "NOISIA_SIGNAL_SEMANTIC_RESOLUTION_MIGRATION_MODE";
const PREFLIGHT_ALLOW_REMOTE_ENV =
  "NOISIA_SIGNAL_SEMANTIC_RESOLUTION_PREFLIGHT_ALLOW_REMOTE";
const APPLY_ALLOW_REMOTE_ENV =
  "NOISIA_DB_APPLY_SIGNAL_SEMANTIC_RESOLUTION_ALLOW_REMOTE";
const APPLY_APPROVED_ENV =
  "NOISIA_SIGNAL_SEMANTIC_RESOLUTION_SCHEMA_APPLY_APPROVED";
const TARGET_FINGERPRINT_ENV =
  "NOISIA_SIGNAL_SEMANTIC_RESOLUTION_TARGET_FINGERPRINT";
const EXPECTED_STATE_DIGEST_ENV =
  "NOISIA_SIGNAL_SEMANTIC_RESOLUTION_EXPECTED_STATE_DIGEST";
const ISOLATED_TARGET_ENV =
  "NOISIA_SIGNAL_SEMANTIC_RESOLUTION_ISOLATED_TARGET_CONFIRMED";
const RESTORE_REFERENCE_ENV =
  "NOISIA_SIGNAL_SEMANTIC_RESOLUTION_RESTORE_REFERENCE";
const RESTORE_POINT_AT_ENV =
  "NOISIA_SIGNAL_SEMANTIC_RESOLUTION_RESTORE_POINT_AT";
const RESTORE_VERIFIED_ENV =
  "NOISIA_SIGNAL_SEMANTIC_RESOLUTION_RESTORE_VERIFIED";
const NO_APP_CONNECTIONS_ENV =
  "NOISIA_SIGNAL_SEMANTIC_RESOLUTION_NO_APP_CONNECTIONS_CONFIRMED";
const RUNNING_SYNCS_ACK_ENV =
  "NOISIA_SIGNAL_SEMANTIC_RESOLUTION_RUNNING_SYNCS_ACKNOWLEDGED";

type Mode = "preflight" | "apply" | "verify";
type MigrationState = "absent" | "partial" | "complete";
type Sentinel =
  | { kind: "table"; name: string }
  | { kind: "column"; relation: string; name: string }
  | { kind: "constraint"; relation: string; name: string }
  | { kind: "constraint_definition"; relation: string; name: string; contains: string }
  | { kind: "index"; name: string }
  | { kind: "function_definition"; name: string; contains: string };

const PREREQUISITE_0064_SENTINELS: Sentinel[] = [
  { kind: "column", relation: "signal_mention_attributions", name: "attribution_basis" },
  { kind: "column", relation: "signal_mention_attributions", name: "eligibility_status" },
  { kind: "column", relation: "signal_mention_attributions", name: "semantic_policy_key" },
  { kind: "column", relation: "signal_mention_attributions", name: "assertion_version" },
  { kind: "column", relation: "signal_mention_attributions", name: "supersedes_attribution_id" },
  { kind: "column", relation: "signal_mention_attributions", name: "is_current" },
  { kind: "column", relation: "signal_mention_attributions", name: "idempotency_key" },
  { kind: "table", name: "signal_mention_attribution_review_events" },
  { kind: "constraint", relation: "signal_mention_attributions", name: "signal_mention_attribution_basis_contract" },
  { kind: "constraint", relation: "signal_mention_attributions", name: "signal_mention_attribution_eligible_contract" },
  { kind: "index", name: "uq_signal_mention_source_intent_provenance" },
  { kind: "index", name: "uq_signal_mention_semantic_idempotency" },
  { kind: "index", name: "uq_signal_mention_semantic_current" },
  { kind: "index", name: "idx_signal_mention_semantic_eligible" },
  { kind: "function_definition", name: "create_signal_mention_semantic_assertion(uuid,uuid,uuid,uuid,text,text,uuid,text,numeric,text,text,text,text,text,text,uuid)", contains: "mention_semantic" },
  { kind: "function_definition", name: "review_signal_mention_semantic_assertion(uuid,uuid,text,text,text,text,text,text)", contains: "Semantic review contract is invalid" },
  { kind: "function_definition", name: "supersede_signal_mention_semantic_assertion(uuid,uuid,text,text,uuid,text,numeric,text,text,text,text,text,text,text,text,text)", contains: "superseded" },
  { kind: "function_definition", name: "ensure_signal_operational_semantic_candidate_v2(uuid,uuid)", contains: "signal-operational-primary-brand-semantic-v2" },
  { kind: "function_definition", name: "reconcile_signal_semantic_candidate_population_mention(uuid,uuid)", contains: "mention_semantic" },
  { kind: "function_definition", name: "record_signal_mention_import_provenance(uuid,uuid)", contains: "source_intent" },
  { kind: "function_definition", name: "reconcile_signal_operational_population_mention(uuid,uuid)", contains: "semantic_contract" },
  { kind: "function_definition", name: "create_signal_tb_analysis_population(uuid,text,date,date,text,text,text,uuid,text)", contains: "signal-tb-analysis-population-semantic-v2" },
  { kind: "function_definition", name: "create_signal_tb_strategic_run(uuid,text,uuid,uuid,uuid,text,text,text,text,text,text,text,text,integer,jsonb)", contains: "signal-tb-analysis-population-semantic-v2" },
  { kind: "function_definition", name: "reconcile_signal_population_after_attribution()", contains: "attribution_basis" },
  { kind: "table", name: "signal_population_definitions" },
  { kind: "table", name: "signal_workspace_population_pointers" },
  { kind: "table", name: "signal_population_memberships" }
];

const MIGRATION_SENTINELS: Sentinel[] = [
  {
    kind: "constraint_definition",
    relation: "signal_mention_attributions",
    name: "signal_mention_attribution_basis_contract",
    contains: "model_reviewed_context"
  },
  { kind: "table", name: "signal_semantic_resolution_runs" },
  { kind: "column", relation: "signal_semantic_resolution_runs", name: "workspace_id" },
  { kind: "column", relation: "signal_semantic_resolution_runs", name: "requested_by_user_id" },
  { kind: "column", relation: "signal_semantic_resolution_runs", name: "status" },
  { kind: "column", relation: "signal_semantic_resolution_runs", name: "model_version" },
  { kind: "column", relation: "signal_semantic_resolution_runs", name: "policy_key" },
  { kind: "column", relation: "signal_semantic_resolution_runs", name: "policy_version" },
  { kind: "column", relation: "signal_semantic_resolution_runs", name: "queue_digest" },
  { kind: "column", relation: "signal_semantic_resolution_runs", name: "total_items" },
  { kind: "column", relation: "signal_semantic_resolution_runs", name: "budget_cap_usd" },
  { kind: "constraint", relation: "signal_semantic_resolution_runs", name: "signal_semantic_resolution_run_status" },
  { kind: "constraint", relation: "signal_semantic_resolution_runs", name: "signal_semantic_resolution_run_counts" },
  { kind: "constraint", relation: "signal_semantic_resolution_runs", name: "signal_semantic_resolution_run_cost" },
  { kind: "constraint", relation: "signal_semantic_resolution_runs", name: "signal_semantic_resolution_run_digest" },
  { kind: "index", name: "uq_signal_semantic_resolution_active_workspace" },
  { kind: "index", name: "idx_signal_semantic_resolution_runs_workspace" },
  { kind: "table", name: "signal_semantic_resolution_run_items" },
  { kind: "column", relation: "signal_semantic_resolution_run_items", name: "run_id" },
  { kind: "column", relation: "signal_semantic_resolution_run_items", name: "workspace_id" },
  { kind: "column", relation: "signal_semantic_resolution_run_items", name: "mention_id" },
  { kind: "column", relation: "signal_semantic_resolution_run_items", name: "status" },
  { kind: "column", relation: "signal_semantic_resolution_run_items", name: "context_hash" },
  { kind: "constraint", relation: "signal_semantic_resolution_run_items", name: "uq_signal_semantic_resolution_run_item" },
  { kind: "constraint", relation: "signal_semantic_resolution_run_items", name: "signal_semantic_resolution_item_status" },
  { kind: "constraint", relation: "signal_semantic_resolution_run_items", name: "signal_semantic_resolution_item_attempt" },
  { kind: "constraint", relation: "signal_semantic_resolution_run_items", name: "signal_semantic_resolution_item_context_hash" },
  { kind: "constraint", relation: "signal_semantic_resolution_runs", name: "signal_semantic_resolution_runs_workspace_id_fkey" },
  { kind: "constraint", relation: "signal_semantic_resolution_runs", name: "signal_semantic_resolution_runs_requested_by_user_id_fkey" },
  { kind: "constraint", relation: "signal_semantic_resolution_run_items", name: "signal_semantic_resolution_run_items_run_id_fkey" },
  { kind: "constraint", relation: "signal_semantic_resolution_run_items", name: "signal_semantic_resolution_run_items_workspace_id_fkey" },
  { kind: "constraint", relation: "signal_semantic_resolution_run_items", name: "signal_semantic_resolution_run_items_mention_id_fkey" },
  { kind: "index", name: "idx_signal_semantic_resolution_items_pending" },
  { kind: "index", name: "idx_signal_semantic_resolution_items_mention" },
  {
    kind: "function_definition",
    name: "review_signal_mention_semantic_assertion(uuid,uuid,text,text,text,text,text,text)",
    contains: "WHEN assertion.scope = 'unattributed' THEN 'not_eligible'"
  }
];

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function readMode(): Mode {
  const mode = (process.env[MODE_ENV] ?? "preflight").trim().toLowerCase();
  if (mode === "preflight" || mode === "apply" || mode === "verify") return mode;
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

function normalizeFunctionBody(value: string) {
  return value.replace(/\r\n/gu, "\n").trim();
}

function expectedReviewFunctionBodyHash(sql: string) {
  const match = sql.match(
    /CREATE OR REPLACE FUNCTION review_signal_mention_semantic_assertion\([\s\S]+?AS \$\$([\s\S]+?)\$\$;/u
  );
  if (!match?.[1]) throw new Error("Unable to extract the authorized 0065 Review function body.");
  return sha256(normalizeFunctionBody(match[1]));
}

function assertFreshRestorePoint() {
  if (process.env[RESTORE_VERIFIED_ENV] !== "true") {
    throw new Error(`${RESTORE_VERIFIED_ENV}=true is required.`);
  }
  const reference = process.env[RESTORE_REFERENCE_ENV]?.trim() ?? "";
  if (reference.length < 8) throw new Error(`${RESTORE_REFERENCE_ENV} must identify a restore point.`);
  const restorePoint = Date.parse(process.env[RESTORE_POINT_AT_ENV]?.trim() ?? "");
  const ageMs = Date.now() - restorePoint;
  if (!Number.isFinite(restorePoint) || ageMs < 0 || ageMs > 36 * 60 * 60 * 1000) {
    throw new Error(`${RESTORE_POINT_AT_ENV} must be a verified ISO timestamp no older than 36 hours.`);
  }
}

function assertTarget(databaseUrl: string, mode: Mode, fingerprint: string) {
  const local = isLocalDatabaseUrl(databaseUrl);
  const target = (process.env.NOISIA_REMOTE_DATABASE_TARGET ?? "").trim().toLowerCase();
  if (!local) {
    if (target !== "preview" && target !== "staging") {
      throw new Error("Remote 0065 rehearsal requires an isolated preview or staging target.");
    }
    if (databaseUrlLooksProductionLike(databaseUrl)) {
      throw new Error("Refusing a production-like DATABASE_URL for the 0065 rehearsal.");
    }
    if (process.env[PREFLIGHT_ALLOW_REMOTE_ENV] !== "true") {
      throw new Error(`${PREFLIGHT_ALLOW_REMOTE_ENV}=true is required.`);
    }
    if (process.env[TARGET_FINGERPRINT_ENV] !== fingerprint) {
      throw new Error(`${TARGET_FINGERPRINT_ENV} must match the audited 0065 target fingerprint.`);
    }
    if (process.env[NO_APP_CONNECTIONS_ENV] !== "true") {
      throw new Error(`${NO_APP_CONNECTIONS_ENV}=true is required after inspecting connections.`);
    }
    assertFreshRestorePoint();
    requireSafeDatabaseReadTarget(databaseUrl, {
      operation: "inspect Signal semantic-resolution migration 0065 target",
      allowRemoteEnv: PREFLIGHT_ALLOW_REMOTE_ENV
    });
  }
  if (mode !== "apply") return { local, target: local ? "local" : target };
  if (process.env[APPLY_APPROVED_ENV] !== "true") {
    throw new Error(`${APPLY_APPROVED_ENV}=true is required for 0065 apply.`);
  }
  if (!local) {
    if (process.env[APPLY_ALLOW_REMOTE_ENV] !== "true") {
      throw new Error(`${APPLY_ALLOW_REMOTE_ENV}=true is required for remote 0065 apply.`);
    }
    if (process.env[ISOLATED_TARGET_ENV] !== "true") {
      throw new Error(`${ISOLATED_TARGET_ENV}=true is required for remote 0065 apply.`);
    }
    if (!/^sha256:[0-9a-f]{64}$/u.test(process.env[EXPECTED_STATE_DIGEST_ENV] ?? "")) {
      throw new Error(`${EXPECTED_STATE_DIGEST_ENV} must copy the 0065 preflight state digest.`);
    }
    requireSafeDatabaseWriteTarget(databaseUrl, {
      operation: "apply Signal semantic-resolution migration 0065",
      allowRemoteEnv: APPLY_ALLOW_REMOTE_ENV
    });
  }
  return { local, target: local ? "local" : target };
}

async function sentinelExists(client: pg.Client, sentinel: Sentinel) {
  if (sentinel.kind === "table") {
    const result = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('public.' || $1) IS NOT NULL AS exists",
      [sentinel.name]
    );
    return result.rows[0]?.exists === true;
  }
  if (sentinel.kind === "column") {
    const result = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
      ) AS exists
    `, [sentinel.relation, sentinel.name]);
    return result.rows[0]?.exists === true;
  }
  if (sentinel.kind === "index") {
    const result = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1
      ) AS exists
    `, [sentinel.name]);
    return result.rows[0]?.exists === true;
  }
  if (sentinel.kind === "function_definition") {
    const result = await client.query<{ matches: boolean }>(`
      SELECT COALESCE(position($2 in pg_get_functiondef(to_regprocedure($1))) > 0, false) AS matches
    `, [`public.${sentinel.name}`, sentinel.contains]);
    return result.rows[0]?.matches === true;
  }
  if (sentinel.kind === "constraint_definition") {
    const result = await client.query<{ matches: boolean }>(`
      SELECT COALESCE(position($3 in pg_get_constraintdef(constraint_row.oid)) > 0, false) AS matches
      FROM pg_constraint constraint_row
      JOIN pg_class relation ON relation.oid = constraint_row.conrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relname = $1
        AND constraint_row.conname = $2
    `, [sentinel.relation, sentinel.name, sentinel.contains]);
    return result.rows[0]?.matches === true;
  }
  const result = await client.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint constraint_row
      JOIN pg_class relation ON relation.oid = constraint_row.conrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relname = $1
        AND constraint_row.conname = $2
    ) AS exists
  `, [sentinel.relation, sentinel.name]);
  return result.rows[0]?.exists === true;
}

function sentinelKey(sentinel: Sentinel) {
  if (sentinel.kind === "table" || sentinel.kind === "index" || sentinel.kind === "function_definition") {
    return `${sentinel.kind}:${sentinel.name}`;
  }
  return `${sentinel.kind}:${sentinel.relation}.${sentinel.name}`;
}

async function inspectSentinels(client: pg.Client, sentinels: Sentinel[]) {
  const checks: Array<{ key: string; present: boolean }> = [];
  for (const sentinel of sentinels) {
    checks.push({ key: sentinelKey(sentinel), present: await sentinelExists(client, sentinel) });
  }
  const present = checks.filter((check) => check.present).length;
  const state: MigrationState = present === 0
    ? "absent"
    : present === checks.length
      ? "complete"
      : "partial";
  return {
    state,
    required: checks.length,
    present,
    missing: checks.filter((check) => !check.present).map((check) => check.key)
  };
}

async function inspectFunctionContract(client: pg.Client, expectedHash: string) {
  const result = await client.query<{ body: string | null }>(`
    SELECT procedure.prosrc AS body
    FROM pg_proc procedure
    WHERE procedure.oid = to_regprocedure(
      'public.review_signal_mention_semantic_assertion(uuid,uuid,text,text,text,text,text,text)'
    )
  `);
  const body = result.rows[0]?.body;
  const observedHash = body ? sha256(normalizeFunctionBody(body)) : null;
  return {
    expected_body_hash: expectedHash,
    observed_body_hash: observedHash,
    matches: observedHash === expectedHash
  };
}

async function inspectConnections(client: pg.Client) {
  const result = await client.query<{
    other_client_connections: number;
    concurrent_runner_connections: number;
    active_other_client_connections: number;
    named_noisia_connections: number;
    long_running_active_connections: number;
  }>(`
    SELECT
      count(*) FILTER (WHERE backend_type = 'client backend' AND pid <> pg_backend_pid())::int
        AS other_client_connections,
      count(*) FILTER (WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()
        AND application_name = 'noisia-semantic-resolution-0065-rehearsal')::int
        AS concurrent_runner_connections,
      count(*) FILTER (WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()
        AND state IS DISTINCT FROM 'idle'
        AND application_name IS DISTINCT FROM 'noisia-semantic-resolution-0065-rehearsal')::int
        AS active_other_client_connections,
      count(*) FILTER (WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()
        AND COALESCE(application_name, '') ~* '(noisia|studio|worker|bullmq)'
        AND application_name IS DISTINCT FROM 'noisia-semantic-resolution-0065-rehearsal')::int
        AS named_noisia_connections,
      count(*) FILTER (WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()
        AND state IS DISTINCT FROM 'idle'
        AND application_name IS DISTINCT FROM 'noisia-semantic-resolution-0065-rehearsal'
        AND COALESCE(now() - xact_start, interval '0') > interval '5 minutes')::int
        AS long_running_active_connections
    FROM pg_stat_activity WHERE datname = current_database()
  `);
  return {
    ...result.rows[0]!,
    application_names_redacted: true,
    operator_disconnection_confirmed: process.env[NO_APP_CONNECTIONS_ENV] === "true"
  };
}

async function inspectRunningSyncs(client: pg.Client) {
  const result = await client.query<{
    count: number;
    oldest_started_at: string | null;
    digest: string;
  }>(`
    SELECT count(*)::int AS count,
      min(started_at)::text AS oldest_started_at,
      'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
        concat_ws('|', id::text, workspace_id::text, data_source_id::text, status,
          created_at::text, started_at::text, finished_at::text), E'\n' ORDER BY id
      ), ''), 'UTF8')), 'hex') AS digest
    FROM source_sync_runs WHERE status = 'running'
  `);
  return { ...result.rows[0]!, rows_modified: false };
}

async function inspectOperationalV1(client: pg.Client) {
  const result = await client.query<{
    pointer_count: number;
    definition_count: number;
    membership_row_count: number;
    included_membership_count: number;
    canonical_reader_count: number;
    pointer_content_hash: string;
    definition_content_hash: string;
    membership_content_hash: string;
    canonical_reader_id_hash: string;
  }>(`
    WITH v1_pointers AS (
      SELECT pointer.*, definition.id AS definition_id
      FROM signal_workspace_population_pointers pointer
      JOIN signal_population_definitions definition
        ON definition.id = pointer.population_id AND definition.workspace_id = pointer.workspace_id
      WHERE pointer.purpose = 'operational' AND definition.status = 'active'
        AND definition.population_key = 'primary-brand-operational'
        AND definition.definition->>'contract_version'
          IS DISTINCT FROM 'signal-operational-primary-brand-semantic-v2'
    ), v1_definitions AS (
      SELECT definition.* FROM signal_population_definitions definition
      JOIN v1_pointers pointer ON pointer.population_id = definition.id
    ), v1_memberships AS (
      SELECT membership.* FROM signal_population_memberships membership
      JOIN v1_pointers pointer ON pointer.population_id = membership.population_id
    )
    SELECT
      (SELECT count(*)::int FROM v1_pointers) AS pointer_count,
      (SELECT count(*)::int FROM v1_definitions) AS definition_count,
      (SELECT count(*)::int FROM v1_memberships) AS membership_row_count,
      (SELECT count(*)::int FROM v1_memberships WHERE membership_status = 'included'
        AND removed_at IS NULL) AS included_membership_count,
      (SELECT count(*)::int FROM v1_memberships membership JOIN mentions mention
        ON mention.id = membership.mention_id WHERE membership.membership_status = 'included'
        AND membership.removed_at IS NULL AND mention.canonical_mention_id = mention.id)
        AS canonical_reader_count,
      (SELECT 'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
        to_jsonb(pointer.*)::text, E'\n' ORDER BY pointer.workspace_id, pointer.id), ''), 'UTF8')), 'hex')
        FROM v1_pointers pointer) AS pointer_content_hash,
      (SELECT 'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
        to_jsonb(definition.*)::text, E'\n' ORDER BY definition.workspace_id, definition.id), ''), 'UTF8')), 'hex')
        FROM v1_definitions definition) AS definition_content_hash,
      (SELECT 'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
        to_jsonb(membership.*)::text, E'\n' ORDER BY membership.population_id, membership.mention_id), ''), 'UTF8')), 'hex')
        FROM v1_memberships membership) AS membership_content_hash,
      (SELECT 'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
        membership.mention_id::text, ',' ORDER BY membership.population_id, membership.mention_id), ''), 'UTF8')), 'hex')
        FROM v1_memberships membership JOIN mentions mention ON mention.id = membership.mention_id
        WHERE membership.membership_status = 'included' AND membership.removed_at IS NULL
          AND mention.canonical_mention_id = mention.id) AS canonical_reader_id_hash
  `);
  const state = result.rows[0]!;
  return { ...state, aggregate_hash: sha256(JSON.stringify(state)) };
}

async function tableExists(client: pg.Client, table: string) {
  const result = await client.query<{ exists: boolean }>(
    "SELECT to_regclass('public.' || $1) IS NOT NULL AS exists", [table]
  );
  return result.rows[0]?.exists === true;
}

async function inspectProtectedState(client: pg.Client) {
  const v1 = await inspectOperationalV1(client);
  const semantic = await client.query<{
    source_intent_count: number;
    source_intent_digest: string;
    semantic_assertion_count: number;
    semantic_assertion_digest: string;
    pending_candidate_count: number;
    approved_count: number;
    rejected_count: number;
    review_event_count: number;
    review_event_digest: string;
    v2_definition_count: number;
    v2_pointer_count: number;
    v2_membership_count: number;
  }>(`
    WITH v2 AS (
      SELECT definition.id FROM signal_population_definitions definition
      WHERE definition.population_key = 'primary-brand-operational'
        AND definition.purpose = 'operational'
        AND definition.definition->>'contract_version'
          = 'signal-operational-primary-brand-semantic-v2'
    )
    SELECT
      count(*) FILTER (WHERE attribution_basis = 'source_intent')::int AS source_intent_count,
      'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
        to_jsonb(attribution.*)::text, E'\n' ORDER BY attribution.id
      ) FILTER (WHERE attribution_basis = 'source_intent'), ''), 'UTF8')), 'hex') AS source_intent_digest,
      count(*) FILTER (WHERE attribution_basis = 'mention_semantic')::int AS semantic_assertion_count,
      'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
        to_jsonb(attribution.*)::text, E'\n' ORDER BY attribution.id
      ) FILTER (WHERE attribution_basis = 'mention_semantic'), ''), 'UTF8')), 'hex') AS semantic_assertion_digest,
      count(*) FILTER (WHERE attribution_basis = 'mention_semantic'
        AND review_status = 'pending' AND eligibility_status = 'candidate')::int
        AS pending_candidate_count,
      count(*) FILTER (WHERE attribution_basis = 'mention_semantic'
        AND review_status = 'approved')::int AS approved_count,
      count(*) FILTER (WHERE attribution_basis = 'mention_semantic'
        AND review_status = 'rejected')::int AS rejected_count,
      (SELECT count(*)::int FROM signal_mention_attribution_review_events) AS review_event_count,
      (SELECT 'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
        to_jsonb(event.*)::text, E'\n' ORDER BY event.id), ''), 'UTF8')), 'hex')
        FROM signal_mention_attribution_review_events event) AS review_event_digest,
      (SELECT count(*)::int FROM v2) AS v2_definition_count,
      (SELECT count(*)::int FROM signal_workspace_population_pointers pointer
        JOIN v2 ON v2.id = pointer.population_id) AS v2_pointer_count,
      (SELECT count(*)::int FROM signal_population_memberships membership
        JOIN v2 ON v2.id = membership.population_id) AS v2_membership_count
    FROM signal_mention_attributions attribution
  `);
  const laika = await client.query<{
    workspace_count: number;
    included_root_count: number;
    candidate_root_count: number;
    unresolved_root_count: number;
    assertion_count: number;
    pending_candidate_count: number;
    approved_count: number;
    rejected_count: number;
    state_digest: string;
  }>(`
    WITH target AS (
      SELECT workspace.id FROM brands brand JOIN signal_workspaces workspace
        ON workspace.brand_id = brand.id WHERE brand.slug = 'laika'
    ), included AS (
      SELECT mention.id FROM mentions mention JOIN target ON target.id = mention.workspace_id
      WHERE mention.canonical_mention_id = mention.id AND mention.inclusion_status = 'included'
        AND EXISTS (SELECT 1 FROM signal_mention_attributions intent
          WHERE intent.workspace_id = mention.workspace_id AND intent.mention_id = mention.id
            AND intent.attribution_basis = 'source_intent')
    ), assertions AS (
      SELECT attribution.* FROM signal_mention_attributions attribution
      JOIN target ON target.id = attribution.workspace_id
      WHERE attribution.attribution_basis = 'mention_semantic'
    )
    SELECT
      (SELECT count(*)::int FROM target) AS workspace_count,
      (SELECT count(*)::int FROM included) AS included_root_count,
      (SELECT count(DISTINCT mention_id)::int FROM assertions WHERE is_current) AS candidate_root_count,
      (SELECT count(*)::int FROM included mention WHERE NOT EXISTS (
        SELECT 1 FROM assertions assertion WHERE assertion.mention_id = mention.id AND assertion.is_current
      )) AS unresolved_root_count,
      (SELECT count(*)::int FROM assertions) AS assertion_count,
      (SELECT count(*)::int FROM assertions WHERE review_status = 'pending'
        AND eligibility_status = 'candidate') AS pending_candidate_count,
      (SELECT count(*)::int FROM assertions WHERE review_status = 'approved') AS approved_count,
      (SELECT count(*)::int FROM assertions WHERE review_status = 'rejected') AS rejected_count,
      (SELECT 'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
        to_jsonb(assertion.*)::text, E'\n' ORDER BY assertion.id), ''), 'UTF8')), 'hex')
        FROM assertions assertion) AS state_digest
  `);
  const otherWorkspaces = await client.query<{ workspace_count: number; state_digest: string }>(`
    WITH laika AS (
      SELECT workspace.id FROM brands brand JOIN signal_workspaces workspace
        ON workspace.brand_id = brand.id WHERE brand.slug = 'laika'
    ), state_rows AS (
      SELECT workspace.id AS workspace_id,
        (SELECT count(*)::text FROM signal_mention_attributions attribution
          WHERE attribution.workspace_id = workspace.id) AS attribution_count,
        (SELECT count(*)::text FROM signal_population_memberships membership
          WHERE membership.workspace_id = workspace.id) AS membership_count,
        (SELECT count(*)::text FROM signal_workspace_population_pointers pointer
          WHERE pointer.workspace_id = workspace.id) AS pointer_count
      FROM signal_workspaces workspace WHERE NOT EXISTS (
        SELECT 1 FROM laika WHERE laika.id = workspace.id
      )
    )
    SELECT count(*)::int AS workspace_count,
      'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
        concat_ws('|', workspace_id::text, attribution_count, membership_count, pointer_count),
        E'\n' ORDER BY workspace_id), ''), 'UTF8')), 'hex') AS state_digest
    FROM state_rows
  `);
  const runningSyncs = await inspectRunningSyncs(client);
  const resolutionRuns = await tableExists(client, "signal_semantic_resolution_runs")
    ? Number((await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM signal_semantic_resolution_runs"
      )).rows[0]?.count ?? 0)
    : 0;
  const resolutionItems = await tableExists(client, "signal_semantic_resolution_run_items")
    ? Number((await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM signal_semantic_resolution_run_items"
      )).rows[0]?.count ?? 0)
    : 0;
  const state = {
    operational_v1: v1,
    semantic: semantic.rows[0]!,
    laika: laika.rows[0]!,
    other_workspaces: otherWorkspaces.rows[0]!,
    running_syncs: runningSyncs,
    resolution: {
      run_count: resolutionRuns,
      item_count: resolutionItems,
      resolver_jobs_enqueued: 0
    }
  };
  return { ...state, aggregate_hash: sha256(JSON.stringify(state)) };
}

async function ledgerExists(client: pg.Client) {
  return (await client.query<{ exists: boolean }>(
    "SELECT to_regclass('public.' || $1) IS NOT NULL AS exists", [LEDGER]
  )).rows[0]?.exists === true;
}

async function readLedger(client: pg.Client) {
  if (!(await ledgerExists(client))) return [];
  return (await client.query<{
    migration_name: string;
    ordinal: number;
    checksum_sha256: string;
    disposition: string;
    runner_version: string;
  }>(`
    SELECT migration_name, ordinal, checksum_sha256, disposition, runner_version
    FROM ${LEDGER} ORDER BY ordinal
  `)).rows;
}

async function inspectPrerequisites(client: pg.Client) {
  const sentinelState = await inspectSentinels(client, PREREQUISITE_0064_SENTINELS);
  const ledger = await readLedger(client);
  const requiredOrdinals = [59, 60, 61, 62, 63, 64];
  const missingLedgerOrdinals = requiredOrdinals.filter(
    (ordinal) => !ledger.some((row) => row.ordinal === ordinal)
  );
  const unexpected = ledger.filter((row) => row.ordinal > 65);
  const migration0064 = ledger.find((row) => row.ordinal === 64);
  const problems: string[] = [];
  if (sentinelState.state !== "complete") problems.push("0064 sentinels are incomplete");
  if (missingLedgerOrdinals.length > 0) {
    problems.push(`missing ledger ordinals: ${missingLedgerOrdinals.join(",")}`);
  }
  if (!migration0064 || migration0064.migration_name !== "0064_signal_semantic_scope_hardening.sql") {
    problems.push("0064 ledger identity is missing or unexpected");
  }
  if (unexpected.length > 0) problems.push("unexpected migrations exist after 0065");
  return {
    ok: problems.length === 0,
    migration_0064: sentinelState,
    missing_ledger_ordinals: missingLedgerOrdinals,
    unexpected_migrations_after_0065: unexpected.map((row) => row.migration_name),
    problems
  };
}

async function recordMigration(client: pg.Client, checksum: string, fingerprint: string) {
  await client.query(`
    INSERT INTO ${LEDGER} (
      migration_name, ordinal, checksum_sha256, disposition, runner_version, target_fingerprint
    ) VALUES ($1, 65, $2, 'applied', $3, $4)
  `, [MIGRATION_FILENAME, checksum, RUNNER_VERSION, fingerprint]);
}

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const mode = readMode();
  const fingerprint = targetFingerprint(databaseUrl);
  const target = assertTarget(databaseUrl, mode, fingerprint);
  const dbRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const sql = await readFile(join(dbRoot, "migrations", MIGRATION_FILENAME), "utf8");
  const checksum = sha256(sql);
  if (checksum !== EXPECTED_CHECKSUM) {
    throw new Error(`0065 checksum mismatch: expected ${EXPECTED_CHECKSUM}, observed ${checksum}.`);
  }
  const expectedFunctionHash = expectedReviewFunctionBodyHash(sql);
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig(),
    application_name: "noisia-semantic-resolution-0065-rehearsal"
  });
  await client.connect();
  let readOnly = false;
  try {
    await client.query("SET statement_timeout = '15min'");
    await client.query("SET lock_timeout = '15s'");
    if (mode !== "apply") {
      await client.query("BEGIN TRANSACTION READ ONLY");
      readOnly = true;
    }
    const prerequisites = await inspectPrerequisites(client);
    const connections = await inspectConnections(client);
    const runningSyncs = await inspectRunningSyncs(client);
    const migrationBefore = await inspectSentinels(client, MIGRATION_SENTINELS);
    const ledgerBefore = await readLedger(client);
    const protectedBefore = await inspectProtectedState(client);

    if (!prerequisites.ok) throw new Error(`0065 prerequisites failed: ${prerequisites.problems.join("; ")}.`);
    if (migrationBefore.state === "partial") {
      throw new Error(`0065 is partially applied: ${migrationBefore.missing.join(", ")}`);
    }
    if (connections.named_noisia_connections > 0
      || connections.active_other_client_connections > 0
      || connections.long_running_active_connections > 0) {
      throw new Error("Studio, Workers or another active client is connected; 0065 gate failed.");
    }
    if (protectedBefore.laika.workspace_count !== 1) {
      throw new Error("0065 requires exactly one Laika workspace in the rehearsal target.");
    }

    let actions: Array<{ migration: string; action: string }> = [];
    let writesPerformed = false;
    let protectedAfter = protectedBefore;
    if (mode === "apply") {
      if (runningSyncs.count > 0 && process.env[RUNNING_SYNCS_ACK_ENV] !== "true") {
        throw new Error(`${RUNNING_SYNCS_ACK_ENV}=true is required to acknowledge stale syncs without changing them.`);
      }
      const expectedState = process.env[EXPECTED_STATE_DIGEST_ENV];
      if (expectedState && expectedState !== protectedBefore.aggregate_hash) {
        throw new Error("Protected state changed after preflight; refusing 0065 apply.");
      }
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [LOCK_KEY]);
      try {
        const lockedBefore = await inspectSentinels(client, MIGRATION_SENTINELS);
        const ledger = await readLedger(client);
        const recorded = ledger.find((row) => row.ordinal === 65);
        if (recorded) {
          if (recorded.migration_name !== MIGRATION_FILENAME || recorded.checksum_sha256 !== checksum) {
            throw new Error("Checksum or identity mismatch for recorded migration 0065.");
          }
          if (lockedBefore.state !== "complete") {
            throw new Error("0065 is recorded but its sentinels are incomplete.");
          }
          actions = [{ migration: MIGRATION_FILENAME, action: "verified_existing" }];
        } else {
          if (lockedBefore.state !== "absent") {
            throw new Error("0065 is complete without a matching ledger row or is partial.");
          }
          await client.query("BEGIN");
          try {
            await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [LOCK_KEY]);
            await client.query(sql);
            const afterSentinels = await inspectSentinels(client, MIGRATION_SENTINELS);
            if (afterSentinels.state !== "complete") {
              throw new Error(`0065 failed sentinel verification: ${afterSentinels.missing.join(", ")}`);
            }
            const functionContract = await inspectFunctionContract(client, expectedFunctionHash);
            if (!functionContract.matches) throw new Error("0065 Review function body hash differs from authorized SQL.");
            protectedAfter = await inspectProtectedState(client);
            if (JSON.stringify(protectedAfter) !== JSON.stringify(protectedBefore)) {
              throw new Error("0065 changed protected population, Review or resolver row state; transaction rolled back.");
            }
            await recordMigration(client, checksum, fingerprint);
            await client.query("COMMIT");
            actions = [{ migration: MIGRATION_FILENAME, action: "applied" }];
            writesPerformed = true;
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          }
        }
      } finally {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [LOCK_KEY]);
      }
    }

    const migrationAfter = await inspectSentinels(client, MIGRATION_SENTINELS);
    const functionContract = migrationAfter.state === "complete"
      ? await inspectFunctionContract(client, expectedFunctionHash)
      : { expected_body_hash: expectedFunctionHash, observed_body_hash: null, matches: false };
    if (mode === "verify") {
      if (migrationAfter.state !== "complete") throw new Error("0065 verify requires complete sentinels.");
      if (!functionContract.matches) throw new Error("0065 verify failed the Review function body hash.");
      const ledger = await readLedger(client);
      const rows = ledger.filter((row) => row.ordinal === 65);
      if (rows.length !== 1 || rows[0]?.migration_name !== MIGRATION_FILENAME
        || rows[0]?.checksum_sha256 !== checksum) {
        throw new Error("0065 verify requires exactly one matching ledger row.");
      }
      const expectedState = process.env[EXPECTED_STATE_DIGEST_ENV];
      if (expectedState && expectedState !== protectedAfter.aggregate_hash) {
        throw new Error("Protected state differs from the authorized preflight baseline.");
      }
    }
    if (readOnly) {
      await client.query("ROLLBACK");
      readOnly = false;
    }
    const ledgerAfter = await readLedger(client);
    console.log(JSON.stringify({
      ok: true,
      runner_version: RUNNER_VERSION,
      mode,
      target: target.target,
      target_fingerprint: fingerprint,
      migration: MIGRATION_FILENAME,
      migration_checksum: checksum,
      authorized_checksum: EXPECTED_CHECKSUM,
      writes_performed: writesPerformed,
      resolver_executed: false,
      workers_started: false,
      shadow_or_cutover_executed: false,
      restore_guard: {
        required: !target.local,
        verified: target.local ? null : process.env[RESTORE_VERIFIED_ENV] === "true",
        restore_point_at: target.local ? null : process.env[RESTORE_POINT_AT_ENV] ?? null,
        reference_redacted: true
      },
      connections,
      running_syncs: runningSyncs,
      prerequisites,
      migration_before: migrationBefore,
      protected_state_before: protectedBefore,
      actions,
      migration_after: migrationAfter,
      function_contract: functionContract,
      protected_state_after: protectedAfter,
      protected_state_unchanged:
        JSON.stringify(protectedBefore) === JSON.stringify(protectedAfter),
      ledger: {
        rows_before: ledgerBefore,
        rows_after: ledgerAfter,
        migration_0065_rows: ledgerAfter.filter((row) => row.ordinal === 65).length
      }
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

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

const RUNNER_VERSION = "signal-workspace-data-plane-rehearsal-v1";
const LOCK_KEY = "noisia:signal-workspace-data-plane:0059-0063";
const LEDGER = "signal_workspace_data_plane_migration_ledger";
const MIGRATION_SCOPE_ENV = "NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_MIGRATION_SCOPE";
const SEMANTIC_SCOPE = "semantic-0064";
const SEMANTIC_RUNNER_VERSION = "signal-semantic-scope-rehearsal-v1";
const SEMANTIC_LOCK_KEY = "noisia:signal-semantic-scope:0064";
const SEMANTIC_EXPECTED_CHECKSUM =
  "sha256:62e45c4a63e7b0651133c23eec393a3bda1a4f948c358f931ed8a97cb8172e17";
const MODE_ENV = "NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_MIGRATION_MODE";
const APPLY_APPROVAL_ENV = "NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_SCHEMA_APPLY_APPROVED";
const ALLOW_REMOTE_ENV = "NOISIA_DB_APPLY_SIGNAL_WORKSPACE_DATA_PLANE_ALLOW_REMOTE";
const PREFLIGHT_ALLOW_REMOTE_ENV = "NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_PREFLIGHT_ALLOW_REMOTE";
const ISOLATED_TARGET_ENV = "NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_ISOLATED_TARGET_CONFIRMED";
const TARGET_FINGERPRINT_ENV = "NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_TARGET_FINGERPRINT";
const BACKUP_REFERENCE_ENV = "NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKUP_REFERENCE";
const RUNNING_SYNCS_ACK_ENV = "NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_RUNNING_SYNCS_ACKNOWLEDGED";
const AUTOLINK_REPAIR_ENV = "NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_0056_REPAIR_APPROVED";
const SEMANTIC_PREFLIGHT_ALLOW_REMOTE_ENV =
  "NOISIA_SIGNAL_SEMANTIC_SCOPE_PREFLIGHT_ALLOW_REMOTE";
const SEMANTIC_ALLOW_REMOTE_ENV = "NOISIA_DB_APPLY_SIGNAL_SEMANTIC_SCOPE_ALLOW_REMOTE";
const SEMANTIC_APPLY_APPROVAL_ENV =
  "NOISIA_SIGNAL_SEMANTIC_SCOPE_SCHEMA_APPLY_APPROVED";
const SEMANTIC_ISOLATED_TARGET_ENV =
  "NOISIA_SIGNAL_SEMANTIC_SCOPE_ISOLATED_TARGET_CONFIRMED";
const SEMANTIC_TARGET_FINGERPRINT_ENV =
  "NOISIA_SIGNAL_SEMANTIC_SCOPE_TARGET_FINGERPRINT";
const SEMANTIC_EXPECTED_V1_STATE_DIGEST_ENV =
  "NOISIA_SIGNAL_SEMANTIC_SCOPE_EXPECTED_V1_STATE_DIGEST";
const SEMANTIC_RESTORE_REFERENCE_ENV =
  "NOISIA_SIGNAL_SEMANTIC_SCOPE_RESTORE_REFERENCE";
const SEMANTIC_RESTORE_VERIFIED_ENV =
  "NOISIA_SIGNAL_SEMANTIC_SCOPE_RESTORE_VERIFIED";
const SEMANTIC_RESTORE_POINT_AT_ENV =
  "NOISIA_SIGNAL_SEMANTIC_SCOPE_RESTORE_POINT_AT";
const SEMANTIC_NO_APP_CONNECTIONS_ENV =
  "NOISIA_SIGNAL_SEMANTIC_SCOPE_NO_APP_CONNECTIONS_CONFIRMED";
const SEMANTIC_RUNNING_SYNCS_ACK_ENV =
  "NOISIA_SIGNAL_SEMANTIC_SCOPE_RUNNING_SYNCS_ACKNOWLEDGED";

type Mode = "preflight" | "apply" | "verify";
type SentinelKind =
  | "table"
  | "column"
  | "function"
  | "function_definition"
  | "index"
  | "trigger"
  | "constraint";
type Sentinel = {
  kind: SentinelKind;
  relation?: string;
  name: string;
  contains?: string;
};
type MigrationState = "absent" | "partial" | "complete";

type MigrationDefinition = {
  ordinal: number;
  filename: string;
  sentinels: Sentinel[];
};

type LoadedMigration = MigrationDefinition & {
  checksum: string;
  sql: string;
};

const MIGRATIONS: MigrationDefinition[] = [
  {
    ordinal: 59,
    filename: "0059_signal_workspace_owned_data_plane.sql",
    sentinels: [
      { kind: "table", name: "signal_workspace_reports" },
      { kind: "table", name: "signal_population_definitions" },
      { kind: "table", name: "signal_workspace_population_pointers" },
      { kind: "table", name: "signal_mention_import_memberships" },
      { kind: "table", name: "signal_mention_study_memberships" },
      { kind: "table", name: "signal_mention_attributions" },
      { kind: "table", name: "signal_population_memberships" },
      { kind: "table", name: "signal_snapshot_watermarks" },
      { kind: "table", name: "signal_workspace_report_current_releases" },
      { kind: "column", relation: "mentions", name: "workspace_id" },
      { kind: "column", relation: "mentions", name: "canonical_mention_id" },
      { kind: "column", relation: "import_batches", name: "workspace_id" },
      { kind: "column", relation: "data_sources", name: "governed_scope" },
      { kind: "function", name: "ensure_signal_workspace_for_brand(uuid,uuid)" },
      { kind: "function", name: "reconcile_signal_operational_population(uuid)" },
      {
        kind: "function",
        name: "record_signal_workspace_data_acceptance(uuid,text,uuid,uuid,timestamp with time zone,timestamp with time zone)"
      },
      {
        kind: "function",
        name: "create_signal_workspace_population_snapshot(uuid,uuid,uuid,text,text,uuid,jsonb)"
      }
    ]
  },
  {
    ordinal: 60,
    filename: "0060_signal_operational_population_serving.sql",
    sentinels: [
      { kind: "column", relation: "metric_materializations", name: "population_id" },
      { kind: "column", relation: "metric_materializations", name: "population_version" },
      { kind: "column", relation: "signal_data_invalidations", name: "population_id" },
      { kind: "table", name: "signal_operational_serving_shadow_results" },
      {
        kind: "function",
        name: "record_signal_workspace_data_acceptance_v2(uuid,text,uuid,uuid,timestamp with time zone,timestamp with time zone)"
      },
      { kind: "function", name: "invalidate_signal_operational_population_materializations()" },
      { kind: "index", name: "idx_metric_materializations_signal_population_facade" }
    ]
  },
  {
    ordinal: 61,
    filename: "0061_signal_operational_membership_invalidation_shadow_outbox.sql",
    sentinels: [
      { kind: "table", name: "signal_operational_shadow_requests" },
      { kind: "function", name: "invalidate_signal_population_membership_change()" },
      { kind: "function", name: "enforce_signal_operational_shadow_request_scope()" },
      {
        kind: "trigger",
        relation: "signal_population_memberships",
        name: "trg_signal_population_membership_invalidation"
      },
      { kind: "index", name: "idx_signal_operational_shadow_requests_recovery" }
    ]
  },
  {
    ordinal: 62,
    filename: "0062_signal_strategic_consumption.sql",
    sentinels: [
      { kind: "column", relation: "signal_population_definitions", name: "membership_digest" },
      { kind: "column", relation: "corpus_snapshots", name: "idempotency_key" },
      { kind: "column", relation: "tb_analyses", name: "workspace_id" },
      { kind: "column", relation: "tb_analyses", name: "report_key" },
      { kind: "table", name: "signal_strategic_run_outbox" },
      { kind: "table", name: "tb_analysis_context_refs" },
      { kind: "table", name: "tb_reusable_assertion_review_events" },
      {
        kind: "function",
        name: "create_signal_tb_analysis_population(uuid,text,date,date,text,text,text,uuid,text)"
      },
      {
        kind: "function",
        name: "create_signal_tb_strategic_run(uuid,text,uuid,uuid,uuid,text,text,text,text,text,text,text,text,integer,jsonb)"
      },
      { kind: "function", name: "assert_signal_tb_snapshot_containment(uuid,text)" },
      { kind: "function", name: "promote_signal_workspace_report_release(uuid,uuid)" }
    ]
  },
  {
    ordinal: 63,
    filename: "0063_signal_strategic_run_outbox_recovery.sql",
    sentinels: [
      { kind: "column", relation: "signal_strategic_run_outbox", name: "lease_token" },
      { kind: "column", relation: "signal_strategic_run_outbox", name: "lease_expires_at" },
      { kind: "column", relation: "signal_strategic_run_outbox", name: "dead_lettered_at" },
      { kind: "column", relation: "signal_strategic_run_outbox", name: "bullmq_job_id" },
      { kind: "index", name: "idx_signal_strategic_run_outbox_recovery" },
      { kind: "index", name: "idx_signal_strategic_run_outbox_bullmq_job" }
    ]
  }
];

const SEMANTIC_MIGRATION: MigrationDefinition = {
  ordinal: 64,
  filename: "0064_signal_semantic_scope_hardening.sql",
  sentinels: [
    { kind: "column", relation: "signal_mention_attributions", name: "attribution_basis" },
    { kind: "column", relation: "signal_mention_attributions", name: "eligibility_status" },
    { kind: "column", relation: "signal_mention_attributions", name: "semantic_policy_key" },
    { kind: "column", relation: "signal_mention_attributions", name: "assertion_version" },
    { kind: "column", relation: "signal_mention_attributions", name: "supersedes_attribution_id" },
    { kind: "column", relation: "signal_mention_attributions", name: "is_current" },
    { kind: "column", relation: "signal_mention_attributions", name: "idempotency_key" },
    { kind: "table", name: "signal_mention_attribution_review_events" },
    {
      kind: "constraint",
      relation: "signal_mention_attributions",
      name: "signal_mention_attribution_basis_contract"
    },
    {
      kind: "constraint",
      relation: "signal_mention_attributions",
      name: "signal_mention_attribution_eligible_contract"
    },
    { kind: "index", name: "uq_signal_mention_source_intent_provenance" },
    { kind: "index", name: "uq_signal_mention_semantic_idempotency" },
    { kind: "index", name: "uq_signal_mention_semantic_current" },
    { kind: "index", name: "idx_signal_mention_semantic_eligible" },
    {
      kind: "function",
      name: "create_signal_mention_semantic_assertion(uuid,uuid,uuid,uuid,text,text,uuid,text,numeric,text,text,text,text,text,text,uuid)"
    },
    {
      kind: "function",
      name: "review_signal_mention_semantic_assertion(uuid,uuid,text,text,text,text,text,text)"
    },
    {
      kind: "function",
      name: "supersede_signal_mention_semantic_assertion(uuid,uuid,text,text,uuid,text,numeric,text,text,text,text,text,text,text,text,text)"
    },
    { kind: "function", name: "ensure_signal_operational_semantic_candidate_v2(uuid,uuid)" },
    { kind: "function", name: "reconcile_signal_semantic_candidate_population_mention(uuid,uuid)" },
    {
      kind: "function_definition",
      name: "record_signal_mention_import_provenance(uuid,uuid)",
      contains: "'source_intent'"
    },
    {
      kind: "function_definition",
      name: "reconcile_signal_operational_population_mention(uuid,uuid)",
      contains: "semantic_contract"
    },
    {
      kind: "function_definition",
      name: "create_signal_tb_analysis_population(uuid,text,date,date,text,text,text,uuid,text)",
      contains: "signal-tb-analysis-population-semantic-v2"
    },
    {
      kind: "function_definition",
      name: "create_signal_tb_strategic_run(uuid,text,uuid,uuid,uuid,text,text,text,text,text,text,text,text,integer,jsonb)",
      contains: "signal-tb-analysis-population-semantic-v2"
    },
    {
      kind: "trigger",
      relation: "signal_mention_attribution_review_events",
      name: "trg_signal_attribution_review_events_append_only"
    },
    {
      kind: "trigger",
      relation: "signal_mention_attributions",
      name: "trg_signal_semantic_attribution_contract"
    },
    {
      kind: "function_definition",
      name: "reconcile_signal_population_after_attribution()",
      contains: "attribution_basis"
    },
    {
      kind: "trigger",
      relation: "signal_workspaces",
      name: "trg_signal_semantic_candidate_workspace_insert"
    }
  ]
};

const AUTOLINK_PREREQUISITE: MigrationDefinition = {
  ordinal: 56,
  filename: "0056_signal_workspace_auto_membership.sql",
  sentinels: [
    { kind: "function", name: "attach_study_corpus_to_signal_workspace()" },
    {
      kind: "trigger",
      relation: "study_corpora",
      name: "trg_study_corpora_signal_workspace_membership"
    }
  ]
};

const BASE_TABLES = [
  "brands",
  "study_corpora",
  "signal_workspaces",
  "signal_workspace_corpora",
  "signal_data_watermarks",
  "signal_data_invalidations",
  "signal_workspace_releases",
  "metric_materializations",
  "corpus_snapshots",
  "tb_analyses",
  "tb_mention_codings",
  "tb_finding_citations",
  "analysis_evidence_links",
  "signal_taxonomy_profiles",
  "record_tags"
];

function readMode(): Mode {
  const value = (process.env[MODE_ENV] ?? "preflight").trim().toLowerCase();
  if (value === "preflight" || value === "apply" || value === "verify") return value;
  throw new Error(`${MODE_ENV} must be preflight, apply or verify.`);
}

function isSemanticScope() {
  return (process.env[MIGRATION_SCOPE_ENV] ?? "").trim().toLowerCase() === SEMANTIC_SCOPE;
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function targetFingerprint(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  const identity = [
    parsed.protocol,
    parsed.hostname.toLowerCase(),
    parsed.port || "5432",
    parsed.pathname.replace(/^\//, ""),
    parsed.username
  ].join("|");
  return sha256(identity);
}

function assertTarget(databaseUrl: string, mode: Mode, fingerprint: string) {
  const local = isLocalDatabaseUrl(databaseUrl);
  const target = (process.env.NOISIA_REMOTE_DATABASE_TARGET ?? "").trim().toLowerCase();

  if (!local) {
    if (target !== "preview" && target !== "staging") {
      throw new Error(
        "Remote rehearsal requires a real isolated target classified as NOISIA_REMOTE_DATABASE_TARGET=preview or staging."
      );
    }
    if (databaseUrlLooksProductionLike(databaseUrl)) {
      throw new Error("Refusing a production-like DATABASE_URL for Signal data-plane rehearsal.");
    }
    if (process.env[PREFLIGHT_ALLOW_REMOTE_ENV] !== "true") {
      throw new Error(`${PREFLIGHT_ALLOW_REMOTE_ENV}=true is required for remote inspection.`);
    }
    requireSafeDatabaseReadTarget(databaseUrl, {
      operation: "inspect Signal workspace data-plane rehearsal target",
      allowRemoteEnv: PREFLIGHT_ALLOW_REMOTE_ENV
    });
  }

  if (mode !== "apply") return { local, target: local ? "local" : target };

  if (process.env[APPLY_APPROVAL_ENV] !== "true") {
    throw new Error(`${APPLY_APPROVAL_ENV}=true is required for apply mode.`);
  }
  if (!local) {
    if (process.env[ALLOW_REMOTE_ENV] !== "true") {
      throw new Error(`${ALLOW_REMOTE_ENV}=true is required for remote apply mode.`);
    }
    if (process.env[ISOLATED_TARGET_ENV] !== "true") {
      throw new Error(`${ISOLATED_TARGET_ENV}=true is required after verifying an isolated clone.`);
    }
    if (process.env[TARGET_FINGERPRINT_ENV] !== fingerprint) {
      throw new Error(
        `${TARGET_FINGERPRINT_ENV} must exactly match the fingerprint emitted by preflight.`
      );
    }
    const backupReference = process.env[BACKUP_REFERENCE_ENV]?.trim() ?? "";
    if (backupReference.length < 8) {
      throw new Error(`${BACKUP_REFERENCE_ENV} must identify a verified restore point.`);
    }
    requireSafeDatabaseWriteTarget(databaseUrl, {
      operation: "apply Signal workspace data-plane migrations 0059-0063",
      allowRemoteEnv: ALLOW_REMOTE_ENV
    });
  }

  return { local, target: local ? "local" : target };
}

function assertSemanticRestorePoint() {
  if (process.env[SEMANTIC_RESTORE_VERIFIED_ENV] !== "true") {
    throw new Error(`${SEMANTIC_RESTORE_VERIFIED_ENV}=true is required for the 0064 rehearsal.`);
  }
  const restoreReference = process.env[SEMANTIC_RESTORE_REFERENCE_ENV]?.trim() ?? "";
  if (restoreReference.length < 8) {
    throw new Error(`${SEMANTIC_RESTORE_REFERENCE_ENV} must identify the verified restore point.`);
  }
  const restorePointAt = process.env[SEMANTIC_RESTORE_POINT_AT_ENV]?.trim() ?? "";
  const restorePointTime = Date.parse(restorePointAt);
  const restoreAgeMs = Date.now() - restorePointTime;
  if (!Number.isFinite(restorePointTime) || restoreAgeMs < 0 || restoreAgeMs > 36 * 60 * 60 * 1000) {
    throw new Error(
      `${SEMANTIC_RESTORE_POINT_AT_ENV} must be a verified ISO timestamp no older than 36 hours.`
    );
  }
}

function assertSemanticTarget(databaseUrl: string, mode: Mode, fingerprint: string) {
  const local = isLocalDatabaseUrl(databaseUrl);
  const target = (process.env.NOISIA_REMOTE_DATABASE_TARGET ?? "").trim().toLowerCase();

  if (!local) {
    if (target !== "preview" && target !== "staging") {
      throw new Error(
        "Remote 0064 rehearsal requires NOISIA_REMOTE_DATABASE_TARGET=preview or staging."
      );
    }
    if (databaseUrlLooksProductionLike(databaseUrl)) {
      throw new Error("Refusing a production-like DATABASE_URL for the 0064 rehearsal.");
    }
    if (process.env[SEMANTIC_PREFLIGHT_ALLOW_REMOTE_ENV] !== "true") {
      throw new Error(`${SEMANTIC_PREFLIGHT_ALLOW_REMOTE_ENV}=true is required for remote inspection.`);
    }
    requireSafeDatabaseReadTarget(databaseUrl, {
      operation: "inspect Signal semantic-scope migration 0064 target",
      allowRemoteEnv: SEMANTIC_PREFLIGHT_ALLOW_REMOTE_ENV
    });
    if (process.env[SEMANTIC_NO_APP_CONNECTIONS_ENV] !== "true") {
      throw new Error(
        `${SEMANTIC_NO_APP_CONNECTIONS_ENV}=true is required after verifying Studio and Workers are disconnected.`
      );
    }
    assertSemanticRestorePoint();
    if (mode === "verify" && !/^sha256:[0-9a-f]{64}$/u.test(
      process.env[SEMANTIC_EXPECTED_V1_STATE_DIGEST_ENV] ?? ""
    )) {
      throw new Error(
        `${SEMANTIC_EXPECTED_V1_STATE_DIGEST_ENV} must copy the authorized preflight V1 digest for verify.`
      );
    }
  }

  if (mode !== "apply") return { local, target: local ? "local" : target };

  if (process.env[SEMANTIC_APPLY_APPROVAL_ENV] !== "true") {
    throw new Error(`${SEMANTIC_APPLY_APPROVAL_ENV}=true is required for 0064 apply mode.`);
  }
  if (!local) {
    if (process.env[SEMANTIC_ALLOW_REMOTE_ENV] !== "true") {
      throw new Error(`${SEMANTIC_ALLOW_REMOTE_ENV}=true is required for remote 0064 apply.`);
    }
    if (process.env[SEMANTIC_ISOLATED_TARGET_ENV] !== "true") {
      throw new Error(`${SEMANTIC_ISOLATED_TARGET_ENV}=true is required for 0064 apply.`);
    }
    if (process.env[SEMANTIC_TARGET_FINGERPRINT_ENV] !== fingerprint) {
      throw new Error(
        `${SEMANTIC_TARGET_FINGERPRINT_ENV} must exactly match the fingerprint emitted by the 0064 preflight.`
      );
    }
    if (!/^sha256:[0-9a-f]{64}$/u.test(
      process.env[SEMANTIC_EXPECTED_V1_STATE_DIGEST_ENV] ?? ""
    )) {
      throw new Error(
        `${SEMANTIC_EXPECTED_V1_STATE_DIGEST_ENV} must exactly copy the V1 digest emitted by preflight.`
      );
    }
    requireSafeDatabaseWriteTarget(databaseUrl, {
      operation: "apply Signal semantic-scope migration 0064",
      allowRemoteEnv: SEMANTIC_ALLOW_REMOTE_ENV
    });
  }

  return { local, target: local ? "local" : target };
}

async function loadMigrations() {
  const dbRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const loaded: LoadedMigration[] = [];
  for (const migration of MIGRATIONS) {
    const sql = await readFile(join(dbRoot, "migrations", migration.filename), "utf8");
    loaded.push({ ...migration, sql, checksum: sha256(sql) });
  }
  return loaded;
}

async function loadMigration(definition: MigrationDefinition) {
  const dbRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const sql = await readFile(join(dbRoot, "migrations", definition.filename), "utf8");
  return { ...definition, sql, checksum: sha256(sql) } satisfies LoadedMigration;
}

async function loadSemanticMigration() {
  const migration = await loadMigration(SEMANTIC_MIGRATION);
  if (migration.checksum !== SEMANTIC_EXPECTED_CHECKSUM) {
    throw new Error(
      `0064 checksum mismatch: expected ${SEMANTIC_EXPECTED_CHECKSUM}, observed ${migration.checksum}.`
    );
  }
  return migration;
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
  if (sentinel.kind === "function") {
    const result = await client.query<{ exists: boolean }>(
      "SELECT to_regprocedure($1) IS NOT NULL AS exists",
      [`public.${sentinel.name}`]
    );
    return result.rows[0]?.exists === true;
  }
  if (sentinel.kind === "function_definition") {
    if (!sentinel.contains) throw new Error(`Function definition sentinel ${sentinel.name} has no token.`);
    const result = await client.query<{ matches: boolean }>(`
      SELECT COALESCE(
        position($2 in pg_get_functiondef(to_regprocedure($1))) > 0,
        false
      ) AS matches
    `, [`public.${sentinel.name}`, sentinel.contains]);
    return result.rows[0]?.matches === true;
  }
  if (sentinel.kind === "index") {
    const result = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1
      ) AS exists
    `, [sentinel.name]);
    return result.rows[0]?.exists === true;
  }
  if (sentinel.kind === "constraint") {
    const result = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_constraint constraint_row
        JOIN pg_class relation ON relation.oid = constraint_row.conrelid
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relname = $1
          AND constraint_row.conname = $2
      ) AS exists
    `, [sentinel.relation, sentinel.name]);
    return result.rows[0]?.exists === true;
  }
  const result = await client.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_trigger trigger
      JOIN pg_class relation ON relation.oid = trigger.tgrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = $1
        AND trigger.tgname = $2
        AND NOT trigger.tgisinternal
    ) AS exists
  `, [sentinel.relation, sentinel.name]);
  return result.rows[0]?.exists === true;
}

function sentinelKey(sentinel: Sentinel) {
  return sentinel.kind === "column" || sentinel.kind === "trigger" || sentinel.kind === "constraint"
    ? `${sentinel.kind}:${sentinel.relation}.${sentinel.name}`
    : `${sentinel.kind}:${sentinel.name}`;
}

async function inspectMigration(client: pg.Client, migration: LoadedMigration) {
  const checks: Array<{ key: string; exists: boolean }> = [];
  for (const sentinel of migration.sentinels) {
    checks.push({
      key: sentinelKey(sentinel),
      exists: await sentinelExists(client, sentinel)
    });
  }
  const present = checks.filter((check) => check.exists).length;
  const state: MigrationState = present === 0
    ? "absent"
    : present === checks.length
      ? "complete"
      : "partial";
  return {
    state,
    required: checks.length,
    present,
    missing: checks.filter((check) => !check.exists).map((check) => check.key)
  };
}

async function inspectMigrations(client: pg.Client, migrations: LoadedMigration[]) {
  const results: Array<{
    migration: string;
    checksum: string;
    state: MigrationState;
    required: number;
    present: number;
    missing: string[];
  }> = [];
  for (const migration of migrations) {
    results.push({
      migration: migration.filename,
      checksum: migration.checksum,
      ...(await inspectMigration(client, migration))
    });
  }
  return results;
}

async function inspectBasePrerequisites(client: pg.Client) {
  const tables = await client.query<{ name: string; exists: boolean }>(`
    SELECT name, to_regclass('public.' || name) IS NOT NULL AS exists
    FROM unnest($1::text[]) AS required(name)
    ORDER BY name
  `, [BASE_TABLES]);
  const objects = await client.query<{
    autolink_function: boolean;
    autolink_trigger: boolean;
    taxonomy_profile_column: boolean;
    approval_source_column: boolean;
  }>(`
    SELECT
      to_regprocedure('public.attach_study_corpus_to_signal_workspace()') IS NOT NULL
        AS autolink_function,
      EXISTS (
        SELECT 1 FROM pg_trigger trigger
        JOIN pg_class relation ON relation.oid = trigger.tgrelid
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relname = 'study_corpora'
          AND trigger.tgname = 'trg_study_corpora_signal_workspace_membership'
          AND NOT trigger.tgisinternal
      ) AS autolink_trigger,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'record_tags'
          AND column_name = 'signal_taxonomy_profile_id'
      ) AS taxonomy_profile_column,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'record_tags'
          AND column_name = 'approval_source'
      ) AS approval_source_column
  `);
  const missing = tables.rows.filter((row) => !row.exists).map((row) => `table:${row.name}`);
  const objectState = objects.rows[0];
  if (!objectState?.taxonomy_profile_column) {
    missing.push("column:record_tags.signal_taxonomy_profile_id");
  }
  if (!objectState?.approval_source_column) missing.push("column:record_tags.approval_source");
  const autolinkPresent = Number(Boolean(objectState?.autolink_function))
    + Number(Boolean(objectState?.autolink_trigger));
  const autolink_state: MigrationState = autolinkPresent === 0
    ? "absent"
    : autolinkPresent === 2
      ? "complete"
      : "partial";
  return {
    ok: missing.length === 0 && autolink_state === "complete",
    core_ok: missing.length === 0,
    missing,
    autolink_state,
    autolink_repair_requires_explicit_approval: autolink_state !== "complete"
  };
}

async function inspectRunningSyncs(client: pg.Client) {
  const relation = await client.query<{ exists: boolean }>(
    "SELECT to_regclass('public.source_sync_runs') IS NOT NULL AS exists"
  );
  if (!relation.rows[0]?.exists) return { count: 0, oldest_started_at: null, max_idle_seconds: null };
  const result = await client.query<{
    count: number;
    oldest_started_at: string | null;
    max_idle_seconds: string | null;
  }>(`
    SELECT
      count(*)::int AS count,
      min(started_at)::text AS oldest_started_at,
      max(extract(epoch FROM now() - COALESCE(started_at, created_at)))::bigint::text
        AS max_idle_seconds
    FROM source_sync_runs
    WHERE status = 'running'
  `);
  return result.rows[0] ?? { count: 0, oldest_started_at: null, max_idle_seconds: null };
}

async function inspectAppConnections(client: pg.Client) {
  const result = await client.query<{
    other_client_connections: number;
    active_other_client_connections: number;
    named_noisia_connections: number;
    long_running_active_connections: number;
  }>(`
    SELECT
      count(*) FILTER (
        WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()
      )::int AS other_client_connections,
      count(*) FILTER (
        WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()
          AND state IS DISTINCT FROM 'idle'
      )::int AS active_other_client_connections,
      count(*) FILTER (
        WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()
          AND COALESCE(application_name, '') ~* '(noisia|studio|worker|bullmq)'
      )::int AS named_noisia_connections,
      count(*) FILTER (
        WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()
          AND state IS DISTINCT FROM 'idle'
          AND COALESCE(now() - xact_start, interval '0') > interval '5 minutes'
      )::int AS long_running_active_connections
    FROM pg_stat_activity
    WHERE datname = current_database()
  `);
  return {
    ...(result.rows[0] ?? {
      other_client_connections: 0,
      active_other_client_connections: 0,
      named_noisia_connections: 0,
      long_running_active_connections: 0
    }),
    application_names_redacted: true,
    operator_disconnection_confirmed:
      process.env[SEMANTIC_NO_APP_CONNECTIONS_ENV] === "true"
  };
}

async function ledgerExists(client: pg.Client) {
  const result = await client.query<{ exists: boolean }>(
    "SELECT to_regclass('public.' || $1) IS NOT NULL AS exists",
    [LEDGER]
  );
  return result.rows[0]?.exists === true;
}

async function readLedger(client: pg.Client) {
  if (!(await ledgerExists(client))) return new Map<string, { checksum: string; disposition: string }>();
  const result = await client.query<{ migration_name: string; checksum_sha256: string; disposition: string }>(`
    SELECT migration_name, checksum_sha256, disposition
    FROM ${LEDGER}
    ORDER BY ordinal
  `);
  return new Map(result.rows.map((row) => [row.migration_name, {
    checksum: row.checksum_sha256,
    disposition: row.disposition
  }]));
}

async function inspectLedgerRows(client: pg.Client) {
  if (!(await ledgerExists(client))) return [];
  const result = await client.query<{
    migration_name: string;
    ordinal: number;
    checksum_sha256: string;
    disposition: string;
    runner_version: string;
    target_fingerprint: string;
    applied_at: string;
  }>(`
    SELECT migration_name, ordinal, checksum_sha256, disposition,
      runner_version, target_fingerprint, applied_at::text
    FROM ${LEDGER}
    ORDER BY ordinal
  `);
  return result.rows;
}

async function createLedger(client: pg.Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${LEDGER} (
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
        CHECK (disposition IN ('applied', 'adopted', 'prerequisite_repaired'))
    )
  `);
  await client.query(`
    ALTER TABLE ${LEDGER}
      DROP CONSTRAINT IF EXISTS signal_workspace_data_plane_migration_disposition,
      ADD CONSTRAINT signal_workspace_data_plane_migration_disposition
        CHECK (disposition IN ('applied', 'adopted', 'prerequisite_repaired'))
  `);
}

async function inspectOperationalV1State(client: pg.Client) {
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
        ON definition.id = pointer.population_id
       AND definition.workspace_id = pointer.workspace_id
      WHERE pointer.purpose = 'operational'
        AND definition.status = 'active'
        AND definition.population_key = 'primary-brand-operational'
        AND definition.definition->>'contract_version'
          IS DISTINCT FROM 'signal-operational-primary-brand-semantic-v2'
    ),
    v1_definitions AS (
      SELECT definition.*
      FROM signal_population_definitions definition
      JOIN v1_pointers pointer ON pointer.population_id = definition.id
    ),
    v1_memberships AS (
      SELECT membership.*
      FROM signal_population_memberships membership
      JOIN v1_pointers pointer ON pointer.population_id = membership.population_id
    )
    SELECT
      (SELECT count(*)::int FROM v1_pointers) AS pointer_count,
      (SELECT count(*)::int FROM v1_definitions) AS definition_count,
      (SELECT count(*)::int FROM v1_memberships) AS membership_row_count,
      (SELECT count(*)::int FROM v1_memberships membership
       WHERE membership.membership_status = 'included'
         AND membership.removed_at IS NULL) AS included_membership_count,
      (SELECT count(*)::int
       FROM v1_memberships membership
       JOIN mentions mention ON mention.id = membership.mention_id
       WHERE membership.membership_status = 'included'
         AND membership.removed_at IS NULL
         AND mention.canonical_mention_id = mention.id) AS canonical_reader_count,
      (SELECT 'sha256:' || encode(sha256(convert_to(
         COALESCE(string_agg(to_jsonb(pointer.*)::text, E'\n'
           ORDER BY pointer.workspace_id, pointer.id), ''), 'UTF8')), 'hex')
       FROM v1_pointers pointer) AS pointer_content_hash,
      (SELECT 'sha256:' || encode(sha256(convert_to(
         COALESCE(string_agg(to_jsonb(definition.*)::text, E'\n'
           ORDER BY definition.workspace_id, definition.id), ''), 'UTF8')), 'hex')
       FROM v1_definitions definition) AS definition_content_hash,
      (SELECT 'sha256:' || encode(sha256(convert_to(
         COALESCE(string_agg(to_jsonb(membership.*)::text, E'\n'
           ORDER BY membership.population_id, membership.mention_id), ''), 'UTF8')), 'hex')
       FROM v1_memberships membership) AS membership_content_hash,
      (SELECT 'sha256:' || encode(sha256(convert_to(
         COALESCE(string_agg(membership.mention_id::text, ','
           ORDER BY membership.population_id, membership.mention_id), ''), 'UTF8')), 'hex')
       FROM v1_memberships membership
       JOIN mentions mention ON mention.id = membership.mention_id
       WHERE membership.membership_status = 'included'
         AND membership.removed_at IS NULL
         AND mention.canonical_mention_id = mention.id) AS canonical_reader_id_hash
  `);
  const state = result.rows[0]!;
  return {
    ...state,
    aggregate_hash: sha256(JSON.stringify(state))
  };
}

async function inspectSemanticState(client: pg.Client) {
  const result = await client.query<{
    active_workspaces: number;
    attribution_rows: number;
    source_intent_rows: number;
    source_intent_non_eligible_rows: number;
    mention_semantic_rows: number;
    approved_semantic_rows: number;
    review_event_rows: number;
    v2_definition_rows: number;
    v2_draft_rows: number;
    v2_pointer_rows: number;
    v2_membership_rows: number;
  }>(`
    WITH v2 AS (
      SELECT definition.id, definition.workspace_id, definition.status
      FROM signal_population_definitions definition
      WHERE definition.population_key = 'primary-brand-operational'
        AND definition.purpose = 'operational'
        AND definition.definition->>'contract_version'
          = 'signal-operational-primary-brand-semantic-v2'
    )
    SELECT
      (SELECT count(*)::int FROM signal_workspaces workspace
       WHERE workspace.status = 'active') AS active_workspaces,
      (SELECT count(*)::int FROM signal_mention_attributions) AS attribution_rows,
      (SELECT count(*)::int FROM signal_mention_attributions attribution
       WHERE attribution.attribution_basis = 'source_intent') AS source_intent_rows,
      (SELECT count(*)::int FROM signal_mention_attributions attribution
       WHERE attribution.attribution_basis = 'source_intent'
         AND attribution.eligibility_status = 'not_eligible') AS source_intent_non_eligible_rows,
      (SELECT count(*)::int FROM signal_mention_attributions attribution
       WHERE attribution.attribution_basis = 'mention_semantic') AS mention_semantic_rows,
      (SELECT count(*)::int FROM signal_mention_attributions attribution
       WHERE attribution.attribution_basis = 'mention_semantic'
         AND attribution.review_status = 'approved') AS approved_semantic_rows,
      (SELECT count(*)::int FROM signal_mention_attribution_review_events) AS review_event_rows,
      (SELECT count(*)::int FROM v2) AS v2_definition_rows,
      (SELECT count(*)::int FROM v2 WHERE status = 'draft') AS v2_draft_rows,
      (SELECT count(*)::int
       FROM signal_workspace_population_pointers pointer
       JOIN v2 ON v2.id = pointer.population_id) AS v2_pointer_rows,
      (SELECT count(*)::int
       FROM signal_population_memberships membership
       JOIN v2 ON v2.id = membership.population_id) AS v2_membership_rows
  `);
  return result.rows[0]!;
}

function assertSemanticStateIsNonDisruptive(
  state: Awaited<ReturnType<typeof inspectSemanticState>>
) {
  const problems: string[] = [];
  if (state.v2_definition_rows !== state.active_workspaces) {
    problems.push("expected exactly one semantic v2 candidate per active workspace");
  }
  if (state.v2_draft_rows !== state.v2_definition_rows) {
    problems.push("every semantic v2 candidate must remain draft");
  }
  if (state.v2_pointer_rows !== 0) problems.push("a current pointer targets semantic v2");
  if (state.v2_membership_rows !== 0) problems.push("semantic v2 contains initial memberships");
  if (state.source_intent_rows !== state.attribution_rows) {
    problems.push("not every inherited attribution is source_intent");
  }
  if (state.source_intent_non_eligible_rows !== state.attribution_rows) {
    problems.push("an inherited attribution is semantically eligible");
  }
  if (state.mention_semantic_rows !== 0 || state.approved_semantic_rows !== 0) {
    problems.push("0064 created semantic assertions");
  }
  if (state.review_event_rows !== 0) problems.push("0064 created Review events");
  if (problems.length > 0) {
    throw new Error(`0064 non-disruption verification failed: ${problems.join("; ")}.`);
  }
}

async function recordMigration(
  client: pg.Client,
  migration: LoadedMigration,
  disposition: "applied" | "adopted" | "prerequisite_repaired",
  fingerprint: string,
  runnerVersion: string = RUNNER_VERSION
) {
  await client.query(`
    INSERT INTO ${LEDGER} (
      migration_name, ordinal, checksum_sha256, disposition,
      runner_version, target_fingerprint
    ) VALUES ($1, $2, $3, $4, $5, $6)
  `, [
    migration.filename,
    migration.ordinal,
    migration.checksum,
    disposition,
    runnerVersion,
    fingerprint
  ]);
}

async function beginMigrationTransaction(client: pg.Client) {
  await client.query("BEGIN");
  // Keep each forward-only unit protected even if another operator does not
  // participate in the session-level rehearsal lock.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [LOCK_KEY]);
}

async function applyChain(
  client: pg.Client,
  autolinkPrerequisite: LoadedMigration,
  migrations: LoadedMigration[],
  fingerprint: string,
  runningSyncCount: number
) {
  if (runningSyncCount > 0 && process.env[RUNNING_SYNCS_ACK_ENV] !== "true") {
    throw new Error(
      `Found ${runningSyncCount} running source sync(s). Quiesce them or set ${RUNNING_SYNCS_ACK_ENV}=true only for an isolated clone with no connected workers.`
    );
  }

  await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [LOCK_KEY]);
  const actions: Array<{ migration: string; action: string }> = [];
  try {
    await beginMigrationTransaction(client);
    try {
      await createLedger(client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    const autolink = await inspectMigration(client, autolinkPrerequisite);
    if (autolink.state === "partial") {
      throw new Error(
        `0056 compatibility autolink is partially applied: ${autolink.missing.join(", ")}`
      );
    }
    if (autolink.state === "absent") {
      if (process.env[AUTOLINK_REPAIR_ENV] !== "true") {
        throw new Error(
          `${AUTOLINK_REPAIR_ENV}=true is required to install the missing 0056 compatibility function and trigger on the isolated clone.`
        );
      }
      await beginMigrationTransaction(client);
      try {
        await client.query(autolinkPrerequisite.sql);
        const repaired = await inspectMigration(client, autolinkPrerequisite);
        if (repaired.state !== "complete") {
          throw new Error("0056 compatibility autolink repair failed verification.");
        }
        await recordMigration(
          client,
          autolinkPrerequisite,
          "prerequisite_repaired",
          fingerprint
        );
        await client.query("COMMIT");
        actions.push({
          migration: autolinkPrerequisite.filename,
          action: "prerequisite_repaired"
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    for (const migration of migrations) {
      const ledger = await readLedger(client);
      const recorded = ledger.get(migration.filename);
      const before = await inspectMigration(client, migration);
      if (recorded) {
        if (recorded.checksum !== migration.checksum) {
          throw new Error(`Checksum mismatch for recorded migration ${migration.filename}.`);
        }
        if (before.state !== "complete") {
          throw new Error(`Recorded migration ${migration.filename} no longer verifies as complete.`);
        }
        actions.push({ migration: migration.filename, action: "verified_existing" });
        continue;
      }
      if (before.state === "partial") {
        throw new Error(
          `Refusing to continue a partially applied migration ${migration.filename}: ${before.missing.join(", ")}`
        );
      }

      await beginMigrationTransaction(client);
      try {
        let disposition: "applied" | "adopted";
        if (before.state === "complete") {
          disposition = "adopted";
        } else {
          await client.query(migration.sql);
          disposition = "applied";
        }
        const after = await inspectMigration(client, migration);
        if (after.state !== "complete") {
          throw new Error(
            `Migration ${migration.filename} failed verification: ${after.missing.join(", ")}`
          );
        }
        await recordMigration(client, migration, disposition, fingerprint);
        await client.query("COMMIT");
        actions.push({ migration: migration.filename, action: disposition });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [LOCK_KEY]);
  }
  return actions;
}

async function inspectSemanticPrerequisites(
  client: pg.Client,
  migrations: LoadedMigration[]
) {
  const base = await inspectBasePrerequisites(client);
  const migrationStates = await inspectMigrations(client, migrations);
  const ledger = await readLedger(client);
  const problems: string[] = [];
  if (!base.ok) {
    problems.push(`base prerequisites incomplete: ${[
      ...base.missing,
      base.autolink_state === "complete" ? null : `0056:${base.autolink_state}`
    ].filter(Boolean).join(", ")}`);
  }
  for (const [index, migration] of migrations.entries()) {
    const state = migrationStates[index];
    const recorded = ledger.get(migration.filename);
    if (state?.state !== "complete") {
      problems.push(`${migration.filename} is ${state?.state ?? "unknown"}`);
    }
    if (!recorded) {
      problems.push(`${migration.filename} is missing from the ledger`);
    } else if (recorded.checksum !== migration.checksum) {
      problems.push(`${migration.filename} ledger checksum differs from local authorized SQL`);
    }
  }
  return {
    ok: problems.length === 0,
    base,
    migrations: migrationStates,
    problems
  };
}

async function applySemanticMigration(
  client: pg.Client,
  migration: LoadedMigration,
  priorMigrations: LoadedMigration[],
  fingerprint: string,
  runningSyncCount: number,
  connections: Awaited<ReturnType<typeof inspectAppConnections>>
) {
  if (connections.named_noisia_connections > 0) {
    throw new Error("Named Studio/Workers connections are present; refusing 0064 apply.");
  }
  if (runningSyncCount > 0 && process.env[SEMANTIC_RUNNING_SYNCS_ACK_ENV] !== "true") {
    throw new Error(
      `Found ${runningSyncCount} stale running source sync(s). ${SEMANTIC_RUNNING_SYNCS_ACK_ENV}=true is required only after confirming the isolated preview has no Workers.`
    );
  }

  await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [SEMANTIC_LOCK_KEY]);
  try {
    const prerequisites = await inspectSemanticPrerequisites(client, priorMigrations);
    if (!prerequisites.ok) {
      throw new Error(`0064 prerequisites failed: ${prerequisites.problems.join("; ")}.`);
    }
    if (!(await ledgerExists(client))) {
      throw new Error("0064 requires the verified 0059-0063 migration ledger.");
    }
    const beforeMigration = await inspectMigration(client, migration);
    const ledger = await readLedger(client);
    const recorded = ledger.get(migration.filename);
    if (beforeMigration.state === "partial") {
      throw new Error(
        `Refusing partially applied 0064: ${beforeMigration.missing.join(", ")}`
      );
    }
    if (recorded) {
      if (recorded.checksum !== migration.checksum) {
        throw new Error("Checksum mismatch for recorded migration 0064.");
      }
      if (beforeMigration.state !== "complete") {
        throw new Error("0064 is recorded but its sentinels are not complete.");
      }
      return {
        actions: [{ migration: migration.filename, action: "verified_existing" }],
        writesPerformed: false,
        v1Before: await inspectOperationalV1State(client),
        v1After: await inspectOperationalV1State(client),
        semanticState: await inspectSemanticState(client)
      };
    }
    if (beforeMigration.state === "complete") {
      throw new Error("0064 is complete without a matching ledger row; manual reconciliation is required.");
    }

    const v1Before = await inspectOperationalV1State(client);
    const expectedV1 = process.env[SEMANTIC_EXPECTED_V1_STATE_DIGEST_ENV];
    if (expectedV1 && expectedV1 !== v1Before.aggregate_hash) {
      throw new Error("Operational V1 changed after preflight; refusing 0064 apply.");
    }

    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [SEMANTIC_LOCK_KEY]);
      await client.query(migration.sql);
      const afterMigration = await inspectMigration(client, migration);
      if (afterMigration.state !== "complete") {
        throw new Error(`0064 failed sentinel verification: ${afterMigration.missing.join(", ")}`);
      }
      const v1After = await inspectOperationalV1State(client);
      if (JSON.stringify(v1After) !== JSON.stringify(v1Before)) {
        throw new Error("0064 changed the complete Operational V1 state; transaction rolled back.");
      }
      const semanticState = await inspectSemanticState(client);
      assertSemanticStateIsNonDisruptive(semanticState);
      await recordMigration(
        client,
        migration,
        "applied",
        fingerprint,
        SEMANTIC_RUNNER_VERSION
      );
      await client.query("COMMIT");
      return {
        actions: [{ migration: migration.filename, action: "applied" }],
        writesPerformed: true,
        v1Before,
        v1After,
        semanticState
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [SEMANTIC_LOCK_KEY]);
  }
}

async function runSemanticScope0064() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const mode = readMode();
  const fingerprint = targetFingerprint(databaseUrl);
  const target = assertSemanticTarget(databaseUrl, mode, fingerprint);
  const priorMigrations = await loadMigrations();
  const migration = await loadSemanticMigration();
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig(),
    application_name: "noisia-semantic-scope-0064-rehearsal"
  });

  await client.connect();
  let readOnlyTransaction = false;
  try {
    await client.query("SET statement_timeout = '15min'");
    await client.query("SET lock_timeout = '15s'");
    if (mode !== "apply") {
      await client.query("BEGIN TRANSACTION READ ONLY");
      readOnlyTransaction = true;
    }

    const prerequisites = await inspectSemanticPrerequisites(client, priorMigrations);
    const runningSyncs = await inspectRunningSyncs(client);
    const connections = await inspectAppConnections(client);
    const migrationBefore = await inspectMigration(client, migration);
    const v1Before = await inspectOperationalV1State(client);
    const ledgerBefore = await inspectLedgerRows(client);

    if (!prerequisites.ok) {
      throw new Error(`0064 prerequisites failed: ${prerequisites.problems.join("; ")}.`);
    }
    if (migrationBefore.state === "partial") {
      throw new Error(`0064 is partially applied: ${migrationBefore.missing.join(", ")}`);
    }
    if (connections.named_noisia_connections > 0) {
      throw new Error("Named Studio/Workers connections are present; 0064 gate failed.");
    }

    let actions: Array<{ migration: string; action: string }> = [];
    let writesPerformed = false;
    let v1After = v1Before;
    let semanticState: Awaited<ReturnType<typeof inspectSemanticState>> | null = null;
    if (mode === "apply") {
      const applied = await applySemanticMigration(
        client,
        migration,
        priorMigrations,
        fingerprint,
        runningSyncs.count,
        connections
      );
      actions = applied.actions;
      writesPerformed = applied.writesPerformed;
      v1After = applied.v1After;
      semanticState = applied.semanticState;
    } else if (migrationBefore.state === "complete") {
      semanticState = await inspectSemanticState(client);
      assertSemanticStateIsNonDisruptive(semanticState);
    }

    const migrationAfter = await inspectMigration(client, migration);
    if (mode === "verify" && migrationAfter.state !== "complete") {
      throw new Error("0064 verify requires a complete migration.");
    }
    if (mode === "verify") {
      const expectedV1 = process.env[SEMANTIC_EXPECTED_V1_STATE_DIGEST_ENV];
      if (expectedV1 && expectedV1 !== v1After.aggregate_hash) {
        throw new Error("Operational V1 digest differs from the authorized preflight baseline.");
      }
      const ledger = await readLedger(client);
      const recorded = ledger.get(migration.filename);
      if (!recorded || recorded.checksum !== migration.checksum) {
        throw new Error("0064 verify requires exactly one matching ledger record.");
      }
    }

    if (readOnlyTransaction) {
      await client.query("ROLLBACK");
      readOnlyTransaction = false;
    }
    const ledgerAfter = await inspectLedgerRows(client);
    console.log(JSON.stringify({
      ok: true,
      runner_version: SEMANTIC_RUNNER_VERSION,
      migration_scope: SEMANTIC_SCOPE,
      mode,
      target: target.target,
      target_fingerprint: fingerprint,
      migration_checksum: migration.checksum,
      authorized_checksum: SEMANTIC_EXPECTED_CHECKSUM,
      writes_performed: writesPerformed,
      shadow_or_cutover_executed: false,
      restore_guard: {
        required_for_apply: !target.local,
        verified: target.local
          ? null
          : process.env[SEMANTIC_RESTORE_VERIFIED_ENV] === "true",
        restore_point_at: target.local
          ? null
          : process.env[SEMANTIC_RESTORE_POINT_AT_ENV] ?? null,
        reference_redacted: true
      },
      app_connections: connections,
      running_syncs: {
        ...runningSyncs,
        rows_modified: false
      },
      prerequisites,
      migration_before: {
        migration: migration.filename,
        checksum: migration.checksum,
        ...migrationBefore
      },
      operational_v1_before: v1Before,
      actions,
      migration_after: {
        migration: migration.filename,
        checksum: migration.checksum,
        ...migrationAfter
      },
      operational_v1_after: v1After,
      operational_v1_unchanged:
        JSON.stringify(v1Before) === JSON.stringify(v1After),
      semantic_state: semanticState,
      ledger: {
        rows_before: ledgerBefore,
        rows_after: ledgerAfter,
        migration_0064_rows: ledgerAfter.filter(
          (row) => row.migration_name === migration.filename
        ).length
      }
    }, null, 2));
  } finally {
    if (readOnlyTransaction) await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

async function main() {
  if (isSemanticScope()) {
    await runSemanticScope0064();
    return;
  }
  const databaseUrl = requireEnv("DATABASE_URL");
  const mode = readMode();
  const fingerprint = targetFingerprint(databaseUrl);
  const target = assertTarget(databaseUrl, mode, fingerprint);
  const autolinkPrerequisite = await loadMigration(AUTOLINK_PREREQUISITE);
  const migrations = await loadMigrations();
  const client = new pg.Client({ connectionString: databaseUrl, ssl: getDatabaseSslConfig() });

  await client.connect();
  let readOnlyTransaction = false;
  try {
    await client.query("SET statement_timeout = '15min'");
    await client.query("SET lock_timeout = '15s'");
    if (mode !== "apply") {
      await client.query("BEGIN TRANSACTION READ ONLY");
      readOnlyTransaction = true;
    }
    const prerequisites = await inspectBasePrerequisites(client);
    const runningSyncs = await inspectRunningSyncs(client);
    const before = await inspectMigrations(client, migrations);
    const ledger = await readLedger(client);

    let actions: Array<{ migration: string; action: string }> = [];
    if (mode === "apply") {
      if (!prerequisites.core_ok) {
        throw new Error(
          `Signal workspace data-plane prerequisites are incomplete: ${prerequisites.missing.join(", ")}`
        );
      }
      actions = await applyChain(
        client,
        autolinkPrerequisite,
        migrations,
        fingerprint,
        runningSyncs.count
      );
    }

    const after = await inspectMigrations(client, migrations);
    if (mode === "verify" && after.some((migration) => migration.state !== "complete")) {
      throw new Error("Verification failed because migrations 0059-0063 are not complete.");
    }

    if (readOnlyTransaction) {
      await client.query("ROLLBACK");
      readOnlyTransaction = false;
    }
    console.log(JSON.stringify({
      ok: true,
      runner_version: RUNNER_VERSION,
      mode,
      target: target.target,
      target_fingerprint: fingerprint,
      writes_performed: mode === "apply",
      shadow_or_cutover_executed: false,
      prerequisites,
      running_syncs: runningSyncs,
      ledger: {
        present: await ledgerExists(client),
        recorded_before: ledger.size
      },
      migrations_before: before,
      actions,
      migrations_after: after
    }, null, 2));
  } finally {
    if (readOnlyTransaction) await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

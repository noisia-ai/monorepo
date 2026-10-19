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

const RUNNER_VERSION = "signal-strategic-gate-d-migration-v1";
const LEDGER = "signal_workspace_data_plane_migration_ledger";
const LOCK_KEY = "noisia:signal-strategic-gate-d:0074";
const FILENAME = "0074_signal_strategic_gate_d_preflight.sql";
const ORDINAL = 74;
const CHECKSUM = "sha256:1eb15739c17a17fb4c4f9924971447fbcb6a26bcfa6cfc68cf7847f5b5e13d69";
const EXPECTED_DIRECT_FINGERPRINT =
  "sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19";
const EXPECTED_POOLER_FINGERPRINT =
  "sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815";
const EXPECTED_PROJECT_REF_HASH =
  "sha256:030c5a33e3b28881c4d77983a6049bbfa16c995da232454081cbccfcfa78aa32";

const ENV_PREFIX = "NOISIA_SIGNAL_STRATEGIC_GATE_D_MIGRATION";
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
const STATEMENT_TIMEOUT_MS_ENV = `${ENV_PREFIX}_STATEMENT_TIMEOUT_MS`;

const PROTECTED_STATE_HASH_CONTRACT = "sha256-sorted-row-sha256-bytea-v1";
const DEFAULT_STATEMENT_TIMEOUT_MS = 120_000;
const LOCK_TIMEOUT_MS = 15_000;
const IDLE_TRANSACTION_TIMEOUT_MS = 5 * 60_000;

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

type ProtectedDomain = {
  row_count: number;
  content_hash: string;
};

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
  "source_sync_runs",
  "corpus_snapshot_mentions",
  "tb_analyses",
  "signal_strategic_run_outbox",
  "tb_analysis_context_refs",
  "tb_reusable_assertion_review_events",
  "tb_findings",
  "tb_finding_citations",
  "tb_finding_structured_evidence_refs",
  "tb_temporal_metrics",
  "tb_finding_temporal_comparisons",
  "tb_mention_codings",
  "tb_recommendations",
  "tb_strategic_opportunities",
  "tb_opportunity_findings",
  "tb_action_studio",
  "tb_action_findings",
  "tb_quality_gates",
  "tb_pipeline_steps",
  "analysis_artifacts",
  "analysis_artifact_review_events",
  "signal_workspace_releases",
  "signal_workspace_release_artifacts",
  "signal_workspace_current_releases",
  "signal_workspace_report_current_releases"
] as const;

const OPTIONAL_PROTECTED_TABLES = [
  "signal_strategic_run_controls",
  "signal_strategic_sealed_sample_items",
  "signal_strategic_budget_reservations",
  "signal_strategic_step_outbox",
  "signal_strategic_step_outbox_events",
  "signal_strategic_review_release_operations",
  "signal_strategic_release_promotion_operations"
] as const;

const SNAPSHOT_AUTHORITY_COLUMNS = [
  "strategic_authority_version",
  "policy_bundle_id",
  "policy_compilation_id",
  "governance_evaluation_id",
  "policy_definition_hash",
  "compiled_plan_hash",
  "governance_digest",
  "provenance_digest",
  "usage_purposes"
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

function progress(event: string, detail: Record<string, string | number | boolean> = {}) {
  const suffix = Object.keys(detail).length > 0 ? ` ${JSON.stringify(detail)}` : "";
  process.stderr.write(`[0074] ${event}${suffix}\n`);
}

function boundedIntegerEnv(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function statementTimeoutMs() {
  return boundedIntegerEnv(
    STATEMENT_TIMEOUT_MS_ENV,
    DEFAULT_STATEMENT_TIMEOUT_MS,
    10_000,
    15 * 60_000
  );
}

async function configureSession(client: pg.Client, timeoutMs: number) {
  await client.query(
    `SELECT
       set_config('statement_timeout', $1, false),
       set_config('lock_timeout', $2, false),
       set_config('idle_in_transaction_session_timeout', $3, false)`,
    [`${timeoutMs}ms`, `${LOCK_TIMEOUT_MS}ms`, `${IDLE_TRANSACTION_TIMEOUT_MS}ms`]
  );
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
    reference_hash: sha256(reference),
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
    throw new Error("0074 remote rehearsal requires an explicitly classified preview or staging target.");
  }
  if (databaseUrlLooksProductionLike(databaseUrl)) throw new Error("Refusing production-like target.");
  if (process.env[PREFLIGHT_ALLOW_REMOTE_ENV] !== "true"
    || process.env[NO_APP_CONNECTIONS_ENV] !== "true") {
    throw new Error("0074 remote inspection requires its explicit allow flag and no-app acknowledgement.");
  }
  if (fingerprint !== EXPECTED_DIRECT_FINGERPRINT
    || process.env[TARGET_FINGERPRINT_ENV] !== fingerprint
    || !poolerUrl
    || targetFingerprint(poolerUrl) !== EXPECTED_POOLER_FINGERPRINT
    || projectRefHash(databaseUrl, "direct") !== EXPECTED_PROJECT_REF_HASH
    || projectRefHash(poolerUrl, "pooler") !== EXPECTED_PROJECT_REF_HASH) {
    throw new Error("0074 target identity is not the audited noisia-staging project.");
  }
  const restorePoint = assertFreshRestorePoint();
  requireSafeDatabaseReadTarget(databaseUrl, {
    operation: "inspect strategic Gate D migration 0074",
    allowRemoteEnv: PREFLIGHT_ALLOW_REMOTE_ENV
  });

  if (mode === "apply") {
    if (process.env[APPLY_APPROVED_ENV] !== "true"
      || process.env[APPLY_ALLOW_REMOTE_ENV] !== "true"
      || process.env[ISOLATED_TARGET_ENV] !== "true"
      || !/^sha256:[0-9a-f]{64}$/u.test(process.env[EXPECTED_STATE_DIGEST_ENV] ?? "")) {
      throw new Error("0074 apply requires its specific approval, isolation and preflight digest.");
    }
    requireSafeDatabaseWriteTarget(databaseUrl, {
      operation: "apply strategic Gate D migration 0074",
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

async function constraintContainsAll(client: pg.Client, name: string, tokens: string[]) {
  const result = await client.query<{ definition: string | null }>(`
    SELECT pg_get_constraintdef(oid,true) AS definition
    FROM pg_constraint WHERE conname=$1
  `, [name]);
  if (result.rowCount !== 1) return false;
  const value = result.rows[0]?.definition ?? "";
  return tokens.every((token) => value.includes(token));
}

async function columnExists(client: pg.Client, table: string, column: string) {
  return (await client.query<{ present: boolean }>(`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name=$2) AS present
  `, [table, column])).rows[0]?.present === true;
}

async function columnIsNullableWithoutDefault(
  client: pg.Client,
  table: string,
  column: string
) {
  return (await client.query<{ valid: boolean }>(`
    SELECT COALESCE(bool_and(is_nullable='YES' AND column_default IS NULL),false) AS valid
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name=$2
  `, [table, column])).rows[0]?.valid === true;
}

async function tableExists(client: pg.Client, table: string) {
  return (await client.query<{ present: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS present",
    [`public.${table}`]
  )).rows[0]?.present === true;
}

async function indexExists(client: pg.Client, index: string) {
  return (await client.query<{ present: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS present",
    [`public.${index}`]
  )).rows[0]?.present === true;
}

async function inspectMigration(client: pg.Client) {
  const checks: Check[] = [];
  const addTable = async (key: string, table: string, marker = false) => {
    checks.push({ key: `table:${key}`, marker, present: await tableExists(client, table) });
  };
  const addColumn = async (key: string, table: string, column: string, marker = false) => {
    checks.push({
      key: `column:${key}`,
      marker,
      present: await columnExists(client, table, column)
    });
  };
  const addIndex = async (key: string, index: string, marker = false) => {
    checks.push({ key: `index:${key}`, marker, present: await indexExists(client, index) });
  };
  const addConstraint = async (
    key: string,
    constraint: string,
    tokens: string[],
    marker = false
  ) => {
    checks.push({
      key: `constraint:${key}`,
      marker,
      present: await constraintContainsAll(client, constraint, tokens)
    });
  };
  const addTrigger = async (key: string, trigger: string, tokens: string[], marker = false) => {
    checks.push({
      key: `trigger:${key}`,
      marker,
      present: await triggerContainsAll(client, trigger, tokens)
    });
  };
  const addFunction = async (
    key: string,
    signature: string,
    tokens: string[],
    marker = false
  ) => {
    checks.push({
      key: `function:${key}`,
      marker,
      present: await functionContainsAll(client, signature, tokens)
    });
  };

  await addFunction("strategic_usage_authority",
    "signal_governed_view_required_usage_purposes_v1(text,text)", [
      "triggers-barriers", "strategic", "llm-processing", "strategic-analysis"
    ], true);
  await addFunction("strategic_scope_authority",
    "signal_governed_view_bundle_scopes_match_v1(uuid,text)", [
      "WHEN 'strategic'", "primary_brand", "competitor", "category", "reference"
    ]);
  await addConstraint("derivation_strategic_identity",
    "signal_governed_view_population_derivation_identity", [
      "triggers-barriers", "strategic"
    ]);
  await addConstraint("evaluation_strategic_identity",
    "signal_data_governance_evaluation_module", ["triggers-barriers", "strategic"]);
  await addConstraint("compilation_strategic_identity",
    "signal_population_policy_compilation_module", ["triggers-barriers", "strategic"]);
  checks.push({
    key: "column:evaluation_unknown_nullable_without_default",
    marker: false,
    present: await columnIsNullableWithoutDefault(
      client, "signal_data_governance_evaluations", "governance_unknown_count"
    )
  });
  checks.push({
    key: "column:compilation_unknown_nullable_without_default",
    marker: false,
    present: await columnIsNullableWithoutDefault(
      client, "signal_population_policy_compilations", "governance_unknown_count"
    )
  });
  await addConstraint("evaluation_unknown_counts",
    "signal_data_governance_evaluation_counts", [
      "governance_unknown_count IS NULL", "authorized_root_count <= candidate_root_count"
    ]);
  await addConstraint("compilation_unknown_counts",
    "signal_population_policy_compilation_governance_counts", [
      "governance_unknown_count IS NULL", "licensing_blocked_count"
    ]);
  await addTrigger("unknown_evaluation_fail_closed",
    "trg_signal_governance_unknown_evaluation_availability", [
      "signal_data_governance_evaluations",
      "enforce_signal_governance_unknown_availability_v1()"
    ]);
  await addTrigger("unknown_compilation_fail_closed",
    "trg_signal_governance_unknown_compilation_availability", [
      "signal_population_policy_compilations",
      "enforce_signal_governance_unknown_availability_v1()"
    ]);
  await addTrigger("workspace_brand_invalidation",
    "trg_signal_governed_workspace_brand_registry_invalidation", [
      "AFTER UPDATE", "signal_workspaces",
      "invalidate_signal_governed_workspace_brand_registry_v1()"
    ]);
  await addFunction("strategic_derivation",
    "ensure_signal_strategic_population_derivation_v1(uuid,uuid,uuid,text,text,uuid)", [
      "triggers-barriers-strategic-governed",
      "strategic-internal",
      "candidate_not_bound"
    ]);
  await addTrigger("strategic_compilation_authority",
    "trg_signal_strategic_compilation_authority_v1", [
      "signal_population_policy_compilations",
      "enforce_signal_strategic_compilation_authority_v1()"
    ]);
  await addTrigger("strategic_binding_authority",
    "trg_signal_strategic_binding_compilation_v1", [
      "signal_governed_view_bindings",
      "enforce_signal_strategic_binding_compilation_v1()"
    ]);

  for (const column of [
    "strategic_authority_version", "policy_bundle_id", "policy_compilation_id",
    "governance_evaluation_id", "policy_definition_hash", "compiled_plan_hash",
    "governance_digest", "provenance_digest", "usage_purposes"
  ]) {
    await addColumn(`snapshot_${column}`, "corpus_snapshots", column);
  }
  await addConstraint("snapshot_authority",
    "corpus_snapshots_strategic_authority_v2", [
      "signal-strategic-snapshot-authority-v1",
      "llm-processing", "strategic-analysis", "scope_frozen_at IS NOT NULL"
    ]);
  await addConstraint("analysis_v2_identity", "tb_analyses_strategic_identity", [
    "signal-tb-strategic-v1", "signal-tb-strategic-v2",
    "run_idempotency_key", "scope_frozen_at IS NOT NULL"
  ]);
  await addIndex("analysis_v2_idempotency", "uq_tb_analyses_workspace_report_v2_idempotency");
  await addIndex("analysis_open_governed", "uq_tb_analyses_workspace_report_open_governed");

  await addTable("run_controls", "signal_strategic_run_controls", true);
  for (const column of [
    "binding_id", "policy_bundle_id", "policy_compilation_id",
    "governance_evaluation_id", "population_id", "preflight_digest",
    "request_digest", "snapshot_authority_digest", "authority_valid_until",
    "sample_digest", "execution_plan_version", "execution_plan_digest",
    "execution_plan", "planned_provider_calls", "planned_input_tokens",
    "planned_output_tokens", "provider_config_digest", "hard_cap_usd"
  ]) {
    await addColumn(`run_control_${column}`, "signal_strategic_run_controls", column);
  }
  await addConstraint("run_control_execution_plan",
    "signal_strategic_run_control_execution_plan", [
      "signal-strategic-provider-budget-plan-v1",
      "planned_provider_calls", "execution_plan"
    ]);
  await addConstraint("run_control_budget", "signal_strategic_run_control_budget", [
    "estimated_cost_usd", "hard_cap_usd", "reserved_cost_usd", "actual_cost_usd"
  ]);
  await addConstraint("run_control_hashes", "signal_strategic_run_control_hashes", [
    "execution_plan_digest", "provider_config_digest", "snapshot_authority_digest"
  ]);
  await addConstraint("run_control_unique_request", "uq_signal_strategic_run_control_key", [
    "workspace_id", "report_key", "idempotency_key"
  ]);
  await addConstraint("run_control_binding_fk",
    "signal_strategic_run_controls_binding_id_fkey", [
      "FOREIGN KEY (binding_id)", "signal_governed_view_bindings(id)", "ON DELETE RESTRICT"
    ]);
  await addConstraint("run_control_compilation_fk",
    "signal_strategic_run_controls_policy_compilation_id_fkey", [
      "FOREIGN KEY (policy_compilation_id)",
      "signal_population_policy_compilations(id)", "ON DELETE RESTRICT"
    ]);
  await addTrigger("run_control_authority", "trg_signal_strategic_run_control_v1", [
    "signal_strategic_run_controls", "enforce_signal_strategic_run_control_v1()"
  ]);
  await addTrigger("run_control_immutable_authority",
    "trg_protect_signal_strategic_run_authority_v1", [
      "BEFORE UPDATE", "signal_strategic_run_controls",
      "protect_signal_strategic_run_authority_v1()"
    ]);
  await addIndex("run_control_recovery", "idx_signal_strategic_run_controls_recovery");

  await addTable("sealed_sample", "signal_strategic_sealed_sample_items", true);
  await addConstraint("sealed_sample_unique_root",
    "uq_signal_strategic_sealed_sample_root", ["run_control_id", "mention_id"]);
  await addTrigger("sealed_sample_authority",
    "trg_signal_strategic_sealed_sample_item_v1", [
      "signal_strategic_sealed_sample_items",
      "enforce_signal_strategic_sealed_sample_item_v1()"
    ]);
  await addTrigger("sealed_sample_complete",
    "trg_signal_strategic_sealed_sample_complete_v1", [
      "CREATE CONSTRAINT TRIGGER", "DEFERRABLE INITIALLY DEFERRED",
      "validate_signal_strategic_sealed_sample_v1()"
    ]);
  await addTrigger("sealed_sample_immutable",
    "trg_protect_signal_strategic_sealed_sample_v1", [
      "BEFORE DELETE OR UPDATE", "protect_signal_strategic_sealed_sample_v1()"
    ]);

  await addTable("budget_reservations", "signal_strategic_budget_reservations", true);
  await addColumn("budget_reserved_input_tokens",
    "signal_strategic_budget_reservations", "reserved_input_tokens");
  await addColumn("budget_reserved_output_tokens",
    "signal_strategic_budget_reservations", "reserved_output_tokens");
  await addConstraint("budget_operation_unique",
    "uq_signal_strategic_budget_reservation_operation", [
      "run_control_id", "operation_key"
    ]);
  await addConstraint("budget_amount", "signal_strategic_budget_reservation_amount", [
    "reservation_usd >", "reserved_input_tokens", "reserved_output_tokens"
  ]);
  await addConstraint("budget_run_fk",
    "signal_strategic_budget_reservations_run_control_id_fkey", [
      "FOREIGN KEY (run_control_id)", "signal_strategic_run_controls(id)",
      "ON DELETE CASCADE"
    ]);
  await addTrigger("budget_authority",
    "trg_signal_strategic_budget_reservation_v1", [
      "signal_strategic_budget_reservations",
      "enforce_signal_strategic_budget_reservation_v1()"
    ]);
  await addFunction("budget_reserve_tokens",
    "reserve_signal_strategic_budget_tokens_v1(uuid,text,bigint,bigint,text)", [
      "reserved_input_tokens", "reserved_output_tokens",
      "Strategic provider operation key has incompatible inputs"
    ]);
  await addFunction("budget_settle",
    "settle_signal_strategic_budget_v1(uuid,text,bigint,bigint)", [
      "input_usd_per_million_tokens", "output_usd_per_million_tokens",
      "reservation_usd"
    ]);
  await addFunction("budget_release",
    "release_signal_strategic_budget_v1(uuid,text,text)", [
      "released", "A settled provider charge cannot be released"
    ]);

  await addTable("step_outbox", "signal_strategic_step_outbox", true);
  await addTable("step_outbox_events", "signal_strategic_step_outbox_events", true);
  await addConstraint("step_outbox_attempt_unique",
    "uq_signal_strategic_step_outbox_attempt", [
      "run_control_id", "pipeline_step", "attempt"
    ]);
  await addConstraint("step_outbox_event_unique",
    "uq_signal_strategic_step_outbox_event", ["outbox_id", "transition_key"]);
  await addConstraint("step_outbox_lifecycle", "signal_strategic_step_outbox_status", [
    "pending", "dispatching", "running", "dead_letter", "cancelled"
  ]);
  await addConstraint("step_outbox_pipeline_fk",
    "signal_strategic_step_outbox_pipeline_step_id_fkey", [
      "FOREIGN KEY (pipeline_step_id)", "tb_pipeline_steps(id)", "ON DELETE CASCADE"
    ]);
  await addTrigger("step_outbox_authority", "trg_signal_strategic_step_outbox_v1", [
    "signal_strategic_step_outbox", "enforce_signal_strategic_step_outbox_v1()"
  ]);
  await addTrigger("step_outbox_audit", "trg_audit_signal_strategic_step_outbox_v1", [
    "AFTER INSERT OR UPDATE OF status", "audit_signal_strategic_step_outbox_v1()"
  ]);
  await addIndex("step_outbox_recovery", "idx_signal_strategic_step_outbox_recovery");
  await addIndex("step_outbox_lease", "idx_signal_strategic_step_outbox_lease");
  await addFunction("step_dispatch_claim",
    "claim_signal_strategic_step_dispatch_v1(integer,integer,integer)", [
      "SKIP LOCKED", "lease_expires_at", "dead_letter"
    ]);
  await addFunction("step_dispatch_complete",
    "complete_signal_strategic_step_dispatch_v1(uuid,uuid,text)", [
      "lease_token", "bullmq_job_id", "dispatched"
    ]);
  await addFunction("step_dispatch_fail",
    "fail_signal_strategic_step_dispatch_v1(uuid,uuid,timestamp with time zone,jsonb,integer)", [
      "dispatch_attempt", "dead_letter", "lease_token"
    ]);
  await addFunction("step_execution_claim",
    "claim_signal_strategic_step_v1(uuid,uuid,integer)", [
      "assert_signal_strategic_runtime_authority_v1", "running"
    ]);
  await addFunction("step_execution_heartbeat",
    "heartbeat_signal_strategic_step_v1(uuid,uuid,integer)", [
      "lease_expires_at", "clock_timestamp"
    ]);
  await addFunction("step_execution_complete",
    "complete_signal_strategic_step_v1(uuid,uuid,jsonb)", [
      "result_summary", "completed"
    ]);
  await addFunction("step_execution_fail",
    "fail_signal_strategic_step_v1(uuid,uuid,timestamp with time zone,jsonb,boolean)", [
      "target_terminal", "dead_letter", "cancel_requested"
    ]);

  await addConstraint("run_outbox_lifecycle", "signal_strategic_run_outbox_status", [
    "running", "needs_review", "cancel_requested", "cancelled", "dead_letter"
  ]);
  await addFunction("runtime_authority",
    "assert_signal_strategic_runtime_authority_v1(uuid)", [
      "binding_status", "compilation_status", "governance_unknown_count",
      "membership_digest", "Strategic governed runtime authority is unavailable"
    ]);
  await addFunction("launch_digest",
    "signal_strategic_launch_request_digest_v1(jsonb)", ["request_digest", "sha256"]);
  await addFunction("execution_plan_digest",
    "signal_strategic_execution_plan_digest_v1(jsonb,text,text)", [
      "signal-strategic-execution-plan-authority-v1",
      "target_pipeline_version", "target_prompt_version"
    ]);
  await addFunction("atomic_launch",
    "launch_signal_tb_strategic_run_v2(uuid,uuid,text,text,jsonb)", [
      "signal_strategic_launch_request_digest_v1", "signal-tb-strategic-v2",
      "signal_strategic_sealed_sample_items",
      "signal_strategic_step_outbox",
      "signal_strategic_run_outbox"
    ]);
  await addFunction("cancel",
    "request_signal_strategic_run_cancel_v1(uuid,uuid,uuid)", [
      "cancel_requested", "signal_strategic_step_outbox"
    ]);
  await addFunction("transition",
    "transition_signal_strategic_run_v1(uuid,text[],text,text)", [
      "expected-status CAS", "signal_strategic_run_outbox"
    ]);

  await addTable("review_release_operations",
    "signal_strategic_review_release_operations", true);
  await addConstraint("review_release_idempotency",
    "uq_signal_strategic_review_release_operation", [
      "workspace_id", "idempotency_key"
    ]);
  await addConstraint("review_release_analysis_fk",
    "signal_strategic_review_release_operations_tb_analysis_id_fkey", [
      "FOREIGN KEY (tb_analysis_id)", "tb_analyses(id)", "ON DELETE RESTRICT"
    ]);
  await addTrigger("review_release_append_only",
    "trg_protect_signal_strategic_review_release_operation_v1", [
      "BEFORE DELETE OR UPDATE",
      "protect_signal_strategic_review_release_operation_v1()"
    ]);
  await addFunction("review_release",
    "review_and_prepare_signal_tb_strategic_v2(uuid,uuid,uuid,text,text,jsonb)", [
      "signal_strategic_review_release_operations",
      "analysis_artifact_review_events", "signal_workspace_releases",
      "Strategic Review/release state is incomplete or stale"
    ]);
  await addTable("release_promotion_operations",
    "signal_strategic_release_promotion_operations", true);
  await addConstraint("release_promotion_idempotency",
    "uq_signal_strategic_release_promotion_operation", [
      "workspace_id", "idempotency_key"
    ]);
  await addConstraint("release_promotion_identity",
    "signal_strategic_release_promotion_identity", [
      "triggers-barriers", "publish"
    ]);
  await addTrigger("release_promotion_append_only",
    "trg_protect_signal_strategic_release_promotion_operation_v1", [
      "BEFORE DELETE OR UPDATE",
      "protect_signal_strategic_release_promotion_operation_v1()"
    ]);
  await addFunction("release_promotion",
    "promote_signal_workspace_report_release_v2(uuid,text,uuid,uuid,text,text)", [
      "promote_signal_workspace_report_release",
      "signal_strategic_release_promotion_operations",
      "Strategic release promotion idempotency key has incompatible inputs"
    ]);
  await addTrigger("analysis_control_complete",
    "trg_signal_tb_strategic_v2_control_complete_v1", [
      "CREATE CONSTRAINT TRIGGER", "DEFERRABLE INITIALLY DEFERRED",
      "validate_signal_tb_strategic_v2_control_v1()"
    ]);
  await addTrigger("run_control_no_delete",
    "trg_protect_signal_strategic_run_control_delete_v1", [
      "BEFORE DELETE", "protect_signal_strategic_run_control_delete_v1()"
    ]);
  await addFunction("snapshot_containment_v2",
    "assert_signal_tb_snapshot_containment(uuid,text)", [
      "signal-tb-snapshot-containment-v2", "contract_violation_count"
    ]);

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
  const missing = Array.from({ length: 15 }, (_, index) => index + 59)
    .filter((ordinal) => !ledger.some((row) => row.ordinal === ordinal));
  if (missing.length > 0) throw new Error(`Missing prerequisite ledger ordinals: ${missing.join(",")}.`);
  if (ledger.some((row) => row.ordinal > ORDINAL)) {
    throw new Error("Unexpected migration exists after 0074.");
  }
  for (const [ordinal, checksum] of [
    [68, "sha256:77785c5e5507b41d72e8a9e9ed649aa2ce229063609087d95af54d33ff20121f"],
    [69, "sha256:2f8bfa4139edf8c8f2add1f4a3c5e8068b801aeee911a2258c679fd018241eff"],
    [70, "sha256:b73a230a7c21e90936d55059625cb7014d682e832212276fead593d266f3e910"],
    [71, "sha256:df1381a270083b0fc91943e1a7be438b9fa4fd71c736ce2b2ad3ed85e1c44b11"],
    [72, "sha256:1c974ec09871c28a439bb23a7753b6b0a9d8915539493bff3c364515bbbd4738"],
    [73, "sha256:8cc2d1c5ae3338cb6189f13b851c96474329159358d0f0c7d3bec17284158cae"]
  ] as const) {
    if (ledger.find((row) => row.ordinal === ordinal)?.checksum_sha256 !== checksum) {
      throw new Error(`Prerequisite checksum drift for ${ordinal}.`);
    }
  }
  const recorded = ledger.filter((row) => row.ordinal === ORDINAL);
  if (migration.state === "partial") {
    throw new Error(`0074 is partial: ${migration.missing.join(", ")}.`);
  }
  if (recorded.length > 1
    || (recorded.length === 0 && migration.state === "complete")
    || (recorded.length === 1 && (migration.state !== "complete"
      || recorded[0]?.migration_name !== FILENAME
      || recorded[0]?.checksum_sha256 !== CHECKSUM))) {
    throw new Error("0074 ledger and sentinels disagree or its checksum is incompatible.");
  }
  return ledger;
}

const EMPTY_CONTENT_HASH =
  "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

async function digestTable(
  client: pg.Client,
  table: string,
  excludedColumns: readonly string[] = []
) {
  if (!/^[a-z][a-z0-9_]*$/u.test(table)) throw new Error("Invalid protected table name.");
  try {
    return (await client.query<ProtectedDomain>(`
      WITH row_hashes AS MATERIALIZED (
        SELECT sha256(convert_to(
          (to_jsonb(protected_row) - $1::text[])::text, 'UTF8'
        )) AS row_hash
        FROM ${table} protected_row
      )
      SELECT count(*)::int AS row_count,
        'sha256:' || encode(sha256(COALESCE(
          string_agg(row_hash, decode('', 'hex') ORDER BY row_hash), decode('', 'hex')
        )), 'hex') AS content_hash
      FROM row_hashes
    `, [[...excludedColumns]])).rows[0]!;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    if (code === "42P01") throw new Error(`Protected table ${table} is missing.`);
    throw error;
  }
}

async function digestOptionalTable(client: pg.Client, table: string) {
  if (!await tableExists(client, table)) {
    return { row_count: 0, content_hash: EMPTY_CONTENT_HASH };
  }
  return digestTable(client, table);
}

async function digestSnapshotAuthority(client: pg.Client): Promise<ProtectedDomain> {
  if (!await columnExists(client, "corpus_snapshots", "strategic_authority_version")) {
    return { row_count: 0, content_hash: EMPTY_CONTENT_HASH };
  }
  return (await client.query<ProtectedDomain>(`
    WITH authority_rows AS MATERIALIZED (
      SELECT sha256(convert_to(jsonb_build_object(
        'id',snapshot.id,
        'strategic_authority_version',snapshot.strategic_authority_version,
        'policy_bundle_id',snapshot.policy_bundle_id,
        'policy_compilation_id',snapshot.policy_compilation_id,
        'governance_evaluation_id',snapshot.governance_evaluation_id,
        'policy_definition_hash',snapshot.policy_definition_hash,
        'compiled_plan_hash',snapshot.compiled_plan_hash,
        'governance_digest',snapshot.governance_digest,
        'provenance_digest',snapshot.provenance_digest,
        'usage_purposes',snapshot.usage_purposes
      )::text,'UTF8')) AS row_hash
      FROM corpus_snapshots snapshot
      WHERE snapshot.strategic_authority_version IS NOT NULL
        OR snapshot.policy_bundle_id IS NOT NULL
        OR snapshot.policy_compilation_id IS NOT NULL
        OR snapshot.governance_evaluation_id IS NOT NULL
        OR snapshot.policy_definition_hash IS NOT NULL
        OR snapshot.compiled_plan_hash IS NOT NULL
        OR snapshot.governance_digest IS NOT NULL
        OR snapshot.provenance_digest IS NOT NULL
        OR cardinality(snapshot.usage_purposes) > 0
    )
    SELECT count(*)::int AS row_count,
      'sha256:' || encode(sha256(COALESCE(
        string_agg(row_hash, decode('', 'hex') ORDER BY row_hash), decode('', 'hex')
      )), 'hex') AS content_hash
    FROM authority_rows
  `)).rows[0]!;
}

async function inspectProtectedState(client: pg.Client, phase = "protected_state") {
  const domains: Record<string, ProtectedDomain> = {};
  const timings: Record<string, number> = {};
  const totalDomains = PROTECTED_TABLES.length + OPTIONAL_PROTECTED_TABLES.length + 2;
  progress(`${phase}:start`, { domains: totalDomains });
  let index = 0;

  for (const table of PROTECTED_TABLES) {
    index += 1;
    const startedAt = performance.now();
    progress(`${phase}:domain:start`, { index, total: totalDomains, table });
    domains[table] = await digestTable(client, table);
    timings[table] = Math.round(performance.now() - startedAt);
    progress(`${phase}:domain:done`, {
      index, total: totalDomains, table,
      rows: domains[table]!.row_count, elapsed_ms: timings[table]!
    });
  }

  for (const table of OPTIONAL_PROTECTED_TABLES) {
    index += 1;
    const startedAt = performance.now();
    progress(`${phase}:domain:start`, { index, total: totalDomains, table });
    domains[table] = await digestOptionalTable(client, table);
    timings[table] = Math.round(performance.now() - startedAt);
    progress(`${phase}:domain:done`, {
      index, total: totalDomains, table,
      rows: domains[table]!.row_count, elapsed_ms: timings[table]!
    });
  }

  index += 1;
  let startedAt = performance.now();
  const legacySnapshotKey = "corpus_snapshots_pre_0074_projection";
  progress(`${phase}:domain:start`, {
    index, total: totalDomains, table: legacySnapshotKey
  });
  domains[legacySnapshotKey] = await digestTable(
    client, "corpus_snapshots", SNAPSHOT_AUTHORITY_COLUMNS
  );
  timings[legacySnapshotKey] = Math.round(performance.now() - startedAt);
  progress(`${phase}:domain:done`, {
    index, total: totalDomains, table: legacySnapshotKey,
    rows: domains[legacySnapshotKey]!.row_count, elapsed_ms: timings[legacySnapshotKey]!
  });

  index += 1;
  startedAt = performance.now();
  const snapshotAuthorityKey = "corpus_snapshots_strategic_authority_rows";
  progress(`${phase}:domain:start`, {
    index, total: totalDomains, table: snapshotAuthorityKey
  });
  domains[snapshotAuthorityKey] = await digestSnapshotAuthority(client);
  timings[snapshotAuthorityKey] = Math.round(performance.now() - startedAt);
  progress(`${phase}:domain:done`, {
    index, total: totalDomains, table: snapshotAuthorityKey,
    rows: domains[snapshotAuthorityKey]!.row_count,
    elapsed_ms: timings[snapshotAuthorityKey]!
  });

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
    current_report_releases: number;
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
      (SELECT count(*)::int FROM signal_mention_attribution_review_events) AS review_events,
      (SELECT count(*)::int FROM signal_workspace_report_current_releases)
        AS current_report_releases
  `)).rows[0]!;

  const newContractRows = Object.fromEntries(OPTIONAL_PROTECTED_TABLES.map(
    (table) => [table, domains[table]!.row_count]
  ));
  const protectedState = {
    hash_contract: PROTECTED_STATE_HASH_CONTRACT,
    summary,
    domains
  };
  progress(`${phase}:done`, {
    elapsed_ms: Object.values(timings).reduce((total, elapsed) => total + elapsed, 0)
  });
  return {
    ...protectedState,
    new_contract_rows: newContractRows,
    aggregate_hash: sha256(stableJson(protectedState)),
    inspection_timings_ms: timings
  };
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
        AND application_name<>'noisia-strategic-gate-d-0074')::int
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

async function inspectIdentity(client: pg.Client, phase = "identity") {
  const migration = await inspectMigration(client);
  const ledger = await readLedger(client);
  const protectedState = await inspectProtectedState(client, `${phase}:protected_state`);
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

async function inspectPeer(databaseUrl: string, timeoutMs: number) {
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig(),
    application_name: "noisia-strategic-gate-d-0074-peer"
  });
  await client.connect();
  try {
    await configureSession(client, timeoutMs);
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const identity = await inspectIdentity(client, "pooler_identity");
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
  const timeoutMs = statementTimeoutMs();
  const fingerprint = targetFingerprint(databaseUrl);
  const target = assertTarget(databaseUrl, poolerUrl, mode, fingerprint);
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const migrationSql = await readFile(join(root, "migrations", FILENAME), "utf8");
  if (sha256(migrationSql) !== CHECKSUM) throw new Error("0074 local checksum mismatch.");

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig(),
    application_name: "noisia-strategic-gate-d-0074"
  });
  await client.connect();
  let readOnly = false;
  try {
    await configureSession(client, timeoutMs);
    if (mode !== "apply") {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      readOnly = true;
    }

    progress("migration_sentinels:start", { mode });
    const migrationBefore = await inspectMigration(client);
    const ledgerBefore = await assertPrerequisites(client, migrationBefore);
    const connections = await inspectConnections(client, !target.local);
    const protectedBefore = await inspectProtectedState(client, "direct_before");
    const directIdentity = {
      database_name_hash: sha256((await client.query<{ name: string }>(
        "SELECT current_database() AS name"
      )).rows[0]!.name),
      migration: migrationBefore,
      ledger_digest: sha256(stableJson(ledgerBefore)),
      protected_state_hash: protectedBefore.aggregate_hash
    };
    const peerIdentity = !target.local && poolerUrl
      ? await inspectPeer(poolerUrl, timeoutMs)
      : null;
    if (peerIdentity && stableJson(peerIdentity) !== stableJson(directIdentity)) {
      throw new Error("Direct and pooler connections expose different database state.");
    }

    let writesPerformed = false;
    let actions: Array<{ migration: string; action: "applied" | "verified_existing" }> = [];
    if (mode === "apply") {
      if (process.env[EXPECTED_STATE_DIGEST_ENV] !== protectedBefore.aggregate_hash) {
        throw new Error("Protected state changed after the 0074 preflight.");
      }
      await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [LOCK_KEY]);
      try {
        progress("apply_lock:acquired");
        const lockedMigration = await inspectMigration(client);
        const lockedLedger = await assertPrerequisites(client, lockedMigration);
        const lockedProtected = await inspectProtectedState(client, "direct_locked");
        if (lockedProtected.aggregate_hash !== protectedBefore.aggregate_hash) {
          throw new Error("Protected product state changed while waiting for the 0074 lock.");
        }
        if (lockedMigration.state === "complete") {
          actions = [{ migration: FILENAME, action: "verified_existing" }];
        } else {
          if (lockedMigration.state !== "absent"
            || lockedLedger.some((row) => row.ordinal === ORDINAL)) {
            throw new Error("0074 is not cleanly absent.");
          }
          await client.query("BEGIN");
          try {
            await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [LOCK_KEY]);
            await client.query(migrationSql);
            const migrationApplied = await inspectMigration(client);
            if (migrationApplied.state !== "complete") {
              throw new Error(`0074 sentinels failed: ${migrationApplied.missing.join(", ")}.`);
            }
            const appliedProtected = await inspectProtectedState(client, "direct_applied");
            if (appliedProtected.aggregate_hash !== protectedBefore.aggregate_hash) {
              throw new Error("0074 changed protected product state.");
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

    // A read-only REPEATABLE READ transaction cannot observe a different
    // product state later in the same snapshot. Reusing the first inspection
    // avoids a third complete content scan during preflight/verify. Apply mode
    // still re-reads after the transaction because it may have written DDL.
    const migrationAfter = mode === "apply"
      ? await inspectMigration(client)
      : migrationBefore;
    const ledgerAfter = mode === "apply"
      ? await readLedger(client)
      : ledgerBefore;
    const protectedAfter = mode === "apply"
      ? await inspectProtectedState(client, "direct_after")
      : protectedBefore;
    if (mode === "verify") {
      const recorded = ledgerAfter.filter((row) => row.ordinal === ORDINAL);
      if (migrationAfter.state !== "complete" || recorded.length !== 1
        || recorded[0]?.migration_name !== FILENAME
        || recorded[0]?.checksum_sha256 !== CHECKSUM) {
        throw new Error("0074 verify requires complete sentinels and one exact ledger row.");
      }
    }
    if (protectedAfter.aggregate_hash !== protectedBefore.aggregate_hash) {
      throw new Error("Protected state changed during the 0074 runner.");
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
      observability: {
        protected_state_hash_contract: PROTECTED_STATE_HASH_CONTRACT,
        statement_timeout_ms: timeoutMs,
        read_only_after_reused_repeatable_read_snapshot: mode !== "apply"
      },
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
      strategic_contract_rows_created_by_runner: false,
      governed_policies_or_bindings_created_by_runner: false,
      jobs_or_runs_created_by_runner: false,
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

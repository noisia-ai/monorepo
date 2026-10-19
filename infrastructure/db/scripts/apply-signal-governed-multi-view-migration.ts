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

const RUNNER_VERSION = "signal-governed-multi-view-migration-v1";
const LEDGER = "signal_workspace_data_plane_migration_ledger";
const LOCK_KEY = "noisia:signal-governed-multi-view:0073";
const FILENAME = "0073_signal_governed_multi_view_binding_sets.sql";
const ORDINAL = 73;
const CHECKSUM = "sha256:8cc2d1c5ae3338cb6189f13b851c96474329159358d0f0c7d3bec17284158cae";
const EXPECTED_DIRECT_FINGERPRINT =
  "sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19";
const EXPECTED_POOLER_FINGERPRINT =
  "sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815";
const EXPECTED_PROJECT_REF_HASH =
  "sha256:030c5a33e3b28881c4d77983a6049bbfa16c995da232454081cbccfcfa78aa32";

const ENV_PREFIX = "NOISIA_SIGNAL_GOVERNED_MULTI_VIEW_MIGRATION";
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

function progress(event: string, detail: Record<string, string | number | boolean> = {}) {
  const suffix = Object.keys(detail).length > 0 ? ` ${JSON.stringify(detail)}` : "";
  process.stderr.write(`[0073] ${event}${suffix}\n`);
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
    throw new Error("0073 remote rehearsal requires an explicitly classified preview or staging target.");
  }
  if (databaseUrlLooksProductionLike(databaseUrl)) throw new Error("Refusing production-like target.");
  if (process.env[PREFLIGHT_ALLOW_REMOTE_ENV] !== "true"
    || process.env[NO_APP_CONNECTIONS_ENV] !== "true") {
    throw new Error("0073 remote inspection requires its explicit allow flag and no-app acknowledgement.");
  }
  if (fingerprint !== EXPECTED_DIRECT_FINGERPRINT
    || process.env[TARGET_FINGERPRINT_ENV] !== fingerprint
    || !poolerUrl
    || targetFingerprint(poolerUrl) !== EXPECTED_POOLER_FINGERPRINT
    || projectRefHash(databaseUrl, "direct") !== EXPECTED_PROJECT_REF_HASH
    || projectRefHash(poolerUrl, "pooler") !== EXPECTED_PROJECT_REF_HASH) {
    throw new Error("0073 target identity is not the audited noisia-staging project.");
  }
  const restorePoint = assertFreshRestorePoint();
  requireSafeDatabaseReadTarget(databaseUrl, {
    operation: "inspect governed multi-view migration 0073",
    allowRemoteEnv: PREFLIGHT_ALLOW_REMOTE_ENV
  });

  if (mode === "apply") {
    if (process.env[APPLY_APPROVED_ENV] !== "true"
      || process.env[APPLY_ALLOW_REMOTE_ENV] !== "true"
      || process.env[ISOLATED_TARGET_ENV] !== "true"
      || !/^sha256:[0-9a-f]{64}$/u.test(process.env[EXPECTED_STATE_DIGEST_ENV] ?? "")) {
      throw new Error("0073 apply requires its specific approval, isolation and preflight digest.");
    }
    requireSafeDatabaseWriteTarget(databaseUrl, {
      operation: "apply governed multi-view migration 0073",
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

async function indexExists(client: pg.Client, index: string) {
  return (await client.query<{ present: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS present",
    [`public.${index}`]
  )).rows[0]?.present === true;
}

async function inspectMigration(client: pg.Client) {
  const checks: Check[] = [
    {
      key: "function:closed_client_views",
      marker: true,
      present: await functionContainsAll(client,
        "signal_governed_client_view_is_valid_v1(text)", [
          "brand", "competition", "category", "all-governed"
        ])
    },
    {
      key: "function:module_view_usage_purposes",
      marker: true,
      present: await functionContainsAll(client,
        "signal_governed_view_required_usage_purposes_v1(text,text)", [
          "brand-monitoring", "mentions", "topics-narratives",
          "client-derived-metrics", "client-mention-list", "client-text-or-excerpt"
        ])
    },
    {
      key: "function:neutral_base_writer",
      marker: true,
      present: await functionContainsAll(client,
        "ensure_signal_operational_attributable_semantic_base_v1(uuid,uuid)", [
          "signal-operational-attributable-semantic-v1",
          "signal_data_governance_actor_is_valid",
          "attributable-semantic-base-v1"
        ])
    },
    {
      key: "function:neutral_base_reconcile",
      marker: true,
      present: await functionContainsAll(client,
        "reconcile_signal_operational_attributable_semantic_base_v1(uuid,uuid)", [
          "reconcile_signal_attributable_semantic_base_mention_v1",
          "refresh_signal_attributable_semantic_base_digest_v1",
          "membership_status = 'included'"
        ])
    },
    {
      key: "function:entity_authority",
      marker: true,
      present: await functionContainsAll(client,
        "signal_population_policy_entity_is_governed_v1(uuid,text,text,uuid)", [
          "competitors", "brand_seeds", "intelligence_entities", "workspace.status = 'active'"
        ])
    },
    {
      key: "function:bundle_scope_entity_contract",
      marker: true,
      present: await functionContainsAll(client,
        "signal_governed_view_bundle_scopes_match_v1(uuid,text)", [
          "primary_brand", "competitor", "category", "reference",
          "signal_population_policy_entity_is_governed_v1"
        ])
    },
    {
      key: "function:bundle_entity_current_authority",
      marker: true,
      present: await functionContainsAll(client,
        "signal_governed_view_bundle_entities_are_current_v1(uuid)", [
          "signal_population_policy_entities",
          "signal_population_policy_entity_is_governed_v1"
        ])
    },
    {
      key: "function:neutral_base_contract",
      marker: true,
      present: await functionContainsAll(client,
        "signal_attributable_semantic_base_definition_v1()", [
          "signal-operational-attributable-semantic-v1",
          "mention_semantic", "approved", "eligible", "canonical-root"
        ])
    },
    {
      key: "function:neutral_base_per_root_reconcile",
      marker: true,
      present: await functionContainsAll(client,
        "reconcile_signal_attributable_semantic_base_mention_v1(uuid,uuid,boolean)", [
          "signal_population_policy_entity_is_governed_v1",
          "attribution_basis = 'mention_semantic'", "attribution.is_current",
          "attribution.review_status = 'approved'",
          "attribution.eligibility_status = 'eligible'"
        ])
    },
    {
      key: "function:generalized_derivation",
      marker: true,
      present: await functionContainsAll(client,
        "ensure_signal_governed_view_population_derivation(uuid,uuid,uuid,text,text,text,text,uuid)", [
          "signal_governed_client_view_is_valid_v1",
          "signal_governed_view_bundle_scopes_match_v1",
          "signal_governed_view_base_contract_is_valid_v1"
        ])
    },
    {
      key: "function:withdraw_to_absence",
      marker: true,
      present: await functionContainsAll(client,
        "withdraw_signal_governed_view_binding(uuid,text,text,uuid,uuid,text,text)", [
          "withdraw-to-bridge", "withdraw-to-absence",
          "signal-governed-view-withdrawal-v1", "signal-governed-view-withdrawal-v2"
        ])
    },
    {
      key: "column:binding_set_view_key",
      marker: true,
      present: await columnExists(client, "signal_governed_brand_binding_set_operations", "view_key")
    },
    {
      key: "index:neutral_base_unique",
      marker: false,
      present: await indexExists(client, "uq_signal_attributable_semantic_base_draft")
    },
    {
      key: "constraint:binding_set_views",
      marker: false,
      present: await constraintContainsAll(client, "signal_governed_view_binding_set_view", [
        "brand", "competition", "category", "all-governed"
      ])
    },
    {
      key: "constraint:binding_set_actions",
      marker: false,
      present: await constraintContainsAll(client, "signal_governed_brand_binding_set_action", [
        "withdraw-to-bridge", "withdraw-to-absence", "competition", "all-governed"
      ])
    },
    {
      key: "constraint:derivation_views",
      marker: false,
      present: await constraintContainsAll(client,
        "signal_governed_view_population_derivation_identity", [
          "brand-monitoring", "competition", "category", "all-governed"
        ])
    },
    {
      key: "constraint:evaluation_views",
      marker: false,
      present: await constraintContainsAll(client,
        "signal_data_governance_evaluation_module", [
          "mentions", "competition", "category", "all-governed"
        ])
    },
    {
      key: "constraint:compilation_views",
      marker: false,
      present: await constraintContainsAll(client,
        "signal_population_policy_compilation_module", [
          "topics-narratives", "competition", "category", "all-governed"
        ])
    },
    {
      key: "constraint:binding_set_item_identity",
      marker: false,
      present: await constraintContainsAll(client,
        "signal_governed_brand_binding_set_item_identity", [
          "brand-monitoring", "mentions", "topics-narratives",
          "competition", "category", "all-governed"
        ])
    },
    {
      key: "constraint:binding_event_actions",
      marker: false,
      present: await constraintContainsAll(client,
        "signal_governed_view_binding_event_action", [
          "promote", "rollback", "withdraw-to-bridge", "withdraw-to-absence"
        ])
    },
    {
      key: "constraint:binding_event_transition",
      marker: false,
      present: await constraintContainsAll(client,
        "signal_governed_view_binding_event_transition_shape", [
          "next_binding_id IS NOT NULL", "withdraw-to-bridge", "withdraw-to-absence",
          "previous_binding_id IS NOT NULL", "next_binding_id IS NULL"
        ])
    },
    {
      key: "constraint:entity_invalidation_reason",
      marker: false,
      present: await constraintContainsAll(client,
        "signal_data_governance_invalidation_reason", ["governed-entity-changed"])
    },
    {
      key: "constraint:entity_invalidation_kind",
      marker: false,
      present: await constraintContainsAll(client,
        "signal_data_governance_invalidation_kind", ["policy-entity"])
    },
    {
      key: "trigger:neutral_base_attribution",
      marker: false,
      present: await triggerContainsAll(client,
        "trg_signal_attributable_semantic_base_attribution", [
          "AFTER INSERT OR DELETE OR UPDATE", "signal_mention_attributions",
          "reconcile_signal_attributable_semantic_base_from_row_v1()"
        ])
    },
    {
      key: "trigger:neutral_base_mention",
      marker: false,
      present: await triggerContainsAll(client,
        "trg_signal_attributable_semantic_base_mention", [
          "AFTER UPDATE", "mentions",
          "reconcile_signal_attributable_semantic_base_from_row_v1()"
        ])
    },
    {
      key: "trigger:policy_entity_authority",
      marker: false,
      present: await triggerContainsAll(client,
        "trg_signal_population_policy_entity_governed_v1", [
          "BEFORE INSERT OR UPDATE", "signal_population_policy_entities",
          "enforce_signal_population_policy_entity_governed_v1()"
        ])
    },
    {
      key: "trigger:entity_registry_intelligence",
      marker: false,
      present: await triggerContainsAll(client,
        "trg_signal_governed_intelligence_entity_invalidation", [
          "AFTER UPDATE", "intelligence_entities",
          "invalidate_signal_governed_entity_from_registry_v1()"
        ])
    },
    {
      key: "trigger:entity_registry_competitor",
      marker: false,
      present: await triggerContainsAll(client,
        "trg_signal_governed_competitor_invalidation", [
          "AFTER UPDATE", "competitors",
          "invalidate_signal_governed_entity_from_registry_v1()"
        ])
    },
    {
      key: "trigger:entity_registry_competitor_seed",
      marker: false,
      present: await triggerContainsAll(client,
        "trg_signal_governed_competitor_seed_invalidation", [
          "AFTER UPDATE", "brand_seeds",
          "invalidate_signal_governed_entity_from_registry_v1()"
        ])
    },
    {
      key: "trigger:derivation_authority",
      marker: false,
      present: await triggerContainsAll(client,
        "trg_signal_governed_view_population_derivation", [
          "BEFORE INSERT OR UPDATE", "signal_governed_view_population_derivations",
          "enforce_signal_governed_view_population_derivation()"
        ])
    },
    {
      key: "trigger:evaluation_authority",
      marker: false,
      present: await triggerContainsAll(client,
        "trg_00_signal_data_governance_evaluation_scope", [
          "BEFORE INSERT", "signal_data_governance_evaluations",
          "enforce_signal_data_governance_evaluation_scope()"
        ])
    },
    {
      key: "trigger:compilation_authority",
      marker: false,
      present: await triggerContainsAll(client,
        "trg_signal_population_policy_compilation_governance", [
          "BEFORE INSERT", "signal_population_policy_compilations",
          "enforce_signal_population_policy_compilation_governance()"
        ])
    },
    {
      key: "trigger:binding_entity_authority",
      marker: false,
      present: await triggerContainsAll(client,
        "trg_signal_governed_view_binding_entity_authority_v1", [
          "BEFORE INSERT OR UPDATE", "signal_governed_view_bindings",
          "enforce_signal_governed_view_binding_entity_authority_v1()"
        ])
    },
    {
      key: "trigger:binding_event_contract",
      marker: false,
      present: await triggerContainsAll(client,
        "trg_signal_governed_view_binding_event_contract", [
          "BEFORE INSERT", "signal_governed_view_binding_events",
          "enforce_signal_governed_view_binding_event_contract()"
        ])
    },
    {
      key: "trigger:binding_set_operation_authority",
      marker: false,
      present: await triggerContainsAll(client,
        "trg_signal_governed_brand_binding_set_operation", [
          "BEFORE INSERT", "signal_governed_brand_binding_set_operations",
          "enforce_signal_governed_brand_binding_set_operation()"
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
      key: "trigger:canonical_cardinality_deferred",
      marker: false,
      present: await triggerContainsAll(client,
        "trg_signal_governed_brand_binding_set_cardinality", [
          "CREATE CONSTRAINT TRIGGER", "AFTER INSERT", "DEFERRABLE INITIALLY DEFERRED",
          "enforce_signal_governed_brand_binding_set_cardinality()"
        ])
    },
    {
      key: "trigger:neutral_base_isolation",
      marker: false,
      present: await triggerContainsAll(client,
        "trg_signal_attributable_semantic_base_isolation_v1", [
          "BEFORE INSERT OR UPDATE", "signal_population_definitions",
          "enforce_signal_attributable_semantic_base_isolation_v1()"
        ])
    },
    {
      key: "function:compilation_governance",
      marker: false,
      present: await functionContainsAll(client,
        "enforce_signal_population_policy_compilation_governance()", [
          "signal_governed_view_required_usage_purposes_v1",
          "signal_governed_view_population_derivations",
          "exact authorized provenance proof"
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
  const missing = Array.from({ length: 14 }, (_, index) => index + 59)
    .filter((ordinal) => !ledger.some((row) => row.ordinal === ordinal));
  if (missing.length > 0) throw new Error(`Missing prerequisite ledger ordinals: ${missing.join(",")}.`);
  if (ledger.some((row) => row.ordinal > ORDINAL)) {
    throw new Error("Unexpected migration exists after 0073.");
  }
  for (const [ordinal, checksum] of [
    [68, "sha256:77785c5e5507b41d72e8a9e9ed649aa2ce229063609087d95af54d33ff20121f"],
    [69, "sha256:2f8bfa4139edf8c8f2add1f4a3c5e8068b801aeee911a2258c679fd018241eff"],
    [70, "sha256:b73a230a7c21e90936d55059625cb7014d682e832212276fead593d266f3e910"],
    [71, "sha256:df1381a270083b0fc91943e1a7be438b9fa4fd71c736ce2b2ad3ed85e1c44b11"],
    [72, "sha256:1c974ec09871c28a439bb23a7753b6b0a9d8915539493bff3c364515bbbd4738"]
  ] as const) {
    if (ledger.find((row) => row.ordinal === ordinal)?.checksum_sha256 !== checksum) {
      throw new Error(`Prerequisite checksum drift for ${ordinal}.`);
    }
  }
  const recorded = ledger.filter((row) => row.ordinal === ORDINAL);
  if (migration.state === "partial") {
    throw new Error(`0073 is partial: ${migration.missing.join(", ")}.`);
  }
  if (recorded.length > 1
    || (recorded.length === 0 && migration.state === "complete")
    || (recorded.length === 1 && (migration.state !== "complete"
      || recorded[0]?.migration_name !== FILENAME
      || recorded[0]?.checksum_sha256 !== CHECKSUM))) {
    throw new Error("0073 ledger and sentinels disagree or its checksum is incompatible.");
  }
  return ledger;
}

async function digestTable(client: pg.Client, table: string) {
  if (!/^[a-z][a-z0-9_]*$/u.test(table)) throw new Error("Invalid protected table name.");
  try {
    return (await client.query<ProtectedDomain>(`
      WITH row_hashes AS MATERIALIZED (
        SELECT sha256(convert_to(to_jsonb(protected_row)::text, 'UTF8')) AS row_hash
        FROM ${table} protected_row
      )
      SELECT count(*)::int AS row_count,
        'sha256:' || encode(sha256(COALESCE(
          string_agg(row_hash, decode('', 'hex') ORDER BY row_hash), decode('', 'hex')
        )), 'hex') AS content_hash
      FROM row_hashes
    `)).rows[0]!;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    if (code === "42P01") throw new Error(`Protected table ${table} is missing.`);
    throw error;
  }
}

async function inspectProtectedState(client: pg.Client, phase = "protected_state") {
  const domains: Record<string, ProtectedDomain> = {};
  const timings: Record<string, number> = {};
  progress(`${phase}:start`, { domains: PROTECTED_TABLES.length + 1 });
  for (const [index, table] of PROTECTED_TABLES.entries()) {
    const startedAt = performance.now();
    progress(`${phase}:domain:start`, {
      index: index + 1,
      total: PROTECTED_TABLES.length + 1,
      table
    });
    domains[table] = await digestTable(client, table);
    timings[table] = Math.round(performance.now() - startedAt);
    progress(`${phase}:domain:done`, {
      index: index + 1,
      total: PROTECTED_TABLES.length + 1,
      table,
      rows: domains[table]!.row_count,
      elapsed_ms: timings[table]!
    });
  }
  const legacyStartedAt = performance.now();
  progress(`${phase}:domain:start`, {
    index: PROTECTED_TABLES.length + 1,
    total: PROTECTED_TABLES.length + 1,
    table: "signal_governed_binding_set_operations_legacy_projection"
  });
  domains.signal_governed_binding_set_operations_legacy_projection =
    (await client.query<ProtectedDomain>(`
      WITH row_hashes AS MATERIALIZED (
        SELECT sha256(convert_to(jsonb_build_object(
          'id',operation.id,'workspace_id',operation.workspace_id,
          'action',operation.action,'policy_bundle_id',operation.policy_bundle_id,
          'actor_user_id',operation.actor_user_id,
          'request_digest',operation.request_digest,'result_digest',operation.result_digest,
          'idempotency_key',operation.idempotency_key,'created_at',operation.created_at
        )::text, 'UTF8')) AS row_hash
        FROM signal_governed_brand_binding_set_operations operation
      )
      SELECT count(*)::int AS row_count,
        'sha256:' || encode(sha256(COALESCE(
          string_agg(row_hash, decode('', 'hex') ORDER BY row_hash), decode('', 'hex')
        )), 'hex') AS content_hash
      FROM row_hashes
    `)).rows[0]!;
  timings.signal_governed_binding_set_operations_legacy_projection =
    Math.round(performance.now() - legacyStartedAt);
  progress(`${phase}:domain:done`, {
    index: PROTECTED_TABLES.length + 1,
    total: PROTECTED_TABLES.length + 1,
    table: "signal_governed_binding_set_operations_legacy_projection",
    rows: domains.signal_governed_binding_set_operations_legacy_projection.row_count,
    elapsed_ms: timings.signal_governed_binding_set_operations_legacy_projection
  });
  const parentViewKeyPresent = await columnExists(
    client, "signal_governed_brand_binding_set_operations", "view_key"
  );
  const bindingSetViewState = parentViewKeyPresent
    ? (await client.query<{ total_rows: number; brand_rows: number; non_brand_rows: number }>(`
        SELECT count(*)::int AS total_rows,
          count(*) FILTER (WHERE view_key='brand')::int AS brand_rows,
          count(*) FILTER (WHERE view_key<>'brand')::int AS non_brand_rows
        FROM signal_governed_brand_binding_set_operations
      `)).rows[0]!
    : { total_rows: domains.signal_governed_binding_set_operations_legacy_projection.row_count,
        brand_rows: 0, non_brand_rows: 0 };

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
    binding_set_view_state: { column_present: parentViewKeyPresent, ...bindingSetViewState },
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
        AND application_name<>'noisia-governed-multi-view-0073')::int
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
    application_name: "noisia-governed-multi-view-0073-peer"
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
  if (sha256(migrationSql) !== CHECKSUM) throw new Error("0073 local checksum mismatch.");

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig(),
    application_name: "noisia-governed-multi-view-0073"
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
        throw new Error("Protected state changed after the 0073 preflight.");
      }
      await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [LOCK_KEY]);
      try {
        progress("apply_lock:acquired");
        const lockedMigration = await inspectMigration(client);
        const lockedLedger = await assertPrerequisites(client, lockedMigration);
        const lockedProtected = await inspectProtectedState(client, "direct_locked");
        if (lockedProtected.aggregate_hash !== protectedBefore.aggregate_hash) {
          throw new Error("Protected product state changed while waiting for the 0073 lock.");
        }
        if (lockedMigration.state === "complete") {
          actions = [{ migration: FILENAME, action: "verified_existing" }];
        } else {
          if (lockedMigration.state !== "absent"
            || lockedLedger.some((row) => row.ordinal === ORDINAL)) {
            throw new Error("0073 is not cleanly absent.");
          }
          await client.query("BEGIN");
          try {
            await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [LOCK_KEY]);
            await client.query(migrationSql);
            const migrationApplied = await inspectMigration(client);
            if (migrationApplied.state !== "complete") {
              throw new Error(`0073 sentinels failed: ${migrationApplied.missing.join(", ")}.`);
            }
            const appliedProtected = await inspectProtectedState(client, "direct_applied");
            if (appliedProtected.aggregate_hash !== protectedBefore.aggregate_hash) {
              throw new Error("0073 changed protected product state.");
            }
            if (appliedProtected.binding_set_view_state.total_rows
                  !== protectedBefore.domains
                    .signal_governed_binding_set_operations_legacy_projection!.row_count
              || appliedProtected.binding_set_view_state.brand_rows
                  !== appliedProtected.binding_set_view_state.total_rows
              || appliedProtected.binding_set_view_state.non_brand_rows !== 0) {
              throw new Error("0073 did not preserve all existing binding-set history as brand.");
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
        throw new Error("0073 verify requires complete sentinels and one exact ledger row.");
      }
    }
    if (protectedAfter.aggregate_hash !== protectedBefore.aggregate_hash) {
      throw new Error("Protected state changed during the 0073 runner.");
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

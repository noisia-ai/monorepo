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

const RUNNER_VERSION = "signal-semantic-base-isolation-migration-rehearsal-v1";
const LEDGER = "signal_workspace_data_plane_migration_ledger";
const LOCK_KEY = "noisia:signal-semantic-base-isolation:0070";
const FILENAME = "0070_signal_semantic_base_isolation.sql";
const ORDINAL = 70;
const CHECKSUM = "sha256:b73a230a7c21e90936d55059625cb7014d682e832212276fead593d266f3e910";
const EXPECTED_REMOTE_FINGERPRINT =
  "sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19";
const EXPECTED_POOLER_FINGERPRINT =
  "sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815";
const EXPECTED_PROJECT_REF_HASH =
  "sha256:030c5a33e3b28881c4d77983a6049bbfa16c995da232454081cbccfcfa78aa32";
const EXPECTED_V1_DIGEST =
  "sha256:2e46c7565d2835e616824b1f9866faaea5f0a96b55a3c99978d58271baa0466e";
const EXPECTED_LAIKA_BASE_COUNT = 276;
const EXPECTED_LAIKA_BASE_DIGEST =
  "sha256:1e66cf5906fb4163aee1fc1e408ab630fab2068a55382503c821ef7882b26880";

const MODE_ENV = "NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_MIGRATION_MODE";
const PREFLIGHT_ALLOW_REMOTE_ENV =
  "NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_PREFLIGHT_ALLOW_REMOTE";
const APPLY_ALLOW_REMOTE_ENV =
  "NOISIA_DB_APPLY_SIGNAL_SEMANTIC_BASE_ISOLATION_ALLOW_REMOTE";
const APPLY_APPROVED_ENV =
  "NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_SCHEMA_APPLY_APPROVED";
const TARGET_FINGERPRINT_ENV =
  "NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_TARGET_FINGERPRINT";
const EXPECTED_STATE_DIGEST_ENV =
  "NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_EXPECTED_STATE_DIGEST";
const ISOLATED_TARGET_ENV =
  "NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_ISOLATED_TARGET_CONFIRMED";
const RESTORE_REFERENCE_ENV =
  "NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_RESTORE_REFERENCE";
const RESTORE_POINT_AT_ENV =
  "NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_RESTORE_POINT_AT";
const RESTORE_VERIFIED_ENV =
  "NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_RESTORE_VERIFIED";
const NO_APP_CONNECTIONS_ENV =
  "NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_NO_APP_CONNECTIONS_CONFIRMED";
const RUNNING_SYNCS_ACK_ENV =
  "NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_RUNNING_SYNCS_ACKNOWLEDGED";

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

function projectRef(databaseUrl: string, kind: "direct" | "pooler") {
  const parsed = new URL(databaseUrl);
  if (kind === "direct") {
    const match = /^db\.([a-z0-9]+)\.supabase\.co$/u.exec(parsed.hostname.toLowerCase());
    if (!match?.[1]) throw new Error("Direct connection does not expose a project ref.");
    return match[1];
  }
  const match = /^postgres\.([a-z0-9]+)$/u.exec(decodeURIComponent(parsed.username).toLowerCase());
  if (!match?.[1]) throw new Error("Pooler connection does not expose a project ref.");
  return match[1];
}

function assertRestorePoint() {
  if (process.env[RESTORE_VERIFIED_ENV] !== "true") {
    throw new Error(`${RESTORE_VERIFIED_ENV}=true is required.`);
  }
  const reference = process.env[RESTORE_REFERENCE_ENV]?.trim() ?? "";
  if (reference.length < 8) throw new Error(`${RESTORE_REFERENCE_ENV} is required.`);
  const restoreAt = Date.parse(process.env[RESTORE_POINT_AT_ENV]?.trim() ?? "");
  const ageMs = Date.now() - restoreAt;
  if (!Number.isFinite(restoreAt) || ageMs < 0 || ageMs > 7 * 24 * 60 * 60 * 1000) {
    throw new Error(`${RESTORE_POINT_AT_ENV} must be verified and no older than seven days.`);
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
  const declaredTarget = (process.env.NOISIA_REMOTE_DATABASE_TARGET ?? "").trim().toLowerCase();
  let restorePoint: ReturnType<typeof assertRestorePoint> | null = null;
  if (!local) {
    if (declaredTarget !== "preview" && declaredTarget !== "staging") {
      throw new Error("Remote 0070 rehearsal requires a preview or staging target.");
    }
    if (databaseUrlLooksProductionLike(databaseUrl)) throw new Error("Refusing production-like target.");
    if (fingerprint !== EXPECTED_REMOTE_FINGERPRINT
      || process.env[TARGET_FINGERPRINT_ENV] !== fingerprint) {
      throw new Error("Remote target fingerprint does not match audited noisia-staging.");
    }
    if (!poolerUrl || targetFingerprint(poolerUrl) !== EXPECTED_POOLER_FINGERPRINT) {
      throw new Error("Remote 0070 rehearsal requires the audited noisia-staging pooler URL.");
    }
    const directRef = projectRef(databaseUrl, "direct");
    const poolerRef = projectRef(poolerUrl, "pooler");
    if (directRef !== poolerRef || sha256(directRef) !== EXPECTED_PROJECT_REF_HASH) {
      throw new Error("Direct and pooler URLs do not identify the same audited project.");
    }
    if (process.env[PREFLIGHT_ALLOW_REMOTE_ENV] !== "true") {
      throw new Error(`${PREFLIGHT_ALLOW_REMOTE_ENV}=true is required.`);
    }
    if (process.env[NO_APP_CONNECTIONS_ENV] !== "true") {
      throw new Error(`${NO_APP_CONNECTIONS_ENV}=true is required.`);
    }
    restorePoint = assertRestorePoint();
    requireSafeDatabaseReadTarget(databaseUrl, {
      operation: "inspect semantic-base isolation migration 0070",
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
        throw new Error(`${EXPECTED_STATE_DIGEST_ENV} must copy the preflight digest.`);
      }
      requireSafeDatabaseWriteTarget(databaseUrl, {
        operation: "apply semantic-base isolation migration 0070",
        allowRemoteEnv: APPLY_ALLOW_REMOTE_ENV
      });
    }
  }
  return { local, target: local ? "local" : declaredTarget, restorePoint };
}

async function functionContains(client: pg.Client, signature: string, token: string) {
  const result = await client.query<{ present: boolean }>(`
    SELECT COALESCE(position($2 in pg_get_functiondef(to_regprocedure($1))) > 0,false) AS present
  `, [`public.${signature}`, token]);
  return result.rows[0]?.present === true;
}

async function inspectMigrationState(client: pg.Client) {
  const checks = [
    {
      key: "function:signal_operational_semantic_base_definition_v2()",
      present: await functionContains(
        client,
        "signal_operational_semantic_base_definition_v2()",
        "signal-operational-primary-brand-semantic-v2"
      )
    },
    {
      key: "function:signal_operational_semantic_base_definition_hash_v2(uuid,integer)",
      present: await functionContains(
        client,
        "signal_operational_semantic_base_definition_hash_v2(uuid,integer)",
        "primary-brand-semantic"
      )
    },
    {
      key: "function:enforce_signal_operational_semantic_base_isolation_v2()",
      present: await functionContains(
        client,
        "enforce_signal_operational_semantic_base_isolation_v2()",
        "Semantic Operational V2 base cannot contain policy, module, period or governance authority state"
      )
    },
    {
      key: "trigger:trg_signal_operational_semantic_base_isolation_v2",
      present: (await client.query<{ present: boolean }>(`
        SELECT EXISTS (SELECT 1 FROM pg_trigger
          WHERE tgname='trg_signal_operational_semantic_base_isolation_v2' AND NOT tgisinternal
        ) AS present
      `)).rows[0]?.present === true
    }
  ];
  const present = checks.filter((check) => check.present).length;
  const state: MigrationState = present === 0
    ? "absent"
    : present === checks.length ? "complete" : "partial";
  return {
    state,
    required: checks.length,
    present,
    missing: checks.filter((check) => !check.present).map((check) => check.key)
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
    SELECT migration_name,ordinal,checksum_sha256,disposition,runner_version,target_fingerprint
    FROM ${LEDGER} WHERE ordinal BETWEEN 59 AND 70 ORDER BY ordinal
  `)).rows;
}

async function assertPrerequisites(client: pg.Client, migrationState: Awaited<ReturnType<typeof inspectMigrationState>>) {
  const ledger = await readLedger(client);
  const prerequisites = Array.from({ length: 11 }, (_, index) => index + 59);
  const missing = prerequisites.filter((ordinal) => !ledger.some((row) => row.ordinal === ordinal));
  if (missing.length > 0) throw new Error(`Missing prerequisite ledger ordinals: ${missing.join(",")}.`);
  if (ledger.some((row) => row.ordinal > 70)) throw new Error("Unexpected migration exists after 0070.");
  for (const [ordinal, checksum] of [
    [68, "sha256:77785c5e5507b41d72e8a9e9ed649aa2ce229063609087d95af54d33ff20121f"],
    [69, "sha256:2f8bfa4139edf8c8f2add1f4a3c5e8068b801aeee911a2258c679fd018241eff"]
  ] as const) {
    if (ledger.find((row) => row.ordinal === ordinal)?.checksum_sha256 !== checksum) {
      throw new Error(`Prerequisite checksum drift for ${ordinal}.`);
    }
  }
  const recorded = ledger.filter((row) => row.ordinal === ORDINAL);
  if (recorded.length > 1
    || (recorded.length === 1 && (recorded[0]?.migration_name !== FILENAME
      || recorded[0]?.checksum_sha256 !== CHECKSUM || migrationState.state !== "complete"))
    || (recorded.length === 0 && migrationState.state === "complete")) {
    throw new Error("0070 ledger and sentinels disagree.");
  }
  if (migrationState.state === "partial") {
    throw new Error(`0070 is partial: ${migrationState.missing.join(", ")}.`);
  }
  return { ledger, migration_0070: migrationState };
}

async function inspectConnections(client: pg.Client) {
  return (await client.query<{
    active_incompatible: number;
    named_apps: number;
    active_writers: number;
  }>(`
    SELECT
      count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid()
        AND state IS DISTINCT FROM 'idle'
        AND application_name<>'noisia-semantic-base-isolation-0070')::int AS active_incompatible,
      count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid()
        AND COALESCE(application_name,'') ~* '(studio|worker|bullmq)')::int AS named_apps,
      count(*) FILTER (WHERE backend_type='client backend' AND pid<>pg_backend_pid()
        AND state IS DISTINCT FROM 'idle'
        AND query !~* '^\\s*(select|show|set|begin|commit|rollback)')::int AS active_writers
    FROM pg_stat_activity WHERE datname=current_database()
  `)).rows[0]!;
}

async function digestQuery(client: pg.Client, fromSql: string, orderSql: string) {
  return (await client.query<{ row_count: number; content_hash: string }>(`
    SELECT count(*)::int AS row_count,
      'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(
        to_jsonb(row_value.*)::text,E'\\n' ORDER BY ${orderSql}
      ),''),'UTF8')),'hex') AS content_hash
    FROM ${fromSql} row_value
  `)).rows[0]!;
}

async function inspectV1(client: pg.Client) {
  return (await client.query<{
    definition_count: number;
    pointer_count: number;
    membership_count: number;
    included_count: number;
    digest: string;
  }>(`
    WITH v1 AS (
      SELECT definition.id,definition.workspace_id,pointer.id AS pointer_id
      FROM signal_population_definitions definition
      JOIN signal_workspace_population_pointers pointer
        ON pointer.population_id=definition.id AND pointer.workspace_id=definition.workspace_id
      WHERE pointer.purpose='operational'
        AND definition.population_key='primary-brand-operational'
        AND definition.definition->>'contract_version'
          IS DISTINCT FROM 'signal-operational-primary-brand-semantic-v2'
    ), rows AS (
      SELECT concat_ws('|',v1.workspace_id::text,v1.id::text,
        membership.mention_id::text,membership.membership_status,
        COALESCE(membership.removed_at::text,'∅')) AS value
      FROM v1 LEFT JOIN signal_population_memberships membership ON membership.population_id=v1.id
    )
    SELECT (SELECT count(*)::int FROM v1) AS definition_count,
      (SELECT count(*)::int FROM v1) AS pointer_count,
      (SELECT count(*)::int FROM signal_population_memberships membership
        JOIN v1 ON v1.id=membership.population_id) AS membership_count,
      (SELECT count(*)::int FROM signal_population_memberships membership
        JOIN v1 ON v1.id=membership.population_id
        WHERE membership.membership_status='included' AND membership.removed_at IS NULL) AS included_count,
      'sha256:' || encode(sha256(convert_to(COALESCE((SELECT string_agg(value,E'\\n' ORDER BY value)
        FROM rows),''),'UTF8')),'hex') AS digest
  `)).rows[0]!;
}

async function inspectSemanticBases(client: pg.Client) {
  const aggregate = (await client.query<{
    base_count: number;
    membership_count: number;
    active_membership_count: number;
    membership_rows_digest: string;
    contaminated_count: number;
    normalized_count: number;
  }>(`
    WITH base AS (
      SELECT definition.* FROM signal_population_definitions definition
      WHERE definition.definition->>'contract_version'
        = 'signal-operational-primary-brand-semantic-v2'
    ), membership_rows AS (
      SELECT membership.mention_id,concat_ws('|',base.workspace_id::text,base.id::text,membership.mention_id::text,
        membership.membership_status,membership.membership_reason,
        COALESCE(membership.removed_at::text,'∅')) AS value
      FROM base LEFT JOIN signal_population_memberships membership ON membership.population_id=base.id
    )
    SELECT (SELECT count(*)::int FROM base) AS base_count,
      (SELECT count(*)::int FROM membership_rows WHERE mention_id IS NOT NULL) AS membership_count,
      (SELECT count(*)::int FROM signal_population_memberships membership JOIN base ON base.id=membership.population_id
        WHERE membership.membership_status='included' AND membership.removed_at IS NULL) AS active_membership_count,
      'sha256:' || encode(sha256(convert_to(COALESCE((SELECT string_agg(value,E'\\n' ORDER BY value)
        FROM membership_rows WHERE mention_id IS NOT NULL),''),'UTF8')),'hex') AS membership_rows_digest,
      (SELECT count(*)::int FROM base WHERE policy_key<>'primary-brand-semantic'
        OR policy_version<>'1' OR definition<>jsonb_build_object(
          'contract_version','signal-operational-primary-brand-semantic-v2',
          'canonical_only',true,
          'attribution_basis','mention_semantic',
          'attribution_review_status','approved',
          'eligibility_status','eligible',
          'allowed_scopes',jsonb_build_array('primary_brand'),
          'promotion_state','candidate_not_promoted'
        ) OR definition_hash<>('sha256:' || encode(sha256(convert_to(concat_ws('|',
          'signal-operational-primary-brand-semantic-v2',workspace_id::text,version::text,
          'primary-brand-semantic','1'),'UTF8')),'hex')))
        AS contaminated_count,
      (SELECT count(*)::int FROM base WHERE policy_key='primary-brand-semantic'
        AND policy_version='1' AND definition=jsonb_build_object(
          'contract_version','signal-operational-primary-brand-semantic-v2',
          'canonical_only',true,
          'attribution_basis','mention_semantic',
          'attribution_review_status','approved',
          'eligibility_status','eligible',
          'allowed_scopes',jsonb_build_array('primary_brand'),
          'promotion_state','candidate_not_promoted'
        ) AND definition_hash=('sha256:' || encode(sha256(convert_to(concat_ws('|',
          'signal-operational-primary-brand-semantic-v2',workspace_id::text,version::text,
          'primary-brand-semantic','1'),'UTF8')),'hex')))
        AS normalized_count
  `)).rows[0]!;
  const laika = (await client.query<{
    membership_count: number;
    membership_digest: string;
    stored_membership_digest: string;
  }>(`
    WITH base AS (
      SELECT definition.id,definition.membership_digest
      FROM brands brand JOIN signal_workspaces workspace ON workspace.brand_id=brand.id
      JOIN signal_population_definitions definition ON definition.workspace_id=workspace.id
      WHERE brand.slug='laika' AND definition.definition->>'contract_version'
        = 'signal-operational-primary-brand-semantic-v2'
    ), members AS (
      SELECT membership.mention_id
      FROM base JOIN signal_population_memberships membership ON membership.population_id=base.id
      WHERE membership.membership_status='included' AND membership.removed_at IS NULL
    )
    SELECT (SELECT count(*)::int FROM members) AS membership_count,
      'sha256:' || encode(sha256(convert_to(COALESCE((SELECT string_agg(mention_id::text,',' ORDER BY mention_id)
        FROM members),''),'UTF8')),'hex') AS membership_digest,
      (SELECT membership_digest FROM base) AS stored_membership_digest
  `)).rows[0]!;
  return { aggregate, laika };
}

async function inspectProtectedState(client: pg.Client) {
  const v1 = await inspectV1(client);
  const semanticBases = await inspectSemanticBases(client);
  const domains = {
    population_pointers: await digestQuery(
      client, "signal_workspace_population_pointers", "row_value.workspace_id,row_value.purpose"
    ),
    semantic_assertions: await digestQuery(
      client, "signal_mention_attributions", "row_value.workspace_id,row_value.mention_id,row_value.id"
    ),
    review_events: await digestQuery(
      client,
      "signal_mention_attribution_review_events",
      "row_value.workspace_id,row_value.attribution_id,row_value.created_at,row_value.id"
    ),
    provenance: await digestQuery(
      client,
      "signal_mention_import_memberships",
      "row_value.workspace_id,row_value.mention_id,row_value.import_batch_id,row_value.id"
    ),
    derived_populations: await digestQuery(
      client,
      `(SELECT definition.* FROM signal_population_definitions definition
        WHERE definition.definition->>'contract_version'='signal-governed-view-resolved-population-v1')`,
      "row_value.workspace_id,row_value.population_key,row_value.version"
    ),
    derived_memberships: await digestQuery(
      client,
      `(SELECT membership.* FROM signal_population_memberships membership
        JOIN signal_population_definitions definition ON definition.id=membership.population_id
        WHERE definition.definition->>'contract_version'='signal-governed-view-resolved-population-v1')`,
      "row_value.workspace_id,row_value.population_id,row_value.mention_id"
    ),
    derivations: await digestQuery(
      client,
      "signal_governed_view_population_derivations",
      "row_value.workspace_id,row_value.module_key,row_value.view_key"
    ),
    compilations: await digestQuery(
      client,
      "signal_population_policy_compilations",
      "row_value.workspace_id,row_value.module_key,row_value.view_key,row_value.compilation_version"
    ),
    governed_bindings: await digestQuery(
      client,
      "signal_governed_view_bindings",
      "row_value.workspace_id,row_value.module_key,row_value.view_key,row_value.binding_version"
    ),
    data_governance_policies: await digestQuery(
      client,
      `(SELECT 'quality'::text AS kind,id,workspace_id,definition_hash,status,updated_at
        FROM signal_quality_policies UNION ALL
        SELECT 'retention',id,workspace_id,definition_hash,status,updated_at FROM signal_retention_policies
        UNION ALL SELECT 'licensing',id,workspace_id,definition_hash,status,updated_at
        FROM signal_licensing_policies)`,
      "row_value.workspace_id,row_value.kind,row_value.id"
    ),
    watermarks: await digestQuery(
      client, "signal_data_watermarks", "row_value.workspace_id,row_value.population_id,row_value.id"
    ),
    legacy_materializations: await digestQuery(
      client,
      "metric_materializations",
      "row_value.workspace_id,row_value.metric_key,row_value.period_start,row_value.period_end,row_value.id"
    ),
    releases: await digestQuery(
      client, "signal_workspace_current_releases", "row_value.workspace_id"
    ),
    running_syncs: await digestQuery(
      client, "(SELECT * FROM source_sync_runs WHERE status='running')", "row_value.id"
    )
  };
  const protectedState = {
    operational_v1: v1,
    semantic_base_memberships: {
      base_count: semanticBases.aggregate.base_count,
      membership_count: semanticBases.aggregate.membership_count,
      active_membership_count: semanticBases.aggregate.active_membership_count,
      membership_rows_digest: semanticBases.aggregate.membership_rows_digest,
      laika: semanticBases.laika
    },
    ...domains
  };
  return {
    ...protectedState,
    aggregate_hash: sha256(stableJson(protectedState)),
    semantic_base_contract: semanticBases.aggregate
  };
}

async function inspectConnectionsAndSyncs(client: pg.Client) {
  const connections = await inspectConnections(client);
  if (connections.active_incompatible > 0 || connections.named_apps > 0 || connections.active_writers > 0) {
    throw new Error("Studio, Workers or another writer is connected to noisia-staging.");
  }
  const syncs = (await client.query<{ count: number; oldest_started_at: string | null; digest: string }>(`
    SELECT count(*)::int AS count,min(started_at)::text AS oldest_started_at,
      'sha256:' || encode(sha256(convert_to(COALESCE(string_agg(concat_ws('|',
        id::text,workspace_id::text,data_source_id::text,status,created_at::text,started_at::text,
        finished_at::text),E'\\n' ORDER BY id),''),'UTF8')),'hex') AS digest
    FROM source_sync_runs WHERE status='running'
  `)).rows[0]!;
  return { connections, syncs };
}

async function recordMigration(client: pg.Client, fingerprint: string) {
  await client.query(`
    INSERT INTO ${LEDGER} (
      migration_name,ordinal,checksum_sha256,disposition,runner_version,target_fingerprint
    ) VALUES ($1,$2,$3,'applied',$4,$5)
  `, [FILENAME, ORDINAL, CHECKSUM, RUNNER_VERSION, fingerprint]);
}

async function inspectPeerState(databaseUrl: string) {
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig(),
    application_name: "noisia-semantic-base-isolation-0070-pooler"
  });
  await client.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const databaseName = (await client.query<{ name: string }>(
      "SELECT current_database() AS name"
    )).rows[0]!.name;
    const migrationState = await inspectMigrationState(client);
    const prerequisites = await assertPrerequisites(client, migrationState);
    const protectedState = await inspectProtectedState(client);
    await client.query("ROLLBACK");
    return {
      database_name_hash: sha256(databaseName),
      migration_state: migrationState,
      ledger_digest: sha256(stableJson(prerequisites.ledger)),
      protected_state_hash: protectedState.aggregate_hash
    };
  } finally {
    await client.end();
  }
}

function assertKnownRemoteState(state: Awaited<ReturnType<typeof inspectProtectedState>>, local: boolean) {
  if (local) return;
  if (state.operational_v1.digest !== EXPECTED_V1_DIGEST) {
    throw new Error("Operational V1 digest differs from the authorized Backend 04C input.");
  }
  if (state.semantic_base_memberships.laika.membership_count !== EXPECTED_LAIKA_BASE_COUNT
    || state.semantic_base_memberships.laika.membership_digest !== EXPECTED_LAIKA_BASE_DIGEST
    || state.semantic_base_memberships.laika.stored_membership_digest !== EXPECTED_LAIKA_BASE_DIGEST) {
    throw new Error("Laika semantic-base membership state differs from authorized Backend 04C input.");
  }
  if (state.governed_bindings.row_count !== 0 || state.population_pointers.row_count < 1) {
    throw new Error("Unexpected governed binding or pointer state.");
  }
}

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const poolerUrl = process.env.NOISIA_SIGNAL_SEMANTIC_BASE_ISOLATION_POOLER_DATABASE_URL?.trim()
    || null;
  const mode = readMode();
  const fingerprint = targetFingerprint(databaseUrl);
  const target = assertTarget(databaseUrl, poolerUrl, mode, fingerprint);
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const migrationSql = await readFile(join(root, "migrations", FILENAME), "utf8");
  if (sha256(migrationSql) !== CHECKSUM) throw new Error("0070 local checksum mismatch.");
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig(),
    application_name: "noisia-semantic-base-isolation-0070"
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
    const migrationBefore = await inspectMigrationState(client);
    const prerequisites = await assertPrerequisites(client, migrationBefore);
    const activity = await inspectConnectionsAndSyncs(client);
    const protectedBefore = await inspectProtectedState(client);
    assertKnownRemoteState(protectedBefore, target.local);
    const directDatabaseName = (await client.query<{ name: string }>(
      "SELECT current_database() AS name"
    )).rows[0]!.name;
    const directIdentity = {
      database_name_hash: sha256(directDatabaseName),
      migration_state: migrationBefore,
      ledger_digest: sha256(stableJson(prerequisites.ledger)),
      protected_state_hash: protectedBefore.aggregate_hash
    };
    const poolerIdentity = !target.local && poolerUrl
      ? await inspectPeerState(poolerUrl)
      : null;
    if (poolerIdentity && stableJson(poolerIdentity) !== stableJson(directIdentity)) {
      throw new Error("Direct and pooler connections do not expose the same pre-0070 state.");
    }
    let actions: Array<{ migration: string; action: string }> = [];
    let writesPerformed = false;

    if (mode === "apply") {
      if (activity.syncs.count > 0 && process.env[RUNNING_SYNCS_ACK_ENV] !== "true") {
        throw new Error(`${RUNNING_SYNCS_ACK_ENV}=true is required.`);
      }
      if (process.env[EXPECTED_STATE_DIGEST_ENV] !== protectedBefore.aggregate_hash) {
        throw new Error("Protected state changed after 0070 preflight.");
      }
      await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [LOCK_KEY]);
      try {
        const currentState = await inspectMigrationState(client);
        const currentLedger = await readLedger(client);
        const recorded = currentLedger.filter((row) => row.ordinal === ORDINAL);
        if (recorded.length === 1 && currentState.state === "complete"
          && recorded[0]?.checksum_sha256 === CHECKSUM && recorded[0]?.migration_name === FILENAME) {
          actions = [{ migration: FILENAME, action: "verified_existing" }];
        } else {
          if (recorded.length !== 0 || currentState.state !== "absent") {
            throw new Error("0070 is not cleanly absent.");
          }
          await client.query("BEGIN");
          try {
            await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [LOCK_KEY]);
            await client.query(migrationSql);
            const afterState = await inspectMigrationState(client);
            if (afterState.state !== "complete") {
              throw new Error(`0070 sentinels failed: ${afterState.missing.join(", ")}.`);
            }
            const protectedAfterMigration = await inspectProtectedState(client);
            if (protectedAfterMigration.aggregate_hash !== protectedBefore.aggregate_hash) {
              throw new Error("0070 changed V1, memberships, derivations, compilations or protected state.");
            }
            if (protectedAfterMigration.semantic_base_contract.contaminated_count !== 0
              || protectedAfterMigration.semantic_base_contract.normalized_count
                !== protectedAfterMigration.semantic_base_contract.base_count) {
              throw new Error("0070 failed semantic-base normalization.");
            }
            await recordMigration(client, fingerprint);
            await client.query("COMMIT");
            actions = [{ migration: FILENAME, action: "applied" }];
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

    const migrationAfter = await inspectMigrationState(client);
    const ledgerAfter = await readLedger(client);
    const protectedAfter = await inspectProtectedState(client);
    assertKnownRemoteState(protectedAfter, target.local);
    if (mode === "verify") {
      const ledgerRows = ledgerAfter.filter((row) => row.ordinal === ORDINAL);
      if (migrationAfter.state !== "complete" || ledgerRows.length !== 1
        || ledgerRows[0]?.migration_name !== FILENAME || ledgerRows[0]?.checksum_sha256 !== CHECKSUM) {
        throw new Error("0070 verify requires one matching ledger row and complete sentinels.");
      }
      if (protectedAfter.semantic_base_contract.contaminated_count !== 0
        || protectedAfter.semantic_base_contract.normalized_count
          !== protectedAfter.semantic_base_contract.base_count) {
        throw new Error("0070 verify found contaminated semantic bases.");
      }
    }
    if (protectedAfter.aggregate_hash !== protectedBefore.aggregate_hash) {
      throw new Error("Protected state changed during 0070 runner execution.");
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
      target_identity: {
        direct_fingerprint: fingerprint,
        pooler_fingerprint: poolerIdentity ? EXPECTED_POOLER_FINGERPRINT : null,
        project_ref_hash: poolerIdentity ? EXPECTED_PROJECT_REF_HASH : null,
        same_project: poolerIdentity !== null,
        same_database_state: poolerIdentity !== null,
        direct: directIdentity,
        pooler: poolerIdentity
      },
      restore_point: target.restorePoint,
      migration: { ordinal: ORDINAL, filename: FILENAME, checksum: CHECKSUM },
      writes_performed: writesPerformed,
      actions,
      connections: { ...activity.connections, application_names_redacted: true },
      running_syncs: { ...activity.syncs, rows_modified: false },
      prerequisites,
      migration_after: migrationAfter,
      ledger_after: ledgerAfter,
      protected_state_before: protectedBefore,
      protected_state_after: protectedAfter,
      protected_state_equal: protectedBefore.aggregate_hash === protectedAfter.aggregate_hash,
      semantic_base_normalized: protectedAfter.semantic_base_contract.contaminated_count === 0,
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

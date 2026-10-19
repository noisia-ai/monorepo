import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  generateSignalSemanticCandidatesV1,
  inspectSignalSemanticReviewInvariantsV1,
  loadSignalSemanticReviewQueueV1
} from "../signal-semantic-review.js";
import {
  databaseUrlLooksProductionLike,
  getDatabaseSslConfig,
  isLocalDatabaseUrl,
  requireSafeDatabaseReadTarget,
  requireSafeDatabaseWriteTarget
} from "../seeds/connection.js";

const MODE_ENV = "NOISIA_SIGNAL_SEMANTIC_CANDIDATE_MODE";
const BRAND_SLUG_ENV = "NOISIA_SIGNAL_SEMANTIC_CANDIDATE_BRAND_SLUG";
const ALLOW_REMOTE_ENV = "NOISIA_SIGNAL_SEMANTIC_CANDIDATE_ALLOW_REMOTE";
const EXPECTED_FINGERPRINT_ENV = "NOISIA_SIGNAL_SEMANTIC_CANDIDATE_TARGET_FINGERPRINT";
const EXPECTED_STATE_ENV = "NOISIA_SIGNAL_SEMANTIC_CANDIDATE_EXPECTED_STATE_DIGEST";
const APPLY_APPROVAL_ENV = "NOISIA_SIGNAL_SEMANTIC_CANDIDATE_APPLY_APPROVED";
const ISOLATED_TARGET_ENV = "NOISIA_SIGNAL_SEMANTIC_CANDIDATE_ISOLATED_TARGET_CONFIRMED";
const RESTORE_REFERENCE_ENV = "NOISIA_SIGNAL_SEMANTIC_CANDIDATE_RESTORE_REFERENCE";
const RESTORE_VERIFIED_ENV = "NOISIA_SIGNAL_SEMANTIC_CANDIDATE_RESTORE_VERIFIED";
const NO_APP_CONNECTIONS_ENV = "NOISIA_SIGNAL_SEMANTIC_CANDIDATE_NO_APP_CONNECTIONS_CONFIRMED";
const STALE_SYNC_ACK_ENV = "NOISIA_SIGNAL_SEMANTIC_CANDIDATE_STALE_SYNC_ACKNOWLEDGED";
const LOCK_KEY = "noisia:signal-semantic-candidate-generation:v1";
const AUTHORIZED_0064_CHECKSUM = "sha256:62e45c4a63e7b0651133c23eec393a3bda1a4f948c358f931ed8a97cb8172e17";
const EMPTY_SHA256 = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

type Mode = "preflight" | "dry-run" | "apply" | "verify";
type Sentinel =
  | { kind: "table" | "index"; name: string }
  | { kind: "column" | "constraint" | "trigger"; relation: string; name: string }
  | { kind: "function"; name: string }
  | { kind: "function_definition"; name: string; contains: string };

const SENTINELS: Sentinel[] = [
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
  { kind: "function", name: "create_signal_mention_semantic_assertion(uuid,uuid,uuid,uuid,text,text,uuid,text,numeric,text,text,text,text,text,text,uuid)" },
  { kind: "function", name: "review_signal_mention_semantic_assertion(uuid,uuid,text,text,text,text,text,text)" },
  { kind: "function", name: "supersede_signal_mention_semantic_assertion(uuid,uuid,text,text,uuid,text,numeric,text,text,text,text,text,text,text,text,text)" },
  { kind: "function", name: "ensure_signal_operational_semantic_candidate_v2(uuid,uuid)" },
  { kind: "function", name: "reconcile_signal_semantic_candidate_population_mention(uuid,uuid)" },
  { kind: "function_definition", name: "record_signal_mention_import_provenance(uuid,uuid)", contains: "'source_intent'" },
  { kind: "function_definition", name: "reconcile_signal_operational_population_mention(uuid,uuid)", contains: "semantic_contract" },
  { kind: "function_definition", name: "create_signal_tb_analysis_population(uuid,text,date,date,text,text,text,uuid,text)", contains: "signal-tb-analysis-population-semantic-v2" },
  { kind: "function_definition", name: "create_signal_tb_strategic_run(uuid,text,uuid,uuid,uuid,text,text,text,text,text,text,text,text,integer,jsonb)", contains: "signal-tb-analysis-population-semantic-v2" },
  { kind: "trigger", relation: "signal_mention_attribution_review_events", name: "trg_signal_attribution_review_events_append_only" },
  { kind: "trigger", relation: "signal_mention_attributions", name: "trg_signal_semantic_attribution_contract" },
  { kind: "function_definition", name: "reconcile_signal_population_after_attribution()", contains: "attribution_basis" },
  { kind: "trigger", relation: "signal_workspaces", name: "trg_signal_semantic_candidate_workspace_insert" }
];

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
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

function readMode(): Mode {
  const value = (process.env[MODE_ENV] ?? "preflight").trim().toLowerCase();
  if (["preflight", "dry-run", "apply", "verify"].includes(value)) return value as Mode;
  throw new Error(`${MODE_ENV} must be preflight, dry-run, apply or verify.`);
}

function assertTarget(databaseUrl: string, mode: Mode, fingerprint: string) {
  const local = isLocalDatabaseUrl(databaseUrl);
  const target = (process.env.NOISIA_REMOTE_DATABASE_TARGET ?? "").trim().toLowerCase();
  if (!local) {
    if (target !== "preview" && target !== "staging") {
      throw new Error("Remote semantic candidate rehearsal requires a confirmed preview or staging target.");
    }
    if (databaseUrlLooksProductionLike(databaseUrl)) {
      throw new Error("Refusing a production-like DATABASE_URL for semantic candidate rehearsal.");
    }
    if (process.env[ALLOW_REMOTE_ENV] !== "true") {
      throw new Error(`${ALLOW_REMOTE_ENV}=true is required for remote inspection.`);
    }
    requireSafeDatabaseReadTarget(databaseUrl, {
      operation: "inspect Signal semantic Review candidates",
      allowRemoteEnv: ALLOW_REMOTE_ENV
    });
    if (process.env[EXPECTED_FINGERPRINT_ENV] !== fingerprint) {
      throw new Error(`${EXPECTED_FINGERPRINT_ENV} must match the audited target fingerprint.`);
    }
  }
  if (mode === "apply") {
    if (process.env[APPLY_APPROVAL_ENV] !== "true") {
      throw new Error(`${APPLY_APPROVAL_ENV}=true is required for candidate creation.`);
    }
    if (!local) {
      if (process.env[ISOLATED_TARGET_ENV] !== "true") {
        throw new Error(`${ISOLATED_TARGET_ENV}=true is required for remote candidate creation.`);
      }
      if (process.env[RESTORE_VERIFIED_ENV] !== "true") {
        throw new Error(`${RESTORE_VERIFIED_ENV}=true is required after checking a current restore point.`);
      }
      const restoreReference = process.env[RESTORE_REFERENCE_ENV]?.trim() ?? "";
      if (restoreReference.length < 8) {
        throw new Error(`${RESTORE_REFERENCE_ENV} must identify the verified restore point.`);
      }
      if (process.env[NO_APP_CONNECTIONS_ENV] !== "true") {
        throw new Error(`${NO_APP_CONNECTIONS_ENV}=true is required after checking Workers and Studio.`);
      }
      requireSafeDatabaseWriteTarget(databaseUrl, {
        operation: "create pending Signal semantic Review candidates",
        allowRemoteEnv: ALLOW_REMOTE_ENV
      });
    }
  }
  return local ? "local" : target;
}

async function resolveWorkspace(client: pg.Client, brandSlug: string) {
  const result = await client.query<{
    workspace_id: string;
    brand_id: string;
    brand_slug: string;
    organization_id: string;
  }>(`
    SELECT workspace.id::text AS workspace_id, brand.id::text AS brand_id,
      brand.slug AS brand_slug, workspace.organization_id::text
    FROM brands brand
    JOIN signal_workspaces workspace ON workspace.brand_id = brand.id
    WHERE lower(brand.slug) = lower($1)
      AND brand.status = 'active' AND workspace.status = 'active'
    ORDER BY workspace.id
  `, [brandSlug]);
  if (result.rows.length !== 1) {
    throw new Error(`Semantic candidate selector resolved ${result.rows.length} workspaces; expected exactly one.`);
  }
  return result.rows[0]!;
}

async function inspectSchema(client: pg.Client) {
  const migrationPath = join(dirname(dirname(fileURLToPath(import.meta.url))), "migrations", "0064_signal_semantic_scope_hardening.sql");
  const localChecksum = sha256(await readFile(migrationPath, "utf8"));
  if (localChecksum !== AUTHORIZED_0064_CHECKSUM) {
    throw new Error("Local 0064 checksum differs from the authorized rehearsal artifact.");
  }
  const states: boolean[] = [];
  for (const sentinel of SENTINELS) {
    states.push(await inspectSentinel(client, sentinel));
  }
  const missing = SENTINELS.filter((_sentinel, index) => !states[index]).map(sentinelLabel);
  const ledger = await client.query<{
    checksum_sha256: string;
    disposition: string;
    applied_at: string;
  }>(`
    SELECT checksum_sha256, disposition, applied_at::text
    FROM signal_workspace_data_plane_migration_ledger
    WHERE migration_name = '0064_signal_semantic_scope_hardening.sql'
  `);
  const ledgerRow = ledger.rows[0] ?? null;
  if (missing.length > 0 || !ledgerRow || ledgerRow.checksum_sha256 !== localChecksum) {
    throw new Error(`0064 schema verification failed; missing=${missing.join(",") || "none"}.`);
  }
  return {
    checksum: localChecksum,
    sentinels_present: SENTINELS.length - missing.length,
    sentinels_expected: SENTINELS.length,
    missing,
    ledger: {
      row_count: ledger.rows.length,
      checksum_matches: ledgerRow.checksum_sha256 === localChecksum,
      disposition: ledgerRow.disposition,
      applied_at: ledgerRow.applied_at
    }
  };
}

async function inspectSentinel(client: pg.Client, sentinel: Sentinel) {
  if (sentinel.kind === "table") {
    return Boolean((await client.query<{ present: boolean }>(
      "SELECT to_regclass('public.' || $1) IS NOT NULL AS present", [sentinel.name]
    )).rows[0]?.present);
  }
  if (sentinel.kind === "index") {
    return Boolean((await client.query<{ present: boolean }>(
      "SELECT to_regclass('public.' || $1) IS NOT NULL AS present", [sentinel.name]
    )).rows[0]?.present);
  }
  if (sentinel.kind === "column") {
    return Boolean((await client.query<{ present: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
      ) AS present
    `, [sentinel.relation, sentinel.name])).rows[0]?.present);
  }
  if (sentinel.kind === "constraint") {
    return Boolean((await client.query<{ present: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = to_regclass('public.' || $1) AND conname = $2
      ) AS present
    `, [sentinel.relation, sentinel.name])).rows[0]?.present);
  }
  if (sentinel.kind === "trigger") {
    return Boolean((await client.query<{ present: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = to_regclass('public.' || $1) AND tgname = $2 AND NOT tgisinternal
      ) AS present
    `, [sentinel.relation, sentinel.name])).rows[0]?.present);
  }
  if (sentinel.kind === "function") {
    return Boolean((await client.query<{ present: boolean }>(
      "SELECT to_regprocedure('public.' || $1) IS NOT NULL AS present", [sentinel.name]
    )).rows[0]?.present);
  }
  if (sentinel.kind !== "function_definition") return false;
  const result = await client.query<{ present: boolean }>(`
    SELECT COALESCE(position($2 in pg_get_functiondef(to_regprocedure('public.' || $1))), 0) > 0 AS present
  `, [sentinel.name, sentinel.contains]);
  return Boolean(result.rows[0]?.present);
}

function sentinelLabel(sentinel: Sentinel) {
  return "relation" in sentinel ? `${sentinel.kind}:${sentinel.relation}.${sentinel.name}` : `${sentinel.kind}:${sentinel.name}`;
}

async function inspectConnections(client: pg.Client) {
  const result = await client.query<{
    other_client_connections: number;
    active_other_client_connections: number;
    named_noisia_connections: number;
    long_running_active_connections: number;
  }>(`
    SELECT
      count(*) FILTER (WHERE backend_type = 'client backend' AND pid <> pg_backend_pid())::int AS other_client_connections,
      count(*) FILTER (WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()
        AND state IS DISTINCT FROM 'idle')::int AS active_other_client_connections,
      count(*) FILTER (WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()
        AND COALESCE(application_name, '') ~* '(noisia|studio|worker|bullmq)')::int AS named_noisia_connections,
      count(*) FILTER (WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()
        AND state IS DISTINCT FROM 'idle'
        AND COALESCE(now() - xact_start, interval '0') > interval '5 minutes')::int AS long_running_active_connections
    FROM pg_stat_activity WHERE datname = current_database()
  `);
  return { ...result.rows[0]!, application_names_redacted: true };
}

async function inspectRunningSyncs(client: pg.Client, workspaceId: string) {
  const result = await client.query<{
    count: number;
    oldest_started_at: string | null;
    newest_started_at: string | null;
    content_digest: string;
  }>(`
    SELECT count(*)::int,
      min(started_at)::text AS oldest_started_at,
      max(started_at)::text AS newest_started_at,
      COALESCE('sha256:' || encode(sha256(convert_to(
        string_agg(concat_ws('|', id, data_source_id, status, started_at,
          finished_at, records_total, records_valid, records_duplicate,
          records_failed), E'\n' ORDER BY id), 'UTF8')), 'hex'), $2) AS content_digest
    FROM source_sync_runs
    WHERE workspace_id = $1::uuid AND status = 'running'
  `, [workspaceId, EMPTY_SHA256]);
  return result.rows[0]!;
}

async function inspectOtherWorkspaces(client: pg.Client, workspaceId: string) {
  const result = await client.query<{ workspace_count: number; content_digest: string }>(`
    WITH content AS (
      SELECT attribution.workspace_id,
        concat_ws('|', 'attribution', attribution.id, attribution.mention_id,
          attribution.attribution_basis, attribution.scope, attribution.entity_type,
          attribution.entity_id, attribution.review_status,
          attribution.eligibility_status, attribution.evidence_hash,
          attribution.semantic_policy_key, attribution.idempotency_key) AS row_value
      FROM signal_mention_attributions attribution
      WHERE attribution.workspace_id <> $1::uuid
      UNION ALL
      SELECT event.workspace_id,
        concat_ws('|', 'review', event.id, event.attribution_id, event.action,
          event.reviewer_user_id, event.rationale_hash, event.idempotency_key)
      FROM signal_mention_attribution_review_events event
      WHERE event.workspace_id <> $1::uuid
      UNION ALL
      SELECT definition.workspace_id,
        concat_ws('|', 'population', definition.id, definition.population_key,
          definition.version, definition.status, definition.definition_hash,
          definition.membership_digest, definition.definition::text)
      FROM signal_population_definitions definition
      WHERE definition.workspace_id <> $1::uuid
        AND definition.definition->>'contract_version'
          = 'signal-operational-primary-brand-semantic-v2'
    )
    SELECT count(DISTINCT workspace.id)::int AS workspace_count,
      COALESCE('sha256:' || encode(sha256(convert_to(
        string_agg(content.row_value, E'\n' ORDER BY content.workspace_id, content.row_value),
        'UTF8')), 'hex'), $2) AS content_digest
    FROM signal_workspaces workspace
    LEFT JOIN content ON content.workspace_id = workspace.id
    WHERE workspace.id <> $1::uuid AND workspace.status = 'active'
  `, [workspaceId, EMPTY_SHA256]);
  return result.rows[0]!;
}

function protectedStateDigest(args: {
  schemaChecksum: string;
  workspaceKey: string;
  invariants: Awaited<ReturnType<typeof inspectSignalSemanticReviewInvariantsV1>>;
  syncs: Awaited<ReturnType<typeof inspectRunningSyncs>>;
  otherWorkspaces: Awaited<ReturnType<typeof inspectOtherWorkspaces>>;
}) {
  return sha256(stableJson({
    schema_checksum: args.schemaChecksum,
    workspace_key: args.workspaceKey,
    invariants: args.invariants,
    running_syncs: args.syncs,
    other_workspaces: args.otherWorkspaces
  }));
}

function assertApplyGuards(args: {
  mode: Mode;
  connections: Awaited<ReturnType<typeof inspectConnections>>;
  syncs: Awaited<ReturnType<typeof inspectRunningSyncs>>;
  invariants: Awaited<ReturnType<typeof inspectSignalSemanticReviewInvariantsV1>>;
}) {
  if (args.connections.named_noisia_connections !== 0) {
    throw new Error("Named Studio, Workers or BullMQ connections are present.");
  }
  if (args.connections.long_running_active_connections !== 0) {
    throw new Error("A long-running active database connection blocks candidate creation.");
  }
  if (args.mode === "apply" && args.syncs.count > 0 && process.env[STALE_SYNC_ACK_ENV] !== "true") {
    throw new Error(`${STALE_SYNC_ACK_ENV}=true is required to acknowledge the known stale sync without modifying it.`);
  }
  if (args.invariants.v2_definition_count !== 1) throw new Error("Expected exactly one Operational V2 draft definition.");
  if (args.invariants.v2_pointer_count !== 0 || args.invariants.v2_membership_count !== 0) {
    throw new Error("Operational V2 is not isolated from pointers and memberships.");
  }
  if (args.invariants.review_event_count !== 0 || args.invariants.approved_semantic_count !== 0) {
    throw new Error("Candidate subgate cannot run after semantic decisions or approvals.");
  }
}

function assertProtectedStateUnchanged(
  before: Awaited<ReturnType<typeof inspectSignalSemanticReviewInvariantsV1>>,
  after: Awaited<ReturnType<typeof inspectSignalSemanticReviewInvariantsV1>>,
  createdCount: number
) {
  const unchanged = [
    "v1_definition_digest",
    "v1_pointer_digest",
    "v1_membership_count",
    "v1_membership_digest",
    "v1_active_membership_count",
    "v1_active_membership_digest",
    "source_intent_count",
    "source_intent_digest",
    "approved_semantic_count",
    "review_event_count",
    "v2_definition_count",
    "v2_pointer_count",
    "v2_membership_count",
    "included_root_count",
    "candidate_digest"
  ] as const;
  for (const key of unchanged) {
    if (before[key] !== after[key]) throw new Error(`Protected candidate state changed: ${key}.`);
  }
  if (after.semantic_assertion_count !== before.semantic_assertion_count + createdCount) {
    throw new Error("Pending semantic assertion count does not reconcile with candidate creation.");
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required and must be explicit.");
  const mode = readMode();
  const brandSlug = process.env[BRAND_SLUG_ENV]?.trim() ?? "";
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/u.test(brandSlug)) {
    throw new Error(`${BRAND_SLUG_ENV} must select exactly one brand slug.`);
  }
  if (!isLocalDatabaseUrl(databaseUrl) && mode === "apply" && brandSlug !== "laika") {
    throw new Error("Remote candidate apply is intentionally restricted to brand_slug=laika.");
  }
  const fingerprint = targetFingerprint(databaseUrl);
  const target = assertTarget(databaseUrl, mode, fingerprint);
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: getDatabaseSslConfig(),
    application_name: "noisia-signal-semantic-candidate-rehearsal"
  });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query("SET statement_timeout = '15min'");
    await client.query("SET lock_timeout = '15s'");
    await client.query(mode === "apply" ? "BEGIN" : "BEGIN TRANSACTION READ ONLY");
    transactionOpen = true;
    if (mode === "apply") {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [LOCK_KEY]);
    }
    const schema = await inspectSchema(client);
    const workspace = await resolveWorkspace(client, brandSlug);
    const workspaceKey = sha256(workspace.workspace_id);
    const brandKey = sha256(workspace.brand_id);
    const organizationKey = sha256(workspace.organization_id);
    const connections = await inspectConnections(client);
    const syncsBefore = await inspectRunningSyncs(client, workspace.workspace_id);
    const othersBefore = await inspectOtherWorkspaces(client, workspace.workspace_id);
    const before = await inspectSignalSemanticReviewInvariantsV1(client, workspace.workspace_id);
    assertApplyGuards({ mode, connections, syncs: syncsBefore, invariants: before });
    const stateDigestBefore = protectedStateDigest({
      schemaChecksum: schema.checksum,
      workspaceKey,
      invariants: before,
      syncs: syncsBefore,
      otherWorkspaces: othersBefore
    });
    const expectedState = process.env[EXPECTED_STATE_ENV]?.trim() ?? "";
    if (mode === "apply" && expectedState !== stateDigestBefore) {
      throw new Error(`${EXPECTED_STATE_ENV} must match the dry-run protected state digest.`);
    }

    const generated = await generateSignalSemanticCandidatesV1(client, {
      workspace_id: workspace.workspace_id,
      mode: mode === "apply" ? "apply" : "dry-run"
    });
    const queue = await loadSignalSemanticReviewQueueV1(client, {
      workspace_id: workspace.workspace_id,
      limit: 100
    });
    if (queue.reconciliation.included_root_count !== generated.included_root_count) {
      throw new Error("Included Review queue does not reconcile with candidate generation.");
    }
    if (generated.conflict_count !== 0) {
      throw new Error("Candidate generation found a current assertion conflict; Review is required before retry.");
    }
    const after = await inspectSignalSemanticReviewInvariantsV1(client, workspace.workspace_id);
    const syncsAfter = await inspectRunningSyncs(client, workspace.workspace_id);
    const othersAfter = await inspectOtherWorkspaces(client, workspace.workspace_id);
    assertProtectedStateUnchanged(before, after, generated.created_count);
    if (syncsAfter.content_digest !== syncsBefore.content_digest || syncsAfter.count !== syncsBefore.count) {
      throw new Error("Candidate generation changed the known sync state.");
    }
    if (othersAfter.content_digest !== othersBefore.content_digest) {
      throw new Error("Candidate generation changed another workspace.");
    }
    if (mode === "verify") {
      if (after.semantic_assertion_count !== generated.candidate_assertion_count) {
        throw new Error("Verify requires one persisted pending assertion per deterministic candidate.");
      }
      const invalid = await client.query<{ count: number }>(`
        SELECT count(*)::int
        FROM signal_mention_attributions attribution
        WHERE attribution.workspace_id = $1::uuid
          AND attribution.attribution_basis = 'mention_semantic'
          AND (
            attribution.review_status <> 'pending'
            OR attribution.eligibility_status <> 'candidate'
            OR attribution.is_current = false
            OR attribution.semantic_policy_key <> 'signal-semantic-governed-identity'
            OR attribution.policy_version <> '1'
          )
      `, [workspace.workspace_id]);
      if (invalid.rows[0]?.count !== 0) {
        throw new Error("Verify found a semantic assertion outside pending/candidate policy v1.");
      }
    }

    const stateDigestAfter = protectedStateDigest({
      schemaChecksum: schema.checksum,
      workspaceKey,
      invariants: after,
      syncs: syncsAfter,
      otherWorkspaces: othersAfter
    });
    const publicSamples = queue.records
      .flatMap((item) => item.proposed_assertions.map((candidate) => ({ item, candidate })))
      .slice(0, 12)
      .map(({ item, candidate }) => ({
        sample_key: sha256(item.mention_id),
        scope: candidate.scope,
        confidence_band: candidate.confidence_band,
        evidence_kind: candidate.evidence_kind,
        evidence_hash: candidate.evidence_hash
      }));
    const unresolvedSamples = queue.records
      .filter((item) => item.state === "unresolved" || item.state === "needs_context")
      .slice(0, 12)
      .map((item) => ({ sample_key: sha256(item.mention_id), state: item.state }));
    if (mode === "apply") {
      await client.query("COMMIT");
      transactionOpen = false;
    } else {
      await client.query("ROLLBACK");
      transactionOpen = false;
    }
    console.log(JSON.stringify({
      ok: true,
      runner_version: "signal-semantic-candidate-rehearsal-v1",
      mode,
      target,
      target_fingerprint: fingerprint,
      selection: { kind: "brand_slug", brand_slug: workspace.brand_slug },
      resolved_scope: {
        workspace_key: workspaceKey,
        brand_key: brandKey,
        organization_key: organizationKey,
        workspace_count: 1
      },
      schema,
      restore_guard: {
        required_for_apply: target !== "local",
        verified: mode === "apply" && target !== "local"
          ? process.env[RESTORE_VERIFIED_ENV] === "true"
          : null,
        reference_redacted: true
      },
      app_connections: connections,
      running_syncs: {
        ...syncsAfter,
        rows_modified: false
      },
      protected_state_digest_before: stateDigestBefore,
      protected_state_digest_after: stateDigestAfter,
      before,
      generation: { ...generated, workspace_id: undefined },
      after,
      public_redacted_samples: publicSamples,
      unresolved_redacted_samples: unresolvedSamples,
      other_workspaces: {
        workspace_count: othersAfter.workspace_count,
        content_digest_before: othersBefore.content_digest,
        content_digest_after: othersAfter.content_digest,
        changed: othersBefore.content_digest !== othersAfter.content_digest
      },
      writes_performed: mode === "apply" && generated.created_count > 0,
      review_events_created: 0,
      approvals_created: 0,
      v2_pointer_created: false,
      v2_memberships_created: 0,
      shadow_or_cutover_executed: false,
      text_or_pii_emitted: false
    }, null, 2));
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

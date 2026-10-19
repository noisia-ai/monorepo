import { createHash } from "node:crypto";

import pg from "pg";

import { signalWorkspaceContentHashes } from "./signal-workspace-content-hashes.js";

import {
  databaseUrlLooksProductionLike,
  getDatabaseSslConfig,
  isLocalDatabaseUrl,
  requireSafeDatabaseReadTarget,
  requireSafeDatabaseWriteTarget
} from "../seeds/connection.js";
import { requireEnv } from "../seeds/env.js";

const MODE_ENV = "NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_MODE";
const APPROVAL_ENV = "NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_APPROVED";
const ANALYZE_APPROVAL_ENV = "NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_ANALYZE_APPROVED";
const ALLOW_REMOTE_ENV = "NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_ALLOW_REMOTE";
const ISOLATED_TARGET_ENV = "NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_ISOLATED_TARGET_CONFIRMED";
const TARGET_FINGERPRINT_ENV = "NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_TARGET_FINGERPRINT";
const RESTORE_REFERENCE_ENV = "NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_RESTORE_REFERENCE";
const RESTORE_VERIFIED_ENV = "NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_RESTORE_VERIFIED";
const BRAND_SLUG_ENV = "NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_BRAND_SLUG";
const WORKSPACE_ID_ENV = "NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_WORKSPACE_ID";
const ALL_WORKSPACES_ENV = "NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_ALL_WORKSPACES";
const ALL_WORKSPACES_APPROVAL_ENV = "NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_BACKFILL_ALL_WORKSPACES_APPROVED";
const RUNNING_SYNCS_ACK_ENV = "NOISIA_SIGNAL_WORKSPACE_DATA_PLANE_RUNNING_SYNCS_ACKNOWLEDGED";
const LOCK_KEY = "noisia:signal-workspace-data-plane:0059-0063";

type Mode = "dry-run" | "apply" | "verify" | "analyze";
type BackfillSelection =
  | { kind: "brand_slug"; brandSlug: string }
  | { kind: "workspace_id"; workspaceId: string }
  | { kind: "all_workspaces" };
type WorkspaceTarget = { workspace_id: string; brand_id: string; brand_slug: string };
function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function targetFingerprint(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  return sha256([
    parsed.protocol,
    parsed.hostname.toLowerCase(),
    parsed.port || "5432",
    parsed.pathname.replace(/^\//, ""),
    parsed.username
  ].join("|"));
}

function readMode(): Mode {
  const value = (process.env[MODE_ENV] ?? "dry-run").trim().toLowerCase();
  if (value === "dry-run" || value === "apply" || value === "verify" || value === "analyze") {
    return value;
  }
  throw new Error(`${MODE_ENV} must be dry-run, apply, verify or analyze.`);
}

function readSelection(mode: Mode): BackfillSelection {
  const brandSlug = process.env[BRAND_SLUG_ENV]?.trim() ?? "";
  const workspaceId = process.env[WORKSPACE_ID_ENV]?.trim() ?? "";
  const allWorkspaces = process.env[ALL_WORKSPACES_ENV] === "true";
  const allWorkspacesApproved = process.env[ALL_WORKSPACES_APPROVAL_ENV] === "true";
  const selected = Number(Boolean(brandSlug)) + Number(Boolean(workspaceId)) + Number(allWorkspaces);
  if (selected !== 1) {
    throw new Error(
      `Select exactly one scope with ${BRAND_SLUG_ENV}, ${WORKSPACE_ID_ENV}, or ${ALL_WORKSPACES_ENV}=true.`
    );
  }
  if (allWorkspaces && !allWorkspacesApproved) {
    throw new Error(`${ALL_WORKSPACES_APPROVAL_ENV}=true is required for all-workspace mode.`);
  }
  if (!allWorkspaces && allWorkspacesApproved) {
    throw new Error(`${ALL_WORKSPACES_APPROVAL_ENV}=true is only valid with ${ALL_WORKSPACES_ENV}=true.`);
  }
  if (mode === "analyze" && !allWorkspaces) {
    throw new Error(
      `${MODE_ENV}=analyze is clone-wide and requires ${ALL_WORKSPACES_ENV}=true with ${ALL_WORKSPACES_APPROVAL_ENV}=true.`
    );
  }
  if (brandSlug) {
    if (!/^[a-z0-9][a-z0-9-]{0,127}$/iu.test(brandSlug)) {
      throw new Error(`${BRAND_SLUG_ENV} is not a valid brand slug.`);
    }
    return { kind: "brand_slug", brandSlug };
  }
  if (workspaceId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(workspaceId)) {
      throw new Error(`${WORKSPACE_ID_ENV} must be a UUID.`);
    }
    return { kind: "workspace_id", workspaceId };
  }
  return { kind: "all_workspaces" };
}

function assertTarget(databaseUrl: string, mode: Mode, fingerprint: string) {
  const local = isLocalDatabaseUrl(databaseUrl);
  const target = (process.env.NOISIA_REMOTE_DATABASE_TARGET ?? "").trim().toLowerCase();
  if (!local) {
    if (target !== "preview" && target !== "staging") {
      throw new Error("Remote backfill requires a real preview or staging target.");
    }
    if (databaseUrlLooksProductionLike(databaseUrl)) {
      throw new Error("Refusing a production-like DATABASE_URL for workspace backfill.");
    }
    if (process.env[ALLOW_REMOTE_ENV] !== "true") {
      throw new Error(`${ALLOW_REMOTE_ENV}=true is required for remote backfill inspection.`);
    }
    requireSafeDatabaseReadTarget(databaseUrl, {
      operation: "inspect Signal workspace data-plane backfill",
      allowRemoteEnv: ALLOW_REMOTE_ENV
    });
  }
  if (mode === "apply" || mode === "analyze") {
    const approvalEnv = mode === "apply" ? APPROVAL_ENV : ANALYZE_APPROVAL_ENV;
    if (process.env[approvalEnv] !== "true") {
      throw new Error(`${approvalEnv}=true is required for ${mode} mode.`);
    }
    if (!local) {
      if (process.env[ISOLATED_TARGET_ENV] !== "true") {
        throw new Error(`${ISOLATED_TARGET_ENV}=true is required for remote ${mode} mode.`);
      }
      if (process.env[TARGET_FINGERPRINT_ENV] !== fingerprint) {
        throw new Error(`${TARGET_FINGERPRINT_ENV} must match this backfill preflight.`);
      }
      const restoreReference = process.env[RESTORE_REFERENCE_ENV]?.trim() ?? "";
      if (restoreReference.length < 8) {
        throw new Error(`${RESTORE_REFERENCE_ENV} must identify a non-empty restore point.`);
      }
      if (process.env[RESTORE_VERIFIED_ENV] !== "true") {
        throw new Error(`${RESTORE_VERIFIED_ENV}=true is required after verifying the restore point.`);
      }
      requireSafeDatabaseWriteTarget(databaseUrl, {
        operation: "reconcile Signal workspace data-plane backfill",
        allowRemoteEnv: ALLOW_REMOTE_ENV
      });
    }
  }
  return local ? "local" : target;
}

async function assertSchema(client: pg.Client) {
  const result = await client.query<{
    complete: boolean;
    provenance_function: boolean;
    reconcile_function: boolean;
  }>(`
    SELECT
      to_regclass('public.signal_mention_import_memberships') IS NOT NULL
        AND to_regclass('public.signal_mention_attributions') IS NOT NULL
        AND to_regclass('public.signal_population_memberships') IS NOT NULL
        AND to_regclass('public.signal_workspace_population_pointers') IS NOT NULL
        AS complete,
      to_regprocedure('public.record_signal_mention_import_provenance(uuid,uuid)')
        IS NOT NULL AS provenance_function,
      to_regprocedure('public.reconcile_signal_operational_population(uuid)')
        IS NOT NULL AS reconcile_function
  `);
  const row = result.rows[0];
  if (!row?.complete || !row.provenance_function || !row.reconcile_function) {
    throw new Error("Backfill requires a verified 0059 schema before execution.");
  }
}

async function resolveTargets(client: pg.Client, selection: BackfillSelection) {
  let result: pg.QueryResult<WorkspaceTarget>;
  if (selection.kind === "brand_slug") {
    result = await client.query<WorkspaceTarget>(`
      SELECT workspace.id::text AS workspace_id,
             brand.id::text AS brand_id,
             brand.slug AS brand_slug
      FROM brands brand
      JOIN signal_workspaces workspace ON workspace.brand_id = brand.id
      WHERE lower(brand.slug) = lower($1)
      ORDER BY workspace.id
    `, [selection.brandSlug]);
  } else if (selection.kind === "workspace_id") {
    result = await client.query<WorkspaceTarget>(`
      SELECT workspace.id::text AS workspace_id,
             brand.id::text AS brand_id,
             brand.slug AS brand_slug
      FROM signal_workspaces workspace
      JOIN brands brand ON brand.id = workspace.brand_id
      WHERE workspace.id = $1::uuid
    `, [selection.workspaceId]);
  } else {
    result = await client.query<WorkspaceTarget>(`
      SELECT workspace.id::text AS workspace_id,
             brand.id::text AS brand_id,
             brand.slug AS brand_slug
      FROM signal_workspaces workspace
      JOIN brands brand ON brand.id = workspace.brand_id
      ORDER BY workspace.id
    `);
  }
  if (result.rows.length === 0) {
    throw new Error("Backfill selection resolved no workspace.");
  }
  if (selection.kind !== "all_workspaces" && result.rows.length !== 1) {
    throw new Error("Backfill selection must resolve exactly one workspace.");
  }
  return result.rows;
}

async function summarize(client: pg.Client, targets: WorkspaceTarget[]) {
  const workspaceIds = targets.map((target) => target.workspace_id);
  const brandIds = targets.map((target) => target.brand_id);
  const result = await client.query<{
    workspaces: number;
    sources: number;
    imports: number;
    mentions: number;
    canonical_roots: number;
    aliases: number;
    import_memberships: number;
    attributions: number;
    active_operational_memberships: number;
    unresolved_source_workspace: number;
    unresolved_import_workspace: number;
    unresolved_mention_workspace: number;
    unresolved_canonical_identity: number;
    missing_import_membership: number;
    running_syncs: number;
  }>(`
    SELECT
        (SELECT count(*)::int FROM signal_workspaces
          WHERE id = ANY($1::uuid[])) AS workspaces,
        (SELECT count(*)::int FROM data_sources
          WHERE workspace_id = ANY($1::uuid[])) AS sources,
        (SELECT count(*)::int FROM import_batches
          WHERE workspace_id = ANY($1::uuid[])) AS imports,
        (SELECT count(*)::int FROM mentions
          WHERE workspace_id = ANY($1::uuid[])) AS mentions,
        (SELECT count(*)::int FROM mentions
          WHERE workspace_id = ANY($1::uuid[]) AND canonical_mention_id = id) AS canonical_roots,
        (SELECT count(*)::int FROM mentions
          WHERE workspace_id = ANY($1::uuid[]) AND canonical_mention_id <> id) AS aliases,
        (SELECT count(*)::int FROM signal_mention_import_memberships
          WHERE workspace_id = ANY($1::uuid[])) AS import_memberships,
        (SELECT count(*)::int FROM signal_mention_attributions
          WHERE workspace_id = ANY($1::uuid[])) AS attributions,
        (SELECT count(*)::int
         FROM signal_workspace_population_pointers pointer
         JOIN signal_population_memberships membership
           ON membership.population_id = pointer.population_id
          AND membership.workspace_id = pointer.workspace_id
         WHERE pointer.purpose = 'operational'
           AND pointer.workspace_id = ANY($1::uuid[])
           AND membership.membership_status = 'included'
           AND membership.removed_at IS NULL) AS active_operational_memberships,
        (SELECT count(*)::int FROM data_sources
          WHERE workspace_id IS NULL AND brand_id = ANY($2::uuid[]))
          AS unresolved_source_workspace,
        (SELECT count(*)::int
         FROM import_batches batch
         JOIN study_corpora corpus ON corpus.id = batch.study_corpus_id
         WHERE batch.workspace_id IS NULL AND corpus.brand_id = ANY($2::uuid[]))
          AS unresolved_import_workspace,
        (SELECT count(*)::int
         FROM mentions mention
         JOIN study_corpora corpus ON corpus.id = mention.study_corpus_id
         WHERE mention.workspace_id IS NULL AND corpus.brand_id = ANY($2::uuid[]))
          AS unresolved_mention_workspace,
        (SELECT count(*)::int FROM mentions
         WHERE workspace_id = ANY($1::uuid[])
           AND (canonical_mention_id IS NULL OR NOT EXISTS (
           SELECT 1 FROM mentions root
           WHERE root.id = mentions.canonical_mention_id
             AND root.workspace_id = mentions.workspace_id
             AND root.canonical_mention_id = root.id
         ))) AS unresolved_canonical_identity,
        (SELECT count(*)::int
         FROM mentions mention
         WHERE mention.workspace_id = ANY($1::uuid[])
           AND mention.source_file_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM signal_mention_import_memberships membership
             WHERE membership.mention_id = mention.canonical_mention_id
               AND membership.import_batch_id = mention.source_file_id
           )) AS missing_import_membership,
        (SELECT count(*)::int FROM source_sync_runs
          WHERE workspace_id = ANY($1::uuid[]) AND status = 'running') AS running_syncs
  `, [workspaceIds, brandIds]);
  const row = result.rows[0];
  if (!row) throw new Error("Backfill summary returned no row.");
  return { ...row, content_hashes: await signalWorkspaceContentHashes(client, targets) };
}

async function applyWorkspace(client: pg.Client, workspaceId: string) {
  await client.query("BEGIN");
  try {
    const provenance = await client.query<{ count: number }>(`
      WITH pairs AS (
        SELECT DISTINCT mention.canonical_mention_id AS mention_id,
          mention.source_file_id AS import_batch_id
        FROM mentions mention
        WHERE mention.workspace_id = $1::uuid
          AND mention.source_file_id IS NOT NULL
      ), persisted AS (
        SELECT record_signal_mention_import_provenance(
          pairs.mention_id,
          pairs.import_batch_id
        )
        FROM pairs
      )
      SELECT count(*)::int AS count FROM persisted
    `, [workspaceId]);
    const reconciled = await client.query<{ count: number }>(`
      SELECT reconcile_signal_operational_population($1::uuid) AS count
    `, [workspaceId]);
    await client.query("COMMIT");
    return {
      workspace_key: sha256(workspaceId),
      provenance_pairs: provenance.rows[0]?.count ?? 0,
      reconciled_mentions: reconciled.rows[0]?.count ?? 0
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function applyBackfill(
  client: pg.Client,
  targets: WorkspaceTarget[],
  runningSyncs: number
) {
  if (runningSyncs > 0 && process.env[RUNNING_SYNCS_ACK_ENV] !== "true") {
    throw new Error(
      `Found ${runningSyncs} running sync(s). ${RUNNING_SYNCS_ACK_ENV}=true is allowed only on an isolated clone with no workers.`
    );
  }
  await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [LOCK_KEY]);
  try {
    const results = [];
    for (const target of targets) {
      results.push(await applyWorkspace(client, target.workspace_id));
    }
    return results;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [LOCK_KEY]);
  }
}

async function analyzeOperationalTables(client: pg.Client) {
  const tables = [
    "data_sources",
    "import_batches",
    "source_sync_runs",
    "mentions",
    "signal_mention_import_memberships",
    "signal_mention_study_memberships",
    "signal_mention_attributions",
    "signal_population_definitions",
    "signal_population_memberships",
    "signal_data_watermarks",
    "metric_materializations",
    "signal_operational_shadow_requests",
    "signal_operational_serving_shadow_results"
  ];
  await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [LOCK_KEY]);
  try {
    await client.query(`ANALYZE ${tables.map((table) => `\"${table}\"`).join(", ")}`);
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [LOCK_KEY]);
  }
  return tables;
}

async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const mode = readMode();
  const selection = readSelection(mode);
  const fingerprint = targetFingerprint(databaseUrl);
  const target = assertTarget(databaseUrl, mode, fingerprint);
  const client = new pg.Client({ connectionString: databaseUrl, ssl: getDatabaseSslConfig() });
  await client.connect();
  let readOnlyTransaction = false;
  try {
    await client.query("SET statement_timeout = '30min'");
    await client.query("SET lock_timeout = '15s'");
    if (mode === "dry-run" || mode === "verify") {
      await client.query("BEGIN TRANSACTION READ ONLY");
      readOnlyTransaction = true;
    }
    await assertSchema(client);
    const targets = await resolveTargets(client, selection);
    const before = await summarize(client, targets);
    const workspaceResults = mode === "apply"
      ? await applyBackfill(client, targets, before.running_syncs)
      : [];
    const analyzedTables = mode === "analyze" ? await analyzeOperationalTables(client) : [];
    const after = await summarize(client, targets);
    const unresolved = after.unresolved_source_workspace
      + after.unresolved_import_workspace
      + after.unresolved_mention_workspace
      + after.unresolved_canonical_identity
      + after.missing_import_membership;
    if (mode === "verify" && unresolved !== 0) {
      throw new Error(`Backfill verification found ${unresolved} unresolved ownership rows.`);
    }
    if (readOnlyTransaction) {
      await client.query("ROLLBACK");
      readOnlyTransaction = false;
    }
    console.log(JSON.stringify({
      ok: unresolved === 0,
      mode,
      target,
      target_fingerprint: fingerprint,
      selection: selection.kind === "brand_slug"
        ? { kind: selection.kind, brand_slug: selection.brandSlug }
        : selection.kind === "workspace_id"
          ? { kind: selection.kind, workspace_key: sha256(selection.workspaceId) }
          : { kind: selection.kind },
      affected_workspaces: targets.map((target) => ({
        workspace_key: sha256(target.workspace_id),
        brand_key: sha256(target.brand_id),
        brand_slug: target.brand_slug
      })),
      writes_performed: mode === "apply" || mode === "analyze",
      before,
      workspace_results: workspaceResults,
      analyzed_tables: analyzedTables,
      after,
      content_changed:
        before.content_hashes.aggregate !== after.content_hashes.aggregate,
      unresolved_count: unresolved,
      shadow_or_cutover_executed: false
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

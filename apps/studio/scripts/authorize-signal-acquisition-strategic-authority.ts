import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { config as loadEnv } from "dotenv";
import pg from "pg";

import type { SignalSemanticBenchmarkFrozenCorpusV2 } from
  "../src/lib/data-os/signal-semantic-benchmark-export";

const ROOT = resolve(import.meta.dirname, "../../..");
const MODE = process.argv[2];
const TARGET = process.env.NOISIA_REMOTE_DATABASE_TARGET;
const APPLY_APPROVED = process.env.NOISIA_SIGNAL_10C2_STRATEGIC_AUTHORITY_APPROVED === "true";
const RESTORE_AT = process.env.NOISIA_SIGNAL_10C2_RESTORE_POINT_AT;
const RESTORE_HASH = process.env.NOISIA_SIGNAL_10C2_RESTORE_POINT_HASH;
const EXPECTED = {
  direct: "sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19",
  pooler: "sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815",
  project: "sha256:030c5a33e3b28881c4d77983a6049bbfa16c995da232454081cbccfcfa78aa32"
} as const;
const MIGRATION = {
  ordinal: 89,
  filename: "0089_signal_acquisition_strategic_authority.sql",
  checksum: "sha256:a162cff1dd45ff7a2374db81c154db62401904150537cb6d9b743c44cfa05253"
} as const;

if (!new Set(["preflight", "apply", "verify"]).has(MODE ?? "")) {
  throw new Error("Mode must be preflight, apply or verify.");
}
if (TARGET !== "noisia-staging") throw new Error("Only noisia-staging is authorized.");
if (MODE === "apply") {
  if (!APPLY_APPROVED) throw new Error("Strategic authority apply requires explicit approval.");
  if (!RESTORE_AT || !RESTORE_HASH?.match(/^sha256:[0-9a-f]{64}$/u)) {
    throw new Error("A fresh verified restore point is required.");
  }
  const ageHours = (Date.now() - Date.parse(RESTORE_AT)) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours < 0 || ageHours > 24) {
    throw new Error("The verified restore point must be less than 24 hours old.");
  }
}

loadEnv({ path: resolve(ROOT, "apps/studio/.env.local"), override: false });
const poolerUrl = required(process.env.DATABASE_URL, "DATABASE_URL");
const supabaseUrl = required(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  "SUPABASE_URL");
const directUrl = deriveDirect(poolerUrl);
if (fingerprint(poolerUrl) !== EXPECTED.pooler || fingerprint(directUrl) !== EXPECTED.direct
  || projectHash(poolerUrl, "pooler") !== EXPECTED.project
  || projectHash(directUrl, "direct") !== EXPECTED.project
  || sha256(new URL(supabaseUrl).hostname.split(".")[0] ?? "") !== EXPECTED.project) {
  throw new Error("Direct, pooler and storage do not identify noisia-staging.");
}

const migrationPath = resolve(ROOT, "infrastructure/db/migrations", MIGRATION.filename);
const migrationSql = await readFile(migrationPath, "utf8");
if (sha256(migrationSql) !== MIGRATION.checksum) throw new Error("0089 checksum mismatch.");
const planPath = resolve(ROOT, "tools/signal-semantic-lab/config/benchmark-plan-10c2-v3.json");
const planBody = await readFile(planPath, "utf8");
const plan = JSON.parse(planBody) as {
  contract_version?: string;execution_authorized?: boolean;ten_d_authorized?: boolean;
  corpus?: SignalSemanticBenchmarkFrozenCorpusV2;
};
if (plan.contract_version !== "signal-local-modeling-benchmark-plan-v3"
  || plan.execution_authorized !== false || plan.ten_d_authorized !== false || !plan.corpus) {
  throw new Error("The sealed 10C.2 V3 plan is unavailable.");
}
const workspaceName = required(process.env.NOISIA_SIGNAL_SEMANTIC_BENCHMARK_WORKSPACE_NAME,
  "NOISIA_SIGNAL_SEMANTIC_BENCHMARK_WORKSPACE_NAME");
const outputDir = resolve(process.env.NOISIA_SIGNAL_SEMANTIC_BENCHMARK_OUTPUT_DIR
  ?? resolve(ROOT, ".data/signal-semantic-lab/backend-10c2b"));
const dataRoot = resolve(ROOT, ".data");
if (outputDir !== dataRoot && !outputDir.startsWith(`${dataRoot}/`)) {
  throw new Error("Evidence output must remain below .data.");
}
await mkdir(outputDir, { recursive: true, mode: 0o700 });
await chmod(outputDir, 0o700);

const direct = new pg.Client({ connectionString: directUrl, ssl: { rejectUnauthorized: false },
  application_name: "noisia-signal-10c2b-authority" });
await direct.connect();
let evidence: Record<string, unknown>;
let evidenceKind = MODE;
try {
  await direct.query("SET statement_timeout='15min'");
  await direct.query("SET lock_timeout='30s'");
  const before = await inspect(direct);
  const peer = await inspectPeer(poolerUrl);
  assertPeer(before, peer);
  if (before.migration_state === "partial") throw new Error("0089 is partially applied or divergent.");
  if (MODE === "preflight") {
    evidence = { mode: MODE, writes_performed: false, before };
  } else if (MODE === "verify") {
    if (before.migration_state !== "complete") throw new Error("0089 is not applied.");
    const authority = await verifyAuthorityReadOnly({
      client: direct,workspaceName,corpus: plan.corpus
    });
    evidence = { mode: MODE, writes_performed: false, before, authority };
  } else {
    assertNoRunnableWork(before.runnable_work);
    const protectedBefore = before.protected_state_digest;
    if (before.migration_state === "absent") {
      await direct.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      try {
        await direct.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          "noisia:signal-acquisition-strategic-authority:0089"
        ]);
        const locked = await inspect(direct);
        if (locked.migration_state !== "absent"
          || locked.protected_state_digest !== protectedBefore) {
          throw new Error("0089 protected-state compare-and-swap failed.");
        }
        assertNoRunnableWork(locked.runnable_work);
        await direct.query(migrationSql);
        await direct.query(`INSERT INTO signal_workspace_data_plane_migration_ledger(
          migration_name,ordinal,checksum_sha256,disposition,runner_version,target_fingerprint
        ) VALUES($1,$2,$3,'applied','signal-acquisition-strategic-authority-runner-v1',$4)`, [
          MIGRATION.filename,MIGRATION.ordinal,MIGRATION.checksum,EXPECTED.direct
        ]);
        await direct.query("COMMIT");
      } catch (error) {
        await direct.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }
    const afterMigration = await inspect(direct);
    if (afterMigration.migration_state !== "complete"
      || afterMigration.protected_state_digest !== protectedBefore) {
      throw new Error("0089 migration verification failed.");
    }
    const transition = await applyAuthority({ workspaceName, corpus: plan.corpus });
    if (transition.replay_noop) evidenceKind = "replay";
    const after = await inspect(direct);
    assertNoRunnableWork(after.runnable_work);
    if (after.protected_state_digest !== protectedBefore) {
      throw new Error("Protected serving state changed during strategic authority transition.");
    }
    evidence = {
      mode: MODE,
      writes_performed: true,
      before,
      after,
      transition,
      frozen_digests_unchanged: transition.preflight.population_digest === plan.corpus.population_digest
        && transition.preflight.content_digest === plan.corpus.content_digest
        && transition.preflight.provenance_digest === plan.corpus.provenance_digest
        && transition.preflight.watermark_digest === plan.corpus.watermark_digest
    };
  }
} finally {
  await direct.end();
}

const sanitized = {
  contract_version: "signal-acquisition-strategic-authority-runner-v1",
  target: "noisia-staging",
  direct_fingerprint: EXPECTED.direct,
  pooler_fingerprint: EXPECTED.pooler,
  project_ref_hash: EXPECTED.project,
  migration: MIGRATION,
  plan_sha256: sha256(planBody),
  restore_point: RESTORE_AT && RESTORE_HASH ? {
    captured_at: RESTORE_AT,
    reference_hash: RESTORE_HASH,
    age_hours: Number(((Date.now() - Date.parse(RESTORE_AT)) / 3_600_000).toFixed(2))
  } : null,
  provider_calls: 0,
  paid_jobs: 0,
  models_executed: 0,
  holdout_opened: false,
  serving_writes: 0,
  execution_authorized: false,
  ten_d_authorized: false,
  ...evidence
};
const evidencePath = resolve(outputDir, `strategic-authority-${evidenceKind}.sanitized.json`);
const body = `${JSON.stringify(sanitized, null, 2)}\n`;
await writeFile(evidencePath, body, { mode: 0o600 });
await chmod(evidencePath, 0o600);
process.stdout.write(`${JSON.stringify({ ok: true, mode: MODE, evidence_sha256: sha256(body),
  target: "noisia-staging", provider_calls: 0, paid_jobs: 0, models_executed: 0,
  execution_authorized: false, ten_d_authorized: false })}\n`);

async function applyAuthority(args: { workspaceName: string;corpus: SignalSemanticBenchmarkFrozenCorpusV2 }) {
  const [{ pool }, workspaceModule, authorityModule, benchmarkModule] = await Promise.all([
    import("../src/lib/db"),
    import("../src/lib/data-os/signal-workspace"),
    import("../src/lib/data-os/signal-acquisition-strategic-authority"),
    import("../src/lib/data-os/signal-semantic-benchmark-export")
  ]);
  try {
    const resolved = await pool.query<{
      workspace_id: string;organization_id: string;brand_id: string;slug: string;
      name: string;timezone: string;status: string;actor_id: string;
    }>(String.raw`
      WITH workspace AS (
        SELECT workspace.id AS workspace_id,workspace.organization_id,workspace.brand_id,
          workspace.slug,brand.name,workspace.timezone,workspace.status
        FROM signal_workspaces workspace JOIN brands brand ON brand.id=workspace.brand_id
        WHERE workspace.status='active' AND brand.status='active' AND lower(brand.name)=lower($1)
      ), requested AS (
        SELECT value.scope,value.plan_version,value.plan_digest,value.slot_digest
        FROM jsonb_to_recordset($2::jsonb) AS value(key text,scope text,entity_ref text,
          declared_market text,plan_version integer,plan_digest text,slot_digest text,total integer,
          included integer,excluded integer,population_digest text,modeling_digest text)
      ), batches AS (
        SELECT DISTINCT batch.imported_by_user_id
        FROM workspace
        JOIN signal_acquisition_plans plan ON plan.workspace_id=workspace.workspace_id
        JOIN requested ON requested.plan_version=plan.plan_version
          AND requested.plan_digest=plan.definition_hash
        JOIN signal_acquisition_slots slot ON slot.workspace_id=plan.workspace_id
          AND slot.plan_id=plan.id AND slot.definition_hash=requested.slot_digest
          AND slot.scope=requested.scope
        JOIN import_batches batch ON batch.workspace_id=plan.workspace_id
          AND batch.acquisition_plan_id=plan.id AND batch.acquisition_slot_id=slot.id
          AND batch.status='completed' AND batch.acquisition_contract_version='signal-acquisition-import-v2'
          AND batch.acquisition_plan_digest=requested.plan_digest
          AND batch.acquisition_slot_digest=requested.slot_digest
      ), actor AS (
        SELECT min(user_value.id::text)::uuid AS actor_id,count(DISTINCT user_value.id)::int AS actor_count
        FROM batches JOIN users user_value ON user_value.id=batches.imported_by_user_id
          AND user_value.status='active' AND user_value.user_type='noisia_internal'
      ) SELECT workspace.workspace_id::text,workspace.organization_id::text,
        workspace.brand_id::text,workspace.slug,workspace.name,workspace.timezone,workspace.status,
        actor.actor_id::text FROM workspace CROSS JOIN actor WHERE actor.actor_count=1
    `, [args.workspaceName, JSON.stringify(args.corpus.partitions)]);
    if (resolved.rowCount !== 1 || !resolved.rows[0]) {
      throw new Error("Workspace and server-owned operator actor are not uniquely resolvable.");
    }
    const row = resolved.rows[0];
    const actor = { id: row.actor_id, userType: "noisia_internal" as const, organizationId: row.organization_id };
    const workspace = await workspaceModule.resolveSignalWorkspaceForUser(actor, { workspaceId: row.workspace_id });
    if (!workspace) throw new Error("Resolved operator lacks workspace management authority.");
    const countsBefore = await authorityVersionCounts(pool, workspace.id);
    const preflightClient = await pool.connect();
    let preflightBefore;
    try {
      preflightBefore = await benchmarkModule.preflightSignalSemanticBenchmarkExportV2({
        client: preflightClient,workspaceId: workspace.id,frozenCorpus: args.corpus
      });
    } finally { preflightClient.release(); }
    const unexpected = preflightBefore.blockers.filter((item) =>
      item !== "strategic_authority_blocked:strategic_analysis_denied"
      && item !== "strategic_authority_blocked:strategic_analysis_unknown");
    if ((!preflightBefore.ready && unexpected.length > 0)
      || (preflightBefore.ready && preflightBefore.blockers.length > 0)) {
      throw new Error(`Unexpected pre-authority state: ${unexpected.join(",") || "ready-with-blockers"}`);
    }
    const result = await authorityModule.authorizeSignalAcquisitionBenchmarkStrategicAuthorityInTransactionV1({
      workspace,actor,idempotencyKey:`10c2b:${args.corpus.population_digest}`,
      approvalEvidence:"Operator authorized import-scoped strategic-analysis for frozen 10C.2 local modeling only.",
      frozenCorpus: args.corpus
    });
    if (result.import_count !== 5 || result.llm_processing_allowed
      || result.future_imports_authorized) {
      throw new Error("Strategic authority result does not match the five-import decision.");
    }
    const verifyClient = await pool.connect();
    let preflight;
    try {
      preflight = await benchmarkModule.preflightSignalSemanticBenchmarkExportV2({
        client: verifyClient,workspaceId: workspace.id,frozenCorpus: args.corpus
      });
    } finally { verifyClient.release(); }
    if (!preflight.ready || preflight.blockers.length > 0 || !preflight.authority_digest
      || preflight.required_usage !== "strategic-analysis" || preflight.provider_calls !== 0
      || preflight.jobs_enqueued !== 0 || preflight.writes_performed !== false) {
      throw new Error("Post-authority export preflight is not ready and free.");
    }
    const countsAfter = await authorityVersionCounts(pool, workspace.id);
    const replayNoop = preflightBefore.ready;
    if (replayNoop && stable(countsBefore) !== stable(countsAfter)) {
      throw new Error("Idempotent replay created governance or observation state.");
    }
    return { result, preflight, replay_noop: replayNoop,
      version_counts_before: countsBefore,version_counts_after: countsAfter };
  } finally {
    await pool.end();
  }
}

async function verifyAuthorityReadOnly(args: {
  client: pg.Client;workspaceName: string;corpus: SignalSemanticBenchmarkFrozenCorpusV2;
}) {
  const workspace = await args.client.query<{ workspace_id: string }>(`
    SELECT workspace.id::text AS workspace_id
    FROM signal_workspaces workspace JOIN brands brand ON brand.id=workspace.brand_id
    WHERE workspace.status='active' AND brand.status='active' AND lower(brand.name)=lower($1)
  `, [args.workspaceName]);
  if (workspace.rowCount !== 1 || !workspace.rows[0]) {
    throw new Error("Frozen benchmark workspace is not uniquely resolvable.");
  }
  const benchmarkModule = await import("../src/lib/data-os/signal-semantic-benchmark-export");
  const preflight = await benchmarkModule.preflightSignalSemanticBenchmarkExportV2({
    client: args.client as never,workspaceId: workspace.rows[0].workspace_id,frozenCorpus: args.corpus
  });
  if (!preflight.ready || preflight.blockers.length > 0 || !preflight.authority_digest
    || preflight.required_usage !== "strategic-analysis" || preflight.provider_calls !== 0
    || preflight.jobs_enqueued !== 0 || preflight.writes_performed !== false
    || preflight.transaction_read_only !== true || preflight.transaction_id_assigned !== false) {
    throw new Error("Read-only strategic export preflight is not ready and free.");
  }
  const state = await args.client.query<{
    batch_count: number;licensing_policy_versions: number;binding_versions: number;
    current_binding_count: number;observation_versions: number;current_observations: number;
    superseded_observations: number;strategic_allowed_bindings: number;
    llm_allowed_bindings: number;future_import_bindings: number;effective_to: string;
  }>(String.raw`
    WITH requested AS MATERIALIZED (
      SELECT value.scope,value.plan_version,value.plan_digest,value.slot_digest
      FROM jsonb_to_recordset($2::jsonb) AS value(key text,scope text,entity_ref text,
        declared_market text,plan_version integer,plan_digest text,slot_digest text,total integer,
        included integer,excluded integer,population_digest text,modeling_digest text)
    ), batches AS MATERIALIZED (
      SELECT DISTINCT batch.id
      FROM requested request
      JOIN signal_acquisition_plans plan ON plan.workspace_id=$1::uuid
       AND plan.plan_version=request.plan_version AND plan.definition_hash=request.plan_digest
      JOIN signal_acquisition_slots slot ON slot.workspace_id=plan.workspace_id
       AND slot.plan_id=plan.id AND slot.definition_hash=request.slot_digest AND slot.scope=request.scope
      JOIN import_batches batch ON batch.workspace_id=plan.workspace_id
       AND batch.acquisition_plan_id=plan.id AND batch.acquisition_slot_id=slot.id
       AND batch.status='completed' AND batch.ingestion_phase='completed'
       AND batch.acquisition_contract_version='signal-acquisition-import-v2'
       AND batch.acquisition_plan_digest=request.plan_digest
       AND batch.acquisition_slot_digest=request.slot_digest
    ), current_observations AS MATERIALIZED (
      SELECT observation.* FROM signal_provider_mention_observations observation
      JOIN batches batch ON batch.id=observation.import_batch_id
      WHERE observation.workspace_id=$1::uuid AND NOT EXISTS(
        SELECT 1 FROM signal_provider_mention_observations successor
        WHERE successor.supersedes_observation_id=observation.id)
    ), current_bindings AS MATERIALIZED (
      SELECT DISTINCT binding.* FROM current_observations observation
      JOIN signal_provenance_policy_bindings binding ON binding.id=observation.provenance_binding_id
      WHERE binding.workspace_id=$1::uuid AND binding.status='active'
    ), selected_licenses AS MATERIALIZED (
      SELECT DISTINCT licensing_policy_id id FROM current_bindings
    ) SELECT
      (SELECT count(*)::int FROM batches) batch_count,
      (SELECT count(*)::int FROM signal_licensing_policies policy
        JOIN selected_licenses selected ON selected.id=policy.id) licensing_policy_versions,
      (SELECT count(*)::int FROM signal_provenance_policy_bindings binding
        JOIN batches batch ON batch.id=binding.import_batch_id WHERE binding.workspace_id=$1::uuid) binding_versions,
      (SELECT count(*)::int FROM current_bindings) current_binding_count,
      (SELECT count(*)::int FROM signal_provider_mention_observations observation
        JOIN batches batch ON batch.id=observation.import_batch_id
        WHERE observation.workspace_id=$1::uuid) observation_versions,
      (SELECT count(*)::int FROM current_observations) current_observations,
      (SELECT count(*)::int FROM signal_provider_mention_observations prior
        JOIN batches batch ON batch.id=prior.import_batch_id WHERE prior.workspace_id=$1::uuid
        AND EXISTS(SELECT 1 FROM signal_provider_mention_observations successor
          WHERE successor.supersedes_observation_id=prior.id)) superseded_observations,
      (SELECT count(*)::int FROM current_bindings binding WHERE EXISTS(
        SELECT 1 FROM signal_licensing_policy_usages usage
        WHERE usage.licensing_policy_id=binding.licensing_policy_id
          AND usage.usage_purpose='strategic-analysis' AND usage.decision='allowed')) strategic_allowed_bindings,
      (SELECT count(*)::int FROM current_bindings binding WHERE EXISTS(
        SELECT 1 FROM signal_licensing_policy_usages usage
        WHERE usage.licensing_policy_id=binding.licensing_policy_id
          AND usage.usage_purpose='llm-processing' AND usage.decision='allowed')) llm_allowed_bindings,
      (SELECT count(*)::int FROM signal_provenance_policy_bindings binding
        JOIN selected_licenses selected ON selected.id=binding.licensing_policy_id
        WHERE binding.workspace_id=$1::uuid AND (binding.import_batch_id IS NULL
          OR NOT EXISTS(SELECT 1 FROM batches batch WHERE batch.id=binding.import_batch_id))) future_import_bindings,
      (SELECT min(effective_to)::text FROM current_bindings) effective_to
  `, [workspace.rows[0].workspace_id, JSON.stringify(args.corpus.partitions)]);
  const value = state.rows[0];
  if (!value || value.batch_count !== 5 || value.current_binding_count !== 5
    || value.strategic_allowed_bindings !== 5 || value.llm_allowed_bindings !== 0
    || value.future_import_bindings !== 0 || value.current_observations < 1
    || value.current_observations !== value.superseded_observations || !value.effective_to) {
    throw new Error("Import-scoped authority versions do not reconcile.");
  }
  return { preflight,state: value };
}

async function authorityVersionCounts(queryable: { query: pg.Pool["query"] }, workspaceId: string) {
  const value = await queryable.query<Record<string,number>>(`SELECT
    (SELECT count(*)::int FROM signal_licensing_policies WHERE workspace_id=$1::uuid) licensing_policies,
    (SELECT count(*)::int FROM signal_provenance_policy_bindings WHERE workspace_id=$1::uuid) provenance_bindings,
    (SELECT count(*)::int FROM signal_provider_mention_observations WHERE workspace_id=$1::uuid) typed_observations,
    (SELECT count(*)::int FROM signal_provider_mention_observation_terms WHERE workspace_id=$1::uuid) observation_terms,
    (SELECT count(*)::int FROM signal_governance_control_operations WHERE workspace_id=$1::uuid) operations
  `, [workspaceId]);
  return value.rows[0]!;
}

async function inspect(client: pg.Client) {
  const ledger = await client.query<{ ordinal: number;migration_name: string;checksum_sha256: string }>(`
    SELECT ordinal,migration_name,checksum_sha256 FROM signal_workspace_data_plane_migration_ledger
    WHERE ordinal=$1`, [MIGRATION.ordinal]);
  const sentinel = await client.query<{ action: boolean;successor: boolean;validator: boolean }>(`
    SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='signal_governance_control_action'
      AND pg_get_constraintdef(oid) LIKE '%authorize-acquisition-benchmark%') AS action,
      to_regclass('uq_signal_provider_observation_successor') IS NOT NULL AS successor,
      EXISTS(SELECT 1 FROM pg_proc WHERE proname='validate_signal_provider_observation_v1'
        AND pg_get_functiondef(oid) LIKE '%to_jsonb(prior)%') AS validator
  `);
  const row = sentinel.rows[0]!;
  const sentinelCount = Number(row.action)+Number(row.successor)+Number(row.validator);
  const ledgerCorrect = ledger.rowCount === 1 && ledger.rows[0]?.migration_name === MIGRATION.filename
    && ledger.rows[0]?.checksum_sha256 === MIGRATION.checksum;
  const migrationState = ledger.rowCount === 0 && sentinelCount === 0 ? "absent"
    : ledgerCorrect && sentinelCount === 3 ? "complete" : "partial";
  return {
    migration_state: migrationState,
    migration_ledger_count: ledger.rowCount,
    sentinel_count: sentinelCount,
    protected_state_digest: await protectedState(client),
    runnable_work: await runnableWork(client)
  };
}

async function protectedState(client: pg.Client) {
  const domains = [
    ["pointers", "SELECT to_jsonb(row_value) value FROM signal_workspace_population_pointers row_value"],
    ["governed_bindings", "SELECT to_jsonb(row_value) value FROM signal_governed_view_bindings row_value"],
    ["materializations", "SELECT to_jsonb(row_value) value FROM metric_materializations row_value"],
    ["classification_generations", "SELECT to_jsonb(row_value) value FROM signal_classification_generations row_value"],
    ["classification_assignments", "SELECT to_jsonb(row_value) value FROM signal_classification_assignments row_value"],
    ["record_tags", "SELECT to_jsonb(row_value) value FROM record_tags row_value"]
  ] as const;
  const results = [];
  for (const [key, projection] of domains) {
    const present = await client.query<{ present: boolean }>("SELECT to_regclass($1) IS NOT NULL present", [
      key === "pointers" ? "signal_workspace_population_pointers"
        : key === "governed_bindings" ? "signal_governed_view_bindings"
          : key === "materializations" ? "metric_materializations"
            : key === "classification_generations" ? "signal_classification_generations"
              : key === "classification_assignments" ? "signal_classification_assignments" : "record_tags"
    ]);
    if (!present.rows[0]?.present) continue;
    const value = await client.query<{ count: number;digest: string }>(`
      WITH rows AS (${projection}), hashes AS (
        SELECT encode(digest(convert_to(value::text,'UTF8'),'sha256'),'hex') hash FROM rows
      ) SELECT count(*)::int count,encode(digest(convert_to(COALESCE(string_agg(hash,'' ORDER BY hash),''),
        'UTF8'),'sha256'),'hex') digest FROM hashes`);
    results.push({ key,count: value.rows[0]!.count,digest: value.rows[0]!.digest });
  }
  return sha256(stable(results));
}

async function runnableWork(client: pg.Client) {
  const result = await client.query<Record<string,number>>(`SELECT
    (SELECT count(*)::int FROM import_batches WHERE status IN('queued','processing')) imports,
    (SELECT count(*)::int FROM signal_workspace_import_outbox WHERE status IN('pending','dispatching')) import_outbox,
    (SELECT count(*)::int FROM signal_semantic_resolution_runs WHERE status IN('queued','running')) semantic_runs,
    (SELECT count(*)::int FROM signal_strategic_run_controls WHERE status IN('queued','running')) strategic_runs`);
  return result.rows[0]!;
}

function assertNoRunnableWork(value: Record<string,number>) {
  if (Object.values(value).some((count) => Number(count) !== 0)) {
    throw new Error("Runnable jobs/outbox exist; strategic authority transition is blocked.");
  }
}

async function inspectPeer(url: string) {
  const client = new pg.Client({ connectionString: url,ssl: { rejectUnauthorized: false },
    application_name: "noisia-signal-10c2b-authority-peer" });
  await client.connect();
  try { return await inspect(client); } finally { await client.end(); }
}

function assertPeer(left: Awaited<ReturnType<typeof inspect>>, right: Awaited<ReturnType<typeof inspect>>) {
  if (left.migration_state !== right.migration_state
    || left.migration_ledger_count !== right.migration_ledger_count
    || left.protected_state_digest !== right.protected_state_digest) {
    throw new Error("Direct/pooler staging state does not match.");
  }
}

function deriveDirect(value: string) {
  const parsed = new URL(value);
  const ref = /^postgres\.([a-z0-9]+)$/u.exec(decodeURIComponent(parsed.username).toLowerCase())?.[1];
  if (!ref) throw new Error("Canonical pooler connection shape is unavailable.");
  parsed.hostname = `db.${ref}.supabase.co`;parsed.port = "5432";parsed.username = "postgres";
  return parsed.toString();
}
function fingerprint(value: string) { const parsed = new URL(value);return sha256([
  parsed.protocol,parsed.hostname.toLowerCase(),parsed.port || "5432",
  parsed.pathname.replace(/^\//u, ""),parsed.username
].join("|")); }
function projectHash(value: string, kind: "direct" | "pooler") { const parsed = new URL(value);
  const ref = kind === "direct" ? /^db\.([a-z0-9]+)\.supabase\.co$/u.exec(parsed.hostname)?.[1]
    : /^postgres\.([a-z0-9]+)$/u.exec(decodeURIComponent(parsed.username))?.[1];
  if (!ref) throw new Error("Project identity is unavailable.");return sha256(ref); }
function required(value: string | undefined, name: string) { const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required.`);return normalized; }
function sha256(value: string) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stable(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string,unknown>)
    .sort(([left],[right]) => left.localeCompare(right))
    .map(([key,item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value); }

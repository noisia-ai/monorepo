import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { config as loadEnv } from "dotenv";
import pg from "pg";

const ROOT = "/Users/brandhon_o/Downloads/noisia-website";
const OUTPUT_DIR = resolve(ROOT, ".data/signal-governed-serving/backend-07");
const EXPECTED_DIRECT = "sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19";
const EXPECTED_POOLER = "sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815";
const EXPECTED_PROJECT = "sha256:030c5a33e3b28881c4d77983a6049bbfa16c995da232454081cbccfcfa78aa32";
const RESTORE_AT = "2026-08-12T14:21:13.000Z";
const APP_NAME = "noisia-backend-07-strategic-execution-corpus";
const IDEMPOTENCY_KEY = "backend-07:laika:strategic-execution-corpus:v1";

const sha256 = (value: string | Buffer) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const stable = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(stable).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`
    : JSON.stringify(value);
const fingerprint = (value: string) => {
  const parsed = new URL(value);
  return sha256([
    parsed.protocol, parsed.hostname.toLowerCase(), parsed.port || "5432",
    parsed.pathname.replace(/^\//u, ""), parsed.username
  ].join("|"));
};

const env: Record<string, string> = {};
loadEnv({ path: resolve(ROOT, "apps/studio/.env.local"), processEnv: env });
if (process.env.NOISIA_SIGNAL_STRATEGIC_EXECUTION_CORPUS_APPLY_APPROVED !== "true") {
  throw new Error("signal_strategic_execution_corpus_apply_not_approved");
}
const poolerUrl = env.DATABASE_URL?.trim();
if (!poolerUrl || env.DATABASE_SSL !== "true") throw new Error("staging_connection_unavailable");
const poolerParsed = new URL(poolerUrl);
const projectRef = /^postgres\.([a-z0-9]+)$/u.exec(
  decodeURIComponent(poolerParsed.username).toLowerCase()
)?.[1];
if (!projectRef) throw new Error("staging_project_identity_unavailable");
const directParsed = new URL(poolerParsed);
directParsed.hostname = `db.${projectRef}.supabase.co`;
directParsed.port = "5432";
directParsed.username = "postgres";
const directUrl = directParsed.toString();
if (fingerprint(directUrl) !== EXPECTED_DIRECT || fingerprint(poolerUrl) !== EXPECTED_POOLER
    || sha256(projectRef) !== EXPECTED_PROJECT) throw new Error("staging_identity_mismatch");
const restoreAgeHours = (Date.now() - Date.parse(RESTORE_AT)) / 3_600_000;
if (restoreAgeHours < 0 || restoreAgeHours > 24) throw new Error("fresh_restore_point_required");

const direct = new pg.Client({ connectionString: directUrl, ssl: { rejectUnauthorized: false }, application_name: APP_NAME });
const peer = new pg.Client({ connectionString: poolerUrl, ssl: { rejectUnauthorized: false }, application_name: `${APP_NAME}-peer` });
await Promise.all([direct.connect(), peer.connect()]);

type Snapshot = {
  database_hash: string;
  ledger_digest: string;
  protected_digest: string;
  execution_corpus_count: number;
  jobs: { run_controls: number; run_outbox: number; step_outbox: number; analyses: number };
};

async function snapshot(client: pg.Client): Promise<Snapshot> {
  const databaseName = (await client.query<{ database_name: string }>(
    "SELECT current_database() AS database_name"
  )).rows[0]!.database_name;
  const ledger = (await client.query(`SELECT ordinal,migration_name,checksum_sha256,disposition
    FROM signal_workspace_data_plane_migration_ledger WHERE ordinal BETWEEN 59 AND 76 ORDER BY ordinal`)).rows;
  const protectedRows = (await client.query(`WITH workspace AS (
      SELECT workspace.id FROM signal_workspaces workspace
      JOIN brands brand ON brand.id=workspace.brand_id WHERE brand.slug='laika'
    ) SELECT jsonb_build_object(
      'v1',(SELECT jsonb_agg(row_data ORDER BY row_data::text) FROM (
        SELECT to_jsonb(definition) AS row_data FROM signal_population_definitions definition
        WHERE definition.workspace_id=(SELECT id FROM workspace)
          AND definition.population_key='signal-operational-v1') rows),
      'pointers',(SELECT jsonb_agg(to_jsonb(pointer) ORDER BY pointer.id)
        FROM signal_workspace_population_pointers pointer
        WHERE pointer.workspace_id=(SELECT id FROM workspace)),
      'operational',(SELECT jsonb_agg(to_jsonb(compilation) ORDER BY compilation.module_key,compilation.view_key)
        FROM signal_population_policy_compilations compilation
        WHERE compilation.workspace_id=(SELECT id FROM workspace)
          AND compilation.module_key IN ('brand-monitoring','mentions','topics-narratives')
          AND compilation.is_current),
      'strategic',(SELECT jsonb_agg(to_jsonb(compilation) ORDER BY compilation.id)
        FROM signal_population_policy_compilations compilation
        WHERE compilation.workspace_id=(SELECT id FROM workspace)
          AND compilation.module_key='triggers-barriers' AND compilation.view_key='strategic'),
      'bindings',(SELECT jsonb_agg(to_jsonb(binding) ORDER BY binding.module_key,binding.view_key,binding.id)
        FROM signal_governed_view_bindings binding WHERE binding.workspace_id=(SELECT id FROM workspace)),
      'assertions',(SELECT jsonb_build_object('count',count(*),'current',count(*) FILTER (WHERE is_current))
        FROM signal_mention_attributions assertion WHERE assertion.workspace_id=(SELECT id FROM workspace)),
      'review',(SELECT count(*) FROM signal_mention_attribution_review_events event
        WHERE event.workspace_id=(SELECT id FROM workspace))) AS protected`)).rows[0]?.protected;
  const scope = (await client.query<{ execution_corpus_count: number; run_controls: number;
    run_outbox: number; step_outbox: number; analyses: number }>(`WITH workspace AS (
      SELECT workspace.id FROM signal_workspaces workspace
      JOIN brands brand ON brand.id=workspace.brand_id WHERE brand.slug='laika'
    ) SELECT
      (SELECT count(*)::int FROM signal_workspace_corpora membership
       JOIN study_corpora corpus ON corpus.id=membership.study_corpus_id
       JOIN methodologies methodology ON methodology.id=corpus.methodology_id
       WHERE membership.workspace_id=(SELECT id FROM workspace)
         AND membership.role='strategic' AND membership.valid_to IS NULL
         AND methodology.slug='triggers-barriers'
         AND corpus.analysis_plan->>'contract_version'='signal-tb-execution-corpus-v1') AS execution_corpus_count,
      (SELECT count(*)::int FROM signal_strategic_run_controls WHERE workspace_id=(SELECT id FROM workspace)) AS run_controls,
      (SELECT count(*)::int FROM signal_strategic_run_outbox WHERE workspace_id=(SELECT id FROM workspace)) AS run_outbox,
      (SELECT count(*)::int FROM signal_strategic_step_outbox WHERE workspace_id=(SELECT id FROM workspace)) AS step_outbox,
      (SELECT count(*)::int FROM tb_analyses WHERE workspace_id=(SELECT id FROM workspace)
        AND strategic_contract_version='signal-tb-strategic-v2') AS analyses`)).rows[0]!;
  return {
    database_hash: sha256(databaseName), ledger_digest: sha256(stable(ledger)),
    protected_digest: sha256(stable(protectedRows)), execution_corpus_count: scope.execution_corpus_count,
    jobs: { run_controls: scope.run_controls, run_outbox: scope.run_outbox,
      step_outbox: scope.step_outbox, analyses: scope.analyses }
  };
}

let evidence: Record<string, unknown>;
try {
  await Promise.all([
    direct.query("SET statement_timeout='120s'; SET lock_timeout='15s'"),
    peer.query("SET statement_timeout='120s'; SET lock_timeout='15s'")
  ]);
  const [before, peerBefore] = await Promise.all([snapshot(direct), snapshot(peer)]);
  if (stable(before) !== stable(peerBefore)) throw new Error("direct_pooler_preflight_mismatch");
  if (before.execution_corpus_count > 1) throw new Error("strategic_execution_corpus_ambiguous");
  if (Object.values(before.jobs).some((value) => value !== 0)) throw new Error("strategic_jobs_exist");
  const peerPid = (await peer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
  const connections = (await direct.query<{ incompatible: number }>(`SELECT count(*)::int AS incompatible
    FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend'
      AND pid NOT IN (pg_backend_pid(),$1::int)
      AND state IS DISTINCT FROM 'idle' AND application_name NOT IN ($2,$3)`,
    [peerPid, APP_NAME, `${APP_NAME}-peer`])).rows[0]!.incompatible;
  if (connections !== 0) throw new Error(`incompatible_database_writer_present:${connections}`);

  await direct.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  let created = false;
  let corpusId = "";
  try {
    await direct.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [IDEMPOTENCY_KEY]);
    const locked = await snapshot(direct);
    if (stable(locked) !== stable(before)) throw new Error("strategic_execution_corpus_cas_drift");
    const authority = (await direct.query<{ workspace_id: string; brand_id: string; actor_id: string;
      methodology_id: string; methodology_version: string }>(`SELECT workspace.id::text AS workspace_id,
        workspace.brand_id::text AS brand_id,actor.id::text AS actor_id,
        methodology.id::text AS methodology_id,methodology.version AS methodology_version
      FROM signal_workspaces workspace
      JOIN brands brand ON brand.id=workspace.brand_id AND brand.slug='laika'
      JOIN LATERAL (
        SELECT bundle.activated_by_user_id AS id FROM signal_population_policy_bundles bundle
        WHERE bundle.workspace_id=workspace.id AND bundle.policy_key='triggers-barriers-strategic-governed'
          AND bundle.policy_version=1 AND bundle.status='active') bundle_actor ON true
      JOIN users actor ON actor.id=bundle_actor.id AND actor.status='active'
        AND actor.user_type='noisia_internal'
      CROSS JOIN LATERAL (
        SELECT methodology.id,methodology.version FROM methodologies methodology
        WHERE methodology.slug='triggers-barriers' AND methodology.version='1.0'
          AND methodology.status='active') methodology
      WHERE workspace.status='active'
        AND signal_data_governance_actor_is_valid(workspace.id,actor.id)`)).rows;
    if (authority.length !== 1) throw new Error("strategic_execution_authority_ambiguous");
    const row = authority[0]!;
    const existing = (await direct.query<{ id: string }>(`SELECT corpus.id::text
      FROM signal_workspace_corpora membership
      JOIN study_corpora corpus ON corpus.id=membership.study_corpus_id
      JOIN methodologies methodology ON methodology.id=corpus.methodology_id
      WHERE membership.workspace_id=$1::uuid AND membership.role='strategic'
        AND membership.valid_to IS NULL AND methodology.slug='triggers-barriers'
        AND corpus.analysis_plan->>'contract_version'='signal-tb-execution-corpus-v1'
        AND corpus.analysis_plan->>'server_owned_identity'='triggers-barriers/strategic'
      FOR UPDATE OF corpus,membership`, [row.workspace_id])).rows;
    if (existing.length > 1) throw new Error("strategic_execution_corpus_ambiguous");
    if (existing.length === 1) {
      corpusId = existing[0]!.id;
    } else {
      const inserted = await direct.query<{ id: string }>(`INSERT INTO study_corpora(
          name,brand_id,methodology_id,methodology_version_at_creation,status,
          current_pipeline_version,corpus_revision,analysis_plan
        ) VALUES (
          'Laika strategic execution corpus (QA)',$1::uuid,$2::uuid,$3,
          'corpus_approved','tb-engine-2026.05.25',1,
          jsonb_build_object('version',1,'contract_version','signal-tb-execution-corpus-v1',
            'server_owned_identity','triggers-barriers/strategic',
            'primary_methodology_slug','triggers-barriers',
            'selected_lenses',jsonb_build_array('triggers-barriers'),
            'lens_configs','{}'::jsonb,'composer_modules','[]'::jsonb,
            'created_by_user_id',$4::text,'idempotency_key',$5::text)
        ) RETURNING id::text`, [row.brand_id, row.methodology_id, row.methodology_version,
        row.actor_id, IDEMPOTENCY_KEY]);
      corpusId = inserted.rows[0]!.id;
      created = true;
    }
    const membership = (await direct.query<{ count: number }>(`SELECT count(*)::int
      FROM signal_workspace_corpora WHERE workspace_id=$1::uuid AND study_corpus_id=$2::uuid
        AND role='strategic' AND valid_to IS NULL`, [row.workspace_id, corpusId])).rows[0]!.count;
    if (membership !== 1) throw new Error("strategic_execution_corpus_membership_missing");
    const inTransaction = await snapshot(direct);
    if (inTransaction.execution_corpus_count !== 1
        || inTransaction.protected_digest !== before.protected_digest
        || Object.values(inTransaction.jobs).some((value) => value !== 0)) {
      throw new Error("strategic_execution_corpus_postcondition_failed");
    }
    await direct.query("COMMIT");
  } catch (error) {
    await direct.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
  const [after, peerAfter] = await Promise.all([snapshot(direct), snapshot(peer)]);
  if (stable(after) !== stable(peerAfter)) throw new Error("direct_pooler_verify_mismatch");
  if (after.execution_corpus_count !== 1 || after.protected_digest !== before.protected_digest
      || Object.values(after.jobs).some((value) => value !== 0)) {
    throw new Error("strategic_execution_corpus_verify_failed");
  }
  evidence = {
    contract_version: "signal-backend-07-strategic-execution-corpus-v1",
    captured_at: new Date().toISOString(), target: "noisia-staging",
    restore_point: { captured_at: RESTORE_AT, age_hours: Math.round(restoreAgeHours * 10) / 10 },
    identity: { direct_fingerprint: EXPECTED_DIRECT, pooler_fingerprint: EXPECTED_POOLER,
      project_ref_hash: EXPECTED_PROJECT }, before,
    transition: { created, corpus_ref_hash: sha256(corpusId), idempotency_key_hash: sha256(IDEMPOTENCY_KEY) },
    after, writes_performed: created, snapshots_created: 0, runs_created: 0,
    jobs_enqueued: 0, provider_calls: 0
  };
} finally {
  await Promise.allSettled([direct.end(), peer.end()]);
}

await mkdir(OUTPUT_DIR, { recursive: true, mode: 0o700 });
const output = `${JSON.stringify(evidence, null, 2)}\n`;
const outputPath = resolve(OUTPUT_DIR, "strategic-execution-corpus.sanitized.json");
await writeFile(outputPath, output, { mode: 0o600 });
await chmod(outputPath, 0o600);
process.stdout.write(`${JSON.stringify({
  ok: true, created: (evidence.transition as { created: boolean }).created,
  execution_corpus_count: (evidence.after as Snapshot).execution_corpus_count,
  protected_digest: (evidence.after as Snapshot).protected_digest,
  jobs_enqueued: 0, provider_calls: 0, artifact_sha256: sha256(output)
})}\n`);

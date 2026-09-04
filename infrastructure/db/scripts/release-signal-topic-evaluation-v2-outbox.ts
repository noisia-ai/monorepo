/**
 * Sealed release runner for migration 0114.
 *
 * The runner is intentionally inert unless invoked in one of four explicit modes. It never
 * creates an evaluation authority, run or dispatch intent. Remote use requires a sealed
 * Preview/UAT target attestation; local rehearsal additionally requires a loopback PostgreSQL
 * connection and an explicit local-disposable attestation.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, statSync } from "node:fs";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

import pg from "pg";

process.umask(0o077);

const ROOT = resolve(import.meta.dirname, "../../..");
const MIGRATION_FILE = "0114_signal_topic_evaluation_v2_execution_outbox.sql";
const MIGRATION_PATH = resolve(ROOT, "infrastructure/db/migrations", MIGRATION_FILE);
const BASE_COMMIT = "75f0873f0321b8f4cfb3e6105aefa5b2614784d5";
const ENV_PREFIX = "NOISIA_TOPIC_EVALUATION_V2_0114";
const APPROVAL_LITERAL = "APPLY_0114_EXACTLY_ONCE_TO_PREVIEW_UAT";
const RECEIPT_MAX_AGE_MS = 60 * 60 * 1000;
const EXPECTED = {
  uatTargetFingerprint: "sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815",
  protectedDigest: "sha256:5cf291ca7d426ead697b784080fe3b5380f39b4e3965441b8f4df9689645ffdc",
  migration0112: "sha256:51f6fbff712ec1737b41da9997bda86b068abb81f4edafc9a338af590c462ab5",
  migration0113: "sha256:8bb7f5be275d33d4f284f72a9e882314f488466ccdd3adee3ade2acb195f0f71",
  migration0114: "sha256:f63774eae48b6fc3332feafdd8d033afeb8d4ae44d5479fd87ea44fa26e02582"
} as const;

export const SIGNAL_TOPIC_EVALUATION_V2_0114_RELEASE_ALLOWLIST = [
  "apps/studio/src/app/api/data-os/signal/[workspaceId]/topic-evaluation/full-evidence/route.ts",
  "apps/studio/src/lib/data-os/signal-topic-evaluation-api.test.ts",
  "apps/studio/src/lib/data-os/signal-topic-evaluation-api.ts",
  "apps/studio/src/lib/data-os/signal-topic-evaluation-full-evidence-status.test.ts",
  "apps/studio/src/lib/data-os/signal-topic-evaluation.ts",
  "docs/api/openapi.yaml",
  "docs/product/72_TOPIC_EVALUATION_FULL_EVIDENCE_CONTROL_PLANE.md",
  "infrastructure/db/migrations/0114_signal_topic_evaluation_v2_execution_outbox.sql",
  "infrastructure/db/schema/index.ts",
  "infrastructure/db/scripts/release-signal-topic-evaluation-v2-outbox.test.ts",
  "infrastructure/db/scripts/release-signal-topic-evaluation-v2-outbox.ts",
  "infrastructure/db/signal-topic-evaluation-v2-execution.postgres.test.ts",
  "infrastructure/db/signal-topic-evaluation-v2.ts",
  "services/workers/src/index.ts",
  "services/workers/src/workers/signal-topic-evaluation-v2-outbox.test.ts",
  "services/workers/src/workers/signal-topic-evaluation-v2-outbox.ts",
  "services/workers/src/workers/signal-topic-evaluation-v2.ts",
  "services/workers/src/workers/uat-runtime-preflight.test.ts",
  "services/workers/src/workers/uat-runtime-preflight.ts"
] as const;

type Mode = "preflight" | "capture" | "apply" | "verify";
type Attestation = {
  contract_version: "signal-topic-evaluation-v2-0114-deployment-attestation-v1";
  recorded_at: string;
  phase: "pre_apply" | "post_apply";
  environment: "Preview/UAT" | "local-disposable";
  target_fingerprint: string;
  release_commit: string;
  allowlist_digest: string;
  studio: { deployment_id: string; deployed_commit: string; deep_health_status: number };
  workers: {
    deployment_id_before: string;
    deployment_id_current: string;
    deployed_commit: string;
    health_status: number;
    v2_job_registered: boolean;
  };
};

type RunnerContext = {
  mode: Mode;
  localRehearsal: boolean;
  evidenceDir: string;
  databaseTarget: SealedDatabaseTarget;
  releaseCommit: string;
  migrationSql: string;
  preAttestation: Attestation;
  preAttestationBytes: Buffer;
};

export type SealedDatabaseTarget = Readonly<{
  protocol: "postgresql:";
  hostname: string;
  port: number;
  username: string;
  password: string;
  database: string;
  sslMode: "disable" | "require";
  fingerprint: string;
}>;

export function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(",")}}`;
}

export function digest(value: string | Buffer) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function allowlistDigest() {
  return digest(`${[...SIGNAL_TOPIC_EVALUATION_V2_0114_RELEASE_ALLOWLIST].sort().join("\n")}\n`);
}

export function canonicalizeDatabaseTarget(value: string, localRehearsal: boolean): SealedDatabaseTarget {
  const url = new URL(value);
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol) || url.hash) {
    throw new Error("The database target must be a canonical PostgreSQL URI without a fragment.");
  }
  const queryEntries = [...url.searchParams.entries()];
  const allowedSslMode = localRehearsal ? "disable" : "require";
  if (queryEntries.some(([key, entryValue]) => key !== "sslmode" || entryValue !== allowedSslMode)
      || queryEntries.filter(([key]) => key === "sslmode").length > 1) {
    throw new Error("Database URI query routing overrides are forbidden.");
  }
  const hostname = url.hostname.toLowerCase();
  const port = Number(url.port || "5432");
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const database = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  if (!hostname || !username || !database || database.includes("/")
      || !Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("The canonical PostgreSQL target authority is incomplete.");
  }
  const fingerprint = digest(["postgresql:", hostname, String(port), database, username].join("|"));
  return Object.freeze({ protocol: "postgresql:", hostname, port, username, password, database,
    sslMode: localRehearsal ? "disable" : "require", fingerprint });
}

export function databaseTargetFingerprint(value: string, localRehearsal = false) {
  return canonicalizeDatabaseTarget(value, localRehearsal).fingerprint;
}

export function postgresClientConfiguration(target: SealedDatabaseTarget, applicationName: string): pg.ClientConfig {
  return { host: target.hostname, port: target.port, user: target.username, password: target.password,
    database: target.database, ssl: target.sslMode === "disable" ? false : { rejectUnauthorized: false },
    application_name: applicationName };
}

export function pgDumpConnectionEnvironment(target: SealedDatabaseTarget) {
  return { PGHOST: target.hostname, PGPORT: String(target.port), PGUSER: target.username,
    PGDATABASE: target.database, PGSSLMODE: target.sslMode };
}

export function validateAttestation(args: {
  value: unknown;
  phase: Attestation["phase"];
  localRehearsal: boolean;
  targetFingerprint: string;
  releaseCommit: string;
  workersDeploymentBefore?: string;
}) {
  const value = args.value as Partial<Attestation> | null;
  const expectedEnvironment = args.localRehearsal ? "local-disposable" : "Preview/UAT";
  if (!value || value.contract_version !== "signal-topic-evaluation-v2-0114-deployment-attestation-v1"
      || value.phase !== args.phase || value.environment !== expectedEnvironment
      || value.target_fingerprint !== args.targetFingerprint || value.release_commit !== args.releaseCommit
      || value.allowlist_digest !== allowlistDigest()) {
    throw new Error("The sealed 0114 deployment attestation is invalid.");
  }
  assertFresh(value.recorded_at);
  if (!value.studio || !value.workers || !Number.isInteger(value.studio.deep_health_status)
      || !Number.isInteger(value.workers.health_status) || value.workers.v2_job_registered !== false
      || !value.studio.deployment_id || !value.workers.deployment_id_before
      || !value.workers.deployment_id_current || !value.studio.deployed_commit
      || !value.workers.deployed_commit) {
    throw new Error("The sealed 0114 service attestation is incomplete.");
  }
  if (args.phase === "pre_apply") {
    if (value.studio.deployed_commit !== BASE_COMMIT || value.workers.deployed_commit !== BASE_COMMIT
        || value.workers.deployment_id_before !== value.workers.deployment_id_current
        || value.studio.deep_health_status !== 200 || value.workers.health_status !== 200) {
      throw new Error("The 0114 pre-apply service baseline is not healthy and inert.");
    }
  } else if (value.studio.deployed_commit !== args.releaseCommit
      || value.workers.deployed_commit !== BASE_COMMIT
      || value.workers.deployment_id_before !== value.workers.deployment_id_current
      || value.workers.deployment_id_before !== args.workersDeploymentBefore
      || value.studio.deep_health_status !== 200 || value.workers.health_status !== 200) {
    throw new Error("The 0114 post-apply Studio/Workers reconciliation is invalid.");
  }
  return value as Attestation;
}

export function assertFresh(recordedAt: unknown, now = Date.now()) {
  if (typeof recordedAt !== "string") throw new Error("The sealed receipt timestamp is missing.");
  const timestamp = Date.parse(recordedAt);
  if (!Number.isFinite(timestamp) || timestamp > now + 60_000 || now - timestamp > RECEIPT_MAX_AGE_MS) {
    throw new Error("The sealed 0114 receipt is stale.");
  }
}

export async function runSignalTopicEvaluationV20114Release(env: NodeJS.ProcessEnv, argv: string[]) {
  const context = await loadContext(env, argv);
  const client = new pg.Client(postgresClientConfiguration(context.databaseTarget,
    `noisia-topic-evaluation-0114-${context.mode}`));
  await client.connect();
  try {
    await client.query("SET statement_timeout='15min'");
    await client.query("SET lock_timeout='30s'");
    if (context.mode === "preflight" || context.mode === "verify") {
      await readOnly(client, context, env);
    } else if (context.mode === "capture") {
      await capture(client, context, env);
    } else {
      await apply(client, context, env);
    }
  } finally {
    await client.end();
  }
}

async function loadContext(env: NodeJS.ProcessEnv, argv: string[]): Promise<RunnerContext> {
  const mode = argv[2] as Mode | undefined;
  if (!mode || !new Set<Mode>(["preflight", "capture", "apply", "verify"]).has(mode)) {
    throw new Error("Mode must be preflight, capture, apply or verify.");
  }
  const localRehearsal = env[`${ENV_PREFIX}_LOCAL_REHEARSAL`] === "true";
  const evidenceDir = required(env, `${ENV_PREFIX}_EVIDENCE_DIR`);
  const databaseUrl = required(env, `${ENV_PREFIX}_DATABASE_URL`);
  if (env[`${ENV_PREFIX}_PG_TOOL_HOST`] !== undefined || env[`${ENV_PREFIX}_PG_TOOL_PORT`] !== undefined) {
    throw new Error("Alternate pg_dump host or port overrides are forbidden.");
  }
  const databaseTarget = canonicalizeDatabaseTarget(databaseUrl, localRehearsal);
  if (localRehearsal && !new Set(["127.0.0.1", "localhost", "::1"]).has(databaseTarget.hostname)) {
    throw new Error("Local rehearsal requires an explicitly loopback PostgreSQL target.");
  }
  const targetFingerprint = databaseTarget.fingerprint;
  if (!localRehearsal && targetFingerprint !== EXPECTED.uatTargetFingerprint) {
    throw new Error("The configured database is not the sealed Preview/UAT target.");
  }
  const releaseCommit = required(env, `${ENV_PREFIX}_RELEASE_COMMIT`);
  assertReleaseAllowlist(releaseCommit, localRehearsal);
  const migrationSql = await readFile(MIGRATION_PATH, "utf8");
  if (digest(migrationSql) !== EXPECTED.migration0114) throw new Error("0114 migration checksum mismatch.");
  const preAttestationPath = required(env, `${ENV_PREFIX}_PRE_ATTESTATION_PATH`);
  assertPrivateFile(preAttestationPath);
  const preAttestationBytes = await readFile(preAttestationPath);
  const preAttestation = validateAttestation({ value: JSON.parse(preAttestationBytes.toString("utf8")),
    phase: "pre_apply", localRehearsal, targetFingerprint, releaseCommit });
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  await chmod(evidenceDir, 0o700);
  return { mode, localRehearsal, evidenceDir, databaseTarget, releaseCommit,
    migrationSql, preAttestation, preAttestationBytes };
}

export function assertReleaseAllowlist(releaseCommit: string, localRehearsal: boolean) {
  const expected = [...SIGNAL_TOPIC_EVALUATION_V2_0114_RELEASE_ALLOWLIST].sort();
  if (localRehearsal && releaseCommit === "WORKTREE") {
    const committed = gitLines(["diff", "--name-only", `${BASE_COMMIT}..HEAD`]);
    const unexpected = committed.filter((path) => !expected.includes(path as never));
    if (unexpected.length) throw new Error("The local 0114 release range contains a path outside the allowlist.");
    for (const path of expected) if (!existsSync(resolve(ROOT, path))) {
      throw new Error(`The local 0114 allowlist path is missing: ${path}`);
    }
    return;
  }
  if (!/^[0-9a-f]{40}$/u.test(releaseCommit)) throw new Error("The release commit must be a full Git SHA.");
  const actual = gitLines(["diff", "--name-only", `${BASE_COMMIT}..${releaseCommit}`]).sort();
  if (stable(actual) !== stable(expected)) throw new Error("The release commit does not match the sealed 0114 allowlist.");
}

async function readOnly(client: pg.Client, context: RunnerContext, env: NodeJS.ProcessEnv) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const state = await inspect(client);
    const expectedState = context.mode === "preflight" ? "absent" : "complete";
    if (state.migration_state !== expectedState) {
      throw new Error(`${context.mode} expected 0114 ${expectedState}, found ${state.migration_state}.`);
    }
    assertInvariantState(state);
    let verification: Attestation | undefined;
    let verificationDigest: string | undefined;
    let applyDigest: string | undefined;
    if (context.mode === "verify") {
      const applyBytes = await readPrivateReceipt(context.evidenceDir, "apply.sanitized.json");
      const applyReceipt = JSON.parse(applyBytes.toString("utf8"));
      if (applyReceipt.mode !== "apply" || applyReceipt.action !== "applied_exactly_once"
          || applyReceipt.state?.migration_state !== "complete"
          || applyReceipt.release?.commit !== context.releaseCommit
          || applyReceipt.target?.target_fingerprint !== context.databaseTarget.fingerprint
          || applyReceipt.pre_attestation_sha256 !== digest(context.preAttestationBytes)) {
        throw new Error("Verify requires the exact sealed 0114 apply receipt.");
      }
      applyDigest = digest(applyBytes);
      const path = required(env, `${ENV_PREFIX}_POST_ATTESTATION_PATH`);
      assertPrivateFile(path);
      const bytes = await readFile(path);
      verification = validateAttestation({ value: JSON.parse(bytes.toString("utf8")), phase: "post_apply",
        localRehearsal: context.localRehearsal, targetFingerprint: context.databaseTarget.fingerprint,
        releaseCommit: context.releaseCommit,
        workersDeploymentBefore: context.preAttestation.workers.deployment_id_before });
      verificationDigest = digest(bytes);
    }
    const txid = (await client.query<{ value: string | null }>(
      "SELECT txid_current_if_assigned()::text value")).rows[0]?.value;
    if (txid !== null) throw new Error("Read-only migration probe unexpectedly received a transaction id.");
    await client.query("ROLLBACK");
    await emit(context.evidenceDir, `${context.mode}.sanitized.json`, envelope(context, state, false, {
      pre_attestation_sha256: digest(context.preAttestationBytes),
      post_attestation_sha256: verificationDigest,
      apply_sha256: applyDigest,
      service_reconciliation: verification ? "healthy_studio_release__workers_unchanged_inert" : "pre_apply_inert"
    }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function capture(client: pg.Client, context: RunnerContext, env: NodeJS.ProcessEnv) {
  const preflightBytes = await readPrivateReceipt(context.evidenceDir, "preflight.sanitized.json");
  const preflight = JSON.parse(preflightBytes.toString("utf8"));
  assertFresh(preflight.recorded_at);
  if (preflight.mode !== "preflight" || preflight.writes_performed !== false
      || preflight.state?.migration_state !== "absent"
      || preflight.release?.commit !== context.releaseCommit
      || preflight.target?.target_fingerprint !== context.databaseTarget.fingerprint
      || preflight.pre_attestation_sha256 !== digest(context.preAttestationBytes)) {
    throw new Error("A fresh sealed 0114 preflight is required before restore capture.");
  }
  const dumpPath = resolve(context.evidenceDir, "preview-uat-before-0114.public.dump");
  if (existsSync(dumpPath)) throw new Error("Restore capture refuses to reuse an existing 0114 archive.");
  await runPgDump(context, env, dumpPath);
  const tocEntries = await verifyArchive(env, dumpPath);
  if (tocEntries < 3_000) throw new Error("Restore archive verification found too few table-of-contents entries.");

  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const after = await inspect(client);
    if (stable(after) !== stable(preflight.state)) throw new Error("Database changed during restore capture.");
    await client.query("ROLLBACK");
    await emit(context.evidenceDir, "restore.sanitized.json", {
      contract_version: "signal-topic-evaluation-v2-0114-restore-v1",
      recorded_at: new Date().toISOString(),
      target: publicTarget(context),
      release: releaseIdentity(context),
      preflight_sha256: digest(preflightBytes),
      pre_attestation_sha256: digest(context.preAttestationBytes),
      restore: { file: "preview-uat-before-0114.public.dump", sha256: await digestFile(dumpPath),
        bytes: statSync(dumpPath).size, toc_entries: tocEntries,
        complete_archive_stream_verified: true, recoverable: true },
      frozen_snapshot: after.frozen_snapshot,
      protected_state: after.protected_state,
      writes_performed: false,
      production_accessed: false
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function apply(client: pg.Client, context: RunnerContext, env: NodeJS.ProcessEnv) {
  if (env[`${ENV_PREFIX}_APPLY_APPROVED`] !== APPROVAL_LITERAL) {
    throw new Error("Apply requires the exact 0114 operator approval literal.");
  }
  const preflightBytes = await readPrivateReceipt(context.evidenceDir, "preflight.sanitized.json");
  const restoreBytes = await readPrivateReceipt(context.evidenceDir, "restore.sanitized.json");
  if (env[`${ENV_PREFIX}_PREFLIGHT_SHA256`] !== digest(preflightBytes)
      || env[`${ENV_PREFIX}_RESTORE_SHA256`] !== digest(restoreBytes)) {
    throw new Error("Apply requires the exact fresh preflight and restore receipt hashes.");
  }
  const preflight = JSON.parse(preflightBytes.toString("utf8"));
  const restore = JSON.parse(restoreBytes.toString("utf8"));
  assertFresh(preflight.recorded_at);
  assertFresh(restore.recorded_at);
  if (preflight.state?.migration_state !== "absent" || restore.restore?.recoverable !== true
      || restore.restore?.file !== "preview-uat-before-0114.public.dump"
      || typeof restore.restore?.sha256 !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(restore.restore.sha256)
      || !Number.isSafeInteger(restore.restore?.bytes) || restore.restore.bytes <= 0
      || preflight.target?.target_fingerprint !== context.databaseTarget.fingerprint
      || restore.target?.target_fingerprint !== context.databaseTarget.fingerprint
      || restore.preflight_sha256 !== digest(preflightBytes)
      || preflight.pre_attestation_sha256 !== digest(context.preAttestationBytes)
      || restore.pre_attestation_sha256 !== digest(context.preAttestationBytes)
      || stable(preflight.state.frozen_snapshot) !== stable(restore.frozen_snapshot)
      || stable(preflight.state.protected_state) !== stable(restore.protected_state)) {
    throw new Error("The sealed 0114 apply preconditions are not satisfied.");
  }
  const restoreArchive = resolve(context.evidenceDir, String(restore.restore.file));
  assertPrivateFile(restoreArchive);
  if (await digestFile(restoreArchive) !== restore.restore.sha256
      || statSync(restoreArchive).size !== restore.restore.bytes) {
    throw new Error("The sealed 0114 restore archive no longer matches its receipt.");
  }

  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "noisia:signal-topic-evaluation-v2:0114"
    ]);
    const before = await inspect(client);
    if (before.migration_state !== "absent" || stable(before) !== stable(preflight.state)) {
      throw new Error("0114 preflight state drifted while acquiring the migration lock.");
    }
    assertInvariantState(before);
    await client.query(context.migrationSql);
    const partial = await inspect(client);
    if (partial.migration_state !== "partial") throw new Error("0114 sentinels failed before ledger registration.");
    await client.query(`INSERT INTO signal_workspace_data_plane_migration_ledger(
      migration_name, ordinal, checksum_sha256, disposition, runner_version, target_fingerprint
    ) VALUES($1,114,$2,'applied','topic-evaluation-v2-0114-release-v1',$3)`,
    [MIGRATION_FILE, EXPECTED.migration0114, context.databaseTarget.fingerprint]);
    const after = await inspect(client);
    if (after.migration_state !== "complete") throw new Error("0114 ledger or sentinel verification failed.");
    assertInvariantState(after);
    if (stable(before.frozen_snapshot) !== stable(after.frozen_snapshot)
        || stable(before.protected_state) !== stable(after.protected_state)) {
      throw new Error("0114 changed frozen Topic authority or protected serving state.");
    }
    await client.query("COMMIT");
    await emit(context.evidenceDir, "apply.sanitized.json", envelope(context, after, true, {
      action: "applied_exactly_once", preflight_sha256: digest(preflightBytes),
      restore_sha256: digest(restoreBytes), pre_attestation_sha256: digest(context.preAttestationBytes)
    }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function inspect(client: pg.Client) {
  const ledger = (await client.query<{ ordinal: number; migration_name: string; checksum_sha256: string; disposition: string }>(`
    SELECT ordinal,migration_name,checksum_sha256,disposition
    FROM signal_workspace_data_plane_migration_ledger WHERE ordinal BETWEEN 112 AND 114 ORDER BY ordinal
  `)).rows.map((row) => ({ ...row, ordinal: Number(row.ordinal) }));
  const sentinels = (await client.query<Record<string, boolean>>(`SELECT
    to_regclass('signal_topic_evaluation_v2_execution_outbox') IS NOT NULL outbox_table,
    to_regprocedure('protect_signal_topic_evaluation_v2_execution_outbox_v1()') IS NOT NULL outbox_protector,
    EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public'
      AND tablename='signal_topic_evaluation_v2_execution_outbox'
      AND indexname='idx_signal_topic_evaluation_v2_execution_outbox_pending') pending_index,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conname='uq_signal_topic_evaluation_v2_execution_outbox_authorization') authority_unique,
    EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_protect_signal_topic_evaluation_v2_execution_outbox'
      AND NOT tgisinternal) outbox_protector_trigger,
    EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_validate_signal_topic_evaluation_v2_execution_outbox_pair'
      AND NOT tgisinternal) outbox_pair_trigger,
    position('outbox_status' in COALESCE(pg_get_functiondef(
      to_regprocedure('validate_signal_topic_evaluation_v2_execution_pair_v1()')),''))>0 pair_validator_includes_outbox
  `)).rows[0] ?? {};
  const frozenSnapshot = (await client.query(`SELECT
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_snapshots) snapshots,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_clusters) clusters,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_cluster_memberships) memberships,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_cluster_memberships WHERE assignment_label>=0) assigned,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_cluster_memberships WHERE assignment_label=-1) outliers,
    (SELECT COALESCE(json_agg(json_build_object('snapshot_digest',snapshot_digest,'rights_digest',rights_digest)
      ORDER BY snapshot_digest),'[]'::json) FROM signal_topic_evaluation_v2_snapshots) digests
  `)).rows[0]!;
  const outboxExists = Boolean(sentinels.outbox_table);
  const evaluation = (await client.query(`SELECT
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_execution_authorizations) authorities,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_runs WHERE execution_authorization_id IS NOT NULL) runs,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_retrievals) retrievals,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_model_turns) model_turns,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidates) candidates,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_candidate_evidence) candidate_evidence,
    (SELECT count(*)::int FROM signal_topic_evaluation_v2_rankings) rankings,
    (SELECT COALESCE(sum(provider_call_count),0)::int FROM signal_topic_evaluation_v2_runs
      WHERE execution_authorization_id IS NOT NULL) provider_calls
  `)).rows[0]! as Record<string, number>;
  evaluation.outboxes = outboxExists ? Number((await client.query<{ count: number }>(
    "SELECT count(*)::int count FROM signal_topic_evaluation_v2_execution_outbox")).rows[0]?.count ?? 0) : 0;
  const protectedCounts = (await client.query(`SELECT
    (SELECT count(*)::int FROM signal_workspaces) workspaces,
    (SELECT count(*)::int FROM mentions) mentions,
    (SELECT count(*)::int FROM signal_workspace_population_pointers) pointers,
    (SELECT count(*)::int FROM signal_governed_view_bindings) bindings,
    (SELECT count(*)::int FROM signal_semantic_context_generations) generations
  `)).rows[0]!;
  const pointerRows = (await client.query(
    "SELECT to_jsonb(value) row FROM signal_workspace_population_pointers value ORDER BY id")).rows;
  const bindingRows = (await client.query(
    "SELECT to_jsonb(value) row FROM signal_governed_view_bindings value ORDER BY id")).rows;
  const row = (ordinal: number) => ledger.find((entry) => entry.ordinal === ordinal);
  const valid = (ordinal: number, name: string, checksum: string) => row(ordinal)?.migration_name === name
    && row(ordinal)?.checksum_sha256 === checksum && row(ordinal)?.disposition === "applied";
  const allSentinels = Object.values(sentinels).every(Boolean);
  const exclusiveSentinelsAbsent = ["outbox_table", "outbox_protector", "pending_index", "authority_unique",
    "outbox_protector_trigger", "outbox_pair_trigger"].every((key) => sentinels[key] === false);
  const migration0114Valid = valid(114, MIGRATION_FILE, EXPECTED.migration0114);
  const migration_state = !row(114) && exclusiveSentinelsAbsent && sentinels.pair_validator_includes_outbox === false
    ? "absent" : migration0114Valid && allSentinels ? "complete" : "partial";
  return {
    migration_state,
    predecessors_valid: valid(112, "0112_signal_topic_evaluation_full_evidence_control_plane.sql", EXPECTED.migration0112)
      && valid(113, "0113_signal_topic_evaluation_full_evidence_execution_authority.sql", EXPECTED.migration0113),
    ledger, sentinels, frozen_snapshot: frozenSnapshot, evaluation,
    protected_state: { digest: digest(stable({ counts: protectedCounts, pointers: pointerRows, bindings: bindingRows })) }
  };
}

function assertInvariantState(state: Awaited<ReturnType<typeof inspect>>) {
  if (!state.predecessors_valid) throw new Error("0112/0113 ledger prerequisites are invalid.");
  const expectedSnapshot = { snapshots: 1, clusters: 116, memberships: 21195, assigned: 11186, outliers: 10009 };
  for (const [key, value] of Object.entries(expectedSnapshot)) {
    if (Number((state.frozen_snapshot as Record<string, unknown>)[key]) !== value) {
      throw new Error(`Frozen Topic snapshot ${key} did not match the sealed authority.`);
    }
  }
  for (const key of ["authorities", "runs", "outboxes", "retrievals", "model_turns", "candidates",
    "candidate_evidence", "rankings", "provider_calls"]) {
    if (Number((state.evaluation as Record<string, unknown>)[key]) !== 0) {
      throw new Error(`Topic Evaluation V2 ${key} must remain zero for the 0114 cut.`);
    }
  }
  const expectedProtected = EXPECTED.protectedDigest;
  if (state.protected_state.digest !== expectedProtected) throw new Error("Protected-state digest mismatch.");
}

async function runPgDump(context: RunnerContext, env: NodeJS.ProcessEnv, destination: string) {
  const target = context.databaseTarget;
  const container = env[`${ENV_PREFIX}_PG_TOOL_CONTAINER`];
  const password = target.password;
  if (/\r|\n/u.test(password)) throw new Error("The database password cannot be safely supplied to pg_dump.");
  const args = ["--format=custom", "--no-owner", "--no-acl", "--schema=public"];
  const connectionEnv = pgDumpConnectionEnvironment(target);
  if (container) {
    await spawnToFile("docker", ["exec", "-i", ...Object.entries(connectionEnv).flatMap(([key, value]) =>
      ["-e", `${key}=${value}`]), container, "sh", "-ceu",
    "IFS= read -r PGPASSWORD; export PGPASSWORD; exec pg_dump \"$@\"", "sh", ...args], destination, `${password}\n`);
  } else {
    await spawnToFile(env[`${ENV_PREFIX}_PG_DUMP_COMMAND`] ?? "pg_dump", args, destination, undefined,
      { ...connectionEnv, PGPASSWORD: password });
  }
  await chmod(destination, 0o600);
}

async function verifyArchive(env: NodeJS.ProcessEnv, source: string) {
  const container = env[`${ENV_PREFIX}_PG_TOOL_CONTAINER`];
  const command = container ? "docker" : env[`${ENV_PREFIX}_PG_RESTORE_COMMAND`] ?? "pg_restore";
  const args = container ? ["exec", "-i", container, "pg_restore", "--list"] : ["--list"];
  const output = await spawnWithInput(command, args, source);
  return output.split("\n").filter((line) => /^\d+;/u.test(line)).length;
}

function spawnToFile(command: string, args: string[], destination: string, stdin?: string,
  environment?: Record<string, string>) {
  return new Promise<void>((resolvePromise, reject) => {
    const output = createWriteStream(destination, { mode: 0o600 });
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"],
      env: environment ? { ...process.env, ...environment } : process.env });
    let stderr = "";
    child.stdin.end(stdin);
    child.stdout.pipe(output);
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => output.end(() => {
      if (code === 0) resolvePromise();
      else { void unlink(destination).catch(() => undefined);
        reject(new Error(`${command} dump failed (${code}): ${redact(stderr).slice(0, 500)}`)); }
    }));
  });
}

function spawnWithInput(command: string, args: string[], source: string) {
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    const input = createReadStream(source);
    input.on("error", reject);
    child.stdin.on("error", (error: NodeJS.ErrnoException) => { if (error.code !== "EPIPE") reject(error); });
    input.pipe(child.stdin);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolvePromise(stdout)
      : reject(new Error(`${command} restore verification failed (${code}): ${redact(stderr).slice(0, 500)}`)));
  });
}

async function readPrivateReceipt(directory: string, name: string) {
  const path = resolve(directory, name);
  assertPrivateFile(path);
  return readFile(path);
}

function assertPrivateFile(path: string) {
  const stat = statSync(path);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error("Sealed release artifacts must be mode 0600.");
}

async function emit(directory: string, name: string, value: Record<string, unknown>) {
  const path = resolve(directory, name);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await writeFile(path, bytes, { mode: 0o600 });
  await chmod(path, 0o600);
  console.log(JSON.stringify({ artifact: name, sha256: digest(bytes), mode: value.mode ?? value.contract_version }));
}

function envelope(context: RunnerContext, state: Record<string, unknown>, writes: boolean,
  extra: Record<string, unknown>) {
  return {
    contract_version: "signal-topic-evaluation-v2-0114-release-v1", mode: context.mode,
    recorded_at: new Date().toISOString(), target: publicTarget(context), release: releaseIdentity(context),
    writes_performed: writes, provider_calls_added: 0, queues_added: 0, runs_added: 0,
    topic_candidates_added: 0, topic_adoptions_added: 0, publications_added: 0,
    serving_effects: 0, production_accessed: false, ...extra, state
  };
}

function publicTarget(context: RunnerContext) {
  return { environment: context.localRehearsal ? "local-disposable" : "Preview/UAT",
    target_fingerprint: context.databaseTarget.fingerprint, production_accessed: false };
}

function releaseIdentity(context: RunnerContext) {
  return { base_commit: BASE_COMMIT, commit: context.releaseCommit, allowlist: [
    ...SIGNAL_TOPIC_EVALUATION_V2_0114_RELEASE_ALLOWLIST], allowlist_digest: allowlistDigest(),
    migration: MIGRATION_FILE, migration_sha256: EXPECTED.migration0114 };
}

function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function gitLines(args: string[]) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Git release verification failed: ${redact(result.stderr).slice(0, 300)}`);
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

async function digestFile(path: string) {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return `sha256:${hash.digest("hex")}`;
}

function redact(value: string) {
  return value.replace(/postgres(?:ql)?:\/\/[^\s]+/giu, "<redacted-url>");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await runSignalTopicEvaluationV20114Release(process.env, process.argv).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown sealed runner failure.";
    console.error(redact(message));
    process.exitCode = 1;
  });
}

import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import pg from "pg";

import {
  SIGNAL_TOPIC_EVALUATION_V2_0114_RELEASE_ALLOWLIST,
  allowlistDigest,
  assertFresh,
  databaseTargetFingerprint,
  digest,
  stable,
  validateAttestation
} from "./release-signal-topic-evaluation-v2-outbox";

const ROOT = resolve(import.meta.dirname, "../../..");
const SCRIPT = resolve(import.meta.dirname, "release-signal-topic-evaluation-v2-outbox.ts");
const BASE_COMMIT = "75f0873f0321b8f4cfb3e6105aefa5b2614784d5";
const PROTECTED_DIGEST = "sha256:5cf291ca7d426ead697b784080fe3b5380f39b4e3965441b8f4df9689645ffdc";
const PREFIX = "NOISIA_TOPIC_EVALUATION_V2_0114";
const DATABASE_URL = process.env.NOISIA_TOPIC_EVALUATION_V2_0114_RUNNER_URL;
const APPROVED = process.env.NOISIA_TOPIC_EVALUATION_V2_0114_RUNNER_APPROVED === "true";

function attestation(args: { phase: "pre_apply" | "post_apply"; fingerprint: string;
  releaseCommit?: string; workerDeployment?: string }) {
  const releaseCommit = args.releaseCommit ?? "WORKTREE";
  const workerDeployment = args.workerDeployment ?? "local-worker-unchanged";
  return {
    contract_version: "signal-topic-evaluation-v2-0114-deployment-attestation-v1" as const,
    recorded_at: new Date().toISOString(),
    phase: args.phase,
    environment: "local-disposable" as const,
    target_fingerprint: args.fingerprint,
    release_commit: releaseCommit,
    allowlist_digest: allowlistDigest(),
    studio: { deployment_id: args.phase === "pre_apply" ? "local-studio-before" : "local-studio-after",
      deployed_commit: args.phase === "pre_apply" ? BASE_COMMIT : releaseCommit, deep_health_status: 200 },
    workers: { deployment_id_before: workerDeployment, deployment_id_current: workerDeployment,
      deployed_commit: BASE_COMMIT, health_status: 200, v2_job_registered: false }
  };
}

test("0114 release helpers seal deterministic target, allowlist and freshness", () => {
  assert.match(databaseTargetFingerprint("postgresql://local@127.0.0.1:55439/db"), /^sha256:[0-9a-f]{64}$/u);
  assert.equal(SIGNAL_TOPIC_EVALUATION_V2_0114_RELEASE_ALLOWLIST.length, 19);
  assert.match(allowlistDigest(), /^sha256:[0-9a-f]{64}$/u);
  assert.equal(stable({ b: 2, a: [1] }), '{"a":[1],"b":2}');
  assert.equal(digest("sealed"), "sha256:c9d0036bed6744bcdf692fc980d8717d7e5f5a4f4e8266b4a84982602fb1cd09");
  assert.doesNotThrow(() => assertFresh(new Date().toISOString()));
  assert.throws(() => assertFresh(new Date(Date.now() - 3_600_001).toISOString()), /stale/u);
});

test("0114 deployment attestations distinguish pre-apply and post-apply service truth", () => {
  const fingerprint = databaseTargetFingerprint("postgresql://local@localhost:55439/db");
  const pre = attestation({ phase: "pre_apply", fingerprint });
  assert.equal(validateAttestation({ value: pre, phase: "pre_apply", localRehearsal: true,
    targetFingerprint: fingerprint, releaseCommit: "WORKTREE" }).phase, "pre_apply");
  const post = attestation({ phase: "post_apply", fingerprint });
  assert.equal(validateAttestation({ value: post, phase: "post_apply", localRehearsal: true,
    targetFingerprint: fingerprint, releaseCommit: "WORKTREE",
    workersDeploymentBefore: "local-worker-unchanged" }).phase, "post_apply");
  assert.throws(() => validateAttestation({ value: { ...pre, allowlist_digest: "sha256:forged" },
    phase: "pre_apply", localRehearsal: true, targetFingerprint: fingerprint,
    releaseCommit: "WORKTREE" }), /attestation is invalid/u);
  assert.throws(() => validateAttestation({ value: { ...post, workers: {
    ...post.workers, deployment_id_current: "changed-worker" } }, phase: "post_apply",
  localRehearsal: true, targetFingerprint: fingerprint, releaseCommit: "WORKTREE",
  workersDeploymentBefore: "local-worker-unchanged" }), /reconciliation is invalid/u);
});

test("0114 runner seals preflight, fresh restore, one locked apply and post-apply verification", {
  skip: !DATABASE_URL || !APPROVED,
  timeout: 20 * 60_000
}, async () => {
  assert.ok(DATABASE_URL);
  const url = new URL(DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(url.hostname), "runner proof is local-only");
  const evidenceDir = await mkdtemp(resolve(tmpdir(), "noisia-0114-runner-"));
  const prePath = resolve(evidenceDir, "pre-attestation.private.json");
  const postPath = resolve(evidenceDir, "post-attestation.private.json");
  const fingerprint = databaseTargetFingerprint(DATABASE_URL);
  await writePrivate(prePath, attestation({ phase: "pre_apply", fingerprint }));
  await writePrivate(postPath, attestation({ phase: "post_apply", fingerprint }));
  const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: false, max: 2 });
  const protectedDigest = await loadProtectedDigest(pool);
  assert.equal(protectedDigest, PROTECTED_DIGEST, "the disposable clone retains the sealed protected digest");
  const common: NodeJS.ProcessEnv = {
    ...process.env,
    [`${PREFIX}_LOCAL_REHEARSAL`]: "true",
    [`${PREFIX}_DATABASE_URL`]: DATABASE_URL,
    [`${PREFIX}_EVIDENCE_DIR`]: evidenceDir,
    [`${PREFIX}_RELEASE_COMMIT`]: "WORKTREE",
    [`${PREFIX}_PRE_ATTESTATION_PATH`]: prePath,
    [`${PREFIX}_POST_ATTESTATION_PATH`]: postPath
  };
  if (process.env.NOISIA_TOPIC_EVALUATION_V2_0114_RUNNER_PG_TOOL_CONTAINER) {
    common[`${PREFIX}_PG_TOOL_CONTAINER`] = process.env.NOISIA_TOPIC_EVALUATION_V2_0114_RUNNER_PG_TOOL_CONTAINER;
    common[`${PREFIX}_PG_TOOL_HOST`] = process.env.NOISIA_TOPIC_EVALUATION_V2_0114_RUNNER_PG_TOOL_HOST ?? "127.0.0.1";
    common[`${PREFIX}_PG_TOOL_PORT`] = process.env.NOISIA_TOPIC_EVALUATION_V2_0114_RUNNER_PG_TOOL_PORT ?? url.port;
  }

  try {
    assert.equal((await execute("preflight", common)).code, 0);
    assert.equal((await execute("capture", common)).code, 0);
    const preflight = await readFile(resolve(evidenceDir, "preflight.sanitized.json"));
    const restore = await readFile(resolve(evidenceDir, "restore.sanitized.json"));
    assert.equal((await execute("apply", common)).code, 1, "missing literal approval fails before SQL");
    assert.equal(await migrationCount(pool), 0);
    const authorized = { ...common,
      [`${PREFIX}_APPLY_APPROVED`]: "APPLY_0114_EXACTLY_ONCE_TO_PREVIEW_UAT",
      [`${PREFIX}_PREFLIGHT_SHA256`]: digest(preflight),
      [`${PREFIX}_RESTORE_SHA256`]: digest(restore) };
    assert.equal((await execute("apply", { ...authorized,
      [`${PREFIX}_RESTORE_SHA256`]: "sha256:forged" })).code, 1, "receipt mismatch fails before SQL");
    assert.equal(await migrationCount(pool), 0);

    const concurrent = await Promise.all([execute("apply", authorized), execute("apply", authorized)]);
    assert.equal(concurrent.filter((result) => result.code === 0).length, 1,
      `exactly one concurrent apply succeeds: ${concurrent.map((result) => result.stderr).join(" | ")}`);
    assert.equal(concurrent.filter((result) => result.code === 1).length, 1);
    assert.equal(await migrationCount(pool), 1);
    assert.equal((await execute("apply", authorized)).code, 1, "replay is fail-safe and non-writing");
    assert.equal(await migrationCount(pool), 1);
    assert.equal((await execute("verify", common)).code, 0);

    const receipts = ["preflight.sanitized.json", "restore.sanitized.json", "apply.sanitized.json",
      "verify.sanitized.json", "preview-uat-before-0114.public.dump"];
    for (const name of receipts) assert.equal((await stat(resolve(evidenceDir, name))).mode & 0o077, 0,
      `${name} is private`);
    const verify = JSON.parse(await readFile(resolve(evidenceDir, "verify.sanitized.json"), "utf8"));
    assert.equal(verify.state.migration_state, "complete");
    assert.deepEqual(verify.state.frozen_snapshot, {
      snapshots: 1, clusters: 116, memberships: 21195, assigned: 11186, outliers: 10009,
      digests: verify.state.frozen_snapshot.digests
    });
    assert.deepEqual(verify.state.evaluation, { authorities: 0, runs: 0, retrievals: 0,
      model_turns: 0, candidates: 0, candidate_evidence: 0, rankings: 0, provider_calls: 0, outboxes: 0 });
    assert.equal(verify.state.protected_state.digest, protectedDigest);
    assert.equal(verify.service_reconciliation, "healthy_studio_release__workers_unchanged_inert");
    assert.equal(verify.production_accessed, false);
  } finally {
    await pool.end();
  }
});

async function loadProtectedDigest(pool: pg.Pool) {
  const counts = (await pool.query(`SELECT
    (SELECT count(*)::int FROM signal_workspaces) workspaces,
    (SELECT count(*)::int FROM mentions) mentions,
    (SELECT count(*)::int FROM signal_workspace_population_pointers) pointers,
    (SELECT count(*)::int FROM signal_governed_view_bindings) bindings,
    (SELECT count(*)::int FROM signal_semantic_context_generations) generations`)).rows[0];
  const pointers = (await pool.query(
    "SELECT to_jsonb(value) row FROM signal_workspace_population_pointers value ORDER BY id")).rows;
  const bindings = (await pool.query(
    "SELECT to_jsonb(value) row FROM signal_governed_view_bindings value ORDER BY id")).rows;
  return digest(stable({ counts, pointers, bindings }));
}

async function migrationCount(pool: pg.Pool) {
  return Number((await pool.query<{ count: number }>(
    "SELECT count(*)::int count FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=114"
  )).rows[0]?.count ?? 0);
}

async function writePrivate(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function execute(mode: string, env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolvePromise, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", SCRIPT, mode], { cwd: ROOT, env,
      stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

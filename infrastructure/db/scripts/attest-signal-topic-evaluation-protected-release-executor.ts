/**
 * Local capability attestor for a future protected Preview/UAT release executor.
 *
 * This module never opens a network connection and never invokes PostgreSQL tools. It only
 * verifies root-owned host evidence at fixed paths and emits a sanitized private receipt.
 * The actual 0114/0115 release remains a separate action-time gate.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

process.umask(0o077);

export const PROTECTED_RELEASE_EXECUTOR_PATHS_V1 = Object.freeze({
  policy: "/etc/noisia/topic-evaluation-v2-release-executor-v1.json",
  pg_dump: "/usr/bin/pg_dump",
  pg_restore: "/usr/bin/pg_restore",
  secret_attestation: "/run/noisia/topic-evaluation-v2-release-secret-v1.json",
  workers_attestation: "/run/noisia/topic-evaluation-v2-workers-posture-v1.json",
  restore_custody: "/var/lib/noisia/topic-evaluation-v2-release",
  receipt: "/var/lib/noisia/topic-evaluation-v2-release/capability-attestation-v1.json"
});

export const PROTECTED_RELEASE_EXECUTOR_APPROVAL_V1 =
  "ATTEST_PROTECTED_PREVIEW_UAT_EXECUTOR_FOR_0114_0115";
export const PROTECTED_RELEASE_EXECUTOR_SECRET_ENV_V1 =
  "NOISIA_TOPIC_EVALUATION_V2_0114_DATABASE_URL";
export const PROTECTED_RELEASE_EXECUTOR_TARGET_FINGERPRINT_V1 =
  "sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815";

const ENABLE_ENV = "NOISIA_PROTECTED_RELEASE_EXECUTOR_ATTESTATION_ENABLED";
const APPROVAL_ENV = "NOISIA_PROTECTED_RELEASE_EXECUTOR_APPROVAL";
const TARGET_ENV = "NOISIA_PROTECTED_RELEASE_EXECUTOR_TARGET_FINGERPRINT";
const FORBIDDEN_CALLER_SELECTORS = ["PGHOST","PGPORT","PGSERVICE","PGSERVICEFILE","PGPASSFILE",
  "PGSSLMODE","PGOPTIONS","DOCKER_HOST","NOISIA_PROTECTED_RELEASE_EXECUTOR_PG_DUMP",
  "NOISIA_PROTECTED_RELEASE_EXECUTOR_PG_RESTORE","NOISIA_PROTECTED_RELEASE_EXECUTOR_CONTAINER"];
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const MAX_ATTESTATION_AGE_MS = 15 * 60 * 1000;
const MAX_SECRET_LIFETIME_MS = 60 * 60 * 1000;

type FixedPolicyV1 = {
  contract_version: "noisia-protected-preview-uat-release-executor-policy-v1";
  environment: "Preview/UAT";
  production_allowed: false;
  target_fingerprint: string;
  toolchain: {
    mode: "fixed-root-owned-native";
    pg_dump_path: typeof PROTECTED_RELEASE_EXECUTOR_PATHS_V1.pg_dump;
    pg_dump_sha256: string;
    pg_restore_path: typeof PROTECTED_RELEASE_EXECUTOR_PATHS_V1.pg_restore;
    pg_restore_sha256: string;
    docker_fallback_allowed: false;
  };
  restore_custody: {
    directory: typeof PROTECTED_RELEASE_EXECUTOR_PATHS_V1.restore_custody;
    owner_uid: 0;
    mode: "0700";
  };
  secret_boundary: {
    env_name: typeof PROTECTED_RELEASE_EXECUTOR_SECRET_ENV_V1;
    scope: "preview-uat-topic-evaluation-0114-0115";
    max_lifetime_seconds: 3600;
    persistent_storage_allowed: false;
  };
  migrations: readonly [
    { ordinal: 114; name: "0114_signal_topic_evaluation_v2_execution_outbox.sql"; sha256: string },
    { ordinal: 115; name: "0115_signal_topic_evaluation_v2_candidate_review.sql"; sha256: string }
  ];
};

type SecretAttestationV1 = {
  contract_version: "noisia-protected-release-ephemeral-secret-v1";
  recorded_at: string;
  expires_at: string;
  environment: "Preview/UAT";
  target_fingerprint: string;
  scope: "preview-uat-topic-evaluation-0114-0115";
  env_name: typeof PROTECTED_RELEASE_EXECUTOR_SECRET_ENV_V1;
  single_process: true;
  child_environment_allowlisted: true;
  persistent_storage: false;
};

type WorkersAttestationV1 = {
  contract_version: "noisia-protected-release-workers-posture-v1";
  recorded_at: string;
  environment: "Preview/UAT";
  posture: "unchanged";
  deployment_digest_before: string;
  expected_deployment_digest_after: string;
  deployment_strategy: "protected-executor-studio-only";
  autodeploy_setting_mutation_allowed: false;
  watched_paths_intersection_acknowledged: true;
  health_status: 200;
  v2_job_registered: false;
};

export type ProtectedReleaseExecutorFileProbeV1 = {
  kind: "file" | "directory" | "other";
  uid: number;
  mode: number;
};

export type ProtectedReleaseExecutorDependenciesV1 = {
  now(): number;
  readJson(path: string): Promise<unknown>;
  probe(path: string): Promise<ProtectedReleaseExecutorFileProbeV1>;
  digestFile(path: string): Promise<string>;
  writePrivateReceipt(path: string, value: unknown): Promise<void>;
};

export async function attestProtectedReleaseExecutorCapabilityV1(args: {
  env: NodeJS.ProcessEnv;
  dependencies?: ProtectedReleaseExecutorDependenciesV1;
}) {
  const dependencies = args.dependencies ?? realDependencies;
  if (args.env[ENABLE_ENV] !== "true") {
    throw new Error("Protected release executor attestation is disabled by default.");
  }
  if (FORBIDDEN_CALLER_SELECTORS.some((name) => Object.hasOwn(args.env, name))) {
    throw new Error("Caller-selected tool, container or libpq routing is forbidden.");
  }
  if (args.env[APPROVAL_ENV] !== PROTECTED_RELEASE_EXECUTOR_APPROVAL_V1) {
    throw new Error("Protected executor attestation requires the exact action-time approval.");
  }
  if (args.env[TARGET_ENV] !== PROTECTED_RELEASE_EXECUTOR_TARGET_FINGERPRINT_V1) {
    throw new Error("Protected executor target is not the sealed Preview/UAT allowlist entry.");
  }
  const secretHandle = args.env[PROTECTED_RELEASE_EXECUTOR_SECRET_ENV_V1];
  if (!Object.hasOwn(args.env, PROTECTED_RELEASE_EXECUTOR_SECRET_ENV_V1)
      || typeof secretHandle !== "string" || secretHandle.trim().length === 0) {
    throw new Error("The UAT-only ephemeral secret handle is absent or blank.");
  }

  await assertRootOwnedFile(dependencies, PROTECTED_RELEASE_EXECUTOR_PATHS_V1.policy, false);
  const policy = parsePolicy(await dependencies.readJson(PROTECTED_RELEASE_EXECUTOR_PATHS_V1.policy));
  if (policy.target_fingerprint !== args.env[TARGET_ENV]) {
    throw new Error("Protected executor policy and target fingerprint disagree.");
  }
  await assertRootOwnedExecutable(dependencies, policy.toolchain.pg_dump_path,
    policy.toolchain.pg_dump_sha256);
  await assertRootOwnedExecutable(dependencies, policy.toolchain.pg_restore_path,
    policy.toolchain.pg_restore_sha256);
  await assertPrivateDirectory(dependencies, policy.restore_custody.directory);

  await assertRootOwnedFile(dependencies, PROTECTED_RELEASE_EXECUTOR_PATHS_V1.secret_attestation, false);
  const secret = parseSecretAttestation(await dependencies.readJson(
    PROTECTED_RELEASE_EXECUTOR_PATHS_V1.secret_attestation), dependencies.now());
  if (secret.target_fingerprint !== policy.target_fingerprint) {
    throw new Error("Ephemeral secret attestation targets a different environment.");
  }

  await assertRootOwnedFile(dependencies, PROTECTED_RELEASE_EXECUTOR_PATHS_V1.workers_attestation, false);
  const workers = parseWorkersAttestation(await dependencies.readJson(
    PROTECTED_RELEASE_EXECUTOR_PATHS_V1.workers_attestation), dependencies.now());

  const receipt = {
    contract_version: "noisia-protected-preview-uat-release-executor-capability-v1" as const,
    recorded_at: new Date(dependencies.now()).toISOString(),
    capability: "attested" as const,
    environment: "Preview/UAT" as const,
    production_allowed: false as const,
    target_fingerprint: policy.target_fingerprint,
    toolchain: { mode: policy.toolchain.mode,
      pg_dump: { path: policy.toolchain.pg_dump_path, sha256: policy.toolchain.pg_dump_sha256,
        owner_uid: 0, group_or_world_writable: false },
      pg_restore: { path: policy.toolchain.pg_restore_path, sha256: policy.toolchain.pg_restore_sha256,
        owner_uid: 0, group_or_world_writable: false },
      docker_fallback_allowed: false as const },
    secret_boundary: { env_name: secret.env_name, scope: secret.scope,
      expires_at: secret.expires_at, value_observed: false as const,
      persistent_storage: false as const },
    restore_custody: policy.restore_custody,
    action_time_approval: "accepted" as const,
    workers_posture: { posture: workers.posture,
      deployment_digest_before: workers.deployment_digest_before,
      expected_deployment_digest_after: workers.expected_deployment_digest_after,
      deployment_strategy: workers.deployment_strategy,
      autodeploy_setting_mutation_allowed: workers.autodeploy_setting_mutation_allowed,
      v2_job_registered: workers.v2_job_registered },
    migrations: policy.migrations,
    database_connections: 0,
    network_requests: 0,
    migrations_applied: 0,
    provider_calls: 0,
    product_writes: 0,
    production_accessed: false as const
  };
  if (resolve(dirname(PROTECTED_RELEASE_EXECUTOR_PATHS_V1.receipt))
      !== resolve(policy.restore_custody.directory)) {
    throw new Error("Protected executor receipt parent is outside private restore custody.");
  }
  // Re-probe immediately before receipt creation so a non-directory replacement cannot inherit
  // the earlier custody attestation. The root-owned 0700 parent excludes non-root path swaps.
  await assertPrivateDirectory(dependencies, policy.restore_custody.directory);
  await dependencies.writePrivateReceipt(PROTECTED_RELEASE_EXECUTOR_PATHS_V1.receipt, receipt);
  return receipt;
}

function parsePolicy(value: unknown): FixedPolicyV1 {
  const policy = strictObject(value, ["contract_version","environment","production_allowed",
    "target_fingerprint","toolchain","restore_custody","secret_boundary","migrations"]);
  const tools = strictObject(policy.toolchain, ["mode","pg_dump_path","pg_dump_sha256",
    "pg_restore_path","pg_restore_sha256","docker_fallback_allowed"]);
  const custody = strictObject(policy.restore_custody, ["directory","owner_uid","mode"]);
  const secret = strictObject(policy.secret_boundary, ["env_name","scope","max_lifetime_seconds",
    "persistent_storage_allowed"]);
  const migrations = Array.isArray(policy.migrations) ? policy.migrations : [];
  if (policy.contract_version !== "noisia-protected-preview-uat-release-executor-policy-v1"
      || policy.environment !== "Preview/UAT" || policy.production_allowed !== false
      || policy.target_fingerprint !== PROTECTED_RELEASE_EXECUTOR_TARGET_FINGERPRINT_V1
      || tools.mode !== "fixed-root-owned-native"
      || tools.pg_dump_path !== PROTECTED_RELEASE_EXECUTOR_PATHS_V1.pg_dump
      || tools.pg_restore_path !== PROTECTED_RELEASE_EXECUTOR_PATHS_V1.pg_restore
      || !DIGEST.test(String(tools.pg_dump_sha256)) || !DIGEST.test(String(tools.pg_restore_sha256))
      || tools.docker_fallback_allowed !== false
      || custody.directory !== PROTECTED_RELEASE_EXECUTOR_PATHS_V1.restore_custody
      || custody.owner_uid !== 0 || custody.mode !== "0700"
      || secret.env_name !== PROTECTED_RELEASE_EXECUTOR_SECRET_ENV_V1
      || secret.scope !== "preview-uat-topic-evaluation-0114-0115"
      || secret.max_lifetime_seconds !== 3600 || secret.persistent_storage_allowed !== false
      || migrations.length !== 2) {
    throw new Error("Protected executor root-owned policy is invalid.");
  }
  const expected = [[114,"0114_signal_topic_evaluation_v2_execution_outbox.sql",
    "sha256:f63774eae48b6fc3332feafdd8d033afeb8d4ae44d5479fd87ea44fa26e02582"],
  [115,"0115_signal_topic_evaluation_v2_candidate_review.sql",
    "sha256:7a6b61cc16dba808e0c98645855e2597db8d0f8ca4665979945c866a0bc3e946"]] as const;
  for (let index=0;index<expected.length;index++) {
    const migration = strictObject(migrations[index], ["ordinal","name","sha256"]);
    if (migration.ordinal !== expected[index]![0] || migration.name !== expected[index]![1]
        || migration.sha256 !== expected[index]![2]) {
      throw new Error("Protected executor migration allowlist is invalid.");
    }
  }
  return value as FixedPolicyV1;
}

function parseSecretAttestation(value: unknown, now: number): SecretAttestationV1 {
  const secret = strictObject(value, ["contract_version","recorded_at","expires_at","environment",
    "target_fingerprint","scope","env_name","single_process","child_environment_allowlisted",
    "persistent_storage"]);
  const recorded = Date.parse(String(secret.recorded_at));
  const expires = Date.parse(String(secret.expires_at));
  if (secret.contract_version !== "noisia-protected-release-ephemeral-secret-v1"
      || secret.environment !== "Preview/UAT"
      || secret.target_fingerprint !== PROTECTED_RELEASE_EXECUTOR_TARGET_FINGERPRINT_V1
      || secret.scope !== "preview-uat-topic-evaluation-0114-0115"
      || secret.env_name !== PROTECTED_RELEASE_EXECUTOR_SECRET_ENV_V1
      || secret.single_process !== true || secret.child_environment_allowlisted !== true
      || secret.persistent_storage !== false || !Number.isFinite(recorded) || !Number.isFinite(expires)
      || recorded > now + 60_000 || now-recorded > MAX_ATTESTATION_AGE_MS
      || expires <= now || expires-recorded > MAX_SECRET_LIFETIME_MS) {
    throw new Error("Protected executor ephemeral secret attestation is invalid or stale.");
  }
  return value as SecretAttestationV1;
}

function parseWorkersAttestation(value: unknown, now: number): WorkersAttestationV1 {
  const workers = strictObject(value, ["contract_version","recorded_at","environment","posture",
    "deployment_digest_before","expected_deployment_digest_after","deployment_strategy",
    "autodeploy_setting_mutation_allowed","watched_paths_intersection_acknowledged","health_status",
    "v2_job_registered"]);
  const recorded = Date.parse(String(workers.recorded_at));
  if (workers.contract_version !== "noisia-protected-release-workers-posture-v1"
      || workers.environment !== "Preview/UAT" || workers.posture !== "unchanged"
      || !DIGEST.test(String(workers.deployment_digest_before))
      || workers.expected_deployment_digest_after !== workers.deployment_digest_before
      || workers.deployment_strategy !== "protected-executor-studio-only"
      || workers.autodeploy_setting_mutation_allowed !== false
      || workers.watched_paths_intersection_acknowledged !== true || workers.health_status !== 200
      || workers.v2_job_registered !== false || !Number.isFinite(recorded)
      || recorded > now + 60_000 || now-recorded > MAX_ATTESTATION_AGE_MS) {
    throw new Error("Protected executor Workers posture is invalid or stale.");
  }
  return value as WorkersAttestationV1;
}

function strictObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join("\n") !== [...keys].sort().join("\n")) {
    throw new Error("Protected executor attestation object is not closed.");
  }
  return value as Record<string, unknown>;
}

async function assertRootOwnedFile(dependencies: ProtectedReleaseExecutorDependenciesV1,
  path: string, executable: boolean) {
  const probe = await dependencies.probe(path);
  if (probe.kind !== "file" || probe.uid !== 0 || (probe.mode & 0o022) !== 0
      || (executable && (probe.mode & 0o111) === 0)) {
    throw new Error("Protected executor fixed file ownership or mode is invalid.");
  }
}

async function assertRootOwnedExecutable(dependencies: ProtectedReleaseExecutorDependenciesV1,
  path: string, expectedDigest: string) {
  await assertRootOwnedFile(dependencies, path, true);
  if (await dependencies.digestFile(path) !== expectedDigest) {
    throw new Error("Protected executor fixed PostgreSQL tool fingerprint mismatch.");
  }
}

async function assertPrivateDirectory(dependencies: ProtectedReleaseExecutorDependenciesV1,path:string){
  const probe = await dependencies.probe(path);
  if (probe.kind !== "directory" || probe.uid !== 0 || (probe.mode & 0o777) !== 0o700) {
    throw new Error("Protected executor restore custody is not root-owned mode 0700.");
  }
}

const realDependencies: ProtectedReleaseExecutorDependenciesV1 = {
  now: () => Date.now(),
  readJson: async (path) => JSON.parse(await readFile(path,"utf8")),
  probe: async (path) => { const value=await lstat(path);return {
    kind:value.isFile()?"file":value.isDirectory()?"directory":"other",
    uid:value.uid,mode:value.mode}; },
  digestFile: async (path) => { const hash=createHash("sha256");await new Promise<void>((done,reject)=>{
    const stream=createReadStream(path);stream.on("data",(chunk)=>hash.update(chunk));
    stream.on("error",reject);stream.on("end",done);});return `sha256:${hash.digest("hex")}`; },
  writePrivateReceipt: async (path,value) => {
    await writeFile(path,`${JSON.stringify(value,null,2)}\n`,{mode:0o600,flag:"wx"});
  }
};

const isMain=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isMain){await attestProtectedReleaseExecutorCapabilityV1({env:process.env}).then((receipt)=>{
  console.log(JSON.stringify({contract_version:receipt.contract_version,capability:receipt.capability,
    target_fingerprint:receipt.target_fingerprint,receipt:PROTECTED_RELEASE_EXECUTOR_PATHS_V1.receipt,
    network_requests:0,product_writes:0}));
}).catch((error:unknown)=>{console.error(error instanceof Error?error.message:"Protected executor attestation failed.");
  process.exitCode=1;});}

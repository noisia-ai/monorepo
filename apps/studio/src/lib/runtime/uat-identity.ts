import { createHash } from "node:crypto";

type RuntimeEnv = Record<string, string | undefined>;

const QUEUE_ENV_NAMES = [
  "NOISIA_QUERY_ENGINE_QUEUE_NAME",
  "NOISIA_ENGINE_QUEUE_NAME",
  "NOISIA_DATA_OS_QUEUE_NAME",
  "NOISIA_SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME",
  "NOISIA_TB_ANALYSIS_QUEUE_NAME"
] as const;

export type StudioUatIdentityEvidence = {
  profile: "default" | "uat";
  database_project_ref_hash: string | null;
  redis_identity_hash: string | null;
  queue_names: string[];
};

export function assertStudioUatIdentity(
  env: RuntimeEnv = process.env
): StudioUatIdentityEvidence {
  if (env.NOISIA_RUNTIME_PROFILE?.trim() !== "uat") {
    if (Object.entries(env).some(([name, value]) => name.startsWith("NOISIA_UAT_") && value?.trim())) {
      throw new Error("uat_identity_configuration_requires_uat_profile");
    }
    return {
      profile: "default",
      database_project_ref_hash: null,
      redis_identity_hash: null,
      queue_names: []
    };
  }
  if (env.NOISIA_REMOTE_DATABASE_TARGET?.trim() !== "staging") {
    throw new Error("uat_database_target_must_be_staging");
  }

  const databaseHash = supabaseProjectRefHash(required(env, "DATABASE_URL"));
  const redisHash = connectionIdentityHash(required(env, "REDIS_URL"), "6379");
  if (databaseHash !== requiredSha256(env, "NOISIA_UAT_DATABASE_PROJECT_REF_SHA256")) {
    throw new Error("uat_database_identity_mismatch");
  }
  if (redisHash !== requiredSha256(env, "NOISIA_UAT_REDIS_IDENTITY_SHA256")) {
    throw new Error("uat_redis_identity_mismatch");
  }

  const queueNames = QUEUE_ENV_NAMES.map((name) => required(env, name));
  if (new Set(queueNames).size !== queueNames.length) {
    throw new Error("uat_queue_names_must_be_unique");
  }
  if (queueNames.some((name) => !name.endsWith("-uat"))) {
    throw new Error("uat_queue_names_must_end_in_uat");
  }
  return {
    profile: "uat",
    database_project_ref_hash: databaseHash,
    redis_identity_hash: redisHash,
    queue_names: queueNames
  };
}

export function supabaseProjectRefHash(value: string) {
  const parsed = new URL(value);
  const hostname = parsed.hostname.toLowerCase();
  const username = decodeURIComponent(parsed.username).toLowerCase();
  const projectRef = /^db\.([a-z0-9]+)\.supabase\.co$/u.exec(hostname)?.[1]
    ?? /^postgres\.([a-z0-9]+)$/u.exec(username)?.[1]
    ?? /^([a-z0-9]+)\.[a-z0-9.-]*pooler\.supabase\.com$/u.exec(hostname)?.[1];
  if (!projectRef) throw new Error("uat_database_project_ref_unavailable");
  return sha256(projectRef);
}

export function connectionIdentityHash(value: string, defaultPort: string) {
  const parsed = new URL(value);
  return sha256([
    parsed.protocol,
    parsed.hostname.toLowerCase(),
    parsed.port || defaultPort,
    parsed.pathname.replace(/^\//u, ""),
    decodeURIComponent(parsed.username)
  ].join("|"));
}

function required(env: RuntimeEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`uat_required_environment_missing_${name.toLowerCase()}`);
  return value;
}

function requiredSha256(env: RuntimeEnv, name: string) {
  const value = required(env, name);
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`uat_invalid_identity_${name.toLowerCase()}`);
  }
  return value;
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

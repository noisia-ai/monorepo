import { createHash } from "node:crypto";
import type { Pool } from "pg";

type RuntimeEnv = Record<string, string | undefined>;
type RedisProbe = {
  llen: (key: string) => Promise<number>;
  zcard: (key: string) => Promise<number>;
};

const QUEUE_ENV_NAMES = [
  "NOISIA_QUERY_ENGINE_QUEUE_NAME",
  "NOISIA_ENGINE_QUEUE_NAME",
  "NOISIA_DATA_OS_QUEUE_NAME",
  "NOISIA_SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME",
  "NOISIA_TB_ANALYSIS_QUEUE_NAME"
] as const;

type PreflightCounts = {
  strategic_run_claimable: number;
  strategic_step_claimable: number;
  workspace_import_claimable: number;
};

export type UatWorkerStartupEvidence = {
  profile: "default" | "uat";
  startup_mode: "not_applicable" | "empty-cut" | "recovery";
  database_project_ref_hash: string | null;
  redis_identity_hash: string | null;
  queue_names: string[];
  redis_executable_jobs: number | null;
  database_claimable_rows: PreflightCounts | null;
};

/**
 * Fail-closed startup boundary for the online Preview/UAT worker.
 *
 * It proves the database and Redis identities without logging credentials,
 * requires queue namespaces that cannot collide with production, and makes
 * the first release cut start from zero executable work. A later recovery
 * restart is possible only through a separate explicit operator approval.
 */
export async function assertUatWorkerStartup(args: {
  database: Pick<Pool, "query">;
  redis: RedisProbe;
  env?: RuntimeEnv;
}): Promise<UatWorkerStartupEvidence> {
  const env = args.env ?? process.env;
  if (env.NOISIA_RUNTIME_PROFILE?.trim() !== "uat") {
    if (Object.entries(env).some(([name, value]) => name.startsWith("NOISIA_UAT_") && value?.trim())) {
      throw new Error("uat_identity_configuration_requires_uat_profile");
    }
    return {
      profile: "default",
      startup_mode: "not_applicable",
      database_project_ref_hash: null,
      redis_identity_hash: null,
      queue_names: [],
      redis_executable_jobs: null,
      database_claimable_rows: null
    };
  }

  if (env.NOISIA_REMOTE_DATABASE_TARGET?.trim() !== "staging") {
    throw new Error("uat_database_target_must_be_staging");
  }
  const databaseUrl = required(env, "DATABASE_URL");
  const redisUrl = required(env, "REDIS_URL");
  const expectedDatabase = requiredSha256(env, "NOISIA_UAT_DATABASE_PROJECT_REF_SHA256");
  const expectedRedis = requiredSha256(env, "NOISIA_UAT_REDIS_IDENTITY_SHA256");
  const observedDatabase = supabaseProjectRefHash(databaseUrl);
  const observedRedis = connectionIdentityHash(redisUrl, "6379");
  if (observedDatabase !== expectedDatabase) throw new Error("uat_database_identity_mismatch");
  if (observedRedis !== expectedRedis) throw new Error("uat_redis_identity_mismatch");

  const queueNames = QUEUE_ENV_NAMES.map((name) => required(env, name));
  if (new Set(queueNames).size !== queueNames.length) {
    throw new Error("uat_queue_names_must_be_unique");
  }
  if (queueNames.some((name) => !name.endsWith("-uat"))) {
    throw new Error("uat_queue_names_must_end_in_uat");
  }
  if (env.NOISIA_SIGNAL_TB_PAID_RUN_APPROVED?.trim() !== "false") {
    throw new Error("uat_paid_tb_must_start_disabled");
  }

  const startupMode = env.NOISIA_UAT_STARTUP_MODE?.trim();
  if (startupMode !== "empty-cut" && startupMode !== "recovery") {
    throw new Error("uat_startup_mode_invalid");
  }
  if (startupMode === "recovery" && env.NOISIA_UAT_RECOVERY_APPROVED?.trim() !== "true") {
    throw new Error("uat_recovery_requires_operator_approval");
  }

  const [redisExecutableJobs, databaseClaimableRows] = await Promise.all([
    countExecutableRedisJobs(args.redis, queueNames),
    loadClaimableDatabaseRows(args.database)
  ]);
  const databaseExecutableRows = Object.values(databaseClaimableRows)
    .reduce((sum, count) => sum + count, 0);
  if (startupMode === "empty-cut" && redisExecutableJobs > 0) {
    throw new Error("uat_redis_contains_executable_jobs");
  }
  if (startupMode === "empty-cut" && databaseExecutableRows > 0) {
    throw new Error("uat_database_contains_claimable_outbox_rows");
  }

  return {
    profile: "uat",
    startup_mode: startupMode,
    database_project_ref_hash: observedDatabase,
    redis_identity_hash: observedRedis,
    queue_names: queueNames,
    redis_executable_jobs: redisExecutableJobs,
    database_claimable_rows: databaseClaimableRows
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

async function countExecutableRedisJobs(redis: RedisProbe, queueNames: string[]) {
  const counts = await Promise.all(queueNames.flatMap((queueName) => {
    const prefix = `bull:${queueName}`;
    return [
      redis.llen(`${prefix}:wait`),
      redis.llen(`${prefix}:paused`),
      redis.llen(`${prefix}:active`),
      redis.zcard(`${prefix}:delayed`),
      redis.zcard(`${prefix}:prioritized`),
      redis.zcard(`${prefix}:waiting-children`)
    ];
  }));
  return counts.reduce((sum, count) => sum + count, 0);
}

async function loadClaimableDatabaseRows(database: Pick<Pool, "query">) {
  const result = await database.query<PreflightCounts>(`
    SELECT
      (SELECT count(*)::int FROM signal_strategic_run_outbox outbox
       WHERE (outbox.status IN ('pending','failed') AND outbox.available_at <= now())
          OR (outbox.status='dispatching'
              AND COALESCE(outbox.lease_expires_at,outbox.updated_at) <= now()))
        AS strategic_run_claimable,
      (SELECT count(*)::int FROM signal_strategic_step_outbox outbox
       JOIN signal_strategic_run_controls control ON control.id=outbox.run_control_id
       WHERE control.status IN ('queued','running')
         AND control.cancel_requested_at IS NULL
         AND ((outbox.status IN ('pending','failed') AND outbox.available_at <= now())
           OR (outbox.status='dispatching'
               AND COALESCE(outbox.lease_expires_at,outbox.updated_at) <= now())))
        AS strategic_step_claimable,
      (SELECT count(*)::int FROM signal_workspace_import_outbox outbox
       JOIN import_batches batch ON batch.id=outbox.import_batch_id
       WHERE batch.status='queued'
         AND outbox.attempt_count < 8
         AND ((outbox.status IN ('pending','failed') AND outbox.available_at <= now())
           OR (outbox.status='dispatching' AND outbox.lease_expires_at <= now())))
        AS workspace_import_claimable
  `);
  const row = result.rows[0];
  if (!row) throw new Error("uat_database_preflight_unavailable");
  return row;
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

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertUatWorkerStartup,
  connectionIdentityHash,
  supabaseProjectRefHash
} from "./uat-runtime-preflight";

const databaseUrl = "postgresql://postgres.projectref:secret@pooler.supabase.com:5432/postgres";
const redisUrl = "rediss://default:secret@uat-redis.example:6379";
const queueEnv = {
  NOISIA_QUERY_ENGINE_QUEUE_NAME: "noisia-query-engine-uat",
  NOISIA_ENGINE_QUEUE_NAME: "noisia-engine-analysis-uat",
  NOISIA_DATA_OS_QUEUE_NAME: "noisia-data-os-uat",
  NOISIA_SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME: "noisia-semantic-resolution-uat",
  NOISIA_TB_ANALYSIS_QUEUE_NAME: "noisia-tb-analysis-uat"
};

function safeEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NOISIA_RUNTIME_PROFILE: "uat",
    NOISIA_REMOTE_DATABASE_TARGET: "staging",
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    NOISIA_UAT_DATABASE_PROJECT_REF_SHA256: supabaseProjectRefHash(databaseUrl),
    NOISIA_UAT_REDIS_IDENTITY_SHA256: connectionIdentityHash(redisUrl, "6379"),
    NOISIA_UAT_STARTUP_MODE: "empty-cut",
    NOISIA_UAT_RECOVERY_APPROVED: "false",
    NOISIA_SIGNAL_TB_PAID_RUN_APPROVED: "false",
    ...queueEnv,
    ...overrides
  };
}

const emptyRedis = {
  async llen() { return 0; },
  async zcard() { return 0; }
};
const emptyDatabase = {
  async query() {
    return { rows: [{
      strategic_run_claimable: 0,
      strategic_step_claimable: 0,
      workspace_import_claimable: 0
    }] };
  }
};

test("default workers remain compatible outside the UAT profile", async () => {
  const evidence = await assertUatWorkerStartup({
    database: emptyDatabase as never,
    redis: emptyRedis,
    env: {}
  });
  assert.equal(evidence.profile, "default");
});

test("UAT identity variables cannot silently bypass a mistyped profile", async () => {
  await assert.rejects(
    assertUatWorkerStartup({
      database: emptyDatabase as never,
      redis: emptyRedis,
      env: { NOISIA_RUNTIME_PROFILE: "UAT", NOISIA_UAT_STARTUP_MODE: "empty-cut" }
    }),
    /uat_identity_configuration_requires_uat_profile/u
  );
});

test("UAT empty cut verifies isolated identities, queues, Redis and outboxes", async () => {
  const evidence = await assertUatWorkerStartup({
    database: emptyDatabase as never,
    redis: emptyRedis,
    env: safeEnv()
  });
  assert.equal(evidence.profile, "uat");
  assert.equal(evidence.startup_mode, "empty-cut");
  assert.equal(evidence.redis_executable_jobs, 0);
});

test("UAT rejects a production-shaped queue name", async () => {
  await assert.rejects(
    assertUatWorkerStartup({
      database: emptyDatabase as never,
      redis: emptyRedis,
      env: safeEnv({ NOISIA_TB_ANALYSIS_QUEUE_NAME: "noisia-tb-analysis" })
    }),
    /uat_queue_names_must_end_in_uat/u
  );
});

test("UAT empty cut rejects executable Redis work", async () => {
  await assert.rejects(
    assertUatWorkerStartup({
      database: emptyDatabase as never,
      redis: { async llen() { return 1; }, async zcard() { return 0; } },
      env: safeEnv()
    }),
    /uat_redis_contains_executable_jobs/u
  );
});

test("UAT recovery requires separate operator approval", async () => {
  await assert.rejects(
    assertUatWorkerStartup({
      database: emptyDatabase as never,
      redis: emptyRedis,
      env: safeEnv({ NOISIA_UAT_STARTUP_MODE: "recovery" })
    }),
    /uat_recovery_requires_operator_approval/u
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertStudioUatIdentity,
  connectionIdentityHash,
  supabaseProjectRefHash
} from "./uat-identity";

const databaseUrl = "postgresql://postgres.projectref:secret@pooler.supabase.com:5432/postgres";
const redisUrl = "rediss://default:secret@uat-redis.example:6379";

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    NOISIA_RUNTIME_PROFILE: "uat",
    NOISIA_REMOTE_DATABASE_TARGET: "staging",
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    NOISIA_UAT_DATABASE_PROJECT_REF_SHA256: supabaseProjectRefHash(databaseUrl),
    NOISIA_UAT_REDIS_IDENTITY_SHA256: connectionIdentityHash(redisUrl, "6379"),
    NOISIA_QUERY_ENGINE_QUEUE_NAME: "noisia-query-engine-uat",
    NOISIA_ENGINE_QUEUE_NAME: "noisia-engine-analysis-uat",
    NOISIA_DATA_OS_QUEUE_NAME: "noisia-data-os-uat",
    NOISIA_SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME: "noisia-semantic-resolution-uat",
    NOISIA_TB_ANALYSIS_QUEUE_NAME: "noisia-tb-analysis-uat",
    ...overrides
  };
}

test("Studio verifies the same UAT identities and queue boundary as Workers", () => {
  const evidence = assertStudioUatIdentity(env());
  assert.equal(evidence.profile, "uat");
  assert.equal(evidence.queue_names.length, 5);
});

test("Studio rejects a mismatched Redis identity", () => {
  assert.throws(
    () => assertStudioUatIdentity(env({ NOISIA_UAT_REDIS_IDENTITY_SHA256: `sha256:${"0".repeat(64)}` })),
    /uat_redis_identity_mismatch/u
  );
});

test("Studio rejects UAT identity config with a mistyped profile", () => {
  assert.throws(
    () => assertStudioUatIdentity({ NOISIA_RUNTIME_PROFILE: "UAT", NOISIA_UAT_STARTUP_MODE: "empty-cut" }),
    /uat_identity_configuration_requires_uat_profile/u
  );
});

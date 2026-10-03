import assert from "node:assert/strict";
import test from "node:test";

import {
  DATA_OS_QUEUE_NAME,
  DATA_OS_SHADOW_RUN_JOB_NAME,
  SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME
} from "@noisia/query-engine";
import {
  buildDataOsShadowRunJobOptions,
  buildSignalAdHocMaterializationJobOptions,
  isDataOsQueueConfigured,
  resolveDataOsQueueName,
  resolveSemanticResolutionQueueName
} from "./data-os";

test("Semantic Review projection and Resolution use an isolated queue name", () => {
  assert.equal(
    resolveSemanticResolutionQueueName({ NODE_ENV: "development" }),
    `${SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME}-local`
  );
  assert.equal(
    resolveSemanticResolutionQueueName({ RAILWAY_ENVIRONMENT: "production" }),
    SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME
  );
  assert.equal(
    resolveSemanticResolutionQueueName({
      NOISIA_SIGNAL_SEMANTIC_RESOLUTION_QUEUE_NAME: "semantic-staging-isolated"
    }),
    "semantic-staging-isolated"
  );
});

test("Data OS queue resolves to a local queue outside hosted runtimes", () => {
  assert.equal(resolveDataOsQueueName({ NODE_ENV: "development" }), `${DATA_OS_QUEUE_NAME}-local`);
});

test("Data OS queue uses the production queue name in hosted runtimes", () => {
  assert.equal(resolveDataOsQueueName({ RAILWAY_ENVIRONMENT: "production" }), DATA_OS_QUEUE_NAME);
});

test("Data OS queue override wins over runtime defaults", () => {
  assert.equal(resolveDataOsQueueName({ NOISIA_DATA_OS_QUEUE_NAME: "noisia-data-os-staging" }), "noisia-data-os-staging");
});

test("Data OS shadow run jobs stay explicit and non-retrying", () => {
  assert.equal(DATA_OS_SHADOW_RUN_JOB_NAME, "data_os_shadow_run");
  assert.deepEqual(buildDataOsShadowRunJobOptions(), {
    attempts: 1,
    removeOnComplete: 25,
    removeOnFail: 100
  });
});

test("Signal ad hoc jobs are deduplicated, bounded and retry transient failures", () => {
  assert.deepEqual(buildSignalAdHocMaterializationJobOptions("signal-ad-hoc-stable"), {
    jobId: "signal-ad-hoc-stable",
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { age: 3_600, count: 500 },
    removeOnFail: { age: 604_800, count: 500 }
  });
});

test("Data OS queue configuration requires a non-empty Redis URL", () => {
  assert.equal(isDataOsQueueConfigured({}), false);
  assert.equal(isDataOsQueueConfigured({ REDIS_URL: "   " }), false);
  assert.equal(
    isDataOsQueueConfigured({ REDIS_URL: "rediss://example.invalid" }),
    true
  );
});

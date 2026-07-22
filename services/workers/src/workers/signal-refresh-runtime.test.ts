import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSignalRefreshRunOptions,
  buildSignalRefreshTickOptions,
  isSignalRefreshSchedulerEnabled
} from "./signal-refresh-runtime";

test("Signal refresh scheduler is closed unless both explicit switches are enabled", () => {
  assert.equal(isSignalRefreshSchedulerEnabled({}), false);
  assert.equal(isSignalRefreshSchedulerEnabled({ NOISIA_DATA_OS_WORKER_ENABLED: "true" }), false);
  assert.equal(isSignalRefreshSchedulerEnabled({ NOISIA_SIGNAL_REFRESH_SCHEDULER_ENABLED: "true" }), false);
  assert.equal(isSignalRefreshSchedulerEnabled({
    NOISIA_DATA_OS_WORKER_ENABLED: "true",
    NOISIA_SIGNAL_REFRESH_SCHEDULER_ENABLED: "true"
  }), true);
});

test("Signal refresh jobs have deploy-stable dedupe and bounded retry/dead-letter retention", () => {
  assert.deepEqual(buildSignalRefreshTickOptions(), {
    jobId: "signal-refresh-tick-v1",
    repeat: { every: 60_000 },
    attempts: 1,
    removeOnComplete: { age: 3_600, count: 10 },
    removeOnFail: { age: 604_800, count: 100 }
  });
  assert.equal(buildSignalRefreshRunOptions("stable-job").attempts, 3);
  assert.deepEqual(buildSignalRefreshRunOptions("stable-job").backoff, {
    type: "exponential",
    delay: 5_000
  });
});


import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSignalRefreshRunOptions,
  buildSignalRefreshTickOptions,
  enqueueRecoverableSignalRefreshRun,
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

test("a BullMQ enqueue failure leaves the durable occurrence recoverable and never advances the policy", async () => {
  let advanced = false;
  let failed = false;
  const result = await enqueueRecoverableSignalRefreshRun({
    add: async () => {
      throw new Error("redis_unavailable");
    },
    markEnqueuedAndAdvance: async () => {
      advanced = true;
    },
    markEnqueueFailed: async () => {
      failed = true;
    }
  });
  assert.equal(result.enqueued, false);
  assert.equal(advanced, false);
  assert.equal(failed, true);
});

test("the policy advances only after BullMQ confirms the durable occurrence", async () => {
  const events: string[] = [];
  const result = await enqueueRecoverableSignalRefreshRun({
    add: async () => {
      events.push("queue.add");
      return { id: "stable-job" };
    },
    markEnqueuedAndAdvance: async () => {
      events.push("advance");
    },
    markEnqueueFailed: async () => {
      events.push("failed");
    }
  });
  assert.equal(result.enqueued, true);
  assert.deepEqual(events, ["queue.add", "advance"]);
});

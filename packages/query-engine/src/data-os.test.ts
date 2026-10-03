import assert from "node:assert/strict";
import test from "node:test";

import {
  DATA_OS_QUEUE_NAME,
  DATA_OS_SHADOW_RUN_JOB_NAME,
  isDataOsRemoteTargetAllowed,
  isDataOsWorkerEnabled,
  isDataOsWorkerRemoteApproved,
  isDataOsWorkerRunEnabled
} from "./data-os";

test("Data OS worker contracts stay explicit", () => {
  assert.equal(DATA_OS_QUEUE_NAME, "noisia-data-os");
  assert.equal(DATA_OS_SHADOW_RUN_JOB_NAME, "data_os_shadow_run");
});

test("Data OS worker flags default closed and require literal true", () => {
  assert.equal(isDataOsWorkerEnabled({}), false);
  assert.equal(isDataOsWorkerRunEnabled({}), false);
  assert.equal(isDataOsWorkerRemoteApproved({}), false);
  assert.equal(isDataOsRemoteTargetAllowed({}), false);
  assert.equal(isDataOsWorkerEnabled({ NOISIA_DATA_OS_WORKER_ENABLED: "TRUE" }), false);
  assert.equal(isDataOsWorkerRunEnabled({ NOISIA_DATA_OS_WORKER_RUNS_ENABLED: "1" }), false);
  assert.equal(isDataOsWorkerRemoteApproved({ NOISIA_DATA_OS_WORKER_REMOTE_APPROVED: "yes" }), false);
  assert.equal(isDataOsWorkerRemoteApproved({ NOISIA_DATA_OS_WORKER_REMOTE_APPROVED: "true" }), false);
  assert.equal(isDataOsWorkerRemoteApproved({
    NOISIA_DATA_OS_WORKER_REMOTE_APPROVED: "true",
    NOISIA_REMOTE_DATABASE_TARGET: "production"
  }), false);
  assert.equal(isDataOsWorkerEnabled({ NOISIA_DATA_OS_WORKER_ENABLED: "true" }), true);
  assert.equal(isDataOsWorkerRunEnabled({ NOISIA_DATA_OS_WORKER_RUNS_ENABLED: "true" }), true);
  assert.equal(isDataOsRemoteTargetAllowed({ NOISIA_REMOTE_DATABASE_TARGET: "staging" }), true);
  assert.equal(isDataOsRemoteTargetAllowed({ NOISIA_REMOTE_DATABASE_TARGET: "throwaway" }), true);
  assert.equal(isDataOsRemoteTargetAllowed({ NOISIA_REMOTE_DATABASE_TARGET: "preview" }), true);
  assert.equal(isDataOsWorkerRemoteApproved({
    NOISIA_DATA_OS_WORKER_REMOTE_APPROVED: "true",
    NOISIA_REMOTE_DATABASE_TARGET: "staging"
  }), true);
});

import assert from "node:assert/strict";
import test from "node:test";

import { buildSignalRefreshRunIdempotencyKeyV1 } from "./signal-refresh-v1";

test("Signal refresh idempotency is stable across equivalent instants", () => {
  const first = buildSignalRefreshRunIdempotencyKeyV1({
    refresh_policy_id: "ABC",
    scheduled_for: "2026-07-22T06:00:00-06:00"
  });
  const second = buildSignalRefreshRunIdempotencyKeyV1({
    refresh_policy_id: "abc",
    scheduled_for: "2026-07-22T12:00:00.000Z"
  });
  assert.equal(first, second);
  assert.match(first, /^sha256:[0-9a-f]{64}$/u);
});

test("Signal refresh idempotency changes with policy or scheduled occurrence", () => {
  const base = buildSignalRefreshRunIdempotencyKeyV1({
    refresh_policy_id: "policy-a",
    scheduled_for: "2026-07-22T12:00:00.000Z"
  });
  assert.notEqual(base, buildSignalRefreshRunIdempotencyKeyV1({
    refresh_policy_id: "policy-b",
    scheduled_for: "2026-07-22T12:00:00.000Z"
  }));
  assert.notEqual(base, buildSignalRefreshRunIdempotencyKeyV1({
    refresh_policy_id: "policy-a",
    scheduled_for: "2026-07-23T12:00:00.000Z"
  }));
});


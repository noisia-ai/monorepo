import assert from "node:assert/strict";
import test from "node:test";

import {
  SIGNAL_REFRESH_TOLERANCE_MS_V1,
  buildSignalRefreshRunIdempotencyKeyV1,
  deriveSignalStaleAfterV1,
  evaluateSignalFreshnessV1,
  expandSignalVelocityInvalidationThroughV1
} from "./signal-refresh-v1";

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

test("freshness deadlines are cadence-specific and retain the policy timezone contract", () => {
  const expected = "2026-07-23T12:00:00.000Z";
  const cadences = ["hourly", "daily", "weekly", "monthly"] as const;
  const deadlines = cadences.map((cadence) => (
    deriveSignalStaleAfterV1({
      cadence,
      timezone: "America/Mexico_City",
      expected_next_run: expected
    })?.getTime()
  ));
  assert.equal(deriveSignalStaleAfterV1({
    cadence: "manual",
    timezone: "UTC",
    expected_next_run: null
  }), null);
  assert.equal(new Set(deadlines).size, 4);
  assert.deepEqual(
    deadlines.map((deadline) => (deadline ?? 0) - new Date(expected).getTime()),
    cadences.map((cadence) => SIGNAL_REFRESH_TOLERANCE_MS_V1[cadence])
  );
  assert.throws(() => deriveSignalStaleAfterV1({
    cadence: "daily",
    timezone: "Not/A_Timezone",
    expected_next_run: expected
  }), /timezone/u);
});

test("freshness transitions fresh to stale and recovers after a newly accepted occurrence", () => {
  const accepted = {
    accepted_at: "2026-07-22T12:00:00.000Z",
    materialized_at: "2026-07-22T12:05:00.000Z",
    max_observed_at: "2026-07-22T11:59:00.000Z"
  };
  assert.deepEqual(evaluateSignalFreshnessV1({
    ...accepted,
    stale_after: "2026-07-23T18:00:00.000Z",
    now: "2026-07-23T17:59:59.000Z"
  }), {
    source_freshness: "fresh",
    data_freshness: "fresh",
    materialization_freshness: "fresh"
  });
  assert.deepEqual(evaluateSignalFreshnessV1({
    ...accepted,
    stale_after: "2026-07-23T18:00:00.000Z",
    now: "2026-07-23T18:00:00.000Z"
  }), {
    source_freshness: "stale",
    data_freshness: "stale",
    materialization_freshness: "stale"
  });
  assert.equal(evaluateSignalFreshnessV1({
    accepted_at: "2026-07-23T19:00:00.000Z",
    materialized_at: "2026-07-23T19:01:00.000Z",
    max_observed_at: "2026-07-23T18:59:00.000Z",
    stale_after: "2026-07-24T18:00:00.000Z",
    now: "2026-07-23T20:00:00.000Z"
  }).data_freshness, "fresh");
});

test("velocity invalidation includes the dependent following monthly bucket", () => {
  assert.equal(expandSignalVelocityInvalidationThroughV1("2026-01-31"), "2026-02-28");
  assert.equal(expandSignalVelocityInvalidationThroughV1("2026-06-15"), "2026-07-31");
  assert.equal(expandSignalVelocityInvalidationThroughV1(null), null);
});

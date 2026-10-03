import assert from "node:assert/strict";
import test from "node:test";

import { signalDefaultWorkspaceHomeFilterV1 } from "./signal-workspace-home-v1";

test("workspace home filter is a deterministic latest-month default shared by workers and Studio", () => {
  assert.deepEqual(
    signalDefaultWorkspaceHomeFilterV1(
      "2026-05-18",
      "2026-07-22",
      "America/Mexico_City"
    ),
    {
      contract_version: "signal-backend-v1",
      date_range: { start: "2026-07-01", end: "2026-07-22" },
      timezone: "America/Mexico_City",
      granularity: "day",
      dimensions: {}
    }
  );
  assert.deepEqual(
    signalDefaultWorkspaceHomeFilterV1("2026-07-18", "2026-07-22", "UTC")?.date_range,
    { start: "2026-07-18", end: "2026-07-22" }
  );
});

test("workspace home filter stays unavailable when canonical coverage is absent or inverted", () => {
  assert.equal(signalDefaultWorkspaceHomeFilterV1(null, null, "UTC"), null);
  assert.equal(
    signalDefaultWorkspaceHomeFilterV1("2026-07-23", "2026-07-22", "UTC"),
    null
  );
});

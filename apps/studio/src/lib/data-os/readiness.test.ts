import assert from "node:assert/strict";
import test from "node:test";

import { resolveReadinessOverall, type DataOsReadinessStatus } from "./readiness-state";

function stages(...statuses: DataOsReadinessStatus[]) {
  return statuses.map((status) => ({ status }));
}

test("Source-to-Signal is not ready while downstream stages are empty", () => {
  assert.equal(
    resolveReadinessOverall(stages("ready", "ready", "ready", "empty", "empty"), []),
    "building"
  );
});

test("Source-to-Signal requires every stage to be ready", () => {
  assert.equal(
    resolveReadinessOverall(stages("ready", "ready", "ready", "ready", "ready"), []),
    "ready"
  );
});

test("attention and unavailable states take precedence", () => {
  assert.equal(resolveReadinessOverall(stages("ready", "attention", "empty"), []), "attention");
  assert.equal(resolveReadinessOverall(stages("ready", "ready"), ["blocked"]), "attention");
  assert.equal(resolveReadinessOverall(stages("attention", "unavailable"), ["blocked"]), "unavailable");
});

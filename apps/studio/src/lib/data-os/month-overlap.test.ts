import assert from "node:assert/strict";
import test from "node:test";

import { getDataOsOverlappingMonths } from "./month-overlap";

test("returns only months shared by listening and structured observations", () => {
  assert.deepEqual(
    getDataOsOverlappingMonths([
      { source: "listening_mentions", month: "2026-03" },
      { source: "listening_mentions", month: "2026-01" },
      { source: "listening_mentions", month: "2026-02" },
      { source: "data_observations", month: "2025-12" },
      { source: "data_observations", month: "2026-02" },
      { source: "data_observations", month: "2026-01" }
    ]),
    ["2026-01", "2026-02"]
  );
});

test("deduplicates repeated metrics within the same month", () => {
  assert.deepEqual(
    getDataOsOverlappingMonths([
      { source: "listening_mentions", month: "2026-01" },
      { source: "data_observations", month: "2026-01" },
      { source: "data_observations", month: "2026-01" }
    ]),
    ["2026-01"]
  );
});

test("does not invent overlap from unrelated series", () => {
  assert.deepEqual(
    getDataOsOverlappingMonths([
      { source: "listening_mentions", month: "2026-01" },
      { source: "sales_forecast", month: "2026-01" },
      { source: "data_observations", month: "2026-02" }
    ]),
    []
  );
});

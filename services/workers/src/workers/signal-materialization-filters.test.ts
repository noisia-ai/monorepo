import assert from "node:assert/strict";
import test from "node:test";

import type { SignalFilterV1 } from "@noisia/query-engine";

import { prioritizeSignalMaterializationFiltersV1 } from "./signal-materialization-filters";

const home: SignalFilterV1 = {
  contract_version: "signal-backend-v1",
  date_range: { start: "2026-07-01", end: "2026-07-23" },
  timezone: "America/Mexico_City",
  granularity: "day",
  dimensions: {}
};

const cached: SignalFilterV1 = {
  ...home,
  date_range: { start: "2026-07-01", end: "2026-07-22" }
};

test("current canonical home filter remains first when prior filters are cached", () => {
  const filters = prioritizeSignalMaterializationFiltersV1({
    home_filter: home,
    cached_filters: [cached],
    generated_filters: []
  });

  assert.deepEqual(filters, [home, cached]);
});

test("home filter remains recoverable under the per-run cardinality limit", () => {
  const filters = prioritizeSignalMaterializationFiltersV1({
    home_filter: home,
    cached_filters: [cached],
    generated_filters: [],
    limit: 1
  });

  assert.deepEqual(filters, [home]);
});

test("canonical duplicates are removed and generated filters seed an empty cache", () => {
  const filters = prioritizeSignalMaterializationFiltersV1({
    home_filter: home,
    cached_filters: [],
    generated_filters: [home, cached]
  });

  assert.deepEqual(filters, [home, cached]);
});

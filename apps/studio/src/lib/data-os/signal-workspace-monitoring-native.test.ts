import assert from "node:assert/strict";
import test from "node:test";
import type { SignalWorkspaceTopicsOverviewV1 } from "@noisia/query-engine";

import type { SignalBrandMonitoringV1 } from "../signal-v2/brand-monitoring";
import { buildNativeSignalMonitoringV1, isNativeSignalTopicsOverviewV1 } from "./signal-workspace-monitoring-native";

const workspace = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "alexa-plus",
  timezone: "America/Mexico_City"
};
const base = {
  contract_version: "signal-brand-monitoring-v1",
  workspace,
  filter: { contract_version: "signal-backend-v1", date_range: { start: "2026-09-01", end: "2026-09-12" },
    timezone: workspace.timezone, granularity: "day", dimensions: {} },
  comparison: { mode: "previous_period", date_range: null },
  conversation_structure: { state: "not_available", reason: "empty", points: [], summary: {}, previous_points: [], previous_summary: null },
  sentiment: { state: "not_available" }, platforms: { state: "not_available" }, narratives: { state: "not_available" }
} as unknown as SignalBrandMonitoringV1;

const native: SignalWorkspaceTopicsOverviewV1 = {
  contract_version: "signal-workspace-topics-serving-v1",
  source: "workspace_computed",
  workspace_id: workspace.id,
  corpus_id: null,
  scope: "all_conversations",
  generation_id: "00000000-0000-4000-8000-000000000002",
  source_engine_execution_id: "00000000-0000-4000-8000-000000000003",
  is_current: true,
  is_processing: false,
  selection_revision: 1,
  filters: { date_from: null, date_to: null },
  available_dates: { date_from: "2026-08-01", date_to: "2026-09-01" },
  scope_digest: "sha256:scope",
  observed_at: "2026-09-12T00:00:00.000000Z",
  denominator: 43_159,
  coverage: { processed: 43_159, assigned_unique: 67, abstained: 12_603, unresolved: 30_377, withheld: 0 },
  interpretation_coverage: { interpreted_unit_count: 36, expected_unit_count: 1_652, complete: false },
  quality: "not_calibrated",
  terms: [{ term_key: "early-access", label: "Acceso anticipado a Alexa+", definition: "Experiencias de acceso anticipado.",
    definition_revision: 1, definition_digest: "sha256:def", selected: true, mention_count: 67, share_of_corpus: 67 / 43_159,
    basis: "computed_cluster" }],
  series: [{ date: "2026-08-31", mention_count: 100, assigned_unique: 12 },
    { date: "2026-09-01", mention_count: 120, assigned_unique: 15 }],
  limitations: ["computed_memberships_not_semantic_precision"]
};

test("native workspace data enters the shared Signal dashboard without inventing unavailable metrics", () => {
  const result = buildNativeSignalMonitoringV1(base, native);
  assert.equal(result.contract_version, "signal-brand-monitoring-v1");
  assert.equal(result.coverage.mentions, 43_159);
  assert.equal(result.volume.current_value, 43_159);
  assert.equal(result.freshness.data.unit, "canonical_mention");
  assert.equal(result.conversation_structure.state, "not_available");
  assert.deepEqual(result.conversation_structure.points, []);
  assert.deepEqual(result.topics.buckets.map(bucket => [bucket.label, bucket.value]), [["Acceso anticipado a Alexa+", 67]]);
  assert.equal(result.sentiment.state, "not_available");
  assert.equal(result.platforms.state, "not_available");
  assert.equal(result.narratives.reason, "workspace_narrative_consolidation_pending");
  assert.equal(result.comparison.mode, "none");
});

test("native monitoring accepts only the exact workspace overview contract", () => {
  assert.equal(isNativeSignalTopicsOverviewV1(native, workspace.id), true);
  assert.equal(isNativeSignalTopicsOverviewV1({ ...native, workspace_id: "00000000-0000-4000-8000-000000000099" }, workspace.id), false);
  assert.equal(isNativeSignalTopicsOverviewV1({ ...native, contract_version: "signal-topics-narratives-v1" }, workspace.id), false);
  assert.equal(isNativeSignalTopicsOverviewV1(null, workspace.id), false);
});

test("stale native generations remain visibly stale in the shared dashboard", () => {
  const result = buildNativeSignalMonitoringV1(base, { ...native, is_current: false });
  assert.equal(result.freshness.state, "stale");
  assert.equal(result.volume.state, "stale");
  assert.equal(result.topics.state, "stale");
});

import assert from "node:assert/strict";
import test from "node:test";
import type { SignalWorkspaceTopicsOverviewV1 } from "@noisia/query-engine";
import type { SignalWorkspaceTopicSelectionStatusV1, SignalWorkspaceCapabilitiesV1 } from "@noisia/db";
import { nativeTopicsQueryV1, nativeTopicsViewV1, nativeTopicSelectionViewV1 } from "./signal-workspace-topics-native";

test("native dates are inclusive UTC inputs and unsupported filters cannot silently widen a query", () => {
  assert.deepEqual(nativeTopicsQueryV1(new URLSearchParams()), {});
  assert.deepEqual(nativeTopicsQueryV1(new URLSearchParams("start=2026-09-01&end=2026-09-08&timezone=UTC&compare=none&granularity=day")), { date_from: "2026-09-01", date_to: "2026-09-08" });
  for (const query of ["start=2026-09-01&start=2026-09-02", "q=delivery", "dimension.platform=web", "timezone=America/Mexico_City", "compare=previous_period", "date_from=2026-02-30", "start=", "start=2026-09-10&end=2026-09-01", "start=2026-09-01&date_from=2026-09-02"])
    assert.throws(() => nativeTopicsQueryV1(new URLSearchParams(query)), error => Boolean(error && typeof error === "object" && "status" in error && error.status === 422));
  assert.equal(nativeTopicsViewV1(new URLSearchParams("view=all_conversations")), true);
  assert.equal(nativeTopicsViewV1(new URLSearchParams("view=all-governed")), false);
  assert.equal(nativeTopicsViewV1(new URLSearchParams("view=brand")), false);
});
const hash = `sha256:${"b".repeat(64)}`, scope = { workspace_id: "workspace", actor_user_id: "actor" };
const selection = { selected: true, definition_digest: hash, definition_revision: 1, generation_id: "old-generation",
  source_engine_execution_id: "engine", mapping_digest: hash, selected_by_user_id: "actor", selected_at: "2026-09-08T00:00:00.000000Z" };
const state: SignalWorkspaceTopicSelectionStatusV1 = { contract_version: "signal-workspace-topic-selection-v1", workspace_id: "workspace",
  observed_at: "2026-09-08T00:00:00.000001Z", revision: 2, items: { delivery: selection }, request_receipt: null };
const overview = { workspace_id: "workspace", is_current: true, is_processing: false, selection_revision: 2, generation_id: "new-generation",
  terms: [{ term_key: "delivery", definition_digest: hash, definition_revision: 1, mention_count: 8 }] } as SignalWorkspaceTopicsOverviewV1;
const caps: SignalWorkspaceCapabilitiesV1 = { can_view: true, can_edit_topics: true, can_import_mentions: true, can_execute_topics: true, can_adopt_topics: true };
test("selection survives a newer compatible generation without becoming a paid action or model approval", () => {
  const result = nativeTopicSelectionViewV1(scope, "delivery", undefined, state, overview, caps);
  assert.equal(result.selected, true); assert.equal(result.is_current, true); assert.equal(result.generation_id, "new-generation"); assert.equal(result.mention_count, 8);
  assert.equal(nativeTopicSelectionViewV1(scope, "delivery", undefined, state, overview, { ...caps, can_execute_topics: false }).can_select, false);
});
test("changed meaning or stale generation keeps selection removable but not falsely current", () => {
  const edited = { ...overview, terms: [{ ...overview.terms[0]!, definition_revision: 2 }] };
  const result = nativeTopicSelectionViewV1(scope, "delivery", undefined, state, edited, caps);
  assert.equal(result.selected, true); assert.equal(result.is_current, false);
  assert.equal(nativeTopicSelectionViewV1(scope, "delivery", undefined, state, null, caps).is_current, false);
});
test("torn CAS read, cross-tenant data and unrelated receipts do not confirm the wrong selection", () => {
  assert.throws(() => nativeTopicSelectionViewV1(scope, "delivery", undefined, state, { ...overview, selection_revision: 3 }, caps));
  assert.throws(() => nativeTopicSelectionViewV1(scope, "delivery", undefined, { ...state, workspace_id: "other" }, overview, caps));
  const result = nativeTopicSelectionViewV1(scope, "delivery", "request-key", { ...state, request_receipt: { operation_id: "operation", term_key: "other", revision: 2, selection } }, overview, caps);
  assert.equal(result.request_receipt, null);
});

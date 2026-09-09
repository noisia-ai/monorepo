import assert from "node:assert/strict";
import test from "node:test";
import { acceptTopicSignalSelectionV1, canSelectTopicSignalV1, parseTopicSignalSelectionV1,
  parseTopicSignalSelectionIntentV1, topicSignalSelectionStorageKeyV1, shouldPollTopicSignalV1, type TopicSignalSelectionV1 } from "./signal-topic-selection-ui";

const state: TopicSignalSelectionV1 = { workspace_id: "workspace", term_key: "topic", request_scope: "a".repeat(64),
  observed_at: "2026-09-08T23:44:00.000001Z", can_select: true, selected: false, selection_revision: 1,
  definition_revision: 2, definition_digest: `sha256:${"b".repeat(64)}`, generation_id: "generation", is_current: true, is_processing: false,
  mention_count: 5, request_receipt: null };
test("selection requires current complete generation, allows removing stale selection, and protects edits", () => {
  assert.equal(canSelectTopicSignalV1(state, false, false), true);
  for (const other of [{ ...state, is_current: false }, { ...state, generation_id: null }, { ...state, can_select: false }, { ...state, mention_count: 0 }])
    assert.equal(canSelectTopicSignalV1(other, false, false), false);
  assert.equal(canSelectTopicSignalV1({ ...state, selected: true, is_current: false, generation_id: null }, false, false), true);
  assert.equal(canSelectTopicSignalV1(state, true, false), false);
  assert.equal(canSelectTopicSignalV1(state, false, true), false);
});
test("microsecond snapshot fence and tenant identity prevent stale status from replacing current selection", () => {
  assert.equal(acceptTopicSignalSelectionV1(state, { ...state, selected: true, observed_at: "2026-09-08T23:44:00.000000Z" }, "workspace", "topic"), state);
  assert.equal(acceptTopicSignalSelectionV1(state, { ...state, workspace_id: "other" }, "workspace", "topic"), state);
  assert.equal(acceptTopicSignalSelectionV1(state, { ...state, term_key: "other" }, "workspace", "topic"), state);
  const current = { ...state, selected: true, observed_at: "2026-09-08T23:44:00.000002Z" };
  assert.equal(acceptTopicSignalSelectionV1(state, current, "workspace", "topic"), current);
});
test("persisted recovery keeps exact body/key and cannot cross actor scope or Topic", () => {
  const intent = { key: "request-key", request_scope: state.request_scope, workspace_id: state.workspace_id, term_key: state.term_key,
    body: { action: "select_signal", selected: true, expected_definition_revision: 2, expected_definition_digest: state.definition_digest,
      expected_selection_revision: 1, generation_id: "generation", idempotency_key: "request-key" } };
  assert.deepEqual(parseTopicSignalSelectionIntentV1(JSON.stringify(intent), state), intent);
  assert.equal(parseTopicSignalSelectionIntentV1(JSON.stringify(intent), { ...state, request_scope: "c".repeat(64) }), null);
  assert.equal(parseTopicSignalSelectionIntentV1(JSON.stringify(intent), { ...state, term_key: "other" }), null);
  assert.notEqual(topicSignalSelectionStorageKeyV1("workspace", "topic", "actor1"), topicSignalSelectionStorageKeyV1("workspace", "topic", "actor2"));
});
test("malformed status cannot present a current selection", () => {
  assert.equal(parseTopicSignalSelectionV1(state), state);
  for (const patch of [{ selection_revision: -1 }, { observed_at: "today" }, { request_scope: null }, { mention_count: -1 }, { is_current: "true" }])
    assert.throws(() => parseTopicSignalSelectionV1({ ...state, ...patch }));
});

test("polling tracks actual projection and pauses for edits, requests, visibility and terminal status", () => {
  const processing = { ...state, is_current: false, is_processing: true };
  assert.equal(shouldPollTopicSignalV1(state, false, true), false);
  assert.equal(shouldPollTopicSignalV1(processing, false, true), true);
  assert.equal(shouldPollTopicSignalV1(processing, true, true), false);
  assert.equal(shouldPollTopicSignalV1(processing, false, false), false);
  assert.equal(shouldPollTopicSignalV1({ ...processing, is_processing: false }, false, true), false);
});

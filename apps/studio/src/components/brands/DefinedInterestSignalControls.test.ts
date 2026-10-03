import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DefinedInterestControlBoundaryV1, definedInterestSelectionCommandV1 } from "./DefinedInterestSignalControls";

const digest = `sha256:${"a".repeat(64)}`;
const id = "00000000-0000-4000-8000-000000000001";
const candidate = { generation_id: id, taxonomy_term_id: id, definition_digest: digest,
  definition_revision: 2, approved_memberships: 3, approved_decisions: 3 };
const state = { workspace_id: id, term_key: "screen", selection: null, servable: false,
  ready: true, can_select: true, candidate, latest_run: { status: "ready", complete: true, is_current: true },
  request_receipt: null };

test("an approved, current interest can be selected independently of consolidation", () => {
  assert.deepEqual(definedInterestSelectionCommandV1(state, false), { term_key: "screen", selected: true,
    snapshot_id: null, expected_snapshot_digest: null, generation_id: id, taxonomy_term_id: id,
    definition_digest: digest, definition_revision: 2, expected_selection_revision: 0 });
  for (const blocked of [{ ...state, ready: false }, { ...state, can_select: false }])
    assert.equal(definedInterestSelectionCommandV1(blocked, false), null);
  assert.equal(definedInterestSelectionCommandV1({ ...state, candidate: { ...candidate,
    approved_memberships: 0, approved_decisions: 0 } }, false)?.selected, true,
    "a completed interest with zero positives can monitor a later import");
  assert.equal(definedInterestSelectionCommandV1(state, true), null);
});

test("removal uses the selected receipt, including a stale generation, without selecting from score", () => {
  const selected = { selected: true, selection_revision: 4, snapshot_id: null, generation_id: id,
    taxonomy_term_id: id, definition_digest: digest, definition_revision: 1 };
  assert.deepEqual(definedInterestSelectionCommandV1({ ...state, selection: selected, ready: false,
    can_select: false, candidate: null }, false), { term_key: "screen", selected: false,
    snapshot_id: null, expected_snapshot_digest: null, generation_id: id, taxonomy_term_id: id,
    definition_digest: digest, definition_revision: 1, expected_selection_revision: 4 });
  assert.equal(definedInterestSelectionCommandV1({ ...state, selection: { ...selected, snapshot_id: id } }, false), null,
    "a snapshot-bound receipt needs its exact digest");
  assert.deepEqual(definedInterestSelectionCommandV1({ ...state, selection: { ...selected, snapshot_id: id },
    selection_snapshot_digest: digest }, false)?.expected_snapshot_digest, digest);
});

test("manual interest uses exactly one control for its current generation; legacy remains for older Topics", () => {
  const defined = createElement("button", { "data-kind": "defined" }, "Defined interest");
  const legacy = createElement("button", { "data-kind": "legacy" }, "Existing Topic");
  const current = renderToStaticMarkup(createElement(DefinedInterestControlBoundaryV1,
    { interestGeneration: true, defined, legacy }));
  assert.match(current, /data-kind="defined"/u); assert.doesNotMatch(current, /data-kind="legacy"/u);
  const older = renderToStaticMarkup(createElement(DefinedInterestControlBoundaryV1,
    { interestGeneration: false, defined, legacy }));
  assert.match(older, /data-kind="legacy"/u); assert.doesNotMatch(older, /data-kind="defined"/u);
});

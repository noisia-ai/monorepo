import assert from "node:assert/strict";
import test from "node:test";
import { definedInterestSelectionViewV1, parseDefinedInterestSelectionCommandV1 } from "./signal-defined-interest-selection";

const id = "00000000-0000-4000-8000-000000000001", digest = `sha256:${"b".repeat(64)}`;
const scope = { workspace_id: id, actor_user_id: id };
const selection = { contract_version: "signal-workspace-defined-interest-selection-v1" as const,
  workspace_id: id, term_key: "screen", selection: null, servable: false, request_receipt: null };
const latest = { latest_run: { id, generation_id: id, status: "ready", result_summary: {}, complete: true,
  is_current: true }, latest_complete: { id, generation_id: id, status: "ready", result_summary: {},
  complete: true, is_current: true } };
const candidate = { generation_id: id, taxonomy_term_id: id, definition_digest: digest,
  definition_revision: 1, approved_memberships: 2, approved_decisions: 2 };

test("Studio exposes defined interest selection only after a current, approved ready generation", () => {
  assert.equal(definedInterestSelectionViewV1({ scope, selection, latest, can_select_signal: true, candidate }).can_select, true);
  for (const patch of [{ latest: { ...latest, latest_complete: { ...latest.latest_complete, is_current: false } } },
    { latest: { ...latest, latest_complete: { ...latest.latest_complete, status: "running" } } },
    { candidate: { ...candidate, approved_memberships: 0, approved_decisions: 2 } },
    { candidate: { ...candidate, generation_id: "00000000-0000-4000-8000-000000000002" } },
    { can_select_signal: false }]) {
    const view = definedInterestSelectionViewV1({ scope, selection, latest, can_select_signal: true, candidate, ...patch });
    assert.equal(view.can_select, false);
    if ("can_select_signal" in patch) assert.deepEqual(view.candidate, candidate);
    else assert.equal(view.candidate, null);
  }
  assert.throws(() => definedInterestSelectionViewV1({ scope, selection: { ...selection,
    workspace_id: "00000000-0000-4000-8000-000000000002" }, latest, can_select_signal: true, candidate }));
  const zero = definedInterestSelectionViewV1({ scope, selection, latest, can_select_signal: true,
    candidate: { ...candidate, approved_memberships: 0, approved_decisions: 0 } });
  assert.equal(zero.can_select, true); assert.equal(zero.candidate?.approved_memberships, 0);
});

test("API command binds the URL term, nullable snapshot pair, and exact CAS identity", () => {
  const command = { term_key: "screen", selected: true, snapshot_id: null, expected_snapshot_digest: null,
    generation_id: id, taxonomy_term_id: id, definition_digest: digest,
    definition_revision: 1, expected_selection_revision: 0 };
  assert.deepEqual(parseDefinedInterestSelectionCommandV1(command, "screen"), command);
  for (const invalid of [{ ...command, term_key: "other" }, { ...command, expected_snapshot_digest: digest },
    { ...command, score: 0.99 }, { ...command, generation_id: null },
    { ...command, expected_selection_revision: -1 }])
    assert.throws(() => parseDefinedInterestSelectionCommandV1(invalid, "screen"));
});

import assert from "node:assert/strict";
import test from "node:test";
import { definedInterestDecisionReceiptMatchesV1, definedInterestDecisionViewV1,
  validDefinedInterestDecisionStatusV1, type DefinedInterestDecisionStatusV1
} from "./DefinedInterestDecisionControls";

const status = (state: DefinedInterestDecisionStatusV1["status"]): DefinedInterestDecisionStatusV1 => ({
  owner_id: "00000000-0000-4000-8000-000000000001", status: state,
  expected_roots: 43_159, manifest_roots: 64, accepted_roots: 16,
  unknown_batches: 0, unsettled_calls: 0,
});

test("only an explicit untouched interest can start one decision request", () => {
  assert.equal(definedInterestDecisionViewV1(status("not_started"), false, false, null).canStart, true);
  assert.equal(definedInterestDecisionViewV1(status("not_started"), true, false, null).canStart, false);
  assert.equal(definedInterestDecisionViewV1(status("not_started"), false, true, null).canStart, false);
  assert.equal(definedInterestDecisionViewV1(status("not_started"), false, false, { key: "same-key-1" }).canStart, false);
  assert.equal(definedInterestDecisionViewV1(status("not_started"), false, false,
    { key: "same-key-1", rejected_before_admission: true }).canReplaceRejected, true);
  assert.equal(definedInterestDecisionViewV1(null, false, false,
    { key: "same-key-1", rejected_before_admission: true }).canReplaceRejected, false);
  assert.equal(definedInterestDecisionViewV1(status("ready"), false, false,
    { key: "same-key-1", rejected_before_admission: true }).canReplaceRejected, false);
  assert.equal(definedInterestDecisionViewV1(status("completed"), false, false, null).canStart, false);
  assert.equal(definedInterestDecisionViewV1(status("blocked"), false, false, null).canStart, false);
});

test("accepted decisions are durable progress; unknown submissions stop automatic polling", () => {
  assert.equal(definedInterestDecisionViewV1(status("ready"), false, false, null).shouldPoll, true);
  assert.equal(definedInterestDecisionViewV1({ ...status("ready"), unknown_batches: 1,
    unsettled_calls: 1 }, false, false, null).shouldPoll, false);
  assert.equal(definedInterestDecisionViewV1(status("completed"), false, false, null).phase, "materializing");
  assert.equal(definedInterestDecisionViewV1(status("completed"), false, false, null).shouldPoll, true);
  assert.equal(definedInterestDecisionViewV1({ ...status("completed"), classification_status: "ready",
    generation_status: "ready" }, false, false, null).phase, "complete");
  assert.equal(definedInterestDecisionViewV1({ ...status("completed"), classification_status: "ready",
    generation_status: "ready" }, false, false, null).shouldPoll, false);
  assert.equal(definedInterestDecisionViewV1({ ...status("completed"), classification_status: "failed" },
    false, false, null).phase, "materializationFailed");
  assert.equal(definedInterestDecisionViewV1(status("ready"), false, false, null).showProgress, true);
});

test("exhausted technical attempts stop idle polling without becoming semantic insufficient evidence", () => {
  const terminal = { ...status("ready"), manifest_complete: true, expected_roots: 20,
    accepted_roots: 16, terminal_failed_roots: 4,
    technical_error_code: "interest_decision_attempts_exhausted" as const };
  const view = definedInterestDecisionViewV1(terminal, false, false, null);
  assert.equal(view.phase, "technicalFailed");
  assert.equal(view.shouldPoll, false);
  assert.equal(view.attention, true);
  assert.equal(view.canStart, false);
  assert.equal(definedInterestDecisionViewV1({ ...terminal, terminal_failed_roots: 2 },
    false, false, null).shouldPoll, true);
  assert.equal(definedInterestDecisionViewV1({ ...terminal, unknown_batches: 1 },
    false, false, null).phase, "ready");
  assert.equal(definedInterestDecisionViewV1({ ...terminal, status: "completed",
    classification_status: "ready", generation_status: "ready" }, false, false, null).phase, "complete");
});

test("a pending key clears only after the exact owner receipt is read", () => {
  const pending = { key: "same-key-1", owner_id: status("ready").owner_id };
  assert.equal(definedInterestDecisionReceiptMatchesV1(pending, status("ready")), true);
  assert.equal(definedInterestDecisionReceiptMatchesV1({ key: "same-key-1" }, status("ready")), false);
  assert.equal(definedInterestDecisionReceiptMatchesV1(pending,
    { ...status("ready"), owner_id: "00000000-0000-4000-8000-000000000002" }), false);
});

test("malformed progress never enables the paid start control", () => {
  assert.equal(validDefinedInterestDecisionStatusV1(status("not_started")), true);
  assert.equal(validDefinedInterestDecisionStatusV1({ ...status("ready"),
    prepared_batches: 367, recoverable_batches: 228 }), true);
  assert.equal(validDefinedInterestDecisionStatusV1({ ...status("ready"),
    recoverable_batches: -1 }), false);
  assert.equal(validDefinedInterestDecisionStatusV1({ ...status("ready"), accepted_roots: "16" }), false);
  assert.equal(validDefinedInterestDecisionStatusV1({ ...status("ready"), unknown_batches: -1 }), false);
  assert.equal(validDefinedInterestDecisionStatusV1({ ...status("ready"), status: "doubt" }), false);
  assert.equal(validDefinedInterestDecisionStatusV1({ ...status("ready"),
    terminal_failed_roots: 2, technical_error_code: "interest_decision_attempts_exhausted" }), true);
  assert.equal(validDefinedInterestDecisionStatusV1({ ...status("ready"),
    terminal_failed_roots: 2, technical_error_code: null }), false);
  assert.equal(validDefinedInterestDecisionStatusV1({ ...status("ready"),
    terminal_failed_roots: -1 }), false);
  assert.equal(validDefinedInterestDecisionStatusV1({ ...status("ready"),
    terminal_failed_roots: 43_159, technical_error_code: "interest_decision_attempts_exhausted" }), false);
  assert.equal(validDefinedInterestDecisionStatusV1({ ...status("ready"),
    technical_error_code: 7 }), false);
});

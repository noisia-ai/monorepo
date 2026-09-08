import assert from "node:assert/strict";
import test from "node:test";
import { acquisitionSlotActions, buildAcquisitionSlotViews, groupAcquisitionBlockers, type AcquisitionSlotIdentity } from "./workspace-acquisition-slot-view";

const current: AcquisitionSlotIdentity = {
  slot_key: "primary-brand", label: "Brand", scope: "primary_brand",
  desired_state: "active", plan_status: "current", plan_version: 1
};
const draft: AcquisitionSlotIdentity = { ...current, plan_status: "draft", plan_version: 2 };

test("a selected stale draft preserves authentic current slots and their history", () => {
  const [slot] = buildAcquisitionSlotViews([draft], [current]);
  assert.ok(slot);
  assert.equal(slot.current, current);
  assert.equal(slot.draft, draft);
  assert.deepEqual(acquisitionSlotActions({ current: slot.current, importAttempts: 6, readyForImport: false, hasActiveSource: true }),
    { showHistory: true, showImport: true, canImport: false });
});
test("draft-only scopes never masquerade as active imports, but existing receipts remain readable", () => {
  const [slot] = buildAcquisitionSlotViews([draft]);
  assert.ok(slot);
  assert.equal(slot.current, null);
  assert.deepEqual(acquisitionSlotActions({ current: null, importAttempts: 1, readyForImport: true, hasActiveSource: false }),
    { showHistory: true, showImport: false, canImport: false });
  assert.equal(acquisitionSlotActions({ current, importAttempts: 0, readyForImport: false, hasActiveSource: false }).showHistory, true);
});
test("a clean draft leaves current imports available only when backend readiness and source permit them", () => {
  const [slot] = buildAcquisitionSlotViews([{ ...draft, desired_state: "retired" }], [current]);
  assert.ok(slot);
  assert.equal(acquisitionSlotActions({ current: slot.current, importAttempts: 0, readyForImport: true, hasActiveSource: true }).canImport, true);
  assert.equal(acquisitionSlotActions({ current, importAttempts: 0, readyForImport: true, hasActiveSource: false }).canImport, false);
  assert.equal(acquisitionSlotActions({ current: { ...current, desired_state: "retired" }, importAttempts: 3, readyForImport: true, hasActiveSource: true }).canImport, false);
});
test("multiple missing scopes become one counted actionable notice", () => {
  assert.deepEqual(groupAcquisitionBlockers(["authority_drift", ...Array.from({ length: 5 }, (_, index) => `slot_reconcile_required:competitor:${index}`)]),
    [{ code: "authority_drift", count: 1 }, { code: "slot_reconcile_required", count: 5 }]);
});

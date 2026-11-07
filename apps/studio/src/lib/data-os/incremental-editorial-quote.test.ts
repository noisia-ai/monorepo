import assert from "node:assert/strict";
import test from "node:test";
import { incrementalEditorialEstimate, signIncrementalEditorialQuote, verifyIncrementalEditorialQuote, type IncrementalEditorialQuoteSource } from "./incremental-editorial-quote";
const source: IncrementalEditorialQuoteSource = {
  workspace_id: "workspace-a", actor_user_id: "actor-a", action: "begin_incremental_editorial", run_id: "run-a",
  evidence_plan_artifact_id: "plan-a", numeric_checkpoint_digest: "checkpoint-a", target_unit_digest: "targets-a",
  history_cut_digest: "history-a", target_units: 7, evidence_bytes: 70000, context_bytes: 10000,
  maximum_micro_usd: null, prior_admission_operation_id: null,
};
const now = Date.parse("2026-10-11T12:00:00Z"), key = "test-only-signing-key";
test("a signed forecast does not impose an optional spending cap", () => {
  const quote = signIncrementalEditorialQuote(source, now, key);
  assert.equal(quote.target_units, 7);
  assert.equal(quote.maximum_micro_usd, null);
  assert.equal(quote.estimated_micro_usd, incrementalEditorialEstimate(source));
  assert.ok(quote.estimated_micro_usd > 0);
  assert.equal(quote.model, "claude-sonnet-4-6");
  verifyIncrementalEditorialQuote(source, quote.reference, true, now, key);
});
test("confirmation, valid signature and unexpired quote are all required", () => {
  const quote = signIncrementalEditorialQuote(source, now, key);
  for (const [reference, confirmed, at, secret] of [
    [undefined, true, now, key], [quote.reference, false, now, key],
    [quote.reference, true, now + 240000, key], [quote.reference, true, now, "another-key"],
    [quote.reference, true, now - 1000, key],
  ] as const) assert.throws(() => verifyIncrementalEditorialQuote(source, reference, confirmed, at, secret), /quote_required/);
});
test("actor, workspace, targets, context, history, model and reservation identity cannot drift", () => {
  const quote = signIncrementalEditorialQuote(source, now, key);
  for (const patch of [{ actor_user_id: "other" }, { workspace_id: "other" }, { target_units: 8 },
    { evidence_bytes: 70001 }, { context_bytes: 10001 }, { history_cut_digest: "other" },
    { target_unit_digest: "other" }, { numeric_checkpoint_digest: "other" },
    { maximum_micro_usd: 1000000 }, { prior_admission_operation_id: "other" },
    { action: "renew_incremental_editorial" as const }, { evidence_plan_artifact_id: "other" }]) {
    assert.throws(() => verifyIncrementalEditorialQuote({ ...source, ...patch }, quote.reference, true, now, key), /quote_required/);
  }
});
test("invalid or empty evidence estimates cannot create an authorization quote", () => {
  for (const patch of [{ target_units: 0 }, { evidence_bytes: NaN }, { context_bytes: -1 }, { evidence_bytes: Infinity }])
    assert.throws(() => signIncrementalEditorialQuote({ ...source, ...patch }, now, key), /quote_required/);
});

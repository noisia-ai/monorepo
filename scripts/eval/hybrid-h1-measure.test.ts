import assert from "node:assert/strict";
import test from "node:test";
import { measureHybridH1V1, type HybridMeasuredRootV1 } from "./hybrid-h1-measure";
import type { Gold } from "./contract";

test("H1 reports review_required outside binary accuracy and uses settled cost only", () => {
  const gold = [
    { root_id: "a", input_digest: "1", partition: "dev", memberships: { x: "belongs" } },
    { root_id: "b", input_digest: "2", partition: "test", memberships: { x: "not_belongs" } },
  ] as unknown as Gold[];
  const rows: HybridMeasuredRootV1[] = [
    { root_id: "a", input_digest: "1", text: "Example", gate_passed: true,
      decisions: { x: { verdict: "review_required", needs_claude: false,
        jev: { verdict: "belongs", probability: 0.7, citation: { quote: "Example", start: 0, end: 7 } },
        claude: { verdict: "not_belongs", citation: { quote: "Example", start: 0, end: 7 } } } } },
    { root_id: "b", input_digest: "2", text: "Second", gate_passed: true,
      decisions: { x: { verdict: "not_belongs", needs_claude: false,
        jev: { verdict: "not_belongs", probability: 0.1, citation: { quote: "Second", start: 0, end: 6 } }, claude: null } } },
  ] as HybridMeasuredRootV1[];
  const result = measureHybridH1V1(gold, rows, ["x"], { facets_settled_usd: 0.1,
    jev_settled_usd: 0.2, claude_settled_usd: 0.3, unknown_calls: 0 }, 2);
  assert.ok(Math.abs((result.cost.observed_usd_per_1000 ?? 0) - 300) < 1e-9);
  assert.equal(result.full_corpus.review_required, 1);
  assert.equal(result.full_corpus.claude_citations_valid, 1);
  assert.equal(result.gold[0]!.views.full_pipeline.review_required, 1);
  assert.equal(result.gold[0]!.views.full_pipeline.hybrid.binary_evaluated, 0);
  assert.equal(result.gold[0]!.views.full_pipeline.hybrid.operational_unpublished_gold_positive, 1);
  assert.equal(result.gold[1]!.views.full_pipeline.hybrid.binary_evaluated, 1);
  assert.throws(() => measureHybridH1V1(gold, rows.slice(0, 1), ["x"],
    { facets_settled_usd: 0, jev_settled_usd: 0, claude_settled_usd: 0, unknown_calls: 0 }, 2),
    /hybrid_full_corpus_required/u);
  assert.throws(() => measureHybridH1V1([{ ...gold[0]!, input_digest: "changed" }, gold[1]!],
    rows, ["x"], { facets_settled_usd: 0, jev_settled_usd: 0, claude_settled_usd: 0, unknown_calls: 0 }, 2),
    /hybrid_gold_input_changed/u);
  assert.throws(() => measureHybridH1V1(gold, [{ ...rows[0]!, decisions: {
    x: { ...rows[0]!.decisions.x!, verdict: "belongs" } } }, rows[1]!], ["x"],
    { facets_settled_usd: 0, jev_settled_usd: 0, claude_settled_usd: 0, unknown_calls: 0 }, 2),
    /hybrid_(agreement_invalid|decision_mismatch)/u);
  assert.throws(() => measureHybridH1V1(gold, rows, ["x"],
    { facets_settled_usd: -1, jev_settled_usd: 0, claude_settled_usd: 0, unknown_calls: 0 }, 2),
    /hybrid_ledger_invalid/u);
});

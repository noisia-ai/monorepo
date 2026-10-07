import assert from "node:assert/strict";
import test from "node:test";
import { measureHybridH1V1, type HybridMeasuredRootV1 } from "./hybrid-h1-measure";
import { decideHybridMembershipV1 } from "../../packages/query-engine/src/signal-hybrid-membership-v1";
import type { Gold } from "./contract";

test("H1 reports review_required outside binary accuracy and uses settled cost only", () => {
  const gold = [
    { root_id: "a", input_digest: "1", partition: "dev", entities: [{ entity_id: "brand", kind: "primary_brand", salience: "main" }], memberships: { x: "belongs" } },
    { root_id: "b", input_digest: "2", partition: "test", entities: [{ entity_id: "rival", kind: "competitor", salience: "main" }], memberships: { x: "not_belongs" } },
  ] as unknown as Gold[];
  const rows: HybridMeasuredRootV1[] = [
    { root_id: "a", input_digest: "1", text: "Example", gate_passed: true,
      decisions: { x: { verdict: "review_required", needs_claude: false,
        jev: { verdict: "belongs", probability: 0.7, citation: { quote: "Example", start: 0, end: 7 } },
        claude: { verdict: "not_belongs", citation: { quote: "Example", start: 0, end: 7 } } } } },
    { root_id: "b", input_digest: "2", text: "Second", gate_passed: true,
      decisions: { x: { verdict: "belongs", needs_claude: false,
        jev: { verdict: "belongs", probability: 0.7, citation: { quote: "Second", start: 0, end: 6 } },
        claude: { verdict: "belongs", citation: { quote: "Second", start: 0, end: 6 } } } } },
  ] as HybridMeasuredRootV1[];
  const result = measureHybridH1V1(gold, rows, ["x"], { facets_settled_usd: 0.1,
    jev_settled_usd: 0.2, claude_settled_usd: 0.3, unknown_calls: 0 }, 2);
  assert.ok(Math.abs((result.cost.observed_usd_per_1000 ?? 0) - 300) < 1e-9);
  assert.equal(result.full_corpus.review_required, 1);
  assert.equal(result.full_corpus.claude_citations_valid, 2);
  assert.equal(result.gold[0]!.views.full_pipeline.review_required, 1);
  assert.equal(result.gold[0]!.views.full_pipeline.hybrid.binary_evaluated, 0);
  assert.equal(result.gold[0]!.views.full_pipeline.hybrid.operational_unpublished_gold_positive, 1);
  assert.equal(result.gold[1]!.views.full_pipeline.hybrid.binary_evaluated, 1);
  assert.equal(result.gold[1]!.views.full_pipeline.hybrid.false_positives_by_gold_entity_mix.competitor_without_primary, 1);
  // Literal citation does not establish that the correct entity was judged.
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

test("H1 comparable views exclude missing Claude judgments only from the evaluated view", () => {
  const gold = ["a", "b", "c"].map(root_id => ({ root_id, input_digest: root_id,
    partition: "test", entities: [], memberships: { x: "belongs" } })) as unknown as Gold[];
  const jev = { verdict: "belongs" as const, probability: 0.7,
    citation: { quote: "Example", start: 0, end: 7 } };
  const rows = [
    { root_id: "a", claude: { verdict: "belongs" as const,
      citation: { quote: "Example", start: 0, end: 7 } } },
    { root_id: "b", claude: { verdict: "insufficient" as const,
      citation: { quote: "Example", start: 0, end: 7 } } },
    { root_id: "c", claude: null },
  ].map(({ root_id, claude }) => ({ root_id, input_digest: root_id, text: "Example",
    gate_passed: true, decisions: { x: decideHybridMembershipV1("Example", jev, claude) } }));
  const result = measureHybridH1V1(gold, rows, ["x"], { facets_settled_usd: 0,
    jev_settled_usd: 0, claude_settled_usd: 0, unknown_calls: 0 }, 3);
  const views = result.gold.find(item => item.partition === "test")!.views;
  assert.equal(views.claude_evaluated_same_roots.roots, 2);
  assert.equal(views.full_pipeline.roots, 3);
  assert.equal(views.common_binary.roots, 1);
  assert.equal(views.full_pipeline.hybrid.operational_unpublished_gold_positive, 2);
});

test("H1 keeps an unreconciled non-gold pair out of terminal coverage and cost", () => {
  const gold = [{ root_id:"a",input_digest:"a",partition:"test",entities:[],memberships:{x:"not_belongs"} }] as unknown as Gold[];
  const rows:HybridMeasuredRootV1[] = [
    {root_id:"a",input_digest:"a",text:"Example",gate_passed:true,
      decisions:{x:decideHybridMembershipV1("Example",{verdict:"not_belongs",probability:0.1,citation:null},null)}},
    {root_id:"b",input_digest:"b",text:"Unresolved",gate_passed:true,decisions:{},unresolved_concepts:["x"]},
  ];
  const report=measureHybridH1V1(gold,rows,["x"],{facets_settled_usd:0.1,
    jev_settled_usd:0.2,claude_settled_usd:0.3,unknown_calls:1,
    unknown_provider_usd_upper_bound:0.002688},2);
  assert.equal(report.status,"experimental_incomplete_not_approved");
  assert.equal(report.full_corpus.unresolved_pairs,1);
  assert.equal(report.full_corpus.pair_coverage,0.5);
  assert.equal(report.gold[0]!.views.full_pipeline.roots,0);
  assert.equal(report.gold[1]!.views.full_pipeline.roots,1);
  assert.equal(report.cost.observed_usd_per_1000,null);
  assert.ok(Math.abs(report.cost.possible_usd_per_1000_range![0]-300)<1e-9);
  assert.ok(Math.abs(report.cost.possible_usd_per_1000_range![1]-301.344)<1e-9);
  assert.throws(()=>measureHybridH1V1(gold,rows,["x"],{facets_settled_usd:0.1,
    jev_settled_usd:0.2,claude_settled_usd:0.3,unknown_calls:0},2),/hybrid_unknown_ledger_mismatch/u);
});

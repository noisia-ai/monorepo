/** Read-only scoring of actual H1 receipts. Counterfactual projections are never accepted here. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { decideHybridMembershipV1, validHybridCitationV1, type HybridDecisionV1 } from "../../packages/query-engine/src/signal-hybrid-membership-v1";
import { type Gold, type Selection, validateGold, validateSelection } from "./contract";
import { binary, wilson } from "./metrics";

export type HybridMeasuredRootV1 = { root_id: string; input_digest: string; text: string; gate_passed: boolean;
  decisions: Record<string, HybridDecisionV1>; unresolved_concepts?: string[]; excluded_override_concepts?:string[] };
export type HybridObservedLedgerV1 = { facets_settled_usd: number; jev_settled_usd: number;
  claude_settled_usd: number; unknown_calls: number; unknown_provider_usd_upper_bound?: number;
  uncertain_pair_calls?:Record<string,string>;
  historical_unknown_calls?:number;historical_unknown_exposure_usd?:number;
  override_excluded_by_decided_via?:Record<string,number>;
  out_of_selection_jev_pairs?: number; out_of_selection_claude_pairs?: number;
  out_of_selection_jev_settled_usd?: number; out_of_selection_claude_settled_usd?: number };
/** A receipt can cover many pairs; money is counted once per provider call. */
export function hybridUncertainExposureV1(rows:Array<{id:string;status:string;reserved_micro_usd:string;terminal_exposure_micro_usd:string}>){
  const unique=new Map<string,typeof rows[number]>();
  for(const row of rows){const prior=unique.get(row.id);
    if(prior&&(prior.status!==row.status||prior.reserved_micro_usd!==row.reserved_micro_usd||prior.terminal_exposure_micro_usd!==row.terminal_exposure_micro_usd))
      throw new Error("hybrid_uncertain_call_conflict");unique.set(row.id,row);
  }
  return {calls:unique.size,exposure_usd:[...unique.values()].reduce((sum,row)=>sum+
    Number(row.terminal_exposure_micro_usd)+(row.status==="unknown"?Number(row.reserved_micro_usd):0),0)/1e6};
}
const emitted = (v: string) => v === "belongs" || v === "not_belongs";
function goldEntityMix(row: Gold) {
  const kinds = new Set(row.entities.map(entity => entity.kind));
  if (kinds.has("primary_brand") && kinds.has("competitor")) return "primary_and_competitor";
  if (kinds.has("primary_brand")) return "primary_present";
  if (kinds.has("competitor")) return "competitor_without_primary";
  if (kinds.has("category")) return "category_without_brand";
  return "no_gold_entity";
}
function score(gold: Gold[], rows: Map<string, HybridMeasuredRootV1>, key: string,
  prediction: (row: HybridMeasuredRootV1 | undefined) => string) {
  const evaluated = gold.map(g => ({ truth: g.memberships[key], predicted: prediction(rows.get(g.root_id)),
    entity_mix: goldEntityMix(g) }));
  const binaryRows = evaluated.filter(r => r.truth !== "insufficient" && emitted(r.predicted));
  const tp = binaryRows.filter(r => r.truth === "belongs" && r.predicted === "belongs").length;
  const fp = binaryRows.filter(r => r.truth === "not_belongs" && r.predicted === "belongs").length;
  const fn = binaryRows.filter(r => r.truth === "belongs" && r.predicted === "not_belongs").length;
  return { roots: gold.length, binary_evaluated: binaryRows.length,
    review_required: evaluated.filter(r => r.predicted === "review_required").length,
    states: Object.fromEntries(["belongs", "not_belongs", "review_required", "insufficient", "refused", "error", "pending"]
      .map(v => [v, evaluated.filter(r => r.predicted === v).length])),
    false_positives_by_gold_entity_mix: Object.fromEntries(["primary_and_competitor", "primary_present",
      "competitor_without_primary", "category_without_brand", "no_gold_entity"]
      .map(mix => [mix, evaluated.filter(r => r.truth === "not_belongs" && r.predicted === "belongs" &&
        r.entity_mix === mix).length])),
    ...binary(tp, fp, fn), precision_wilson: wilson(tp, tp + fp), recall_wilson: wilson(tp, tp + fn),
    operational_unpublished_gold_positive: evaluated.filter(r => r.truth === "belongs" && r.predicted !== "belongs").length,
  };
}
export function measureHybridH1V1(gold: Gold[], roots: HybridMeasuredRootV1[], concepts: string[],
  ledger: HybridObservedLedgerV1, expectedRoots = 1086) {
  if (roots.length !== expectedRoots || new Set(roots.map(r => r.root_id)).size !== roots.length)
    throw new Error("hybrid_full_corpus_required");
  if (new Set(concepts).size !== concepts.length || !concepts.length) throw new Error("hybrid_concepts_invalid");
  const indexed = new Map(roots.map(r => [r.root_id, r]));
  for (const root of roots) {
    if (!root.root_id || !root.input_digest || typeof root.text !== "string" || typeof root.gate_passed !== "boolean")
      throw new Error("hybrid_root_invalid");
    const unresolved = root.unresolved_concepts ?? [];
    const excluded=root.excluded_override_concepts??[];
    if(new Set(excluded).size!==excluded.length||excluded.some(key=>!root.gate_passed||!concepts.includes(key)||root.decisions[key]||unresolved.includes(key)))
      throw new Error("hybrid_override_exclusion_invalid");
    if (new Set(unresolved).size !== unresolved.length || unresolved.some(key => !concepts.includes(key) ||
      !root.gate_passed || root.decisions[key])) throw new Error("hybrid_unresolved_pair_invalid");
    if (root.gate_passed && concepts.some(key => !root.decisions[key] && !unresolved.includes(key) && !excluded.includes(key)))
      throw new Error("hybrid_pairs_missing");
    for (const [key, decision] of Object.entries(root.decisions)) {
      if (!concepts.includes(key) || !root.gate_passed) throw new Error("hybrid_unexpected_pair");
      if (decision.verdict === "belongs" && (!decision.claude || decision.claude.verdict !== "belongs"))
        throw new Error("hybrid_agreement_invalid");
      if (decision.verdict === "review_required" && (!decision.claude || !["not_belongs", "insufficient"].includes(decision.claude.verdict)))
        throw new Error("hybrid_review_invalid");
      const recalculated = decideHybridMembershipV1(root.text, decision.jev, decision.claude);
      if (decision.verdict !== recalculated.verdict || decision.needs_claude !== recalculated.needs_claude)
        throw new Error("hybrid_decision_mismatch");
    }
  }
  for (const row of gold) if (indexed.get(row.root_id)?.input_digest !== row.input_digest)
    throw new Error("hybrid_gold_input_changed");
  const costs = [ledger.facets_settled_usd, ledger.jev_settled_usd, ledger.claude_settled_usd];
  const unresolvedPairs = roots.reduce((sum,root) => sum + (root.unresolved_concepts?.length ?? 0),0);
  if (costs.some(v => !Number.isFinite(v) || v < 0) || !Number.isSafeInteger(ledger.unknown_calls) || ledger.unknown_calls < 0)
    throw new Error("hybrid_ledger_invalid");
  if ([ledger.out_of_selection_jev_pairs,ledger.out_of_selection_claude_pairs].some(v=>
    v!==undefined&&(!Number.isSafeInteger(v)||v<0)) ||
    [ledger.out_of_selection_jev_settled_usd,ledger.out_of_selection_claude_settled_usd].some(v=>
      v!==undefined&&(!Number.isFinite(v)||v<0)) ||
    (ledger.out_of_selection_jev_settled_usd??0)>ledger.jev_settled_usd ||
    (ledger.out_of_selection_claude_settled_usd??0)>ledger.claude_settled_usd)
    throw new Error("hybrid_extra_concept_ledger_invalid");
  const totalUnknownCalls=ledger.unknown_calls+(ledger.historical_unknown_calls??0),mapping=ledger.uncertain_pair_calls??{};
  if((ledger.historical_unknown_calls!==undefined&&(!Number.isSafeInteger(ledger.historical_unknown_calls)||ledger.historical_unknown_calls<0))||
    Object.values(mapping).some(id=>!id)||new Set(Object.values(mapping)).size!==totalUnknownCalls||
    roots.some(root=>(root.unresolved_concepts??[]).some(key=>!mapping[`${root.root_id}:${key}`]))||
    (ledger.unknown_calls>0&&(!Number.isFinite(ledger.unknown_provider_usd_upper_bound)||(ledger.unknown_provider_usd_upper_bound??0)<0)))
    throw new Error("hybrid_unknown_ledger_mismatch");
  const decisions = roots.flatMap(root => Object.values(root.decisions).map(decision => ({root,decision})));
  const quoted = decisions.filter(x => x.decision.claude?.citation);
  const valid = quoted.filter(x => validHybridCitationV1(x.root.text, x.decision.claude!.citation));
  const attempted = decisions.filter(x => x.decision.claude);
  const fullCorpus = { roots: roots.length, gate_passed: roots.filter(r => r.gate_passed).length,
    pairs: decisions.length, unresolved_pairs: unresolvedPairs,
    override_excluded_pairs:roots.reduce((sum,root)=>sum+(root.excluded_override_concepts?.length??0),0),
    pair_coverage: decisions.length + unresolvedPairs ? decisions.length / (decisions.length + unresolvedPairs) : 1,
    jev_positive: decisions.filter(x => x.decision.jev.verdict === "belongs").length,
    review_required: decisions.filter(x => x.decision.verdict === "review_required").length,
    review_rate_of_jev_positive: decisions.filter(x => x.decision.jev.verdict === "belongs").length
      ? decisions.filter(x => x.decision.verdict === "review_required").length / decisions.filter(x => x.decision.jev.verdict === "belongs").length : null,
    claude_attempted: attempted.length, claude_citations: quoted.length, claude_citations_valid: valid.length,
    claude_citation_valid_rate: attempted.length ? valid.length / attempted.length : null,
    quoted_span_integrity: quoted.length ? valid.length / quoted.length : null,
    states: Object.fromEntries(["belongs", "not_belongs", "review_required", "refused", "error", "pending"]
      .map(v => [v, decisions.filter(x => x.decision.verdict === v).length])),
  };
  const reportGold = concepts.flatMap((key, index) => (["dev", "test"] as const)
    .map(partition => {
      const partitionGold = gold.filter(g => g.partition === partition);
      const all=partitionGold.filter(g=>!indexed.get(g.root_id)?.excluded_override_concepts?.includes(key));
      const positive = all.filter(g => indexed.get(g.root_id)?.decisions[key]?.jev.verdict === "belongs");
      const evaluated = positive.filter(g => ["belongs", "not_belongs", "insufficient"].includes(
        indexed.get(g.root_id)?.decisions[key]?.claude?.verdict ?? ""));
      const common = positive.filter(g => emitted(indexed.get(g.root_id)?.decisions[key]?.claude?.verdict ?? ""));
      const verdict = (r: HybridMeasuredRootV1 | undefined) => r?.decisions[key]?.verdict ?? "pending";
      const jev = (r: HybridMeasuredRootV1 | undefined) => r?.decisions[key]?.jev.verdict ?? "pending";
      const claude = (r: HybridMeasuredRootV1 | undefined) => r?.decisions[key]?.claude?.verdict ?? "pending";
      const view = (subset: Gold[]) => ({ roots: subset.length,
        hybrid: score(subset, indexed, key, verdict), jev: score(subset, indexed, key, jev), claude: score(subset, indexed, key, claude),
        review_required: subset.filter(g => verdict(indexed.get(g.root_id)) === "review_required").length,
      });
      return { concept: `concept_${index + 1}`, partition, gold_roots_before_exclusion:partitionGold.length,
        override_excluded:partitionGold.length-all.length,
        views: { claude_evaluated_same_roots: view(evaluated), full_pipeline: view(all), common_binary: view(common) } };
    }));
  const {uncertain_pair_calls:_privateCallMapping,...publicLedger}=ledger;
  const total = costs.reduce((a,b) => a+b, 0);
  const settledPer1000 = 1000 * total / roots.length;
  return { contract_version: "mfp-hybrid-h1-measure-v1",
    status: unresolvedPairs ? "experimental_incomplete_not_approved" : "experimental_not_approved",
    full_corpus: fullCorpus, gold: reportGold,
    cost: { new_membership_settled_usd:ledger.jev_settled_usd+ledger.claude_settled_usd,
      new_membership_usd_per_1000:1000*(ledger.jev_settled_usd+ledger.claude_settled_usd)/roots.length,
      reused_facets_settled_usd:ledger.facets_settled_usd,observed_settled_usd: total, observed_usd_per_1000: ledger.unknown_calls ? null : settledPer1000,
      settled_usd_per_1000: settledPer1000,
      possible_usd_per_1000_range: ledger.unknown_calls
        ? [settledPer1000, 1000 * (total + ledger.unknown_provider_usd_upper_bound!) / roots.length] : null,
      unknown_calls: ledger.unknown_calls, components: publicLedger },
    note: "JEV noul does not localize evidence: its source reference is the complete root. Claude citations are span-selected and checked against literal source text. Current overrides are excluded per concept from model quality denominators; they never become model hits." };
}

async function main(args: string[]) {
  if (args.length !== 10 || args[0] !== "--selection" || args[2] !== "--gold" || args[4] !== "--roots" ||
      args[6] !== "--ledger" || args[8] !== "--output") throw new Error("hybrid_measure_arguments");
  const selection = JSON.parse(await readFile(args[1]!, "utf8")) as Selection;
  validateSelection(selection);
  const gold = (await readFile(args[3]!, "utf8")).trim().split("\n").map(line => JSON.parse(line)) as Gold[];
  validateGold(gold, selection);
  const roots = (await readFile(args[5]!, "utf8")).trim().split("\n").map(line => JSON.parse(line)) as HybridMeasuredRootV1[];
  const ledger = JSON.parse(await readFile(args[7]!, "utf8")) as HybridObservedLedgerV1;
  const report = measureHybridH1V1(gold, roots, selection.concepts.map(c => c.concept_key), ledger);
  const hashes = await Promise.all([args[1], args[3], args[5], args[7]].map(async file =>
    createHash("sha256").update(await readFile(file!)).digest("hex")));
  await writeFile(args[9]!, JSON.stringify({ input_sha256: hashes, ...report }, null, 2) + "\n", {flag:"wx",mode:0o600});
  console.log(JSON.stringify({status:report.status,roots:report.full_corpus.roots,observed_usd_per_1000:report.cost.observed_usd_per_1000}));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2)).catch(() => { console.error("hybrid_measure_failed"); process.exitCode = 1; });

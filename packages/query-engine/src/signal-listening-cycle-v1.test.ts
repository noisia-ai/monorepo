import test from "node:test";
import assert from "node:assert/strict";
import { applySignalListeningReviewV1, applySignalListeningRuleMergesV1, buildSignalListeningReviewPayloadV1, clusterSignalListeningOrphansV1, decideSignalListeningCycleStopV1,
  signalListeningReviewCostMicroUsdV1, SIGNAL_LISTENING_CYCLE_POLICY_V1 as policy, validateSignalListeningCatalogV1,
  type SignalListeningCatalogTopicV1, type SignalListeningCycleEvidenceV1 } from "./signal-listening-cycle-v1";

const topic = (topic_key: string, extra: Partial<SignalListeningCatalogTopicV1> = {}): SignalListeningCatalogTopicV1 => ({ topic_key,
  localization: { original_language: "pt-BR", original: { name: `${topic_key} pt`, definition: `Sobre ${topic_key}.` },
    en: { name: `${topic_key} en`, definition: `About ${topic_key}.` }, es: { name: `${topic_key} es`, definition: `Sobre ${topic_key}.` } },
  domain: "category", theme_key: null, origin: "discovery", human_locked: false, source_topic_keys: [], orphan_group_keys: [], ...extra });
const wording = (name: string) => ({ name, definition: `${name}: what it is and what it is not.` });
type Action = "keep" | "redefine" | "merge" | "new";
const proposal = (key: string, action: Action, sources: string[], extra: Record<string, unknown> = {}) => ({ key, action,
  source_topic_keys: sources, orphan_group_keys: [], domain: "category", theme_key: "taste", original_language: "pt-BR",
  original: wording(`${key} pt`), en: wording(`${key} en`), es: wording(`${key} es`), ...extra });
/** Builds the agent's answer: kept topics carry only key, domain and theme. */
const answer = (themeList: unknown[], items: Array<ReturnType<typeof proposal>>) => ({ themes: themeList,
  kept: items.filter(item => item.action === "keep").map(item => ({ key: item.key, domain: item.domain, theme_key: item.theme_key })),
  changed: items.filter(item => item.action !== "keep") });
const themes = [{ key: "taste", name_original: "Sabor", name_en: "Taste", name_es: "Sabor" }];
const catalog = [topic("bitter"), topic("bitterness"), topic("price"), topic("auction"), topic("ritual", { human_locked: true })];
const groups = [{ group_key: "orphans_1", roots: 120, cohesion: 0.6, examples: ["cold one after work"] }];
const evidence = (round: number, orphan_rate: number, twin_root_rate: number): SignalListeningCycleEvidenceV1 => ({ round, roots: 1000, category_roots: 500,
  orphan_roots: Math.round(orphan_rate * 500), orphan_rate, twin_roots: Math.round(twin_root_rate * 500), twin_root_rate, topics: [], twins: [] });

test("a review merges twins, redefines, adds from orphans and marks what is outside", () => {
  const result = applySignalListeningReviewV1({ catalog, orphan_groups: groups, output: answer(themes, [
    proposal("bitterness", "merge", ["bitter", "bitterness"]),
    proposal("price", "redefine", ["price"]),
    proposal("auction", "keep", ["auction"], { domain: "outside" }),
    proposal("after_work", "new", [], { orphan_group_keys: ["orphans_1"] }),
    proposal("ritual", "keep", ["ritual"]),
  ]) });
  assert.deepEqual(result.catalog.map(item => item.topic_key), ["after_work", "auction", "bitterness", "price", "ritual"]);
  assert.deepEqual(result.summary, { kept: 2, redefined: 1, merged: 1, created: 1, retired_by_merge: 1, outside: 1, adjacent: 0, themes: 1, merged_by_rule: 0 });
  assert.equal(result.map_changed, true);
  const merged = result.catalog.find(item => item.topic_key === "bitterness")!;
  assert.deepEqual(merged.source_topic_keys, ["bitter", "bitterness"]); assert.equal(merged.origin, "agent");
  // A kept topic keeps its wording, so its answers stay in the cache; only its place in the map changes.
  const kept = result.catalog.find(item => item.topic_key === "auction")!;
  assert.deepEqual(kept.localization, catalog[3]!.localization); assert.equal(kept.domain, "outside"); assert.equal(kept.theme_key, "taste");
  assert.deepEqual(result.catalog.find(item => item.topic_key === "after_work")!.orphan_group_keys, ["orphans_1"]);
});

test("a topic a person edited is frozen for the agent", () => {
  const result = applySignalListeningReviewV1({ catalog, orphan_groups: groups, output: answer(themes, [
    proposal("ritual", "redefine", ["ritual"]),
    proposal("everything", "merge", ["ritual", "price"]),
  ]) });
  const locked = result.catalog.find(item => item.topic_key === "ritual")!;
  assert.deepEqual(locked.localization, catalog[4]!.localization, "its wording is untouched");
  assert.equal(locked.human_locked, true);
  assert.deepEqual(result.rejected.map(item => item.reason), ["human_locked", "source_already_used"]);
  assert.ok(result.catalog.some(item => item.topic_key === "price"), "the other source of the refused merge is kept");
  assert.equal(result.map_changed, false);
});

test("a partial or sloppy answer never loses a topic", () => {
  const result = applySignalListeningReviewV1({ catalog, orphan_groups: groups, output: answer([], [
    proposal("bitter", "keep", []),
    proposal("Bad Key", "new", [], { orphan_group_keys: ["orphans_1"] }),
    proposal("ghost", "new", [], { orphan_group_keys: ["no_such_group"] }),
    proposal("price", "redefine", ["price"], { en: { name: "", definition: "" } }),
    proposal("bitterness", "merge", ["bitterness"]),
    proposal("bitterness", "redefine", ["bitter"]),
  ]) });
  assert.deepEqual(result.catalog.map(item => item.topic_key), catalog.map(item => item.topic_key).sort());
  assert.deepEqual(result.rejected.map(item => item.reason), ["key_invalid", "new_without_orphan_group", "wording_incomplete", "merge_needs_two_sources", "redefine_needs_its_own_key"]);
  assert.equal(result.map_changed, false);
  assert.equal(result.catalog.every(item => item.theme_key === null), true, "an unknown theme is not invented");
  assert.throws(() => applySignalListeningReviewV1({ catalog, orphan_groups: groups, output: { kept: "no" } }), /listening_review_output_invalid/);
});

test("the stop rule is the round limit, no change, or no improvement", () => {
  const decide = (current: SignalListeningCycleEvidenceV1, previous: SignalListeningCycleEvidenceV1 | null, map_changed = true) =>
    decideSignalListeningCycleStopV1({ policy, current, previous, map_changed }).reason;
  assert.equal(decide(evidence(1, 0.23, 0.08), null), "continue");
  assert.equal(decide(evidence(2, 0.15, 0.03), evidence(1, 0.23, 0.08)), "continue");
  assert.equal(decide(evidence(2, 0.225, 0.075), evidence(1, 0.23, 0.08)), "stagnation");
  assert.equal(decide(evidence(2, 0.229, 0.02), evidence(1, 0.23, 0.08)), "continue", "one of the two improving is enough");
  assert.equal(decide(evidence(2, 0.1, 0.01), evidence(1, 0.23, 0.08), false), "map_unchanged");
  assert.equal(decide(evidence(3, 0.05, 0.01), evidence(2, 0.15, 0.03)), "max_rounds");
  assert.equal(decide({ ...evidence(1, 0, 0), category_roots: 0, orphan_rate: null, twin_root_rate: null }, null), "no_category_population");
});

test("the review payload carries the asked wording, the evidence and the locks", () => {
  const measured: SignalListeningCycleEvidenceV1 = { ...evidence(1, 0.2, 0.05), topics: [{ topic_key: "price", asked: 400, approved: 20, acceptance: 0.05,
    accepted_examples: ["too expensive"], rejected_examples: ["nice label"] }], twins: [{ left: "bitter", right: "bitterness", jointly_asked: 90, jointly_approved: 60,
    jaccard: 0.5, coapproval: 0.66, examples: ["so bitter"] }] };
  const payload = JSON.parse(buildSignalListeningReviewPayloadV1({ category: "sparkling water", question_language: "en", catalog, themes: [], evidence: measured,
    orphan_groups: groups, policy }));
  const price = payload.topics.find((item: { key: string }) => item.key === "price");
  assert.deepEqual([price.name, price.asked, price.accepted, price.weak], ["price en", 400, 20, true]);
  assert.equal(payload.topics.find((item: { key: string }) => item.key === "ritual").locked, true);
  assert.deepEqual(payload.possible_twins[0].topics, ["bitter", "bitterness"]);
  assert.equal(payload.orphan_groups[0].posts, 120);
  assert.equal(payload.population.without_any_topic, 100);
});

test("a catalog needs unique keys and three wordings", () => {
  assert.equal(validateSignalListeningCatalogV1(catalog).length, 5);
  assert.throws(() => validateSignalListeningCatalogV1([topic("a"), topic("a")]), /listening_catalog_invalid/);
  assert.throws(() => validateSignalListeningCatalogV1([{ ...topic("a"), domain: "elsewhere" }]), /listening_catalog_invalid/);
});

test("review cost follows the model price", () => {
  assert.equal(signalListeningReviewCostMicroUsdV1({ input_tokens: 100_000, output_tokens: 20_000 }), 600_000);
});

test("orphans are grouped by direction", () => {
  const dimensions = 3, axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], vectors = new Float32Array(90 * dimensions);
  for (let row = 0; row < 90; row++) for (let d = 0; d < dimensions; d++) vectors[row * dimensions + d] = axes[row % 3]![d]! * (1 + row) + ((row * 7 + d * 3) % 5) * 0.02;
  const result = clusterSignalListeningOrphansV1({ vectors, dimensions, groups: 3 });
  assert.deepEqual([...result.sizes].sort(), [30, 30, 30]);
  for (let row = 3; row < 90; row++) assert.equal(result.assignments[row], result.assignments[row % 3], "same direction, same group whatever the length");
  assert.ok(Math.min(...result.similarities) > 0.99);
  assert.equal(clusterSignalListeningOrphansV1({ vectors: vectors.subarray(0, 6), dimensions, groups: 10 }).sizes.reduce((sum, size) => sum + size, 0), 2);
});

test("a kept topic drops its lineage and keeps its exact wording and its theme", () => {
  const spaced = topic("spaced", { source_topic_keys: ["older"], orphan_group_keys: ["orphans_1"], theme_key: "old_theme" });
  spaced.localization.en.definition = "About spaced. ";
  const before = [{ theme_key: "old_theme", name: { original: "Velho", en: "Old", es: "Viejo" } }];
  const result = applySignalListeningReviewV1({ catalog: [spaced, topic("other")], themes: before, orphan_groups: groups, output: answer(themes, [
    proposal("other", "keep", ["other"]) ]) });
  const kept = result.catalog.find(item => item.topic_key === "spaced")!;
  assert.deepEqual([kept.source_topic_keys, kept.orphan_group_keys], [[], []], "old lineage must not steer the next centroid");
  assert.equal(kept.localization.en.definition, "About spaced. ", "trimming would change the identity of an answered question");
  assert.equal(kept.theme_key, "old_theme", "a topic the answer does not mention keeps its theme");
  assert.deepEqual(result.themes.map(item => item.theme_key).sort(), ["old_theme", "taste"]);
});

test("a locked topic can be placed in a theme and a domain without touching its wording", () => {
  const result = applySignalListeningReviewV1({ catalog, orphan_groups: groups, output: answer(themes, [proposal("ritual", "keep", ["ritual"], { domain: "adjacent" })]) });
  const locked = result.catalog.find(item => item.topic_key === "ritual")!;
  assert.deepEqual([locked.domain, locked.theme_key, locked.human_locked], ["adjacent", "taste", true]);
  assert.deepEqual(locked.localization, catalog[4]!.localization);
});

// ---------- two levels of membership and merging by default

const pair = (left: string, right: string, coapproval: number) => ({ left, right, jointly_asked: 100, jointly_approved: Math.round(coapproval * 100), jaccard: 0.3, coapproval, examples: [] });
const sizes = (values: Record<string, number>) => Object.entries(values).map(([topic_key, approved]) => ({ topic_key, asked: approved * 2, approved, acceptance: 0.5,
  accepted_examples: [], rejected_examples: [] }));
const measured = { topics: sizes({ bitter: 300, bitterness: 120, price: 80, auction: 10, ritual: 50 }) };

test("the default policy counts a member from 0.85 and keeps 0.70 as probable", () => {
  assert.deepEqual([policy.approval, policy.probable, policy.twin.merge_coapproval, policy.twin.probation_coapproval], [0.85, 0.7, 0.4, 0.2]);
});

test("a pair accepted together often is merged by default: the larger topic stays with its wording", () => {
  const rules = { policy, evidence: { ...measured, twins: [pair("bitter", "bitterness", 0.55), pair("price", "auction", 0.1)] } };
  const result = applySignalListeningReviewV1({ catalog, orphan_groups: groups, rules, output: answer(themes, [
    proposal("bitter", "keep", ["bitter"]), proposal("bitterness", "keep", ["bitterness"]), proposal("price", "keep", ["price"])]) });
  assert.deepEqual(result.catalog.map(item => item.topic_key), ["auction", "bitter", "price", "ritual"]);
  const stays = result.catalog.find(item => item.topic_key === "bitter")!;
  assert.deepEqual(stays.localization, catalog[0]!.localization, "its question does not change");
  assert.deepEqual(stays.source_topic_keys, ["bitter", "bitterness"], "the posts of both are its lineage");
  assert.deepEqual(result.rule_merges, [{ stays: "bitter", folded: "bitterness", reason: "accepted_together" }]);
  assert.deepEqual([result.summary.kept, result.summary.merged_by_rule, result.summary.retired_by_merge, result.map_changed], [3, 1, 1, true]);
  assert.deepEqual(result.probation, []);
});

test("the review may keep such a pair apart only by redefining both, and then it is measured once more", () => {
  const rules = { policy, evidence: { ...measured, twins: [pair("bitter", "bitterness", 0.55)] } };
  const both = applySignalListeningReviewV1({ catalog, orphan_groups: groups, rules, output: answer(themes, [
    proposal("bitter", "redefine", ["bitter"]), proposal("bitterness", "redefine", ["bitterness"])]) });
  assert.deepEqual(both.probation, [{ left: "bitter", right: "bitterness" }]);
  assert.deepEqual(both.rule_merges, []);
  assert.equal(both.catalog.length, 5);
  // Redefining only one side is not a separation: the pair is merged, and the larger topic keeps the wording it has now.
  const one = applySignalListeningReviewV1({ catalog, orphan_groups: groups, rules, output: answer(themes, [proposal("bitter", "redefine", ["bitter"])]) });
  assert.deepEqual(one.rule_merges, [{ stays: "bitter", folded: "bitterness", reason: "accepted_together" }]);
  assert.equal(one.catalog.find(item => item.topic_key === "bitter")!.localization.en.name, "bitter en", "the new wording of the topic that stays is kept");
  assert.deepEqual(one.probation, []);
});

test("a pair that was kept apart and is still accepted together merges without another say", () => {
  const evidence = { ...measured, twins: [], probation: [{ left: "bitter", right: "bitterness", jointly_asked: 200, jointly_approved: 60, coapproval: 0.3 },
    { left: "price", right: "auction", jointly_asked: 200, jointly_approved: 10, coapproval: 0.05 }] };
  const result = applySignalListeningReviewV1({ catalog, orphan_groups: groups, rules: { policy, evidence }, output: answer(themes, [
    proposal("bitter", "redefine", ["bitter"]), proposal("bitterness", "redefine", ["bitterness"])]) });
  assert.deepEqual(result.rule_merges, [{ stays: "bitter", folded: "bitterness", reason: "second_chance_failed" }]);
  assert.deepEqual(result.probation, []);
  assert.ok(result.catalog.some(item => item.topic_key === "price") && result.catalog.some(item => item.topic_key === "auction"), "the pair that came apart stays apart");
  const payload = JSON.parse(buildSignalListeningReviewPayloadV1({ category: "beer", question_language: "en", catalog, themes: [], orphan_groups: [], policy,
    evidence: { round: 2, roots: 10, category_roots: 5, orphan_roots: 1, orphan_rate: 0.2, twin_roots: 1, twin_root_rate: 0.2, topics: [], twins: [pair("price", "ritual", 0.5), pair("price", "auction", 0.1)],
      probation: evidence.probation } }));
  assert.deepEqual(payload.possible_twins.map((item: { topics: string[]; must_merge?: boolean; merges_unless_separated?: boolean }) => [item.topics.join("+"), item.must_merge ?? false, item.merges_unless_separated ?? false]),
    [["bitter+bitterness", true, false], ["price+ritual", false, true], ["price+auction", false, false]]);
});

test("the rule respects what the agent and people already decided, and follows chains", () => {
  // The agent already merged them: nothing left for the rule.
  const agent = applySignalListeningReviewV1({ catalog, orphan_groups: groups, rules: { policy, evidence: { ...measured, twins: [pair("bitter", "bitterness", 0.9)] } },
    output: answer(themes, [proposal("bitterness", "merge", ["bitter", "bitterness"])]) });
  assert.deepEqual([agent.rule_merges.length, agent.summary.merged, agent.summary.merged_by_rule], [0, 1, 0]);
  // A topic a person edited is never folded by the rule.
  const locked = applySignalListeningReviewV1({ catalog, orphan_groups: groups, rules: { policy, evidence: { ...measured, twins: [pair("price", "ritual", 0.9)] } }, output: answer(themes, []) });
  assert.deepEqual([locked.rule_merges.length, locked.rejected.map(item => item.reason)], [0, ["rule_merge_human_locked"]]);
  assert.equal(locked.map_changed, false);
  // a+b and b+c end as one topic: the largest of the three.
  const chain = applySignalListeningRuleMergesV1({ catalog, themes: [], policy, evidence: { ...measured, twins: [pair("bitterness", "price", 0.6), pair("bitter", "bitterness", 0.5)] } });
  assert.deepEqual(chain.catalog.map(item => item.topic_key), ["auction", "bitter", "ritual"]);
  assert.deepEqual(chain.catalog.find(item => item.topic_key === "bitter")!.source_topic_keys, ["bitter", "bitterness", "price"]);
  assert.equal(chain.summary.merged_by_rule, 2);
  // A policy without the rule (a cycle started before it existed) never merges on its own.
  const { merge_coapproval: _merge, probation_coapproval: _probation, ...twin } = policy.twin;
  const old = applySignalListeningRuleMergesV1({ catalog, themes: [], policy: { ...policy, twin }, evidence: { ...measured, twins: [pair("bitter", "bitterness", 0.9)] } });
  assert.deepEqual([old.rule_merges.length, old.map_changed], [0, false]);
});

test("in a chain the topic that already took another in is compared with all it holds", () => {
  // bitter (300) takes bitterness (50) in first; price (100) then meets what stands in the place of bitterness: 350, not 50.
  const evidence = { topics: sizes({ bitter: 300, bitterness: 50, price: 100, auction: 10, ritual: 50 }), twins: [pair("bitter", "bitterness", 0.6), pair("bitterness", "price", 0.5)] };
  const result = applySignalListeningRuleMergesV1({ catalog, themes: [], policy, evidence });
  assert.deepEqual(result.rule_merges, [{ stays: "bitter", folded: "bitterness", reason: "accepted_together" }, { stays: "bitter", folded: "price", reason: "accepted_together" }]);
  assert.deepEqual(result.catalog.find(item => item.topic_key === "bitter")!.source_topic_keys, ["bitter", "bitterness", "price"]);
  assert.deepEqual(result.catalog.find(item => item.topic_key === "bitter")!.localization, catalog[0]!.localization, "the wording of the largest topic is the one that stays");
});

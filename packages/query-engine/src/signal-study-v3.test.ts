import test from "node:test";
import assert from "node:assert/strict";
import { compileSignalStudyAxesV1, resolveSignalStudyAxesV1, signalStudyInMotivePoolV1, SIGNAL_STUDY_TB_TEMPLATE_V2 as second, signalStudyDirectionProbabilitySqlV1, SIGNAL_STUDY_TB_TEMPLATE_V3 as template, SIGNAL_STUDY_TB_TEMPLATE_V3_2 as current, SIGNAL_STUDY_TB_TEMPLATE_V3_3 as latest, SIGNAL_STUDY_TB_TEMPLATE_V3_4 as inUse, SIGNAL_STUDY_TB_TEMPLATE_V3_5 as final, signalStudyRulesWithLinesV1, validateSignalStudyDirectionLinesV1, signalStudyDirectionLineV1, decideSignalStudyMotiveLayersV1,
  type SignalStudySubjectV1 } from "./signal-study-v1";

const subject: SignalStudySubjectV1 = { kind: "category", name: "sparkling water", category: "sparkling water", own_brand: "Brand One", competitors: ["Brand Two"], alternatives: [] };

test("the third template asks again only for the direction", () => {
  const before = compileSignalStudyAxesV1(second, subject), now = compileSignalStudyAxesV1(template, subject);
  assert.notEqual(now.direction.question_digest, before.direction.question_digest, "the direction is asked again");
  assert.equal(now.use.question_digest, before.use.question_digest, "use is reused");
  assert.equal(now.target.question_digest, before.target.question_digest, "and so is the target");
  const { direction_share_max: guard, group_uses: uses, ...rules } = template.rules;
  assert.deepEqual(rules, second.rules, "the line, the layer reading and the rest are those of the second template");
  assert.equal(guard, 0.5);
  assert.deepEqual(uses, ["literal", "other"]);
  assert.equal(template.instructions, second.instructions);
  assert.equal(template.version, "r16b-v3.1");
});

test("a post with a counted direction counts toward the subject unless its use is figurative or ironic", () => {
  const answers = { direction: "trigger", target: "category", direction_probability: 0.9 };
  const by = (use: string, rules = template.rules) => resolveSignalStudyAxesV1(subject, { ...answers, use }, rules);
  assert.deepEqual(["literal", "other", "figurative_or_ironic"].map(use => by(use).aggregate), ["subject", "subject", "figurative_or_ironic"]);
  assert.deepEqual(["literal", "other", "figurative_or_ironic"].map(use => signalStudyInMotivePoolV1(template, by(use))), [true, true, false]);
  // The second template keeps its rule: only literal use.
  assert.deepEqual(["literal", "other"].map(use => by(use, second.rules).aggregate), ["subject", "other"]);
  assert.deepEqual(["literal", "other"].map(use => signalStudyInMotivePoolV1(second, by(use, second.rules))), [true, false]);
  // Below the line there is no direction, whatever the use.
  assert.equal(signalStudyInMotivePoolV1(template, resolveSignalStudyAxesV1(subject, { ...answers, use: "other", direction_probability: 0.7 }, template.rules)), false);
});

test("direction is aimed at the subject first, and an emotion about it counts with a literal fragment", () => {
  const axis = template.axes.find(item => item.role === "direction")!, option = (key: string) => axis.options.find(item => item.key === key)!.definition;
  assert.deepEqual(axis.options.map(item => item.key), ["trigger", "barrier", "mixed", "none"]);
  assert.match(axis.text, /^Answer in two steps/u);
  assert.match(axis.text, /aimed at the target itself/u);
  assert.match(axis.text, /literal fragment/u);
  for (const word of ["enjoyment", "pride", "hope", "euphoria", "relief", "eagerness"]) assert.match(option("trigger"), new RegExp(word, "u"));
  for (const word of ["anger", "frustration", "suffering", "fear", "guilt", "rejection", "cost"]) assert.match(option("barrier"), new RegExp(word, "u"));
  assert.match(option("mixed"), /only one of the two has its fragment/u, "one fragment alone is that fragment's direction");
  // What the second template kept out stays out.
  for (const kept of ["news, announcements, results or schedules", "marketing, promotion or an offer", "a joke or a passing mention"]) assert.ok(option("none").includes(kept));
});

test("the template in use counts a direction from 0.70 and lets the band below it only discover motives", () => {
  assert.equal(current.version, "r16b-v3.2");
  const { direction_min_probability: line, direction_discovery_min_probability: discovery, ...rules } = current.rules;
  const { direction_min_probability: _line, ...earlier } = template.rules;
  assert.deepEqual([line, discovery], [0.7, 0.5]);
  assert.deepEqual(rules, earlier, "everything else is the third template's");
  const before = compileSignalStudyAxesV1(template, subject), now = compileSignalStudyAxesV1(current, subject);
  assert.notEqual(now.direction.question_digest, before.direction.question_digest, "the direction is worded again");
  assert.deepEqual([now.use.question_digest, now.target.question_digest], [before.use.question_digest, before.target.question_digest]);
  const axis = current.axes.find(item => item.role === "direction")!;
  assert.match(axis.text, /^Does the speaker express a force of their own aimed at the target/u);
  assert.match(axis.text, /The target includes what living it consists of/u);
  assert.doesNotMatch(axis.text, /default|only when|Without such/u, "no restriction in the wording: each one lowers the classifier's confidence");
  const by = (direction_probability: number, use = "other") => resolveSignalStudyAxesV1(subject, { direction: "barrier", target: "category", use, direction_probability }, current.rules);
  // Counted from the line; grouped but not counted in the band below it; out under the band.
  assert.deepEqual([0.9, 0.7, 0.69, 0.5, 0.49].map(probability => by(probability).direction), ["barrier", "barrier", "none", "none", "none"]);
  assert.deepEqual([0.9, 0.7, 0.69, 0.5, 0.49].map(probability => by(probability).discovery), [false, false, true, true, false]);
  assert.deepEqual([0.9, 0.7, 0.69, 0.5, 0.49].map(probability => signalStudyInMotivePoolV1(current, by(probability))), [true, true, true, true, false]);
  assert.equal(signalStudyInMotivePoolV1(current, by(0.6, "figurative_or_ironic")), false, "figurative or ironic use stays out of discovery too");
  // An earlier template has no such band.
  assert.equal(resolveSignalStudyAxesV1(subject, { direction: "barrier", target: "category", use: "literal", direction_probability: 0.6 }, template.rules).discovery, false);
});

test("the lines of the direction are read on the probability of the option chosen, the figure they were measured on", () => {
  assert.equal(latest.version, "r16b-v3.3");
  const { direction_probability_of: figure, ...rules } = latest.rules;
  assert.equal(figure, "chosen_option");
  assert.deepEqual(rules, current.rules, "nothing else changes");
  assert.deepEqual(compileSignalStudyAxesV1(latest, subject), compileSignalStudyAxesV1(current, subject), "the questions are the same: nothing is asked again");
  assert.equal(signalStudyDirectionProbabilitySqlV1(latest.rules), "(direction.probabilities->>direction.choice)::real");
  // Earlier templates keep the confidence the classifier reports, which runs lower.
  for (const earlier of [second, template, current]) assert.equal(signalStudyDirectionProbabilitySqlV1(earlier.rules), "direction.probability");
});

test("barrier and mixed count from their own line, and a motive without a layer gets a third reading", () => {
  assert.equal(inUse.version, "r16b-v3.4");
  const { direction_min_probability_by: lines, layer_tiebreak_reading: third, ...rules } = inUse.rules;
  assert.deepEqual([lines, third], [{ barrier: 0.85, mixed: 0.85 }, true]);
  assert.deepEqual(rules, latest.rules, "nothing else changes");
  assert.deepEqual(compileSignalStudyAxesV1(inUse, subject), compileSignalStudyAxesV1(latest, subject), "the questions are the same: nothing is asked again");
  assert.deepEqual(["trigger", "barrier", "mixed"].map(direction => signalStudyDirectionLineV1(inUse.rules, direction)), [0.7, 0.85, 0.85]);
  const by = (direction: string, direction_probability: number) => resolveSignalStudyAxesV1(subject, { direction, target: "category", use: "literal", direction_probability }, inUse.rules);
  assert.deepEqual([by("trigger", 0.75).direction, by("barrier", 0.75).direction, by("barrier", 0.85).direction, by("mixed", 0.8).direction, by("mixed", 0.9).direction],
    ["trigger", "none", "barrier", "none", "mixed"]);
  // Below its line a barrier is kept as probable and still helps to discover motives.
  assert.deepEqual([by("barrier", 0.75).direction_probable, by("barrier", 0.75).discovery, signalStudyInMotivePoolV1(inUse, by("barrier", 0.75))], ["barrier", true, true]);
  // Two readings that split leave no layer; a third one settles it.
  const posts = ["p1", "p2", "p3", "p4"].map(id => ({ id, motive_key: "price", text: "text" }));
  const reading = (layers: string[]) => new Map(posts.map((post, index) => [post.id, { layer: layers[index]! as "social", proof: "text", downgraded: null }]));
  const first = reading(["social", "social", "personal", "personal"]), second = reading(["social", "personal", "personal", "social"]);
  assert.equal(decideSignalStudyMotiveLayersV1({ template: inUse, posts, readings: [first, second] })[0]!.layer, "unclear");
  assert.equal(decideSignalStudyMotiveLayersV1({ template: inUse, posts, readings: [first, second, reading(["social", "social", "social", "social"])] })[0]!.layer, "social");
});

test("the template counts barrier from its common line, and a study raises a line only with blind evidence", () => {
  assert.equal(final.version, "r16b-v3.5");
  const { direction_min_probability_by: lines, layer_tiebreak_margin: lead, ...rules } = final.rules;
  const { direction_min_probability_by: _lines, ...earlier } = inUse.rules;
  assert.deepEqual([lines, lead], [{ mixed: 0.85 }, 0.1]);
  assert.deepEqual(rules, earlier);
  assert.deepEqual(compileSignalStudyAxesV1(final, subject), compileSignalStudyAxesV1(inUse, subject), "nothing is asked again");
  assert.deepEqual(["trigger", "barrier", "mixed"].map(direction => signalStudyDirectionLineV1(final.rules, direction)), [0.7, 0.7, 0.85]);
  const evidence = { line: 0.85, precision_at_template_line: 0.73, blind_package_sha256: "a".repeat(64) };
  const raised = signalStudyRulesWithLinesV1(final.rules, validateSignalStudyDirectionLinesV1({ barrier: evidence }, final.rules));
  assert.deepEqual(["trigger", "barrier", "mixed"].map(direction => signalStudyDirectionLineV1(raised, direction)), [0.7, 0.85, 0.85]);
  assert.equal(signalStudyRulesWithLinesV1(final.rules, null), final.rules);
  const barrier = (rules: typeof final.rules) => resolveSignalStudyAxesV1(subject, { direction: "barrier", target: "category", use: "literal", direction_probability: 0.75 }, rules).direction;
  assert.deepEqual([barrier(final.rules), barrier(raised)], ["barrier", "none"]);
  // No raising without the evidence, where blind judges already found the direction right, or to lower a line.
  for (const wrong of [{ barrier: { ...evidence, blind_package_sha256: "abc" } }, { barrier: { ...evidence, precision_at_template_line: 0.9 } }, { barrier: { ...evidence, line: 0.6 } },
    { mixed: { ...evidence, line: 0.85 } }, { none: evidence }, { barrier: { line: 0.85 } }, "barrier"]) {
    assert.throws(() => validateSignalStudyDirectionLinesV1(wrong, final.rules), /study_direction_lines_invalid/u);
  }
});

test("with the third reading the layer with the most votes wins when it leads by ten points of the votes", () => {
  const posts = ["p1", "p2", "p3", "p4", "p5"].map(id => ({ id, motive_key: "price", text: "text" }));
  const reading = (layers: string[]) => new Map(posts.map((post, index) => [post.id, { layer: layers[index]! as "social", proof: "text", downgraded: null }]));
  const first = reading(["social", "social", "personal", "personal", "psychological"]), second = reading(["social", "personal", "personal", "social", "psychological"]);
  const third = reading(["social", "social", "personal", "psychological", "psychological"]);
  // 15 votes: social 6, personal 5, psychological 4. No layer reaches six in ten, and a lead of one vote is under ten points.
  assert.equal(decideSignalStudyMotiveLayersV1({ template: final, posts, readings: [first, second, third] })[0]!.layer, "unclear");
  assert.equal(decideSignalStudyMotiveLayersV1({ template: final, posts, readings: [first, second, third], lead: final.rules.layer_tiebreak_margin })[0]!.layer, "unclear");
  // social 8, personal 4, psychological 3: under six in ten, but a lead of four votes in fifteen settles it.
  const clearer = reading(["social", "social", "social", "social", "psychological"]);
  assert.equal(decideSignalStudyMotiveLayersV1({ template: final, posts, readings: [first, second, clearer] })[0]!.layer, "unclear");
  assert.equal(decideSignalStudyMotiveLayersV1({ template: final, posts, readings: [first, second, clearer], lead: final.rules.layer_tiebreak_margin })[0]!.layer, "social");
});

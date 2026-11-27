import test from "node:test";
import assert from "node:assert/strict";
import { compileSignalStudyAxesV1, resolveSignalStudyAxesV1, signalStudyInMotivePoolV1, SIGNAL_STUDY_TB_TEMPLATE_V2 as second, SIGNAL_STUDY_TB_TEMPLATE_V3 as template,
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

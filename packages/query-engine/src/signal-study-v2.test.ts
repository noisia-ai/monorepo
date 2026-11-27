import test from "node:test";
import assert from "node:assert/strict";
import { applySignalStudyMentionLayersV1, buildSignalStudyMentionLayersPayloadV1, compileSignalStudyAxesV1, decideSignalStudyMotiveLayersV1, resolveSignalStudyAxesV1,
  signalStudyMentionKappaV1, SIGNAL_STUDY_TB_TEMPLATE_V1 as first, SIGNAL_STUDY_TB_TEMPLATE_V2 as template, validateSignalStudyLexiconV1,
  type SignalStudyLayerPostV1, type SignalStudyPostLayerV1, type SignalStudySubjectV1 } from "./signal-study-v1";

const subject: SignalStudySubjectV1 = { kind: "category", name: "sparkling water", category: "sparkling water", own_brand: "Brand One", competitors: ["Brand Two"], alternatives: [] };
const post = (id: string, motive_key: string, text: string): SignalStudyLayerPostV1 => ({ id, motive_key, text });
const coded = (layer: string, proof = "", normative_proof = "") => ({ layer, proof, normative_proof });

test("the second template asks for the speaker's own force, and a new wording is a new question", () => {
  const before = compileSignalStudyAxesV1(first, subject), now = compileSignalStudyAxesV1(template, subject);
  assert.notEqual(now.direction.question_digest, before.direction.question_digest, "the direction is asked again");
  assert.equal(now.use.question_digest, before.use.question_digest, "use did not change: its answers are reused");
  assert.equal(now.target.question_digest, before.target.question_digest, "nor did the target for the same subject");
  assert.notEqual(compileSignalStudyAxesV1(template, { ...subject, own_brand: "Another Brand" }).target.question_digest, now.target.question_digest,
    "another own brand is another target question");
  assert.equal(compileSignalStudyAxesV1(template, { ...subject, own_brand: "Another Brand" }).direction.question_digest, now.direction.question_digest,
    "and the direction does not depend on the brand");
  const none = template.axes.find(axis => axis.role === "direction")!.options.find(item => item.key === "none")!;
  assert.match(none.definition, /default/iu);
  assert.deepEqual([template.rules.direction_min_probability, template.rules.motive_approval_min, template.rules.layer_mentions_per_motive, template.rules.layer_majority_min], [0.85, 0.85, 20, 0.6]);
});

test("a direction below the line is kept as probable and read as none", () => {
  const answers = { direction: "trigger", target: "category", use: "literal" };
  const weak = resolveSignalStudyAxesV1(subject, { ...answers, direction_probability: 0.7 }, template.rules);
  assert.deepEqual([weak.direction, weak.direction_probable, weak.source_direction], ["none", "trigger", "trigger"]);
  const sure = resolveSignalStudyAxesV1(subject, { ...answers, direction_probability: 0.9 }, template.rules);
  assert.deepEqual([sure.direction, sure.direction_probable, sure.aggregate], ["trigger", null, "subject"]);
  assert.equal(resolveSignalStudyAxesV1(subject, { ...answers, direction: "none", direction_probability: 0.4 }, template.rules).direction_probable, null, "none needs no line");
  // The first template has no line: every answer counts as it did.
  assert.equal(resolveSignalStudyAxesV1(subject, { ...answers, direction_probability: 0.5 }, first.rules).direction, "trigger");
  assert.equal(resolveSignalStudyAxesV1(subject, answers).direction, "trigger");
});

test("the layer of a post needs a literal fragment of that post; cultural also needs a norm in it", () => {
  const posts = [post("p1", "price", "it is too expensive for me this month"), post("p2", "price", "nobody at home drinks it anymore"),
    post("p3", "norm", "a real party here must have it, that is how it has always been"), post("p4", "norm", "we always buy it for the party"), post("p5", "norm", "whatever")];
  const read = applySignalStudyMentionLayersV1({ posts, output: { posts: [
    { id: "p1", ...coded("personal", "too expensive for me") },
    { id: "p2", ...coded("social", "a fragment from another post: too expensive for me") },
    { id: "p3", ...coded("cultural", "a real party here must have it", "that is how it has always been") },
    { id: "p4", ...coded("cultural", "we always buy it") },
    { id: "ghost", ...coded("personal", "x") }] } });
  assert.deepEqual([...read].map(([id, item]) => [id, item.layer, item.downgraded]), [["p1", "personal", null], ["p2", "unclear", "no_literal_proof"],
    ["p3", "cultural", null], ["p4", "unclear", "no_normative_proof"], ["p5", "unclear", "not_answered"]]);
  assert.throws(() => applySignalStudyMentionLayersV1({ posts, output: { posts: [{ id: "p1", ...coded("economic") }] } }), /study_layers_output_invalid/u);
  // The two readings see the same posts in a different order, and the payload carries the motive of each.
  const payload = (order: string) => JSON.parse(buildSignalStudyMentionLayersPayloadV1({ template, subject, posts, order,
    motives: [{ motive_key: "price", name: "Price", definition: "It costs too much." }, { motive_key: "norm", name: "Norm", definition: "It is what one does." }] }));
  assert.notDeepEqual(payload("layers_a").posts.map((item: { id: string }) => item.id), payload("layers_b").posts.map((item: { id: string }) => item.id));
  assert.deepEqual(payload("layers_a").posts.map((item: { id: string }) => item.id).sort(), ["p1", "p2", "p3", "p4", "p5"]);
  assert.equal(payload("layers_a").posts.find((item: { id: string }) => item.id === "p1").motive, "price");
});

test("a motive takes the layer most readings of its posts show, or stays unclear", () => {
  const posts = Array.from({ length: 10 }, (_item, index) => post(`a${index}`, "social_one", "text")).concat(Array.from({ length: 10 }, (_item, index) => post(`b${index}`, "split_one", "text")),
    Array.from({ length: 4 }, (_item, index) => post(`c${index}`, "empty_one", "text")));
  const reading = (layers: (id: string) => string) => new Map<string, SignalStudyPostLayerV1>(posts.map(item => [item.id, { layer: layers(item.id) as SignalStudyPostLayerV1["layer"],
    proof: layers(item.id) === "unclear" ? null : `proof ${item.id}`, downgraded: null }]));
  const one = reading(id => id.startsWith("a") ? (Number(id.slice(1)) < 8 ? "social" : "personal") : id.startsWith("b") ? (Number(id.slice(1)) < 5 ? "social" : "personal") : "unclear");
  const two = reading(id => id.startsWith("a") ? (Number(id.slice(1)) < 7 ? "social" : "unclear") : id.startsWith("b") ? (Number(id.slice(1)) < 5 ? "personal" : "social") : "unclear");
  const decided = new Map(decideSignalStudyMotiveLayersV1({ template, posts, readings: [one, two] }).map(item => [item.motive_key, item]));
  assert.deepEqual([decided.get("social_one")!.layer, decided.get("social_one")!.share, decided.get("social_one")!.permission, decided.get("social_one")!.posts], ["social", 0.75, "partial", 10]);
  assert.deepEqual(decided.get("social_one")!.votes, { social: 15, personal: 2, unclear: 3 });
  assert.equal(decided.get("social_one")!.proofs.length, 3, "a few literal fragments of the winning layer travel with it");
  assert.deepEqual([decided.get("split_one")!.layer, decided.get("split_one")!.share, decided.get("split_one")!.permission], ["unclear", 0.5, "no_permission"], "half and half is not a layer");
  assert.deepEqual([decided.get("empty_one")!.layer, decided.get("empty_one")!.share], ["unclear", 1]);
  const agreement = signalStudyMentionKappaV1(one, two);
  assert.equal(agreement.n, 24);
  assert.ok(agreement.agreement! > 0.4 && agreement.agreement! < 0.6, `agreement ${agreement.agreement}`);
  assert.ok(agreement.kappa! > 0 && agreement.kappa! < 0.5, `kappa ${agreement.kappa}`);
  assert.deepEqual(signalStudyMentionKappaV1(one, one), { kappa: 1, agreement: 1, n: 24 });
  assert.deepEqual(signalStudyMentionKappaV1(one, new Map()), { kappa: null, agreement: null, n: 0 });
});

test("a study's own lexicon is cleaned and bounded", () => {
  assert.deepEqual(validateSignalStudyLexiconV1([" Futebol ", "futebol", "copa   libertadores", "gol"]), ["copa libertadores", "futebol", "gol"]);
  assert.throws(() => validateSignalStudyLexiconV1([]), /study_lexicon_invalid/u);
  assert.throws(() => validateSignalStudyLexiconV1(["a"]), /study_lexicon_invalid/u);
  assert.throws(() => validateSignalStudyLexiconV1("futebol"), /study_lexicon_invalid/u);
});

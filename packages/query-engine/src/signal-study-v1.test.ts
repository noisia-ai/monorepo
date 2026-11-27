import test from "node:test";
import assert from "node:assert/strict";
import { applySignalStudyBoundaryV1, applySignalStudyContrastV1, applySignalStudyLayersV1, applySignalStudyMotivesV1, compileSignalStudyAxesV1, cutSignalStudyTextV1,
  interpolateSignalStudyTextV1, pickSignalStudyVerbatimV1, redactSignalStudyTextV1, resolveSignalStudyAxesV1, sampleSignalStudyGroupV1,
  signalStudyDominanceV1, signalStudyInMotivePoolV1, signalStudyLayerKappaV1, signalStudyMotiveQuestionV1, signalStudyPermissionForLayerV1,
  SIGNAL_STUDY_TB_TEMPLATE_V1 as template, validateSignalStudySubjectV1, validateSignalStudyTemplateV1, verifySignalStudyVerbatimV1,
  type SignalStudyGroupV1, type SignalStudyLayerCodingV1, type SignalStudyMotiveSampleV1, type SignalStudySubjectV1 } from "./signal-study-v1";

const subject: SignalStudySubjectV1 = { kind: "category", name: "sparkling water", category: "sparkling water", own_brand: "Brand One",
  competitors: ["Brand Two"], alternatives: ["soda"] };
const wording = (name: string) => ({ name, definition: `${name}: what it is and what it is not.` });
const named = (key: string, group_keys: string[]) => ({ key, group_keys, original_language: "pt-BR", original: wording(`${key} pt`), en: wording(`${key} en`), es: wording(`${key} es`) });
const group = (group_key: string): SignalStudyGroupV1 => ({ group_key, roots: 120, directions: { trigger: 80, barrier: 40 }, sample: [] });
const sample = (motive_key: string, texts: string[]): SignalStudyMotiveSampleV1 => ({ motive_key, name: motive_key, definition: `About ${motive_key}.`,
  sample: texts.map((text, index) => ({ root_id: `${motive_key}-${index}`, text, source: "random" as const })) });
const coded = (motive_key: string, layer: string, extra: Record<string, unknown> = {}) => ({ motive_key, layer, diagnostics: [], proof: "", normative_proof: "",
  permission_override: "", permission_override_reason: "", parts: [], ...extra });

test("the template is valid and its questions carry the exact subject", () => {
  assert.equal(template.rules.output_status, "directional");
  assert.throws(() => validateSignalStudyTemplateV1({ ...template, axes: template.axes.slice(0, 2) }), /study_template_invalid/u);
  const axes = compileSignalStudyAxesV1(template, subject);
  assert.deepEqual(Object.keys(axes).sort(), ["direction", "target", "use"]);
  for (const question of Object.values(axes)) {
    assert.equal(question.kind, "choice");
    assert.match(question.question_digest, /^sha256:[0-9a-f]{64}$/u);
    assert.ok(!JSON.stringify(question.wire).includes("{{"), "no placeholder reaches the classifier");
  }
  assert.ok(JSON.stringify(axes.direction.wire).includes("sparkling water"));
  // Another subject is another question, so its answers are never reused.
  const other = compileSignalStudyAxesV1(template, { ...subject, name: "still water" });
  assert.notEqual(other.direction.question_digest, axes.direction.question_digest);
  assert.equal(compileSignalStudyAxesV1(template, { ...subject }).direction.question_digest, axes.direction.question_digest);
  const motive = signalStudyMotiveQuestionV1(template, subject, { key: "price", name: "Price", definition: "It costs too much." });
  assert.equal(motive.kind, "noul");
  assert.equal(motive.request_key, "motive_price");
});

test("a subject is validated and unknown template variables are refused", () => {
  assert.throws(() => validateSignalStudySubjectV1({ ...subject, kind: "alternative" }), /study_subject_invalid/u);
  assert.equal(validateSignalStudySubjectV1({ ...subject, kind: "alternative", conventional_category: "soft drinks" }).kind, "alternative");
  assert.throws(() => validateSignalStudySubjectV1({ ...subject, extra: true }), /study_subject_invalid/u);
  assert.equal(interpolateSignalStudyTextV1("{{subject}} vs {{competitors}}", subject), "sparkling water vs Brand Two");
  assert.throws(() => interpolateSignalStudyTextV1("{{secret}}", subject), /study_template_variable_invalid/u);
});

test("axes decide where a root counts, and an alternative subject inverts a rejection of the category", () => {
  const literal = resolveSignalStudyAxesV1(subject, { direction: "barrier", target: "category", use: "literal" });
  assert.deepEqual([literal.direction, literal.aggregate, literal.alternative_inverted], ["barrier", "subject", false]);
  assert.equal(signalStudyInMotivePoolV1(template, literal), true);
  const competitor = resolveSignalStudyAxesV1(subject, { direction: "trigger", target: "competitor_brand", use: "literal" });
  assert.equal(competitor.aggregate, "competitor");
  assert.equal(signalStudyInMotivePoolV1(template, competitor), false);
  const ironic = resolveSignalStudyAxesV1(subject, { direction: "trigger", target: "category", use: "figurative_or_ironic" });
  assert.equal(ironic.aggregate, "figurative_or_ironic");
  assert.equal(signalStudyInMotivePoolV1(template, ironic), false);
  assert.equal(signalStudyInMotivePoolV1(template, resolveSignalStudyAxesV1(subject, { direction: "none", target: "category", use: "literal" })), false);
  const alternative = { ...subject, kind: "alternative" as const, conventional_category: "soft drinks" };
  const inverted = resolveSignalStudyAxesV1(alternative, { direction: "barrier", target: "category", use: "literal" });
  assert.deepEqual([inverted.source_direction, inverted.direction, inverted.alternative_inverted], ["barrier", "trigger", true]);
});

test("the two blind passes read different examples of a large group, and the farthest members are shown", () => {
  const members = Array.from({ length: 200 }, (_item, index) => ({ root_id: `r${String(index).padStart(3, "0")}`, text: `text ${index} `.repeat(60), similarity: index / 200 }));
  const a = sampleSignalStudyGroupV1({ group_key: "g1", members, random: 35, far: 5, pass: "a", excerpt_chars: 280 });
  const b = sampleSignalStudyGroupV1({ group_key: "g1", members, random: 35, far: 5, pass: "b", excerpt_chars: 280 });
  assert.equal(a.length, 40);
  assert.equal(b.length, 40);
  assert.deepEqual(a.filter(row => row.source === "far").map(row => row.root_id), ["r000", "r001", "r002", "r003", "r004"]);
  assert.equal(a.filter(row => b.some(other => other.root_id === row.root_id)).length, 0, "no example is shared");
  assert.ok(a.every(row => row.text.length <= 280));
  assert.deepEqual(sampleSignalStudyGroupV1({ group_key: "g1", members, random: 35, far: 5, pass: "a", excerpt_chars: 280 }), a, "the sample is repeatable");
  // A small group cannot give two disjoint samples: both passes read the same.
  const small = members.slice(0, 30);
  assert.deepEqual(sampleSignalStudyGroupV1({ group_key: "g2", members: small, random: 35, far: 5, pass: "b", excerpt_chars: 280 }),
    sampleSignalStudyGroupV1({ group_key: "g2", members: small, random: 35, far: 5, pass: "a", excerpt_chars: 280 }));
});

test("every group ends in one motive, is set aside, or is reported as forgotten", () => {
  const result = applySignalStudyMotivesV1({ groups: ["g1", "g2", "g3", "g4", "g5"].map(group), output: { motives: [
    named("price", ["g1", "g2", "ghost"]), named("taste", ["g2", "g3"]), named("Bad Key", ["g4"]), named("price", ["g4"]), named("empty", []),
    { ...named("blank", ["g4"]), es: { name: " ", definition: "x" } }], insufficient_groups: ["g1", "g5", "ghost"] } });
  assert.deepEqual(result.motives.map(motive => [motive.motive_key, motive.group_keys]), [["price", ["g1", "g2"]], ["taste", ["g3"]]]);
  assert.deepEqual(result.insufficient_groups, ["g5"], "a group already used is not also set aside");
  assert.deepEqual(result.uncovered_groups, ["g4"]);
  assert.deepEqual(result.rejected.map(item => item.reason), ["key_invalid", "key_taken", "no_groups", "wording_incomplete"]);
  assert.throws(() => applySignalStudyMotivesV1({ groups: [group("g1")], output: { motives: "no" } }), /study_motives_output_invalid/u);
});

test("a layer needs a literal fragment of the motive's own examples; cultural also needs a normative one", () => {
  const motives = [sample("price", ["it is too expensive for me this month", "nobody at home drinks it"]), sample("norm", ["in this town a party without it is not a party"]),
    sample("split", ["too expensive and my friends laugh at me"]), sample("silent", ["whatever"])];
  const part = (name: string, layer: string, proof: string) => ({ original_language: "pt-BR", original: wording(`${name} pt`), en: wording(`${name} en`), es: wording(`${name} es`), layer, proof, normative_proof: "" });
  const result = applySignalStudyLayersV1({ template, motives, output: { motives: [
    coded("price", "personal", { proof: "too expensive for me", permission_override: "partial", permission_override_reason: "Depends on promotions." }),
    coded("norm", "cultural", { proof: "a party without it is not a party" }),
    coded("split", "social", { proof: "a quote that is not in the examples", permission_override: "movable", permission_override_reason: "x",
      parts: [part("money", "personal", "too expensive"), part("friends", "social", "my friends laugh at me"), { ...part("bad", "social", "my friends"), es: { name: "", definition: "" } }] }),
  ] } });
  const by = new Map(result.map(item => [item.motive_key, item]));
  assert.deepEqual([by.get("price")!.layer, by.get("price")!.permission, by.get("price")!.permission_override?.reason], ["personal", "partial", "Depends on promotions."]);
  assert.deepEqual([by.get("norm")!.layer, by.get("norm")!.downgraded, by.get("norm")!.permission], ["unclear", "no_normative_proof", "no_permission"]);
  assert.deepEqual([by.get("split")!.layer, by.get("split")!.downgraded, by.get("split")!.permission, by.get("split")!.permission_override],
    ["unclear", "no_literal_proof", "no_permission", null], "an override never rescues an unclear layer");
  assert.deepEqual(by.get("split")!.parts.map(item => item.layer), ["personal", "social"]);
  assert.deepEqual([by.get("silent")!.layer, by.get("silent")!.downgraded], ["unclear", "not_answered"]);
  // With the normative fragment the cultural layer stands, and its permission follows the rule.
  const cultural = applySignalStudyLayersV1({ template, motives: [motives[1]!], output: { motives: [
    coded("norm", "cultural", { proof: "a party without it", normative_proof: "is not a party" })] } })[0]!;
  assert.deepEqual([cultural.layer, cultural.permission], ["cultural", "structural_align_or_exit"]);
  assert.equal(signalStudyPermissionForLayerV1(template, "social"), "partial");
  // Only one usable part: the motive is not split.
  const single = applySignalStudyLayersV1({ template, motives: [motives[2]!], output: { motives: [
    coded("split", "personal", { proof: "too expensive", parts: [part("money", "personal", "too expensive")] })] } })[0]!;
  assert.deepEqual(single.parts, []);
  assert.throws(() => applySignalStudyLayersV1({ template, motives, output: { motives: [coded("price", "economic")] } }), /study_layers_output_invalid/u);
});

test("agreement between the two passes is measured with kappa", () => {
  const pass = (layers: Record<string, string>) => Object.entries(layers).map(([motive_key, layer]) => ({ motive_key, layer }) as SignalStudyLayerCodingV1);
  const first = pass({ a: "personal", b: "social", c: "cultural", d: "psychological" });
  assert.deepEqual(signalStudyLayerKappaV1(first, first), { kappa: 1, agreement: 1, disagreements: [] });
  const second = signalStudyLayerKappaV1(first, pass({ a: "personal", b: "social", c: "social", d: "psychological" }));
  assert.equal(second.agreement, 0.75);
  assert.ok(second.kappa! > 0.6 && second.kappa! < 0.7, `kappa ${second.kappa}`);
  assert.deepEqual(second.disagreements, ["c"]);
  assert.deepEqual(signalStudyLayerKappaV1(pass({ a: "personal", b: "personal" }), pass({ a: "personal", b: "personal" })).kappa, 1, "one layer only still agrees");
  assert.deepEqual(signalStudyLayerKappaV1(first, []), { kappa: null, agreement: null, disagreements: [] });
});

test("boundary rules and contrast rewrites only touch the motives that were asked", () => {
  const rules = applySignalStudyBoundaryV1({ rules: [{ motive_key: "a", decision_rule: "  Social when   others are named. " }, { motive_key: "z", decision_rule: "x" },
    { motive_key: "b", decision_rule: " " }] }, ["a", "b"]);
  assert.deepEqual([...rules], [["a", "Social when others are named."]]);
  const rewritten = applySignalStudyContrastV1({ motives: [named("a", []), named("z", []), { ...named("b", []), en: { name: "", definition: "" } }] }, ["a", "b"]);
  assert.deepEqual([...rewritten.keys()], ["a"]);
  assert.throws(() => applySignalStudyBoundaryV1({ rules: 1 }, []), /study_boundary_output_invalid/u);
  assert.throws(() => applySignalStudyContrastV1({}, []), /study_contrast_output_invalid/u);
});

test("a motive or a layer that covers too much of the cut is sent to be rewritten", () => {
  const result = signalStudyDominanceV1({ template, directed_roots: 1000, motives: [
    { motive_key: "big", layer: "personal", roots: 600 }, { motive_key: "s1", layer: "social", roots: 200 }, { motive_key: "s2", layer: "social", roots: 180 },
    { motive_key: "s3", layer: "social", roots: 150 }, { motive_key: "s4", layer: "social", roots: 20 }, { motive_key: "p", layer: "psychological", roots: 100 }] });
  assert.deepEqual(result.dominant_motives, ["big"]);
  assert.deepEqual(result.dominant_layers, ["personal", "social"]);
  assert.deepEqual(result.rewrite, ["big", "s1", "s2", "s3"]);
  assert.deepEqual(signalStudyDominanceV1({ template, directed_roots: 1000, motives: [{ motive_key: "a", layer: "personal", roots: 500 }] }).rewrite, [], "exactly the limit is allowed");  // With distinct posts per layer, two motives that share their posts do not make the layer dominant.
  const shared = signalStudyDominanceV1({ template, directed_roots: 1000, layer_roots: { social: 320 },
    motives: [{ motive_key: "s1", layer: "social", roots: 300 }, { motive_key: "s2", layer: "social", roots: 290 }] });
  assert.deepEqual([shared.dominant_layers, shared.rewrite], [[], []]);
});

test("a cut never leaves half of a character, so an excerpt can always be stored", () => {
  const text = `${"a".repeat(279)}🍺 depois`;
  assert.equal(cutSignalStudyTextV1(text, 280), "a".repeat(279));
  assert.equal(cutSignalStudyTextV1(text, 281), `${"a".repeat(279)}🍺`);
  assert.equal(cutSignalStudyTextV1("curto", 280), "curto");
  const sample = sampleSignalStudyGroupV1({ group_key: "g", members: [{ root_id: "r1", text, similarity: 1 }], random: 5, far: 0, pass: "a", excerpt_chars: 280 });
  assert.doesNotThrow(() => encodeURIComponent(sample[0]!.text), "no lone half remains");
});

test("what is shown is a literal piece of the post without user handles", () => {
  const source = "@maria.s olha isso: a cerveja sem álcool finalmente ficou boa de verdade https://example.com/x e o email a@b.com fica";
  const quote = pickSignalStudyVerbatimV1(source, 60)!;
  assert.ok(verifySignalStudyVerbatimV1(quote, source));
  assert.ok(!quote.includes("@maria") && !quote.includes("http"));
  assert.ok(quote.length <= 60 && quote.length >= 20);
  assert.equal(pickSignalStudyVerbatimV1("@a_b @c_d ok", 60), null, "nothing worth showing");
  assert.equal(redactSignalStudyTextV1("thanks @joao_1 and (@ana.b)! mail a@b.com"), "thanks @… and (@…)! mail a@b.com");
  assert.equal(verifySignalStudyVerbatimV1("not there", source), false);
  assert.equal(verifySignalStudyVerbatimV1("  ", source), false);
});

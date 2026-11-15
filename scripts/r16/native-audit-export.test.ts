import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { assertStudyListeningSourceBindingV1, nativeLayerAgreementReceiptV1, nativeNearestCandidateSetV1,
  reconstructNativeLayerStageV1, sourceStudyAxesForAuditV1 } from "./native-audit-export.js";
import type { SignalStudyLayerDecisionV1 } from "../../packages/query-engine/src/signal-study-editorial.js";
import { signalWorkspaceEmbeddingDigestV1 as digest } from "../../packages/query-engine/src/signal-workspace-embeddings-v1.js";

const id = (n: string) => `${n.repeat(8)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(12)}`;
const sha = (c: string) => `sha256:${c.repeat(64)}`;

test("Study source validation binds the frozen source objects without conflating snapshot and generation digests", () => {
  const generationDigest = sha("a"), sourceDigest = sha("b");
  assert.notEqual(generationDigest, sourceDigest);
  const args = {
    frozen: { kind: "human_edit", id: id("1"), base_snapshot_id: id("2"), configuration_id: id("3"),
      generation_id: id("4"), source_digest: sourceDigest },
    bound: { kind: "human_edit", id: id("1"), base_snapshot_id: id("2"), configuration_id: id("3"),
      generation_id: id("4"), source_digest: sourceDigest },
    expected_generation_id: id("4"), expected_configuration_id: id("3"),
  };
  assert.doesNotThrow(() => assertStudyListeningSourceBindingV1(args));
  assert.throws(() => assertStudyListeningSourceBindingV1({ ...args, frozen: { ...args.frozen, id: id("5") } }), /after_source_mismatch/u);
  assert.throws(() => assertStudyListeningSourceBindingV1({ ...args, frozen: { ...args.frozen, base_snapshot_id: id("5") } }), /after_source_mismatch/u);
  assert.throws(() => assertStudyListeningSourceBindingV1({ ...args, frozen: { ...args.frozen, configuration_id: id("5") } }), /after_source_mismatch/u);
  assert.throws(() => assertStudyListeningSourceBindingV1({ ...args, expected_generation_id: id("6") }), /after_source_mismatch/u);
  assert.throws(() => assertStudyListeningSourceBindingV1({ ...args, bound: { ...args.bound, source_digest: sha("c") } }), /after_source_mismatch/u);
  const historicalNullBinding = { ...args, bound: { ...args.bound, kind: null, id: null, generation_id: null, source_digest: null } };
  assert.doesNotThrow(() => assertStudyListeningSourceBindingV1(historicalNullBinding), "legacy null binding columns rely on the immutable frozen-source view");
  assert.throws(() => assertStudyListeningSourceBindingV1({ ...historicalNullBinding,
    frozen: { ...args.frozen, generation_id: id("9") } }), /after_source_mismatch/u, "a forged frozen tuple still fails despite null historical columns");
});

test("nearest JEV question keys remain an unordered candidate set with no inferred winner", () => {
  const motives = ["m_a", "m_b", "m_c", "m_d"].map(key => ({ key, name: `Name ${key}`, layer: "personal" }));
  const set = nativeNearestCandidateSetV1({ question_keys: ["m_d", "m_b", "m_c", "m_a"], motives,
    cohorts: new Map(motives.map((m, i) => [m.key, `C0${i + 1}`])),
    definitions: new Map(motives.map(m => [m.key, `Definition ${m.key}`])) });
  assert.deepEqual(set?.map(m => m.motive_key), ["m_a", "m_b", "m_c", "m_d"]);
  assert.equal(nativeNearestCandidateSetV1({ question_keys: ["m_a", "m_a", "m_c", "m_d"], motives,
    cohorts: new Map(), definitions: new Map() }), null);
});

test("audit direction uses the saved source axis rather than alternative inversion", () => {
  assert.deepEqual(sourceStudyAxesForAuditV1({ source_direction: "barrier", direction: "trigger", target: "category",
    use: "literal", alternative_inverted: true }), { direction: "barrier", target: "category", use: "literal", alternative_inverted: true });
});

test("κ receipt uses the native paired-pass helper and leaves missing recodes incomplete", () => {
  const decision = (pass: "a" | "b", layers: string[], split = false): SignalStudyLayerDecisionV1 => ({
    contract_version: "signal-study-layer-decision-v1", request_digest: sha(pass === "a" ? "a" : "b"),
    study_digest: sha("c"), pass, recode_attempt: 0,
    motives: layers.map((layer, index) => ({ motive_key: `motive_${index}`, partitions: split && index === 0
      ? [{ layer }, { layer }] : [{ layer }] } as unknown as SignalStudyLayerDecisionV1["motives"][number])),
  });
  const initial: [SignalStudyLayerDecisionV1, SignalStudyLayerDecisionV1] = [
    decision("a", ["personal", "social", "cultural", "psychological"]),
    decision("b", ["personal", "social", "cultural", "psychological"]),
  ];
  const complete = nativeLayerAgreementReceiptV1({ initial });
  assert.equal(complete?.kappa, 1);
  assert.equal(complete?.status, "acceptable");
  assert.equal(complete?.denominator, 4);
  assert.equal(complete?.pass_a_count, 4);
  assert.equal(complete?.pass_b_count, 4);
  assert.equal(complete?.pass_a_digest?.length, 64);
  const incomplete: [SignalStudyLayerDecisionV1, SignalStudyLayerDecisionV1] = [
    decision("a", ["personal", "social"], true), decision("b", ["personal", "social"]),
  ];
  assert.equal(nativeLayerAgreementReceiptV1({ initial: incomplete }), null,
    "a split boundary requests a native recode pair; no substitute κ is emitted");
  assert.equal(nativeLayerAgreementReceiptV1({ initial, expectedOutput: { kappa: 0 } }), null,
    "persisted output disagreement makes the reconstructed receipt incomplete");
});

test("committed layer step is reconstructed from its exact request/value and corrupted evidence stays unavailable", () => {
  const execution_id = id("4"), source_digest = sha("d"), text = "literal proof text";
  const axes = { direction: "mixed", source_direction: "mixed", target: "category", use: "literal", aggregate: "subject", alternative_inverted: false };
  const row = { root_id: id("5"), text, text_sha256: `sha256:${createHash("sha256").update(text).digest("hex")}`,
    source: "random", axes, evidence_publishable: true };
  const payload = { study_digest: sha("c"), diagnostics: [
    { key: "island", layer: "personal", question: "Question" },
    { key: "money_time", layer: "psychological", question: "Question" },
    { key: "nobody_knows", layer: "social", question: "Question" },
    { key: "without_network", layer: "cultural", question: "Question" },
  ], motives: [{ key: "motive_0", name: "Motive", definition: "Definition",
    sampling: { random: 1, far: 0, insufficient: true, independence: "small_group" }, sample: [row] }] };
  const input_digest = digest(payload), pass = "a" as const, stage = "layers:a:initial:0";
  const request_body = JSON.stringify({ messages: [{ content: JSON.stringify({ input_digest, untrusted_data: payload }) }] });
  const value = { content: [{ type: "text", text: JSON.stringify({ contract_version: "signal-study-layer-output-v1", input_digest,
    motives: [{ motive_key: "motive_0", partitions: [{ key: "motive_0", name: "Motive", definition: "Definition",
      sample_root_ids: [row.root_id], layer: "personal", diagnostics: ["island", "money_time", "nobody_knows", "without_network"].map((key, index) => ({
        key, result: index === 0 ? "yes" : "no", force_disappears_without: index === 0, reason: "reason" })),
      evidence: { root_id: row.root_id, quote: text, private_person_names: [] }, normative_evidence: null, permission_override: null }] }] }) }] };
  const request_sha256 = `sha256:${createHash("sha256").update(request_body).digest("hex")}`;
  const step = { step_key: digest({ execution_id, source_digest, stage, request_sha256 }), request_body, request_sha256,
    source_digest, mode: "layers", status: "committed", value, value_digest: digest(value) };
  const recovered = reconstructNativeLayerStageV1({ step, execution_id, execution_source_digest: source_digest });
  assert.equal(recovered?.pass, pass);
  assert.equal(recovered?.decision.motives[0]?.partitions[0]?.layer, "personal");
  assert.equal(reconstructNativeLayerStageV1({ step: { ...step, value_digest: sha("f") }, execution_id,
    execution_source_digest: source_digest }), null);
});

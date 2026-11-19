import assert from "node:assert/strict";
import test from "node:test";
import { assertStudyListeningSourceBindingV1, nativeNearestCandidateSetV1, nativeAxisCandidateFlagsV1,
  nativeLayerAgreementFromProofV1, nativeOfficialMotiveOrderV1, sourceStudyAxesForAuditV1, validateSupplementalReceiptFilesV1, frozenStudyAuthorRosterV1 } from "./native-audit-export.js";
import { signalStudyKnownAuthorPrivacyV1 } from "../../infrastructure/db/signal-study-author-privacy.js";

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

test("official motive order is stable by native mention count and key, independent of membership evidence", () => {
  const ordered = nativeOfficialMotiveOrderV1([
    { key: "m_b", name: "B", layer: "social", mentions: 8 },
    { key: "m_c", name: "C", layer: "personal", mentions: 8 },
    { key: "m_a", name: "A", layer: "cultural", mentions: 12 },
  ]);
  assert.deepEqual(ordered.map(item => item.key), ["m_a", "m_b", "m_c"]);
  assert.throws(() => nativeOfficialMotiveOrderV1([{ key: " ", name: "A", layer: "social", mentions: 2 }]),
    /summary_motive_invalid/u);
});

test("audit direction uses the saved source axis rather than alternative inversion", () => {
  assert.deepEqual(sourceStudyAxesForAuditV1({ source_direction: "barrier", direction: "trigger", target: "category",
    use: "literal", alternative_inverted: true }), { direction: "barrier", target: "category", use: "literal", alternative_inverted: true });
});

test("candidate strata come from observed axes and never assert an error or an outside none answer", () => {
  assert.deepEqual(nativeAxisCandidateFlagsV1({ source_direction: "none", direction: "trigger", target: "own_brand",
    use: "figurative_or_ironic", alternative_inverted: true }),
  ["false_none_candidate", "false_irony_candidate", "ambiguous_brand_candidate"]);
  assert.deepEqual(nativeAxisCandidateFlagsV1({ source_direction: "barrier", direction: "barrier", target: "category",
    use: "literal", alternative_inverted: false }), []);
});

test("κ proof adapter preserves canonical per-pass hashes and observed boundary recode count", () => {
  const proof = { eligible_count: 10, pass_a_count: 10, pass_a_digest: sha("a"), pass_b_count: 10, pass_b_digest: sha("b"),
    denominator: 10, coverage: 1, observed_agreement: .9, expected_agreement: .5, kappa: .8,
    estimation_status: "complete" as const, not_estimable_reason: null, action: "recode_boundary_once" as const,
    status: "acceptable" as const, boundary_recoded_count: 2 };
  const receipt = nativeLayerAgreementFromProofV1(proof);
  assert.equal(receipt?.kappa, .8);
  assert.equal(receipt?.boundary_recoded_count, 2);
  assert.equal(receipt?.pass_a_digest, "a".repeat(64));
  assert.equal(receipt?.pass_b_digest, "b".repeat(64));
  assert.notEqual(receipt?.pass_a_digest, receipt?.pass_b_digest);
  assert.throws(() => nativeLayerAgreementFromProofV1({ ...proof, pass_b_digest: "not-a-digest" }), /layer_proof_invalid/u);
});

test("supplemental historical receipts cannot be included in current cost totals", async () => {
  await assert.rejects(() => validateSupplementalReceiptFilesV1([{ stage: "csv_import", period: "historical_reused",
    path: "/tmp/never-read.json", sha256: "a".repeat(64), include_in_current_totals: true }]), /supplemental_receipts_invalid/u);
});

test("frozen author proof honors recorded null suppression and distinguishes unknown historical policy", () => {
  const computed = signalStudyKnownAuthorPrivacyV1({ source_author_label_recorded: true, source_author_label: null,
    legacy_author: "Old fallback", linked_author_display_name: "Linked fallback", linked_author_handle: "@linked" });
  const proof_json = JSON.stringify({ author_privacy: { contract_version: computed.contract_version,
    metadata_snapshot: { contract_version: computed.contract_version, source_author_label_recorded: true, fields: { source_author_label: null } },
    metadata_digest: computed.metadata_digest, roster_digest: computed.roster_digest, provenance: computed.provenance } });
  const suppressed = frozenStudyAuthorRosterV1({ root_id: id("1"), private_person_names: [], proof_json });
  assert.deepEqual(suppressed.names, []);
  assert.equal(suppressed.proof.policy, "recorded_suppressed");
  assert.throws(() => frozenStudyAuthorRosterV1({ root_id: id("1"), private_person_names: ["Linked fallback"], proof_json }),
    /frozen_author_proof_mismatch/u);
  const historical = frozenStudyAuthorRosterV1({ root_id: id("2"), private_person_names: [], proof_json: "{}" });
  assert.equal(historical.proof.policy, "historical_policy_unknown");
});

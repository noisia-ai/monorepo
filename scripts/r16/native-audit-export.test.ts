import assert from "node:assert/strict";
import test from "node:test";
import { assertStudyListeningSourceBindingV1, nativeNearestCandidateSetV1, sourceStudyAxesForAuditV1 } from "./native-audit-export.js";

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

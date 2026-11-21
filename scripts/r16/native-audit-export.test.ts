import assert from "node:assert/strict";
import test from "node:test";
import { assertStudyListeningSourceBindingV1, nativeNearestCandidateSetV1, loadNativeMembershipEvidence, nativeAxisCandidateFlagsV1,
  nativeLayerAgreementFromProofV1, nativeOfficialMotiveOrderV1, sourceStudyAxesForAuditV1, validateSupplementalReceiptFilesV1, frozenStudyAuthorRosterV1 } from "./native-audit-export.js";
import { signalStudyKnownAuthorPrivacyV1 } from "../../infrastructure/db/signal-study-author-privacy.js";

import { signalWorkspaceEmbeddingDigestV1 as digest } from "../../packages/query-engine/src/signal-workspace-embeddings-v1.js";
import type { BlindSnapshotV1 } from "./blind-package.js";

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


// Exercise the exporter loader over persisted batch/member/answer-shaped rows,
// including partial reasks; these are synthetic query results, not a PG oracle.
function nativeMembershipChain() {
  const execution = { id: id("1"), workspace_id: id("2"), output: { summary: { motives:
    ["m_a", "m_b", "m_c", "m_d", "m_e"].map((key, index) => ({ key, name: `Name ${key}`, layer: "personal", mentions: 10 - index })) } } };
  const rows: BlindSnapshotV1["study"] = [{ mention_id: id("3"), redacted_text: "Synthetic category choice.",
    axes_status: "observed", direction: "trigger", target: "category", use: "literal", in_cut: true,
    lexical_filter_match: true, base_voice_valid: true, review_flags: [] }];
  type Batch = { id: string; stage: string; created_at: string; stage_configuration: Record<string, unknown>; stage_configuration_digest: string };
  type Answer = { root_id: string; batch_id: string; stage: string; created_at: string; question_keys: string[];
    motive_key: string; ordinal: number; answer: Record<string, unknown> };
  const batches: Batch[] = [], answers: Answer[] = [], queries: Array<{ sql: string; values: unknown[] }> = [];
  const add = (batch_id: string, stage: string, question_keys: string[], probabilities: number[], minute: number) => {
    const created_at = `2026-11-20T00:${String(minute).padStart(2, "0")}:00.000Z`;
    const stage_configuration = { questions: question_keys.map(key => ({ key, scope: "all", origin: "methodology", type: "noul",
      text: `${stage} ${batch_id} ${key}`, positive: `Definition ${batch_id} ${key}`, negative: `Exclusion ${key}` })) };
    const batch = { id: batch_id, stage, created_at, stage_configuration, stage_configuration_digest: digest(stage_configuration) };
    batches.push(batch);
    question_keys.forEach((motive_key, index) => answers.push({ root_id: rows[0]!.mention_id, batch_id, stage, created_at,
      question_keys: [...question_keys], motive_key, ordinal: index + 1, answer: { type: "noul", noul: probabilities[index]! } }));
    return batch;
  };
  const client = {
    async query<T extends Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> {
      queries.push({ sql, values });
      if (sql.includes("SELECT id,stage,created_at,stage_configuration")) return { rows: batches as unknown as T[] };
      assert.match(sql, /SELECT m\.root_id,b\.id batch_id/u);
      return { rows: answers as unknown as T[] };
    },
  };
  return { execution, rows, batches, answers, queries, add, load: () => loadNativeMembershipEvidence(client, execution, rows) };
}

test("membership4 custody survives dominance1 while the affected probability and definition update", async () => {
  const f = nativeMembershipChain();
  const original = f.add(id("4"), "membership", ["m_d", "m_b", "m_c", "m_a"], [.6, .8, .4, .9], 0);
  f.add(id("5"), "dominance_membership", ["m_a"], [.2], 1);
  const result = await f.load(), row = f.rows[0]!;
  assert.equal(result.nearest_candidate_sets_available, true);
  assert.deepEqual(row.native_nearest_candidate_set?.map(m => m.motive_key), ["m_a", "m_b", "m_c", "m_d"]);
  assert.equal(row.native_nearest_candidate_set?.find(m => m.motive_key === "m_a")?.definition, `Definition ${id("5")} m_a`);
  assert.equal(row.motive_memberships?.find(m => m.motive_key === "m_a")?.probability, .2);
  assert.equal(row.motive_memberships?.find(m => m.motive_key === "m_a")?.assigned, false);
  assert.equal(row.motive_memberships?.find(m => m.motive_key === "m_b")?.probability, .8);
  assert.equal(row.motive_memberships?.find(m => m.motive_key === "m_a")?.definition, `Definition ${id("5")} m_a`);
  const source = result.nearest_candidate_sources[0]!;
  assert.equal(result.nearest_candidate_sources.length, 1);
  assert.deepEqual({ root_id: source.root_id, batch_id: source.batch_id, stage: source.stage, question_keys: source.question_keys,
    stage_configuration_digest: source.stage_configuration_digest }, { root_id: row.mention_id, batch_id: original.id,
    stage: "membership", question_keys: ["m_d", "m_b", "m_c", "m_a"], stage_configuration_digest: original.stage_configuration_digest });
  assert.deepEqual(source.original_questions, original.stage_configuration.questions);
  assert.equal(source.original_questions.find(q => q.key === "m_a")?.positive, `Definition ${original.id} m_a`);
  assert.equal(source.answer_sources.find(a => a.motive_key === "m_a")?.batch_id, id("5"));
  assert.equal(source.answer_sources.find(a => a.motive_key === "m_b")?.batch_id, original.id);
  assert.equal(row.nearest_assigned_motive_key, undefined);
  assert.equal(row.nearest_motives, undefined);
});

test("multiple partial dominance batches overlay each key deterministically without replacing original4", async () => {
  const f = nativeMembershipChain();
  f.add(id("4"), "membership", ["m_a", "m_b", "m_c", "m_d"], [.9, .8, .7, .6], 0);
  f.add(id("5"), "dominance_membership", ["m_a", "m_b"], [.5, .6], 1);
  f.add(id("6"), "dominance_membership", ["m_a"], [.3], 2);
  f.add(id("7"), "dominance_membership", ["m_a"], [.1], 2);
  // A later membership must not override a dominance response; query order is irrelevant.
  f.add(id("8"), "membership", ["m_a"], [.99], 3);
  f.answers.reverse();
  const result = await f.load();
  assert.equal(result.nearest_candidate_sources[0]?.batch_id, id("4"));
  assert.deepEqual(Object.fromEntries(f.rows[0]!.motive_memberships!.map(m => [m.motive_key, m.probability])),
    { m_a: .1, m_b: .6, m_c: .7, m_d: .6 });
});

test("a partial reask outside original4 remains an additional membership without a fabricated winner or candidate", async () => {
  const f = nativeMembershipChain();
  f.add(id("4"), "membership", ["m_a", "m_b", "m_c", "m_d"], [.9, .8, .7, .6], 0);
  f.add(id("5"), "dominance_membership", ["m_e"], [1], 1);
  const result = await f.load(), row = f.rows[0]!;
  assert.equal(result.nearest_candidate_sets_available, true);
  assert.deepEqual(row.native_nearest_candidate_set?.map(m => m.motive_key), ["m_a", "m_b", "m_c", "m_d"]);
  assert.equal(row.motive_memberships?.find(m => m.motive_key === "m_e")?.probability, 1);
  assert.equal(row.nearest_assigned_motive_key, undefined);
  assert.equal(row.motive_key, undefined);
  assert.equal(result.nearest_candidate_sources[0]?.batch_id, id("4"));
});

test("partial-only or dominance-only chains cannot reconstruct an original4", async () => {
  for (const original of [[], ["m_a", "m_b", "m_c"]]) {
    const f = nativeMembershipChain();
    if (original.length) f.add(id("4"), "membership", original, [.9, .8, .7], 0);
    f.add(id("5"), "dominance_membership", ["m_a", "m_b", "m_c", "m_d"], [.1, .2, .3, .4], 1);
    const result = await f.load();
    assert.equal(result.motive_memberships_available, true);
    assert.equal(result.nearest_candidate_sets_available, false);
    assert.deepEqual(result.nearest_candidate_sources, []);
    assert.equal(f.rows[0]!.native_nearest_candidate_set, undefined);
  }
});

test("incomplete or duplicate original batch answers cannot borrow missing custody from another batch", async () => {
  for (const duplicate of [false, true]) {
    const f = nativeMembershipChain();
    f.add(id("4"), "membership", duplicate ? ["m_a", "m_b", "m_c", "m_c"] : ["m_a", "m_b", "m_c", "m_d"], [.9, .8, .7, .6], 0);
    if (!duplicate) f.answers.pop();
    f.add(id("5"), "dominance_membership", ["m_d"], [.2], 1);
    assert.equal((await f.load()).nearest_candidate_sets_available, false);
    assert.equal(f.rows[0]!.native_nearest_candidate_set, undefined);
  }
});

test("batch configuration digest and original question scope must remain authentic", async () => {
  const f = nativeMembershipChain();
  f.add(id("4"), "membership", ["m_a", "m_b", "m_c", "m_d"], [.9, .8, .7, .6], 0).stage_configuration_digest = sha("f");
  await assert.rejects(f.load(), /native_audit_membership_configuration_invalid/u);
  for (const change of [{ scope: "consumer_category" }, { type: "choice" }, { origin: "base" }]) {
    const bad = nativeMembershipChain();
    const batch = bad.add(id("4"), "membership", ["m_a", "m_b", "m_c", "m_d"], [.9, .8, .7, .6], 0);
    const questions = batch.stage_configuration.questions as Array<Record<string, unknown>>;
    Object.assign(questions[0]!, change);
    batch.stage_configuration_digest = digest(batch.stage_configuration);
    await assert.rejects(bad.load(), /native_audit_membership_answer_invalid/u);
  }
});

test("loader queries preserve execution, workspace, run, verified-page and question identity boundaries", async () => {
  const f = nativeMembershipChain();
  f.add(id("4"), "membership", ["m_a", "m_b", "m_c", "m_d"], [.9, .8, .7, .6], 0);
  await f.load();
  assert.deepEqual(f.queries[0]?.values, [f.execution.id, f.execution.workspace_id]);
  assert.match(f.queries[0]!.sql, /execution_id=\$1 AND workspace_id=\$2 AND status='completed'/u);
  const answers = f.queries[1]!;
  assert.deepEqual(answers.values, [f.execution.id, [f.rows[0]!.mention_id], f.execution.workspace_id]);
  for (const boundary of ["b.workspace_id=$3", "m.execution_id=b.execution_id", "a.batch_id=b.id", "a.root_id=m.root_id",
    "a.state_sha256=m.state_sha256", "a.target_digest=m.target_digest", "a.question_digest=m.question_digests->>a.question_key",
    "page.status='verified'", "page.workspace_id=b.workspace_id", "page.run_id=b.run_id"]) assert.ok(answers.sql.includes(boundary), boundary);
});


test("old answers cannot claim nearest membership for a definition changed only on another root", async () => {
  const f = nativeMembershipChain();
  f.add(id("4"), "membership", ["m_a", "m_b", "m_c", "m_d"], [.9, .8, .7, .6], 0);
  const changed = f.add(id("5"), "dominance_membership", ["m_a"], [.2], 1);
  const unrelated = f.answers.find(answer => answer.batch_id === changed.id)!;
  unrelated.root_id = id("9");
  f.answers.splice(f.answers.indexOf(unrelated), 1);
  const result = await f.load();
  assert.equal(result.nearest_candidate_sets_available, false,
    "the global current definition has no matching answer for this root; no validator is weakened");
  assert.deepEqual(result.nearest_candidate_sources, []);
  assert.equal(f.rows[0]!.motive_memberships?.some(m => m.motive_key === "m_a"), false);
});

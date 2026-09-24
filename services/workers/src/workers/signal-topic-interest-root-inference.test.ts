import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { signalTopicDefinitionDigestV1, signalTopicEditorialDigestV1,
  signalWorkspaceEmbeddingDigestV1 as digest, type SignalTopicDefinitionV1,
  type SignalTopicInterestEvidenceCandidatesV1, type SignalWorkspaceClassificationOutcomeV1 } from "@noisia/query-engine";
import type { SignalWorkspaceClassificationChunksPageV1 } from "@noisia/db";
import type { SignalWorkspaceClassificationLeaseV1 } from "./signal-workspace-classification";
import type { WorkspaceProjectionPageStoresV1 } from "./signal-workspace-projection-pages";
import { projectSignalTopicInterestRootInferenceV1, signalTopicInterestRootPolicyDigestV1,
  type SignalTopicInterestRootInferenceTopicV1 } from "./signal-topic-interest-root-inference";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
function topic(n: number): SignalTopicInterestRootInferenceTopicV1 {
  const definition: SignalTopicDefinitionV1 = { term_key: `interest_${n}`, label: `Interest ${n}`,
    definition: `Full corpus interest ${n}`, scope: "all_conversations", inclusion: ["Relevant conversation"],
    exclusion: ["Namesake"], positive_examples: ["Relevant example"], negative_examples: ["Namesake example"],
    lifecycle: "draft", origin: "manual", source: null, definition_revision: 1,
    definition_digest: sha("placeholder"), created_at: "2026-09-24T00:00:00.000Z", updated_at: "2026-09-24T00:00:00.000Z" };
  definition.definition_digest = signalTopicDefinitionDigestV1(definition);
  return { taxonomy_term_id: id(100 + n), definition };
}
function root(n: number, parts = 1) {
  let start = 0;
  const chunks = Array.from({ length: parts }, (_, chunk_index) => {
    const text = `Root ${n} chunk ${chunk_index} discusses routines.`;
    const result = { chunk_index, start, end: start + text.length, text, chunk_sha256: sha(text) };
    start = result.end; return result;
  });
  const record = { root_id: id(n), fingerprint: sha(`fingerprint:${n}`), correction_digest: sha(`corrections:${n}`),
    asset_sha256: sha(chunks.map(item => item.text).join("")), expected_chunks: parts,
    chunk_coverage_digest: sha(chunks.map(item => JSON.stringify([item.chunk_index, item.start, item.end, item.chunk_sha256]) + "\n").join("")),
    reuse_item_id: null };
  return { root: record, chunks: chunks.map(item => ({ ...item, root_id: record.root_id,
    asset_sha256: record.asset_sha256, expected_chunks: record.expected_chunks })) };
}
function fixture(options: { correction_on_supported?: boolean; invalid_citation?: boolean } = {}) {
  const topics = [topic(1), topic(2)], roots = [root(1, 2), root(2), root(3)];
  const sourceBody = { contract_version: "signal-topic-interest-evidence-candidates-v1" as const,
    workspace_id: id(90), taxonomy_profile_id: id(91), input_digest: sha("input"), review_digest: sha("review"),
    screening_plan_digest: sha("screen"), source_context_digest: sha("context"), editorial_context_digest: sha("editorial"),
    approval_policy: "none" as const, membership_effect: "none" as const, uncited_group_decisions: [],
    candidates: [id(1), id(3)].map(root_id => ({ root_id, term_key: topics[0]!.definition.term_key,
      definition_revision: topics[0]!.definition.definition_revision, definition_digest: topics[0]!.definition.definition_digest,
      requires_additional_evidence: root_id === id(3), observations: [] })) };
  const evidence_candidates: SignalTopicInterestEvidenceCandidatesV1 = { ...sourceBody,
    binding_digest: signalTopicEditorialDigestV1(sourceBody) };
  const identity: SignalWorkspaceClassificationLeaseV1["identity"] = {
    contract_version: "signal-workspace-classification-v1", workspace_id: id(90), engine_key: "interest-local-fixture",
    engine_version: 1, engine_artifact_digest: sha("local scorer artifact"), embedding_config_digest: sha("embeddings"),
    catalog_digest: digest(topics.map(item => ({ term_key: item.definition.term_key,
      definition_digest: item.definition.definition_digest, definition_revision: item.definition.definition_revision }))),
    compiler_digest: sha("compiler"), context_digest: sha("context"),
    decision_policy_digest: signalTopicInterestRootPolicyDigestV1({ review_digest: sourceBody.review_digest,
      evidence_binding_digest: evidence_candidates.binding_digest, scorer_artifact_digest: sha("local scorer artifact") }) };
  let cursor: string | null = null, truncate = false;
  const writes = new Map<string, SignalWorkspaceClassificationOutcomeV1>();
  const seen = new Map<string, {candidate: boolean; chunks: number}>();
  const lease = (): SignalWorkspaceClassificationLeaseV1 => ({ execution_id: id(92), workspace_id: id(90),
    execution_token: id(93), cursor_root_id: cursor, input_digest: sha("run"), identity });
  const corrections = [topics[0]!.definition];
  const human = { taxonomy_term_id: topics[0]!.taxonomy_term_id, term_key: topics[0]!.definition.term_key,
    definition_revision: corrections[0]!.definition_revision, definition_digest: corrections[0]!.definition_digest,
    disposition: options.correction_on_supported ? "rejected" as const : "approved" as const,
    resolution_method: "human" as const, model_version_id: null,
    labeling_function_version_id: null, approval_policy_id: null, decided_by_user_id: id(94),
    correction_operation_id: id(95), score: null, evidence_digest: sha("human evidence"), lineage_digest: sha("human lineage") };
  const stores: WorkspaceProjectionPageStoresV1<object> = {
    readPage: async ({ limit }) => { const remaining = roots.filter(item => cursor === null || item.root.root_id > cursor);
      return { items: remaining.slice(0, limit).map(item => ({ root: item.root,
        corrections: item.root.root_id === (options.correction_on_supported ? id(1) : id(2)) ? [human] : [] })), done: remaining.length <= limit }; },
    readChunksPage: async ({ root_ids, after, limit }) => {
      const available = roots.filter(item => root_ids.includes(item.root.root_id)).flatMap(item => item.chunks)
        .filter(item => after === null || item.root_id > after.root_id
          || item.root_id === after.root_id && item.chunk_index > after.chunk_index);
      const items = available.slice(0, limit), last = items.at(-1);
      const page: SignalWorkspaceClassificationChunksPageV1 = { items: truncate ? items.slice(0, 1) : items,
        next_cursor: last ? { root_id: last.root_id, chunk_index: last.chunk_index } : after,
        done: truncate || available.length <= limit };
      return page;
    },
    commitPage: async ({ outcomes }) => { for (const outcome of outcomes) writes.set(outcome.root.root_id, outcome);
      cursor = outcomes.at(-1)!.root.root_id; return lease(); },
    finish: async () => { assert.equal(writes.size, roots.length); return { roots: writes.size }; },
    fail: async () => undefined
  };
  const inferRoot: Parameters<typeof projectSignalTopicInterestRootInferenceV1<object>>[0]["inferRoot"] = async input => {
    let count = 0, first: {chunk_index:number;start:number;end:number;chunk_sha256:string}|null = null;
    for await (const page of input.chunks) for (const chunk of page) {
      first ??= { chunk_index: chunk.chunk_index, start: chunk.start, end: chunk.end, chunk_sha256: chunk.chunk_sha256 };
      count++;
    }
    seen.set(input.root.root_id, { candidate: input.candidate.length > 0, chunks: count });
    const relation = input.root.root_id === id(1) ? "supports" : input.root.root_id === id(3) ? "mixed" : "unrelated";
    return input.topics.map((item, index) => ({ term_key: item.definition.term_key,
      relation: index === 0 ? relation : "unrelated", cited_chunks: index === 0 && relation === "supports"
        ? [options.invalid_citation ? { ...first!, chunk_sha256: sha("forged") } : first!] : [] }));
  };
  const job = { id: "interest-root-local", data: { execution_id: id(92) }, updateProgress: async () => undefined };
  const run = () => projectSignalTopicInterestRootInferenceV1({ job, database: {}, lease: lease(), stores,
    taxonomy_profile_id: id(91), topics, evidence_candidates, model_version_id: id(96), inferRoot, root_page_size: 2 });
  return { run, roots, topics, sourceBody, evidence_candidates, identity, writes, seen, truncate: () => { truncate = true; } };
}

test("full-corpus local inference leaves only root-specific support pending and preserves correction", async () => {
  const f = fixture(); assert.deepEqual(await f.run(), { roots: 3 });
  assert.deepEqual([...f.seen.entries()], [[id(1), {candidate:true,chunks:2}],
    [id(2), {candidate:false,chunks:1}], [id(3), {candidate:true,chunks:1}]]);
  const cited = f.writes.get(id(1))!, uncited = f.writes.get(id(2))!, mixed = f.writes.get(id(3))!;
  assert.equal(cited.resolution_state, "pending"); assert.equal(cited.decisions.length, 1);
  assert.equal(cited.decisions[0]!.disposition, "pending"); assert.equal(cited.decisions[0]!.approval_policy_id, null);
  assert.equal(cited.decisions[0]!.membership_basis, undefined);
  assert.equal(uncited.decisions.length, 1); assert.equal(uncited.decisions[0]!.resolution_method, "human");
  assert.equal(uncited.resolution_state, "approved");
  assert.equal(mixed.decisions.length, 0); assert.equal(mixed.resolution_state, "pending");
});

test("wrong policy/definition and incomplete chunks fail without persistent output", async () => {
  const changed = fixture(); changed.identity.decision_policy_digest = sha("stale review");
  await assert.rejects(changed.run(), /workspace_classification_interest_source_invalid/);
  assert.equal(changed.writes.size, 0);
  const stale = fixture(); stale.evidence_candidates.candidates[0]!.definition_revision++;
  const { binding_digest: _old, ...body } = stale.evidence_candidates;
  stale.evidence_candidates.binding_digest = signalTopicEditorialDigestV1(body);
  stale.identity.decision_policy_digest = signalTopicInterestRootPolicyDigestV1({ review_digest: stale.sourceBody.review_digest,
    evidence_binding_digest: stale.evidence_candidates.binding_digest,
    scorer_artifact_digest: stale.identity.engine_artifact_digest });
  await assert.rejects(stale.run(), /workspace_classification_interest_definition_changed/);
  const partial = fixture(); partial.truncate();
  await assert.rejects(partial.run(), /workspace_classification_(chunk_coverage_incomplete|chunk_cursor_invalid)/);
  assert.equal(partial.writes.size, 0);
  const forged = fixture({ invalid_citation: true });
  await assert.rejects(forged.run(), /workspace_classification_interest_citation_invalid/);
  assert.equal(forged.writes.size, 0);
});

test("an explicit exclusion overrides a supported pending interest on the same root", async () => {
  const f = fixture({ correction_on_supported: true });
  await f.run();
  const first = f.writes.get(id(1))!;
  assert.equal(first.decisions.length, 1);
  assert.equal(first.decisions[0]!.resolution_method, "human");
  assert.equal(first.decisions[0]!.disposition, "rejected");
  assert.equal(first.resolution_state, "rejected");
});

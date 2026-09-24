import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { signalTopicDefinitionDigestV1, type SignalTopicDefinitionV1 } from "./signal-topic-catalog-v1";
import { buildSignalTopicEditorialScreeningPlanV1, signalTopicEditorialDigestV1 as digest } from "./signal-topic-consolidation-editorial-v1";
import { buildSignalTopicInterestReviewV1, parseSignalTopicInterestReviewResultV1,
  type SignalTopicInterestReviewDecisionV1 } from "./signal-topic-interest-review-v1";
import { bindSignalTopicInterestEvidenceCandidatesV1 } from "./signal-topic-interest-evidence-candidates-v1";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const root = id(1);
function evidence(text: string, chunk_index: number) {
  const start = 0, end = text.length, root_id = root;
  const chunk_sha256 = `sha256:${createHash("sha256").update(text).digest("hex")}`;
  return { ref_id: digest({ root_id, chunk_index, start, end, chunk_sha256 }), root_id, chunk_index,
    start, end, chunk_sha256, text, locale: "es-MX", platform: "reddit", occurred_at: "2026-09-12T00:00:00.000Z" };
}
function group(index: number) {
  const refs = index === 0 ? [evidence("Voice routine for lights", 0), evidence("Routine for music", 1)]
    : [evidence("Routine for alarms", 2)];
  const scope_counts = { brand: 1, competitor: 0, category: 0, unknown: 0 };
  const locale_counts = [{ key: "es-MX", count: 1 }], platform_counts = [{ key: "reddit", count: 1 }];
  const month_counts = [{ key: "2026-09", count: 1 }], brand_affinity = { positive: [], negative: [], abstention: [] };
  const neighbors: never[] = [], metrics = { cohesion: null, outlier_ratio: null };
  const dossier = { contract_version: "signal-topic-group-dossier-v1", scope_counts, locale_counts, platform_counts,
    month_counts, brand_affinity, neighbors, metrics, evidence: refs.map(({ text: _text, ...ref }) => ref) };
  return { group_key: `open:cluster-${index}`, lane: "open" as const, group_digest: digest(["group", index]),
    source_dossier_digest: digest(dossier), dossier_digest: digest(dossier), community_key: "community-0",
    root_count: 1, chunk_count: refs.length, terms: ["routines"], scope_counts, locale_counts, platform_counts,
    month_counts, brand_affinity, neighbors, metrics, evidence: refs };
}
const context = { brand_name: "Alexa+", default_locale: "es-MX", summary: "Voice assistant.", audiences: ["homes"],
  categories: ["voice assistants"], competitors: ["Google Assistant"], positive_anchors: ["routines"],
  negative_anchors: ["Alexandra"], abstention_anchors: ["noise"] };
function definition(): SignalTopicDefinitionV1 {
  const value: SignalTopicDefinitionV1 = { term_key: "voice_routines", label: "Voice routines", definition: "Home routines with Alexa+",
    scope: "primary_brand", inclusion: ["Home automation"], exclusion: ["Namesakes"],
    positive_examples: ["Turn off lights"], negative_examples: ["Alexandra turned off lights"], lifecycle: "draft",
    origin: "manual", source: null, definition_revision: 2, definition_digest: digest("placeholder"),
    created_at: "2026-09-24T00:00:00.000Z", updated_at: "2026-09-24T00:00:00.000Z" };
  value.definition_digest = signalTopicDefinitionDigestV1(value); return value;
}
function fixture(dispositions: SignalTopicInterestReviewDecisionV1["disposition"][] = ["supports", "mixed"],
  uncited = false) {
  const groups = [group(0), group(1)];
  const screening_plan = buildSignalTopicEditorialScreeningPlanV1({ expected_group_count: groups.length,
    source_context_digest: digest("context-source"), editorial_context_digest: digest(context), context, groups });
  const review = buildSignalTopicInterestReviewV1({ workspace_id: id(100), taxonomy_profile_id: id(200),
    definitions: [definition()], screening_plan });
  const outputs = review.batches.map(batch => ({ contract_version: "signal-topic-interest-review-output-v1" as const,
    workspace_id: review.manifest.workspace_id, taxonomy_profile_id: review.manifest.taxonomy_profile_id,
    input_digest: review.input_digest, batch_index: batch.batch_index,
    decisions: batch.pairs.map((pair, index) => {
      const disposition = dispositions[index]!;
      return { ...pair, disposition,
        cited_ref_ids: uncited && index === 1 ? [] : groups[index]!.evidence.map(ref => ref.ref_id),
        rationale: "Representative fragments were reviewed.",
        requires_additional_evidence: disposition === "mixed" || disposition === "insufficient" };
    }) }));
  const result = parseSignalTopicInterestReviewResultV1({ review, outputs });
  return { review, result, groups };
}

test("deduplicates a cited root across groups while retaining every citation and unresolved relation", () => {
  const { review, result, groups } = fixture();
  const bound = bindSignalTopicInterestEvidenceCandidatesV1({ review, result });
  assert.equal(bound.contract_version, "signal-topic-interest-evidence-candidates-v1");
  assert.equal(bound.membership_effect, "none"); assert.equal(bound.approval_policy, "none");
  assert.equal(bound.review_digest, review.review_digest);
  assert.equal(bound.candidates.length, 1);
  const candidate = bound.candidates[0]!;
  assert.equal(candidate.root_id, root); assert.equal(candidate.term_key, "voice_routines");
  assert.equal(candidate.definition_revision, 2); assert.equal(candidate.definition_digest, definition().definition_digest);
  assert.equal(candidate.requires_additional_evidence, true);
  assert.deepEqual(candidate.observations.map(item => item.disposition), ["supports", "mixed"]);
  assert.deepEqual(candidate.observations.flatMap(item => item.citations.map(ref => ref.ref_id)).sort(),
    groups.flatMap(item => item.evidence.map(ref => ref.ref_id)).sort());
  assert.equal(bound.uncited_group_decisions.length, 0);
  const { binding_digest: _digest, ...body } = bound;
  assert.equal(bound.binding_digest, digest(body));
});

test("an insufficient group without a citation stays unresolved without inventing a root", () => {
  const { review, result } = fixture(["supports", "insufficient"], true);
  const bound = bindSignalTopicInterestEvidenceCandidatesV1({ review, result });
  assert.equal(bound.candidates.length, 1);
  assert.equal(bound.candidates[0]!.observations.length, 1);
  assert.equal(bound.uncited_group_decisions.length, 1);
  assert.equal(bound.uncited_group_decisions[0]!.disposition, "insufficient");
});

test("rejects changed result identities, definition versions and unbound citations", () => {
  const original = fixture();
  for (const mutate of [
    (result: typeof original.result) => { result.review_digest = digest("other"); },
    (result: typeof original.result) => { result.decisions[0]!.definition_revision++; },
    (result: typeof original.result) => { result.decisions[0]!.cited_ref_ids = [digest("foreign")]; },
    (result: typeof original.result) => { result.decisions.push(result.decisions[0]!); }
  ]) {
    const result = structuredClone(original.result); mutate(result);
    assert.throws(() => bindSignalTopicInterestEvidenceCandidatesV1({ review: original.review, result }),
      /topic_interest_(review|evidence)_/, "changed or duplicate evidence cannot be bound");
  }
  const review = structuredClone(original.review);
  review.screening_plan.batches[0]!.source_groups_body = "[]";
  assert.throws(() => bindSignalTopicInterestEvidenceCandidatesV1({ review, result: original.result }),
    /topic_interest_review_/, "altered trusted source is rejected before binding");
});

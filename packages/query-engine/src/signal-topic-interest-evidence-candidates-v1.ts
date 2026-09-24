import { createSignalTopicInterestReviewOutputValidatorV1, type SignalTopicInterestReviewDecisionV1,
  type SignalTopicInterestReviewResultV1, type SignalTopicInterestReviewV1 } from "./signal-topic-interest-review-v1";
import { signalTopicEditorialDigestV1 as digest, type SignalTopicEditorialEvidenceV1,
  type SignalTopicEditorialScreeningGroupV1 } from "./signal-topic-consolidation-editorial-v1";

/** A citation identifies one representative fragment. It is neither a root
 * classification nor evidence that the rest of its computational group belongs
 * to the same interest. */
export type SignalTopicInterestEvidenceCandidateV1 = {
  root_id: string; term_key: string; definition_revision: number; definition_digest: string;
  requires_additional_evidence: boolean;
  observations: Array<{
    group_key: string; group_digest: string; dossier_digest: string;
    disposition: SignalTopicInterestReviewDecisionV1["disposition"];
    requires_additional_evidence: boolean; rationale: string;
    citations: Array<Pick<SignalTopicEditorialEvidenceV1,
      "ref_id" | "root_id" | "chunk_index" | "start" | "end" | "chunk_sha256">>;
  }>;
};
export type SignalTopicInterestEvidenceCandidatesV1 = {
  contract_version: "signal-topic-interest-evidence-candidates-v1";
  workspace_id: string; taxonomy_profile_id: string; input_digest: string; review_digest: string;
  screening_plan_digest: string; source_context_digest: string; editorial_context_digest: string;
  approval_policy: "none"; membership_effect: "none";
  /** Insufficient pairs without a citation have no root to attach to. */
  uncited_group_decisions: SignalTopicInterestReviewDecisionV1[];
  candidates: SignalTopicInterestEvidenceCandidateV1[];
  binding_digest: string;
};

const fail = (code: string): never => { throw new Error(`topic_interest_evidence_${code}`); };
const ascii = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const pairKey = (group: string, term: string) => JSON.stringify([group, term]);
const rootKey = (root: string, term: string) => JSON.stringify([root, term]);

/** Revalidates the full review and result. The caller must supply the trusted
 * immutable review snapshot; hashes alone do not authenticate an arbitrary one. */
export function bindSignalTopicInterestEvidenceCandidatesV1(args: {
  review: SignalTopicInterestReviewV1; result: SignalTopicInterestReviewResultV1;
}): SignalTopicInterestEvidenceCandidatesV1 {
  const validator = createSignalTopicInterestReviewOutputValidatorV1(args.review);
  const review = args.review, raw = args.result;
  if (!raw || !Array.isArray(raw.decisions) || raw.decisions.length !== review.manifest.expected_pair_count)
    return fail("result_invalid");
  const byPair = new Map<string, SignalTopicInterestReviewDecisionV1>();
  for (const decision of raw.decisions) {
    if (!decision || typeof decision.group_key !== "string" || typeof decision.term_key !== "string") return fail("result_invalid");
    const key = pairKey(decision.group_key, decision.term_key);
    if (byPair.has(key)) return fail("result_invalid");
    byPair.set(key, decision);
  }
  const outputs = review.batches.map(batch => ({ contract_version: "signal-topic-interest-review-output-v1" as const,
    workspace_id: review.manifest.workspace_id, taxonomy_profile_id: review.manifest.taxonomy_profile_id,
    input_digest: review.input_digest, batch_index: batch.batch_index,
    decisions: batch.pairs.map(pair => byPair.get(pairKey(pair.group_key, pair.term_key)) ?? fail("result_invalid")) }));
  const result = validator.parseAll(outputs);
  if (digest(result) !== digest(raw)) return fail("result_invalid");

  const refs = new Map<string, Map<string, SignalTopicEditorialEvidenceV1>>();
  for (const batch of review.screening_plan.batches) {
    const groups = JSON.parse(batch.source_groups_body) as SignalTopicEditorialScreeningGroupV1[];
    for (const group of groups) {
      if (refs.has(group.group_key)) return fail("review_invalid");
      refs.set(group.group_key, new Map(group.evidence.map(entry => [entry.ref_id, entry])));
    }
  }
  const candidates = new Map<string, SignalTopicInterestEvidenceCandidateV1>();
  const uncited_group_decisions: SignalTopicInterestReviewDecisionV1[] = [];
  for (const decision of result.decisions) {
    if (decision.cited_ref_ids.length === 0) { uncited_group_decisions.push(decision); continue; }
    const byRoot = new Map<string, SignalTopicEditorialEvidenceV1[]>();
    for (const ref of decision.cited_ref_ids) {
      const evidence = refs.get(decision.group_key)?.get(ref);
      // parseAll checked allowed refs; the source body still has to resolve
      // each one to an exact root and fragment before any observation is made.
      if (!evidence) return fail("citation_unbound");
      const list = byRoot.get(evidence.root_id) ?? [];
      list.push(evidence); byRoot.set(evidence.root_id, list);
    }
    for (const [root_id, entries] of byRoot) {
      const key = rootKey(root_id, decision.term_key);
      let candidate = candidates.get(key);
      if (!candidate) {
        candidate = { root_id, term_key: decision.term_key,
          definition_revision: decision.definition_revision, definition_digest: decision.definition_digest,
          requires_additional_evidence: false, observations: [] };
        candidates.set(key, candidate);
      }
      if (candidate.definition_revision !== decision.definition_revision || candidate.definition_digest !== decision.definition_digest)
        return fail("definition_drift");
      candidate.requires_additional_evidence ||= decision.requires_additional_evidence;
      candidate.observations.push({ group_key: decision.group_key, group_digest: decision.group_digest,
        dossier_digest: decision.dossier_digest, disposition: decision.disposition,
        requires_additional_evidence: decision.requires_additional_evidence, rationale: decision.rationale,
        citations: entries.map(({ ref_id, root_id: cited_root, chunk_index, start, end, chunk_sha256 }) =>
          ({ ref_id, root_id: cited_root, chunk_index, start, end, chunk_sha256 }))
          .sort((a, b) => ascii(a.ref_id, b.ref_id)) });
    }
  }
  const ordered = [...candidates.values()].sort((a, b) => ascii(a.root_id, b.root_id) || ascii(a.term_key, b.term_key));
  for (const candidate of ordered) candidate.observations.sort((a, b) => ascii(a.group_key, b.group_key));
  const body = { contract_version: "signal-topic-interest-evidence-candidates-v1" as const,
    workspace_id: review.manifest.workspace_id, taxonomy_profile_id: review.manifest.taxonomy_profile_id,
    input_digest: review.input_digest, review_digest: review.review_digest,
    screening_plan_digest: review.manifest.screening_plan_digest,
    source_context_digest: review.manifest.source_context_digest,
    editorial_context_digest: review.manifest.editorial_context_digest,
    approval_policy: "none" as const, membership_effect: "none" as const,
    uncited_group_decisions, candidates: ordered };
  return { ...body, binding_digest: digest(body) };
}

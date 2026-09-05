import assert from "node:assert/strict";
import test from "node:test";

import {
  SIGNAL_TOPIC_CANDIDATE_REFINEMENT_V1_CONTRACT,
  parseSignalTopicCandidateRefinementNavigationRequestV1,
  parseSignalTopicCandidateRefinementProposalV1,
  parseSignalTopicCandidateRefinementSessionStartV1
} from "./signal-topic-candidate-refinement-v1";

const digest = `sha256:${"1".repeat(64)}`;

test("candidate refinement requests are bounded and have no free-form navigation", () => {
  assert.deepEqual(parseSignalTopicCandidateRefinementNavigationRequestV1({
    operation: "search_cluster", cluster_key: "cluster.one", limit: 20, cursor: null, filters: {}
  }).operation, "search_cluster");
  assert.throws(() => parseSignalTopicCandidateRefinementNavigationRequestV1({
    operation: "search_cluster", cluster_key: "cluster.one", limit: 21, cursor: null, filters: {}
  }));
  assert.throws(() => parseSignalTopicCandidateRefinementNavigationRequestV1({
    operation: "compare_clusters", cluster_keys: ["cluster.one", "cluster.two", "cluster.three"]
  }));
  assert.throws(() => parseSignalTopicCandidateRefinementNavigationRequestV1({
    operation: "compare_clusters", cluster_keys: ["cluster.one", "cluster.one"]
  }));
  assert.throws(() => parseSignalTopicCandidateRefinementNavigationRequestV1({
    operation: "candidate_context", sql: "select * from mentions"
  }));
});

test("candidate refinement proposal is citation-bound and cannot smuggle editorial commands", () => {
  const proposal = parseSignalTopicCandidateRefinementProposalV1({
    contract_version: SIGNAL_TOPIC_CANDIDATE_REFINEMENT_V1_CONTRACT,
    display_name: "Alexa+ in Mexico", description: "A bounded candidate proposal.",
    evidence_refs: [digest], related_candidate_keys: ["candidate.related"],
    recommendation: "consider_merge", rationale: "The same launch evidence overlaps."
  });
  assert.equal(proposal.recommendation, "consider_merge");
  assert.throws(() => parseSignalTopicCandidateRefinementProposalV1({
    ...proposal, recommendation: "consider_merge", related_candidate_keys: []
  }));
  assert.throws(() => parseSignalTopicCandidateRefinementProposalV1({ ...proposal, action: "save" }));
  assert.throws(() => parseSignalTopicCandidateRefinementProposalV1({
    ...proposal, evidence_refs: [digest, digest]
  }));
});

test("session start seals a current candidate revision and rejects unscoped input", () => {
  assert.deepEqual(parseSignalTopicCandidateRefinementSessionStartV1({
    run_key: "run.one", candidate_key: "candidate.one", expected_revision: 2, state_token: digest
  }).candidate_key, "candidate.one");
  assert.throws(() => parseSignalTopicCandidateRefinementSessionStartV1({
    candidate_key: "candidate.one", expected_revision: 2, state_token: digest
  }));
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSignalTopicEvaluationEnvelopeV1,
  parseSignalTopicEvaluationOutputV1,
  signalTopicEvaluationDigestV1,
  signalTopicEvaluationSucceededV1,
  SIGNAL_TOPIC_EVALUATION_OUTPUT_CONTRACT_VERSION
} from "./signal-topic-evaluation-v1";

const hash = (value: string) => `sha256:${value.padEnd(64, "0").slice(0, 64)}`;

function envelope() {
  return buildSignalTopicEvaluationEnvelopeV1({
    contract_version: "signal-topic-evaluation-v1",
    corpus: { identity: "frozen-corpus-v1", discovery_run_digest: hash("1"),
      source_manifest_digest: hash("2"), rights_digest: hash("3"), modeling_count: 21_195 },
    semantic_context: { generation_key: "semantic-context-v6",
      generation_authority_digest: hash("4"), brand_os_digest: hash("5"),
      knowledge_digest: hash("6"), locale_context_digest: hash("7"),
      candidate_pack_digest: hash("8"), approved_count: 70,
      context_elements:[{element_key:"identity.brand",element_kind:"identity",
        display_text:"Governed brand identity",scope:"workspace",locale:null,relation_kind:null,
        relation_target_key:null,source_refs_digest:hash("a"),evidence_count:2}] },
    diagnostic_packet: { packet_digest: hash("9"), proposal_count: 115, evidence_count: 115,
      proposals: Array.from({ length: 115 }, (_, index) => ({
        proposal_key: `proposal.${String(114 - index).padStart(3, "0")}`,
        title: `Proposal ${index}`,
        content_digest: signalTopicEvaluationDigestV1({ index }),
        signals:{cluster_member_count:index+1,coverage:0.01,local_terms:[`term-${index}`],
          local_phrases:[],scope_labels:["primary_brand"],limitations:[]},
        evidence: [{ evidence_ref_digest: signalTopicEvaluationDigestV1(`evidence-${index}`),
          mention_ref_digest: signalTopicEvaluationDigestV1(`mention-${index}`),
          relation: "supports" as const }]
      })) }
  });
}

test("builds a deterministic 115-proposal envelope", () => {
  const built = envelope();
  assert.equal(built.diagnostic_packet.proposals.length, 115);
  assert.equal(built.diagnostic_packet.proposals[0]?.proposal_key, "proposal.000");
  assert.equal(signalTopicEvaluationDigestV1(built), signalTopicEvaluationDigestV1(envelope()));
});

test("strict output accepts relational candidates and reports the >=10 rubric", () => {
  const input = envelope();
  const first = input.diagnostic_packet.proposals[0]!;
  const raw = JSON.stringify({ contract_version: SIGNAL_TOPIC_EVALUATION_OUTPUT_CONTRACT_VERSION,
    candidates: Array.from({ length: 10 }, (_, index) => ({ candidate_key: `candidate.${index}`,
      title: `Candidate ${index}`, description: "Editable diagnostic candidate",
      inclusion: ["in"], exclusion: [],
      evidence_refs: [first.evidence[0]!.evidence_ref_digest],
      source_proposal_keys: [first.proposal_key] })) });
  const output = parseSignalTopicEvaluationOutputV1(raw, input);
  assert.equal(signalTopicEvaluationSucceededV1(output), true);
});

test("strict output rejects invalid JSON, extra fields and unknown evidence", () => {
  const input = envelope();
  assert.throws(() => parseSignalTopicEvaluationOutputV1("{", input),
    /topic_evaluation_provider_json_invalid/u);
  const candidate = { candidate_key: "candidate.1", title: "Candidate", description: "Description",
    inclusion: ["in"], exclusion: [], evidence_refs: [hash("f")],
    source_proposal_keys: [input.diagnostic_packet.proposals[0]!.proposal_key] };
  assert.throws(() => parseSignalTopicEvaluationOutputV1(JSON.stringify({
    contract_version: SIGNAL_TOPIC_EVALUATION_OUTPUT_CONTRACT_VERSION,
    candidates: [candidate], extra: true
  }), input));
  assert.throws(() => parseSignalTopicEvaluationOutputV1(JSON.stringify({
    contract_version: SIGNAL_TOPIC_EVALUATION_OUTPUT_CONTRACT_VERSION,
    candidates: [candidate]
  }), input), /topic_evaluation_evidence_ref_unknown/u);
});

test("strict output rejects duplicate evidence refs within a candidate",()=>{
  const input=envelope();const first=input.diagnostic_packet.proposals[0]!;
  const evidence=first.evidence[0]!.evidence_ref_digest;
  assert.throws(()=>parseSignalTopicEvaluationOutputV1(JSON.stringify({
    contract_version:SIGNAL_TOPIC_EVALUATION_OUTPUT_CONTRACT_VERSION,
    candidates:[{candidate_key:"candidate.duplicate-evidence",title:"Candidate",description:"Description",
      inclusion:["in"],exclusion:[],evidence_refs:[evidence,evidence],
      source_proposal_keys:[first.proposal_key]}]}),input),
  /topic_evaluation_duplicate_candidate_evidence_ref/u);
});

test("strict output rejects duplicate source proposal keys within a candidate",()=>{
  const input=envelope();const first=input.diagnostic_packet.proposals[0]!;
  assert.throws(()=>parseSignalTopicEvaluationOutputV1(JSON.stringify({
    contract_version:SIGNAL_TOPIC_EVALUATION_OUTPUT_CONTRACT_VERSION,
    candidates:[{candidate_key:"candidate.duplicate-source",title:"Candidate",description:"Description",
      inclusion:["in"],exclusion:[],evidence_refs:[first.evidence[0]!.evidence_ref_digest],
      source_proposal_keys:[first.proposal_key,first.proposal_key]}]}),input),
  /topic_evaluation_duplicate_candidate_source_proposal_key/u);
});

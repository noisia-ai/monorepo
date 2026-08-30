import assert from "node:assert/strict";
import test from "node:test";

import { SIGNAL_TOPIC_EVALUATION_V2_CONTRACT,signalTopicEvaluationDigestV2,signalTopicEvidenceNavigationResultV2 }
  from "@noisia/query-engine";
import { executeSignalTopicEvaluationV2OfflineFixture } from "./signal-topic-evaluation-v2";

test("offline Worker fixture progressively navigates without provider or queue registration",async()=>{
  const snapshot=signalTopicEvaluationDigestV2("snapshot");
  const evidence=signalTopicEvaluationDigestV2("evidence");let turn=0;let navigationCalls=0;
  const trace=await executeSignalTopicEvaluationV2OfflineFixture({snapshot_digest:snapshot,
    model:{next:async()=>turn++===0?{kind:"tool",request:{operation:"representative_mentions",
      cluster_key:"cluster.1",limit:3,filters:{}}}:{kind:"final",json:JSON.stringify({
      contract_version:"signal-topic-evaluation-full-evidence-output-v2",candidates:[{
        candidate_key:"candidate.1",title:"Candidate",description:"Diagnostic candidate",
        inclusion:["in"],exclusion:[],explanation:"Bounded evidence",source_cluster_keys:["cluster.1"],
        evidence_refs:[evidence],status:"pending"}],ranking:[{rank:1,candidate_key:"candidate.1",
        ranking_reason:"Bounded relevance"}]})}},navigate:async(request)=>{navigationCalls+=1;
      const body={contract_version:SIGNAL_TOPIC_EVALUATION_V2_CONTRACT,operation:request.operation,
        snapshot_digest:snapshot,evidence_refs:[evidence],next_cursor:null,data:{cluster_key:"cluster.1",
          mentions:[{evidence_ref:evidence,excerpt:"Sanitized fixture excerpt",language:"en",market:"US",
            scope:"category",month:"2026-01",stratum:"central",source_digest:evidence}],
          sampling_guarantee:"deterministic_round_robin_across_observed_strata",sampling_limit:"Bounded by metadata."}};
      return signalTopicEvidenceNavigationResultV2.parse({...body,result_digest:signalTopicEvaluationDigestV2(body)});}});
  assert.equal(navigationCalls,1);assert.equal(trace.provider_calls,0);
  assert.equal(trace.output.candidates[0]!.status,"pending");
});

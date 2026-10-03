import assert from "node:assert/strict";
import test from "node:test";

import {signalSemanticContextProposalJob} from "./signal-semantic-context-proposal";

test("a completed semantic job advances the same composed receipt into prototype processing",async()=>{
  const runId="11111111-1111-4111-8111-111111111111";
  const workspaceId="22222222-2222-4222-8222-222222222222";
  const progress:number[]=[];
  let composedCalls=0;
  const result=await signalSemanticContextProposalJob({data:{contract_version:"signal-semantic-context-proposal-run-v1",run_id:runId},
    async updateProgress(value){progress.push(Number(value));}}, {
    database:{async query(sql:string){
      assert.match(sql,/signal_semantic_context_proposal_runs/u);
      return{rows:[{workspace_id:workspaceId}],rowCount:1};
    },async connect(){throw new Error("process seam is injected");}} as never,
    process_run:async()=>({status:"completed",run_key:"fixture",proposal_count:2,ready_count:2,
      exception_count:0,result_digest:`sha256:${"a".repeat(64)}`}),
    advance_composed:async(args)=>{
      composedCalls+=1;
      assert.equal(args.semantic_run_id,runId);
      assert.equal(args.provider_available,true);
      return{contract_version:"brand-context-composed-advance-v1",state:"queued",semantic_run_id:runId,
        prototype_run_id:"33333333-3333-4333-8333-333333333333",
        prototype_receipt_id:"44444444-4444-4444-8444-444444444444",replayed:false};
    },
    advance_preparation:async(args)=>{
      assert.equal(args.workspace_id,workspaceId);
      return[];
    },
    preparation_runtime:{semantic:{available:true,provider:"anthropic",model:"claude-sonnet-4-6",
      model_version:"fixture",pricing_version:"fixture",max_input_tokens:1,max_output_tokens:1,
      input_usd_per_million_tokens:"0",output_usd_per_million_tokens:"0",platform_hard_cap_micro_usd:0n},
      prototype:{available:true,provider:"voyage",model:"voyage-4-large",model_version:"fixture",
        pricing_version:"fixture",dimensions:1024,max_batch_items:1,max_batch_tokens:1,
        usd_per_million_tokens:"0",platform_hard_cap_micro_usd:0n},
      queue:{queue_configured:true,worker_alive:true,recovery_alive:true}} as never
  });
  assert.equal(composedCalls,1);
  assert.deepEqual(progress,[5,100]);
  assert.equal(result.status,"completed");
  assert.equal(result.brand_context_composed.state,"queued");
});

test("a retryable composed failure preserves the completed paid semantic result",async()=>{
  const runId="11111111-1111-4111-8111-111111111111";
  const result=await signalSemanticContextProposalJob({data:{contract_version:"signal-semantic-context-proposal-run-v1",run_id:runId},
    async updateProgress(){}}, {
    database:{async query(){return{rows:[],rowCount:0};},async connect(){throw new Error("process seam is injected");}} as never,
    process_run:async()=>({status:"completed",run_key:"fixture",proposal_count:1,ready_count:1,
      exception_count:0,result_digest:`sha256:${"b".repeat(64)}`}),
    advance_composed:async()=>{throw Object.assign(new Error("temporarily unavailable"),
      {code:"brand_context_prototype_runtime_unavailable"});},
    preparation_runtime:{prototype:{available:false}} as never
  });
  assert.equal(result.status,"completed");
  assert.deepEqual(result.brand_context_composed,{contract_version:"brand-context-composed-advance-v1",
    state:"blocked",semantic_run_id:runId,error_code:"brand_context_prototype_runtime_unavailable"});
});

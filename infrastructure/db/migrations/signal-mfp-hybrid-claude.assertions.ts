import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { labelerDigestV1, membershipLabelerIdentityV1, type ConceptForJudgeV1 } from "@noisia/query-engine";
import { createHybridMembershipStageStoreV1, selectHybridClaudeInputsV1 } from "../signal-hybrid-runs";
import { configureHybridMembershipRouteV1 } from "../signal-hybrid-membership";
import { hybridH1ClaudeAdmissionPopulationSqlV1 } from "../signal-hybrid-admission-population";
import { hybridMembershipDrainerSqlV1, runHybridMembershipTickV1 } from "../../../services/workers/src/workers/signal-hybrid-membership";
import { AnthropicBatchTransportError, type createAnthropicMessageBatchesClient } from "../../../services/workers/src/providers/anthropic-message-batches";

/** Migrated tables and production transport/store; only HTTP and object storage are simulated. */
export async function verifyHybridClaudeRecoveryV1(a:{client:PoolClient;database:Pool;workspace:string;
  actor:string;prep:string;context:string;route:string;jevRun:string;concept:ConceptForJudgeV1;
  admit(action:string,target:string):Promise<string>}) {
  const {client}=a, identity=membershipLabelerIdentityV1("low",true);
  for (const scenario of ["create429","missing","invalid_usage","unknown_recovery","provider_error"] as const) {
    await client.query("SAVEPOINT claude_recovery");
    const version=randomUUID(),id=randomUUID(),admission=await a.admit("concept_membership_claude",id);
    await client.query(`INSERT INTO signal_labeler_versions(id,kind,provider,model,prompt_digest,schema_digest,
      labeler_digest,identity) VALUES($1,'membership','anthropic','claude-sonnet-5-5',$2,$3,$4,$5::jsonb)`,
      [version,identity.prompt_digest,identity.schema_digest,labelerDigestV1(identity),JSON.stringify(identity)]);
    await client.query(`INSERT INTO signal_labeling_runs(id,workspace_id,kind,labeler_version_id,preparation_run_id,
      entity_context_digest,entity_context_version_no,status,estimated_micro_usd,idempotency_key,request_digest,
      actor_user_id,membership_snapshot,processing_admission_id)
      VALUES($1::uuid,$2,'membership',$3,$4,$5,1,'queued',1,$1::uuid::text,$6,$7,$8::jsonb,$9)`,
      [id,a.workspace,version,a.prep,a.context,labelerDigestV1(identity),a.actor,JSON.stringify({hybrid_stage:"claude",
        route_digest:a.route,jev_run_id:a.jevRun,concepts:[a.concept],preview:false}),admission]);
    const raw=new Map<string,string>(),store=createHybridMembershipStageStoreV1("claude",{database:a.database,
      storeRaw:async r=>{raw.set(r.call_id,r.raw_text);return r.call_id;},loadRaw:async r=>raw.get(r.storage_key)!});
    let sends=0,requests:Array<{custom_id:string}>=[];
    const batch={id:"msgbatch_synthetic",processing_status:"ended",created_at:new Date().toISOString()};
    const provider={
      create:async(items:Array<{custom_id:string}>)=>{sends++;requests=items;
        if(scenario==="create429")throw new AnthropicBatchTransportError("synthetic_429","not_submitted");
        if(scenario==="unknown_recovery")throw new AnthropicBatchTransportError("synthetic_lost_receipt","submission_unknown");
        return batch;},
      get:async()=>batch,list:async()=>({data:[batch],has_more:false,last_id:batch.id}),
      results:async function*(){
        if(scenario==="missing")return;
        for(const request of requests){
          const item={custom_id:request.custom_id,result:scenario==="provider_error"
            ? {type:"errored",error:{type:"overloaded_error",message:"synthetic"}}
            : {type:"succeeded",message:{id:"msg_synthetic",type:"message",role:"assistant",model:identity.model,
              stop_reason:"end_turn",usage:scenario==="invalid_usage"?{}:{input_tokens:10,output_tokens:10},
              content:[{type:"text",text:JSON.stringify({contract_version:"concept-membership-judge-v1",
                roots:[{root_ordinal:0,memberships:[{concept_key:a.concept.concept_key,verdict:"not_belongs",
                  span_ids:["r0c0s0"],rationale:"This context does not establish the defined condition."}]}]})}]}}};
          yield {item,rawText:JSON.stringify(item)};
        }
      },
    } as unknown as ReturnType<typeof createAnthropicMessageBatchesClient>;
    const tick=()=>runHybridMembershipTickV1({run_id:id,stage:"claude",store,jevPrice:0.042,claude:provider});
    if(scenario==="create429"||scenario==="unknown_recovery")await assert.rejects(tick(),/synthetic_/u);
    else await tick();
    if(scenario==="unknown_recovery") {
      await client.query("UPDATE signal_labeling_runs SET status='failed',error_code='labeling_outcome_unknown',next_poll_at=now() WHERE id=$1",[id]);
      assert.ok((await client.query(hybridMembershipDrainerSqlV1)).rows.some(r=>r.id===id),
        "failed Claude uncertainty is selected by the production H1 drainer");
      const waiting=(await client.query(hybridH1ClaudeAdmissionPopulationSqlV1,[a.workspace,a.route])).rows[0];
      assert.equal(waiting.pairs,0,"uncertain Claude cannot authorize another send");
      await tick();
    } else if(scenario==="create429") await tick();
    assert.equal(sends,1,"recovery never submits a second batch");
    const run=(await client.query("SELECT * FROM signal_labeling_runs WHERE id=$1",[id])).rows[0];
    assert.ok(["completed","failed"].includes(run.status),`${scenario} must be terminal`);
    const call=(await client.query("SELECT * FROM signal_labeling_calls WHERE run_id=$1",[id])).rows[0];
    assert.equal(call.results_applied,true,`${scenario} marks its terminal result applied`);
    const decisions=(await client.query("SELECT * FROM signal_hybrid_membership_decisions WHERE workspace_id=$1",[a.workspace])).rows;
    assert.equal(decisions.length,scenario==="unknown_recovery"?1:0,
      "technical errors stay out of the immutable semantic cache");
    if(scenario==="unknown_recovery") {
      assert.equal(decisions[0].verdict,"review_required");
      assert.ok(decisions[0].rationale);assert.equal(decisions[0].citation.length,1);
      assert.ok(Number(call.settled_micro_usd)>0);
    } else if(scenario==="missing"||scenario==="invalid_usage") {
      assert.equal(call.settled_micro_usd,null,"unknown usage is not reported as actual spend");
      assert.equal(call.terminal_exposure_micro_usd,call.reserved_micro_usd);
    } else {
      const successor={...run,cursor_root_id:null};
      assert.equal((await selectHybridClaudeInputsV1(client,successor)).length,1,
        "a new explicit run can recover a known transient failure under the same route");
      assert.equal((await client.query(hybridH1ClaudeAdmissionPopulationSqlV1,[a.workspace,a.route])).rows[0].pairs,1);
    }
    assert.deepEqual(await configureHybridMembershipRouteV1({database:a.database,workspace_id:a.workspace,
      actor_user_id:a.actor,route:"standard",provider_available:false,expected_route_digest:a.route}),
    {route:"standard",route_digest:null},`${scenario} does not block standard rollback`);
    console.log(JSON.stringify({gate:"h1_pg_claude_recovery",scenario,status:run.status,sends}));
    await client.query("ROLLBACK TO SAVEPOINT claude_recovery");
  }
}

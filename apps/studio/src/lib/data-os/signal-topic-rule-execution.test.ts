import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import ts from "typescript";
import * as management from "./signal-topic-rule-execution-management";
import {topicRuleExecutionRequestSchema,topicRuleExecutionPendingSchema,topicRuleExecutionSchema,
  assertTopicRuleExecutionBinding,topicRuleExecutionIsActive} from "./signal-topic-rule-execution-management";
const d=`sha256:${"4".repeat(64)}`,id="11111111-1111-4111-8111-111111111111";
const request={run_key:"run.test",candidate_key:"candidate.test",expected_candidate_revision:1,expected_candidate_state_token:d,
  expected_draft_revision:0,expected_draft_digest:null};
const pending=topicRuleExecutionPendingSchema.parse({scope:"local-scope",key:"generation:test",body:request});
const row={contract_version:"signal-topic-rule-suggestion-execution-v1",execution_id:id,workspace_id:id,...request,
  idempotency_key:pending.key,status:"pending",receipt_id:null,budget_micro_usd:1000000,cost_micro_usd:null,
  provider_calls:0,input_tokens:0,output_tokens:0,idempotent_replay:false};
test("launch never accepts caller context, budget, identity or result authority",()=>{
  for(const field of["budget_micro_usd","actor","workspace_id","origin","context","output","evidence_refs","fixture","model"])
    assert.equal(topicRuleExecutionRequestSchema.safeParse({...request,[field]:"forged"}).success,false);
  assert.equal(topicRuleExecutionRequestSchema.safeParse({...request,expected_draft_revision:1}).success,false);
});
test("generation recovery retains normalized exact bytes and binds all original CAS fields and request key",()=>{
  const bytes=JSON.stringify(pending),restored=topicRuleExecutionPendingSchema.parse(JSON.parse(bytes));
  assert.equal(JSON.stringify(restored),bytes);
  const parsed=topicRuleExecutionSchema.parse(row);assert.equal(assertTopicRuleExecutionBinding(parsed,restored,id),parsed);
  for(const field of["workspace_id","candidate_key","run_key","expected_candidate_state_token","idempotency_key"])
    assert.throws(()=>assertTopicRuleExecutionBinding({...parsed,[field]:"different"},restored,id));
  assert.throws(()=>assertTopicRuleExecutionBinding({...parsed,expected_draft_revision:1},restored,id));
});
test("unknown outcomes are terminal and never treated as active retry work",()=>{
  const parsed=topicRuleExecutionSchema.parse(row);assert.equal(topicRuleExecutionIsActive(parsed),true);
  assert.equal(topicRuleExecutionIsActive({...parsed,status:"claimed"}),true);
  for(const status of["outcome_unknown","completed","failed","definitely_not_sent"]as const)
    assert.equal(topicRuleExecutionIsActive({...parsed,status}),false);
  assert.equal(topicRuleExecutionSchema.safeParse({...row,budget_micro_usd:1000001}).success,false);
});
async function wrapper(status="pending",jobState:string|null=null,enabled=true){
  const events:string[]=[],env={NOISIA_TOPIC_RULE_SUGGESTION_ENABLED:enabled?"true":"false",NOISIA_RUNTIME_PROFILE:"uat",
    NOISIA_TOPIC_RULE_SUGGESTION_BUDGET_MICRO_USD:"1000000",NOISIA_TOPIC_RULE_SUGGESTION_WORKSPACE_ID:id,
    NOISIA_TOPIC_RULE_SUGGESTION_RUN_KEY:request.run_key,NOISIA_TOPIC_RULE_SUGGESTION_CANDIDATE_KEY:request.candidate_key};
  const source=await readFile(new URL("./signal-topic-rule-execution-product.ts",import.meta.url),"utf8"),exports:Record<string,unknown>={};
  const db={launchSignalTopicRuleSuggestionExecutionV1:async()=>{events.push("launch");return{...row,status};},
    loadSignalTopicRuleSuggestionExecutionV1:async()=>null};
  new Function("require","exports","process",ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(
    (name:string)=>{
      if(name==="@noisia/db")return db;if(name==="@/lib/db")return{pool:{}};
      if(name==="./signal-topic-rule-execution-management")return management;
      if(name==="./signal-topic-rule-draft-product")return{withTopicRuleTransaction:async(_p:unknown,_r:boolean,fn:(c:unknown)=>Promise<unknown>)=>{
        events.push("begin");const result=await fn({});events.push("commit");return result;}};
      if(name==="@/lib/queue/data-os")return{loadDataOsRuntimeReadiness:async()=>({queue_configured:true,worker_alive:true}),
        getDataOsQueue:()=>({getJob:async()=>jobState?{getState:async()=>jobState,retry:async()=>events.push("retry")} :null,
          add:async(_name:string,_data:unknown,opts:{attempts:number;jobId:string})=>{assert.equal(opts.attempts,1);assert.equal(opts.jobId,id);events.push("add");}})};
      throw new Error(`Unexpected ${name}`);
    },exports,{env});
  return{api:exports as typeof import("./signal-topic-rule-execution-product"),events,env};
}
const context={workspace:{id},actor:{id,userType:"noisia_internal"},request,idempotencyKey:pending.key};
test("queue dispatch follows commit, and explicit pending recovery retries only a failed preclaim job",async()=>{
  const fresh=await wrapper();await fresh.api.launchTopicRuleExecutionProduct(context as never);assert.deepEqual(fresh.events,["begin","launch","commit","add"]);
  const failedJob=await wrapper("pending","failed");await failedJob.api.launchTopicRuleExecutionProduct(context as never);
  assert.deepEqual(failedJob.events,["begin","launch","commit","retry"]);
  for(const status of["claimed","failed","outcome_unknown"]){const h=await wrapper(status,"failed");
    await h.api.launchTopicRuleExecutionProduct(context as never);assert.deepEqual(h.events,["begin","launch","commit"]);}
});
test("launch rejects disabled, wrong flight scope, external actor and oversized configured budget before writes",async()=>{
  for(const change of[{NOISIA_TOPIC_RULE_SUGGESTION_ENABLED:"false"},{NOISIA_RUNTIME_PROFILE:"production"},
    {NOISIA_TOPIC_RULE_SUGGESTION_WORKSPACE_ID:"another"},{NOISIA_TOPIC_RULE_SUGGESTION_RUN_KEY:"other.run"},
    {NOISIA_TOPIC_RULE_SUGGESTION_CANDIDATE_KEY:"other.candidate"},{NOISIA_TOPIC_RULE_SUGGESTION_BUDGET_MICRO_USD:"1000001"}]){
    const h=await wrapper();Object.assign(h.env,change);await assert.rejects(()=>h.api.launchTopicRuleExecutionProduct(context as never));assert.deepEqual(h.events,[]);}
  const h=await wrapper();await assert.rejects(()=>h.api.launchTopicRuleExecutionProduct({...context,actor:{id,userType:"client"}}as never));assert.deepEqual(h.events,[]);
});

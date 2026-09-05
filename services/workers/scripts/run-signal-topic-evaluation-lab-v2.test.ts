import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { signalTopicEvaluationDigestV2 } from "@noisia/query-engine";

import { SIGNAL_TOPIC_EVALUATION_LAB_EXECUTION_CONFIRMATION } from "@noisia/db";
import { signalTopicEvaluationLabBindValuesForTestV2 } from
  "./signal-topic-evaluation-lab-docker-write-pool-v2";
import { SIGNAL_TOPIC_EVALUATION_LAB_EXECUTION_CONFIRMATION_NAME,
  SIGNAL_TOPIC_EVALUATION_LAB_EXECUTION_ENABLED,SIGNAL_TOPIC_EVALUATION_LAB_IDEMPOTENCY_NAME,
  readSignalTopicEvaluationLabCredentialOnceV2,runSignalTopicEvaluationLabExecutionV2 } from
  "./run-signal-topic-evaluation-lab-v2";
import { SIGNAL_TOPIC_EVALUATION_LAB_V2_PROVIDER_CREDENTIAL_NAME } from
  "./preflight-signal-topic-evaluation-lab-v2";

const digest=(value:string)=>signalTopicEvaluationDigestV2(value);
const anchor={receipt_digest:digest("receipt"),container_id:"a".repeat(64),image_id:digest("image")};
const receipt={effects:{database_writes:0,provider_calls:0,runs:0,candidates:0},
  source_authority:{snapshot_digest:digest("snapshot")}};
const claimed={run_id:"00000000-0000-4000-8000-000000000001",
  workspace_id:"00000000-0000-4000-8000-000000000002",
  requested_by_user_id:"00000000-0000-4000-8000-000000000003",
  snapshot_id:"00000000-0000-4000-8000-000000000004",snapshot_digest:digest("snapshot"),
  execution_authorization_id:"00000000-0000-4000-8000-000000000005",
  configuration:{model:"claude-sonnet-5",input_micro_usd_per_token:3,
    output_micro_usd_per_token:15,flight_card:{contract_version:"signal-topic-evaluation-full-evidence-v2",
      execution_enabled:true,provider_calls_allowed:12,no_retry:true,action_time_confirmation_required:true,
      max_model_turns:12,max_tool_calls:24,max_tool_result_bytes:32768,
      max_total_tool_result_bytes:262144,max_total_input_tokens:450000,max_total_output_tokens:50000,
      hard_cap_micro_usd:2100000,preserve_complete_candidate_pool:true,top_view_limit:10}}} as const;

function validEnv(){return{NOISIA_RUNTIME_PROFILE:"local_disposable_lab_v1",
  [SIGNAL_TOPIC_EVALUATION_LAB_EXECUTION_ENABLED]:"true",
  [SIGNAL_TOPIC_EVALUATION_LAB_EXECUTION_CONFIRMATION_NAME]:
    SIGNAL_TOPIC_EVALUATION_LAB_EXECUTION_CONFIRMATION,
  [SIGNAL_TOPIC_EVALUATION_LAB_IDEMPOTENCY_NAME]:"lab2a.test.0001",
  [SIGNAL_TOPIC_EVALUATION_LAB_V2_PROVIDER_CREDENTIAL_NAME]:"fixture-only"};}

function dependencies(counters:{prepare:number;preflight:number;write:number;credential:number;
  provider:number}){return{
  prepare:async()=>{counters.prepare+=1;return{anchor,target:{}} as never;},
  createReadPool:()=>({}) as never,preflight:async()=>{counters.preflight+=1;return receipt as never;},
  createWritePool:()=>({query:async()=>({rows:[{ledger_count:1,authorities:0,runs:0,outboxes:0,
    candidates:0}]})}) as never,createAndClaim:async(args:Record<string,unknown>)=>{
    counters.write+=1;assert.equal("workspace_id" in args,false);assert.equal("actor" in args,false);
    return claimed as never;},readCredential:(env:NodeJS.ProcessEnv)=>{counters.credential+=1;
    return env[SIGNAL_TOPIC_EVALUATION_LAB_V2_PROVIDER_CREDENTIAL_NAME]!;},
  createModel:()=>({}) as never,process:async()=>{counters.provider+=1;return{status:"completed" as const,
    run_id:claimed.run_id,candidate_count:12,provider_call_count:2,settled_micro_usd:1000};}} as never;}

test("disabled or incomplete Lab execution fails before anchor, write, credential and provider",async()=>{
  for(const mutate of [(env:NodeJS.ProcessEnv)=>delete env[SIGNAL_TOPIC_EVALUATION_LAB_EXECUTION_ENABLED],
    (env:NodeJS.ProcessEnv)=>delete env[SIGNAL_TOPIC_EVALUATION_LAB_EXECUTION_CONFIRMATION_NAME],
    (env:NodeJS.ProcessEnv)=>delete env[SIGNAL_TOPIC_EVALUATION_LAB_IDEMPOTENCY_NAME],
    (env:NodeJS.ProcessEnv)=>delete env[SIGNAL_TOPIC_EVALUATION_LAB_V2_PROVIDER_CREDENTIAL_NAME]]){
    const env:NodeJS.ProcessEnv=validEnv();mutate(env);const counts={prepare:0,preflight:0,write:0,
      credential:0,provider:0};await assert.rejects(runSignalTopicEvaluationLabExecutionV2(env,
      dependencies(counts)));assert.deepEqual(counts,{prepare:0,preflight:0,write:0,credential:0,provider:0});
  }
});

test("one Lab execution derives authority, reads the dedicated credential once and uses no queue",async()=>{
  const counts={prepare:0,preflight:0,write:0,credential:0,provider:0};
  const result=await runSignalTopicEvaluationLabExecutionV2(validEnv(),dependencies(counts));
  assert.deepEqual(counts,{prepare:1,preflight:1,write:1,credential:1,provider:1});
  assert.equal(result.status,"completed");assert.equal(result.candidate_count,12);
  assert.equal(result.queue_used,false);assert.equal(result.outbox_used,false);
  assert.equal(result.topic_adoption,false);assert.equal(result.publication,false);
  assert.equal(result.serving,false);assert.equal(result.uat_connections,0);
});

test("fixed write binder never interpolates source syntax and supports arrays",()=>{
  const bound=signalTopicEvaluationLabBindValuesForTestV2(
    "SELECT $1::text value,$2::text[] values,$3::int count",["x'); DROP TABLE users; --",["a","b"],2]);
  assert.doesNotMatch(bound,/DROP TABLE/u);assert.match(bound,/convert_from\(decode/u);
  assert.match(bound,/ARRAY\[/u);assert.throws(()=>signalTopicEvaluationLabBindValuesForTestV2(
    "SELECT $1",["a","unused"]),/parameter_invalid/u);
});

test("dedicated Lab credential accessor reads only its one named value",()=>{
  let reads=0;const env=new Proxy({[SIGNAL_TOPIC_EVALUATION_LAB_V2_PROVIDER_CREDENTIAL_NAME]:"fixture"},
    {get(target,key,receiver){if(key===SIGNAL_TOPIC_EVALUATION_LAB_V2_PROVIDER_CREDENTIAL_NAME)reads+=1;
      return Reflect.get(target,key,receiver);}});
  assert.equal(readSignalTopicEvaluationLabCredentialOnceV2(env),"fixture");assert.equal(reads,1);
});

test("blank dedicated credential fails after pristine preflight but before durable write",async()=>{
  const counts={prepare:0,preflight:0,write:0,credential:0,provider:0};const deps=dependencies(counts) as
    unknown as Record<string,unknown>;deps.readCredential=readSignalTopicEvaluationLabCredentialOnceV2;
  await assert.rejects(runSignalTopicEvaluationLabExecutionV2({...validEnv(),
    [SIGNAL_TOPIC_EVALUATION_LAB_V2_PROVIDER_CREDENTIAL_NAME]:"   "},deps as never),
  /provider_credential_unavailable/u);assert.equal(counts.write,0);assert.equal(counts.provider,0);
});

test("Lab execution composition has no HTTP, BullMQ, UAT drainer or product credential lane",async()=>{
  const source=await readFile(new URL("./run-signal-topic-evaluation-lab-v2.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/bullmq|signal-topic-evaluation-v2-outbox|fetch\(|DATABASE_URL/iu);
  assert.match(source,/queue_used:false/u);assert.match(source,/outbox_used:false/u);
  assert.match(source,/production_accessed:false/u);
});

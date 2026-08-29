import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { zodSchema } from "ai";

import { SIGNAL_TOPIC_EVALUATION_OUTPUT_CONTRACT_VERSION } from "@noisia/query-engine";
import { createAnthropicTopicEvaluationProviderV1 } from "../providers/anthropic-bounded-text";
import { drainSignalTopicEvaluationOutboxV1 } from "./signal-topic-evaluation-outbox";

test("topic evaluation uses one bounded structured-output transport call",async()=>{
  let calls=0;let closed=false;
  const provider=createAnthropicTopicEvaluationProviderV1(async(request)=>{
    calls+=1;assert.equal(request.temperature,0);assert.equal(request.max_output_tokens,4096);
    assert.ok(request.structured_output);const schema=await zodSchema(request.structured_output.schema).jsonSchema;
    closed=(schema as {additionalProperties?:unknown}).additionalProperties===false;
    assert.deepEqual(findForbiddenSchemaKeywords(schema),[]);
    return{text:JSON.stringify({contract_version:SIGNAL_TOPIC_EVALUATION_OUTPUT_CONTRACT_VERSION,
      candidates:[{candidate_key:"candidate.one",title:"One",description:"Editable candidate",
        inclusion:["included"],exclusion:[],evidence_refs:[`sha256:${"1".repeat(64)}`],
        source_proposal_keys:["proposal.001"]}]}),provider_request_id:null,
      usage:{input_tokens:100,output_tokens:50}};
  });
  const result=await provider.generate({model:"fixture",prompt:"sanitized",max_output_tokens:4096,
    request_identity:`sha256:${"2".repeat(64)}`});
  assert.equal(calls,1);assert.equal(closed,true);assert.equal(result.usage.output_tokens,50);
});

function findForbiddenSchemaKeywords(value:unknown,path="$",found:string[]=[]):string[]{
  if(!value||typeof value!=="object")return found;
  for(const[key,child]of Object.entries(value as Record<string,unknown>)){
    if(["minimum","maximum","exclusiveMinimum","exclusiveMaximum","minLength","maxLength",
      "minItems","maxItems","pattern","format"].includes(key))found.push(`${path}.${key}`);
    findForbiddenSchemaKeywords(child,`${path}.${key}`,found);
  }return found;
}

test("topic evaluation transport has no retry or fallback in its adapter",()=>{
  const source=createAnthropicTopicEvaluationProviderV1.toString();
  assert.doesNotMatch(source,/retry|fallback|Promise\.all/u);
});

test("worker checks execution flag before constructing provider transport",async()=>{
  const source=await readFile(new URL("./signal-topic-evaluation.ts",import.meta.url),"utf8");
  const bodyStart=source.indexOf("export async function signalTopicEvaluationJob");
  assert.ok(bodyStart>=0);
  assert.ok(source.indexOf("topic_evaluation_disabled",bodyStart)
    < source.indexOf("createAnthropicTopicEvaluationProviderV1",bodyStart));
});

test("outbox dispatch is one-shot and dead-letters without retry",async()=>{
  let state="pending";let queueCalls=0;
  const database={connect:async()=>({query:async(sql:string)=>{
    if(sql.includes("WITH candidate")){
      if(state!=="pending")return{rows:[],rowCount:0};
      state="dispatched";return{rows:[{run_id:"00000000-0000-4000-8000-000000000001",
        worker_job_id:"topic-evaluation-fixture"}],rowCount:1};
    }
    if(sql.includes("status='dead_letter'"))state="dead_letter";
    return{rows:[],rowCount:0};
  },release:()=>undefined})};
  const queue={add:async(_name:string,_data:unknown,options:Record<string,unknown>)=>{
    queueCalls+=1;assert.equal(options.attempts,1);throw new Error("synthetic_transport_failure");}};
  assert.deepEqual(await drainSignalTopicEvaluationOutboxV1({database:database as never,queue,enabled:true}),
    {claimed:1,dispatched:0,dead_lettered:1});
  assert.deepEqual(await drainSignalTopicEvaluationOutboxV1({database:database as never,queue,enabled:true}),
    {claimed:0,dispatched:0,dead_lettered:0});
  assert.equal(queueCalls,1);assert.equal(state,"dead_letter");
});

test("disabled-by-default outbox never connects or dispatches",async()=>{
  let connects=0;let queueCalls=0;
  const database={connect:async()=>{connects+=1;throw new Error("must_not_connect");}};
  const queue={add:async()=>{queueCalls+=1;}};
  assert.deepEqual(await drainSignalTopicEvaluationOutboxV1({database:database as never,queue,
    enabled:false}),{claimed:0,dispatched:0,dead_lettered:0});
  assert.equal(connects,0);assert.equal(queueCalls,0);
});

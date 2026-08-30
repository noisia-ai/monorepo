import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createAnthropic } from "@ai-sdk/anthropic";
import { APICallError, LoadAPIKeyError, zodSchema } from "ai";

import { classifySignalTopicEvaluationProviderBoundaryV1,
  signalTopicEvaluationProviderOutputSchemaV1,
  SignalTopicEvaluationProviderBoundaryErrorV1,
  SIGNAL_TOPIC_EVALUATION_OUTPUT_CONTRACT_VERSION } from "@noisia/query-engine";
import { createAnthropicTopicEvaluationProviderV1, generateAnthropicBoundedTextV1,
  sanitizeSignalTopicEvaluationJobErrorV1 } from
  "../providers/anthropic-bounded-text";
import { drainSignalTopicEvaluationOutboxV1 } from "./signal-topic-evaluation-outbox";

test("topic evaluation uses one bounded structured-output transport call",async()=>{
  let calls=0;let closed=false;
  const provider=createAnthropicTopicEvaluationProviderV1(async(request)=>{
    calls+=1;assert.equal("temperature" in request,false);
    assert.equal("top_p" in request,false);assert.equal("top_k" in request,false);
    assert.equal(request.max_output_tokens,4096);
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

test("Sonnet 5 serialized request omits all sampling parameters",async()=>{
  let serialized:Record<string,unknown>|null=null;let fetchCalls=0;
  const fixtureAnthropic=createAnthropic({apiKey:"fixture-not-secret",fetch:async(_input,init)=>{
    fetchCalls+=1;serialized=JSON.parse(String(init?.body)) as Record<string,unknown>;
    return new Response(JSON.stringify({type:"error",error:{type:"invalid_request_error",
      message:"synthetic configuration rejection"}}),{status:400,
      headers:{"content-type":"application/json"}});
  }});
  await assert.rejects(generateAnthropicBoundedTextV1({model:"claude-sonnet-5",
    prompt:"sanitized",max_output_tokens:4096,structured_output:{
      schema:signalTopicEvaluationProviderOutputSchemaV1,
      name:"signal_topic_evaluation_candidates",description:"fixture"}},fixtureAnthropic),
  (error)=>APICallError.isInstance(error)&&error.statusCode===400);
  assert.equal(fetchCalls,1);assert.ok(serialized);
  assert.equal("temperature" in serialized!,false);
  assert.equal("top_p" in serialized!,false);assert.equal("top_k" in serialized!,false);
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

test("known invalid structured output preserves safe response metadata before normalization",async()=>{
  const provider=createAnthropicTopicEvaluationProviderV1(async()=>({
    text:"{not-valid-json",provider_request_id:"safe-request-id",
    usage:{input_tokens:321,output_tokens:45}
  }));
  const result=await provider.generate({model:"fixture",prompt:"sanitized",max_output_tokens:4096,
    request_identity:`sha256:${"4".repeat(64)}`});
  assert.equal(result.text,"{not-valid-json");
  assert.equal(result.provider_request_id,"safe-request-id");
  assert.deepEqual(result.usage,{input_tokens:321,output_tokens:45});
});

test("fake provider SDK failures retain closed boundary classes without retry",async()=>{
  let definitelyCalls=0;
  const definitely=createAnthropicTopicEvaluationProviderV1(async()=>{
    definitelyCalls+=1;
    throw new SignalTopicEvaluationProviderBoundaryErrorV1(
      "definitely_not_sent","synthetic_sdk_preflight_rejected");
  });
  await assert.rejects(definitely.generate({model:"fixture",prompt:"sanitized",max_output_tokens:4096,
    request_identity:`sha256:${"5".repeat(64)}`}),
  (error)=>classifySignalTopicEvaluationProviderBoundaryV1(error).outcome_class==="definitely_not_sent");
  assert.equal(definitelyCalls,1);

  let ambiguousCalls=0;
  const ambiguous=createAnthropicTopicEvaluationProviderV1(async()=>{
    ambiguousCalls+=1;throw new Error("synthetic_connection_closed_after_dispatch");
  });
  await assert.rejects(ambiguous.generate({model:"fixture",prompt:"sanitized",max_output_tokens:4096,
    request_identity:`sha256:${"6".repeat(64)}`}),
  (error)=>classifySignalTopicEvaluationProviderBoundaryV1(error).outcome_class==="ambiguous_after_send");
  assert.equal(ambiguousCalls,1);
});

test("only local pre-transport SDK failures use the definitely-not-sent boundary",async()=>{
  let calls=0;
  const provider=createAnthropicTopicEvaluationProviderV1(async()=>{calls+=1;
    throw new LoadAPIKeyError({message:"synthetic missing credential"});});
  await assert.rejects(provider.generate({model:"claude-sonnet-5",prompt:"private prompt",
    max_output_tokens:4096,request_identity:`sha256:${"7".repeat(64)}`}),error=>{
    assert.ok(error instanceof SignalTopicEvaluationProviderBoundaryErrorV1);
    assert.equal(error.outcome_class,"definitely_not_sent");
    assert.equal(error.safe_code,"topic_evaluation_provider_request_rejected");
    assert.doesNotMatch(error.message,/private|credential/u);
    return true;
  });
  assert.equal(calls,1);
});

test("provider 4xx, network and after-send failures remain ambiguous and never retry",async()=>{
  const failures=[
    new APICallError({message:"synthetic rejected request",url:"https://provider.invalid",
      requestBodyValues:{private:"must-not-surface"},statusCode:400,isRetryable:false,
      responseBody:"private provider body"}),
    new APICallError({message:"synthetic network failure",url:"https://provider.invalid",
      requestBodyValues:{},cause:Object.assign(new Error("connection refused"),{code:"ECONNREFUSED"})}),
    new APICallError({message:"synthetic retryable rejection",url:"https://provider.invalid",
      requestBodyValues:{},statusCode:429,isRetryable:true}),
    new Error("synthetic connection reset after send")
  ];
  for(const failure of failures){
    let calls=0;
    const provider=createAnthropicTopicEvaluationProviderV1(async()=>{calls+=1;throw failure;});
    await assert.rejects(provider.generate({model:"claude-sonnet-5",prompt:"sanitized",
      max_output_tokens:4096,request_identity:`sha256:${"8".repeat(64)}`}),error=>{
      assert.equal(classifySignalTopicEvaluationProviderBoundaryV1(error).outcome_class,
        "ambiguous_after_send");return true;
    });
    assert.equal(calls,1);
  }
});

test("worker failure exposes only the durable domain code",()=>{
  const raw=Object.assign(new Error("private provider response and prompt"),{
    code:"topic_evaluation_provider_definitely_not_sent",responseBody:"private body",
    requestBodyValues:{prompt:"private prompt"}});
  const safe=sanitizeSignalTopicEvaluationJobErrorV1(raw);
  assert.equal(safe.name,"SignalTopicEvaluationJobError");
  assert.equal(safe.message,"topic_evaluation_provider_definitely_not_sent");
  assert.deepEqual(Object.keys(safe),["name"]);
  assert.doesNotMatch(String(safe.stack),/private provider response|private prompt|private body/u);
  const untrusted=sanitizeSignalTopicEvaluationJobErrorV1(Object.assign(
    new Error("private provider response"),{code:"provider_private_error"}));
  assert.equal(untrusted.message,"topic_evaluation_job_failed");
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

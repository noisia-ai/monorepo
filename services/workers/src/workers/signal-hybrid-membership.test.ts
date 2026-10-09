import assert from "node:assert/strict";
import test from "node:test";
import { buildHybridJevQuestionV1, type ConceptForJudgeV1,
  type MembershipInputV1 } from "@noisia/query-engine";
import type { LabelingRunV1 } from "@noisia/db";
import { JevProviderErrorV1 } from "../providers/typesafe-jev";
import { hybridReceiptFilenameV1, hybridJevCallProposalV1, runHybridMembershipTickV1 } from "./signal-hybrid-membership";

const concept={concept_key:"theme",label:"Theme",scope:"all_conversations",definition:"Explicit theme",
  inclusion:[],exclusion:[],positive_examples:[],negative_examples:[],definition_digest:"sha256:"+"a".repeat(64)} as unknown as ConceptForJudgeV1;
const input={root_id:"00000000-0000-4000-8000-000000000001",input_digest:"sha256:"+"b".repeat(64),
  root_fingerprint:"sha256:"+"c".repeat(64),entity_context_digest:"sha256:"+"d".repeat(64),
  effective_entities_digest:"sha256:"+"e".repeat(64),text:"Theme is explicitly present",title:null,platform:"web",
  content_type:null,author:null,published_at:"2026-10-07T00:00:00Z",language:"en",entities:[],voice:null,act:null,
  evaluated_concepts:[concept]} as MembershipInputV1;
const run={id:"00000000-0000-4000-8000-000000000002",workspace_id:"00000000-0000-4000-8000-000000000003",
  context:{},lease_token:"00000000-0000-4000-8000-000000000004"} as unknown as LabelingRunV1;

function fixture(outcome:"ok"|"unknown"|"storage_failed"|429|529) {
  const events:string[]=[],calls:Record<string,unknown>[]=[];
  const store={
    claim:async()=>run,calls:async()=>calls,inputs:async()=>[input],
    reserve:async(_run:unknown,proposals:Record<string,unknown>[])=>{
      events.push("reserve");calls.push({...proposals[0],id:"00000000-0000-4000-8000-000000000005",status:"reserved",
        raw_body:null,results_applied:false});return calls;},
    renew:async()=>events.push("renew"),markSubmitting:async()=>events.push("submitting"),
    markFailed:async(_run:unknown,_calls:unknown,unknown:boolean)=>events.push(`failed:${unknown}`),
    fail:async()=>events.push("run_failed"),
    persistRaw:async()=>{events.push("raw");if(outcome==="storage_failed")throw new Error("storage_rejected");},
    settle:async(_run:unknown,_call:unknown,receipt:{settled_micro_usd:number})=>{
      if(typeof outcome==="number")assert.equal(receipt.settled_micro_usd,0);events.push("settle");},
    apply:async()=>events.push("apply"),finish:async()=>({status:"completed"}),release:async()=>events.push("release"),
  };
  const provider={evaluate:async(request:ReturnType<typeof buildHybridJevQuestionV1>)=>{
    events.push("provider");
    if (outcome==="unknown") throw new JevProviderErrorV1("network_unknown","outcome_unknown");
    if(typeof outcome==="number")return {http_status:outcome,latency_ms:1,body:JSON.stringify({error:"temporarily_unavailable"})};
    assert.equal(request.questions.membership?.type,"noul");
    return {http_status:200,latency_ms:1,body:JSON.stringify({model:"jev-1.13.0",
      usage:{input_tokens:10,output_tokens:0},answers:{membership:{type:"noul",noul:0.8}}})};
  }};
  return {events,store:store as never,provider:provider as never};
}

test("H1 JEV stage reserves in the shared store before one provider call and settles after raw",async()=>{
  const f=fixture("ok");
  const proposal=hybridJevCallProposalV1(run,input,concept,0.5);
  assert.equal(proposal.inputs.length,1);
  assert.ok(proposal.reserved_micro_usd>0);
  await runHybridMembershipTickV1({run_id:run.id,stage:"jev",store:f.store,jevPrice:0.5,jev:f.provider});
  assert.deepEqual(f.events,["reserve","renew","submitting","provider","raw","settle","apply","release"]);
});
test("H1 unknown JEV send is never settled or applied",async()=>{
  const f=fixture("unknown");
  await assert.rejects(runHybridMembershipTickV1({run_id:run.id,stage:"jev",store:f.store,jevPrice:0.5,jev:f.provider}),
    /network_unknown/u);
  assert.deepEqual(f.events,["reserve","renew","submitting","provider","failed:true","run_failed","release"]);
});
test("H1 receipt filename starts with a letter even when the call UUID starts with a digit",()=>{
  assert.equal(hybridReceiptFilenameV1("00000000-0000-4000-8000-000000000005"),
    "hybrid-00000000-0000-4000-8000-000000000005.json");
});
test("H1 quarantines a returned provider response when durable raw storage fails",async()=>{
  const f=fixture("storage_failed");
  await assert.rejects(runHybridMembershipTickV1({run_id:run.id,stage:"jev",store:f.store,jevPrice:0.5,jev:f.provider}),
    /storage_rejected/u);
  assert.deepEqual(f.events,["reserve","renew","submitting","provider","raw","failed:true","run_failed","release"]);
});

for(const status of [429,529] as const)test(`H1 HTTP ${status} retains raw and zero observed cost without charging reserve`,async()=>{
  const f=fixture(status);
  await runHybridMembershipTickV1({run_id:run.id,stage:"jev",store:f.store,jevPrice:0.5,jev:f.provider});
  assert.deepEqual(f.events,["reserve","renew","submitting","provider","raw","settle","apply","run_failed","release"]);
});

import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {buildSignalTopicEditorialScreeningPlanV1,signalTopicEditorialDigestV1 as digest,
  type SignalTopicEditorialScreeningGroupV1,type SignalTopicEditorialScreeningOutputV1} from "./signal-topic-consolidation-editorial-v1";
import {buildSignalTopicEditorialRepairRequestV1} from "./signal-topic-consolidation-editorial-repair-v1";
import {buildSignalTopicEditorialScreeningPlanV2} from "./signal-topic-consolidation-editorial-v2";
import {reuseSignalTopicEditorialPaidGroupV2,type SignalTopicEditorialPaidSourceCallV2} from "./signal-topic-editorial-paid-reuse-v2";

const rawSha=(text:string)=>`sha256:${createHash("sha256").update(text).digest("hex")}`;
const id=(i:number)=>`00000000-0000-4000-8000-${String(i).padStart(12,"0")}`;
const context={brand_name:"Alexa+",default_locale:"es-MX",summary:"Asistente doméstico con IA.",audiences:["hogares"],categories:["asistente"],
  competitors:[],positive_anchors:["rutinas"],negative_anchors:[],abstention_anchors:[]};
function group(i:number):SignalTopicEditorialScreeningGroupV1 {
  const text=`Uso Alexa para rutinas de casa ${i} 🏡`,root_id=id(i+1),chunk_sha256=rawSha(text),start=0,end=text.length;
  const evidence=[{ref_id:digest({root_id,chunk_index:0,start,end,chunk_sha256}),root_id,chunk_index:0,start,end,chunk_sha256,text,
    locale:"es-MX",platform:"reddit",occurred_at:null}];
  const scope_counts={brand:1,competitor:0,category:0,unknown:0},locale_counts=[{key:"es-MX",count:1}],platform_counts=[{key:"reddit",count:1}],
    month_counts:never[]=[],brand_affinity={positive:[],negative:[],abstention:[]},neighbors:never[]=[],metrics={cohesion:0.75,outlier_ratio:0.1};
  const dossier={contract_version:"signal-topic-group-dossier-v1",scope_counts,locale_counts,platform_counts,month_counts,
    brand_affinity,neighbors,metrics,evidence:evidence.map(({text:_text,...item})=>item)};
  return {group_key:`open:group-${String(i).padStart(4,"0")}`,lane:"open",community_key:"community-1",group_digest:digest(["group",i]),
    source_dossier_digest:digest(dossier),dossier_digest:digest(dossier),root_count:1,chunk_count:1,terms:["rutinas"],scope_counts,
    locale_counts,platform_counts,month_counts,brand_affinity,neighbors,metrics,evidence};
}
function fixture(secondBatch=false){
  const groups=Array.from({length:secondBatch?11:2},(_,i)=>group(i));
  const args={context,groups,expected_group_count:groups.length,source_context_digest:digest("source-context"),editorial_context_digest:digest(context)};
  const plan=buildSignalTopicEditorialScreeningPlanV1({...args,batch_size:10}),source_batch=plan.batches[secondBatch?1:0]!;
  const request=buildSignalTopicEditorialScreeningPlanV2({...args,workspace_id:id(800),run_id:id(801)}).requests[secondBatch?10:0]!;
  const output:SignalTopicEditorialScreeningOutputV1={contract_version:"signal-topic-editorial-screening-output-v1",batch_index:source_batch.batch_index,
    decisions:source_batch.group_receipts.map((receipt,index)=>({group_key:receipt.group_key,disposition:"topic",candidate:{
      candidate_key:`b${String(source_batch.batch_index).padStart(4,"0")}-rutinas-${index}`,label:"Rutinas domésticas",definition:"Automatización con Alexa+.",locale:"es-MX"},
      confidence:0.87,rationale:"Rutinas respaldadas por la evidencia.",cited_ref_ids:[receipt.evidence_ref_ids[0]!]}))};
  const response_body_private=JSON.stringify({id:"msg_original",type:"message",role:"assistant",model:source_batch.model,stop_reason:"end_turn",
    content:[{type:"text",text:JSON.stringify(output)}],usage:{input_tokens:500,output_tokens:700}});
  const source_call:SignalTopicEditorialPaidSourceCallV2={call_id:id(900),execution_id:id(901),workspace_id:id(800),run_id:id(801),status:"settled",
    response_http_status:200,response_complete:true,response_body_private,response_sha256:rawSha(response_body_private),response_output:output,
    request:{contract_version:"signal-topic-editorial-provider-request-v1",phase:"screening",idempotency_key:source_batch.batch_key,
      model:source_batch.model,request_digest:source_batch.request_digest,request_body:source_batch.request_body}};
  return {request,source_batch,source_call,source:{kind:"raw_response" as const},plan,output};
}
function withOutput(base:ReturnType<typeof fixture>,output:unknown){
  const raw=JSON.parse(base.source_call.response_body_private);raw.content[0].text=JSON.stringify(output);
  const response_body_private=JSON.stringify(raw);
  return {...base,source_call:{...base.source_call,response_output:output,response_body_private,response_sha256:rawSha(response_body_private)}};
}
function checkpoint(base:ReturnType<typeof fixture>){
  const state={contract_version:"signal-topic-editorial-runner-v1",execution_key:base.source_call.execution_id,plan_digest:base.plan.plan_digest,
    phase:"screening",screening_outputs:[base.output],global:null};
  return {kind:"historical_checkpoint" as const,state_body:JSON.stringify(state),state_digest:digest(state),source_plan_digest:base.plan.plan_digest};
}

test("paid V1 decisions reuse without a new provider response, call or charge",()=>{
  const base=fixture(),before=JSON.stringify(base),result=reuseSignalTopicEditorialPaidGroupV2(base);
  assert.equal(result.status,"reusable");if(result.status!=="reusable")return;
  assert.equal(result.decision.group_key,base.request.receipt.group_key);
  assert.equal(result.decision.rationale,base.output.decisions[0]!.rationale);
  assert.equal(result.decision.evidence_scope,"cited_evidence_only");
  assert.deepEqual(result.decision.cited_ref_ids,base.output.decisions[0]!.cited_ref_ids);
  assert.equal(result.lineage.source_call_id,base.source_call.call_id);
  assert.equal(result.lineage.source_request_digest,base.source_batch.request_digest);
  assert.equal(result.lineage.source_raw_sha256,base.source_call.response_sha256);
  assert.equal(result.lineage.source_checkpoint_digest,null);
  assert.equal(rawSha(result.source_decision_body),result.lineage.source_decision_digest);
  assert.deepEqual(JSON.parse(result.source_decision_body),base.output.decisions[0]);
  assert.equal("provider_request" in result,false);assert.equal("cost_micro_usd" in result,false);
  assert.equal(JSON.stringify(base),before);
});

test("reuse validates historical ordinals and an existing paid repair's original request binding",()=>{
  const base=fixture(true);
  assert.equal(base.source_batch.batch_index,1);
  assert.equal(reuseSignalTopicEditorialPaidGroupV2(base).status,"reusable");
  const repair=buildSignalTopicEditorialRepairRequestV1({original:base.source_call.request,response:base.output,error_code:"topic_editorial_output_invalid"});
  const result=reuseSignalTopicEditorialPaidGroupV2({...base,source_call:{...base.source_call,request:repair}});
  assert.equal(result.status,"reusable");if(result.status!=="reusable")return;
  assert.equal(result.lineage.source_request_digest,repair.request_digest);
  assert.equal(result.lineage.source_batch_request_digest,base.source_batch.request_digest);
  assert.notEqual(result.lineage.source_request_digest,result.lineage.source_batch_request_digest);
});

test("reuse preserves paid long prose, Unicode and float confidence without old byte limits",()=>{
  const base=fixture(),output=structuredClone(base.output),decision=output.decisions[0]!;
  decision.rationale="á".repeat(329)+"x";
  decision.candidate!.label="Rutinas extensas 🏡 ".repeat(20);
  decision.candidate!.definition="  Contexto íntegro\n"+"Conserva este texto completo. ".repeat(1000);
  const result=reuseSignalTopicEditorialPaidGroupV2(withOutput(base,output));
  assert.equal(result.status,"reusable");if(result.status!=="reusable")return;
  assert.equal(Buffer.byteLength(result.decision.rationale),659);
  assert.equal(result.decision.candidate!.label,decision.candidate!.label);
  assert.equal(result.decision.candidate!.definition,decision.candidate!.definition);
  assert.equal(result.decision.confidence,0.87);
});

test("changed identity, context, group and paid hashes cannot be reused",()=>{
  const base=fixture();
  for(const source_call of [
    {...base.source_call,workspace_id:id(802)}, {...base.source_call,run_id:id(802)},
    {...base.source_call,response_sha256:rawSha("wrong")}, {...base.source_call,status:"in_flight"},
    {...base.source_call,response_complete:false}, {...base.source_call,response_http_status:500},
    {...base.source_call,request:{...base.source_call.request,request_digest:digest("wrong")}},
  ])assert.equal(reuseSignalTopicEditorialPaidGroupV2({...base,source_call}).status,"needs_review");
  assert.deepEqual(reuseSignalTopicEditorialPaidGroupV2({...base,source_batch:{...base.source_batch,source_context_digest:digest("changed")}}),
    {status:"needs_review",reason:"source_context_changed"});
  const target=buildSignalTopicEditorialScreeningPlanV2({workspace_id:id(800),run_id:id(801),expected_group_count:1,
    context,editorial_context_digest:digest(context),source_context_digest:base.request.identity.source_context_digest,
    groups:[{...base.request.source_group,group_digest:digest("changed-group")}]}).requests[0]!;
  assert.deepEqual(reuseSignalTopicEditorialPaidGroupV2({...base,request:target}),{status:"needs_review",reason:"source_group_changed"});
  const changed=structuredClone(base.source_batch);changed.group_receipts[0]!.evidence_ref_ids=[digest("wrong")];
  assert.equal(reuseSignalTopicEditorialPaidGroupV2({...base,source_batch:changed}).status,"needs_review");
});

test("unsupported evidence, duplicate/missing coverage, null prose and synthetic uncertainty need review",()=>{
  const base=fixture();
  const variants:SignalTopicEditorialScreeningOutputV1[]=[
    {...base.output,decisions:[base.output.decisions[0]!,base.output.decisions[0]!]},
    {...base.output,decisions:[base.output.decisions[0]!]},
    {...base.output,decisions:base.output.decisions.map((item,i)=>i?item:{...item,cited_ref_ids:[digest("foreign")]})},
    {...base.output,decisions:base.output.decisions.map((item,i)=>i?item:{...item,cited_ref_ids:[...item.cited_ref_ids,...item.cited_ref_ids]})},
    {...base.output,decisions:base.output.decisions.map((item,i)=>i?item:{...item,rationale:null})},
    {...base.output,decisions:base.output.decisions.map((item,i)=>i?item:{...item,disposition:"noise",candidate:null,cited_ref_ids:[]})},
    {...base.output,decisions:base.output.decisions.map((item,i)=>i?item:{...item,disposition:"unresolved",candidate:null,cited_ref_ids:[]})},
  ];
  for(const output of variants)assert.equal(reuseSignalTopicEditorialPaidGroupV2(withOutput(base,output)).status,"needs_review");
  assert.deepEqual(reuseSignalTopicEditorialPaidGroupV2({...base,source_call:{...base.source_call,response_output:{different:true}}}),
    {status:"needs_review",reason:"source_output_mismatch"});
});

test("historical checkpoint mode has distinct lineage and does not claim transformed output equals raw",()=>{
  const base=fixture(),source=checkpoint(base),raw=JSON.parse(base.source_call.response_body_private);
  raw.stop_reason="max_tokens";raw.content[0].text='{"decisions":[';
  const response_body_private=JSON.stringify(raw),source_call={...base.source_call,response_body_private,
    response_sha256:rawSha(response_body_private),response_output:null};
  assert.deepEqual(reuseSignalTopicEditorialPaidGroupV2({...base,source_call}),{status:"needs_review",reason:"source_raw_incomplete"});
  const result=reuseSignalTopicEditorialPaidGroupV2({...base,source_call,source});
  assert.equal(result.status,"reusable");if(result.status!=="reusable")return;
  assert.equal(result.lineage.source_kind,"historical_checkpoint");
  assert.equal(result.lineage.source_checkpoint_digest,source.state_digest);
  assert.equal(result.lineage.source_raw_sha256,source_call.response_sha256);
  assert.equal(result.decision.rationale,base.output.decisions[0]!.rationale);
});

test("missing or mismatched accepted checkpoints cannot manufacture a reusable later batch",()=>{
  const base=fixture(true),source=checkpoint(base);
  assert.deepEqual(reuseSignalTopicEditorialPaidGroupV2({...base,source:{...source,state_digest:digest("wrong")}}),
    {status:"needs_review",reason:"source_checkpoint_invalid"});
  const state=JSON.parse(source.state_body);state.screening_outputs=[];
  assert.deepEqual(reuseSignalTopicEditorialPaidGroupV2({...base,source:{...source,state_body:JSON.stringify(state),state_digest:digest(state)}}),
    {status:"needs_review",reason:"source_checkpoint_missing_batch"});
  const foreign=JSON.parse(source.state_body);foreign.execution_key=id(999);
  assert.deepEqual(reuseSignalTopicEditorialPaidGroupV2({...base,source:{...source,state_body:JSON.stringify(foreign),state_digest:digest(foreign)}}),
    {status:"needs_review",reason:"source_checkpoint_invalid"});
});

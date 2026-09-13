import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {buildSignalTopicEditorialScreeningPlanV1,signalTopicEditorialDigestV1,
  buildSignalTopicEditorialGlobalReviewV1,validateSignalTopicEditorialGlobalResultV1,
  validateSignalTopicEditorialScreeningCoverageV1,validateSignalTopicEditorialScreeningOutputV1,
  preflightSignalTopicEditorialCapacityV1,
  SIGNAL_TOPIC_EDITORIAL_GLOBAL_SCHEMA_V1,SIGNAL_TOPIC_EDITORIAL_SCREENING_SCHEMA_V1} from "./signal-topic-consolidation-editorial-v1";

const sha=(value:unknown)=>signalTopicEditorialDigestV1(value);
const textSha=(value:string)=>`sha256:${createHash("sha256").update(value).digest("hex")}`;
const id=(index:number)=>`00000000-0000-4000-8000-${String(index).padStart(12,"0")}`;
const group=(index:number)=>{const text=`Alexa evidence ${index}`,chunk_sha256=textSha(text),root_id=id(index+1),start=0,end=text.length,
  evidence=[{ref_id:sha({root_id,chunk_index:0,start,end,chunk_sha256}),root_id,chunk_index:0,start,end,chunk_sha256,text,
    locale:"es-MX",platform:"reddit",occurred_at:"2026-09-12T00:00:00.000Z"}],scope_counts={brand:1,competitor:0,category:0,unknown:0},
  locale_counts=[{key:"es-MX",count:1}],platform_counts=[{key:"reddit",count:1}],month_counts=[{key:"2026-09",count:1}],
  brand_affinity={positive:[],negative:[],abstention:[]},neighbors:never[]=[],metrics={cohesion:null,outlier_ratio:null},
  dossier={contract_version:"signal-topic-group-dossier-v1",scope_counts,locale_counts,platform_counts,month_counts,brand_affinity,neighbors,metrics,
    evidence:evidence.map(({text:_text,...item})=>item)};
  return {group_key:`open:cluster-${String(index).padStart(4,"0")}`,lane:"open" as const,group_digest:sha(["group",index]),
    source_dossier_digest:sha(dossier),dossier_digest:sha(dossier),community_key:`community-${Math.floor(index/8)}`,root_count:1,chunk_count:1,
    terms:[`term-${index}`],scope_counts,locale_counts,platform_counts,month_counts,brand_affinity,neighbors,metrics,evidence};};
const context={brand_name:"Alexa+",default_locale:"es-MX",summary:"Asistente de voz con IA generativa.",audiences:["hogares"],
  categories:["asistentes de voz"],competitors:["Google Assistant"],positive_anchors:["rutinas"],negative_anchors:["Alexandra"],abstention_anchors:["ruido"]};
const planFor=(groups:ReturnType<typeof group>[],batch_size?:number)=>buildSignalTopicEditorialScreeningPlanV1({
  expected_group_count:groups.length,source_context_digest:sha("source-context"),editorial_context_digest:sha(context),context,groups,batch_size});

function assertAnthropicStructuralSchema(schema:unknown){
  const forbidden=new Set(["maxItems","minItems","maxLength","minLength","minimum","maximum"]);
  const visit=(value:unknown):void=>{
    if(Array.isArray(value)){value.forEach(visit);return;}
    if(value===null||typeof value!=="object")return;
    for(const [key,item] of Object.entries(value)){
      assert.equal(forbidden.has(key),false,`unsupported provider schema keyword: ${key}`);visit(item);
    }
  };visit(schema);
}

test("plans every one of 1,652 groups exactly once in bounded Sonnet batches",()=>{
  const groups=Array.from({length:1_652},(_,index)=>group(index));
  const plan=planFor(groups);
  const capacity=preflightSignalTopicEditorialCapacityV1({plan,groups});
  assert.equal(plan.model,"claude-sonnet-4-6");assert.equal(plan.batches.length,42);
  assert.equal(plan.batches.flatMap(batch=>batch.group_keys).length,1_652);
  assert.equal(new Set(plan.batches.flatMap(batch=>batch.group_keys)).size,1_652);
  assert.ok(plan.batches.every(batch=>batch.group_keys.length<=40&&Buffer.byteLength(batch.request_body)<1_500_000));
  assert.ok(plan.batches[0]?.request_body.includes("información no confiable"));
  const providerBody=JSON.parse(plan.batches[0]!.request_body) as {max_tokens:number;output_config:{format:{schema:unknown}}};
  assert.equal(providerBody.max_tokens,8_192);
  assert.deepEqual(providerBody.output_config.format.schema,SIGNAL_TOPIC_EDITORIAL_SCREENING_SCHEMA_V1);
  assertAnthropicStructuralSchema(providerBody.output_config.format.schema);
  assert.equal(plan.source_context_digest,sha("source-context"));assert.equal(plan.editorial_context_digest,sha(context));
  assert.equal(capacity.group_count,1_652);assert.equal(capacity.screening_request_count,42);
  assert.ok(capacity.estimated_screening_input_tokens.every(tokens=>tokens<=900_000));
  assert.ok(capacity.estimated_global_input_tokens<=900_000);
  assert.equal(capacity.maximum_reserved_micro_usd,
    capacity.screening_request_bytes.reduce((sum,bytes)=>sum+bytes*3+8_192*15,0)+capacity.global_request_bytes*3+32_768*15);
  assert.ok(capacity.maximum_reserved_micro_usd<=30_000_000,JSON.stringify(capacity));
  const byKey=new Map(groups.map(item=>[item.group_key,item]));
  const outputs=plan.batches.map(batch=>validateSignalTopicEditorialScreeningOutputV1(batch,{
    contract_version:"signal-topic-editorial-screening-output-v1",batch_index:batch.batch_index,decisions:batch.group_keys.map((group_key,index)=>({
      group_key,disposition:"topic",candidate:{candidate_key:`b${String(batch.batch_index).padStart(4,"0")}-candidate-${index}`,
        label:`Tema ${index}`,definition:"Tema verificable de Alexa+.",locale:"es-MX"},confidence:0.8,rationale:null,
      cited_ref_ids:[byKey.get(group_key)!.evidence[0]!.ref_id]}))}));
  const screening=validateSignalTopicEditorialScreeningCoverageV1(plan,outputs),review=buildSignalTopicEditorialGlobalReviewV1({plan,screening,groups});
  assert.equal(review.eligible_group_receipts.length,1_652);
  assert.ok(Buffer.byteLength(review.request_body,"utf8")<4_000_000);
});

test("screening validates evidence citations, dispositions and exact batch coverage",()=>{
  const groups=[group(0),group(1)],plan=planFor(groups,10);
  const batch=plan.batches[0]!;
  const output=validateSignalTopicEditorialScreeningOutputV1(batch,{contract_version:"signal-topic-editorial-screening-output-v1",batch_index:0,decisions:[
    {group_key:groups[1]!.group_key,disposition:"noise",candidate:null,confidence:0.9,rationale:"No trata sobre Alexa+.",cited_ref_ids:[]},
    {group_key:groups[0]!.group_key,disposition:"topic",candidate:{candidate_key:"b0000-voice-routines",label:"Rutinas de voz",definition:"Experiencias con rutinas de Alexa+.",locale:"es-MX"},confidence:0.8,rationale:null,cited_ref_ids:[groups[0]!.evidence[0]!.ref_id]},
  ]});
  const result=validateSignalTopicEditorialScreeningCoverageV1(plan,[output]);
  assert.deepEqual({groups:result.group_count,topics:result.topic_count,noise:result.noise_count},{groups:2,topics:1,noise:1});
  assert.throws(()=>validateSignalTopicEditorialScreeningOutputV1(batch,{...output,decisions:[output.decisions[0],output.decisions[0]]}),/coverage_invalid/);
  assert.throws(()=>validateSignalTopicEditorialScreeningOutputV1(batch,{...output,decisions:output.decisions.map((item,index)=>index?{...item,cited_ref_ids:[sha("foreign")]}:item)}),/citation_invalid/);
  assert.throws(()=>validateSignalTopicEditorialScreeningOutputV1(batch,{...output,decisions:output.decisions.map((item,index)=>!index?{...item,candidate:{...item.candidate!,locale:"en-US"}}:item)}),/locale_invalid/);
  assert.throws(()=>validateSignalTopicEditorialScreeningOutputV1({...batch,
    configuration:{...batch.configuration,max_output_tokens:batch.configuration.max_output_tokens+1} as never},output),/request_invalid/);
  assert.throws(()=>validateSignalTopicEditorialScreeningOutputV1({...batch,group_receipts:batch.group_receipts.map((item,index)=>index?item:{...item,
    expected_locale:"en-US"})},output),/request_invalid/);
});

test("screening keeps private rationale useful and bounded",()=>{
  const groups=[group(0)],plan=planFor(groups,10),batch=plan.batches[0]!;
  const decision={group_key:groups[0]!.group_key,disposition:"noise" as const,candidate:null,confidence:0.9,
    rationale:"x".repeat(340),cited_ref_ids:[]};
  assert.equal(validateSignalTopicEditorialScreeningOutputV1(batch,{contract_version:"signal-topic-editorial-screening-output-v1",
    batch_index:0,decisions:[decision]}).decisions[0]!.rationale?.length,340);
  assert.throws(()=>validateSignalTopicEditorialScreeningOutputV1(batch,{contract_version:"signal-topic-editorial-screening-output-v1",
    batch_index:0,decisions:[{...decision,rationale:"x".repeat(513)}]}),/output_invalid/u);
});

test("fails closed before planning duplicate, incomplete or over-capacity group sets",()=>{
  const one=group(0);
  const base={source_context_digest:sha("source-context"),editorial_context_digest:sha(context),context};
  assert.throws(()=>buildSignalTopicEditorialScreeningPlanV1({...base,expected_group_count:2,groups:[one]}),/incomplete/);
  assert.throws(()=>buildSignalTopicEditorialScreeningPlanV1({...base,expected_group_count:2,groups:[one,one]}),/plan_invalid/);
  assert.throws(()=>buildSignalTopicEditorialScreeningPlanV1({...base,expected_group_count:5_001,groups:[]}),/plan_invalid/);
  assert.throws(()=>buildSignalTopicEditorialScreeningPlanV1({...base,expected_group_count:1,editorial_context_digest:sha("stale"),groups:[one]}),/context_digest_invalid/);
  assert.throws(()=>buildSignalTopicEditorialScreeningPlanV1({...base,expected_group_count:1,groups:[{...one,
    evidence:one.evidence.map(item=>({...item,text:"altered evidence"}))}]}),/evidence_invalid/);
  const evidence:never[]=[],dossier={contract_version:"signal-topic-group-dossier-v1",scope_counts:one.scope_counts,
    locale_counts:one.locale_counts,platform_counts:one.platform_counts,month_counts:one.month_counts,
    brand_affinity:one.brand_affinity,neighbors:one.neighbors,metrics:one.metrics,evidence};
  const empty={...one,evidence,dossier_digest:sha(dossier)},emptyPlan=planFor([empty]),emptyBatch=emptyPlan.batches[0]!;
  assert.doesNotThrow(()=>validateSignalTopicEditorialScreeningOutputV1(emptyBatch,{contract_version:"signal-topic-editorial-screening-output-v1",
    batch_index:0,decisions:[{group_key:empty.group_key,disposition:"unresolved",candidate:null,confidence:null,rationale:"Sin evidencia.",cited_ref_ids:[]}]}));
  assert.throws(()=>validateSignalTopicEditorialScreeningOutputV1(emptyBatch,{contract_version:"signal-topic-editorial-screening-output-v1",
    batch_index:0,decisions:[{group_key:empty.group_key,disposition:"topic",candidate:{candidate_key:"b0000-empty",label:"Sin evidencia",
      definition:"No publicable.",locale:"es-MX"},confidence:0.2,rationale:null,cited_ref_ids:[]}]}),/citation_invalid/);
});

test("global review merges eligible groups while preserving fixed Noise and exact lineage",()=>{
  const groups=[group(0),group(1),group(2)],plan=planFor(groups,10),batch=plan.batches[0]!;
  const output=validateSignalTopicEditorialScreeningOutputV1(batch,{contract_version:"signal-topic-editorial-screening-output-v1",batch_index:0,decisions:[
    {group_key:groups[0]!.group_key,disposition:"topic",candidate:{candidate_key:"b0000-routines-a",label:"Rutinas",definition:"Rutinas por voz.",locale:"es-MX"},confidence:0.8,rationale:null,cited_ref_ids:[groups[0]!.evidence[0]!.ref_id]},
    {group_key:groups[1]!.group_key,disposition:"topic",candidate:{candidate_key:"b0000-routines-b",label:"Rutinas inteligentes",definition:"Automatización doméstica.",locale:"es-MX"},confidence:0.7,rationale:null,cited_ref_ids:[groups[1]!.evidence[0]!.ref_id]},
    {group_key:groups[2]!.group_key,disposition:"noise",candidate:null,confidence:0.9,rationale:"Otra marca.",cited_ref_ids:[]},
  ]}),screening=validateSignalTopicEditorialScreeningCoverageV1(plan,[output]);
  const review=buildSignalTopicEditorialGlobalReviewV1({plan,screening,groups});
  const providerBody=JSON.parse(review.request_body) as {output_config:{format:{schema:unknown}};messages:Array<{content:string}>};
  const editorialPayload=JSON.parse(providerBody.messages[0]!.content) as {context:typeof context;eligible_fields:string[];eligible:unknown[][]};
  assert.deepEqual(providerBody.output_config.format.schema,SIGNAL_TOPIC_EDITORIAL_GLOBAL_SCHEMA_V1);
  assertAnthropicStructuralSchema(providerBody.output_config.format.schema);
  assert.equal(editorialPayload.context.brand_name,"Alexa+");
  assert.equal(editorialPayload.eligible_fields.length,10);
  assert.equal(editorialPayload.eligible[0]!.length,10);
  assert.equal(editorialPayload.eligible[0]![0],groups[0]!.group_key);
  const result=validateSignalTopicEditorialGlobalResultV1({review,screening,value:{
    contract_version:"signal-topic-editorial-global-result-v1",concepts:[{concept_key:"topic-smart-routines",kind:"topic",
      label:"Rutinas inteligentes",definition:"Configuración y uso de rutinas por voz.",locale:"es-MX",priority_rank:1,
      priority_rationale:"Alta relación con automatización doméstica.",
      member_group_keys:[groups[1]!.group_key,groups[0]!.group_key]}],noise_group_keys:[groups[2]!.group_key],unresolved_group_keys:[]}});
  assert.equal(result.concepts.length,1);assert.deepEqual(result.concepts[0]!.member_group_keys,[groups[0]!.group_key,groups[1]!.group_key]);
  assert.deepEqual(result.noise_group_keys,[groups[2]!.group_key]);
  assert.throws(()=>validateSignalTopicEditorialGlobalResultV1({review,screening,value:{...result,noise_group_keys:[]}}),/fixed_disposition_invalid|coverage_invalid/);
  assert.throws(()=>validateSignalTopicEditorialGlobalResultV1({review:{...review,eligible_group_receipts:review.eligible_group_receipts.map((item,index)=>index?item:{...item,
    root_count:item.root_count+1})},screening,value:result}),/request_invalid/);
});

test("global review rejects mixed Topic/Narrative concepts and non-editorial locales",()=>{
  const groups=[group(10),group(11)],plan=planFor(groups,10),batch=plan.batches[0]!;
  const screening=validateSignalTopicEditorialScreeningCoverageV1(plan,[validateSignalTopicEditorialScreeningOutputV1(batch,{
    contract_version:"signal-topic-editorial-screening-output-v1",batch_index:0,decisions:[
      {group_key:groups[0]!.group_key,disposition:"topic",candidate:{candidate_key:"b0000-topic",label:"Tema",definition:"Tema estable.",locale:"es-MX"},confidence:0.8,rationale:null,cited_ref_ids:[groups[0]!.evidence[0]!.ref_id]},
      {group_key:groups[1]!.group_key,disposition:"narrative",candidate:{candidate_key:"b0000-narrative",label:"Narrativa",definition:"Marco recurrente.",locale:"es-MX"},confidence:0.8,rationale:null,cited_ref_ids:[groups[1]!.evidence[0]!.ref_id]},
    ]})]),review=buildSignalTopicEditorialGlobalReviewV1({plan,screening,groups});
  const base={contract_version:"signal-topic-editorial-global-result-v1" as const,noise_group_keys:[],unresolved_group_keys:[]};
  assert.throws(()=>validateSignalTopicEditorialGlobalResultV1({review,screening,value:{...base,concepts:[{
    concept_key:"topic-mixed",kind:"topic",label:"Mezcla",definition:"Mezcla incompatible.",locale:"es-MX",priority_rank:1,priority_rationale:"Prioridad de prueba.",
    member_group_keys:groups.map(item=>item.group_key)}]}}),/members_invalid/);
  assert.throws(()=>validateSignalTopicEditorialGlobalResultV1({review,screening,value:{...base,
    concepts:[{concept_key:"topic-one",kind:"topic",label:"Tema",definition:"Tema estable.",locale:"en-US",priority_rank:1,priority_rationale:"Prioridad de prueba.",member_group_keys:[groups[0]!.group_key]}],
    unresolved_group_keys:[groups[1]!.group_key]}}),/locale_invalid/);
});

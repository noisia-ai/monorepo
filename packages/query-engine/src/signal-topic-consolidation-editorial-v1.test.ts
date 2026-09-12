import assert from "node:assert/strict";
import test from "node:test";
import {buildSignalTopicEditorialScreeningPlanV1,signalTopicEditorialDigestV1,
  buildSignalTopicEditorialGlobalReviewV1,validateSignalTopicEditorialGlobalResultV1,
  validateSignalTopicEditorialScreeningCoverageV1,validateSignalTopicEditorialScreeningOutputV1} from "./signal-topic-consolidation-editorial-v1";

const sha=(value:unknown)=>signalTopicEditorialDigestV1(value);
const group=(index:number)=>({group_key:`open:cluster-${String(index).padStart(4,"0")}`,group_digest:sha(["group",index]),
  dossier_digest:sha(["dossier",index]),community_key:`community-${Math.floor(index/8)}`,root_count:1,chunk_count:1,
  terms:[`term-${index}`],scope_counts:{brand:1,competitor:0,category:0,unknown:0},neighbors:[],
  evidence:[{ref_id:sha(["evidence",index]),text:`Alexa evidence ${index}`,locale:"es-MX",platform:"reddit"}]});
const context={brand_name:"Alexa+",default_locale:"es-MX",summary:"Asistente de voz con IA generativa.",audiences:["hogares"],
  categories:["asistentes de voz"],competitors:["Google Assistant"],positive_anchors:["rutinas"],negative_anchors:["Alexandra"],abstention_anchors:["ruido"]};

test("plans every one of 1,652 groups exactly once in bounded Sonnet batches",()=>{
  const groups=Array.from({length:1_652},(_,index)=>group(index));
  const plan=buildSignalTopicEditorialScreeningPlanV1({expected_group_count:groups.length,context_digest:sha(context),context,groups});
  assert.equal(plan.model,"claude-sonnet-4-6");assert.equal(plan.batches.length,42);
  assert.equal(plan.batches.flatMap(batch=>batch.group_keys).length,1_652);
  assert.equal(new Set(plan.batches.flatMap(batch=>batch.group_keys)).size,1_652);
  assert.ok(plan.batches.every(batch=>batch.group_keys.length<=40&&Buffer.byteLength(batch.prompt)<1_500_000));
  assert.ok(plan.batches[0]?.prompt.includes("No fuerces conversaciones irrelevantes"));
});

test("screening validates evidence citations, dispositions and exact batch coverage",()=>{
  const groups=[group(0),group(1)],plan=buildSignalTopicEditorialScreeningPlanV1({expected_group_count:2,context_digest:sha(context),context,groups,batch_size:10});
  const batch=plan.batches[0]!,evidence=new Map(groups.map(item=>[item.group_key,new Set(item.evidence.map(ref=>ref.ref_id))]));
  const output=validateSignalTopicEditorialScreeningOutputV1(batch,{contract_version:"signal-topic-editorial-screening-output-v1",batch_index:0,decisions:[
    {group_key:groups[1]!.group_key,disposition:"noise",candidate:null,confidence:0.9,rationale:"No trata sobre Alexa+.",cited_ref_ids:[]},
    {group_key:groups[0]!.group_key,disposition:"topic",candidate:{candidate_key:"b0000-voice-routines",label:"Rutinas de voz",definition:"Experiencias con rutinas de Alexa+.",locale:"es-MX"},confidence:0.8,rationale:null,cited_ref_ids:[groups[0]!.evidence[0]!.ref_id]},
  ]},evidence);
  const result=validateSignalTopicEditorialScreeningCoverageV1(plan,[output]);
  assert.deepEqual({groups:result.group_count,topics:result.topic_count,noise:result.noise_count},{groups:2,topics:1,noise:1});
  assert.throws(()=>validateSignalTopicEditorialScreeningOutputV1(batch,{...output,decisions:[output.decisions[0],output.decisions[0]]},evidence),/coverage_invalid/);
  assert.throws(()=>validateSignalTopicEditorialScreeningOutputV1(batch,{...output,decisions:output.decisions.map((item,index)=>index?{...item,cited_ref_ids:[sha("foreign")]}:item)},evidence),/citation_invalid/);
});

test("fails closed before planning duplicate, incomplete or over-capacity group sets",()=>{
  const one=group(0);
  assert.throws(()=>buildSignalTopicEditorialScreeningPlanV1({expected_group_count:2,context_digest:sha(context),context,groups:[one]}),/incomplete/);
  assert.throws(()=>buildSignalTopicEditorialScreeningPlanV1({expected_group_count:2,context_digest:sha(context),context,groups:[one,one]}),/plan_invalid/);
  assert.throws(()=>buildSignalTopicEditorialScreeningPlanV1({expected_group_count:5_001,context_digest:sha(context),context,groups:[]}),/plan_invalid/);
  assert.throws(()=>buildSignalTopicEditorialScreeningPlanV1({expected_group_count:1,context_digest:sha("stale"),context,groups:[one]}),/context_digest_invalid/);
});

test("global review merges eligible groups while preserving fixed Noise and exact lineage",()=>{
  const groups=[group(0),group(1),group(2)],plan=buildSignalTopicEditorialScreeningPlanV1({expected_group_count:3,
    context_digest:sha(context),context,groups,batch_size:10}),batch=plan.batches[0]!;
  const evidence=new Map(groups.map(item=>[item.group_key,new Set(item.evidence.map(ref=>ref.ref_id))]));
  const output=validateSignalTopicEditorialScreeningOutputV1(batch,{contract_version:"signal-topic-editorial-screening-output-v1",batch_index:0,decisions:[
    {group_key:groups[0]!.group_key,disposition:"topic",candidate:{candidate_key:"b0000-routines-a",label:"Rutinas",definition:"Rutinas por voz.",locale:"es-MX"},confidence:0.8,rationale:null,cited_ref_ids:[groups[0]!.evidence[0]!.ref_id]},
    {group_key:groups[1]!.group_key,disposition:"topic",candidate:{candidate_key:"b0000-routines-b",label:"Rutinas inteligentes",definition:"Automatización doméstica.",locale:"es-MX"},confidence:0.7,rationale:null,cited_ref_ids:[groups[1]!.evidence[0]!.ref_id]},
    {group_key:groups[2]!.group_key,disposition:"noise",candidate:null,confidence:0.9,rationale:"Otra marca.",cited_ref_ids:[]},
  ]},evidence),screening=validateSignalTopicEditorialScreeningCoverageV1(plan,[output]);
  const review=buildSignalTopicEditorialGlobalReviewV1({plan,screening,groups});
  const result=validateSignalTopicEditorialGlobalResultV1({review,screening,value:{
    contract_version:"signal-topic-editorial-global-result-v1",concepts:[{concept_key:"topic-smart-routines",kind:"topic",
      label:"Rutinas inteligentes",definition:"Configuración y uso de rutinas por voz.",locale:"es-MX",
      member_group_keys:[groups[1]!.group_key,groups[0]!.group_key]}],noise_group_keys:[groups[2]!.group_key],unresolved_group_keys:[]}});
  assert.equal(result.concepts.length,1);assert.deepEqual(result.concepts[0]!.member_group_keys,[groups[0]!.group_key,groups[1]!.group_key]);
  assert.deepEqual(result.noise_group_keys,[groups[2]!.group_key]);
  assert.throws(()=>validateSignalTopicEditorialGlobalResultV1({review,screening,value:{...result,noise_group_keys:[]}}),/fixed_disposition_invalid|coverage_invalid/);
});

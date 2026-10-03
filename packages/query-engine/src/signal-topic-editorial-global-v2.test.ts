import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {signalTopicEditorialDigestV1 as sha,type SignalTopicEditorialScreeningGroupV1} from './signal-topic-consolidation-editorial-v1';
import {buildSignalTopicEditorialScreeningPlanV2,validateSignalTopicEditorialGroupOutputV2} from './signal-topic-consolidation-editorial-v2';
import {buildSignalTopicEditorialGlobalReviewV2,validateSignalTopicEditorialGlobalResultV2,
  SIGNAL_TOPIC_EDITORIAL_GLOBAL_SHARD_OUTPUT_SCHEMA_V2,SIGNAL_TOPIC_EDITORIAL_GLOBAL_MERGE_OUTPUT_SCHEMA_V2,
  SIGNAL_TOPIC_EDITORIAL_GLOBAL_RANKING_OUTPUT_SCHEMA_V2,
  type SignalTopicEditorialGlobalUnitV2} from './signal-topic-editorial-global-v2';

test('all global provider grammars avoid unsupported JSON Schema constraints',()=>{
  const forbidden=new Set(['maxItems','minItems','maxLength','minLength','minimum','maximum','multipleOf']);
  const walk=(value:unknown):void=>{
    if(!value||typeof value!=='object')return;
    for(const [key,child] of Object.entries(value)){
      assert.ok(!forbidden.has(key),`unsupported provider constraint: ${key}`);
      walk(child);
    }
  };
  for(const schema of [SIGNAL_TOPIC_EDITORIAL_GLOBAL_SHARD_OUTPUT_SCHEMA_V2,
    SIGNAL_TOPIC_EDITORIAL_GLOBAL_MERGE_OUTPUT_SCHEMA_V2,SIGNAL_TOPIC_EDITORIAL_GLOBAL_RANKING_OUTPUT_SCHEMA_V2])walk(schema);
});

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const context={brand_name:'Alexa+',default_locale:'es-MX',summary:'Asistente de voz con IA.',audiences:['hogares'],
  categories:['asistentes'],competitors:[],positive_anchors:['rutinas'],negative_anchors:[],abstention_anchors:[]};
function group(n:number):SignalTopicEditorialScreeningGroupV1{
  const text=`Alexa+ en la conversación ${n} 👩🏽‍💻`,root_id=id(n+1),chunk_sha256=`sha256:${createHash('sha256').update(text).digest('hex')}`;
  const evidence=[{ref_id:sha({root_id,chunk_index:0,start:0,end:text.length,chunk_sha256}),root_id,chunk_index:0,
    start:0,end:text.length,chunk_sha256,text,locale:'es-MX',platform:'reddit',occurred_at:'2026-09-12T00:00:00Z'}];
  const scope_counts={brand:1,competitor:0,category:0,unknown:0},locale_counts=[{key:'es-MX',count:1}],
    platform_counts=[{key:'reddit',count:1}],month_counts=[{key:'2026-09',count:1}],
    brand_affinity={positive:[],negative:[],abstention:[]},neighbors:never[]=[],metrics={cohesion:null,outlier_ratio:null};
  const dossier={contract_version:'signal-topic-group-dossier-v1',scope_counts,locale_counts,platform_counts,
    month_counts,brand_affinity,neighbors,metrics,evidence:evidence.map(({text:_text,...item})=>item)};
  return {group_key:`open:cluster-${n}`,lane:'open',group_digest:sha(['group',n]),source_dossier_digest:sha(dossier),
    dossier_digest:sha(dossier),community_key:'community-1',root_count:1,chunk_count:1,terms:['Alexa+'],
    scope_counts,locale_counts,platform_counts,month_counts,brand_affinity,neighbors,metrics,evidence};
}
function units(dispositions:Array<'topic'|'narrative'|'noise'|'unresolved'>):SignalTopicEditorialGlobalUnitV2[]{
  const plan=buildSignalTopicEditorialScreeningPlanV2({workspace_id:id(70001),run_id:id(70002),
    expected_group_count:dispositions.length,source_context_digest:sha('source'),editorial_context_digest:sha(context),
    context,groups:dispositions.map((_,n)=>group(n))});
  return plan.requests.map((request,n)=>{
    const disposition=dispositions[n]!,candidate=disposition==='topic'||disposition==='narrative'
      ?{label:`Asunto ${n}`,definition:`Definición completa ${n}`,locale:'es-MX'}:null;
    const decision=validateSignalTopicEditorialGroupOutputV2(request,{contract_version:'signal-topic-editorial-group-output-v2',
      group_id:request.receipt.group_id,disposition,candidate,confidence:disposition==='unresolved'?null:0.8,
      rationale:'Evidencia revisada.',cited_evidence_ids:disposition==='unresolved'?[]:[request.receipt.evidence[0]!.evidence_id]});
    return {request,decision,technical_error_code:null};
  });
}

test('global review carries cited original text and maps compact ids back to every group',()=>{
  const input=units(['topic','topic','narrative','noise','unresolved']);
  const review=buildSignalTopicEditorialGlobalReviewV2({units:input,expected_group_count:5});
  const params=JSON.parse(review.request_body);
  const data=JSON.parse(params.messages[0].content).untrusted_data;
  assert.equal(data.eligible.length,3);
  assert.equal(data.eligible[0].cited_evidence[0].text,input[0]!.request.source_group.evidence[0]!.text);
  assert.equal(params.system.includes(data.eligible[0].cited_evidence[0].text),false);
  assert.deepEqual(review.fixed_noise_group_keys,[input[3]!.request.receipt.group_key]);
  const result=validateSignalTopicEditorialGlobalResultV2({review,value:{contract_version:'signal-topic-editorial-global-output-v2',
    concepts:[{kind:'topic',label:'Rutinas con Alexa+',definition:'Uso de rutinas domésticas.',priority_rationale:'Relevante para la marca.',
      member_ids:[1,2],cited_ref_ids:[input[0]!.request.receipt.evidence[0]!.ref_id]},
      {kind:'narrative',label:'Promesa de utilidad',definition:'Relato sobre utilidad.',priority_rationale:'Alcance observado.',
        member_ids:[3],cited_ref_ids:[input[2]!.request.receipt.evidence[0]!.ref_id]}],noise_ids:[],unresolved_ids:[]}});
  assert.deepEqual(result.concepts.map(item=>item.priority_rank),[1,2]);
  assert.deepEqual(result.concepts[0]!.member_group_keys,input.slice(0,2).map(item=>item.request.receipt.group_key));
  assert.deepEqual(result.noise_group_keys,[input[3]!.request.receipt.group_key]);
  assert.deepEqual(result.unresolved_group_keys,[input[4]!.request.receipt.group_key]);
  assert.equal(result.concepts[0]!.cited_ref_ids.length,1);
});

test('global review stops on technical error, missing group or changed paid decision',()=>{
  const input=units(['topic','topic']);
  assert.throws(()=>buildSignalTopicEditorialGlobalReviewV2({units:input,expected_group_count:3}),/coverage_incomplete/u);
  assert.throws(()=>buildSignalTopicEditorialGlobalReviewV2({units:[input[0]!,input[0]!],expected_group_count:2}),/input_invalid/u);
  assert.throws(()=>buildSignalTopicEditorialGlobalReviewV2({units:[input[0]!,{...input[1]!,decision:null,technical_error_code:'provider_error'}],expected_group_count:2}),/technical_error/u);
  assert.throws(()=>buildSignalTopicEditorialGlobalReviewV2({units:[input[0]!,{...input[1]!,decision:{...input[1]!.decision!,request_digest:sha('foreign')}}],expected_group_count:2}),/decision_invalid/u);
});

test('global result refuses omitted, duplicated or cross-kind members and foreign citations',()=>{
  const input=units(['topic','topic','narrative']);
  const review=buildSignalTopicEditorialGlobalReviewV2({units:input,expected_group_count:3});
  const item={kind:'topic',label:'Rutinas',definition:'Rutinas de hogar',priority_rationale:'Contexto de marca',
    member_ids:[1,2],cited_ref_ids:[input[0]!.request.receipt.evidence[0]!.ref_id]};
  const body={contract_version:'signal-topic-editorial-global-output-v2',concepts:[item],noise_ids:[],unresolved_ids:[]};
  const parse=(value:unknown)=>validateSignalTopicEditorialGlobalResultV2({review,value});
  assert.throws(()=>parse(body),/coverage_invalid/u);
  assert.throws(()=>parse({...body,concepts:[{...item,member_ids:[1,1]}],unresolved_ids:[2,3]}),/members_invalid/u);
  assert.throws(()=>parse({...body,concepts:[{...item,member_ids:[1,3]}],unresolved_ids:[2]}),/members_invalid/u);
  assert.throws(()=>parse({...body,concepts:[{...item,cited_ref_ids:[sha('foreign')]}],unresolved_ids:[3]}),/citation_invalid/u);
  assert.throws(()=>parse({...body,concepts:[item],noise_ids:[2],unresolved_ids:[3]}),/coverage_invalid/u);
  assert.throws(()=>parse({...body,concepts:[{...item,label:'\ud800'}],unresolved_ids:[3]}),/text_invalid/u);
});

test('global request carries all 1,652 candidates with compact output aliases',()=>{
  const input=units(Array.from({length:1652},()=> 'topic'));
  const review=buildSignalTopicEditorialGlobalReviewV2({units:input,expected_group_count:1652});
  assert.equal(review.eligible.length,1652);
  assert.equal(review.eligible[1651]!.id,1652);
  assert.equal(JSON.parse(JSON.parse(review.request_body).messages[0].content).untrusted_data.eligible.length,1652);
  const refs=input.map(item=>item.request.receipt.evidence[0]!.ref_id);
  const result=validateSignalTopicEditorialGlobalResultV2({review,value:{contract_version:'signal-topic-editorial-global-output-v2',
    concepts:[{kind:'topic',label:'Conversaciones sobre Alexa+',definition:'Asuntos verificables sobre Alexa+.',
      priority_rationale:'Ejemplo de cobertura, sin calificar precisión semántica.',
      member_ids:Array.from({length:1652},(_,n)=>n+1),cited_ref_ids:[refs[0]!]}],noise_ids:[],unresolved_ids:[]}});
  assert.equal(result.concepts[0]!.member_group_keys.length,1652);
  assert.equal(result.concepts[0]!.priority_rank,1);
});

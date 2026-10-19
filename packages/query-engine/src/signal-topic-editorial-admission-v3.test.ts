import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {signalTopicEditorialDigestV1 as digest} from './signal-topic-consolidation-editorial-v1';
import {buildSignalTopicEditorialScreeningPlanV2} from './signal-topic-consolidation-editorial-v2';
import {buildSignalTopicEditorialAdmissionHeaderV3,signalTopicEditorialAdmissionChunksV3} from './signal-topic-editorial-admission-v3';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const context={brand_name:'Alexa+',default_locale:'es-MX',summary:'Asistente de voz.',audiences:['hogares'],
  categories:['asistentes'],competitors:[],positive_anchors:['rutinas'],negative_anchors:[],abstention_anchors:[]};
function group(index:number){
  const text=`Alexa+ permite la rutina ${index} 👩🏽‍💻`,root_id=id(index+1),chunk_index=0,start=0,end=text.length;
  const chunk_sha256=`sha256:${createHash('sha256').update(text).digest('hex')}`;
  const evidence=[{ref_id:digest({root_id,chunk_index,start,end,chunk_sha256}),root_id,chunk_index,start,end,chunk_sha256,
    text,locale:'es-MX',platform:'reddit',occurred_at:'2026-09-12T00:00:00.000Z'}];
  const scope_counts={brand:1,competitor:0,category:0,unknown:0};
  const locale_counts=[{key:'es-MX',count:1}],platform_counts=[{key:'reddit',count:1}],month_counts=[{key:'2026-09',count:1}];
  const brand_affinity={positive:[],negative:[],abstention:[]},neighbors:never[]=[],metrics={cohesion:null,outlier_ratio:null};
  const dossier={contract_version:'signal-topic-group-dossier-v1',scope_counts,locale_counts,platform_counts,month_counts,
    brand_affinity,neighbors,metrics,evidence:evidence.map(({text:_text,...item})=>item)};
  return {group_key:`open:cluster-${String(index).padStart(5,'0')}`,lane:'open' as const,
    group_digest:digest(['group',index]),source_dossier_digest:digest(dossier),dossier_digest:digest(dossier),
    community_key:`community-${Math.floor(index/8)}`,root_count:1,chunk_count:1,terms:['Alexa+','rutinas'],
    scope_counts,locale_counts,platform_counts,month_counts,brand_affinity,neighbors,metrics,evidence};
}
function plan(count:number){return buildSignalTopicEditorialScreeningPlanV2({workspace_id:id(70001),run_id:id(70002),
  expected_group_count:count,source_context_digest:digest('source'),editorial_context_digest:digest(context),context,
  groups:Array.from({length:count},(_,i)=>group(i))});}

test('V3 admission header seals exact V2 order without embedding evidence 1,652 times',()=>{
  const source=plan(1652),header=buildSignalTopicEditorialAdmissionHeaderV3(source);
  assert.equal(header.expected_group_count,1652);
  assert.equal(header.source_plan_digest,source.plan_digest);
  assert.equal(header.admission_digest,digest((({admission_digest:_digest,...core})=>core)(header)));
  assert.deepEqual(header.requests.map(item=>item.request_digest),source.requests.map(item=>item.request_digest));
  assert.ok(Buffer.byteLength(JSON.stringify(header))<Buffer.byteLength(JSON.stringify(source))/10);
  assert.equal(JSON.stringify(header).includes('Alexa+ permite la rutina 0'),false);
  const chunks=[...signalTopicEditorialAdmissionChunksV3(source,header,32)];
  assert.equal(chunks.length,52);
  assert.equal(chunks.at(-1)?.length,20);
  assert.deepEqual(chunks.flat().map(item=>item.batch_index),Array.from({length:1652},(_,i)=>i));
  assert.equal(chunks[0]?.[0]?.request,source.requests[0]);
});

test('V3 header rejects a changed request and invalid transport chunk size',()=>{
  const source=plan(2);
  const header=buildSignalTopicEditorialAdmissionHeaderV3(source);
  assert.throws(()=>[...signalTopicEditorialAdmissionChunksV3(source,{...header,source_plan_digest:digest('other')})],/header_mismatch/u);
  source.requests[1]!.source_group.evidence[0]!.text='changed';
  assert.throws(()=>buildSignalTopicEditorialAdmissionHeaderV3(source),/topic_editorial_v2_plan_invalid/u);
  assert.throws(()=>[...signalTopicEditorialAdmissionChunksV3(source,header,0)],/chunk_size_invalid/u);
});

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {buildSignalTopicEditorialScreeningPlanV2,signalTopicEditorialDigestV1 as digest} from '../../packages/query-engine/src/index';
import {requestSignalTopicEditorialChunkedAdmissionV3} from './signal-topic-editorial-admission-v3';
import type {SignalTopicEditorialBatchDatabaseV2} from './signal-topic-editorial-batch-v2';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const context={brand_name:'Alexa+',default_locale:'es-MX',summary:'Asistente de voz.',audiences:['hogares'],
  categories:['asistentes'],competitors:[],positive_anchors:['rutinas'],negative_anchors:[],abstention_anchors:[]};
function plan(count:number){
  const groups=Array.from({length:count},(_,i)=>{
    const text=`Alexa+ rutina ${i}`,root_id=id(i+1),chunk_index=0,start=0,end=text.length;
    const chunk_sha256=`sha256:${createHash('sha256').update(text).digest('hex')}`;
    const evidence=[{ref_id:digest({root_id,chunk_index,start,end,chunk_sha256}),root_id,chunk_index,start,end,chunk_sha256,
      text,locale:'es-MX',platform:'reddit',occurred_at:'2026-09-12T00:00:00.000Z'}];
    const scope_counts={brand:1,competitor:0,category:0,unknown:0};
    const locale_counts=[{key:'es-MX',count:1}],platform_counts=[{key:'reddit',count:1}],month_counts=[{key:'2026-09',count:1}];
    const brand_affinity={positive:[],negative:[],abstention:[]},neighbors:never[]=[],metrics={cohesion:null,outlier_ratio:null};
    const dossier={contract_version:'signal-topic-group-dossier-v1',scope_counts,locale_counts,platform_counts,month_counts,
      brand_affinity,neighbors,metrics,evidence:evidence.map(({text:_text,...item})=>item)};
    return {group_key:`open:cluster-${String(i).padStart(5,'0')}`,lane:'open' as const,group_digest:digest(['group',i]),
      source_dossier_digest:digest(dossier),dossier_digest:digest(dossier),community_key:`community-${Math.floor(i/8)}`,
      root_count:1,chunk_count:1,terms:['Alexa+'],scope_counts,locale_counts,platform_counts,month_counts,
      brand_affinity,neighbors,metrics,evidence};
  });
  return buildSignalTopicEditorialScreeningPlanV2({workspace_id:id(700),run_id:id(701),expected_group_count:count,
    source_context_digest:digest('source'),editorial_context_digest:digest(context),context,groups});
}
function database(options:{replay?:boolean;failChunk?:number}={}){
  const queries:Array<{sql:string;values?:unknown[]}>=[];
  let released=false,chunk=0;
  const db={async connect(){return {async query(sql:string,values?:unknown[]){
    queries.push({sql,values});
    if(sql.includes('begin_signal_topic_editorial_batch_v3'))return {rows:[{value:{execution_id:id(900),expected_items:35,stage:'screening',replayed:!!options.replay}}]};
    if(sql.includes('append_signal_topic_editorial_batch_v3')){
      if(chunk++===options.failChunk)throw new Error('topic_editorial_v3_evidence_invalid');
      return {rows:[{value:{inserted:(JSON.parse(values![1] as string) as unknown[]).length}}]};
    }
    if(sql.includes('finalize_signal_topic_editorial_batch_v3'))return {rows:[{value:{execution_id:id(900),expected_items:35,stage:'screening',replayed:false}}]};
    return {rows:[]};
  },release(){released=true;}};}} as unknown as SignalTopicEditorialBatchDatabaseV2;
  return {db,queries,get released(){return released;}};
}
const args=(db:SignalTopicEditorialBatchDatabaseV2)=>({database:db,workspace_id:id(700),actor_user_id:id(702),plan:plan(35),
  idempotency_key:'alexa-review-request-v3',quote_reference:`v2.1790000000.${'a'.repeat(64)}`});

test('V3 sends a compact header and exact 32+3 rows in one transaction',async()=>{
  const state=database(),result=await requestSignalTopicEditorialChunkedAdmissionV3(args(state.db));
  assert.equal(result.expected_items,35);
  assert.deepEqual(state.queries.map(item=>item.sql.split('(')[0]),['BEGIN','SET LOCAL search_path=public,extensions,pg_temp',
    'SELECT begin_signal_topic_editorial_batch_v3','SELECT append_signal_topic_editorial_batch_v3',
    'SELECT append_signal_topic_editorial_batch_v3','SELECT finalize_signal_topic_editorial_batch_v3','COMMIT']);
  const header=JSON.parse(state.queries[2]!.values![2] as string);
  assert.equal(header.requests.length,35);
  assert.equal(JSON.stringify(header).includes('Alexa+ rutina 0'),false);
  assert.deepEqual(state.queries.slice(3,5).map(item=>(JSON.parse(item.values![1] as string) as unknown[]).length),[32,3]);
  assert.equal(state.released,true);
});

test('V3 aborts the whole transaction if a middle chunk fails',async()=>{
  const state=database({failChunk:1});
  await assert.rejects(requestSignalTopicEditorialChunkedAdmissionV3(args(state.db)),/evidence_invalid/u);
  assert.equal(state.queries.at(-1)?.sql,'ROLLBACK');
  assert.equal(state.queries.some(item=>item.sql.includes('finalize_signal_topic_editorial_batch_v3')),false);
  assert.equal(state.released,true);
});

test('V3 same-key replay skips all append and finalization calls',async()=>{
  const state=database({replay:true}),result=await requestSignalTopicEditorialChunkedAdmissionV3(args(state.db));
  assert.equal(result.replayed,true);
  assert.equal(state.queries.filter(item=>item.sql.includes('append_signal_topic_editorial_batch_v3')).length,0);
  assert.equal(state.queries.at(-1)?.sql,'COMMIT');
});

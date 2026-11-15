import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,open,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {requestSignalListeningV1,createSignalListeningStoreV1} from '../signal-listening-runs';
import {signalListeningBaseTemplateV1,buildSignalListeningJevRequestV1,signalListeningRequestDigestV1,mapSignalListeningJevResponseV1,type SignalListeningInputV1} from '@noisia/query-engine';
import {jevUsageV1} from '../../../services/workers/src/workers/signal-jev-labeling-page';
import type {LabelingRunV1} from '../signal-labeling-runs';
const enabled=process.env.NOISIA_R16_INPUT_BOUNDS_PG==='true',bounds={max_rows:3,max_working_bytes:512*1024*1024};
const sha=(s:string)=>'sha256:'+createHash('sha256').update(s).digest('hex');

test('lazy native selector matches full oracle across empty slices, base reclassification, exact reservations, rights and byte prefixes',{
 skip:!enabled,timeout:600000,
},async()=>runMassLabelingAcceptanceFixtureV1('product',{population_count:70,study_author_metadata:true,beforeProcessing:async ctx=>{
 const access={database:ctx.database,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
 const callsBefore=(await ctx.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE workspace_id=$1',[ctx.workspace_id])).rows[0].n;
 const otherRunsBefore=(await ctx.database.query('SELECT id,status FROM signal_labeling_runs WHERE workspace_id=$1 AND id<>$2 ORDER BY id',[ctx.workspace_id,ctx.run_id])).rows;
 assert.equal((await ctx.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[ctx.run_id])).rows[0].n,0);
 const canceled=await ctx.database.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1 AND workspace_id=$2 AND status='queued' AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls WHERE run_id=$1) RETURNING id",[ctx.run_id,ctx.workspace_id]);
 assert.deepEqual(canceled.rows,[{id:ctx.run_id}],'cancel only the exact unsent queued source fixture');
 assert.deepEqual((await ctx.database.query('SELECT id,status FROM signal_labeling_runs WHERE workspace_id=$1 AND id<>$2 ORDER BY id',[ctx.workspace_id,ctx.run_id])).rows,otherRunsBefore,'no unrelated run is canceled');
 assert.equal((await ctx.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE workspace_id=$1',[ctx.workspace_id])).rows[0].n,callsBefore,'fixture cancellation creates zero new calls');
 const base=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']});
 const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:{...base,questions:[...base.questions,
  {key:'consumer_usage',type:'noul',text:'Does this describe using the category?',positive:'Use by an individual consumer',negative:'Unrelated',scope:'consumer_category',origin:'brand_os',human_locked:false,topic_source:'defined',domain:'category'}]}});
 const admitted=await requestSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,cap_micro_usd:1000000,idempotency_key:randomUUID(),provider_available:true});
 let pages:Array<{ids:string[];cursor:string|null}>=[],metadata:Array<Array<{root_id:string;working_bytes:string}>>=[],finishRows:Array<{pending:number;available:boolean}>=[];
 const database={query:ctx.database.query.bind(ctx.database),connect:async()=>{const c=await ctx.database.connect();return new Proxy(c,{get(target,key){if(key==='query')return async(sql:string,params?:unknown[])=>{
  const result=await target.query(sql,params);
  if(sql.includes('labeling_listening_root_page_v1')){assert.ok(result.rows.length<=4096);assert.deepEqual(Object.keys(result.rows[0]??{root_id:null}),['root_id']);pages.push({ids:result.rows.map(r=>r.root_id),cursor:params?.[3] as string??null});}
  if(sql.includes('labeling_listening_input_metadata_v1')){assert.ok(sql.includes('signal_listening_population_roots_v1('),'metadata never projects the unbounded population');assert.ok(Array.isArray(params?.[7]));assert.ok((params![7] as string[]).length<=4096);assert.ok(result.rows.every(r=>Object.keys(r).sort().join(',')==='root_id,working_bytes'));metadata.push(result.rows);}
  if(sql.includes('labeling_listening_pending_available_v1'))finishRows.push(result.rows[0]);
  return result;
 };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}} as typeof ctx.database;
 const files=await mkdtemp(join(tmpdir(),'r16-lazy-input-'));
 const rawPages={reference:(a:{workspace_id:string;run_id:string;name:string;raw_sha256:string})=>({storage_key:`private/${a.workspace_id}/${a.run_id}/${a.name}.${a.raw_sha256.slice(7)}.parts.json`}),
  store:async(a:{workspace_id:string;run_id:string;name:string;raw_text:string;raw_sha256:string;size_bytes:number})=>{const path=join(files,a.raw_sha256.slice(7));await writeFile(path,a.raw_text,{flag:'wx'});const f=await open(path,'r+');try{await f.sync();}finally{await f.close();}const raw=await readFile(path,'utf8');assert.equal(sha(raw),a.raw_sha256);assert.equal(Buffer.byteLength(raw),a.size_bytes);return{storage_key:rawPages.reference(a).storage_key,sha256:a.raw_sha256,size_bytes:a.size_bytes,verified:true as const};},load:(a:{sha256:string})=>readFile(join(files,a.sha256.slice(7)),'utf8')};
 const store=createSignalListeningStoreV1({database,rawPages,page_size:4096,storeRaw:async()=>{throw Error('no provider or individual raw calls');}});
 const prior=await store.claim(admitted.run_id);assert.ok(prior);
 let active:LabelingRunV1|null=null,priorReleased=false;
 const proposals=(run:LabelingRunV1,input:SignalListeningInputV1[])=>input.map(i=>{const request=buildSignalListeningJevRequestV1(i,cfg.configuration),request_digest=signalListeningRequestDigestV1(run,i,request);return{custom_id:'listening_'+request_digest.slice(7,67),request_digest,request:request as unknown as Record<string,unknown>,inputs:[i],reserved_micro_usd:1000};});
 try{
  // Two active mass-labeling runs are forbidden. Build genuine historical
  // question links through native unsent failure, then admit the tested run.
  const oldInputs=await store.inputs(prior);assert.equal(oldInputs.length,70);
  const oldCalls=await store.reserve(prior,proposals(prior,oldInputs));assert.equal(oldCalls.length,70);
  assert.equal((await ctx.database.query("SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1 AND status='reserved' AND provider_batch_id IS NULL AND raw_storage_key IS NULL AND usage IS NULL",[prior.id])).rows[0].n,70,'historical calls have never entered transport');
  await store.markFailed(prior,oldCalls,false);
  assert.equal(await store.finish(prior),'failed','native blocked unanswered lifecycle is a real terminal failure');
  const history=(await ctx.database.query("SELECT count(*)::int n,count(*) FILTER(WHERE status='unknown')::int unknown,count(*) FILTER(WHERE status<>'failed' OR provider_batch_id IS NOT NULL OR raw_storage_key IS NOT NULL OR usage IS NOT NULL OR stop_reason IS NOT NULL)::int transported,COALESCE(sum(COALESCE(settled_micro_usd,0)+terminal_exposure_micro_usd),0)::text exposure FROM signal_labeling_calls WHERE run_id=$1",[prior.id])).rows[0];
  assert.deepEqual(history,{n:70,unknown:0,transported:0,exposure:'0'});
  const historyLinks=await ctx.database.query('SELECT root_id,question_digest FROM signal_listening_call_questions WHERE run_id=$1 ORDER BY root_id,question_digest',[prior.id]);assert.equal(historyLinks.rows.length,140);
  await store.release(prior);priorReleased=true;
  const next=await requestSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,cap_micro_usd:1000000,idempotency_key:randomUUID(),provider_available:true});
  const run=await store.claim(next.run_id);assert.ok(run);active=run;
  assert.equal((await ctx.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[run.id])).rows[0].n,0);
  // The unbounded path deliberately retains the pre-change full-population SQL
  // and serves as an independent native oracle for all returned input fields.
  const oracle=()=>store.inputs(run);
  const all=await oracle();assert.equal(all.length,70);assert.ok(all.every(i=>!i.question_keys.includes('consumer_usage')));
  assert.deepEqual(await store.inputs(run,bounds),all.slice(0,3));
  const initialCosts=metadata.at(-1)!;assert.equal(initialCosts.length,3);
  assert.deepEqual((await store.inputs(run,{...bounds,max_working_bytes:Number(initialCosts[0]!.working_bytes)+Number(initialCosts[1]!.working_bytes)-1})).map(i=>i.root_id),[all[0]!.root_id]);
  assert.deepEqual(await store.inputs(run,{...bounds,max_working_bytes:1}),[]);
  await assert.rejects(store.inputs(run,{...bounds,max_working_bytes:1,on_oversize:'error'}),/labeling_input_memory_bound/);
  assert.ok(all.every(i=>i.author===null&&i.title===null&&i.language===null&&i.content_type===null),'private source author fields are never hydrated');
  const calls=await store.reserve(run,proposals(run,all.slice(0,64)));assert.equal(calls.length,64);
  pages=[];metadata=[];const expected=await oracle();assert.equal(expected.length,6);
  const selected=await store.inputs(run,bounds);assert.deepEqual(selected,expected.slice(0,3));
  assert.equal(pages.length,2,'a completely reserved first slice must not report exhaustion');assert.equal(metadata[0]!.length,0);assert.equal(metadata[1]!.length,3);assert.equal(pages[1]!.cursor,all[63]!.root_id);
  assert.deepEqual((await ctx.database.query('SELECT root_id,question_digest FROM signal_listening_call_questions WHERE run_id=$1 ORDER BY root_id,question_digest',[prior.id])).rows,historyLinks.rows,'reading a new run preserves the historical run links');
  assert.deepEqual((await ctx.database.query('SELECT id,status FROM signal_labeling_runs WHERE workspace_id=$1 AND id NOT IN($2,$3,$4) ORDER BY id',[ctx.workspace_id,ctx.run_id,prior.id,run.id])).rows,otherRunsBefore,'no other run lifecycle changes');
  const before=finishRows.length;assert.equal(await store.finish(run),'running');assert.equal(finishRows.length-before,1);assert.deepEqual(finishRows.at(-1),{pending:70,available:true},'pending retains reserved-but-unanswered roots exactly');
  await store.markSubmitting(run,calls);
  const outcomes=calls.map(call=>{const i=call.inputs[0]!,request=buildSignalListeningJevRequestV1(i,cfg.configuration);const answers=Object.fromEntries(Object.entries(request.questions).map(([key,q])=>[key,q.type==='noul'?{type:'noul',noul:key==='promotion'?.1:.9}:{type:'choice',choice:'individual',confidence:.9,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k==='individual'?.9:.1/(Object.keys(q.criteria).length-1)]))}]));const response={model:cfg.configuration.model,answers,usage:{input_tokens:120,output_tokens:20}};return{call,raw:JSON.stringify({body:JSON.stringify(response),http_status:200,latency_ms:50}),result:mapSignalListeningJevResponseV1(i,run.context,cfg.configuration,response as Parameters<typeof mapSignalListeningJevResponseV1>[3])};});
  await store.persistRawPage(run,outcomes);await store.settlePage(run,outcomes.map(o=>({call:o.call,usage:jevUsageV1({input_tokens:120,output_tokens:20}),settled_micro_usd:8})));await store.apply(run,outcomes.map(o=>({call:o.call,results:[o.result]})));
  pages=[];const afterBase=await oracle(),after=await store.inputs(run,bounds);assert.deepEqual(after,afterBase.slice(0,3));assert.ok(after.some(i=>i.question_keys.includes('consumer_usage')),'base application enables the consumer question');assert.ok(after.some(i=>i.root_id<all[63]!.root_id),'earlier UUIDs become selectable in a NEW transaction');assert.equal(pages[0]!.cursor,null,'no scan cursor survives the previous RR snapshot');
  await assert.rejects(store.inputs({...run,workspace_id:randomUUID()},bounds),/listening_run_unavailable/);
  await ctx.database.query("UPDATE data_sources SET status='archived' WHERE workspace_id=$1",[ctx.workspace_id]);
  const outcome=async(bounded:boolean)=>{try{return{rows:await store.inputs(run,bounded?bounds:undefined)}}catch(e){return{error:(e as Error).message}}};
  assert.deepEqual(await outcome(true),await outcome(false),'rights revocation has the same denial or empty population as full oracle');
  assert.equal((await ctx.database.query("SELECT count(*)::int n FROM signal_listening_population_v1($1,$2,$3,$4)",[ctx.workspace_id,cfg.id,ctx.map_id,run.entity_context_digest])).rows[0].n,0);
 }finally{if(active)await store.release(active);if(!priorReleased)await store.release(prior);await rm(files,{recursive:true,force:true});}
}}));

test('lazy native selector preserves frozen human topic decisions and cached source privacy',{
 skip:!enabled,timeout:600000,
},async()=>{
 const {withSignalStudyFixtureV1}=await import('./signal-study.synthetic.fixture');
 const human=await import('../signal-listening-human-edits');
 await withSignalStudyFixtureV1(async f=>{
  const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
  const before=await human.getSignalListeningHumanEditContextV1(access),key=before.configuration.questions.find(q=>q.topic_source==='discovered')!.key,root=f.roots[0]!;
  const removed=await human.correctSignalListeningTopicMembershipV1({...access,expected:before.expected,root_id:root,from_question_key:key,idempotency_key:randomUUID()});
  const labels=await human.readSignalListeningEffectiveTopicLabelsV1({...access,configuration_id:removed.configuration_id,map_id:f.map_id,root_ids:[root],question_keys:[key]});
  assert.equal(labels[0]!.human_belongs,false);
  const max=(await f.database.query("SELECT a.max_execution_micro_usd FROM signal_processing_policy_actions a JOIN signal_processing_policy_versions p ON p.id=a.policy_version_id JOIN signal_workspaces w ON w.organization_id=p.organization_id WHERE w.id=$1 AND p.status='active' AND a.action='mass_labeling_jev'",[f.workspace_id])).rows[0]!.max_execution_micro_usd;
  const admitted=await requestSignalListeningV1({...access,configuration_id:removed.configuration_id,map_id:f.map_id,idempotency_key:randomUUID(),cap_micro_usd:max===null?1000000:Math.min(1000000,Number(max)),provider_available:true});
  const store=createSignalListeningStoreV1({database:f.database,page_size:4096,storeRaw:async()=>{throw Error('no providers or raw writes');}}),run=await store.claim(admitted.run_id);assert.ok(run);
  try{
   const all=await store.inputs(run),bounded=await store.inputs(run,bounds);assert.deepEqual(bounded,all.slice(0,3));
   assert.ok(!all.some(i=>i.root_id===root&&i.question_keys.includes(key)),'human-corrected semantic question is never sent again');
   assert.ok(bounded.every(i=>i.author===null&&i.title===null&&i.language===null&&i.content_type===null));
   const decision=labels[0]!;
   assert.equal((await f.database.query('SELECT signal_listening_human_decision_exists_v1($1,$2,$3,$4,$5,$6,$7) exact',[f.workspace_id,removed.configuration_id,f.map_id,root,decision.input_digest,run.entity_context_digest,decision.question_digest])).rows[0].exact,true);
   assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[run.id])).rows[0].n,0);
  }finally{await store.release(run);}
 },{complete_listening:true,additional_defined_topic:true});
});

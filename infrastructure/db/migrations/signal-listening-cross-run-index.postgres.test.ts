import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {signalListeningBaseTemplateV1,buildSignalListeningJevRequestV1,signalListeningRequestDigestV1} from '@noisia/query-engine';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {localizeSyntheticListeningConfigurationV1} from './signal-listening-localized.synthetic.fixture';
import {createSignalListeningStoreV1,requestSignalListeningV1} from '../signal-listening-runs';
test('complete cross-run guard probes indexed tenant/root/question history and preserves native denials',{
 skip:process.env.NOISIA_R16_LISTENING_CROSS_RUN_INDEX_PG!=='true',timeout:600000,
},async()=>{
 await runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async ctx=>{
  const db=ctx.database,access={database:db,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
  assert.ok((await db.query("SELECT to_regclass('signal_listening_call_questions_scope_lookup') index")).rows[0].index,'cross-run lookup index must be installed');
  await db.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[ctx.run_id]);
  const base=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']});
  const questions=[...base.questions,...Array.from({length:126},(_,i)=>({key:'history_'+i,type:'noul' as const,text:'Configured historical question '+i,
   positive:'Positive criterion '+i,negative:'Other content',scope:'all' as const,origin:'brand_os' as const,human_locked:false}))];
  const store=createSignalListeningStoreV1({database:db,page_size:200,storeRaw:async()=>{throw Error('history setup never invokes transport or creates raw receipts');}});
  let revision=0,latest:string|null=null,targetRun:string|null=null,targetRoot:string|null=null,otherRoot:string|null=null;
  for(let generation=0;generation<24;generation++){
   const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:revision,provenance:'human',configuration:localizeSyntheticListeningConfigurationV1({...base,
    instructions:'Versioned native history instructions '+generation,questions})});revision=cfg.revision;latest=cfg.id;
   const admitted=await requestSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true});
   const run=await store.claim(admitted.run_id);assert.ok(run);const all=await store.inputs(run);assert.equal(all.length,3);
   const input=generation===23?all.slice(0,1):all;
   const calls=await store.reserve(run,input.map(i=>{const request=buildSignalListeningJevRequestV1(i,cfg.configuration),requestDigest=signalListeningRequestDigestV1(run,i,request);
    return {custom_id:'listening_'+requestDigest.slice(7,67),request_digest:requestDigest,request:request as unknown as Record<string,unknown>,inputs:[i],reserved_micro_usd:1000};}));
   // Invented transport outcomes exercise the native conservative exposure path;
   // no provider is constructed and no label or paid usage is fabricated.
   await store.markSubmitting(run,calls);await store.markFailed(run,calls,true);assert.equal(await store.finish(run),'failed');await store.release(run);
   if(generation===23){targetRun=run.id;targetRoot=input[0]!.root_id;otherRoot=all[1]!.root_id;}
  }
  assert.ok(latest&&targetRun&&targetRoot&&otherRoot);
  const history=(await db.query('SELECT count(*)::int n FROM signal_listening_call_questions WHERE workspace_id=$1',[ctx.workspace_id])).rows[0].n;
  assert.equal(history,8960);
  await db.query('ANALYZE signal_listening_call_questions');await db.query('ANALYZE signal_labeling_calls');await db.query('ANALYZE signal_labeling_runs');
  const digest=(await db.query('SELECT entity_context_digest FROM signal_mass_labeling_maps WHERE id=$1',[ctx.map_id])).rows[0].entity_context_digest;
  const values=[ctx.workspace_id,latest,ctx.map_id,digest,null,[targetRoot]];
  assert.equal((await db.query('SELECT signal_listening_prior_outcome_roots_v1($1,$2,$3,$4,$5,$6) blocked',values)).rows[0].blocked,true);
  assert.equal((await db.query('SELECT signal_listening_prior_outcome_roots_v1($1,$2,$3,$4,$5,$6) blocked',[...values.slice(0,4),targetRun,[targetRoot]])).rows[0].blocked,false,'the same run retains its recovery path');
  assert.equal((await db.query('SELECT signal_listening_prior_outcome_roots_v1($1,$2,$3,$4,$5,$6) blocked',[...values.slice(0,5),[otherRoot]])).rows[0].blocked,false,'history with different semantic questions does not contaminate a pending root');
  assert.equal((await db.query('SELECT signal_listening_prior_outcome_roots_v1($1,$2,$3,$4,$5,$6) blocked',[randomUUID(),...values.slice(1)])).rows[0].blocked,false,'foreign workspace never joins another tenant history');
  let source=(await db.query("SELECT prosrc FROM pg_proc WHERE oid='signal_listening_prior_outcome_roots_v1(uuid,uuid,uuid,text,uuid,uuid[])'::regprocedure")).rows[0].prosrc as string;
  for(const [name,value] of Object.entries({w:'$1::uuid',cid:'$2::uuid',mid:'$3::uuid',ctx:'$4::text',except_run:'$5::uuid',roots:'$6::uuid[]'}))source=source.replace(new RegExp('\\b'+name+'\\b','g'),value);
  const plan=(await db.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+source,values)).rows[0]['QUERY PLAN'][0].Plan;
  type Node={['Node Type']:string;['Relation Name']?:string;['Index Name']?:string;['Index Cond']?:string;['Actual Rows']:number;['Actual Loops']:number;Plans?:Node[]};
  const flatten=(n:Node):Node[]=>[n,...(n.Plans??[]).flatMap(flatten)],nodes=flatten(plan);
  const indexed=nodes.filter(n=>n['Index Name']==='signal_listening_call_questions_scope_lookup'&&n['Actual Loops']>0);
  console.log('# complete cross-run guard '+JSON.stringify({scope:'call',root_count:1,history_rows:history,nodes:nodes.map(n=>({node:n['Node Type'],relation:n['Relation Name'],index:n['Index Name'],cond:n['Index Cond'],rows:n['Actual Rows'],loops:n['Actual Loops']}))}));
  assert.ok(indexed.length>0,'the full guard must use the tenant/root/question lookup with the default planner');
  assert.match(indexed[0]!['Index Cond']??'',/workspace_id/);assert.match(indexed[0]!['Index Cond']??'',/root_id/);assert.match(indexed[0]!['Index Cond']??'',/question_digest/);
  assert.ok(!nodes.some(n=>n['Relation Name']==='signal_listening_call_questions'&&n['Node Type']==='Seq Scan'&&n['Actual Loops']>0),'each call must not scan the complete history');
  const global=(await db.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+source,[...values.slice(0,5),null])).rows[0]['QUERY PLAN'][0].Plan as Node;
  console.log('# complete cross-run guard '+JSON.stringify({scope:'admission',root_count:null,history_rows:history,nodes:flatten(global).map(n=>({node:n['Node Type'],relation:n['Relation Name'],index:n['Index Name'],cond:n['Index Cond'],rows:n['Actual Rows'],loops:n['Actual Loops']}))}));
  const before=(await db.query('SELECT count(*)::int n FROM signal_processing_admissions WHERE workspace_id=$1',[ctx.workspace_id])).rows[0].n;
  await assert.rejects(requestSignalListeningV1({...access,configuration_id:latest,map_id:ctx.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true}),/listening_prior_outcome_unresolved/);
  assert.equal((await db.query('SELECT count(*)::int n FROM signal_processing_admissions WHERE workspace_id=$1',[ctx.workspace_id])).rows[0].n,before,'a new key cannot reserve another execution for the ambiguous question');
 }});
});

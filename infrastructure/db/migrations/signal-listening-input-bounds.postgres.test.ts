import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {signalListeningBaseTemplateV1,buildSignalListeningJevRequestV1,signalListeningRequestDigestV1,type SignalListeningConfigurationV1} from '@noisia/query-engine';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {requestSignalListeningV1,createSignalListeningStoreV1} from '../signal-listening-runs';
test('native Listening reader bounds questions and text before hydrating an input',{
 skip:process.env.NOISIA_R16_INPUT_BOUNDS_PG!=='true',timeout:600000,
},async()=>runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async ctx=>{
 const access={database:ctx.database,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
 await ctx.database.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[ctx.run_id]);
 const template=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['bicycle']});
 const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:{...template,instructions:('Treat text as evidence. "Rules"\n').repeat(40),questions:[...template.questions,
  ...Array.from({length:16},(_,i)=>({key:'detail_'+i,type:'noul' as const,text:'Does this description contain the configured detail?',positive:('Detailed "positive" café.\n').repeat(40),negative:('Other text, "negative".\n').repeat(40),origin:'brand_os' as const,human_locked:false,scope:'all' as const}))]}});
 const admitted=await requestSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,cap_micro_usd:1000000,idempotency_key:'bounded-listening-native',provider_available:true});
 const reads:{ids:string[];costs:number[]}[]=[];let hydrated=0,race=false,changed=false;
 const database={query:ctx.database.query.bind(ctx.database),connect:async()=>{const c=await ctx.database.connect();return new Proxy(c,{get(target,key){if(key==='query')return async(sql:string,...values:unknown[])=>{
  const result=await(target.query as(...args:unknown[])=>Promise<{rows:Record<string,unknown>[]}>) (sql,...values);
  if(sql.includes('labeling_listening_input_metadata_v1')){
   assert.ok(result.rows.every(row=>Object.keys(row).sort().join(',')==='root_id,working_bytes'),'metadata returns no body, question definitions or query wire');assert.ok(Buffer.byteLength(JSON.stringify(result.rows))<4096);
   reads.push({ids:result.rows.map(row=>String(row.root_id)),costs:result.rows.map(row=>Number(row.working_bytes))});
   if(race&&!changed&&result.rows.length){changed=true;await saveSignalListeningConfigurationV1({...access,expected_revision:cfg.revision,provenance:'human',configuration:{...cfg.configuration,instructions:cfg.configuration.instructions+' New human revision.'}});}
  }
  if(sql.includes('SELECT p.*,row_number()')){hydrated++;const params=values[0] as unknown[];assert.ok(Array.isArray(params[6]),'hydrate uses root selector before its materialized population');assert.ok(result.rows.every(row=>(params[6] as string[]).includes(String(row.root_id))));}
  return result;
 };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}} as typeof ctx.database;
 const store=createSignalListeningStoreV1({database,page_size:4096,storeRaw:async()=>{throw Error('no provider or raw writes');}});
 const run=await store.claim(admitted.run_id);assert.ok(run);
 assert.deepEqual(await store.inputs(run,{max_rows:3,max_working_bytes:1}),[]);
 assert.equal(hydrated,0);
 await assert.rejects(store.inputs(run,{max_rows:3,max_working_bytes:1,on_oversize:'error'}),/labeling_input_memory_bound/);
 assert.equal((await store.inputs(run,{max_rows:1,max_working_bytes:512*1024*1024})).length,1);
 const all=await store.inputs(run,{max_rows:3,max_working_bytes:512*1024*1024});assert.equal(all.length,3);assert.equal(all[0]!.question_keys.length,18);
 const meta=reads.at(-1)!,request=buildSignalListeningJevRequestV1(all[0]!,cfg.configuration);
 assert.ok(Buffer.byteLength(JSON.stringify({request,inputs:[all[0]]}))*4+8192<=meta.costs[0]!, 'pre-hydration cost includes all eligible question wording and metadata');
 assert.deepEqual((await store.inputs(run,{max_rows:3,max_working_bytes:meta.costs[0]!+meta.costs[1]!-1})).map(row=>row.root_id),[all[0]!.root_id]);
 await assert.rejects(store.inputs({...run,workspace_id:randomUUID()},{max_rows:3,max_working_bytes:512*1024*1024}),/listening_run_unavailable/);
 assert.equal((await ctx.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[run.id])).rows[0].n,0);
 const request_digest=signalListeningRequestDigestV1(run,all[0]!,request);
 const calls=await store.reserve(run,[{custom_id:'listening_'+request_digest.slice(7,67),request_digest,request:request as unknown as Record<string,unknown>,inputs:[all[0]!],reserved_micro_usd:1000}]);
 assert.ok(!(await store.inputs(run,{max_rows:3,max_working_bytes:512*1024*1024})).some(row=>row.root_id===all[0]!.root_id));
 await store.markSubmitting(run,calls);await store.markFailed(run,calls,true);
 assert.ok(!(await store.inputs(run,{max_rows:3,max_working_bytes:512*1024*1024})).some(row=>row.root_id===all[0]!.root_id));
 const beforeFinish=hydrated;await store.finish(run);assert.equal(hydrated,beforeFinish);
 race=true;const snapshot=await store.inputs(run,{max_rows:1,max_working_bytes:512*1024*1024});assert.equal(changed,true);assert.equal(snapshot[0]!.configuration_digest,cfg.configuration_digest);
 const oldRequest=buildSignalListeningJevRequestV1(snapshot[0]!,run.identity.params.configuration as SignalListeningConfigurationV1),oldDigest=signalListeningRequestDigestV1(run,snapshot[0]!,oldRequest);
 await assert.rejects(store.reserve(run,[{custom_id:'listening_'+oldDigest.slice(7,67),request_digest:oldDigest,request:oldRequest as unknown as Record<string,unknown>,inputs:[snapshot[0]!],reserved_micro_usd:1000}]),/lease_lost|configuration_changed|run_not_running|listening_call_invalid/,'reserve rechecks current authority after snapshot closes');
 assert.equal((await ctx.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[run.id])).rows[0].n,1,'rejected stale snapshot creates no second reservation');
 await store.release(run);
}}));

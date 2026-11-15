import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {buildMassLabelingJevRequestV2,massLabelingConfigurationV2,signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {createMassLabelingStoreV1} from '../signal-mass-labeling';

test('native Mass reader selects a byte-bounded prefix before text hydration',{
 skip:process.env.NOISIA_R16_INPUT_BOUNDS_PG!=='true',timeout:600000,
},async()=>runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async ctx=>{
 const reads:{ids:string[];costs:number[]}[]=[];let hydrated=0,race=false,changed=false;
 const database={query:ctx.database.query.bind(ctx.database),connect:async()=>{const c=await ctx.database.connect();return new Proxy(c,{get(target,key){if(key==='query')return async(sql:string,...values:unknown[])=>{
  const result=await(target.query as(...args:unknown[])=>Promise<{rows:Record<string,unknown>[]}>) (sql,...values);
  if(sql.includes('labeling_mass_input_metadata_v')){
   assert.ok(result.rows.every(row=>Object.keys(row).sort().join(',')==='root_id,working_bytes'),'metadata must not return text, candidate definitions or query wire');
   assert.ok(Buffer.byteLength(JSON.stringify(result.rows))<4096);
   reads.push({ids:result.rows.map(row=>String(row.root_id)),costs:result.rows.map(row=>Number(row.working_bytes))});
   if(race&&!changed&&result.rows.length){changed=true;await ctx.database.query("UPDATE mentions SET platform='changed' WHERE workspace_id=$1 AND id=$2",[ctx.workspace_id,result.rows[0]!.root_id]);}
  }
  if(sql.startsWith('SELECT item.root_id,item.input_digest,item.text')){
   hydrated++;const params=values[0] as unknown[];assert.ok(Array.isArray(params[3]),'bounded hydrate must use explicit selected IDs');
   assert.ok(result.rows.every(row=>(params[3] as string[]).includes(String(row.root_id))));
  }return result;
 };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}} as typeof ctx.database;
 const store=createMassLabelingStoreV1({database,page_size:4096,storeRaw:async()=>{throw Error('no provider or raw writes');}});
 const run=await store.claim(ctx.run_id);assert.ok(run);
 const cursor=run.cursor_root_id;
 assert.deepEqual(await store.inputs(run,{max_rows:3,max_working_bytes:1}),[],'residual memory must never hydrate a root that cannot fit');
 assert.equal(hydrated,0);
 await assert.rejects(store.inputs(run,{max_rows:3,max_working_bytes:1,on_oversize:'error'}),/labeling_input_memory_bound/);
 const one=await store.inputs(run,{max_rows:1,max_working_bytes:512*1024*1024});assert.equal(one.length,1);
 const all=await store.inputs(run,{max_rows:3,max_working_bytes:512*1024*1024});assert.equal(all.length,3);
 const meta=reads.at(-1)!;const request=buildMassLabelingJevRequestV2(all[0]!,run.context,massLabelingConfigurationV2(run.identity.params));
 assert.ok(Buffer.byteLength(JSON.stringify({request,inputs:[all[0]]}))*4+8192<=meta.costs[0]!,'metadata bounds actual retained request plus input');
 assert.deepEqual((await store.inputs(run,{max_rows:3,max_working_bytes:meta.costs[0]!+meta.costs[1]!-1})).map(row=>row.root_id),[all[0]!.root_id],'stop at the first non-fitting root');
 assert.deepEqual(await store.inputs({...run,workspace_id:randomUUID()},{max_rows:3,max_working_bytes:512*1024*1024}),[]);
 assert.equal(run.cursor_root_id,cursor);
 assert.equal((await ctx.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[run.id])).rows[0].n,0);
 const request_digest=digest({request_version:run.identity.params.request_version,run_id:run.id,root_id:all[0]!.root_id,input_digest:all[0]!.input_digest,map_digest:all[0]!.map_digest,entity_context_digest:run.entity_context_digest,labeler_digest:run.labeler_digest,request});
 const calls=await store.reserve(run,[{custom_id:'mass_'+request_digest.slice(7,67),request_digest,request,inputs:[all[0]!],reserved_micro_usd:1000}]);
 assert.ok(!(await store.inputs(run,{max_rows:3,max_working_bytes:512*1024*1024})).some(row=>row.root_id===all[0]!.root_id),'reserved identities stay excluded');
 await store.markSubmitting(run,calls);await store.markFailed(run,calls,true);
 assert.ok(!(await store.inputs(run,{max_rows:3,max_working_bytes:512*1024*1024})).some(row=>row.root_id===all[0]!.root_id),'unknown identities stay excluded');
 const beforeFinish=hydrated;await store.finish(run);assert.equal(hydrated,beforeFinish,'finish probes metadata without hydrating another page');
 race=true;const snapshot=await store.inputs(run,{max_rows:1,max_working_bytes:512*1024*1024});assert.equal(changed,true);assert.equal(snapshot[0]!.platform,'synthetic','metadata and hydrate share a repeatable snapshot');
 await store.release(run);
}}));

test('bounded Mass context rejection never enumerates corpus text',{
 skip:process.env.NOISIA_R16_INPUT_BOUNDS_PG!=='true',timeout:600000,
},async()=>runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async ctx=>{
 const queries:string[]=[];
 const database={query:ctx.database.query.bind(ctx.database),connect:async()=>{const c=await ctx.database.connect();return new Proxy(c,{get(target,key){if(key==='query')return async(sql:string,...values:unknown[])=>{queries.push(sql);return(target.query as(...args:unknown[])=>Promise<unknown>)(sql,...values);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}} as typeof ctx.database;
 const store=createMassLabelingStoreV1({database,page_size:4096,storeRaw:async()=>{throw Error('no provider or raw writes');}});
 const run=await store.claim(ctx.run_id);assert.ok(run);
 await ctx.database.query("UPDATE brands SET display_name='Edited synthetic identity' WHERE id=(SELECT brand_id FROM signal_workspaces WHERE id=$1)",[ctx.workspace_id]);
 queries.length=0;
 await assert.rejects(store.inputs(run,{max_rows:1,max_working_bytes:512*1024*1024}),/mass_labeling_context_changed/);
 assert.ok(queries.every(sql=>!sql.includes('WITH labeled_entities AS')&&!sql.includes('mention.text_clean full_text')),'reject using identity digest, without reading every canonical corpus root');
 assert.equal((await ctx.database.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[run.id])).rows[0].n,0);
 await store.release(run);
}}));

import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,open,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import {signalListeningBaseTemplateV1,buildSignalListeningJevRequestV1,signalListeningRequestDigestV1,mapSignalListeningJevResponseV1,type SignalListeningInputV1,type SignalListeningConfigurationV1} from '@noisia/query-engine';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {localizeSyntheticListeningConfigurationV1} from './signal-listening-localized.synthetic.fixture';
import {createSignalListeningStoreV1,requestSignalListeningV1} from '../signal-listening-runs';
import type {LabelingRunV1} from '../signal-labeling-runs';
import {jevUsageV1} from '../../../services/workers/src/workers/signal-jev-labeling-page';
export type SharedWireFixtureV1={database:Parameters<typeof createSignalListeningStoreV1>[0]['database'];run:LabelingRunV1;inputs:SignalListeningInputV1[];configuration:SignalListeningConfigurationV1;configuration_id:string;map_id:string;store:ReturnType<typeof createSignalListeningStoreV1>;rawPages:NonNullable<Parameters<typeof createSignalListeningStoreV1>[0]['rawPages']>};
export async function withSharedWireFixtureV1(body:(f:SharedWireFixtureV1)=>Promise<void>,configuration=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']}),options:{mode?:'scaled_recovery';consumer_category?:boolean}={}){
 const mode=options.mode==='scaled_recovery'?'product-recovery':'product',rootCount=mode==='product-recovery'?1002:3;
 // Existing product-recovery WITHOUT benchmark creates its own migrated clone.
 // Never enter the global accredited benchmark Pool or widen a source guard.
 await runMassLabelingAcceptanceFixtureV1(mode,{seed_published_at:'2026-01-01T00:00:00.123456Z',beforeProcessing:async ctx=>{
  const database=ctx.database,access={database,workspace_id:ctx.workspace_id,actor_user_id:ctx.actor_user_id};
  assert.equal((await database.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1 AND workspace_id=$2 AND status='queued' AND NOT EXISTS(SELECT 1 FROM signal_labeling_calls WHERE run_id=$1) RETURNING id",[ctx.run_id,ctx.workspace_id])).rows.length,1);
  const cfg=await saveSignalListeningConfigurationV1({...access,expected_revision:0,provenance:'human',configuration:localizeSyntheticListeningConfigurationV1(configuration)});
  const requested=await requestSignalListeningV1({...access,configuration_id:cfg.id,map_id:ctx.map_id,idempotency_key:randomUUID(),cap_micro_usd:1000000,provider_available:true});
  const files=await mkdtemp(join(tmpdir(),'r16-shared-wire-'));
  const rawPages:SharedWireFixtureV1['rawPages']={reference:a=>({storage_key:`private/${a.workspace_id}/${a.run_id}/${a.name}.${a.raw_sha256.slice(7)}.parts.json`}),
   store:async a=>{const path=join(files,a.raw_sha256.slice(7));await writeFile(path,a.raw_text,{flag:'wx'});const fd=await open(path,'r+');try{await fd.sync();}finally{await fd.close();}assert.equal(await readFile(path,'utf8'),a.raw_text);return{storage_key:rawPages.reference(a).storage_key,sha256:a.raw_sha256,size_bytes:a.size_bytes,verified:true};},load:a=>readFile(join(files,a.sha256.slice(7)),'utf8')};
  const store=createSignalListeningStoreV1({database,rawPages,page_size:mode==='product-recovery'?4096:undefined,storeRaw:async()=>{throw Error('no provider/individual RAW');}}),run=await store.claim(requested.run_id);assert.ok(run);
  try{const inputs=await store.inputs(run);assert.equal(inputs.length,rootCount);const fixture={database,run,inputs,configuration:cfg.configuration,configuration_id:cfg.id,map_id:ctx.map_id,store,rawPages};
   if(options.consumer_category){
    assert.ok(fixture.inputs.every(i=>i.question_keys.length===2&&i.question_keys.includes('voice')&&i.question_keys.includes('promotion')));
    const base=await prepareSharedWireRawV1(fixture,500);await store.apply(run,base.map(o=>({call:o.call,results:[o.result]})));
    fixture.inputs=await store.inputs(run);assert.equal(fixture.inputs.length,rootCount);
    assert.ok(fixture.inputs.every(i=>i.question_keys.length===2&&i.question_keys.every(k=>k!=='voice'&&k!=='promotion')&&Object.keys(i.scope_basis).length===2),'consumer2 carries real nonempty scope_basis derived by native cached base calls');
   }
   await body(fixture);}

  finally{await store.release(run);await rm(files,{recursive:true,force:true});}
 }});
}
export function sharedWireProposalsV1(f:Pick<SharedWireFixtureV1,'run'|'inputs'|'configuration'>,reservedMicroUsd=1000){return f.inputs.map(input=>{const request=buildSignalListeningJevRequestV1(input,f.configuration),request_digest=signalListeningRequestDigestV1(f.run,input,request);return{id:randomUUID(),custom_id:'listening_'+request_digest.slice(7,67),request_digest,request,inputs:[structuredClone(input)],reserved_micro_usd:reservedMicroUsd};});}
export async function insertSharedWireCallsV1(c:PoolClient,f:Pick<SharedWireFixtureV1,'run'>,rows:ReturnType<typeof sharedWireProposalsV1>){return c.query(`INSERT INTO signal_labeling_calls(id,run_id,workspace_id,provider,model,transport,custom_id,request_digest,request,inputs,reserved_micro_usd,budget_date,budget_timezone)
 SELECT x.id,$1,$2,'typesafe','jev-1.13.0','sync',x.custom_id,x.request_digest,x.request,x.inputs,x.reserved_micro_usd,a.budget_date,a.budget_timezone
 FROM jsonb_to_recordset($3::jsonb) x(id uuid,custom_id text,request_digest text,request jsonb,inputs jsonb,reserved_micro_usd bigint) JOIN signal_processing_admissions a ON a.id=$4 RETURNING id`,[f.run.id,f.run.workspace_id,JSON.stringify(rows),f.run.processing_admission_id]);}
// Native admission capacity (0155) requires fresh READ COMMITTED writers.
// The independent SELECT comparison alone retains one RR read-only snapshot.
export async function withSharedWireTxV1(f:SharedWireFixtureV1,body:(c:PoolClient)=>Promise<void>,readOnly=false){const c=await f.database.connect();try{await c.query(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE');await body(c);await c.query('ROLLBACK');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
export async function prepareSharedWireRawV1(f:SharedWireFixtureV1,reservedMicroUsd=1000){const calls=await f.store.reserve(f.run,sharedWireProposalsV1(f,reservedMicroUsd));await f.store.markSubmitting(f.run,calls);
 const outcomes=calls.map(call=>{const input=call.inputs[0]!,request=buildSignalListeningJevRequestV1(input,f.configuration),response={model:f.configuration.model,usage:{input_tokens:120,output_tokens:20},answers:Object.fromEntries(Object.entries(request.questions).map(([key,q])=>[key,q.type==='noul'?{type:'noul' as const,noul:key==='promotion'?.1:.9}:{type:'choice' as const,choice:'individual',confidence:.9,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k==='individual'?.9:.1/(Object.keys(q.criteria).length-1)]))}]))};return{call,raw:JSON.stringify({http_status:200,latency_ms:100,body:JSON.stringify(response)}),result:mapSignalListeningJevResponseV1(input,f.run.context,f.configuration,response)};});
 await f.store.persistRawPage(f.run,outcomes);await f.store.settlePage(f.run,outcomes.map(o=>({call:o.call,usage:jevUsageV1({input_tokens:120,output_tokens:20}),settled_micro_usd:6})));return outcomes;
}

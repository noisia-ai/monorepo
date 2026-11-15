import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,open,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import type {PoolClient} from 'pg';
import {buildMassLabelingJevRequestV2,massLabelingConfigurationV2,signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';
import {createMassLabelingStoreV1} from '../signal-mass-labeling';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
type Context=Parameters<NonNullable<NonNullable<Parameters<typeof runMassLabelingAcceptanceFixtureV1>[1]>['beforeProcessing']>>[0];
const enabled=process.env.NOISIA_R16_RAW_PAGE_LOCKS_PG==='true';
const delay=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};}
async function fixture(fn:(x:{context:Context;store:ReturnType<typeof createMassLabelingStoreV1>;run:NonNullable<Awaited<ReturnType<ReturnType<typeof createMassLabelingStoreV1>['claim']>>>;calls:Awaited<ReturnType<ReturnType<typeof createMassLabelingStoreV1>['reserve']>>;intercept:{after?:(sql:string,c:PoolClient)=>Promise<void>};writes:()=>number})=>Promise<void>){
 await runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async context=>{
  const files=await mkdtemp(join(tmpdir(),'r16-page-lock-')),intercept:{after?:(sql:string,c:PoolClient)=>Promise<void>}={};let writes=0;
  const database={query:context.database.query.bind(context.database),connect:async()=>{
   const c=await context.database.connect();return new Proxy(c,{get(target,key){if(key==='query')return async(sql:string,...args:unknown[])=>{
    const result=await(target.query as (...a:unknown[])=>Promise<unknown>)(sql,...args);await intercept.after?.(sql,target);return result;
   };const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});
  }} as Context['database'];
  try{
   const rawPages={reference:(a:{workspace_id:string;run_id:string;name:string})=>({storage_key:`private/${a.workspace_id}/${a.run_id}/${a.name}`}),
    store:async(a:{workspace_id:string;run_id:string;name:string;raw_text:string;raw_sha256:string;size_bytes:number})=>{writes++;const path=join(files,a.name);await writeFile(path,a.raw_text);const f=await open(path,'r+');try{await f.sync();}finally{await f.close();}assert.equal(await readFile(path,'utf8'),a.raw_text);return{...rawPages.reference(a),sha256:a.raw_sha256,size_bytes:a.size_bytes,verified:true as const};},
    load:async(a:{storage_key:string})=>readFile(join(files,a.storage_key.split('/').at(-1)!),'utf8')};
   const store=createMassLabelingStoreV1({database,rawPages,storeRaw:async()=>{throw Error('individual raw forbidden');}});
   const run=await store.claim(context.run_id);assert.ok(run);const inputs=await store.inputs(run),configuration=massLabelingConfigurationV2(run.identity.params);
   const calls=await store.reserve(run,inputs.map(input=>{const request=buildMassLabelingJevRequestV2(input,run.context,configuration,run.identity.model);
    const request_digest=digest({request_version:run.identity.params.request_version,run_id:run.id,root_id:input.root_id,input_digest:input.input_digest,map_digest:input.map_digest,entity_context_digest:run.entity_context_digest,labeler_digest:run.labeler_digest,request});
    return{custom_id:'mass_'+request_digest.slice(7,67),request_digest,request,inputs:[input],reserved_micro_usd:1000};}));assert.equal(calls.length,3);await store.markSubmitting(run,calls);
   await fn({context,store,run,calls,intercept,writes:()=>writes});
  }finally{await rm(files,{recursive:true,force:true});}
 }});
}
for(const phase of ['plan','attach'] as const)test(`disjoint raw pages progress concurrently while ${phase} holds its run fence`,{skip:!enabled,timeout:120000},async()=>{
 await fixture(async({context,store,run,calls,intercept})=>{
  if(phase==='plan'&&process.env.NOISIA_R16_LOCK_AUDIT_PATH){
   const tables=['signal_labeling_runs','signal_labeling_calls','signal_labeling_raw_pages','signal_labeling_raw_page_members'];
   const triggers=(await context.database.query(`SELECT c.relname table_name,t.tgname,pg_get_triggerdef(t.oid) definition,p.proname,p.prosrc FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1::text[]) ORDER BY c.relname,t.tgname`,[tables])).rows;
   const foreign_keys=(await context.database.query(`SELECT conrelid::regclass::text table_name,confrelid::regclass::text referenced_table,conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE contype='f' AND(conrelid=ANY(SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1::text[])) OR confrelid=ANY(SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1::text[]))) ORDER BY conrelid::regclass::text,conname`,[tables])).rows;
   await writeFile(process.env.NOISIA_R16_LOCK_AUDIT_PATH,JSON.stringify({triggers,foreign_keys},null,2));
  }
  const held=deferred(),release=deferred();let caught=false;
  intercept.after=async sql=>{const hit=phase==='plan'?/SELECT id FROM signal_labeling_runs|WITH raw_run_fence/u.test(sql):/SELECT \* FROM signal_labeling_raw_pages WHERE id=\$1 AND workspace_id/u.test(sql);
   if(hit&&!caught){caught=true;held.resolve();await release.promise;}};
  const first=store.persistRawPage(run,[{call:calls[0]!,raw:'first exact paid wrapper'}]);await held.promise;
  const writer=await context.database.connect();try{await writer.query('BEGIN');await writer.query("SET LOCAL lock_timeout='100ms'");
   await assert.rejects(writer.query("UPDATE signal_labeling_runs SET lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes' WHERE id=$1",[run.id]),(e:unknown)=>typeof e==='object'&&e!==null&&'code'in e&&e.code==='55P03','the shared raw fence must block a lease writer');
  }finally{await writer.query('ROLLBACK');writer.release();}
  const second=store.persistRawPage(run,[{call:calls[1]!,raw:'second exact paid wrapper'}]);
  const outcome=await Promise.race([second.then(()=>true),delay(1500).then(()=>false)]);release.resolve();await Promise.all([first,second]);
  assert.equal(outcome,true,'a disjoint page must commit plan and attach before the first raw transaction releases its run fence');
  const money=(await context.database.query("SELECT sum(reserved_micro_usd)::text reserved,count(*) FILTER(WHERE settled_micro_usd IS NOT NULL)::int settled FROM signal_labeling_calls WHERE run_id=$1",[run.id])).rows[0];assert.equal(money.reserved,'3000');assert.equal(money.settled,0);
  assert.equal((await context.database.query("SELECT count(*)::int n FROM signal_labeling_raw_pages WHERE run_id=$1 AND status='verified'",[run.id])).rows[0].n,2);
 });
});
test('a raw fence checks physical lease expiry after waiting for a run writer',{skip:!enabled,timeout:120000},async()=>{
 await fixture(async({context,store,run,calls,writes})=>{
  await context.database.query("UPDATE signal_labeling_runs SET lease_until=clock_timestamp()+interval '200 milliseconds' WHERE id=$1",[run.id]);
  const blocker=await context.database.connect();await blocker.query('BEGIN');await blocker.query('SELECT id FROM signal_labeling_runs WHERE id=$1 FOR UPDATE',[run.id]);
  const pending=store.persistRawPage(run,[{call:calls[0]!,raw:'receipt that must not attach under an expired lease'}]);const observed=pending.then(()=>null,e=>e);
  await delay(350);await blocker.query('COMMIT');blocker.release();
  assert.match(String(await observed),/labeling_lease_lost/);assert.equal(writes(),0);
  assert.equal((await context.database.query('SELECT count(*)::int n FROM signal_labeling_raw_pages WHERE run_id=$1',[run.id])).rows[0].n,0);
 });
});
for(const fault of ['rollback','commit_ack'] as const)test(`raw ${fault} recovery preserves exact bytes and existing budget`,{skip:!enabled,timeout:120000},async()=>{
 await fixture(async({context,store,run,calls,intercept,writes})=>{
  let attaching=false,failed=false;intercept.after=async sql=>{if(/UPDATE signal_labeling_calls c SET raw_sha256=m.raw_sha256/u.test(sql)){
   attaching=true;if(fault==='rollback'&&!failed){failed=true;throw Error('synthetic attach rollback');}}
   if(sql==='COMMIT'&&attaching&&!failed){failed=true;throw Error('synthetic committed ACK lost');}};
  const raw='untouched physical wrapper – café';await assert.rejects(store.persistRawPage(run,[{call:calls[0]!,raw}]),/synthetic/);intercept.after=undefined;
  const loaded=await store.calls(run);assert.equal(loaded.find(c=>c.id===calls[0]!.id)?.raw_body,raw);assert.equal(writes(),1,'receipt recovery reads storage instead of rewriting or calling a provider');
  assert.equal((await context.database.query("SELECT status FROM signal_labeling_raw_pages WHERE run_id=$1",[run.id])).rows[0].status,'verified');
  const call=(await context.database.query('SELECT status,reserved_micro_usd::text,settled_micro_usd,usage FROM signal_labeling_calls WHERE id=$1',[calls[0]!.id])).rows[0];assert.deepEqual(call,{status:'submitting',reserved_micro_usd:'1000',settled_micro_usd:null,usage:null});
 });
});
test('expiry between upload and attach leaves a recoverable page for a new lease',{skip:!enabled,timeout:120000},async()=>{
 await fixture(async({context,store,run,calls,intercept,writes})=>{
  let expired=false;intercept.after=async sql=>{if(sql==='COMMIT'&&!expired){expired=true;await context.database.query("UPDATE signal_labeling_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[run.id]);}};
  const raw='exact wrapper stored after the planning lease expired';
  await assert.rejects(store.persistRawPage(run,[{call:calls[0]!,raw}]),/labeling_lease_lost/);intercept.after=undefined;
  assert.equal(writes(),1);assert.equal((await context.database.query('SELECT status FROM signal_labeling_raw_pages WHERE run_id=$1',[run.id])).rows[0].status,'planned');
  const next=await store.claim(run.id);assert.ok(next);assert.notEqual(next.lease_token,run.lease_token);
  const loaded=await store.calls(next);assert.equal(loaded.find(c=>c.id===calls[0]!.id)?.raw_body,raw);assert.equal(writes(),1);
  assert.equal((await context.database.query('SELECT status FROM signal_labeling_raw_pages WHERE run_id=$1',[run.id])).rows[0].status,'verified');
 });
});

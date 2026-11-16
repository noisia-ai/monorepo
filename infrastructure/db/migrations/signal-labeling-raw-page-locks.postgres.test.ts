import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,open,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import type {PoolClient} from 'pg';
import {buildMassLabelingJevRequestV2,massLabelingConfigurationV2,mapMassLabelingJevResponseV2,llmPriceV1,llmCostMicroUsdV1,signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';
import {createMassLabelingStoreV1} from '../signal-mass-labeling';
import {jevUsageV1} from '../../../services/workers/src/workers/signal-jev-labeling-page';
import {processMassLabelingJevV1} from '../../../services/workers/src/workers/signal-mass-labeling-jev';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
type Context=Parameters<NonNullable<NonNullable<Parameters<typeof runMassLabelingAcceptanceFixtureV1>[1]>['beforeProcessing']>>[0];
const enabled=process.env.NOISIA_R16_RAW_PAGE_LOCKS_PG==='true';
const delay=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};}
async function fixture(fn:(x:{context:Context;store:ReturnType<typeof createMassLabelingStoreV1>;run:NonNullable<Awaited<ReturnType<ReturnType<typeof createMassLabelingStoreV1>['claim']>>>;calls:Awaited<ReturnType<ReturnType<typeof createMassLabelingStoreV1>['reserve']>>;intercept:{before?:(sql:string,c:PoolClient)=>Promise<void>;after?:(sql:string,c:PoolClient)=>Promise<void>};writes:()=>number})=>Promise<void>,options:{mark_initial?:boolean;raw_pages?:boolean}={}){
 await runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async context=>{
  const files=await mkdtemp(join(tmpdir(),'r16-page-lock-')),intercept:{before?:(sql:string,c:PoolClient)=>Promise<void>;after?:(sql:string,c:PoolClient)=>Promise<void>}={};let writes=0;
  const database={query:context.database.query.bind(context.database),connect:async()=>{
   const c=await context.database.connect();return new Proxy(c,{get(target,key){if(key==='query')return async(sql:string,...args:unknown[])=>{
    await intercept.before?.(sql,target);const result=await(target.query as (...a:unknown[])=>Promise<unknown>)(sql,...args);await intercept.after?.(sql,target);return result;
   };const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});
  }} as Context['database'];
  try{
   const rawPages={reference:(a:{workspace_id:string;run_id:string;name:string})=>({storage_key:`private/${a.workspace_id}/${a.run_id}/${a.name}`}),
    store:async(a:{workspace_id:string;run_id:string;name:string;raw_text:string;raw_sha256:string;size_bytes:number})=>{writes++;const path=join(files,a.name);await writeFile(path,a.raw_text);const f=await open(path,'r+');try{await f.sync();}finally{await f.close();}assert.equal(await readFile(path,'utf8'),a.raw_text);return{...rawPages.reference(a),sha256:a.raw_sha256,size_bytes:a.size_bytes,verified:true as const};},
    load:async(a:{storage_key:string})=>readFile(join(files,a.storage_key.split('/').at(-1)!),'utf8')};
   const store=createMassLabelingStoreV1({database,...(options.raw_pages===false?{}:{rawPages}),storeRaw:async()=>{throw Error('individual raw forbidden');}});
   const run=await store.claim(context.run_id);assert.ok(run);const inputs=await store.inputs(run),configuration=massLabelingConfigurationV2(run.identity.params);
   const calls=await store.reserve(run,inputs.map(input=>{const request=buildMassLabelingJevRequestV2(input,run.context,configuration,run.identity.model);
    const request_digest=digest({request_version:run.identity.params.request_version,run_id:run.id,root_id:input.root_id,input_digest:input.input_digest,map_digest:input.map_digest,entity_context_digest:run.entity_context_digest,labeler_digest:run.labeler_digest,request});
    return{custom_id:'mass_'+request_digest.slice(7,67),request_digest,request,inputs:[input],reserved_micro_usd:1000};}));assert.equal(calls.length,3);if(options.mark_initial!==false)await store.markSubmitting(run,calls);
   await fn({context,store,run,calls,intercept,writes:()=>writes});
  }finally{await rm(files,{recursive:true,force:true});}
 }});
}
test('generic mass labeling with RAW pages retains its default reservation cursor',{skip:!enabled,timeout:120000},async()=>{
 await fixture(async({context,run,calls})=>{
  const last=calls.flatMap(c=>c.inputs.map(i=>i.root_id)).sort().at(-1)!;
  assert.equal(run.cursor_root_id,last);
  assert.equal((await context.database.query('SELECT cursor_root_id FROM signal_labeling_runs WHERE id=$1',[run.id])).rows[0].cursor_root_id,last);
 });
});
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
test('same-page plan reentry and attach use one call/page lock order',{skip:!enabled,timeout:120000},async()=>{
 await fixture(async({context,store,run,calls,intercept,writes})=>{
  const attachHeld=deferred(),releaseAttach=deferred(),planCallsHeld=deferred(),releasePlan=deferred();let attachCaught=false,reentry=false,planCaught=false;
  intercept.after=async sql=>{
   if(/SELECT \* FROM signal_labeling_raw_pages WHERE id=\$1 AND workspace_id/u.test(sql)&&!attachCaught){attachCaught=true;attachHeld.resolve();await releaseAttach.promise;}
   if(reentry&&!planCaught&&/SELECT id,request_digest,raw_sha256,raw_storage_key FROM signal_labeling_calls/u.test(sql)){planCaught=true;planCallsHeld.resolve();await releasePlan.promise;}
  };
  const raw='the same immutable physical wrapper',first=store.persistRawPage(run,[{call:calls[0]!,raw}]);await attachHeld.promise;
  reentry=true;const second=store.persistRawPage(run,[{call:calls[0]!,raw}]);
  const reentryOwnsCalls=await Promise.race([planCallsHeld.promise.then(()=>true),delay(200).then(()=>false)]);
  releaseAttach.resolve();if(reentryOwnsCalls)await delay(50);releasePlan.resolve();
  const results=await Promise.allSettled([first,second]);
  for(const result of results)assert.equal(result.status,'fulfilled',result.status==='rejected'?String(result.reason):'same-page retry must serialize without 40P01');
  assert.equal((await context.database.query('SELECT count(*)::int n FROM signal_labeling_raw_pages WHERE run_id=$1',[run.id])).rows[0].n,1);
  assert.equal((await context.database.query('SELECT count(*)::int n FROM signal_labeling_raw_page_members WHERE run_id=$1',[run.id])).rows[0].n,1);
  assert.equal((await store.calls(run)).find(c=>c.id===calls[0]!.id)?.raw_body,raw);assert.ok(writes()>=1&&writes()<=2);
 });
});


async function readyForApply(f:Parameters<Parameters<typeof fixture>[0]>[0],index=0){
 const call=f.calls[index]!,configuration=massLabelingConfigurationV2(f.run.identity.params);
 const request=buildMassLabelingJevRequestV2(call.inputs[0]!,f.run.context,configuration,f.run.identity.model);
 const response={model:request.model,usage:{input_tokens:100,output_tokens:0},answers:Object.fromEntries(Object.entries(request.questions).map(([key,q])=>[key,q.type==='noul'
  ?{type:'noul' as const,noul:.8}:{type:'choice' as const,choice:Object.keys(q.criteria)[0]!,confidence:.9,
   probabilities:Object.fromEntries(Object.keys(q.criteria).map((option,i,all)=>[option,i===0?.9:.1/(all.length-1)]))}]))};
 const raw=JSON.stringify({http_status:200,latency_ms:100,body:JSON.stringify(response)}),usage=jevUsageV1(response.usage);
 await f.store.persistRawPage(f.run,[{call,raw}]);await f.store.settlePage(f.run,[{call,usage,
  settled_micro_usd:llmCostMicroUsdV1(usage,llmPriceV1('typesafe',f.run.identity.model,'sync',.042))}]);
 return{call,results:[mapMassLabelingJevResponseV2(call.inputs[0]!,f.run.context,configuration,response)]};
}

test('a disjoint HTTP cohort can be marked while raw planning retains the same lease', {skip:!enabled,timeout:120000},async()=>{
 await fixture(async({context,store,run,calls,intercept})=>{
  await store.markSubmitting(run,[calls[0]!]);const held=deferred(),release=deferred();let caught=false;
  intercept.after=async sql=>{if(!caught&&sql.includes('WITH raw_run_fence')){caught=true;held.resolve();await release.promise;}};
  const paid=store.persistRawPage(run,[{call:calls[0]!,raw:'exact synthetic first receipt'}]);await held.promise;
  let progressed=false,beforeRelease=false;const marked=store.markSubmitting(run,[calls[1]!]).then(()=>{progressed=true;});
  try{beforeRelease=await Promise.race([marked.then(()=>true),delay(750).then(()=>false)]);}finally{release.resolve();await Promise.all([paid,marked]);}
  assert.equal(progressed,true);assert.equal(beforeRelease,true,'a disjoint mark must commit without waiting for raw custody on another call');
  const states=(await context.database.query('SELECT id,status,settled_micro_usd FROM signal_labeling_calls WHERE run_id=$1 ORDER BY id',[run.id])).rows;
  assert.equal(states.filter(row=>row.status==='submitting').length,2);assert.equal(states.filter(row=>row.status==='reserved').length,1);
  assert.ok(states.every(row=>row.settled_micro_usd===null));
 },{mark_initial:false});
});

test('a disjoint raw page can persist while an application transaction retains the same lease',{skip:!enabled,timeout:120000},async()=>{
 await fixture(async f=>{
  const page=await readyForApply(f),held=deferred(),release=deferred();let caught=false,progressed=false,beforeRelease=false;
  f.intercept.after=async sql=>{if(!caught&&(/SELECT id FROM signal_labeling_runs|WITH raw_run_fence/u.test(sql))){caught=true;held.resolve();await release.promise;}};
  const applying=f.store.apply(f.run,[page]);await held.promise;
  const raw=f.store.persistRawPage(f.run,[{call:f.calls[1]!,raw:'disjoint exact receipt during apply'}]).then(()=>{progressed=true;});
  try{beforeRelease=await Promise.race([raw.then(()=>true),delay(750).then(()=>false)]);}finally{release.resolve();await Promise.all([applying,raw]);}
  assert.equal(progressed,true);assert.equal(beforeRelease,true,'disjoint custody must not wait for another page application');
  assert.equal((await f.context.database.query('SELECT count(*)::int n FROM signal_mass_labeling_results WHERE call_id=$1',[page.call.id])).rows[0].n,1);
 });
});


for(const operation of ['mark','apply']as const)test(`native ${operation} rolls back every mutation when COMMIT waits past lease expiry`,{skip:!enabled,timeout:120000},async()=>{
 await fixture(async f=>{
  const page=operation==='apply'?await readyForApply(f):null,call=f.calls[0]!;
  const before=(await f.context.database.query('SELECT status,results_applied,results,settled_micro_usd FROM signal_labeling_calls WHERE id=$1',[call.id])).rows[0];
  const fences=Number((await f.context.database.query('SELECT count(*)::int n FROM signal_labeling_page_mutation_fences WHERE run_id=$1',[f.run.id])).rows[0].n);
  await f.context.database.query("UPDATE signal_labeling_runs SET lease_until=clock_timestamp()+interval '1500 milliseconds' WHERE id=$1",[f.run.id]);
  let commitAttempted=false;
  f.intercept.before=async sql=>{if(sql==='COMMIT'&&!commitAttempted){commitAttempted=true;await delay(1650);}};
  await assert.rejects(operation==='mark'?f.store.markSubmitting(f.run,[call]):f.store.apply(f.run,[page!]),/labeling_lease_lost/);
  assert.equal(commitAttempted,true,'the deferred guard, rather than an early clock check, must reject COMMIT');
  assert.deepEqual((await f.context.database.query('SELECT status,results_applied,results,settled_micro_usd FROM signal_labeling_calls WHERE id=$1',[call.id])).rows[0],before);
  assert.equal(Number((await f.context.database.query('SELECT count(*)::int n FROM signal_labeling_page_mutation_fences WHERE run_id=$1',[f.run.id])).rows[0].n),fences,'failed transaction leaves no committed fence');
  assert.equal((await f.context.database.query('SELECT count(*)::int n FROM signal_mass_labeling_results WHERE call_id=$1',[call.id])).rows[0].n,0);
 },{mark_initial:operation==='apply'});
});

test('identical and partial page replays preserve original results while divergent replay rolls back',{skip:!enabled,timeout:120000},async()=>{
 await fixture(async f=>{
  const first=await readyForApply(f);await f.store.apply(f.run,[first]);
  const prior=(await f.context.database.query('SELECT results,results_applied,updated_at::text stamp FROM signal_labeling_calls WHERE id=$1',[first.call.id])).rows[0];
  const fenceCount=async()=>Number((await f.context.database.query('SELECT count(*)::int n FROM signal_labeling_page_mutation_fences WHERE run_id=$1',[f.run.id])).rows[0].n);
  const n=await fenceCount();await f.store.apply(f.run,[first]);assert.equal(await fenceCount(),n,'identical replay does not create a new mutation');
  const changed=structuredClone(first);changed.results[0]!.probabilities!.promotion={type:'noul',noul:.2};
  await assert.rejects(f.store.apply(f.run,[changed]),/labeling_result_replay_conflict/);
  assert.deepEqual((await f.context.database.query('SELECT results,results_applied,updated_at::text stamp FROM signal_labeling_calls WHERE id=$1',[first.call.id])).rows[0],prior);
  const second=await readyForApply(f,1);await f.store.apply(f.run,[first,second]);assert.equal(await fenceCount(),n+1);
  assert.deepEqual((await f.context.database.query('SELECT results,results_applied,updated_at::text stamp FROM signal_labeling_calls WHERE id=$1',[first.call.id])).rows[0],prior);
  assert.equal((await f.context.database.query('SELECT count(*)::int n FROM signal_mass_labeling_results WHERE run_id=$1',[f.run.id])).rows[0].n,2);
 });
});

for(const divergent of [false,true])test(`overlapping page application in reverse order serializes exact rows (divergent ${divergent})`,{skip:!enabled,timeout:120000},async()=>{
 await fixture(async f=>{
  const a=await readyForApply(f),b=await readyForApply(f,1),held=deferred(),release=deferred();let caught=false;
  f.intercept.after=async sql=>{if(!caught&&sql.includes('WHERE workspace_id=$1 AND run_id=$2 AND id=ANY($3::uuid[]) ORDER BY id FOR UPDATE')){caught=true;held.resolve();await release.promise;}};
  const first=f.store.apply(f.run,[a,b]);await held.promise;
  const copy=structuredClone(a);if(divergent)copy.results[0]!.probabilities!.promotion={type:'noul',noul:.2};
  const second=f.store.apply(f.run,[b,copy]);const observed=second.then(()=>({ok:true}),error=>({ok:false,error}));
  let completedBeforeRelease=false;
  try{completedBeforeRelease=await Promise.race([observed.then(()=>true),delay(150).then(()=>false)]);}finally{release.resolve();await first;}
  assert.equal(completedBeforeRelease,false,'same call rows remain serialized despite the shared run fence');
  const result=await observed;if(divergent){assert.equal(result.ok,false);assert.match(String('error'in result?result.error:''),/labeling_result_replay_conflict/);}else assert.equal(result.ok,true);
  const rows=(await f.context.database.query('SELECT call_id,probabilities FROM signal_mass_labeling_results WHERE run_id=$1 ORDER BY call_id',[f.run.id])).rows;
  assert.equal(rows.length,2);assert.ok(rows.every(row=>row.probabilities.promotion.noul===.8));
 });
});

test('mark rechecks physical lease time after waiting for the organization authority lock',{skip:!enabled,timeout:120000},async()=>{
 await fixture(async f=>{
  const org=String((await f.context.database.query('SELECT organization_id FROM signal_workspaces WHERE id=$1',[f.run.workspace_id])).rows[0].organization_id);
  const blocker=await f.context.database.connect();await blocker.query('BEGIN');await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1,0))",[org]);
  const reached=deferred();let caught=false;
  f.intercept.after=async sql=>{if(!caught&&sql.includes('WITH raw_run_fence')){caught=true;reached.resolve();}};
  await f.context.database.query("UPDATE signal_labeling_runs SET lease_until=clock_timestamp()+interval '1000 milliseconds' WHERE id=$1",[f.run.id]);
  const pending=f.store.markSubmitting(f.run,[f.calls[0]!]),observed=pending.then(()=>null,error=>error);
  try{await reached.promise;await delay(1100);}finally{await blocker.query('COMMIT');blocker.release();}
  assert.match(String(await observed),/labeling_lease_lost/);
  assert.equal((await f.context.database.query('SELECT status FROM signal_labeling_calls WHERE id=$1',[f.calls[0]!.id])).rows[0].status,'reserved');
  assert.equal((await f.context.database.query('SELECT count(*)::int n FROM signal_labeling_page_mutation_fences WHERE run_id=$1',[f.run.id])).rows[0].n,0);
 },{mark_initial:false});
});

test('historical writers without raw pages retain exclusive serialization',{skip:!enabled,timeout:120000},async()=>{
 await fixture(async f=>{
  const held=deferred(),release=deferred();let caught=false,beforeRelease=false;
  f.intercept.after=async sql=>{if(!caught&&sql.includes('SELECT id FROM signal_labeling_runs')){caught=true;held.resolve();await release.promise;}};
  const first=f.store.markSubmitting(f.run,[f.calls[0]!]);await held.promise;const second=f.store.markSubmitting(f.run,[f.calls[1]!]);
  try{beforeRelease=await Promise.race([second.then(()=>true),delay(150).then(()=>false)]);}finally{release.resolve();await Promise.all([first,second]);}
  assert.equal(beforeRelease,false);assert.equal((await f.context.database.query('SELECT count(*)::int n FROM signal_labeling_page_mutation_fences WHERE run_id=$1',[f.run.id])).rows[0].n,0);
 },{mark_initial:false,raw_pages:false});
});


test('page mutation fences are private immutable checks without processing authority',{skip:!enabled,timeout:120000},async()=>{
 await fixture(async f=>{
  await f.store.markSubmitting(f.run,[f.calls[0]!]);
  assert.equal((await f.context.database.query("SELECT relrowsecurity FROM pg_class WHERE oid='signal_labeling_page_mutation_fences'::regclass")).rows[0].relrowsecurity,true);
  for(const role of ['anon','authenticated'])if((await f.context.database.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rows.length)
   assert.equal((await f.context.database.query("SELECT has_table_privilege($1,'signal_labeling_page_mutation_fences','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') allowed",[role])).rows[0].allowed,false);
  assert.equal((await f.context.database.query('SELECT count(*)::int n FROM signal_labeling_page_mutation_fences WHERE run_id=$1',[f.run.id])).rows[0].n,1);
  await assert.rejects(f.context.database.query("UPDATE signal_labeling_page_mutation_fences SET operation='apply' WHERE run_id=$1",[f.run.id]),/labeling_page_fence_immutable/);
  await assert.rejects(f.context.database.query('DELETE FROM signal_labeling_page_mutation_fences WHERE run_id=$1',[f.run.id]),/labeling_page_fence_immutable/);
  await assert.rejects(f.context.database.query('TRUNCATE signal_labeling_page_mutation_fences'),/labeling_page_fence_immutable/);
  assert.ok((await f.context.database.query('SELECT status,settled_micro_usd,usage FROM signal_labeling_calls WHERE run_id=$1',[f.run.id])).rows.every(row=>row.settled_micro_usd===null&&row.usage===null));
 },{mark_initial:false});
});

test('the real page worker sends zero HTTP after a deferred mark rollback and reuses the same reservations on restart',{skip:!enabled,timeout:120000},async()=>{
 await fixture(async f=>{
  await f.store.release(f.run,{immediate:true});let delayed=false,marked=false,expire=true,sends=0;
  f.intercept.after=async sql=>{if(sql.includes('INSERT INTO signal_labeling_page_mutation_fences'))marked=true;};
  f.intercept.before=async sql=>{if(sql==='COMMIT'&&marked&&!delayed){delayed=true;await delay(1650);}};
  const store:ReturnType<typeof createMassLabelingStoreV1>={...f.store,async markSubmitting(run,calls){
   if(expire)await f.context.database.query("UPDATE signal_labeling_runs SET lease_until=clock_timestamp()+interval '1500 milliseconds' WHERE id=$1 AND lease_token=$2",[run.id,run.lease_token]);
   await f.store.markSubmitting(run,calls);
  }};
  const provider={max_response_bytes:16384,max_concurrency:2,async evaluate(request:ReturnType<typeof buildMassLabelingJevRequestV2>){sends++;
   const answers=Object.fromEntries(Object.entries(request.questions).map(([key,q])=>[key,q.type==='noul'?{type:'noul',noul:.8}
    :{type:'choice',choice:Object.keys(q.criteria)[0],confidence:.9,probabilities:Object.fromEntries(Object.keys(q.criteria).map((k,i,all)=>[k,i===0?.9:.1/(all.length-1)]))}]));
   return{http_status:200,latency_ms:100,body:JSON.stringify({model:request.model,usage:{input_tokens:100,output_tokens:0},answers})};
  }};
  const execution={max_in_flight:2,flush_size:2,max_flushes:1,max_buffered_bytes:16*1024*1024,flush_interval_ms:5,window_size:3};
  await assert.rejects(processMassLabelingJevV1({run_id:f.run.id,store,provider,execution}),/labeling_lease_lost|reconciliation_failed/);
  assert.equal(marked,true);assert.equal(delayed,true);assert.equal(sends,0);
  const before=(await f.context.database.query('SELECT id,status,reserved_micro_usd::text,settled_micro_usd,results_applied FROM signal_labeling_calls WHERE run_id=$1 ORDER BY id',[f.run.id])).rows;
  assert.equal(before.length,3);assert.ok(before.every(row=>row.status==='reserved'&&row.reserved_micro_usd==='1000'&&row.settled_micro_usd===null&&!row.results_applied));
  expire=false;f.intercept.before=undefined;f.intercept.after=undefined;
  const outcome=await processMassLabelingJevV1({run_id:f.run.id,store,provider,execution});assert.equal(outcome.labeled,3);assert.equal(sends,3);
  const after=(await f.context.database.query('SELECT id,status,results_applied FROM signal_labeling_calls WHERE run_id=$1 ORDER BY id',[f.run.id])).rows;
  assert.deepEqual(after.map(row=>row.id),before.map(row=>row.id));assert.ok(after.every(row=>row.status==='settled'&&row.results_applied));
 },{mark_initial:false});
});

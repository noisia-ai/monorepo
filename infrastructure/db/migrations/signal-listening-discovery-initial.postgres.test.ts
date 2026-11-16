import assert from 'node:assert/strict';
import test from 'node:test';
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
const enabled=process.env.NOISIA_R16_DISCOVERY_INITIAL_PG==='true';
test('initial discovery authority is private, explicit and additive',{
 skip:!enabled,timeout:600000,
},async()=>runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async ctx=>{
 const row=(await ctx.database.query("SELECT to_regclass('signal_listening_discovery_initial_intents') name")).rows[0];
 assert.equal(Boolean(row.name),true,'initial discovery must have its own immutable request intent');
 assert.equal((await ctx.database.query("SELECT relrowsecurity FROM pg_class WHERE oid='signal_listening_discovery_initial_intents'::regclass")).rows[0].relrowsecurity,true);
}}));

import {randomUUID} from 'node:crypto';
import {withInitialDiscoveryFixtureV1} from './signal-listening-discovery-initial.synthetic.fixture';
import {startSignalListeningDiscoveryInitialV1,pendingSignalListeningDiscoveryInitialV1} from '../signal-listening-discovery-initial';
import {saveSignalListeningConfigurationV1} from '../signal-listening-configuration';
import {bootstrapSignalListeningDiscoveryV1} from '../signal-listening-discovery';
import {startSignalListeningDiscoveryExecutionV1} from '../signal-listening-discovery-money';
import {prepareSignalListeningV1} from '../signal-listening-preparation';
import {signalListeningBaseTemplateV1} from '@noisia/query-engine';

for(const defined of [false,true])test('base'+(defined?' plus defined':' only')+' starts automatic discovery without a manually seeded configuration',{
 skip:!enabled,timeout:600000,
},async()=>withInitialDiscoveryFixtureV1(async f=>{
 const template=signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']});
 const cfg=await saveSignalListeningConfigurationV1({...f,expected_revision:f.cfg.revision,provenance:'human',configuration:{...template,
  retired_question_keys:f.cfg.configuration.questions.filter(q=>q.topic_source==='discovered').map(q=>q.key),
  questions:[...template.questions,...(defined?[{key:'defined_interest',type:'noul' as const,text:'Is this about bicycle maintenance?',positive:'Bicycle maintenance',negative:'Other topics',scope:'all' as const,origin:'brand_os' as const,human_locked:false,topic_source:'defined' as const}]:[])]}});
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_listening_discovery_generations WHERE configuration_id=$1',[cfg.id])).rows[0].n,0);
 const key=randomUUID(),{result,intent}=await f.request({configuration_id:cfg.id,idempotency_key:key});assert.ok(intent);assert.ok(result.run_id);
 const seed=(await f.database.query('SELECT * FROM signal_listening_discovery_generations WHERE id=$1',[intent.seed_generation_id])).rows[0];
 assert.equal(seed.configuration_id,cfg.id);assert.equal(seed.status,'ready');assert.equal(seed.counts.topics,0);assert.equal(Number(seed.counts.roots),3);
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_listening_discovery_topics WHERE generation_id=$1',[seed.id])).rows[0].n,0);
 assert.equal((await f.request({configuration_id:cfg.id,idempotency_key:key})).intent?.seed_generation_id,seed.id);
 await f.classify(result.run_id,cfg.configuration);
 const started=await startSignalListeningDiscoveryInitialV1({database:f.database,intent_id:intent.id});assert.ok(started?.execution);
 assert.equal(started.intent.configuration_id,cfg.id);assert.equal(started.intent.seed_generation_id,seed.id);
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_listening_discovery_generations WHERE configuration_id=$1 AND kind=\'legacy_seed\'',[cfg.id])).rows[0].n,1);
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_processing_admissions WHERE target_id=$1',[result.run_id])).rows[0].n,1);
}));

test('one explicit initial request starts one frozen parent after native labeling without a second admission',{
 skip:!enabled,timeout:600000,
},async()=>withInitialDiscoveryFixtureV1(async f=>{
 const db=f.database,key=randomUUID(),requests=await Promise.all([f.request({idempotency_key:key}),f.request({idempotency_key:key})]),{result,intent}=requests[0]!;assert.equal(requests[1]?.intent?.id,intent?.id);assert.equal(requests[1]?.result.run_id,result.run_id);assert.ok(intent,'the request creates an explicit intent');assert.ok(result.run_id,'initial labeling is admitted');
 assert.equal(intent.status,'admitted');assert.equal(intent.seed_generation_id,f.seed.id);assert.equal(intent.cap_micro_usd,'4000000');assert.equal(intent.automatic,false);
 const admission=(await db.query('SELECT * FROM signal_processing_admissions WHERE id=$1',[intent.processing_admission_id])).rows[0];assert.equal(admission.automatic,false);assert.equal(admission.policy_version_id,intent.policy_version_id);
 assert.equal((await pendingSignalListeningDiscoveryInitialV1({database:db})).length,0,'an active initial run is not discovery authority yet');
 assert.equal((await startSignalListeningDiscoveryInitialV1({database:db,intent_id:intent.id}))?.execution,null);
 assert.equal((await f.request({idempotency_key:key})).intent?.id,intent.id);
 await assert.rejects(f.request({idempotency_key:key,cap_micro_usd:4000001}),/idempotency_conflict/);
 const laterSeed=await bootstrapSignalListeningDiscoveryV1({...f,configuration_id:f.cfg.id,bindings:f.bindings});assert.notEqual(laterSeed.id,f.seed.id);
 await f.classify(result.run_id);assert.equal((await pendingSignalListeningDiscoveryInitialV1({database:db}))[0]?.intent_id,intent.id);
 const before=(await db.query('SELECT count(*)::int n FROM signal_processing_admissions WHERE workspace_id=$1',[f.workspace_id])).rows[0].n;
 const starts=await Promise.all([startSignalListeningDiscoveryInitialV1({database:db,intent_id:intent.id}),startSignalListeningDiscoveryInitialV1({database:db,intent_id:intent.id})]);assert.equal(new Set(starts.map(s=>s?.execution?.id)).size,1);const started=starts[0]!;assert.ok(started.execution,'a completed admitted initial run starts its parent');
 assert.equal(started.intent.status,'started');assert.equal(started.execution.cap_micro_usd,'4000000');
 assert.equal((await db.query('SELECT source_generation_id FROM signal_listening_discovery_generations WHERE id=$1',[started.execution.initial_generation_id])).rows[0].source_generation_id,f.seed.id);
 assert.equal((await db.query('SELECT signal_listening_discovery_exposure_v1($1)::text n',[started.execution.id])).rows[0].n,'18');
 assert.equal((await db.query('SELECT count(*)::int n FROM signal_processing_admissions WHERE workspace_id=$1',[f.workspace_id])).rows[0].n,before,'starting the parent creates no paid admission');
 assert.equal((await db.query("SELECT count(*)::int n FROM engine_cost_events WHERE workspace_id=$1 AND workspace_contract='listening-discovery-round-v1'",[f.workspace_id])).rows[0].n,0);
 assert.equal((await pendingSignalListeningDiscoveryInitialV1({database:db})).length,0);
 const executionId=started.execution.id,custody=async()=> (await db.query(`SELECT
  (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM signal_listening_discovery_executions p WHERE workspace_id=$1) parents,
  (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM signal_processing_admissions a WHERE workspace_id=$1) admissions,
  (SELECT jsonb_agg(to_jsonb(o) ORDER BY o.kind,o.owner_id) FROM signal_listening_study_policy_owners o WHERE workspace_id=$1) owners,
  (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM signal_labeling_calls c WHERE workspace_id=$1) labeling_calls,
  (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM signal_workspace_embedding_calls c WHERE workspace_id=$1) embedding_calls,
  (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM engine_cost_events e WHERE workspace_id=$1) costs,
  (SELECT signal_listening_study_policy_exposure_v1(scope_id)::text FROM signal_listening_study_policy_bindings WHERE policy_id=$2) scope_exposure,
  signal_listening_discovery_exposure_v1($3)::text parent_exposure`,[f.workspace_id,intent.policy_version_id,executionId])).rows[0];
 const beforeUnboundParent=await custody(),originalCap=Number(intent.cap_micro_usd);
 assert.equal(originalCap,Number(started.execution.cap_micro_usd));
 // Stay within the existing cap so the missing-intent guard is actually exercised.
 await assert.rejects(startSignalListeningDiscoveryExecutionV1({...f,generation_id:started.execution.initial_generation_id,classification_run_id:result.run_id,cap_micro_usd:originalCap,idempotency_key:randomUUID()}),/initial_intent_required/);
 assert.deepEqual(await custody(),beforeUnboundParent,'a missing intent creates no second parent, admission, owner, provider call, cost or exposure');
 await assert.rejects(db.query('UPDATE signal_listening_discovery_initial_intents SET cap_micro_usd=cap_micro_usd+1 WHERE id=$1',[intent.id]),/initial_immutable/);
 await assert.rejects(db.query('DELETE FROM signal_listening_discovery_initial_intents WHERE id=$1',[intent.id]),/initial_immutable/);
 await assert.rejects(db.query(`INSERT INTO signal_listening_discovery_initial_intents SELECT(jsonb_populate_record(NULL::signal_listening_discovery_initial_intents,to_jsonb(i)||jsonb_build_object('id',$2::uuid,'initial_run_id',NULL,'processing_admission_id',NULL,'execution_id',NULL,'confirmed_generation_id',NULL,'status','preparing','request_digest',NULL))).* FROM signal_listening_discovery_initial_intents i WHERE id=$1`,[intent.id,randomUUID()]),/initial_request_invalid/,'an old preparation cannot be retrofitted even by a new intent UUID');
 await assert.rejects(db.query('UPDATE signal_listening_discovery_initial_intents SET workspace_id=$2 WHERE id=$1',[intent.id,randomUUID()]),/initial_immutable/);
 await assert.rejects(db.query('TRUNCATE signal_listening_discovery_initial_intents'),/initial_immutable|foreign key constraint/);
}));

for(const event of ['human','policy','rights','actor','source'] as const)test('initial '+event+' change closes the original intent without a parent or new paid authority',{
 skip:!enabled,timeout:600000,
},async()=>withInitialDiscoveryFixtureV1(async f=>{
 const db=f.database,{result,intent}=await f.request();assert.ok(intent);assert.ok(result.run_id);await f.classify(result.run_id);
 if(event==='human')await saveSignalListeningConfigurationV1({...f,expected_revision:f.cfg.revision,provenance:'human',configuration:{...f.cfg.configuration,instructions:f.cfg.configuration.instructions+' Human edit.'}});
 else if(event==='policy')await db.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[f.policy.id]);
 else if(event==='rights')await db.query("UPDATE data_sources SET status='archived' WHERE workspace_id=$1",[f.workspace_id]);
 else if(event==='actor')await db.query("UPDATE users SET primary_role='analyst' WHERE id=$1",[f.actor_user_id]);
 else await db.query('UPDATE mentions SET text_clean=text_clean||\' changed\' WHERE workspace_id=$1',[f.workspace_id]);
 const count=(await db.query('SELECT count(*)::int n FROM signal_processing_admissions WHERE workspace_id=$1',[f.workspace_id])).rows[0].n;
 assert.equal((await pendingSignalListeningDiscoveryInitialV1({database:db}))[0]?.intent_id,intent.id);
 const closed=await startSignalListeningDiscoveryInitialV1({database:db,intent_id:intent.id});assert.equal(closed?.intent.status,'stale');assert.equal(closed?.execution,null);
 assert.equal((await db.query('SELECT count(*)::int n FROM signal_listening_discovery_executions WHERE workspace_id=$1',[f.workspace_id])).rows[0].n,0);
 assert.equal((await db.query('SELECT count(*)::int n FROM signal_processing_admissions WHERE workspace_id=$1',[f.workspace_id])).rows[0].n,count);
 assert.equal((await db.query("SELECT sum(settled_micro_usd)::text spent FROM signal_labeling_calls WHERE run_id=$1",[result.run_id])).rows[0].spent,'18');
 assert.equal((await pendingSignalListeningDiscoveryInitialV1({database:db})).length,0);
}));

test('original exact cap is shared with the initial run and cannot be renewed by discovery',{
 skip:!enabled,timeout:600000,
},async()=>withInitialDiscoveryFixtureV1(async f=>{
 const db=f.database,{result,intent}=await f.request({cap_micro_usd:18});assert.ok(intent);assert.ok(result.run_id);await f.classify(result.run_id);
 const started=await startSignalListeningDiscoveryInitialV1({database:db,intent_id:intent.id});assert.ok(started?.execution);assert.equal(started.execution.cap_micro_usd,'18');
 assert.equal((await db.query('SELECT signal_listening_discovery_exposure_v1($1)::text n',[started.execution.id])).rows[0].n,'18');
 // No numeric/provider activity is needed to prove there is no second cap.
 assert.equal((await db.query('SELECT cap_micro_usd::text n FROM signal_labeling_runs WHERE id=$1',[result.run_id])).rows[0].n,'18');
}));

test('missing review policy rejects the opt-in before any preparation or admission',{
 skip:!enabled,timeout:600000,
},async()=>withInitialDiscoveryFixtureV1(async f=>{
 const count=(await f.database.query('SELECT count(*)::int n FROM signal_processing_admissions WHERE workspace_id=$1',[f.workspace_id])).rows[0].n;
 await assert.rejects(f.request(),/discovery_policy_unavailable/);
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_listening_preparations WHERE workspace_id=$1',[f.workspace_id])).rows[0].n,0);
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_processing_admissions WHERE workspace_id=$1',[f.workspace_id])).rows[0].n,count);
},{review_enabled:false}));

test('child, unsupported automatic requests and historical runs cannot create initial authority',{
 skip:!enabled,timeout:600000,
},async()=>withInitialDiscoveryFixtureV1(async f=>{
 await assert.rejects(f.request({origin:'discovery_child',auto_discovery:true}),/origin_invalid/);
 await assert.rejects(f.request({automatic:true}),/origin_invalid/);
 const child=await f.request({origin:'discovery_child',auto_discovery:false});assert.equal(child.intent,null);assert.ok(child.result.run_id);await f.classify(child.result.run_id);
 assert.equal((await pendingSignalListeningDiscoveryInitialV1({database:f.database})).length,0);
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_listening_discovery_initial_intents WHERE workspace_id=$1',[f.workspace_id])).rows[0].n,0);
 assert.equal((await f.database.query('SELECT discovery_origin,auto_discovery FROM signal_listening_preparations WHERE id=$1',[child.result.preparation_id])).rows[0].discovery_origin,'discovery_child');
 await assert.rejects(f.database.query("UPDATE signal_listening_preparations SET auto_discovery=true,discovery_origin='initial' WHERE id=$1",[child.result.preparation_id]),/preparation_immutable/);
 const legacy=await f.request({origin:undefined,auto_discovery:undefined});assert.equal(legacy.intent,null);assert.ok(legacy.result.run_id);await f.classify(legacy.result.run_id);
 assert.equal((await f.database.query('SELECT discovery_origin FROM signal_listening_preparations WHERE id=$1',[legacy.result.preparation_id])).rows[0].discovery_origin,null);
 assert.equal((await pendingSignalListeningDiscoveryInitialV1({database:f.database})).length,0);
}));

for(const phase of ['preparation','admission','parent'] as const)test('initial '+phase+' COMMIT acknowledgement loss cannot create a second intent, run or parent',{
 skip:!enabled,timeout:600000,
},async()=>withInitialDiscoveryFixtureV1(async f=>{
 const db=f.database,key=randomUUID();let armed=false,fired=false;
 const prefix=phase==='preparation'?'INSERT INTO signal_listening_discovery_initial_intents':phase==='admission'?'INSERT INTO signal_labeling_runs':'INSERT INTO signal_listening_discovery_executions';
 const proxy={query:db.query.bind(db),connect:async()=>{const c=await db.connect();return new Proxy(c,{get(target,name){if(name==='query')return async(sql:string,...values:unknown[])=>{
  if(sql.startsWith(prefix))armed=true;const result=await(target.query as(...args:unknown[])=>Promise<unknown>)(sql,...values);
  if(sql==='COMMIT'&&armed&&!fired){fired=true;throw Error('synthetic_initial_ack_lost');}return result;
 };const value=Reflect.get(target,name);return typeof value==='function'?value.bind(target):value;}});}} as typeof db;
 const request={...f,database:phase==='parent'?db:proxy,configuration_id:f.cfg.id,idempotency_key:key,cap_micro_usd:4000000,provider_available:true,auto_discovery:true,origin:'initial' as const};
 if(phase!=='parent')await assert.rejects(prepareSignalListeningV1(request),/synthetic_initial_ack_lost/);
 const replay=await f.request({idempotency_key:key});assert.ok(replay.intent);assert.ok(replay.result.run_id);await f.classify(replay.result.run_id);
 if(phase==='parent')await assert.rejects(startSignalListeningDiscoveryInitialV1({database:proxy,intent_id:replay.intent.id}),/synthetic_initial_ack_lost/);
 assert.equal(fired,true);
 const started=await startSignalListeningDiscoveryInitialV1({database:db,intent_id:replay.intent.id});assert.equal(started?.intent.status,'started');assert.ok(started?.execution);
 assert.equal((await db.query('SELECT count(*)::int n FROM signal_listening_discovery_initial_intents WHERE workspace_id=$1',[f.workspace_id])).rows[0].n,1);
 assert.equal((await db.query('SELECT count(*)::int n FROM signal_listening_discovery_executions WHERE initial_intent_id=$1',[replay.intent.id])).rows[0].n,1);
 assert.equal((await db.query("SELECT count(*)::int n FROM signal_listening_discovery_generations WHERE workspace_id=$1 AND kind='confirmed_members'",[f.workspace_id])).rows[0].n,1);
 assert.equal((await db.query('SELECT count(*)::int n FROM signal_processing_admissions WHERE target_id=$1',[replay.result.run_id])).rows[0].n,1);
 assert.equal((await db.query("SELECT count(*)::int n FROM engine_cost_events WHERE workspace_id=$1 AND workspace_contract='listening-discovery-round-v1'",[f.workspace_id])).rows[0].n,0);
}));

test('new prototype receipts and initial JEV consume the original total while reused corpus Voyage is historical',{
 skip:!enabled,timeout:600000,
},async()=>withInitialDiscoveryFixtureV1(async f=>{
 const db=f.database,{result,intent}=await f.request();assert.ok(intent);assert.equal(result.status,'waiting_prototypes');assert.equal(intent.status,'preparing');
 assert.equal((await pendingSignalListeningDiscoveryInitialV1({database:db})).length,0);
 const ready=await f.prototypes(result.preparation_id);assert.ok(ready.calls.length>0);assert.ok(ready.result.run_id);await f.classify(ready.result.run_id);
 const proto=(await db.query('SELECT p.settled_micro_usd::text spent,r.cap_micro_usd::text jev_cap FROM signal_listening_preparations f JOIN signal_workspace_embedding_runs p ON p.id=f.prototype_run_id JOIN signal_labeling_runs r ON r.id=f.listening_run_id WHERE f.id=$1',[result.preparation_id])).rows[0];
 assert.ok(BigInt(proto.spent)>0n,'new exact-definition vectors have native settled receipts');assert.equal(BigInt(proto.spent)+BigInt(proto.jev_cap),4000000n);
 const started=await startSignalListeningDiscoveryInitialV1({database:db,intent_id:intent.id});assert.ok(started?.execution);assert.equal(started.execution.cap_micro_usd,'4000000');
 const exposure=(await db.query('SELECT signal_listening_discovery_exposure_v1($1)::text n',[started.execution.id])).rows[0].n;
 assert.equal(BigInt(exposure),BigInt(proto.spent)+18n,'historical corpus Voyage is not included as a new initial-intent expense');
},{prototypes:true}));

test('initial parent creation waits for native organization money authority without reserving another cap',{
 skip:!enabled,timeout:600000,
},async()=>withInitialDiscoveryFixtureV1(async f=>{
 const db=f.database,{result,intent}=await f.request();assert.ok(intent);assert.ok(result.run_id);await f.classify(result.run_id);
 const blocker=await db.connect();let pid=0,waiting:Promise<ReturnType<typeof startSignalListeningDiscoveryInitialV1> extends Promise<infer R>?R:never>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1,0))",[f.policy.organization_id]);
  await blocker.query('SELECT signal_processing_lock_v1($1,(clock_timestamp() AT TIME ZONE $2)::date)',[f.policy.organization_id,f.policy.budget_timezone]);
  const proxy={query:db.query.bind(db),connect:async()=>{const c=await db.connect();pid=(await c.query<{pid:number}>('SELECT pg_backend_pid() pid')).rows[0]!.pid;return c;}} as typeof db;
  waiting=startSignalListeningDiscoveryInitialV1({database:proxy,intent_id:intent.id});let held=false;
  for(let n=0;n<100;n++){if(pid&&(await db.query<{wait_event_type:string}>('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0]?.wait_event_type==='Lock'){held=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(held,true,'the real producer transaction waits on the shared organization lock');
  assert.equal((await db.query('SELECT count(*)::int n FROM signal_listening_discovery_executions WHERE workspace_id=$1',[f.workspace_id])).rows[0].n,0);
 }finally{await blocker.query('COMMIT');blocker.release();}
 const started=await waiting;assert.equal(started?.intent.status,'started');assert.ok(started.execution);assert.equal(started.execution.cap_micro_usd,'4000000');
 assert.equal((await db.query('SELECT signal_listening_discovery_exposure_v1($1)::text n',[started.execution.id])).rows[0].n,'18');
}));

for(const durableRaw of [false,true])test('initial unknown '+(durableRaw?'with durable bytes recovers the same intent without a second call':'without bytes stays parked and cannot authorize a resend'),{
 skip:!enabled,timeout:600000,
},async()=>withInitialDiscoveryFixtureV1(async f=>{
 const db=f.database,{result,intent}=await f.request();assert.ok(intent);assert.ok(result.run_id);const call=await f.unknown(result.run_id,durableRaw);
 const parked=await startSignalListeningDiscoveryInitialV1({database:db,intent_id:intent.id});assert.equal(parked?.intent.status,'waiting_recovery');assert.equal(parked?.execution,null);
 assert.equal((await pendingSignalListeningDiscoveryInitialV1({database:db})).length,0,'an unresolved parked run does not spin in the initializer');
 const recorded=(await db.query('SELECT status,reserved_micro_usd::text reserved,settled_micro_usd,raw_sha256,raw_storage_key,raw_size_bytes,request_digest FROM signal_labeling_calls WHERE id=$1',[call.id])).rows[0];assert.equal(recorded.status,'unknown');assert.equal(recorded.reserved,'6');assert.equal(recorded.settled_micro_usd,null);
 if(durableRaw){
  assert.ok(recorded.raw_sha256&&recorded.raw_storage_key&&Number(recorded.raw_size_bytes)>0,'recovery starts from an authenticated durable receipt');
  await f.classify(result.run_id);
  const recovered=(await db.query('SELECT status,reserved_micro_usd::text reserved,settled_micro_usd::text settled,raw_sha256,raw_storage_key,raw_size_bytes,request_digest,usage FROM signal_labeling_calls WHERE id=$1',[call.id])).rows[0];
  assert.equal(recovered.status,'settled');assert.equal(recovered.reserved,'6');assert.equal(recovered.settled,'6');
  for(const key of ['raw_sha256','raw_storage_key','raw_size_bytes','request_digest'])assert.equal(recovered[key],recorded[key],'recovery preserves original receipt identity: '+key);
  assert.equal(recovered.usage.input_tokens,120);assert.equal(recovered.usage.output_tokens,20);
  assert.equal((await db.query('SELECT error_code FROM signal_labeling_runs WHERE id=$1',[result.run_id])).rows[0].error_code,null);
  assert.equal((await pendingSignalListeningDiscoveryInitialV1({database:db}))[0]?.intent_id,intent.id);
  const done=await startSignalListeningDiscoveryInitialV1({database:db,intent_id:intent.id});assert.equal(done?.intent.status,'started');assert.equal(done?.intent.error_code,null);assert.ok(done?.execution);
  assert.equal((await db.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[result.run_id])).rows[0].n,3,'recovered root is never classified twice');
  assert.equal((await db.query('SELECT count(*)::int n FROM signal_processing_admissions WHERE target_id=$1',[result.run_id])).rows[0].n,1);
 }else{
  await assert.rejects(f.classify(result.run_id),/unknown_without_receipt_is_not_a_retry/);
  const blocked=(await db.query('SELECT status,reserved_micro_usd::text reserved,settled_micro_usd,raw_sha256,raw_storage_key,raw_size_bytes,request_digest FROM signal_labeling_calls WHERE id=$1',[call.id])).rows[0];
  assert.deepEqual(blocked,recorded,'missing bytes preserve the original unknown reservation and receipt absence');
  assert.equal((await db.query('SELECT error_code FROM signal_labeling_runs WHERE id=$1',[result.run_id])).rows[0].error_code,'labeling_outcome_unknown');
  await assert.rejects(f.request(),/prior_outcome_unresolved/);
  assert.equal((await db.query('SELECT count(*)::int n FROM signal_listening_discovery_initial_intents WHERE workspace_id=$1',[f.workspace_id])).rows[0].n,1);
  assert.equal((await startSignalListeningDiscoveryInitialV1({database:db,intent_id:intent.id}))?.intent.status,'waiting_recovery');
  assert.equal((await db.query('SELECT count(*)::int n FROM signal_labeling_calls WHERE run_id=$1',[result.run_id])).rows[0].n,1);
 }
}));

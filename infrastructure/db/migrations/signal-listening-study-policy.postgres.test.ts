import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import type {Pool,PoolClient} from 'pg';
import {createProcessingPolicyIdentitiesV1} from './signal-processing-policy.fixture';
import {quoteSignalListeningStudyPolicyV1,provisionSignalListeningStudyPolicyV1} from '../signal-listening-study-policy';
import {readSignalProcessingPolicyWithQueryableV1} from '../signal-processing-policy';
import {withSignalStudyFixtureV1} from './signal-study.synthetic.fixture';
const enabled=process.env.NOISIA_R16_LISTENING_STUDY_POLICY_PG==='true';
const allocation={budget_micro_usd:15000000,discovery_cap_micro_usd:9000000,study_cap_micro_usd:5000000,prototype_cap_micro_usd:1000000};
async function fixture(fn:(v:Omit<Awaited<ReturnType<typeof createProcessingPolicyIdentitiesV1>>,'database'>&{database:Pick<Pool,'connect'>;raw:PoolClient;prior:{id:string;policy_digest:string};valid_until:string})=>Promise<void>){
 const {openDatabase}=await import(new URL('../../../scripts/dev-corpus/guard.mjs',import.meta.url).href);const pool:Pool=await openDatabase(),raw=await pool.connect();
 try{await raw.query('BEGIN');const f=await createProcessingPolicyIdentitiesV1({database:pool,scoped:raw});
 const prior=(await raw.query(`INSERT INTO signal_processing_policy_versions(organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
 VALUES($1,1,'draft',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '2 days','UTC',20000000,$2) RETURNING id`,[f.first.organization_id,f.actors.internal])).rows[0]!;
 await raw.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
 VALUES($1,'mass_labeling_jev','provider','typesafe','jev-1.13.0','{}',signal_semantic_context_digest_json_v2('{}'),10000000,false),
 ($1,'corpus_preparation','free',NULL,NULL,'{}',signal_semantic_context_digest_json_v2('{}'),0,false)`,[prior.id]);
 await raw.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[prior.id]);
 const p=(await raw.query('SELECT id,policy_digest FROM signal_processing_policy_versions WHERE id=$1',[prior.id])).rows[0]!;
 const valid_until=(await raw.query(`SELECT to_char((clock_timestamp()+interval '1 day') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') value`)).rows[0].value;
 let savepoint=0;const stack:string[]=[];
 const database={connect:async()=>({query:async(sql:string,params?:unknown[])=>{
  if(sql.startsWith('BEGIN')){const s='r16_policy_'+savepoint++;stack.push(s);return raw.query('SAVEPOINT '+s);}
  if(sql==='COMMIT')return raw.query('RELEASE SAVEPOINT '+stack.pop()!);
  if(sql==='ROLLBACK'){const s=stack.pop()!;await raw.query('ROLLBACK TO SAVEPOINT '+s);return raw.query('RELEASE SAVEPOINT '+s);}
  return raw.query(sql,params);
 },release(){}})} as unknown as Pick<Pool,'connect'>;
 await fn({...f,database,raw,prior:p,valid_until});
 }finally{await raw.query('ROLLBACK').catch(()=>undefined);raw.release();await pool.end();}
}
test('explicit scoped policy preserves legacy, bounds providers, scopes siblings, and recovers a committed receipt without another successor',{
 skip:!enabled,timeout:120000,
},async()=>fixture(async f=>{
 const args={database:f.database,workspace_id:f.first.workspace_id,actor_user_id:f.actors.internal,expected_policy_id:f.prior.id,expected_policy_digest:f.prior.policy_digest,valid_until:f.valid_until,...allocation};
 const before=(await f.raw.query('SELECT to_jsonb(a)-\'policy_version_id\' value FROM signal_processing_policy_actions a WHERE policy_version_id=$1 ORDER BY action',[f.prior.id])).rows;
 // Adversarial unbound organization action is not usable without a native
 // scope receipt. This is a negative control, never positive fixture authority.
 await f.raw.query('SAVEPOINT unbound_action');
 const unbound=(await f.raw.query(`INSERT INTO signal_processing_policy_versions(organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
  SELECT organization_id,version+1,'draft',clock_timestamp(),valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id FROM signal_processing_policy_versions WHERE id=$1 RETURNING id`,[f.prior.id])).rows[0]!;
 await f.raw.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
  SELECT $1,'study_analysis','provider','anthropic','claude-sonnet-4-6',c,signal_semantic_context_digest_json_v2(c),1000000,false FROM(SELECT signal_study_analysis_configuration_v1() c)x`,[unbound.id]);
 await f.raw.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[f.prior.id]);await f.raw.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[unbound.id]);
 await assert.rejects(f.raw.query(`SELECT admit_signal_processing_v1($1,$2,'study_analysis',$3,$4,'sha256:'||repeat('a',64),1000,false)`,[f.first.workspace_id,f.actors.internal,randomUUID(),randomUUID()]),/r16_policy_scope_required/);
 await f.raw.query('ROLLBACK TO SAVEPOINT unbound_action');await f.raw.query('RELEASE SAVEPOINT unbound_action');
 const quote=await quoteSignalListeningStudyPolicyV1(args);assert.equal(quote.plan.scope,'workspace');assert.equal(quote.plan.workspace_id,f.first.workspace_id);
 assert.deepEqual(quote.plan.added_actions,['listening_discovery_review','study_analysis','topic_prototype_embeddings']);
 assert.equal((await f.raw.query('SELECT count(*)::int n FROM signal_listening_study_policy_scopes')).rows[0].n,0);
 const request={...args,plan_digest:quote.plan_digest,idempotency_key:randomUUID()};
 const result=await provisionSignalListeningStudyPolicyV1(request);assert.equal(result.replayed,false);
 const inserted=(await f.raw.query(`SELECT receipt.id,receipt.policy_id,binding.scope_id,binding.provision_receipt_id
  FROM signal_listening_study_policy_scopes receipt JOIN signal_listening_study_policy_bindings binding ON binding.policy_id=receipt.policy_id
  WHERE receipt.id=$1`,[result.receipt_id])).rows[0];
 assert.deepEqual(inserted,{id:result.receipt_id,policy_id:result.policy_id,scope_id:result.scope_id,provision_receipt_id:result.receipt_id},'both INSERT guards use action-row aliases distinct from their own implicit OLD receipt/binding records');
 assert.equal((await f.raw.query('SELECT status FROM signal_processing_policy_versions WHERE id=$1',[f.prior.id])).rows[0].status,'revoked');
 const next=(await f.raw.query('SELECT status,valid_until::text,daily_cap_micro_usd::text,budget_timezone FROM signal_processing_policy_versions WHERE id=$1',[result.policy_id])).rows[0];assert.equal(next.status,'active');assert.equal(next.daily_cap_micro_usd,'20000000');assert.equal(next.budget_timezone,'UTC');
 const after=(await f.raw.query('SELECT to_jsonb(a)-\'policy_version_id\' value FROM signal_processing_policy_actions a WHERE policy_version_id=$1 AND action IN(\'mass_labeling_jev\',\'corpus_preparation\') ORDER BY action',[result.policy_id])).rows;assert.deepEqual(after,before);
 const bound=(await f.raw.query('SELECT action,provider,model,max_execution_micro_usd::text,automatic_allowed FROM signal_processing_policy_actions WHERE policy_version_id=$1 AND action NOT IN(\'mass_labeling_jev\',\'corpus_preparation\') ORDER BY action',[result.policy_id])).rows;
 assert.ok(bound.every(a=>a.automatic_allowed===false));assert.deepEqual(bound.map(a=>[a.action,a.model,a.max_execution_micro_usd]),[['listening_discovery_review','claude-sonnet-4-6','9000000'],['study_analysis','claude-sonnet-4-6','5000000'],['topic_prototype_embeddings','voyage-4-large','1000000']]);
 const availability={mass_labeling_jev:true,listening_discovery_review:true,study_analysis:true,topic_prototype_embeddings:true} as const;
 for(const [workspace_id,own] of [[f.first.workspace_id,true],[f.second.workspace_id,false]] as const){
  const view=await readSignalProcessingPolicyWithQueryableV1({queryable:f.raw,workspace_id,actor_user_id:f.actors.internal,action_availability:availability});
  assert.equal(view.status,'ready');assert.equal(view.actions.find(a=>a.action==='mass_labeling_jev')?.available,true);
  for(const action of ['listening_discovery_review','study_analysis','topic_prototype_embeddings'])assert.equal(view.actions.find(a=>a.action===action)?.available,own);
 }
 await f.raw.query('SELECT signal_listening_study_policy_assert_scope_v1($1,$2,$3,$4)',[result.policy_id,f.first.workspace_id,'study_analysis',5000000]);
 for(const [workspace,action,cap,error] of [[f.second.workspace_id,'study_analysis',1,'workspace_scope'],[f.first.workspace_id,'study_analysis',5000001,'scope_cap'],[f.second.workspace_id,'topic_prototype_embeddings',1,'workspace_scope']] as const){
  await f.raw.query('SAVEPOINT scope_denial');await assert.rejects(f.raw.query('SELECT signal_listening_study_policy_assert_scope_v1($1,$2,$3,$4)',[result.policy_id,workspace,action,cap]),new RegExp('r16_policy_'+error));await f.raw.query('ROLLBACK TO SAVEPOINT scope_denial');await f.raw.query('RELEASE SAVEPOINT scope_denial');
 }
 await f.raw.query('SAVEPOINT sibling_admission');await assert.rejects(f.raw.query(`SELECT admit_signal_processing_v1($1,$2,'study_analysis',$3,$4,'sha256:'||repeat('a',64),1000,false)`,[f.second.workspace_id,f.actors.internal,randomUUID(),randomUUID()]),/r16_policy_workspace_scope/);await f.raw.query('ROLLBACK TO SAVEPOINT sibling_admission');await f.raw.query('RELEASE SAVEPOINT sibling_admission');
 // A normal legacy successor cannot silently lift the workspace restriction.
 await f.raw.query('SAVEPOINT scope_rotation');const unsafe=(await f.raw.query(`INSERT INTO signal_processing_policy_versions(organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
 SELECT organization_id,version+1,'draft',clock_timestamp(),valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id FROM signal_processing_policy_versions WHERE id=$1 RETURNING id`,[result.policy_id])).rows[0]!;
 await f.raw.query('INSERT INTO signal_processing_policy_actions SELECT $2,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed FROM signal_processing_policy_actions WHERE policy_version_id=$1',[result.policy_id,unsafe.id]);
 await f.raw.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[result.policy_id]);await assert.rejects(f.raw.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[unsafe.id]),/r16_policy_scope_required/);await f.raw.query('ROLLBACK TO SAVEPOINT scope_rotation');await f.raw.query('RELEASE SAVEPOINT scope_rotation');
 assert.deepEqual(await provisionSignalListeningStudyPolicyV1(request),{...result,replayed:true});
 await assert.rejects(provisionSignalListeningStudyPolicyV1({...request,study_cap_micro_usd:4000000}),/r16_policy_idempotency_conflict/);
 await assert.rejects(provisionSignalListeningStudyPolicyV1({...request,plan_digest:'sha256:'+'0'.repeat(64)}),/r16_policy_idempotency_conflict/);
 assert.equal((await f.raw.query('SELECT count(*)::int n FROM signal_processing_policy_versions WHERE organization_id=$1',[f.first.organization_id])).rows[0].n,2);
 assert.equal((await f.raw.query('SELECT count(*)::int n FROM signal_processing_admissions WHERE organization_id=$1',[f.first.organization_id])).rows[0].n,0);
}));
test('quote and provision reject unauthorized actors, stale CAS, changed quote, excessive caps, and rollback partial activation',{
 skip:!enabled,timeout:120000,
},async()=>fixture(async f=>{
 const args={database:f.database,workspace_id:f.first.workspace_id,actor_user_id:f.actors.internal,expected_policy_id:f.prior.id,expected_policy_digest:f.prior.policy_digest,valid_until:f.valid_until,...allocation};
 for(const actor of [f.actors.firstAdmin,f.actors.secondAdmin,f.actors.noGrant,f.actors.suspended,f.actors.viewer])await assert.rejects(quoteSignalListeningStudyPolicyV1({...args,actor_user_id:actor}),/r16_policy_forbidden/);
 await assert.rejects(quoteSignalListeningStudyPolicyV1({...args,expected_policy_digest:'sha256:'+'0'.repeat(64)}),/r16_policy_changed/);
 await assert.rejects(quoteSignalListeningStudyPolicyV1({...args,valid_until:'infinity'}),/r16_policy_dates_invalid/);
 await assert.rejects(quoteSignalListeningStudyPolicyV1({...args,valid_until:new Date(Date.now()-1000).toISOString()}),/r16_policy_dates_invalid/);
 await assert.rejects(quoteSignalListeningStudyPolicyV1({...args,discovery_cap_micro_usd:16000000}),/r16_policy_budget_invalid/);
 const quote=await quoteSignalListeningStudyPolicyV1(args);
 assert.equal(quote.request.valid_until,f.valid_until,'finite PostgreSQL timestamp normalization returns canonical text with exact microseconds');
 const sameInstant=f.valid_until.replace('T',' ').replace('Z','+00:00');
 assert.equal((await quoteSignalListeningStudyPolicyV1({...args,valid_until:sameInstant})).plan_digest,quote.plan_digest,'equivalent timestamp text cannot change the canonical reviewed plan');
 await assert.rejects(provisionSignalListeningStudyPolicyV1({...args,plan_digest:'sha256:'+'0'.repeat(64),idempotency_key:randomUUID()}),/r16_policy_plan_changed/);
 const badDatabase={connect:async()=>{const c=await f.database.connect();return{query:(sql:string,params?:unknown[])=>sql.includes("SET status='active'")?Promise.reject(Error('synthetic_activation_failure')):c.query(sql,params),release:()=>c.release()};}} as Pick<Pool,'connect'>;
 await assert.rejects(provisionSignalListeningStudyPolicyV1({...args,database:badDatabase,plan_digest:quote.plan_digest,idempotency_key:randomUUID()}),/synthetic_activation_failure/);
 assert.equal((await f.raw.query('SELECT count(*)::int n FROM signal_processing_policy_versions WHERE organization_id=$1',[f.first.organization_id])).rows[0].n,1);
 assert.equal((await f.raw.query('SELECT count(*)::int n FROM signal_listening_study_policy_scopes')).rows[0].n,0);
}));
test('actual admitted R16 Study and closed-loop owners block replacement',{
 skip:!enabled,timeout:600000,
},async()=>withSignalStudyFixtureV1(async f=>{
 const p=(await f.database.query('SELECT id,policy_digest FROM signal_processing_policy_versions WHERE id=$1',[f.policy.id])).rows[0]!;
 const args={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id,expected_policy_id:p.id,expected_policy_digest:p.policy_digest,valid_until:new Date(Date.now()+3600000).toISOString(),...allocation,prototype_cap_micro_usd:null};
 // The fixture contains an active native discovery owner, with real admissions
 // and provider receipts from its synthetic transport. No status or guard is bypassed.
 await assert.rejects(quoteSignalListeningStudyPolicyV1(args),/r16_policy_active_work/);
 const execution=await f.request();assert.ok(execution.id);
 await assert.rejects(quoteSignalListeningStudyPolicyV1(args),/r16_policy_active_work/);
}));
test('native provisioner feeds real Listening preparation/admission and the Study parent policy check without fixture R16 grants',{
 skip:!enabled,timeout:600000,
},async()=>{
 const {runMassLabelingAcceptanceFixtureV1}=await import('./signal-mass-labeling-acceptance.synthetic.fixture');
 const {saveSignalListeningConfigurationV1}=await import('../signal-listening-configuration');
 const {signalListeningBaseTemplateV1}=await import('@noisia/query-engine');
 const {prepareSignalListeningV1}=await import('../signal-listening-preparation');
 const {studyPolicyLockV1}=await import('../signal-study-core');
 await runMassLabelingAcceptanceFixtureV1('product',{beforeProcessing:async f=>{
  // The acceptance fixture offers an ordinary queued historical run. Its native
  // cancellation is legal before any call, just as in the discovery fixture.
  await f.database.query("UPDATE signal_labeling_runs SET status='canceled' WHERE id=$1",[f.run_id]);
  const prior=(await f.database.query(`SELECT p.id,p.policy_digest FROM signal_processing_policy_versions p JOIN signal_workspaces w ON w.organization_id=p.organization_id WHERE w.id=$1 AND p.status='active'`,[f.workspace_id])).rows[0]!;
  const args={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id,expected_policy_id:prior.id as string,expected_policy_digest:prior.policy_digest as string,
   valid_until:new Date(Date.now()+3600000).toISOString(),budget_micro_usd:5000000,discovery_cap_micro_usd:3000000,study_cap_micro_usd:2000000,prototype_cap_micro_usd:null};
  const quote=await quoteSignalListeningStudyPolicyV1(args);const provisioned=await provisionSignalListeningStudyPolicyV1({...args,plan_digest:quote.plan_digest,idempotency_key:randomUUID()});
  const configuration=await saveSignalListeningConfigurationV1({...f,expected_revision:0,provenance:'human',configuration:signalListeningBaseTemplateV1({category:'bicycles',lexicon_terms:['synthetic']})});
  const prepared=await prepareSignalListeningV1({...f,configuration_id:configuration.id,cap_micro_usd:1000000,idempotency_key:randomUUID(),provider_available:true,auto_discovery:true});
  assert.ok(prepared.run_id);
  const stored=(await f.database.query('SELECT policy_version_id FROM signal_listening_preparations WHERE id=$1',[prepared.preparation_id])).rows[0]!;assert.equal(stored.policy_version_id,provisioned.policy_id);
  const intent=(await f.database.query('SELECT policy_version_id,status FROM signal_listening_discovery_initial_intents WHERE preparation_id=$1',[prepared.preparation_id])).rows[0]!;
  assert.equal(intent.policy_version_id,provisioned.policy_id);assert.equal(intent.status,'admitted');
  const admission=(await f.database.query('SELECT a.policy_version_id,a.action FROM signal_labeling_runs r JOIN signal_processing_admissions a ON a.id=r.processing_admission_id WHERE r.id=$1',[prepared.run_id])).rows[0]!;
  assert.equal(admission.policy_version_id,provisioned.policy_id);assert.equal(admission.action,'mass_labeling_jev');
  const c=await f.database.connect();try{await c.query('BEGIN');const policy=await studyPolicyLockV1(c,f.workspace_id,provisioned.policy_id);assert.equal(policy.id,provisioned.policy_id);assert.equal(policy.max_execution_micro_usd,'2000000');await c.query('COMMIT');}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
  assert.equal((await f.database.query("SELECT count(*)::int n FROM engine_cost_events WHERE workspace_id=$1 AND workspace_contract IN('listening-discovery-round-v1','signal-study-step-v1')",[f.workspace_id])).rows[0]!.n,0,'setup and admission make no paid editorial request');
 }});
});
test('independent PostgreSQL sessions serialize setup, and a lost actual COMMIT ACK replays the same durable scope',{
 skip:!enabled,timeout:600000,
},async()=>{
 const {openDatabase}=await import(new URL('../../../scripts/dev-corpus/guard.mjs',import.meta.url).href);const admin:Pool=await openDatabase();
 const {createMassLabelingConcurrencyDatabaseV1}=await import('./signal-mass-labeling-concurrent.synthetic.fixture');
 const isolated=await createMassLabelingConcurrencyDatabaseV1(admin),pool=isolated.pool,raw=await pool.connect();
 try{await raw.query('BEGIN');const f=await createProcessingPolicyIdentitiesV1({database:pool,scoped:raw});
 const prior=(await raw.query(`INSERT INTO signal_processing_policy_versions(organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
 VALUES($1,1,'draft',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '2 days','UTC',20000000,$2) RETURNING id`,[f.first.organization_id,f.actors.internal])).rows[0]!;
 await raw.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
 VALUES($1,'mass_labeling_jev','provider','typesafe','jev-1.13.0','{}',signal_semantic_context_digest_json_v2('{}'),10000000,false)`,[prior.id]);
 await raw.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[prior.id]);await raw.query('COMMIT');
 const p=(await raw.query('SELECT id,policy_digest FROM signal_processing_policy_versions WHERE id=$1',[prior.id])).rows[0]!;
 const args={database:pool,workspace_id:f.first.workspace_id,actor_user_id:f.actors.internal,expected_policy_id:p.id as string,expected_policy_digest:p.policy_digest as string,valid_until:new Date(Date.now()+3600000).toISOString(),...allocation};
 await raw.query('BEGIN');await raw.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1::uuid::text,0))",[f.first.organization_id]);
 await assert.rejects(quoteSignalListeningStudyPolicyV1(args),/r16_policy_busy/);await raw.query('COMMIT');
 const quote=await quoteSignalListeningStudyPolicyV1(args),request={...args,plan_digest:quote.plan_digest,idempotency_key:randomUUID()};
 let inject=true;const lostAck={connect:async()=>{const c=await pool.connect();return{query:async(sql:string,params?:unknown[])=>{const value=await c.query(sql,params);if(sql==='COMMIT'&&inject){inject=false;throw Error('synthetic_commit_ack_lost');}return value;},release:()=>c.release()};}} as Pick<Pool,'connect'>;
 await assert.rejects(provisionSignalListeningStudyPolicyV1({...request,database:lostAck}),/synthetic_commit_ack_lost/);
 const replay=await provisionSignalListeningStudyPolicyV1(request);assert.equal(replay.replayed,true);
 assert.equal((await raw.query('SELECT count(*)::int n FROM signal_processing_policy_versions WHERE organization_id=$1',[f.first.organization_id])).rows[0].n,2);
 assert.equal((await raw.query('SELECT count(*)::int n FROM signal_listening_study_policy_scopes WHERE workspace_id=$1',[f.first.workspace_id])).rows[0].n,1);
 }finally{await raw.query('ROLLBACK').catch(()=>undefined);raw.release();await isolated.cleanup();await admin.end();}
});
test('native discovery sent outcome unknown and retained reservation forbid a new policy, without a provider resend',{
 skip:!enabled,timeout:600000,
},async()=>{
 const {withDiscoveryAdvanceFixtureV1}=await import('./signal-listening-discovery-advance.synthetic.fixture');
 const money=await import('../signal-listening-discovery-money');
 await withDiscoveryAdvanceFixtureV1(async f=>{
  const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
  const round=await money.enqueueSignalListeningDiscoveryRoundV1({...access,execution_id:f.execution.id,generation_id:f.confirmed.id,orphan_groups:[],provider_available:true});
  const lease=await money.claimSignalListeningDiscoveryRoundV1({database:f.database,round_id:round.id});assert.ok(lease);
  const call=await money.reserveSignalListeningDiscoveryCallV1({database:f.database,lease,provider_available:true});
  assert.equal(await money.markSignalListeningDiscoveryCallSentV1({database:f.database,lease,call_id:call.id,attempt_token:call.attempt_token,provider_available:true}),true);
  await money.failSignalListeningDiscoveryCallV1({database:f.database,lease,call_id:call.id,attempt_token:call.attempt_token,outcome:'outcome_unknown',error_code:'synthetic_send_ack_unknown'});
  const prior=(await f.database.query('SELECT id,policy_digest FROM signal_processing_policy_versions WHERE id=$1',[f.policy.id])).rows[0]!;
  await assert.rejects(quoteSignalListeningStudyPolicyV1({...access,expected_policy_id:prior.id as string,expected_policy_digest:prior.policy_digest as string,valid_until:new Date(Date.now()+3600000).toISOString(),...allocation}),/r16_policy_active_work/);
  const kept=(await f.database.query('SELECT call_state,reserved_micro_usd::text FROM engine_cost_events WHERE id=$1',[call.id])).rows[0]!;
  assert.equal(kept.call_state,'outcome_unknown');assert.ok(BigInt(kept.reserved_micro_usd as string)>0n);
  const root=(await f.database.query('SELECT scope_id FROM signal_listening_study_policy_bindings WHERE policy_id=$1',[f.policy.id])).rows[0]!.scope_id;
  assert.equal((await f.database.query('SELECT signal_listening_study_policy_exposure_v1($1)::text amount',[root])).rows[0]!.amount,'4000000','unknown review retains the complete cycle reservation, not just one small HTTP reserve');
  assert.equal((await f.database.query('SELECT count(*)::int n FROM engine_cost_events WHERE listening_round_id=$1',[round.id])).rows[0]!.n,1);
 });
});
test('scope allocation admits only the capacity that fits across independent Study owners and releases only verified terminal actual cost',{
 skip:!enabled,timeout:600000,
},async()=>withSignalStudyFixtureV1(async f=>{
 const {withStudyNativeRuntimeV1}=await import('./signal-study-runtime.synthetic.fixture');
 const {requestSignalStudyExecutionV1}=await import('../signal-study-executions');
 const second=await f.createStudy(),root=(await f.database.query('SELECT scope_id FROM signal_listening_study_policy_bindings WHERE policy_id=$1',[f.policy.id])).rows[0]!.scope_id;
 const amount=async()=>BigInt((await f.database.query('SELECT signal_listening_study_policy_exposure_v1($1)::text amount',[root])).rows[0]!.amount as string);
 assert.equal(await amount(),4000000n);
 const outcomes=await Promise.allSettled([f.request(),second.request()]);
 const winner=outcomes.find((v):v is PromiseFulfilledResult<Awaited<ReturnType<typeof f.request>>>=>v.status==='fulfilled');assert.ok(winner);
 assert.equal(outcomes.filter(v=>v.status==='fulfilled').length,1,'two independent native transactions cannot both allocate the same remaining money');
 const denied=outcomes.find((v):v is PromiseRejectedResult=>v.status==='rejected');assert.ok(denied);assert.match(String(denied.reason),/r16_policy_scope_budget_exhausted/);
 assert.equal(await amount(),8000000n,'the complete active caps are held before either owner makes a provider request');
 const third=await f.createStudy();await assert.rejects(third.request(),/r16_policy_scope_budget_exhausted/,'a later distinct execution cannot reuse an already held allocation');
 const originalKey=(await f.database.query('SELECT idempotency_key FROM signal_study_executions WHERE id=$1',[winner.value.id])).rows[0]!.idempotency_key as string;
 assert.equal((await requestSignalStudyExecutionV1({...f,configuration_id:winner.value.configuration_id,cap_micro_usd:4000000,idempotency_key:originalKey})).id,winner.value.id);
 assert.equal(await amount(),8000000n,'exact native request replay retains one durable allocation');
 await withStudyNativeRuntimeV1(f.database,async runtime=>{
  assert.equal((await runtime.run(winner.value.id)).status,'completed');
  const spent=BigInt((await f.database.query('SELECT signal_study_exposure_v1($1)::text amount',[winner.value.id])).rows[0]!.amount as string);
  assert.ok(spent>0n&&spent<100000n);assert.equal(await amount(),4000000n+spent,'closed actual cost remains charged; unused reservation alone is released');
  const counts=runtime.metrics();const again=await requestSignalStudyExecutionV1({...f,configuration_id:winner.value.configuration_id,cap_micro_usd:4000000,idempotency_key:randomUUID()});
  assert.notEqual(again.id,winner.value.id);assert.equal(await amount(),8000000n+spent);
  assert.equal((await runtime.run(again.id)).status,'completed');assert.equal(runtime.metrics().jevCalls,counts.jevCalls,'a legitimate cache replay fits remaining money without another paid JEV request');
 });
}));
test('nonzero initial JEV and Voyage stay inside the original cycle cap when its exact native H3 parent is linked',{
 skip:!enabled,timeout:600000,
},async()=>{
 const {withInitialDiscoveryFixtureV1}=await import('./signal-listening-discovery-initial.synthetic.fixture');
 const {startSignalListeningDiscoveryInitialV1}=await import('../signal-listening-discovery-initial');
 await withInitialDiscoveryFixtureV1(async f=>{
  const first=await f.request();assert.ok(first.intent);
  const root=(await f.database.query('SELECT scope_id FROM signal_listening_study_policy_bindings WHERE policy_id=$1',[f.policy.id])).rows[0]!.scope_id;
  const amount=async()=>(await f.database.query('SELECT signal_listening_study_policy_exposure_v1($1)::text amount',[root])).rows[0]!.amount;
  assert.equal(await amount(),'4000000');
  const prepared=first.result.run_id?first.result:(await f.prototypes(first.result.preparation_id)).result;assert.ok(prepared.run_id);await f.classify(prepared.run_id);
  const spent=(await f.database.query(`SELECT
   (SELECT COALESCE(sum(settled_micro_usd),0)::text FROM signal_labeling_calls WHERE run_id=$1) jev,
   (SELECT COALESCE(sum(c.settled_micro_usd),0)::text FROM signal_listening_preparations p JOIN signal_workspace_embedding_calls c ON c.run_id=p.prototype_run_id WHERE p.id=$2) voyage`,[prepared.run_id,first.result.preparation_id])).rows[0]!;
  assert.ok(BigInt(spent.jev as string)>0n&&BigInt(spent.voyage as string)>0n);
  assert.equal(await amount(),'4000000');const started=await startSignalListeningDiscoveryInitialV1({database:f.database,intent_id:first.intent.id});assert.ok(started?.execution);
  assert.equal(started.execution.cap_micro_usd,'4000000','parent receives the original cap, never a smaller remainder');
  assert.equal(BigInt((await f.database.query('SELECT signal_listening_discovery_exposure_v1($1)::text amount',[started.execution.id])).rows[0]!.amount as string),BigInt(spent.jev as string)+BigInt(spent.voyage as string));
  assert.equal(await amount(),'4000000','linking the parent neither duplicates nor forgets the initial paid stages');
  assert.deepEqual((await startSignalListeningDiscoveryInitialV1({database:f.database,intent_id:first.intent.id}))?.execution?.id,started.execution.id);
  assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_listening_study_policy_owners WHERE scope_id=$1',[root])).rows[0]!.n,2,'one exact initial booking plus its parent, deduplicated as the same cycle');
 },{prototypes:true});
});
test('native Monitoring inheritance and remove/reintroduce keep the same ledger root and settled owner exposure',{
 skip:!enabled,timeout:600000,
},async()=>withSignalStudyFixtureV1(async f=>{
 const {withStudyNativeRuntimeV1}=await import('./signal-study-runtime.synthetic.fixture');
 const {quoteMonitoringInsightPolicyV1,provisionMonitoringInsightPolicyV1}=await import('../signal-monitoring-insights-policy');
 const root=(await f.database.query('SELECT scope_id FROM signal_listening_study_policy_bindings WHERE policy_id=$1',[f.policy.id])).rows[0]!.scope_id;
 const execution=await f.request();await withStudyNativeRuntimeV1(f.database,async runtime=>{assert.equal((await runtime.run(execution.id)).status,'completed');});
 const spent=(await f.database.query('SELECT signal_listening_study_policy_exposure_v1($1)::text amount',[root])).rows[0]!.amount;
 assert.ok(BigInt(spent as string)>0n);
 const access={database:f.database,workspace_id:f.workspace_id,actor_user_id:f.actor_user_id};
 const quote=await quoteMonitoringInsightPolicyV1(access),monitor=await provisionMonitoringInsightPolicyV1({...access,plan_digest:quote.plan_digest});
 assert.equal((await f.database.query('SELECT scope_id FROM signal_listening_study_policy_bindings WHERE policy_id=$1',[monitor.policy_id])).rows[0]!.scope_id,root);
 const c=await f.database.connect();try{await c.query('BEGIN');
  const without=(await c.query(`INSERT INTO signal_processing_policy_versions(organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
   SELECT organization_id,version+1,'draft',clock_timestamp(),valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id FROM signal_processing_policy_versions WHERE id=$1 RETURNING id`,[monitor.policy_id])).rows[0]!;
  await c.query(`INSERT INTO signal_processing_policy_actions SELECT $2,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed
   FROM signal_processing_policy_actions WHERE policy_version_id=$1 AND action NOT IN('listening_discovery_review','study_analysis')`,[monitor.policy_id,without.id]);
  assert.equal((await c.query('SELECT signal_listening_study_policy_inherit_v1($1,$2,$3) root',[monitor.policy_id,without.id,f.actor_user_id])).rows[0]!.root,root);
  await c.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1",[monitor.policy_id]);await c.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[without.id]);await c.query('COMMIT');
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
 const current=(await f.database.query(`SELECT p.* FROM signal_processing_policy_versions p JOIN signal_workspaces w ON w.organization_id=p.organization_id WHERE w.id=$1 AND p.status='active'`,[f.workspace_id])).rows[0]!;
 const ledger=(await f.database.query('SELECT * FROM signal_listening_study_policy_scopes WHERE id=$1',[root])).rows[0]!;
 const request={...access,expected_policy_id:current.id as string,expected_policy_digest:current.policy_digest as string,valid_until:new Date(Date.now()+3600000).toISOString(),
  budget_micro_usd:Number(ledger.budget_micro_usd),discovery_cap_micro_usd:Number(ledger.discovery_cap_micro_usd),study_cap_micro_usd:Number(ledger.study_cap_micro_usd),prototype_cap_micro_usd:ledger.prototype_cap_micro_usd===null?null:Number(ledger.prototype_cap_micro_usd)};
 const reQuote=await quoteSignalListeningStudyPolicyV1(request),restored=await provisionSignalListeningStudyPolicyV1({...request,plan_digest:reQuote.plan_digest,idempotency_key:randomUUID()});
 assert.equal(restored.scope_id,root);assert.notEqual(restored.receipt_id,root);
 assert.equal((await f.database.query('SELECT signal_listening_study_policy_exposure_v1($1)::text amount',[root])).rows[0]!.amount,spent,'policy removal and reintroduction cannot reset spent or owner identity');
 assert.equal((await f.database.query('SELECT count(*)::int n FROM signal_listening_study_policy_scopes WHERE organization_id=$1 AND ledger_root_id=id',[ledger.organization_id])).rows[0]!.n,1);
},{complete_listening:true}));
test('native classic completion inherits an existing R16 scope without changing its budget or sibling access',{
 skip:!enabled,timeout:120000,
},async()=>fixture(async f=>{
 const {completeSignalClassicPolicyV1}=await import('../signal-classic-policy-completion');
 const args={database:f.database,workspace_id:f.first.workspace_id,actor_user_id:f.actors.internal,expected_policy_id:f.prior.id,expected_policy_digest:f.prior.policy_digest,valid_until:f.valid_until,...allocation};
 const quote=await quoteSignalListeningStudyPolicyV1(args),scope=await provisionSignalListeningStudyPolicyV1({...args,plan_digest:quote.plan_digest,idempotency_key:randomUUID()});
 const env={NOISIA_MENTION_FACETS_ENABLED:'true',NOISIA_BRAND_CONTEXT_POLICY_CREATOR_USER_ID:f.actors.internal,
  NOISIA_SEMANTIC_CONTEXT_MODEL:'claude-sonnet-4-6',NOISIA_SEMANTIC_CONTEXT_MODEL_VERSION:'claude-sonnet-4-6',
  NOISIA_SEMANTIC_CONTEXT_PRICING_VERSION:'claude-sonnet-4-6-standard-global-usd-2026-09-09',NOISIA_SEMANTIC_CONTEXT_MAX_INPUT_TOKENS:'20000',
  NOISIA_SEMANTIC_CONTEXT_MAX_OUTPUT_TOKENS:'8192',NOISIA_SEMANTIC_CONTEXT_INPUT_USD_PER_MILLION_TOKENS:'3',NOISIA_SEMANTIC_CONTEXT_OUTPUT_USD_PER_MILLION_TOKENS:'15'};
 assert.equal((await completeSignalClassicPolicyV1({database:f.database,workspace_id:f.first.workspace_id,brand_id:f.first.brand_id,actor_user_id:f.actors.internal,env})).status,'provisioned');
 const active=(await f.raw.query("SELECT id FROM signal_processing_policy_versions WHERE organization_id=$1 AND status='active'",[f.first.organization_id])).rows[0]!;
 assert.notEqual(active.id,scope.policy_id);assert.equal((await f.raw.query('SELECT scope_id FROM signal_listening_study_policy_bindings WHERE policy_id=$1',[active.id])).rows[0]!.scope_id,scope.scope_id);
 assert.equal((await f.raw.query('SELECT budget_micro_usd::text budget FROM signal_listening_study_policy_scopes WHERE id=$1',[scope.scope_id])).rows[0]!.budget,'15000000');
 assert.equal((await f.raw.query('SELECT signal_listening_study_policy_denied_actions_v1($1,$2) denied',[active.id,f.second.workspace_id])).rows[0]!.denied.includes('study_analysis'),true);
}));

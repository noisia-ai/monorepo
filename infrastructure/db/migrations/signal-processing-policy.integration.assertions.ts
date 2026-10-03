import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {admitSignalProcessingWithClientV1 as admit,readSignalProcessingPolicyWithQueryableV1 as read,
 type SignalProcessingActionV1,type SignalProcessingAdmitArgsV1} from '../signal-processing-policy';
import {loadSignalWorkspaceCapabilitiesStoreV1} from '../signal-workspace-capabilities';
import {createProcessingPolicyIdentitiesV1,type ProcessingPolicyFixtureTransactionV1} from './signal-processing-policy.fixture';

const digest=(text:string)=>`sha256:${createHash('sha256').update(text).digest('hex')}`;
type PolicyAction={action:SignalProcessingActionV1;kind:'free'|'provider';provider:string|null;model:string|null;cap:string;automatic?:boolean};
const actions:PolicyAction[]=[
 {action:'corpus_preparation',kind:'free',provider:null,model:null,cap:'0'},
 {action:'topic_fit',kind:'free',provider:null,model:null,cap:'0'},
 {action:'topic_fit_incremental',kind:'free',provider:null,model:null,cap:'0',automatic:true},
 {action:'brand_context_proposal',kind:'provider',provider:'anthropic',model:'claude-sonnet-4-6',cap:'1000000'},
 {action:'corpus_embeddings',kind:'provider',provider:'voyage',model:'voyage-4-large',cap:'1000000'},
];

/** New policy acceptance only. Existing histories are created by the injected
 * synthetic ledger bootstrap, never copied from the retained customer fixture.
 * Every negative branch uses a real savepoint under the runner's outer rollback. */
export async function assertSignalProcessingPolicyV1(args:ProcessingPolicyFixtureTransactionV1&{
 probeOrganizationLock:(scope:{organization_id:string;budget_date:string})=>Promise<void>;
 progress?:(scenarios:string[])=>void;
 seedMoneyHistory?:(scope:{organization_id:string;actor_user_id:string;
  free_preparation_actors:Array<{id:string;grant:'admin'|'comment'|'read'|null;allowed:boolean}>})=>Promise<{states:string[];confirmed_micro_usd:string;total_micro_usd:string;free_preparation_scenarios:number;free_preparation_recovery_scenarios:string[]}>;
}){
 const f=await createProcessingPolicyIdentitiesV1(args),{query,scoped}=f,completed:string[]=[];
 const isolated=async<T>(run:()=>Promise<T>)=>{await query('BEGIN');try{return await run();}finally{await query('ROLLBACK');}};
 const step=async(name:string,run:()=>Promise<void>)=>{await run();completed.push(name);args.progress?.([...completed]);};
 const denied=async(run:()=>Promise<unknown>,code?:string)=>isolated(async()=>{
  await assert.rejects(run,error=>Boolean(error&&typeof error==='object'&&'message' in error
   &&(code?error.message===code:'code' in error&&['23514','23505','42501'].includes(String(error.code)))));
 });
 const request=(change:Partial<SignalProcessingAdmitArgsV1>={}):SignalProcessingAdmitArgsV1=>({workspace_id:f.first.workspace_id,
  actor_user_id:f.actors.firstAdmin,action:'corpus_embeddings',target_id:randomUUID(),idempotency_key:randomUUID(),
  request_digest:digest('synthetic request'),execution_cap_micro_usd:'1000',...change});
 const view=(workspace_id=f.first.workspace_id,actor_user_id=f.actors.firstAdmin,available=true)=>read({queryable:scoped,
  workspace_id,actor_user_id,action_availability:Object.fromEntries(actions.map(action=>[action.action,action.kind==='free'||available]))});
 const makePolicy=async(options:{organization_id?:string;creator?:string;version?:number;cap?:string;timezone?:string;
  starts?:string;ends?:string;actions?:PolicyAction[];activate?:boolean}={})=>{
  const id=randomUUID();
  await query(`INSERT INTO signal_processing_policy_versions(id,organization_id,version,valid_from,valid_until,budget_timezone,
   daily_cap_micro_usd,created_by_user_id) VALUES($1,$2,$3,clock_timestamp()+$4::interval,clock_timestamp()+$5::interval,$6,$7,$8)`,
  [id,options.organization_id??f.first.organization_id,options.version??1,options.starts??'-1 hour',options.ends??'1 day',options.timezone??'America/Mexico_City',options.cap??'100000000',options.creator??f.actors.internal]);
  for(const action of options.actions??actions){const configuration={fixture:'processing-policy-v1',action:action.action};
   await query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,
    configuration_digest,max_execution_micro_usd,automatic_allowed) VALUES($1,$2,$3,$4,$5,$6::jsonb,
     signal_semantic_context_digest_json_v2($6::jsonb),$7,$8)`,[id,action.action,action.kind,action.provider,action.model,JSON.stringify(configuration),action.cap,action.automatic??false]);}
  if(options.activate!==false)await query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1",[id]);
  return id;
 };
 const count=async()=>(await query<{n:number}>('SELECT count(*)::int n FROM signal_processing_admissions')).rows[0]!.n;
 await step('all processing entry points and policy tables deny public application roles',async()=>{
  const acl=(await query<{functions:number;public_execute:number;application_execute:number;owner_execute:number}>(`WITH functions AS (
   SELECT p.oid,p.proowner,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND (p.proname LIKE 'signal_processing_%' OR p.proname='admit_signal_processing_v1'))
   SELECT (SELECT count(*)::int FROM functions) functions,
    (SELECT count(*)::int FROM functions f CROSS JOIN LATERAL aclexplode(COALESCE(f.proacl,acldefault('f',f.proowner))) acl
      WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') public_execute,
    (SELECT count(*)::int FROM functions f CROSS JOIN pg_roles r WHERE r.rolname IN('anon','authenticated')
      AND has_function_privilege(r.oid,f.oid,'EXECUTE')) application_execute,
    (SELECT count(*)::int FROM functions f WHERE has_function_privilege(f.proowner,f.oid,'EXECUTE')) owner_execute`)).rows[0]!;
  assert.equal(acl.functions,13);assert.equal(acl.public_execute,0);assert.equal(acl.application_execute,0);assert.equal(acl.owner_execute,acl.functions);
  assert.equal((await query<{n:number}>(`SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl WHERE n.nspname='public'
   AND c.relname IN('signal_processing_policy_versions','signal_processing_policy_actions','signal_processing_admissions')
   AND acl.grantee=0`)).rows[0]!.n,0);
 });
 await step('exact DB role/admin grant, tenant, actor and suspension',async()=>{
  assert.equal((await view()).status,'missing');
  for(const actor_user_id of [f.actors.firstAdmin,f.actors.secondAdmin]){
   const workspace_id=actor_user_id===f.actors.firstAdmin?f.first.workspace_id:f.second.workspace_id;
   const capability=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:scoped,workspace_id,actor_user_id});
   assert.equal(capability.can_request_processing,true);assert.equal(capability.can_execute_topics,false);
  }
  for(const actor_user_id of [f.actors.noGrant,f.actors.readGrant,f.actors.commentGrant,f.actors.alias,f.actors.manager,f.actors.viewer,f.actors.suspended,f.actors.foreignAdmin,f.actors.internal])
   await denied(()=>admit(scoped,request({actor_user_id})),'processing_forbidden');
  await denied(()=>admit(scoped,request({workspace_id:f.foreign.workspace_id})),'processing_forbidden');
  await denied(()=>admit(scoped,request({workspace_id:f.second.workspace_id})),'processing_forbidden');
  await denied(()=>admit(scoped,request()),'processing_policy_missing');
 });
 await step('policy writer, active uniqueness, exact provider/model and canonical configuration',async()=>{
  await denied(()=>makePolicy({creator:f.actors.firstAdmin}),'processing_policy_creator_forbidden');
  await denied(()=>makePolicy({timezone:'Noisia/Invented'}),'processing_policy_timezone_invalid');
  await denied(()=>makePolicy({actions:[{...actions[3]!,provider:null,model:null}]}));
  await denied(()=>makePolicy({actions:[{...actions[3]!,model:'claude-opus-4-6'}]}));
  await isolated(async()=>{
   const draft=await makePolicy({activate:false,actions:[]});
   await denied(()=>query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,
    configuration_digest,max_execution_micro_usd) VALUES($1,'corpus_embeddings','provider','voyage','voyage-4-large','{}',$2,1)`,[draft,digest('not the configuration')]));
  });
 });
 const policy=await makePolicy();
 await step('policy and action definitions are immutable after activation',async()=>{
  await denied(()=>makePolicy({version:2}));
  await denied(()=>query('UPDATE signal_processing_policy_versions SET daily_cap_micro_usd=daily_cap_micro_usd+1 WHERE id=$1',[policy]),'processing_policy_version_immutable');
  await denied(()=>query('UPDATE signal_processing_policy_actions SET max_execution_micro_usd=0 WHERE policy_version_id=$1',[policy]),'processing_policy_action_immutable');
  await denied(()=>query('DELETE FROM signal_processing_policy_versions WHERE id=$1',[policy]),'processing_policy_history_retained');
  assert.equal((await view()).status,'ready');
  const off=await view(f.first.workspace_id,f.actors.firstAdmin,false);assert.equal(off.status,'provider_unavailable');
  assert.ok(off.actions.filter(row=>row.kind==='free').every(row=>row.available));
  assert.ok(off.actions.filter(row=>row.kind==='provider').every(row=>!row.available));
 });
 await step('unknown actions, automatic permission and per-execution bounds fail closed',async()=>{
  await denied(()=>admit(scoped,request({action:'topic_interpretation'})),'processing_action_unavailable');
  await denied(()=>admit(scoped,request({execution_cap_micro_usd:'1000001'})),'processing_admission_invalid');
  await denied(()=>admit(scoped,request({automatic:true})),'processing_admission_invalid');
  await denied(()=>admit(scoped,request({action:'corpus_preparation',execution_cap_micro_usd:'1'})),'processing_admission_invalid');
  const free=await admit(scoped,request({action:'topic_fit_incremental',execution_cap_micro_usd:'0',automatic:true}));
  assert.equal(free.receipt.provider,null);assert.equal(free.receipt.execution_cap_micro_usd,'0');
 });
 const input=request(),accepted=await admit(scoped,input);
 const capacity=(change:{workspace_id?:string;actor_user_id?:string;target_id?:string;admission_id?:string|null;action?:string;
  provider?:string|null;model?:string|null;configuration?:unknown;cap?:string}={})=>query(`SELECT signal_processing_capacity_v1(
   $1::uuid,$2::uuid,$3::uuid,$4::uuid,ARRAY[$5]::text[],$6,$7,$8::jsonb,$9::bigint)`,[
  change.workspace_id??input.workspace_id,change.actor_user_id??input.actor_user_id,change.target_id??input.target_id,
  change.admission_id===undefined?accepted.receipt.id:change.admission_id,change.action??input.action,
  change.provider===undefined?accepted.receipt.provider:change.provider,change.model===undefined?accepted.receipt.model:change.model,
  JSON.stringify(change.configuration??accepted.receipt.configuration),change.cap??input.execution_cap_micro_usd]);
 await step('exact receipt, second-connection organizational lock and inert ACK replay',async()=>{
  assert.equal(accepted.replayed,false);assert.equal(accepted.receipt.workspace_id,f.first.workspace_id);
  assert.equal(accepted.receipt.organization_id,f.first.organization_id);assert.equal(accepted.receipt.brand_id,f.first.brand_id);
  assert.equal(accepted.receipt.provider,'voyage');assert.equal(accepted.receipt.model,'voyage-4-large');
  assert.equal(accepted.receipt.policy_version_id,policy);assert.match(accepted.receipt.receipt_digest,/^sha256:[a-f0-9]{64}$/u);
  await args.probeOrganizationLock({organization_id:f.first.organization_id,budget_date:accepted.receipt.budget_date});
  const before=await count();const replay=await admit(scoped,input);assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,accepted.receipt);
  assert.equal(await count(),before);assert.equal((await view()).exposure.total_micro_usd,'0','admission is not a fourth monetary ledger');
  for(const change of [{target_id:randomUUID()},{request_digest:digest('different body')},{execution_cap_micro_usd:'999'},{automatic:true},{action:'brand_context_proposal' as const}])
   await denied(()=>admit(scoped,{...input,...change}),'processing_idempotency_conflict');
  await denied(()=>query('UPDATE signal_processing_admissions SET execution_cap_micro_usd=0 WHERE id=$1',[accepted.receipt.id]),'processing_admission_immutable');
 });
 await step('a caller rollback cannot leave an admission before its downstream run/outbox exists',async()=>{
  const before=await count();await isolated(async()=>{await admit(scoped,request());assert.equal(await count(),before+1);});
  assert.equal(await count(),before);
 });
 await step('capacity binds the exact actor, workspace, target, action, model, configuration and cap',async()=>{
  await capacity();
  for(const change of [{workspace_id:f.second.workspace_id,actor_user_id:f.actors.secondAdmin},{target_id:randomUUID()},
   {action:'brand_context_proposal'},{provider:'anthropic'},{model:'voyage-other'},{configuration:{}},{cap:'1001'}])
   await denied(()=>capacity(change),'processing_admission_invalid');
  await denied(()=>capacity({admission_id:null}),'processing_admission_required');
 });
 await step('revocation blocks new work; historical receipt replay never renews or enqueues',async()=>isolated(async()=>{
  await query("UPDATE signal_processing_policy_versions SET status='revoked',revoked_at=clock_timestamp() WHERE id=$1",[policy]);
  assert.equal((await view()).status,'revoked');
  const before=await count();const replay=await admit(scoped,input);assert.deepEqual(replay.receipt,accepted.receipt);assert.equal(replay.replayed,true);
  await denied(()=>capacity(),'processing_admission_invalid');
  await denied(()=>admit(scoped,request()),'processing_policy_missing');assert.equal(await count(),before);
  await denied(()=>makePolicy({version:2,timezone:'Asia/Tokyo'}));
 }));
 await step('revoked assignment, inactive brand/workspace/organization and actor stop even replay',async()=>{
  for(const sql of ["UPDATE user_brand_access SET revoked_at=clock_timestamp() WHERE user_id=$1",
   "UPDATE users SET status='suspended' WHERE id=$1"])
   await isolated(async()=>{await query(sql,[f.actors.firstAdmin]);await denied(()=>admit(scoped,input),'processing_forbidden');});
  for(const [table,id] of [['organizations',f.first.organization_id],['brands',f.first.brand_id],['signal_workspaces',f.first.workspace_id]])
   await isolated(async()=>{await query(`UPDATE ${table} SET status='archived' WHERE id=$1`,[id]);await denied(()=>admit(scoped,input),'processing_forbidden');});
 });
 await step('future and expired policy cannot admit either free or provider actions',async()=>{
  for(const window of [{starts:'1 hour',ends:'2 hour'},{starts:'-2 hour',ends:'-1 hour'}])await isolated(async()=>{
   await query("UPDATE signal_processing_policy_versions SET status='revoked',revoked_at=clock_timestamp() WHERE id=$1",[policy]);
   await makePolicy({...window,version:2});assert.equal((await view()).status,'expired');
   await denied(()=>admit(scoped,request()),'processing_admission_invalid');
   await denied(()=>admit(scoped,request({action:'corpus_preparation',execution_cap_micro_usd:'0'})),'processing_admission_invalid');
  });
 });
 await step('expiry between admission and capacity is fenced using the real database clock',async()=>isolated(async()=>{
  await query("UPDATE signal_processing_policy_versions SET status='revoked',revoked_at=clock_timestamp() WHERE id=$1",[policy]);
  await makePolicy({version:2,ends:'1 second'});
  const latest=await admit(scoped,request());
  await query('SELECT pg_sleep(1.05)');
  const before=await count();await denied(()=>capacity({target_id:latest.receipt.target_id,admission_id:latest.receipt.id}),'processing_admission_invalid');
  assert.equal(await count(),before);
 }));
 let money:null|Awaited<ReturnType<NonNullable<typeof args.seedMoneyHistory>>>=null;
 if(args.seedMoneyHistory){
  money=await args.seedMoneyHistory({organization_id:f.first.organization_id,actor_user_id:f.actors.internal,free_preparation_actors:[
   {id:f.actors.firstAdmin,grant:'admin',allowed:true},{id:f.actors.commentGrant,grant:'comment',allowed:true},
   {id:f.actors.alias,grant:'admin',allowed:true},{id:f.actors.manager,grant:'comment',allowed:true},
   {id:f.actors.readGrant,grant:'read',allowed:false},{id:f.actors.viewer,grant:'admin',allowed:false},
   {id:f.actors.noGrant,grant:null,allowed:false},{id:f.actors.suspended,grant:'admin',allowed:false},{id:f.actors.foreignAdmin,grant:'admin',allowed:false}]});
  await step('existing free preparation remains scoped, replayable and independent from payment permission',async()=>{
   assert.equal(money!.free_preparation_scenarios,9);
  });
  for(const scenario of ['expired running lease cannot rotate or extend after actor revocation',
   'revoked owner permits mechanical reaper cleanup','revocation between requeue and claim stops all preparation',
   'a current new actor reuses completed preparation without requeue or old-key adoption'])await step(scenario,async()=>{
    assert.ok(money!.free_preparation_recovery_scenarios.includes(scenario));
   });
  await step('three real ledgers aggregate across workspaces/providers, with no duplicated uncertain amount',async()=>{
   const own=await view(),otherWorkspace=await view(f.second.workspace_id,f.actors.secondAdmin);
   assert.deepEqual(otherWorkspace.exposure,own.exposure);assert.equal(own.exposure.total_micro_usd,money!.total_micro_usd);
   assert.equal(own.exposure.confirmed_micro_usd,money!.confirmed_micro_usd);
   assert.ok(BigInt(own.exposure.total_micro_usd)>0n);
   assert.equal((await view(f.foreign.workspace_id,f.actors.foreignAdmin)).exposure.total_micro_usd,'0');
  });
  await step('all new ledger entries retain their sealed monetary organization',async()=>{
   for(const table of ['signal_semantic_context_budget_reservations','signal_workspace_embedding_calls','engine_cost_events']){
    const rows=(await query<{id:string;processing_organization_id:string}>(`SELECT c.id,c.processing_organization_id FROM ${table} c
     JOIN signal_workspaces w ON w.id=c.workspace_id WHERE w.organization_id=$1`,[f.first.organization_id])).rows;
    assert.ok(rows.length>0);assert.ok(rows.every(row=>row.processing_organization_id===f.first.organization_id));
    await denied(()=>query(`UPDATE ${table} SET processing_organization_id=$2 WHERE id=$1`,[rows[0]!.id,f.foreign.organization_id]),'processing_money_organization_immutable');
   }
  });
  await step('settled exposure enforces one organizational cap across two actors and providers',async()=>isolated(async()=>{
   await query("UPDATE signal_processing_policy_versions SET status='revoked',revoked_at=clock_timestamp() WHERE id=$1",[policy]);
   await makePolicy({version:2,cap:money!.total_micro_usd});assert.equal((await view()).status,'daily_cap_exhausted');
   await denied(()=>admit(scoped,request({execution_cap_micro_usd:'1'})),'processing_daily_cap_exhausted');
   await denied(()=>admit(scoped,request({workspace_id:f.second.workspace_id,actor_user_id:f.actors.secondAdmin,action:'brand_context_proposal',execution_cap_micro_usd:'1'})),'processing_daily_cap_exhausted');
   assert.equal((await admit(scoped,request({action:'corpus_preparation',execution_cap_micro_usd:'0'}))).receipt.execution_cap_micro_usd,'0');
  }));
 }
 return{passed:completed.length,scenarios:completed,ledger_states:money?.states??[],
  concurrency:'one real writer under rollback; controlled interleaving; separate connection verifies advisory contention only'};
}

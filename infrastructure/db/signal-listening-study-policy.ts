import type {Pool,PoolClient} from 'pg';
import {SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';
import {loadSignalWorkspaceCapabilitiesStoreV1} from './signal-workspace-capabilities';

/** Internal operator setup, never called implicitly by save/start/execute. Caps
 * reserve each active owner against one shared, persistent pilot allocation. */
export type SignalListeningStudyPolicyArgsV1={database:Pick<Pool,'connect'>;workspace_id:string;actor_user_id:string;
 expected_policy_id:string;expected_policy_digest:string;valid_until:string;budget_micro_usd:number;
 discovery_cap_micro_usd:number;study_cap_micro_usd:number;prototype_cap_micro_usd?:number|null};
type Request=Omit<SignalListeningStudyPolicyArgsV1,'database'|'prototype_cap_micro_usd'>&{contract_version:'signal-listening-study-policy-request-v1';prototype_cap_micro_usd:number|null};
type Prior={id:string;organization_id:string;version:string;policy_digest:string;valid_from:string;valid_until:string;budget_timezone:string;daily_cap_micro_usd:string|null};
type Action={action:string;kind:string;provider:string|null;model:string|null;configuration:unknown;configuration_digest:string;max_execution_micro_usd:string|null;automatic_allowed:boolean};
type Scope={id:string;ledger_root_id:string;workspace_id:string;actor_user_id:string;policy_id:string;request_digest:string;plan_digest:string;restricted_actions:string[];
 budget_micro_usd:string;discovery_cap_micro_usd:string;study_cap_micro_usd:string;prototype_cap_micro_usd:string|null};
export class SignalListeningStudyPolicyErrorV1 extends Error{
 constructor(readonly code:string,readonly status=409){super(code);this.name='SignalListeningStudyPolicyErrorV1';}
}
function fail(code:string,status=409):never{throw new SignalListeningStudyPolicyErrorV1('r16_policy_'+code,status);}
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u,sha=/^sha256:[a-f0-9]{64}$/u;
/** The visible allocation is checked before opening any connection. */
export function assertSignalListeningStudyPolicyBudgetV1(args:Pick<SignalListeningStudyPolicyArgsV1,'budget_micro_usd'|'discovery_cap_micro_usd'|'study_cap_micro_usd'|'prototype_cap_micro_usd'>){
 const values=[args.budget_micro_usd,args.discovery_cap_micro_usd,args.study_cap_micro_usd,...(args.prototype_cap_micro_usd==null?[]:[args.prototype_cap_micro_usd])];
 if(values.some(v=>!Number.isSafeInteger(v)||v<=0)||BigInt(args.discovery_cap_micro_usd)+BigInt(args.study_cap_micro_usd)+BigInt(args.prototype_cap_micro_usd??0)>BigInt(args.budget_micro_usd))fail('budget_invalid',422);
}
function validate(args:SignalListeningStudyPolicyArgsV1){
 assertSignalListeningStudyPolicyBudgetV1(args);
 if(![args.workspace_id,args.actor_user_id,args.expected_policy_id].every(v=>uuid.test(v))||!sha.test(args.expected_policy_digest)
  ||typeof args.valid_until!=='string'||args.valid_until.length<1||args.valid_until.length>100)fail('request_invalid',422);
}
async function authority(c:PoolClient,args:SignalListeningStudyPolicyArgsV1,lock:boolean){
 const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:c,workspace_id:args.workspace_id,actor_user_id:args.actor_user_id,lock_authority:lock});
 const scope=(await c.query<{organization_id:string}>(`SELECT w.organization_id FROM signal_workspaces w JOIN users u ON u.id=$2
  WHERE w.id=$1 AND u.status='active' AND u.user_type='noisia_internal' AND u.primary_role IN('noisia_admin','founder','admin')`,[args.workspace_id,args.actor_user_id])).rows[0];
 if(!scope||!caps.can_request_processing||!(await c.query<{valid:boolean}>('SELECT signal_processing_actor_v1($1,$2) valid',[args.workspace_id,args.actor_user_id])).rows[0]?.valid)fail('forbidden',403);
 return scope.organization_id;
}
async function lock(c:PoolClient,args:SignalListeningStudyPolicyArgsV1){
 const org=await authority(c,args,false);
 const acquired=(await c.query<{locked:boolean}>("SELECT pg_try_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1::uuid::text,0)) locked",[org])).rows[0]?.locked;
 if(!acquired)fail('busy');
 if(await authority(c,args,true)!==org)fail('forbidden',403);return org;
}
async function normalizedRequest(c:PoolClient,args:SignalListeningStudyPolicyArgsV1):Promise<Request>{
 const valid_until=(await c.query<{value:string}>(`SELECT CASE WHEN isfinite($1::timestamptz)
  THEN to_char($1::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') ELSE $1::text END value`,[args.valid_until])).rows[0]!.value;
 return{contract_version:'signal-listening-study-policy-request-v1',workspace_id:args.workspace_id,actor_user_id:args.actor_user_id,
  expected_policy_id:args.expected_policy_id,expected_policy_digest:args.expected_policy_digest,valid_until,
  budget_micro_usd:args.budget_micro_usd,discovery_cap_micro_usd:args.discovery_cap_micro_usd,study_cap_micro_usd:args.study_cap_micro_usd,
  prototype_cap_micro_usd:args.prototype_cap_micro_usd??null};
}
async function readPlan(c:PoolClient,args:SignalListeningStudyPolicyArgsV1,org:string,request:Request){
 const prior=(await c.query<Prior>(`SELECT id,organization_id,version::text,policy_digest,valid_from::text,valid_until::text,budget_timezone,daily_cap_micro_usd::text
  FROM signal_processing_policy_versions WHERE organization_id=$1 AND status='active' AND valid_from<=clock_timestamp() AND valid_until>clock_timestamp()
  ORDER BY version DESC LIMIT 1`,[org])).rows[0];
 if(!prior||prior.id!==args.expected_policy_id||prior.policy_digest!==args.expected_policy_digest)fail('changed');
 if((await c.query<{busy:boolean}>('SELECT signal_listening_study_policy_busy_v1($1) busy',[org])).rows[0]?.busy)fail('active_work');
 const dates=(await c.query<{valid:boolean}>(`SELECT isfinite($1::timestamptz) AND $1::timestamptz>clock_timestamp()
  AND $1::timestamptz<=$2::timestamptz AND $1::timestamptz<=clock_timestamp()+interval '30 days' valid`,[request.valid_until,prior.valid_until])).rows[0];
 if(!dates?.valid)fail('dates_invalid',422);
 const exposure=(await c.query<{total_micro_usd:string;reserved_micro_usd:string;ambiguous_micro_usd:string}>(`SELECT total_micro_usd::text,reserved_micro_usd::text,ambiguous_micro_usd::text
  FROM signal_processing_org_exposure_v1($1,(clock_timestamp() AT TIME ZONE $2)::date,$2)`,[org,prior.budget_timezone])).rows[0]!;
 if(BigInt(exposure.reserved_micro_usd)>0n||BigInt(exposure.ambiguous_micro_usd)>0n)fail('active_work');
 const actions=(await c.query<Action>(`SELECT action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd::text,automatic_allowed
  FROM signal_processing_policy_actions WHERE policy_version_id=$1 ORDER BY action`,[prior.id])).rows;
 if(!actions.some(a=>a.action==='mass_labeling_jev'&&a.kind==='provider'&&a.provider==='typesafe'&&a.model==='jev-1.13.0'))fail('base_jev_action_required');
 const inherited=(await c.query<Scope>('SELECT scope.*,scope.discovery_cap_micro_usd::text,scope.study_cap_micro_usd::text,scope.prototype_cap_micro_usd::text FROM signal_listening_study_policy_bindings binding JOIN signal_listening_study_policy_scopes scope ON scope.id=binding.scope_id WHERE binding.policy_id=$1',[prior.id])).rows[0];
 if(inherited&&(inherited.workspace_id!==args.workspace_id||request.budget_micro_usd!==Number(inherited.budget_micro_usd)
  ||request.discovery_cap_micro_usd!==Number(inherited.discovery_cap_micro_usd)||request.study_cap_micro_usd!==Number(inherited.study_cap_micro_usd)
  ||request.prototype_cap_micro_usd!==(inherited.prototype_cap_micro_usd===null?null:Number(inherited.prototype_cap_micro_usd))))fail('scope_widened');
 const existing_scope_exposure=inherited?(await c.query<{amount:string}>('SELECT signal_listening_study_policy_exposure_v1($1)::text amount',[inherited.id])).rows[0]!.amount:'0';
 const remaining_scope=BigInt(request.budget_micro_usd)>BigInt(existing_scope_exposure)?BigInt(request.budget_micro_usd)-BigInt(existing_scope_exposure):0n;
 if(prior.daily_cap_micro_usd!==null&&BigInt(exposure.total_micro_usd)+remaining_scope>BigInt(prior.daily_cap_micro_usd))fail('daily_limit');
 const configurations=(await c.query<{discovery:unknown;study:unknown}>('SELECT signal_listening_discovery_review_configuration_v1() discovery,signal_study_analysis_configuration_v1() study')).rows[0]!;
 const required:Array<{action:string;provider:string;model:string;configuration:unknown;cap:number}>=[
  {action:'listening_discovery_review',provider:'anthropic',model:'claude-sonnet-4-6',configuration:configurations.discovery,cap:request.discovery_cap_micro_usd},
  {action:'study_analysis',provider:'anthropic',model:'claude-sonnet-4-6',configuration:configurations.study,cap:request.study_cap_micro_usd},
  ...(request.prototype_cap_micro_usd===null?[]:[{action:'topic_prototype_embeddings',provider:'voyage',model:'voyage-4-large',configuration:SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,cap:request.prototype_cap_micro_usd}])];
 const additions=required.filter(r=>!actions.some(a=>a.action===r.action));
 for(const r of required){const old=actions.find(a=>a.action===r.action);if(old&&(old.kind!=='provider'||old.provider!==r.provider||old.model!==r.model
  ||digest(old.configuration)!==digest(r.configuration)||old.max_execution_micro_usd!==null&&BigInt(r.cap)>BigInt(old.max_execution_micro_usd)))fail('incompatible_action');}
 const next_version=(await c.query<{value:string}>('SELECT (max(version)+1)::text value FROM signal_processing_policy_versions WHERE organization_id=$1',[org])).rows[0]!.value;
 const restricted_actions=[...new Set(['listening_discovery_review','study_analysis',...(inherited?.restricted_actions??[]),...additions.map(a=>a.action)])].sort();
 const request_digest=digest(request);
 const plan={contract_version:'signal-listening-study-policy-plan-v1' as const,scope:'workspace' as const,workspace_id:args.workspace_id,actor_user_id:args.actor_user_id,
  organization_id:org,request_digest,prior,next_version,valid_until:request.valid_until,budget_micro_usd:request.budget_micro_usd,
  prototype_cap_is_listening_subcap:true,allocation:{discovery_cap_micro_usd:request.discovery_cap_micro_usd,study_cap_micro_usd:request.study_cap_micro_usd,prototype_cap_micro_usd:request.prototype_cap_micro_usd},
  inherited_actions:actions,added_actions:additions.map(a=>a.action),restricted_actions,
  additions:additions.map(a=>({...a,kind:'provider',max_execution_micro_usd:a.cap,automatic_allowed:false,configuration_digest:digest(a.configuration)})),
  prototype_configuration:request.prototype_cap_micro_usd===null?null:SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
  ledger_root_id:inherited?.id??null,existing_scope_exposure_micro_usd:existing_scope_exposure,remaining_scope_micro_usd:remaining_scope.toString(),allocation_semantics:'shared_scope_budget_with_full_active_owner_reservations_and_terminal_actual_exposure' as const};
 return{prior,request,request_digest,plan,plan_digest:digest(plan)};
}
async function transaction<T>(args:SignalListeningStudyPolicyArgsV1,run:(c:PoolClient,org:string,request:Request)=>Promise<T>){
 validate(args);const c=await args.database.connect();
 try{await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');const org=await lock(c,args);const request=await normalizedRequest(c,args);
  const value=await run(c,org,request);await c.query('COMMIT');return value;
 }catch(error){await c.query('ROLLBACK').catch(()=>undefined);throw error;}finally{c.release();}
}
/** No receipt, policy, admission, queue entry or provider request is created. */
export function quoteSignalListeningStudyPolicyV1(args:SignalListeningStudyPolicyArgsV1){
 return transaction(args,(c,org,request)=>readPlan(c,args,org,request));
}
export function provisionSignalListeningStudyPolicyV1(args:SignalListeningStudyPolicyArgsV1&{plan_digest:string;idempotency_key:string}){
 if(!sha.test(args.plan_digest)||!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key))fail('request_invalid',422);
 return transaction(args,async(c,org,request)=>{
  const replay=(await c.query<Scope>('SELECT * FROM signal_listening_study_policy_scopes WHERE workspace_id=$1 AND actor_user_id=$2 AND idempotency_key=$3',[args.workspace_id,args.actor_user_id,args.idempotency_key])).rows[0];
  if(replay){if(replay.request_digest!==digest(request)||replay.plan_digest!==args.plan_digest)fail('idempotency_conflict');
   if(!(await c.query<{valid:boolean}>(`SELECT status='active' AND valid_from<=clock_timestamp() AND valid_until>clock_timestamp() valid
    FROM signal_processing_policy_versions WHERE id=$1 AND organization_id=$2`,[replay.policy_id,org])).rows[0]?.valid)fail('changed');
   return{receipt_id:replay.id,scope_id:replay.ledger_root_id,policy_id:replay.policy_id,replayed:true};
  }
  const read=await readPlan(c,args,org,request);if(read.plan_digest!==args.plan_digest)fail('plan_changed');
  const next=(await c.query<{id:string}>(`INSERT INTO signal_processing_policy_versions(organization_id,version,status,valid_from,valid_until,budget_timezone,daily_cap_micro_usd,created_by_user_id)
   VALUES($1,$2,'draft',clock_timestamp(),$3,$4,$5,$6) RETURNING id`,[org,read.plan.next_version,request.valid_until,read.prior.budget_timezone,read.prior.daily_cap_micro_usd,args.actor_user_id])).rows[0]!;
  await c.query(`INSERT INTO signal_processing_policy_actions SELECT $1,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed
   FROM signal_processing_policy_actions WHERE policy_version_id=$2`,[next.id,read.prior.id]);
  for(const addition of read.plan.additions)await c.query(`INSERT INTO signal_processing_policy_actions(policy_version_id,action,kind,provider,model,configuration,configuration_digest,max_execution_micro_usd,automatic_allowed)
   VALUES($1,$2,'provider',$3,$4,$5::jsonb,signal_semantic_context_digest_json_v2($5::jsonb),$6,false)`,[next.id,addition.action,addition.provider,addition.model,JSON.stringify(addition.configuration),addition.max_execution_micro_usd]);
  const receipt=(await c.query<{id:string;ledger_root_id:string}>(`INSERT INTO signal_listening_study_policy_scopes(organization_id,workspace_id,actor_user_id,prior_policy_id,prior_policy_digest,policy_id,idempotency_key,
   request,request_digest,plan,plan_digest,budget_micro_usd,discovery_cap_micro_usd,study_cap_micro_usd,prototype_cap_micro_usd,restricted_actions)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13,$14,$15,$16) RETURNING id,ledger_root_id`,
  [org,args.workspace_id,args.actor_user_id,read.prior.id,read.prior.policy_digest,next.id,args.idempotency_key,JSON.stringify(request),read.request_digest,JSON.stringify(read.plan),read.plan_digest,
   request.budget_micro_usd,request.discovery_cap_micro_usd,request.study_cap_micro_usd,request.prototype_cap_micro_usd,read.plan.restricted_actions])).rows[0]!;
  const revoked=await c.query("UPDATE signal_processing_policy_versions SET status='revoked' WHERE id=$1 AND status='active' RETURNING id",[read.prior.id]);
  const activated=await c.query("UPDATE signal_processing_policy_versions SET status='active' WHERE id=$1 AND status='draft' RETURNING id",[next.id]);
  if(revoked.rows.length!==1||activated.rows.length!==1)fail('activation_incomplete');
  return{receipt_id:receipt.id,scope_id:receipt.ledger_root_id,policy_id:next.id,replayed:false};
 });
}

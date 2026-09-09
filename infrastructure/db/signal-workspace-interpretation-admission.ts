import type {PoolClient} from 'pg';
import type {SignalWorkspaceEngineDatabaseV1} from './signal-workspace-engine';

export type SignalWorkspaceInterpretationAdmissionV1={
 contract_version:'workspace-interpretation-admission-v1';operation_id:string;grant_digest:string;
 action:'authorize_interpretation'|'revoke_interpretation';execution_id:string;workspace_id:string;
 authorized_by_user_id:string;budget_actor_user_id:string;prior_admission_operation_id:string|null;
 input_digest:string;fit_checkpoint_digest:string;interpretation_revision_digest:string|null;configuration_digest:string;
 budget_date:string;budget_timezone:string;authorized_at:string;admission_not_after:string;
 grant_cap_micro_usd:number;run_cap_micro_usd:number;daily_cap_micro_usd:number;
};
export type SignalWorkspaceInterpretationAdmissionStatusV1={
 execution_id:string;is_current:boolean;requires_authorization:boolean;can_authorize:boolean;can_revoke:boolean;blocked_reason:string|null;
 current:SignalWorkspaceInterpretationAdmissionV1|null;
 request:{idempotency_key:string;receipt:SignalWorkspaceInterpretationAdmissionV1}|null;
 model:'claude-sonnet-4-6'|null;budget_timezone:string;budget_date:string;maximum_admission_not_after:string;
 confirmed_micro_usd:number;reserved_micro_usd:number;terminal_reserved_micro_usd:number;
 run_cap_micro_usd:number;daily_cap_micro_usd:number;maximum_grant_micro_usd:number;
};
export type SignalWorkspaceInterpretationAdmissionScopeV1={database:SignalWorkspaceEngineDatabaseV1;workspace_id:string;actor_user_id:string;execution_id:string};
export type SignalWorkspaceInterpretationAdmissionAuthorizeArgsV1=SignalWorkspaceInterpretationAdmissionScopeV1&{
 idempotency_key:string;expected_admission_operation_id:string|null;grant_cap_micro_usd:number;admission_not_after:string};
export type SignalWorkspaceInterpretationAdmissionRevokeArgsV1=SignalWorkspaceInterpretationAdmissionScopeV1&{
 idempotency_key:string;expected_admission_operation_id:string};
export type SignalWorkspaceInterpretationAdmissionResultV1={execution_id:string;receipt:SignalWorkspaceInterpretationAdmissionV1;replayed:boolean};

import {randomUUID} from 'node:crypto';
import {SignalWorkspaceEngineInterpretationError} from './signal-workspace-engine-interpretation';
import {signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';
import {SignalWorkspaceEngineError,withSignalWorkspaceEngineTransactionV1,loadSignalWorkspaceEngineInputIdentityV1} from './signal-workspace-engine';
import {loadSignalWorkspaceCapabilitiesStoreV1} from './signal-workspace-capabilities';
const fail=(code:string,status=409):never=>{throw new SignalWorkspaceEngineError(`workspace_engine_interpretation_${code}`,status);};
const keyValid=(key:string)=>/^[A-Za-z0-9._:-]{8,200}$/u.test(key);
const operationKey=(key:string)=>digest({contract:'workspace-interpretation-admission-key-v1',key});
const exposure=`CASE WHEN call_state='settled' THEN settled_micro_usd WHEN call_state='definitely_not_sent' THEN 0 ELSE reserved_micro_usd END`;
const releasable=`call_state='reserved' AND sent_at IS NULL AND response_storage_key IS NULL AND (
 budget_date<>(clock_timestamp() AT TIME ZONE budget_timezone)::date
 OR EXISTS(SELECT 1 FROM signal_classification_operations grant_receipt WHERE grant_receipt.id=(metadata->'interpretation_admission'->>'operation_id')::uuid
  AND (grant_receipt.result->>'admission_not_after')::timestamptz<=clock_timestamp())
 OR EXISTS(SELECT 1 FROM signal_topic_catalog_executions source WHERE source.id=catalog_execution_id AND (
  workspace_interpretation_admission_receipt_v1(source.id)->>'action'='revoke_interpretation'
  OR source.interpretation_admission_operation_id IS NULL AND source.interpretation_revision IS NOT NULL
   AND (source.interpretation_revision->>'admission_not_after')::timestamptz<=clock_timestamp())))`;
type Queryable=Pick<PoolClient,'query'>;
async function admin(c:Queryable,workspace:string,actor:string){if(!(await c.query<{valid:boolean}>('SELECT workspace_interpretation_admission_admin_v1($1::uuid,$2::uuid) valid',[workspace,actor])).rows[0]?.valid)return fail('admission_forbidden',403);}
async function receiptByKey(c:Queryable,workspace:string,actor:string,key?:string){
 if(key===undefined)return null;if(!keyValid(key))return fail('admission_request_invalid',422);
 return(await c.query<{request_digest:string;result:SignalWorkspaceInterpretationAdmissionV1}>(`SELECT request_digest,result FROM signal_classification_operations
 WHERE workspace_id=$1::uuid AND actor_user_id=$2::uuid AND idempotency_key=$3 AND operation_kind IN('authorize-interpretation','revoke-interpretation')`,[workspace,actor,operationKey(key)])).rows[0]??null;
}
async function status(c:Queryable,args:{workspace_id:string;actor_user_id:string;execution_id?:string;idempotency_key?:string}):Promise<SignalWorkspaceInterpretationAdmissionStatusV1|null>{
 const capability=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:c,...args});if(!capability.can_view)return fail('admission_forbidden',403);
 const row=(await c.query<{id:string;actor_user_id:string;input_digest:string;input_snapshot:{context_digest:string;catalog_digest:string;claude_cap_micro_usd:number;interpretation_config?:{budget_timezone:string;daily_cap_micro_usd:number;call_configuration:{model:string}}};
  config:{budget_timezone:string;daily_cap_micro_usd:number;call_configuration:{model:string}};eligible:boolean;requires_authorization:boolean;is_current:boolean;is_admin:boolean;receipt:SignalWorkspaceInterpretationAdmissionV1|null}>(`
 SELECT execution.id,execution.actor_user_id,execution.input_digest,execution.input_snapshot-'guides' input_snapshot,
  COALESCE(execution.interpretation_revision->'configuration',execution.input_snapshot->'interpretation_config') config,
  workspace_interpretation_admission_eligible_v1(execution.id) eligible,workspace_interpretation_admission_required_v1(execution.id) requires_authorization,
  execution.input_revision=state.input_revision AND signal_workspace_incremental_origin_current_v1(execution.id,execution.workspace_id) is_current,
  workspace_interpretation_admission_admin_v1(execution.workspace_id,$2::uuid) is_admin,
  workspace_interpretation_admission_receipt_v1(execution.id) receipt
 FROM signal_topic_catalog_executions execution JOIN signal_corpus_preparation_input_state state USING(workspace_id)
 WHERE execution.workspace_id=$1::uuid AND execution.input_contract='workspace-topic-engine-v1' AND NOT execution.input_snapshot ? 'numeric_descriptor'
  AND ($3::uuid IS NULL OR execution.id=$3::uuid) ORDER BY execution.created_at DESC,execution.id DESC LIMIT 1`,[args.workspace_id,args.actor_user_id,args.execution_id??null])).rows[0];
 if(!row)return null;
 const accepted=await receiptByKey(c,args.workspace_id,args.actor_user_id,args.idempotency_key);
 const timezone=row.config?.budget_timezone??'UTC';
 const clock=(await c.query<{date:string;maximum:string}>(`SELECT (clock_timestamp() AT TIME ZONE $1)::date::text date,
  to_char((((clock_timestamp() AT TIME ZONE $1)::date+1)::timestamp AT TIME ZONE $1) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') maximum`,[timezone])).rows[0]!;
 const money=(await c.query<{confirmed:string;reserved:string;terminal:string;run_spent:string;day_spent:string;releasable_run:string;releasable_day:string}>(`SELECT
  COALESCE(sum(settled_micro_usd) FILTER(WHERE catalog_execution_id=$1::uuid AND call_state='settled'),0)::text confirmed,
  COALESCE(sum(reserved_micro_usd) FILTER(WHERE catalog_execution_id=$1::uuid AND call_state NOT IN('settled','definitely_not_sent')),0)::text reserved,
  COALESCE(sum(reserved_micro_usd) FILTER(WHERE catalog_execution_id=$1::uuid AND call_state='terminal_confirmed'),0)::text terminal,
  COALESCE(sum(${exposure}) FILTER(WHERE catalog_execution_id=$1::uuid),0)::text run_spent,
  COALESCE(sum(${exposure}) FILTER(WHERE budget_date=$3::date),0)::text day_spent,
  COALESCE(sum(reserved_micro_usd) FILTER(WHERE catalog_execution_id=$1::uuid AND ${releasable}),0)::text releasable_run,
  COALESCE(sum(reserved_micro_usd) FILTER(WHERE catalog_execution_id=$1::uuid AND budget_date=$3::date AND ${releasable}),0)::text releasable_day
 FROM engine_cost_events WHERE workspace_contract='workspace-engine-interpretation-v1' AND actor_user_id=$2::uuid`,[row.id,row.actor_user_id,clock.date])).rows[0]!;
 const identity=await loadSignalWorkspaceEngineInputIdentityV1({queryable:c,workspace_id:args.workspace_id,actor_user_id:args.actor_user_id});
 const current=row.is_current&&identity.context_digest===row.input_snapshot.context_digest&&identity.catalog_digest===row.input_snapshot.catalog_digest;
 const runCap=Number(row.input_snapshot.claude_cap_micro_usd??0),dayCap=Number(row.config?.daily_cap_micro_usd??0);
 const max=Math.max(0,Math.min(runCap-Number(money.run_spent)+Number(money.releasable_run),dayCap-Number(money.day_spent)+Number(money.releasable_day)));
 return{execution_id:row.id,is_current:current,requires_authorization:row.requires_authorization,can_authorize:row.is_admin&&current&&row.eligible&&max>0,
  can_revoke:row.is_admin&&row.receipt?.action==='authorize_interpretation',blocked_reason:!row.is_admin?'workspace_engine_interpretation_admission_forbidden':!current?'workspace_engine_inputs_stale':!row.eligible?'workspace_engine_interpretation_admission_unavailable':max<=0?'workspace_engine_interpretation_admission_cap_exceeded':null,
  current:row.receipt,request:accepted?{idempotency_key:args.idempotency_key!,receipt:accepted.result}:null,
  model:row.config?.call_configuration.model==='claude-sonnet-4-6'?'claude-sonnet-4-6':null,budget_timezone:timezone,budget_date:clock.date,maximum_admission_not_after:clock.maximum,
  confirmed_micro_usd:Number(money.confirmed),reserved_micro_usd:Number(money.reserved),terminal_reserved_micro_usd:Number(money.terminal),
  run_cap_micro_usd:runCap,daily_cap_micro_usd:dayCap,maximum_grant_micro_usd:max};
}
export async function loadSignalWorkspaceInterpretationAdmissionV1(args:Omit<SignalWorkspaceInterpretationAdmissionScopeV1,'execution_id'>&{execution_id?:string;idempotency_key?:string}){
 const c=await args.database.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const result=await status(c,args);await c.query('COMMIT');return result;}
 catch(error){await c.query('ROLLBACK').catch(()=>undefined);throw error;}finally{c.release();}
}
async function mutate(args:SignalWorkspaceInterpretationAdmissionAuthorizeArgsV1|SignalWorkspaceInterpretationAdmissionRevokeArgsV1,action:'authorize_interpretation'|'revoke_interpretation'):Promise<SignalWorkspaceInterpretationAdmissionResultV1>{
 const execution_id=args.execution_id.toLowerCase(),expected=args.expected_admission_operation_id?.toLowerCase()??null;
 if(!keyValid(args.idempotency_key))return fail('admission_request_invalid',422);
 const input=action==='authorize_interpretation'?args as SignalWorkspaceInterpretationAdmissionAuthorizeArgsV1:null;
 if(input&&(!Number.isSafeInteger(input.grant_cap_micro_usd)||input.grant_cap_micro_usd<=0
  ||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(input.admission_not_after)
  ||!Number.isFinite(Date.parse(input.admission_not_after))))return fail('admission_request_invalid',422);
 const request=digest({action,execution_id,expected_admission_operation_id:expected,...input?{grant_cap_micro_usd:input.grant_cap_micro_usd,admission_not_after:input.admission_not_after}:{}});
 return withSignalWorkspaceEngineTransactionV1(args.database,async c=>{
  await admin(c,args.workspace_id,args.actor_user_id);
  const prior=await receiptByKey(c,args.workspace_id,args.actor_user_id,args.idempotency_key);
  if(prior){if(prior.request_digest!==request||prior.result.execution_id!==execution_id)return fail('admission_idempotency_conflict');return{execution_id,receipt:prior.result,replayed:true};}
  const scope=(await c.query<{actor_user_id:string}>('SELECT actor_user_id FROM signal_topic_catalog_executions WHERE id=$1::uuid AND workspace_id=$2::uuid',[execution_id,args.workspace_id])).rows[0];if(!scope)return fail('admission_not_found',404);
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workspace-interpretation-budget:${scope.actor_user_id}`]);
  const admitted=await receiptByKey(c,args.workspace_id,args.actor_user_id,args.idempotency_key);
  if(admitted){if(admitted.request_digest!==request||admitted.result.execution_id!==execution_id)return fail('admission_idempotency_conflict');return{execution_id,receipt:admitted.result,replayed:true};}
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`signal-taxonomy:${args.workspace_id}:topic`]);
  await c.query('SELECT workspace_id FROM signal_corpus_preparation_input_state WHERE workspace_id=$1::uuid FOR UPDATE',[args.workspace_id]);
  const run=(await c.query<{input_digest:string;input_snapshot:{claude_cap_micro_usd:number};interpretation_revision:{revision_digest:string}|null;
   config:Record<string,unknown>;fit_digest:string;interpretation_admission_operation_id:string|null;receipt:SignalWorkspaceInterpretationAdmissionV1|null}>(`SELECT input_digest,input_snapshot,interpretation_revision,
   COALESCE(interpretation_revision->'configuration',input_snapshot->'interpretation_config') config,
   result_summary->'fit_checkpoint'->>'checkpoint_digest' fit_digest,interpretation_admission_operation_id,workspace_interpretation_admission_receipt_v1(id) receipt
   FROM signal_topic_catalog_executions WHERE id=$1::uuid AND input_contract='workspace-topic-engine-v1' FOR UPDATE`,[execution_id])).rows[0];
  if(!run)return fail('admission_unavailable');if(run.interpretation_admission_operation_id!==expected)return fail('admission_changed');
  const now=(await c.query<{now:string}>(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') now`)).rows[0]!.now;
  let body:Omit<SignalWorkspaceInterpretationAdmissionV1,'grant_digest'>;
  if(input){
   const view=await status(c,{...args,execution_id});if(!view?.can_authorize)return fail('admission_unavailable');
   if(input.grant_cap_micro_usd>view.maximum_grant_micro_usd||Date.parse(input.admission_not_after)<=Date.parse(now)
    ||Date.parse(input.admission_not_after)>Date.parse(view.maximum_admission_not_after))return fail('admission_cap_or_deadline_invalid');
   // A reserved, never-sent request has no external liability. Only retire it
   // when the previous temporal permission is demonstrably expired/revoked.
   await c.query(`UPDATE engine_cost_events SET call_state='definitely_not_sent',failure_code='workspace_engine_interpretation_admission_changed'
    WHERE catalog_execution_id=$1::uuid AND workspace_contract='workspace-engine-interpretation-v1' AND ${releasable}`,[execution_id]);
   body={contract_version:'workspace-interpretation-admission-v1',operation_id:randomUUID(),action,execution_id,workspace_id:args.workspace_id,
    authorized_by_user_id:args.actor_user_id,budget_actor_user_id:scope.actor_user_id,prior_admission_operation_id:expected,input_digest:run.input_digest,
    fit_checkpoint_digest:run.fit_digest,interpretation_revision_digest:run.interpretation_revision?.revision_digest??null,configuration_digest:digest(run.config.call_configuration),
    budget_date:view.budget_date,budget_timezone:view.budget_timezone,authorized_at:now,admission_not_after:input.admission_not_after,
    grant_cap_micro_usd:input.grant_cap_micro_usd,run_cap_micro_usd:view.run_cap_micro_usd,daily_cap_micro_usd:view.daily_cap_micro_usd};
  }else{
   if(run.receipt?.action!=='authorize_interpretation')return fail('admission_unavailable');
   const {grant_digest:_digest,...previous}=run.receipt;body={...previous,operation_id:randomUUID(),action,authorized_by_user_id:args.actor_user_id,
    prior_admission_operation_id:expected,authorized_at:now,grant_cap_micro_usd:0};
  }
  const receipt={...body,grant_digest:digest(body)};
  await c.query(`INSERT INTO signal_classification_operations(id,workspace_id,actor_user_id,operation_kind,idempotency_key,request_digest,status,result,completed_at)
   VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,'completed',$7::jsonb,clock_timestamp())`,[receipt.operation_id,args.workspace_id,args.actor_user_id,
   action==='authorize_interpretation'?'authorize-interpretation':'revoke-interpretation',operationKey(args.idempotency_key),request,JSON.stringify(receipt)]);
  if(input){
   const updated=(await c.query<{dispatch_generation:number}>(`UPDATE signal_topic_catalog_executions SET interpretation_admission_operation_id=$2::uuid,
    status='queued',error_code=NULL,completed_at=NULL,execution_token=NULL,execution_expires_at=NULL,dispatch_generation=dispatch_generation+1,
    result_summary=result_summary||'{"phase":"queued","interpretation_evidence_checkpoint_required":true}'::jsonb,updated_at=clock_timestamp()
    WHERE id=$1::uuid RETURNING dispatch_generation`,[execution_id,receipt.operation_id])).rows[0]!;
   const dispatch=await c.query(`UPDATE signal_topic_classification_outbox SET status='pending',worker_job_id=$2,attempt_count=0,available_at=clock_timestamp(),
    completed_at=NULL,lease_token=NULL,lease_expires_at=NULL,error_code=NULL,updated_at=clock_timestamp()
    WHERE execution_id=$1::uuid AND dispatch_kind='execution'`,[execution_id,`workspace-engine-${execution_id}-${updated.dispatch_generation}`]);
   if(dispatch.rowCount!==1)return fail('admission_dispatch_unavailable');
  }else await c.query('UPDATE signal_topic_catalog_executions SET interpretation_admission_operation_id=$2::uuid WHERE id=$1::uuid',[execution_id,receipt.operation_id]);
  return{execution_id,receipt,replayed:false};
 });
}
export const authorizeSignalWorkspaceInterpretationAdmissionV1=(args:SignalWorkspaceInterpretationAdmissionAuthorizeArgsV1)=>mutate(args,'authorize_interpretation');
export const revokeSignalWorkspaceInterpretationAdmissionV1=(args:SignalWorkspaceInterpretationAdmissionRevokeArgsV1)=>mutate(args,'revoke_interpretation');

/** Only deterministic DB observations are typed denials. Call before mutation;
 * exceptions and uncertain transaction completion remain transport uncertainty. */
export async function assertSignalWorkspaceInterpretationAdmissionWithClientV1(c:PoolClient,args:{execution_id:string;admission_operation_id?:string}){
 const deny=(code:string):never=>{throw new SignalWorkspaceEngineInterpretationError(`workspace_engine_interpretation_${code}`,409);};
 const row=(await c.query<{id:string|null;receipt:SignalWorkspaceInterpretationAdmissionV1|null;expired:boolean;admin_valid:boolean;source_valid:boolean;input_contract:string}>(`SELECT input_contract,interpretation_admission_operation_id id,
  workspace_interpretation_admission_receipt_v1(id) receipt,
  clock_timestamp()>=(workspace_interpretation_admission_receipt_v1(id)->>'admission_not_after')::timestamptz expired,
  signal_workspace_incremental_parent_current_v1(id,workspace_id,actor_user_id) source_valid,
  workspace_interpretation_admission_admin_v1(workspace_id,(workspace_interpretation_admission_receipt_v1(id)->>'authorized_by_user_id')::uuid) admin_valid
  FROM signal_topic_catalog_executions WHERE id=$1::uuid`,[args.execution_id])).rows[0];
 if(!row)return deny('admission_changed');
 if(row.input_contract==='workspace-incremental-editorial-v1')row.source_valid=(await c.query<{valid:boolean}>('SELECT workspace_incremental_editorial_execution_current_v1($1::uuid) valid',[args.execution_id])).rows[0]?.valid===true;
 if(!row.id){if(args.admission_operation_id)return deny('admission_changed');return null;}
 if(row.receipt?.action==='revoke_interpretation')return deny('admission_revoked');
 if(row.id!==args.admission_operation_id||!row.admin_valid||!row.source_valid)return deny('admission_changed');
 if(row.expired===true)return deny('daily_authority_expired');
 if(row.expired!==false||!row.receipt)return deny('admission_changed');
 return row.receipt;
}

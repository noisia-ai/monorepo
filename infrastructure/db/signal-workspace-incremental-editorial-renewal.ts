import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';
import {SignalWorkspaceEngineError,loadSignalWorkspaceEngineInputIdentityV1,isSignalWorkspaceEngineSemanticAuthorityUnavailableV1,
 type SignalWorkspaceEngineDatabaseV1} from './signal-workspace-engine';
import {loadSignalWorkspaceCapabilitiesStoreV1} from './signal-workspace-capabilities';
import {readSignalWorkspaceIncrementalEditorialRequestWithQueryableV1,
 type SignalWorkspaceIncrementalEditorialReceiptV1,type SignalWorkspaceIncrementalEditorialResultV1} from './signal-workspace-incremental-editorial';

type Scope={workspace_id:string;actor_user_id:string;execution_id:string};
type Queryable=Pick<PoolClient,'query'>;
export type SignalWorkspaceIncrementalEditorialRenewArgsV1=Scope&{
 database:SignalWorkspaceEngineDatabaseV1;expected_admission_operation_id:string;idempotency_key:string;
 grant_cap_micro_usd:number;admission_not_after:string;
};
export type SignalWorkspaceIncrementalEditorialRenewalV1={
 execution_id:string;is_current:boolean;can_renew:boolean;blocked_reason:string|null;
 expected_admission_operation_id:string;budget_actor_user_id:string;budget_timezone:string;budget_date:string;
 maximum_admission_not_after:string;run_cap_micro_usd:number;daily_cap_micro_usd:number;
 confirmed_micro_usd:number;reserved_micro_usd:number;terminal_reserved_micro_usd:number;maximum_grant_micro_usd:number;
};
type State=SignalWorkspaceIncrementalEditorialRenewalV1&{
 eligible:boolean;now:string;receipt:SignalWorkspaceIncrementalEditorialReceiptV1;
 context_digest:string;catalog_digest:string;worker_job_id:string|null;
};
const fail=(suffix:string,status=409):never=>{throw new SignalWorkspaceEngineError(`workspace_incremental_editorial_${suffix}`,status);};
const uuid=(value:string)=>{if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value))return fail('request_invalid',422);return value.toLowerCase();};
const date=(value:string)=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const key=(value:string)=>{if(!/^[A-Za-z0-9._:-]{8,200}$/u.test(value))return fail('request_invalid',422);return digest({contract:'workspace-incremental-editorial-key-v1',key:value});};
async function state(c:Queryable,args:Scope):Promise<State|null>{
 return(await c.query<{state:State|null}>(`SELECT workspace_incremental_editorial_renewal_state_v1(id) state
  FROM signal_topic_catalog_executions WHERE id=$1::uuid AND workspace_id=$2::uuid AND input_contract='workspace-incremental-editorial-v1'`,
 [uuid(args.execution_id),args.workspace_id])).rows[0]?.state??null;
}
/** Current read authority and historical source availability are separate. */
export async function readSignalWorkspaceIncrementalEditorialRenewalWithQueryableV1(c:Queryable,args:Scope):Promise<SignalWorkspaceIncrementalEditorialRenewalV1|null>{
 if(!(await loadSignalWorkspaceCapabilitiesStoreV1({queryable:c,...args})).can_view)return fail('forbidden',403);
 const row=await state(c,args);if(!row)return null;
 let current=row.is_current;
 if(current){try{const identity=await loadSignalWorkspaceEngineInputIdentityV1({queryable:c,workspace_id:args.workspace_id,actor_user_id:row.budget_actor_user_id,execution_id:args.execution_id});
  current=identity.context_digest===row.context_digest&&identity.catalog_digest===row.catalog_digest;
 }catch(error){if(!(error instanceof Error)||!(isSignalWorkspaceEngineSemanticAuthorityUnavailableV1(error)||error instanceof SignalWorkspaceEngineError&&[403,404,409].includes(error.status)
  ||['workspace_topic_catalog_required','workspace_topic_catalog_empty'].includes(error.message)))throw error;current=false;}}
 const admin=(await c.query<{valid:boolean}>('SELECT workspace_interpretation_admission_admin_v1($1::uuid,$2::uuid) valid',[args.workspace_id,args.actor_user_id])).rows[0]?.valid===true;
 const blocked_reason=!admin?'workspace_incremental_editorial_forbidden':!current?'workspace_incremental_editorial_source_stale':row.blocked_reason;
 return{execution_id:row.execution_id,is_current:current,can_renew:admin&&current&&row.eligible,blocked_reason,
  expected_admission_operation_id:row.expected_admission_operation_id,budget_actor_user_id:row.budget_actor_user_id,
  budget_timezone:row.budget_timezone,budget_date:row.budget_date,maximum_admission_not_after:row.maximum_admission_not_after,
  run_cap_micro_usd:row.run_cap_micro_usd,daily_cap_micro_usd:row.daily_cap_micro_usd,
  confirmed_micro_usd:row.confirmed_micro_usd,reserved_micro_usd:row.reserved_micro_usd,
  terminal_reserved_micro_usd:row.terminal_reserved_micro_usd,maximum_grant_micro_usd:row.maximum_grant_micro_usd};
}
/** Caller owns the transaction and provider kill switch. A replay has no effects. */
export async function renewSignalWorkspaceIncrementalEditorialWithClientV1(c:PoolClient,input:SignalWorkspaceIncrementalEditorialRenewArgsV1):Promise<SignalWorkspaceIncrementalEditorialResultV1>{
 const args={...input,execution_id:uuid(input.execution_id),expected_admission_operation_id:uuid(input.expected_admission_operation_id)};
 const operationKey=key(args.idempotency_key);
 if(!Number.isSafeInteger(args.grant_cap_micro_usd)||args.grant_cap_micro_usd<=0||!date(args.admission_not_after))return fail('request_invalid',422);
 const request_digest=digest({action:'renew_incremental_editorial',execution_id:args.execution_id,expected_admission_operation_id:args.expected_admission_operation_id,
  grant_cap_micro_usd:args.grant_cap_micro_usd,admission_not_after:args.admission_not_after});
 if(!(await c.query<{valid:boolean}>('SELECT workspace_interpretation_admission_admin_v1($1::uuid,$2::uuid) valid',[args.workspace_id,args.actor_user_id])).rows[0]?.valid)return fail('forbidden',403);
 const replay=async()=>{const prior=await readSignalWorkspaceIncrementalEditorialRequestWithQueryableV1(c,args,args.idempotency_key);if(!prior)return null;
  if(prior.request_digest!==request_digest||prior.result.execution_id!==args.execution_id)return fail('idempotency_conflict');
  return{execution_id:args.execution_id,receipt:prior.result,replayed:true};};
 const accepted=await replay();if(accepted)return accepted;
 const owner=(await c.query<{actor_user_id:string}>(`SELECT actor_user_id FROM signal_topic_catalog_executions WHERE id=$1::uuid AND workspace_id=$2::uuid AND input_contract='workspace-incremental-editorial-v1'`,[args.execution_id,args.workspace_id])).rows[0];
 if(!owner)return fail('not_found',404);
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workspace-interpretation-budget:${owner.actor_user_id}`]);
 const raced=await replay();if(raced)return raced;
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`signal-taxonomy:${args.workspace_id}:topic`]);
 await c.query('SELECT workspace_id FROM signal_corpus_preparation_input_state WHERE workspace_id=$1::uuid FOR UPDATE',[args.workspace_id]);
 await c.query('SELECT id FROM signal_topic_catalog_executions WHERE id=$1::uuid FOR UPDATE',[args.execution_id]);
 const row=await state(c,args);if(!row)return fail('not_found',404);
 if(row.expected_admission_operation_id!==args.expected_admission_operation_id)return fail('admission_changed');
 const preview=await readSignalWorkspaceIncrementalEditorialRenewalWithQueryableV1(c,args);
 if(!preview?.can_renew)return fail('renewal_unavailable');
 if(args.grant_cap_micro_usd>preview.maximum_grant_micro_usd||Date.parse(args.admission_not_after)<=Date.parse(row.now)
  ||Date.parse(args.admission_not_after)>Date.parse(preview.maximum_admission_not_after))return fail('cap_or_deadline_invalid');
 // Only a reservation proven never sent can be retired. Its amount and own grant remain immutable.
 await c.query(`UPDATE engine_cost_events SET call_state='definitely_not_sent',failure_code='workspace_engine_interpretation_admission_changed'
  WHERE catalog_execution_id=$1::uuid AND workspace_contract='workspace-engine-interpretation-v1'
   AND workspace_incremental_editorial_renewal_releasable_v1(engine_cost_events)`,[args.execution_id]);
 const {grant_digest:_digest,...previous}=row.receipt;
 const unsigned={...previous,operation_id:randomUUID(),action:'authorize_interpretation' as const,authorized_by_user_id:args.actor_user_id,
  prior_admission_operation_id:args.expected_admission_operation_id,authorized_at:row.now,budget_date:preview.budget_date,
  admission_not_after:args.admission_not_after,grant_cap_micro_usd:args.grant_cap_micro_usd};
 const receipt={...unsigned,grant_digest:digest(unsigned)};
 await c.query(`INSERT INTO signal_classification_operations(id,workspace_id,actor_user_id,operation_kind,idempotency_key,request_digest,status,result,completed_at)
  VALUES($1::uuid,$2::uuid,$3::uuid,'authorize-interpretation',$4,$5,'completed',$6::jsonb,clock_timestamp())`,
 [receipt.operation_id,args.workspace_id,args.actor_user_id,operationKey,request_digest,JSON.stringify(receipt)]);
 const changed=await c.query(`UPDATE signal_topic_catalog_executions SET interpretation_admission_operation_id=$2::uuid,status='queued',error_code=NULL,completed_at=NULL,
  execution_token=NULL,execution_expires_at=NULL WHERE id=$1::uuid`,[args.execution_id,receipt.operation_id]);
 if(changed.rowCount!==1)return fail('renewal_unavailable');
 const dispatch=await c.query(`UPDATE signal_topic_classification_outbox SET status='pending',attempt_count=0,available_at=clock_timestamp(),completed_at=NULL,
  lease_token=NULL,lease_expires_at=NULL,error_code=NULL WHERE execution_id=$1::uuid AND workspace_id=$2::uuid AND dispatch_kind='execution' AND worker_job_id=$3`,
 [args.execution_id,args.workspace_id,row.worker_job_id]);
 if(dispatch.rowCount!==1)return fail('dispatch_unavailable');
 await c.query('SET CONSTRAINTS trg_workspace_incremental_editorial_complete IMMEDIATE');await c.query('SET CONSTRAINTS trg_workspace_incremental_editorial_complete DEFERRED');
 return{execution_id:args.execution_id,receipt,replayed:false};
}

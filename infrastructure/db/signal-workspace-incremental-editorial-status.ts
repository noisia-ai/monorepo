import type {PoolClient} from 'pg';
import {signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';
import {SignalWorkspaceEngineError,withSignalWorkspaceEngineTransactionV1,loadSignalWorkspaceEngineInputIdentityV1,
 type SignalWorkspaceEngineDatabaseV1} from './signal-workspace-engine';
import {loadSignalWorkspaceCapabilitiesStoreV1} from './signal-workspace-capabilities';
import type {SignalWorkspaceIncrementalEditorialReceiptV1} from './signal-workspace-incremental-editorial';
import {readSignalWorkspaceIncrementalEditorialRetryWithQueryableV1,requeueSignalWorkspaceIncrementalEditorialWithClientV1} from './signal-workspace-incremental-editorial-execution';
import {readSignalWorkspaceIncrementalEditorialRenewalWithQueryableV1,
 type SignalWorkspaceIncrementalEditorialRenewalV1} from './signal-workspace-incremental-editorial-renewal';

type Scope={database:SignalWorkspaceEngineDatabaseV1;workspace_id:string;actor_user_id:string;execution_id:string};
type Queryable=Pick<PoolClient,'query'>;
type Dispatch={worker_job_id:string;status:string};
export type SignalWorkspaceIncrementalEditorialRetryReceiptV1={
 contract_version:'workspace-incremental-editorial-retry-v1';workspace_id:string;execution_id:string;actor_user_id:string;
 worker_job_id:string;request_digest:string;accepted_at:string;retry_count:number;
};
export type SignalWorkspaceIncrementalEditorialStatusV1={
 execution_id:string;status:string;error_code:string|null;is_current:boolean;has_pending_work:boolean;has_unresolved_call:boolean;
 expected_units:number;interpreted_units:number;dispatch:Dispatch|null;can_retry:boolean;requires_authorization:boolean;recorded_recovery_available:boolean;
 costs:{confirmed_micro_usd:number;reserved_micro_usd:number;terminal_reserved_micro_usd:number};
 request:{idempotency_key:string;receipt:SignalWorkspaceIncrementalEditorialRetryReceiptV1}|null;
 renewal?:SignalWorkspaceIncrementalEditorialRenewalV1|null;
};
type Run={id:string;actor_user_id:string;status:string;error_code:string|null;current:boolean;expected_units:number;
 context_digest:string;catalog_digest:string;receipt:SignalWorkspaceIncrementalEditorialReceiptV1;
 request:SignalWorkspaceIncrementalEditorialRetryReceiptV1|null;now:string};
const fail=(suffix:string,status=409):never=>{throw new SignalWorkspaceEngineError(`workspace_incremental_editorial_${suffix}`,status);};
function validId(value:string){if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value))return fail('request_invalid',422);return value.toLowerCase();}
function key(value:string){if(!/^[A-Za-z0-9._:-]{8,200}$/u.test(value))return fail('request_invalid',422);return digest({contract:'workspace-incremental-editorial-retry-key-v1',key:value});}
async function admin(c:Queryable,args:Scope){if(!(await c.query<{valid:boolean}>(
 'SELECT workspace_interpretation_admission_admin_v1($1::uuid,$2::uuid) valid',[args.workspace_id,args.actor_user_id],
 )).rows[0]?.valid)return fail('forbidden',403);}
async function readRun(c:Queryable,args:Scope,idempotency_key?:string):Promise<Run|null>{
 return(await c.query<Run>(`SELECT id,actor_user_id,status,error_code,workspace_incremental_editorial_execution_current_v1(id) current,
  (input_snapshot->>'target_units')::int expected_units,input_snapshot->>'context_digest' context_digest,input_snapshot->>'catalog_input_digest' catalog_digest,
  workspace_interpretation_admission_receipt_v1(id) receipt,result_summary->'editorial_retry_requests'->$3 request,
  to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') now
  FROM signal_topic_catalog_executions WHERE id=$1::uuid AND workspace_id=$2::uuid AND input_contract='workspace-incremental-editorial-v1'`,
 [validId(args.execution_id),args.workspace_id,idempotency_key?key(idempotency_key):null])).rows[0]??null;
}
async function status(c:Queryable,args:Scope,idempotency_key?:string):Promise<SignalWorkspaceIncrementalEditorialStatusV1|null>{
 const capabilities=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:c,...args});
 if(!capabilities.can_view)return fail('forbidden',403);
 const run=await readRun(c,args,idempotency_key);if(!run)return null;
 const ownerCapabilities=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:c,workspace_id:args.workspace_id,actor_user_id:run.actor_user_id});
 let identity:{context_digest:string;catalog_digest:string}|null=null;
 if(run.current&&ownerCapabilities.can_execute_topics){try{identity=await loadSignalWorkspaceEngineInputIdentityV1({queryable:c,workspace_id:args.workspace_id,actor_user_id:run.actor_user_id});}
  catch(error){if(!(error instanceof Error)||!['workspace_topic_catalog_required','workspace_topic_catalog_empty'].includes(error.message))throw error;}}
 const is_current=run.current&&ownerCapabilities.can_execute_topics&&identity?.context_digest===run.context_digest&&identity?.catalog_digest===run.catalog_digest;
 const dispatch=(await c.query<Dispatch>(`SELECT worker_job_id,status FROM signal_topic_classification_outbox
  WHERE execution_id=$1::uuid AND workspace_id=$2::uuid AND dispatch_kind='execution'`,[run.id,args.workspace_id])).rows[0]??null;
 const counts=(await c.query<{interpreted:number;confirmed:string;reserved:string;terminal:string;checkpoint_complete:boolean}>(`SELECT
  workspace_incremental_editorial_output_complete_v1($1::uuid) checkpoint_complete,
  (SELECT count(DISTINCT unit.key)::int FROM analysis_artifacts artifact CROSS JOIN LATERAL jsonb_array_elements_text(artifact.metadata->'unit_keys') unit(key)
   WHERE artifact.engine_execution_id=$1::uuid AND artifact.metadata->>'contract_version'='workspace-incremental-editorial-checkpoint-v1') interpreted,
  COALESCE(sum(settled_micro_usd) FILTER(WHERE call_state='settled'),0)::text confirmed,
  COALESCE(sum(reserved_micro_usd) FILTER(WHERE call_state NOT IN('settled','definitely_not_sent')),0)::text reserved,
  COALESCE(sum(reserved_micro_usd) FILTER(WHERE call_state='terminal_confirmed'),0)::text terminal
  FROM engine_cost_events WHERE catalog_execution_id=$1::uuid`,[run.id])).rows[0]!;
 const recovery=await readSignalWorkspaceIncrementalEditorialRetryWithQueryableV1(c,run.id);
 const isAdmin=capabilities.can_execute_topics&&(await c.query<{valid:boolean}>(
  'SELECT workspace_interpretation_admission_admin_v1($1::uuid,$2::uuid) valid',[args.workspace_id,args.actor_user_id],
 )).rows[0]?.valid===true;
 const requires_authorization=!run.receipt||run.receipt.action!=='authorize_interpretation'||Date.parse(run.receipt.admission_not_after)<=Date.parse(run.now);
 const recorded_recovery_available=counts.checkpoint_complete||run.error_code==='workspace_engine_interpretation_receipt_recovery_required'&&recovery.persisted_response;
 const can_retry=isAdmin&&is_current&&run.status==='failed'&&Boolean(dispatch)&&recovery.can_retry
  &&(!requires_authorization||recorded_recovery_available);
 return{execution_id:run.id,status:run.status,error_code:run.error_code,is_current,
  has_pending_work:['queued','running'].includes(run.status)&&Boolean(dispatch&&['pending','dispatching','dispatched'].includes(dispatch.status)),
  has_unresolved_call:recovery.unknown,expected_units:run.expected_units,interpreted_units:counts.interpreted,dispatch,can_retry,requires_authorization,recorded_recovery_available,
  costs:{confirmed_micro_usd:Number(counts.confirmed),reserved_micro_usd:Number(counts.reserved),terminal_reserved_micro_usd:Number(counts.terminal)},
  request:idempotency_key&&run.request?.actor_user_id===args.actor_user_id?{idempotency_key,receipt:run.request}:null,
  renewal:await readSignalWorkspaceIncrementalEditorialRenewalWithQueryableV1(c,args)};
}
/** Current authority is checked, while expired/revoked grant receipts and costs remain readable. */
export async function loadSignalWorkspaceIncrementalEditorialStatusV1(args:Omit<Scope,'execution_id'>&{execution_id?:string;idempotency_key?:string}){
 const c=await args.database.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  if(!(await loadSignalWorkspaceCapabilitiesStoreV1({queryable:c,...args})).can_view)return fail('forbidden',403);
  const accepted=args.idempotency_key?(await c.query<{id:string}>(`SELECT id FROM signal_topic_catalog_executions
   WHERE workspace_id=$1::uuid AND input_contract='workspace-incremental-editorial-v1'
    AND result_summary->'editorial_retry_requests'->$2->>'actor_user_id'=$3::text
   ORDER BY created_at DESC,id DESC LIMIT 1`,[args.workspace_id,key(args.idempotency_key),args.actor_user_id])).rows[0]:null;
  const execution_id=accepted?.id??args.execution_id;
  const result=execution_id?await status(c,{...args,execution_id},args.idempotency_key):null;await c.query('COMMIT');return result;
 }catch(error){await c.query('ROLLBACK').catch(()=>undefined);throw error;}finally{c.release();}
}
/** One accepted UI retry is durable even when its ACK is lost and its job fails again. */
export async function retrySignalWorkspaceIncrementalEditorialV1(args:Scope&{expected_worker_job_id:string;idempotency_key:string;provider_available:boolean}){
 const requestKey=key(args.idempotency_key),execution_id=validId(args.execution_id);
 if(typeof args.expected_worker_job_id!=='string'||args.expected_worker_job_id.length>160)return fail('request_invalid',422);
 const request_digest=digest({action:'retry_incremental_editorial',execution_id,worker_job_id:args.expected_worker_job_id});
 return withSignalWorkspaceEngineTransactionV1(args.database,async c=>{
  await admin(c,args);
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workspace-editorial-retry:${args.workspace_id}:${args.actor_user_id}:${requestKey}`]);
  const prior=(await c.query<{id:string}>(`SELECT id FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid
   AND input_contract='workspace-incremental-editorial-v1' AND result_summary->'editorial_retry_requests'->$2->>'actor_user_id'=$3::text`,
  [args.workspace_id,requestKey,args.actor_user_id])).rows[0];
  if(prior&&prior.id!==execution_id)return fail('idempotency_conflict');
  const owner=(await c.query<{actor_user_id:string}>(`SELECT actor_user_id FROM signal_topic_catalog_executions
   WHERE id=$1::uuid AND workspace_id=$2::uuid AND input_contract='workspace-incremental-editorial-v1'`,[execution_id,args.workspace_id])).rows[0];
  if(!owner)return fail('not_found',404);
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workspace-interpretation-budget:${owner.actor_user_id}`]);
  await c.query('SELECT id FROM signal_topic_catalog_executions WHERE id=$1::uuid FOR UPDATE',[execution_id]);
  const run=await readRun(c,args,args.idempotency_key);if(!run)return fail('not_found',404);
  if(run.request){if(run.request.actor_user_id!==args.actor_user_id||run.request.request_digest!==request_digest)return fail('idempotency_conflict');
   return{execution_id,receipt:run.request,replayed:true};}
  const current=await status(c,args);
  if(!current?.can_retry||current.dispatch?.worker_job_id!==args.expected_worker_job_id)return fail('retry_unavailable');
  if(!args.provider_available&&!current.recorded_recovery_available)return fail('provider_unavailable');
  await requeueSignalWorkspaceIncrementalEditorialWithClientV1(c,{...args,execution_id,actor_user_id:owner.actor_user_id,worker_job_id:args.expected_worker_job_id});
  const count=(await c.query<{retry_count:number}>('SELECT (result_summary->>\'delivery_retry_count\')::int retry_count FROM signal_topic_catalog_executions WHERE id=$1::uuid',[execution_id])).rows[0]!;
  const receipt:SignalWorkspaceIncrementalEditorialRetryReceiptV1={contract_version:'workspace-incremental-editorial-retry-v1',workspace_id:args.workspace_id,execution_id,
   actor_user_id:args.actor_user_id,worker_job_id:args.expected_worker_job_id,request_digest,accepted_at:run.now,retry_count:count.retry_count};
  await c.query(`UPDATE signal_topic_catalog_executions SET result_summary=jsonb_set(result_summary,'{editorial_retry_requests}',
   COALESCE(result_summary->'editorial_retry_requests','{}'::jsonb)||jsonb_build_object($2::text,$3::jsonb)) WHERE id=$1::uuid`,
  [execution_id,requestKey,JSON.stringify(receipt)]);
  return{execution_id,receipt,replayed:false};
 });
}

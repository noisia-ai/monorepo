import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {
  validateSignalTopicEditorialScreeningPlanV2, classifySignalTopicEditorialMessageResultV2,
  type SignalTopicEditorialScreeningPlanV2,type SignalTopicEditorialGroupRequestV2,
  type SignalTopicEditorialMessageResultV2,
} from '../../packages/query-engine/src/signal-topic-consolidation-editorial-v2';
import type {SignalTopicEditorialPaidReuseResultV2} from '../../packages/query-engine/src/signal-topic-editorial-paid-reuse-v2';
import type {SignalTopicEditorialDatabaseV1} from './signal-topic-consolidation-editorial';

export type SignalTopicEditorialBatchDatabaseV2=SignalTopicEditorialDatabaseV1;
export type SignalTopicEditorialBatchStateV2='prepared'|'submitting'|'submission_unknown'|'in_progress'|'canceling'|'ended'|'applied'|'rejected';
export type SignalTopicEditorialBatchLeaseV2={
  batch_id:string;execution_id:string;lease_token:string;submission_token:string;
  state:SignalTopicEditorialBatchStateV2;provider_batch_id:string|null;
  manifest_body:string;manifest_digest:string;
  items:Array<{custom_id:string;call_id:string;attempt_token:string;request:SignalTopicEditorialGroupRequestV2;
    outcome:'succeeded'|'errored'|'canceled'|'expired'|'submission_rejected'|null;validation:SignalTopicEditorialMessageResultV2|null;raw_sha256:string|null}>;
};
type Db={database:SignalTopicEditorialBatchDatabaseV2};
const sha=(body:string)=>`sha256:${createHash('sha256').update(body).digest('hex')}`;
/** Mirrors the existing QE canonical byte representation, including finite
 * floats, without modifying PostgreSQL's historical integer-only canonicalizer. */
export function signalTopicEditorialCanonicalBodyV2(value:unknown):string {
  const ordered=(v:unknown):string=>Array.isArray(v)?`[${v.map(ordered).join(',')}]`:v&&typeof v==='object'
    ?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${ordered((v as Record<string,unknown>)[k])}`).join(',')}}`:JSON.stringify(v);
  const body=ordered(value);
  if(body===undefined)throw new Error('topic_editorial_v2_json_invalid');
  return body;
}
async function tx<T>(database:SignalTopicEditorialBatchDatabaseV2,work:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await database.connect();
  try{await client.query('BEGIN');await client.query('SET LOCAL search_path=public,extensions,pg_temp');
    const result=await work(client);await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
}
async function invoke<T>(database:SignalTopicEditorialBatchDatabaseV2,sql:string,values:unknown[]):Promise<T>{
  return tx(database,async client=>{const result=await client.query<{value:T}>(sql,values);
    if(result.rows.length!==1)throw new Error('topic_editorial_v2_store_result_invalid');return result.rows[0]!.value;});
}
export async function admitSignalTopicEditorialBatchV2(args:Db&{workspace_id:string;actor_user_id:string;
  plan:SignalTopicEditorialScreeningPlanV2;idempotency_key:string;policy_version_id:string;
  execution_cap_micro_usd:string;send_not_after:string;previous_execution_id?:string|null}){
  validateSignalTopicEditorialScreeningPlanV2(args.plan);
  if(args.plan.identity.workspace_id!==args.workspace_id)throw new Error('topic_editorial_v2_scope_invalid');
  const {plan_digest,...unsigned}=args.plan;
  const planBody=signalTopicEditorialCanonicalBodyV2(unsigned);
  if(sha(planBody)!==plan_digest)throw new Error('topic_editorial_v2_plan_digest_invalid');
  const bodies=args.plan.requests.map(request=>{const {request_digest,provider_request,...core}=request;
    const coreBody=signalTopicEditorialCanonicalBodyV2({...core,params:provider_request.params});
    if(sha(coreBody)!==request_digest)throw new Error('topic_editorial_v2_request_digest_invalid');
    return {params_body:JSON.stringify(provider_request.params),core_body:coreBody};});
  return invoke<{execution_id:string;expected_items:number;stage:'screening';replayed:boolean}>(args.database,
    'SELECT admit_signal_topic_editorial_batch_v2($1,$2,$3::jsonb,$4,$5::jsonb,$6,$7,$8::bigint,$9::timestamptz,$10) value',
    [args.workspace_id,args.actor_user_id,JSON.stringify(args.plan),planBody,JSON.stringify(bodies),args.idempotency_key,
      args.policy_version_id,args.execution_cap_micro_usd,args.send_not_after,args.previous_execution_id??null]);
}
export function prepareSignalTopicEditorialBatchV2(args:Db&{execution_id:string;request_digests:string[];submission_key:string}){
  return invoke<{batch_id:string;manifest_digest:string;replayed:boolean}>(args.database,
    'SELECT prepare_signal_topic_editorial_batch_v2($1,$2::text[],$3) value',[args.execution_id,args.request_digests,args.submission_key]);
}
export function claimDueSignalTopicEditorialBatchV2(args:Db&{batch_id?:string;lease_seconds?:number}){
  return invoke<SignalTopicEditorialBatchLeaseV2|null>(args.database,
    'SELECT claim_signal_topic_editorial_batch_v2($1,$2::integer) value',[args.batch_id??null,args.lease_seconds??120]);
}
export function markSubmittingSignalTopicEditorialBatchV2(args:Db&{lease:SignalTopicEditorialBatchLeaseV2}){
  return invoke<{submission_token:string;manifest_body:string;manifest_digest:string}>(args.database,
    'SELECT mark_submitting_signal_topic_editorial_batch_v2($1,$2) value',[args.lease.batch_id,args.lease.lease_token]);
}
export function attachProviderSignalTopicEditorialBatchV2(args:Db&{lease:SignalTopicEditorialBatchLeaseV2;receipt_body:string}){
  return invoke<{provider_batch_id:string;replayed:boolean}>(args.database,
    'SELECT attach_provider_signal_topic_editorial_batch_v2($1,$2,$3,$4) value',
    [args.lease.batch_id,args.lease.submission_token,args.receipt_body,sha(args.receipt_body)]);
}
export function recordSignalTopicEditorialBatchPollV2(args:Db&{lease:SignalTopicEditorialBatchLeaseV2;
  receipt_body:string;next_poll_at:string}){
  return invoke<{state:SignalTopicEditorialBatchStateV2}>(args.database,
    'SELECT poll_signal_topic_editorial_batch_v2($1,$2,$3,$4::timestamptz) value',
    [args.lease.batch_id,args.lease.lease_token,args.receipt_body,args.next_poll_at]);
}
export function releaseSignalTopicEditorialBatchLeaseV2(args:Db&{lease:SignalTopicEditorialBatchLeaseV2;next_poll_at:string|null;submission_unknown?:boolean;error_code?:string|null}){
  return invoke<boolean>(args.database,'SELECT release_signal_topic_editorial_batch_v2($1,$2,$3::timestamptz,$4,$5) value',
    [args.lease.batch_id,args.lease.lease_token,args.next_poll_at,args.submission_unknown??false,args.error_code??null]);
}
export function persistSignalTopicEditorialBatchItemV2(args:Db&{lease:SignalTopicEditorialBatchLeaseV2;custom_id:string;
  raw_body:string;storage_key:string}){
  return invoke<{outcome:'succeeded'|'errored'|'canceled'|'expired';settled_micro_usd:string|null;usage_pending:boolean;replayed:boolean}>(args.database,
    'SELECT persist_signal_topic_editorial_batch_item_v2($1,$2,$3,$4,$5,$6) value',
    [args.lease.batch_id,args.lease.lease_token,args.custom_id,args.raw_body,sha(args.raw_body),args.storage_key]);
}
export function rejectSignalTopicEditorialBatchSubmissionV2(args:Db&{lease:SignalTopicEditorialBatchLeaseV2;
  http_status:number;raw_body:string;complete:boolean;storage_key:string}){
  return invoke<{state:'rejected';replayed:boolean}>(args.database,
    'SELECT reject_signal_topic_editorial_batch_submission_v2($1,$2,$3,$4,$5,$6,$7) value',
    [args.lease.batch_id,args.lease.submission_token,args.http_status,args.raw_body,sha(args.raw_body),args.complete,args.storage_key]);
}
export function recordSignalTopicEditorialBatchItemValidationV2(args:Db&{lease:SignalTopicEditorialBatchLeaseV2;
  custom_id:string;validation:SignalTopicEditorialMessageResultV2}){
  return invoke<{replayed:boolean}>(args.database,'SELECT validate_signal_topic_editorial_batch_item_v2($1,$2,$3,$4,$5) value',
    [args.lease.batch_id,args.lease.lease_token,args.custom_id,JSON.stringify(args.validation),sha(JSON.stringify(args.validation))]);
}
export function finishSignalTopicEditorialBatchImportV2(args:Db&{lease:SignalTopicEditorialBatchLeaseV2}){
  return invoke<{state:'applied';accepted:number;failed:number;stage:'screening'|'screening_ready'|'review_pending'}>(args.database,
    'SELECT finish_signal_topic_editorial_batch_import_v2($1,$2) value',[args.lease.batch_id,args.lease.lease_token]);
}
/** Pure helper for callers importing a raw result. Errors remain per-item. */
export function classifySignalTopicEditorialBatchItemV2(request:SignalTopicEditorialGroupRequestV2,raw:unknown):SignalTopicEditorialMessageResultV2{
  const item=raw as {custom_id?:unknown;result?:{type?:unknown;message?:unknown}};
  if(!item||item.custom_id!==request.provider_request.custom_id)throw new Error('topic_editorial_v2_custom_id_invalid');
  if(item.result?.type!=='succeeded')return {status:'invalid_message',code:`topic_editorial_v2_provider_${['errored','canceled','expired'].includes(String(item.result?.type))?item.result!.type:'invalid'}`};
  return classifySignalTopicEditorialMessageResultV2(request,item.result.message);
}

/** The database independently binds the copied decision to the existing paid call
 * and exact historical checkpoint. No V2 provider call or monetary row is added. */
export function recordReusedSignalTopicEditorialDecisionV2(args:Db&{execution_id:string;request_digest:string;
  reuse:Extract<SignalTopicEditorialPaidReuseResultV2,{status:'reusable'}>}){
  const body=JSON.stringify(args.reuse);
  return invoke<{replayed:boolean}>(args.database,'SELECT reuse_signal_topic_editorial_paid_decision_v2($1,$2,$3,$4) value',
    [args.execution_id,args.request_digest,body,sha(body)]);
}

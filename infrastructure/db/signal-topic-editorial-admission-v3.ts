import type {PoolClient} from 'pg';
import {
  buildSignalTopicEditorialAdmissionHeaderV3,signalTopicEditorialAdmissionChunksV3,
  type SignalTopicEditorialScreeningPlanV2,
} from '../../packages/query-engine/src/index';
import {signalTopicEditorialCanonicalBodyV2,type SignalTopicEditorialBatchDatabaseV2} from './signal-topic-editorial-batch-v2';

type Args={database:SignalTopicEditorialBatchDatabaseV2;workspace_id:string;actor_user_id:string;
  plan:SignalTopicEditorialScreeningPlanV2;idempotency_key:string;quote_reference:string;
  previous_execution_id?:string|null};
type Admission={execution_id:string;expected_items:number;stage:'screening';replayed:boolean};
type Quote={status:string;quote_reference:string|null;quote_expires_at:string|null;maximum_micro_usd:string|null;
  expected_group_count:number;provider_execution_enabled:false};
const key=/^[A-Za-z0-9._:-]{8,200}$/u;
const quote=/^v2\.[0-9]{10}\.[a-f0-9]{64}$/u;

/** Non-paying quote over the compact admission seal, never the 80 MB plan. */
export async function quoteSignalTopicEditorialChunkedAdmissionV3(args:{database:SignalTopicEditorialBatchDatabaseV2;
  workspace_id:string;actor_user_id:string;plan:SignalTopicEditorialScreeningPlanV2;deadline:number}):Promise<Quote>{
  const header=buildSignalTopicEditorialAdmissionHeaderV3(args.plan);
  if(args.workspace_id!==header.identity.workspace_id||!Number.isSafeInteger(args.deadline))
    throw new Error('topic_editorial_v3_quote_invalid');
  const client=await args.database.connect();
  try{
    const result=await value<Record<string,unknown>>(client,
      'SELECT signal_topic_editorial_quote_fast_v2($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::bigint) value',
      [args.workspace_id,args.actor_user_id,header.identity.run_id,header.admission_digest,header.expected_group_count,args.deadline]);
    if(typeof result.status!=='string')throw new Error('topic_editorial_v3_quote_unavailable');
    return {status:result.status,quote_reference:typeof result.quote_reference==='string'?result.quote_reference:null,
      quote_expires_at:typeof result.quote_expires_at==='string'?result.quote_expires_at:null,
      maximum_micro_usd:typeof result.hard_cap_micro_usd==='string'?result.hard_cap_micro_usd:null,
      expected_group_count:header.expected_group_count,provider_execution_enabled:false};
  }finally{client.release();}
}

export async function replaySignalTopicEditorialChunkedAdmissionV3(args:{database:SignalTopicEditorialBatchDatabaseV2;
  workspace_id:string;actor_user_id:string;numeric_execution_id:string;idempotency_key:string;
  quote_reference:string;confirmed_cap_micro_usd:string}){
  if(!key.test(args.idempotency_key)||!quote.test(args.quote_reference)||!/^\d{1,19}$/u.test(args.confirmed_cap_micro_usd))
    throw new Error('topic_editorial_v3_request_invalid');
  const client=await args.database.connect();
  try{return await value<Admission>(client,
    'SELECT replay_signal_topic_editorial_batch_v3_unprepared($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::bigint) value',
    [args.workspace_id,args.actor_user_id,args.numeric_execution_id,args.idempotency_key,args.quote_reference,args.confirmed_cap_micro_usd]);}
  finally{client.release();}
}

/** New admissions use one transaction with bounded transport chunks. A lost
 * response is resolved by the existing request-key ledger; a failed chunk
 * rolls the entire header, monetary admission and all request rows back. */
export async function requestSignalTopicEditorialChunkedAdmissionV3(args:Args):Promise<Admission>{
  if(!key.test(args.idempotency_key)||!quote.test(args.quote_reference)
    ||args.plan.identity.workspace_id!==args.workspace_id)
    throw new Error('topic_editorial_v3_request_invalid');
  const header=buildSignalTopicEditorialAdmissionHeaderV3(args.plan);
  const {admission_digest,...unsigned}=header;
  const headerBody=signalTopicEditorialCanonicalBodyV2(unsigned);
  const client=await args.database.connect();
  let begun=false;
  try{
    await client.query('BEGIN');begun=true;
    await client.query('SET LOCAL search_path=public,extensions,pg_temp');
    const result=await value<Admission>(client,
      'SELECT begin_signal_topic_editorial_batch_v3($1::uuid,$2::uuid,$3::jsonb,$4,$5,$6,$7::uuid) value',
      [args.workspace_id,args.actor_user_id,JSON.stringify(header),headerBody,args.idempotency_key,
        args.quote_reference,args.previous_execution_id??null]);
    if(!result?.execution_id||result.expected_items!==header.expected_group_count)
      throw new Error('topic_editorial_v3_begin_invalid');
    if(result.replayed){await client.query('COMMIT');begun=false;return result;}
    for(const chunk of signalTopicEditorialAdmissionChunksV3(args.plan,header)){
      const rows=chunk.map(({batch_index,request})=>{
        const {request_digest,provider_request,...record}=request;
        return {batch_index,request,params_body:JSON.stringify(provider_request.params),
          core_body:signalTopicEditorialCanonicalBodyV2({...record,params:provider_request.params})};
      });
      const inserted=await value<{inserted:number}>(client,
        'SELECT append_signal_topic_editorial_batch_v3($1::uuid,$2::jsonb) value',
        [result.execution_id,JSON.stringify(rows)]);
      if(inserted?.inserted!==rows.length)throw new Error('topic_editorial_v3_chunk_incomplete');
    }
    const finished=await value<Admission>(client,
      'SELECT finalize_signal_topic_editorial_batch_v3($1::uuid,$2::uuid,$3) value',
      [result.execution_id,args.actor_user_id,args.idempotency_key]);
    if(finished?.execution_id!==result.execution_id||finished.expected_items!==header.expected_group_count
      ||finished.replayed)throw new Error('topic_editorial_v3_finalize_invalid');
    await client.query('COMMIT');begun=false;
    return finished;
  }catch(error){if(begun)await client.query('ROLLBACK').catch(()=>undefined);throw error;}
  finally{client.release();}
}

async function value<T>(client:PoolClient,sql:string,values:unknown[]):Promise<T>{
  const result=await client.query<{value:T}>(sql,values);
  if(result.rows.length!==1)throw new Error('topic_editorial_v3_store_result_invalid');
  return result.rows[0]!.value;
}

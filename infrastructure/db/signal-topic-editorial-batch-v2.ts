import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {
  validateSignalTopicEditorialScreeningPlanV2, buildSignalTopicEditorialBatchPlanFromPreparedInputV2, classifySignalTopicEditorialMessageResultV2,
  validateSignalTopicEditorialGroupRequestV2,
  type SignalTopicEditorialScreeningPlanV2,type SignalTopicEditorialGroupRequestV2,
  type SignalTopicEditorialMessageResultV2,type SignalTopicEditorialGroupDecisionV2,
} from '../../packages/query-engine/src/signal-topic-consolidation-editorial-v2';
import type {SignalTopicEditorialPreparedInputV1} from '../../packages/query-engine/src/signal-topic-consolidation-bridge-v1';
import {reuseSignalTopicEditorialPaidGroupV2,type SignalTopicEditorialPaidReuseResultV2,type SignalTopicEditorialPaidSourceCallV2} from '../../packages/query-engine/src/signal-topic-editorial-paid-reuse-v2';
import type {SignalTopicEditorialScreeningPlanV1} from '../../packages/query-engine/src/signal-topic-consolidation-editorial-v1';
import type {SignalTopicEditorialDatabaseV1} from './signal-topic-consolidation-editorial';
import {materializeSignalTopicConsolidationRevisionV1,parseSignalTopicConsolidationRevisionV1,signalTopicConsolidationDigestV1,
  type SignalTopicConsolidationRevisionV1} from './signal-topic-consolidation';

export type SignalTopicEditorialBatchDatabaseV2=SignalTopicEditorialDatabaseV1;
export type SignalTopicEditorialBatchQuoteV2={status:string;quote_reference:string|null;quote_expires_at:string|null;
  maximum_micro_usd:string|null;expected_group_count:number;provider_execution_enabled:false};
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
function unsignedPlan(plan:SignalTopicEditorialScreeningPlanV2){const {plan_digest,...body}=plan;return body;}
/** Policy-backed quote. The full plan and its evidence are server-only arguments. */
export async function quoteSignalTopicEditorialBatchV2(args:Db&{workspace_id:string;actor_user_id:string;run_id:string;
  plan:SignalTopicEditorialScreeningPlanV2;deadline?:number}):Promise<SignalTopicEditorialBatchQuoteV2>{
  validateSignalTopicEditorialScreeningPlanV2(args.plan);
  if(args.plan.identity.workspace_id!==args.workspace_id||args.plan.identity.run_id!==args.run_id
    ||args.deadline!==undefined&&(!Number.isSafeInteger(args.deadline)||args.deadline<=0||args.deadline>9_999_999_999))
    throw new Error('topic_editorial_v2_scope_invalid');
  const planBody=signalTopicEditorialCanonicalBodyV2(unsignedPlan(args.plan));
  return tx(args.database,async client=>{
    const value=(await client.query<{value:Record<string,unknown>}>(
      'SELECT signal_topic_editorial_quote_v2($1,$2,$3,$4::jsonb,$5,$6::bigint) value',
      [args.workspace_id,args.actor_user_id,args.run_id,JSON.stringify(args.plan),planBody,args.deadline??null])).rows[0]?.value;
    if(!value||typeof value.status!=='string')throw new Error('topic_editorial_v2_quote_unavailable');
    return {status:value.status,quote_reference:typeof value.quote_reference==='string'?value.quote_reference:null,
      quote_expires_at:typeof value.quote_expires_at==='string'?value.quote_expires_at:null,
      maximum_micro_usd:typeof value.hard_cap_micro_usd==='string'?value.hard_cap_micro_usd:null,
      expected_group_count:typeof value.expected_group_count==='number'?value.expected_group_count:args.plan.expected_group_count,
      provider_execution_enabled:false};
  });
}
/** Non-paying policy quote: bind the server-built plan digest without sending
 * its 80+ MB evidence twice. Atomic admission revalidates every receipt. */
export async function quoteSignalTopicEditorialBatchFastV2(args:Db&{workspace_id:string;actor_user_id:string;run_id:string;
  plan:SignalTopicEditorialScreeningPlanV2;deadline:number}):Promise<SignalTopicEditorialBatchQuoteV2>{
  validateSignalTopicEditorialScreeningPlanV2(args.plan);
  if(args.plan.identity.workspace_id!==args.workspace_id||args.plan.identity.run_id!==args.run_id
    ||!Number.isSafeInteger(args.deadline)||args.deadline<=0||args.deadline>9_999_999_999)
    throw new Error('topic_editorial_v2_scope_invalid');
  return tx(args.database,async client=>{
    const value=(await client.query<{value:Record<string,unknown>}>(
      'SELECT signal_topic_editorial_quote_fast_v2($1,$2,$3,$4,$5,$6::bigint) value',
      [args.workspace_id,args.actor_user_id,args.run_id,args.plan.plan_digest,args.plan.expected_group_count,args.deadline])).rows[0]?.value;
    if(!value||typeof value.status!=='string')throw new Error('topic_editorial_v2_quote_unavailable');
    return {status:value.status,quote_reference:typeof value.quote_reference==='string'?value.quote_reference:null,
      quote_expires_at:typeof value.quote_expires_at==='string'?value.quote_expires_at:null,
      maximum_micro_usd:typeof value.hard_cap_micro_usd==='string'?value.hard_cap_micro_usd:null,
      expected_group_count:typeof value.expected_group_count==='number'?value.expected_group_count:args.plan.expected_group_count,
      provider_execution_enabled:false};
  });
}
/** Promotes a freshly server-loaded, provenance-checked input and admits it under
 * the exact policy quote. Browser data never contains this plan or its evidence. */
export async function requestSignalTopicEditorialBatchV2(args:Db&{workspace_id:string;actor_user_id:string;run_id:string;
  input:SignalTopicEditorialPreparedInputV1;idempotency_key:string;quote_reference:string;previous_execution_id?:string|null}){
  const plan=buildSignalTopicEditorialBatchPlanFromPreparedInputV2({input:args.input,run_id:args.run_id});
  return requestSignalTopicEditorialBatchPlanV2({...args,plan});
}
/** Admits the exact server-built plan already quoted by the caller. Keeping this
 * path separate avoids rebuilding a large evidence plan after policy quoting;
 * the SQL function still revalidates its canonical digest, source and quote. */
export async function requestSignalTopicEditorialBatchPlanV2(args:Db&{workspace_id:string;actor_user_id:string;run_id:string;
  plan:SignalTopicEditorialScreeningPlanV2;idempotency_key:string;quote_reference:string;previous_execution_id?:string|null}){
  const plan=args.plan;
  validateSignalTopicEditorialScreeningPlanV2(plan);
  return requestQuotedSignalTopicEditorialBatchPlanV2(args);
}
/** Fast path for a server-held plan that quoteSignalTopicEditorialBatchV2 just
 * validated. The admission SQL repeats the exact source, policy, quote and
 * plan-digest checks atomically; it does not trust browser-supplied evidence. */
export async function requestQuotedSignalTopicEditorialBatchPlanV2(args:Db&{workspace_id:string;actor_user_id:string;run_id:string;
  plan:SignalTopicEditorialScreeningPlanV2;idempotency_key:string;quote_reference:string;previous_execution_id?:string|null}){
  const plan=args.plan;
  if(!plan||!Array.isArray(plan.requests)||!plan.identity
    ||!/^v2\.[0-9]{10}\.[a-f0-9]{64}$/u.test(args.quote_reference))throw new Error('topic_editorial_v2_request_invalid');
  if(plan.identity.workspace_id!==args.workspace_id||plan.identity.run_id!==args.run_id)
    throw new Error('topic_editorial_v2_scope_invalid');
  const {plan_digest:_digest,...unsigned}=plan;
  const sealedBody=signalTopicEditorialCanonicalBodyV2(unsigned);
  if(sha(sealedBody)!==plan.plan_digest)throw new Error('topic_editorial_v2_plan_digest_invalid');
  if(!/^[-A-Za-z0-9._:]{8,200}$/u.test(args.idempotency_key))throw new Error('topic_editorial_v2_request_invalid');
  const planBody=sealedBody;
  const requestBodies=plan.requests.map(request=>{const {request_digest,...core}=request;
    const {provider_request,...record}=core;
    const coreBody=signalTopicEditorialCanonicalBodyV2({...record,params:provider_request.params});
    if(sha(coreBody)!==request_digest)throw new Error('topic_editorial_v2_request_digest_invalid');
    return {params_body:JSON.stringify(provider_request.params),core_body:coreBody};});
  return invoke<{execution_id:string;expected_items:number;stage:'screening';replayed:boolean}>(args.database,
    'SELECT request_signal_topic_editorial_batch_v2_unprepared($1,$2,$3::jsonb,$4,$5::jsonb,$6,$7,$8::uuid) value',
    [args.workspace_id,args.actor_user_id,JSON.stringify(plan),planBody,JSON.stringify(requestBodies),args.idempotency_key,
      args.quote_reference,args.previous_execution_id??null]);
}
/** Durable same-key recovery is source-independent but still matches the original sealed quote/cap. */
export async function replaySignalTopicEditorialBatchV2(args:Db&{workspace_id:string;actor_user_id:string;
  numeric_execution_id:string;idempotency_key:string;quote_reference:string;confirmed_cap_micro_usd:string}){
  if(!/^v2\.[0-9]{10}\.[a-f0-9]{64}$/u.test(args.quote_reference)||!/^\d{1,19}$/u.test(args.confirmed_cap_micro_usd))
    throw new Error('topic_editorial_v2_request_invalid');
  return invoke<{replayed:boolean;execution_id?:string;expected_items?:number;stage?:'screening';batch_id?:string|null;manifest_digest?:string|null}>(args.database,
    'SELECT replay_signal_topic_editorial_batch_v2_unprepared($1,$2,$3::uuid,$4,$5,$6::bigint) value',
    [args.workspace_id,args.actor_user_id,args.numeric_execution_id,args.idempotency_key,args.quote_reference,args.confirmed_cap_micro_usd]);
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

/** Anthropic currently compiles a distinct JSON grammar for each sealed group
 * request. The first large Batch can therefore return zero-cost grammar rate
 * errors. Retry only those exact, settled receipts, never successes, with a
 * provider-wide cooldown. This uses the original immutable request and ledger.
 * A transaction advisory lock keeps multiple Worker replicas from preparing
 * different batches in the same cooldown window. */
export async function prepareSignalTopicEditorialGrammarRetryV2(args:Db){
  return tx(args.database,async client=>{
    const lock=(await client.query<{locked:boolean}>(
      "SELECT pg_try_advisory_xact_lock(hashtextextended('signal-topic-editorial-grammar-retry-v2',0)) locked"
    )).rows[0]?.locked;
    if(!lock)return null;
    // Check the cheap global send window before scanning request receipts.
    const pacing=(await client.query<{blocked:boolean}>(`SELECT EXISTS (
      SELECT 1 FROM signal_topic_editorial_provider_batches_v2 b
      WHERE b.state IN('prepared','submitting','submission_unknown')
         OR b.submitted_at>clock_timestamp()-interval '75 seconds'
    ) blocked`)).rows[0]?.blocked;
    if(pacing)return null;
    const candidate=await client.query<{execution_id:string;request_digests:string[];submission_key:string}>(`
      WITH available AS (
        SELECT e.id execution_id, r.request_digest, r.batch_index
        FROM signal_topic_editorial_executions e
        JOIN signal_topic_editorial_batch_owners_v2 o ON o.execution_id=e.id
        JOIN signal_topic_editorial_requests r ON r.execution_id=e.id
        JOIN LATERAL (
          SELECT c.id,c.status,c.response_body_private,c.reserved_at
          FROM signal_topic_editorial_calls c WHERE c.request_id=r.id AND c.transport_version=2
          ORDER BY c.reserved_at DESC,c.id DESC LIMIT 1
        ) latest ON true
        JOIN signal_topic_editorial_batch_items_v2 item ON item.call_id=latest.id
        JOIN signal_topic_editorial_provider_batches_v2 prior ON prior.id=item.batch_id
        WHERE e.status IN('queued','running') AND o.stage='screening'
          AND e.plan->>'contract_version' IN
            ('signal-topic-editorial-screening-plan-v2','signal-topic-editorial-admission-header-v3')
          AND clock_timestamp()+interval '3 minutes'<o.send_not_after
          AND prior.state='applied' AND latest.status='settled'
          AND item.outcome='errored' AND item.validation->>'status'='invalid_message'
          AND item.validation->>'code'='topic_editorial_v2_provider_errored'
          AND latest.response_body_private::jsonb->'result'->'error'->'error'->>'message'
            LIKE 'Grammar compilation rate limit exceeded%'
          AND (SELECT count(*) FROM signal_topic_editorial_calls attempts
            WHERE attempts.request_id=r.id AND attempts.transport_version=2)<5
          AND NOT EXISTS (SELECT 1 FROM signal_topic_editorial_reused_decisions_v2 reused WHERE reused.request_id=r.id)
      ), chosen_execution AS (
        SELECT execution_id FROM available GROUP BY execution_id ORDER BY execution_id LIMIT 1
      ), selected AS (
        SELECT a.execution_id,a.request_digest,a.batch_index FROM available a
        JOIN chosen_execution e USING(execution_id) ORDER BY a.batch_index LIMIT 15
      )
      SELECT execution_id::text,array_agg(request_digest ORDER BY batch_index) request_digests,
        'v2-grammar-retry-'||replace(execution_id::text,'-','')||'-'||
        min(batch_index)::text||'-'||max(batch_index)::text||'-'||
        (SELECT count(*)::text FROM signal_topic_editorial_provider_batches_v2 b WHERE b.execution_id=selected.execution_id)
        submission_key
      FROM selected GROUP BY execution_id`,[]);
    const work=candidate.rows[0];
    if(!work||work.request_digests.length===0)return null;
    const result=(await client.query<{value:{batch_id:string;manifest_digest:string;replayed:boolean}}>(
      'SELECT prepare_signal_topic_editorial_batch_v2($1::uuid,$2::text[],$3) value',
      [work.execution_id,work.request_digests,work.submission_key])).rows[0]?.value;
    if(!result)throw new Error('topic_editorial_v2_grammar_retry_unavailable');
    return {...result,execution_id:work.execution_id,provider_items:work.request_digests.length};
  });
}
/** Ensures the admitted execution has one durable provider manifest covering
 * every still-unreused logical group. Safe after a lost HTTP response: the key
 * and manifest digest are derived from the immutable execution snapshot. */
export async function prepareAllSignalTopicEditorialBatchV2(args:Db&{execution_id:string}){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(args.execution_id))
    throw new Error('topic_editorial_v2_execution_invalid');
  const client=await args.database.connect();
  let digests:string[];
  try{
    const result=await client.query<{request_digest:string}>(`SELECT r.request_digest FROM signal_topic_editorial_requests r
      JOIN signal_topic_editorial_executions e ON e.id=r.execution_id
      WHERE r.execution_id=$1::uuid AND e.plan->>'contract_version' IN
        ('signal-topic-editorial-screening-plan-v2','signal-topic-editorial-admission-header-v3')
        AND NOT EXISTS(SELECT 1 FROM signal_topic_editorial_reused_decisions_v2 reused WHERE reused.request_id=r.id)
      ORDER BY r.batch_index,r.request_digest`,[args.execution_id]);
    digests=result.rows.map(row=>row.request_digest);
  }finally{client.release();}
  if(digests.length===0){
    const db=await args.database.connect();
    try{const row=(await db.query<{expected:number;reused:number}>(`SELECT jsonb_array_length(e.plan->'requests') expected,
      (SELECT count(*)::integer FROM signal_topic_editorial_reused_decisions_v2 r WHERE r.execution_id=e.id) reused
      FROM signal_topic_editorial_executions e WHERE e.id=$1::uuid AND e.plan->>'contract_version' IN
        ('signal-topic-editorial-screening-plan-v2','signal-topic-editorial-admission-header-v3')`,[args.execution_id])).rows[0];
      if(!row||row.expected===0||row.expected!==row.reused)throw new Error('topic_editorial_v2_manifest_empty');
      return {batch_id:null,manifest_digest:null,replayed:true,provider_items:0,reused_items:row.reused};
    }finally{db.release();}
  }
  const submission_key=`v2-full-${args.execution_id.replaceAll('-','')}`;
  const prepared=await prepareSignalTopicEditorialBatchV2({database:args.database,execution_id:args.execution_id,
    request_digests:digests,submission_key});
  return {...prepared,provider_items:digests.length};
}

/** Records a terminal pre-provider preparation failure on the V2 owner. The
 * database refuses this transition once any provider manifest or call exists. */
export async function markSignalTopicEditorialBatchPreparationFailedV2(args:Db&{execution_id:string}){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(args.execution_id))
    throw new Error('topic_editorial_v2_execution_invalid');
  return invoke<{execution_id:string;stage:'preparation_failed';replayed:boolean}>(args.database,
    'SELECT mark_signal_topic_editorial_batch_preparation_failed_v2($1::uuid) value',[args.execution_id]);
}

/** Starts a new durable preparation attempt against the original admitted V2
 * execution. A fresh immutable key is required; no new quote, cap or spend is
 * created here, and the database rechecks actor scope and source freshness. */
export async function retrySignalTopicEditorialBatchPreparationV2(args:Db&{workspace_id:string;actor_user_id:string;
  execution_id:string;idempotency_key:string}){
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  if(!uuid.test(args.workspace_id)||!uuid.test(args.actor_user_id)||!uuid.test(args.execution_id))
    throw new Error('topic_editorial_v2_request_invalid');
  if(!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key))
    throw new Error('topic_editorial_v2_request_invalid');
  return invoke<{execution_id:string;stage:'screening';replayed:boolean}>(args.database,
    'SELECT retry_signal_topic_editorial_batch_preparation_v2($1::uuid,$2::uuid,$3::uuid,$4) value',
    [args.workspace_id,args.actor_user_id,args.execution_id,args.idempotency_key]);
}

/** Copies only prior, fully settled V1 decisions whose raw provider receipt,
 * exact request, source group, context and cited evidence all match V2. The DB
 * trigger independently verifies the same lineage before persisting each copy. */
export async function reuseCompatibleSignalTopicEditorialPaidResultsV2(args:Db&{execution_id:string}){
  const client=await args.database.connect();
  let target:{plan:SignalTopicEditorialScreeningPlanV2;previous_execution_id:string|null}|null=null;
  let prior: {plan:SignalTopicEditorialScreeningPlanV1;calls:Array<{request_digest:string;response_body_private:string;
    response_sha256:string;response_output:unknown;response_http_status:number;response_complete:boolean;
    call_id:string;execution_id:string;workspace_id:string;run_id:string}>}|null=null;
  try{
    const targetResult=await client.query<{plan:SignalTopicEditorialScreeningPlanV2;previous_execution_id:string|null}>(`
      SELECT e.plan,o.previous_execution_id::text FROM signal_topic_editorial_executions e
      JOIN signal_topic_editorial_batch_owners_v2 o ON o.execution_id=e.id
      WHERE e.id=$1::uuid AND e.plan->>'contract_version' IN
        ('signal-topic-editorial-screening-plan-v2','signal-topic-editorial-admission-header-v3')`,[args.execution_id]);
    target=targetResult.rows[0]??null;
    if(!target)return {reused_items:0,needs_review_items:0};
    if(!target.previous_execution_id)return {reused_items:0,needs_review_items:0};
    if(target.plan.contract_version==='signal-topic-editorial-admission-header-v3' as string){
      const requestRows=await client.query<{request:SignalTopicEditorialGroupRequestV2}>(`
        SELECT receipts->'request' request FROM signal_topic_editorial_requests
        WHERE execution_id=$1::uuid ORDER BY batch_index`,[args.execution_id]);
      target.plan={...target.plan,requests:requestRows.rows.map(row=>row.request)};
    }
    const result=await client.query<{plan:SignalTopicEditorialScreeningPlanV1;calls:typeof prior extends infer _ ? Array<{
      request_digest:string;response_body_private:string;response_sha256:string;response_output:unknown;response_http_status:number;
      response_complete:boolean;call_id:string;execution_id:string;workspace_id:string;run_id:string}>:never}>(`
      SELECT e.plan,COALESCE((SELECT jsonb_agg(jsonb_build_object('request_digest',r.request_digest,'response_body_private',c.response_body_private,
        'response_sha256',c.response_sha256,'response_output',c.response_output,'response_http_status',c.response_http_status,
        'response_complete',c.response_complete,'call_id',c.id,'execution_id',c.execution_id,'workspace_id',c.workspace_id,
        'run_id',e.numeric_run_id) ORDER BY c.settled_at DESC,c.id) FROM signal_topic_editorial_requests r
        JOIN signal_topic_editorial_calls c ON c.request_id=r.id AND c.execution_id=e.id
        WHERE r.execution_id=e.id AND r.phase='screening' AND r.parent_request_id IS NULL AND c.transport_version=1
          AND c.status='settled' AND c.response_http_status=200 AND c.response_complete=true),'[]'::jsonb) calls
      FROM signal_topic_editorial_executions e WHERE e.id=$1::uuid AND e.workspace_id=$2::uuid
        AND e.plan->>'contract_version'='signal-topic-editorial-screening-plan-v1'`,
      [target.previous_execution_id,target.plan.identity.workspace_id]);
    prior=result.rows[0]??null;
  }finally{client.release();}
  if(!prior)return {reused_items:0,needs_review_items:target!.plan.requests.length};
  let reused_items=0,needs_review_items=0;
  for(const request of target!.plan.requests){
    const source_batch=prior.plan.batches.find(batch=>batch.group_keys.includes(request.receipt.group_key));
    const call=source_batch&&prior.calls.find(item=>item.request_digest===source_batch.request_digest);
    if(!source_batch||!call){needs_review_items++;continue;}
    const source_call:SignalTopicEditorialPaidSourceCallV2={...call,status:'settled',request:{contract_version:'signal-topic-editorial-provider-request-v1',
      phase:'screening',idempotency_key:source_batch.batch_key,model:source_batch.model,request_digest:source_batch.request_digest,
      request_body:source_batch.request_body}};
    const reuse=reuseSignalTopicEditorialPaidGroupV2({request,source_batch,source_call,source:{kind:'raw_response'}});
    if(reuse.status!=='reusable'){needs_review_items++;continue;}
    await recordReusedSignalTopicEditorialDecisionV2({database:args.database,execution_id:args.execution_id,
      request_digest:request.request_digest,reuse});
    reused_items++;
  }
  return {reused_items,needs_review_items};
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

export type SignalTopicEditorialBatchCatalogOutcomeV2={request:SignalTopicEditorialGroupRequestV2;
  decision:SignalTopicEditorialGroupDecisionV2|null;technical_error_code:string|null};
export type SignalTopicEditorialBatchCatalogV2={
  outcomes:Array<{group_key:string;status:'topic'|'narrative'|'noise'|'insufficient_evidence'|'technical_error';
    concept_key:string|null;technical_error_code:string|null;cited_ref_ids:string[]}>;
  revision:SignalTopicConsolidationRevisionV1|null;
};
/** Converts one immutable decision per numeric group to the existing editable,
 * revisioned catalog. A technical failure remains an explicit outcome and
 * blocks completeness; it is never coerced to Noise or insufficient evidence. */
export function buildSignalTopicEditorialBatchCatalogV2(args:{outcomes:SignalTopicEditorialBatchCatalogOutcomeV2[];revision:number}):SignalTopicEditorialBatchCatalogV2{
  if(!Number.isSafeInteger(args.revision)||args.revision<1||!args.outcomes.length)throw new Error('topic_editorial_v2_catalog_input_invalid');
  const seen=new Set<string>(),concepts:SignalTopicConsolidationRevisionV1['concepts']=[],decisions:SignalTopicConsolidationRevisionV1['decisions']=[];
  const outcomes:SignalTopicEditorialBatchCatalogV2['outcomes']=[];
  for(const item of args.outcomes){
    const request=item.request;validateSignalTopicEditorialGroupRequestV2(request);
    const groupKey=request.receipt.group_key;
    if(seen.has(groupKey))throw new Error('topic_editorial_v2_catalog_duplicate_group');seen.add(groupKey);
    const decision=item.decision;
    if(item.technical_error_code!==null||decision===null){
      if(!item.technical_error_code||!/^topic_editorial_v2_[a-z0-9_]+$/u.test(item.technical_error_code))throw new Error('topic_editorial_v2_catalog_error_code_invalid');
      outcomes.push({group_key:groupKey,status:'technical_error',concept_key:null,technical_error_code:item.technical_error_code,cited_ref_ids:[]});
      continue;
    }
    if(decision.group_key!==groupKey||decision.group_digest!==request.receipt.group_digest
      ||decision.dossier_digest!==request.receipt.dossier_digest||decision.request_digest!==request.request_digest)
      throw new Error('topic_editorial_v2_catalog_decision_scope_invalid');
    const disposition=decision.disposition;
    const kind: 'topic'|'narrative'|'noise'|'insufficient_evidence' = disposition==='unresolved'?'insufficient_evidence':disposition;
    let conceptKey:string|null=null;
    if(disposition==='topic'||disposition==='narrative'){
      if(!decision.candidate)throw new Error('topic_editorial_v2_catalog_candidate_missing');
      conceptKey=decision.candidate.candidate_key;
      concepts.push({concept_key:conceptKey,kind:disposition,label:decision.candidate.label,definition:decision.candidate.definition,
        locale:decision.candidate.locale,source:'model'});
    }else if(decision.candidate!==null)throw new Error('topic_editorial_v2_catalog_candidate_unexpected');
    decisions.push({group_key:groupKey,disposition,concept_key:conceptKey,source:'model',confidence:decision.confidence,rationale:decision.rationale});
    outcomes.push({group_key:groupKey,status:kind,concept_key:conceptKey,technical_error_code:null,cited_ref_ids:[...decision.cited_ref_ids]});
  }
  if(new Set(concepts.map(item=>item.concept_key)).size!==concepts.length)throw new Error('topic_editorial_v2_catalog_concept_conflict');
  if(outcomes.some(item=>item.status==='technical_error'))return {outcomes,revision:null};
  concepts.sort((a,b)=>a.concept_key<b.concept_key?-1:a.concept_key>b.concept_key?1:0);
  decisions.sort((a,b)=>a.group_key<b.group_key?-1:a.group_key>b.group_key?1:0);
  const body={contract_version:'signal-topic-consolidation-revision-v1' as const,revision:args.revision,concepts,decisions};
  const revision=parseSignalTopicConsolidationRevisionV1({...body,revision_digest:signalTopicConsolidationDigestV1(body)},
    outcomes.map(item=>item.group_key));
  return {outcomes,revision};
}

/** Persists the complete V2 result through the existing immutable revision
 * editor. Incomplete/technical units are reported as technical errors and
 * cannot produce a partial catalog revision. */
export async function materializeSignalTopicEditorialBatchV2(args:Db&{workspace_id:string;actor_user_id:string;
  numeric_execution_id:string;execution_id:string}){
  const client=await args.database.connect();
  let rows:Array<{request:SignalTopicEditorialGroupRequestV2;decision:SignalTopicEditorialGroupDecisionV2|null;technical_error_code:string|null}>;
  let revision:number;
  let consolidationRunId:string;
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query('SET LOCAL search_path=public,extensions,pg_temp');
    const owner=(await client.query<{numeric_run_id:string;expected:number;actor_user_id:string;materialized:boolean;contract_version:string}>(`
      SELECT e.numeric_run_id::text,e.actor_user_id::text,jsonb_array_length(e.plan->'requests') expected,
        e.plan->>'contract_version' contract_version,
        EXISTS(SELECT 1 FROM signal_topic_consolidation_revisions r WHERE r.consolidation_run_id=e.numeric_run_id
          AND r.workspace_id=e.workspace_id AND r.status='validated' AND r.created_by_user_id=e.actor_user_id AND r.created_at>=e.created_at) materialized
      FROM signal_topic_editorial_executions e JOIN signal_topic_editorial_batch_owners_v2 o ON o.execution_id=e.id
      WHERE e.id=$1::uuid AND e.workspace_id=$2::uuid AND e.actor_user_id=$3::uuid
        AND e.plan->>'contract_version' IN ('signal-topic-editorial-screening-plan-v2','signal-topic-editorial-admission-header-v3')`,
    [args.execution_id,args.workspace_id,args.actor_user_id])).rows[0];
    if(!owner)throw new Error('topic_editorial_v2_catalog_scope_invalid');
    // V3 screening is only the first editorial pass. Publishing one concept
    // per atomic BERTopic group would misrepresent it as global consolidation.
    if(owner.contract_version==='signal-topic-editorial-admission-header-v3')
      throw new Error('topic_editorial_global_review_pending');
    consolidationRunId=owner.numeric_run_id;
    if(owner.materialized){
      const prior=(await client.query<{revision:number}>(`SELECT revision FROM signal_topic_consolidation_revisions
        WHERE consolidation_run_id=$1::uuid AND workspace_id=$2::uuid AND status='validated' AND created_by_user_id=$3::uuid
          AND created_at>=(SELECT created_at FROM signal_topic_editorial_executions WHERE id=$4::uuid)
        ORDER BY revision DESC LIMIT 1`,[owner.numeric_run_id,args.workspace_id,args.actor_user_id,args.execution_id])).rows[0];
      await client.query('COMMIT');
      return {consolidation_run_id:owner.numeric_run_id,revision:prior?.revision??null,replayed:true,technical_error_count:0};
    }
    const source=(await client.query<{request:SignalTopicEditorialGroupRequestV2;validation:SignalTopicEditorialMessageResultV2|null;
      reused:SignalTopicEditorialGroupDecisionV2|null;outcome:string|null;call_status:string|null;item_error:string|null;batch_error:string|null}>(`
      SELECT r.receipts->'request' request,item.validation,reused.decision reused,item.outcome,item.call_status,
        COALESCE(item.validation->>'code',item.item_error) item_error,item.batch_error
      FROM signal_topic_editorial_requests r
      LEFT JOIN signal_topic_editorial_reused_decisions_v2 reused ON reused.request_id=r.id
      LEFT JOIN LATERAL(SELECT entry.validation,entry.outcome,call.status call_status,call.error_code item_error,batch.error_code batch_error
        FROM signal_topic_editorial_batch_items_v2 entry
        JOIN signal_topic_editorial_provider_batches_v2 batch ON batch.id=entry.batch_id
        JOIN signal_topic_editorial_calls call ON call.id=entry.call_id
        WHERE entry.request_id=r.id ORDER BY batch.created_at DESC,batch.id DESC LIMIT 1) item ON true
      WHERE r.execution_id=$1::uuid ORDER BY r.batch_index,r.request_digest`,[args.execution_id])).rows;
    if(source.length!==owner.expected)throw new Error('topic_editorial_v2_catalog_coverage_incomplete');
    rows=source.map(item=>{
      const validation=item.validation;
      if(item.reused)return {request:item.request,decision:item.reused,technical_error_code:null};
      if(validation?.status==='accepted')return {request:item.request,decision:validation.decision,technical_error_code:null};
      const code=item.item_error??item.batch_error??(item.outcome?`topic_editorial_v2_provider_${item.outcome}`:
        item.call_status==='outcome_unknown'?'topic_editorial_v2_submission_unknown':'topic_editorial_v2_result_missing');
      return {request:item.request,decision:null,technical_error_code:/^topic_editorial_v2_[a-z0-9_]+$/u.test(code)?code:'topic_editorial_v2_result_invalid'};
    });
    const next=(await client.query<{revision:number}>(`SELECT COALESCE(max(revision),0)+1 revision
      FROM signal_topic_consolidation_revisions WHERE consolidation_run_id=$1::uuid AND workspace_id=$2::uuid`,
    [owner.numeric_run_id,args.workspace_id])).rows[0]?.revision??1;
    revision=next;
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}
  finally{client.release();}
  const catalog=buildSignalTopicEditorialBatchCatalogV2({outcomes:rows!,revision:revision!});
  const technicalErrorCount=catalog.outcomes.filter(item=>item.status==='technical_error').length;
  if(!catalog.revision) return {consolidation_run_id:null,revision:null,replayed:false,technical_error_count:technicalErrorCount,
    outcome_counts:countBatchCatalogOutcomesV2(catalog.outcomes)};
  const stored=await materializeSignalTopicConsolidationRevisionV1({database:args.database,workspace_id:args.workspace_id,
    actor_user_id:args.actor_user_id,consolidation_run_id:consolidationRunId!,revision:catalog.revision});
  return {...stored,technical_error_count:0,outcome_counts:countBatchCatalogOutcomesV2(catalog.outcomes)};
}
function countBatchCatalogOutcomesV2(outcomes:SignalTopicEditorialBatchCatalogV2['outcomes']){
  return {topic:outcomes.filter(item=>item.status==='topic').length,narrative:outcomes.filter(item=>item.status==='narrative').length,
    noise:outcomes.filter(item=>item.status==='noise').length,insufficient_evidence:outcomes.filter(item=>item.status==='insufficient_evidence').length,
    technical_error:outcomes.filter(item=>item.status==='technical_error').length};
}

/** The database independently binds the copied decision to the existing paid call
 * and exact historical checkpoint. No V2 provider call or monetary row is added. */
export function recordReusedSignalTopicEditorialDecisionV2(args:Db&{execution_id:string;request_digest:string;
  reuse:Extract<SignalTopicEditorialPaidReuseResultV2,{status:'reusable'}>}){
  const body=JSON.stringify(args.reuse);
  return invoke<{replayed:boolean}>(args.database,'SELECT reuse_signal_topic_editorial_paid_decision_v2($1,$2,$3,$4) value',
    [args.execution_id,args.request_digest,body,sha(body)]);
}

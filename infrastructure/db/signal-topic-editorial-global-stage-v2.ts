import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {SignalTopicEditorialGlobalStageItemV2,SignalTopicEditorialGlobalStageLeaseV2,
  SignalTopicEditorialGlobalStageStoresV2} from '../../services/workers/src/workers/signal-topic-editorial-global-stage-v2';
import type {AnthropicBatchHttpReceipt,AnthropicBatchState} from '../../services/workers/src/providers/anthropic-message-batches';
import {signalTopicEditorialGlobalStageRequestIdentityV2,signalTopicEditorialGlobalStageManifestDigestV2,
  type SignalTopicEditorialGlobalStageValidationV2} from '../../services/workers/src/workers/signal-topic-editorial-global-stage-v2';
import {signalTopicEditorialStagedScreeningReviewDigestV2,
  repairSignalTopicEditorialGlobalShardFormattingV2,
  repairSignalTopicEditorialGlobalMergeMemberKeysV2,
  repairSignalTopicEditorialGlobalRankingKeyV2,
  type SignalTopicEditorialGlobalCatalogInputV2} from '../../packages/query-engine/src/signal-topic-editorial-global-v2';
import type {SignalTopicEditorialGlobalUnitV2} from '../../packages/query-engine/src/signal-topic-editorial-global-v2';
import {materializeSignalTopicConsolidationRevisionV1,parseSignalTopicConsolidationRevisionV1,signalTopicConsolidationDigestV1} from './signal-topic-consolidation';

export type SignalTopicEditorialGlobalStageDatabaseV2=Pick<Pool,'connect'>;
export type SignalTopicEditorialGlobalStagePreparedV2={stage_id:string;execution_id:string;request_count:number;batch_id:string;
  manifest_digest:string;reserved_micro_usd:string;replayed:boolean};
const sha=(body:string)=>`sha256:${createHash('sha256').update(body).digest('hex')}`;
function observedBatchMicroUsd(envelope:Record<string,unknown>):string|null{
  const result=envelope.result;
  if(!result||typeof result!=='object'||Array.isArray(result))return null;
  const row=result as Record<string,unknown>;
  if(['errored','canceled','expired'].includes(String(row.type)))return '0';
  const message=row.message;
  if(row.type!=='succeeded'||!message||typeof message!=='object'||Array.isArray(message))return null;
  const record=message as Record<string,unknown>,usage=record.usage;
  if(record.model!=='claude-sonnet-4-6'||!usage||typeof usage!=='object'||Array.isArray(usage))return null;
  const tokens=usage as Record<string,unknown>,input=tokens.input_tokens,output=tokens.output_tokens;
  if(!Number.isSafeInteger(input)||!Number.isSafeInteger(output)||Number(input)<0||Number(output)<0
    ||Number(tokens.cache_creation_input_tokens??0)!==0||Number(tokens.cache_read_input_tokens??0)!==0)return null;
  return ((BigInt(Number(input))*3n+BigInt(Number(output))*15n+1n)/2n).toString();
}
const stable=(value:unknown):string=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(stable).join(',')}]`
  :`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
/** Same conservative batch reservation formula used by SQL0199: UTF-8 bytes
 * estimate input at 0.5 tokens/byte; reserve maximum output at batch pricing. */
export function signalTopicEditorialGlobalStageReservationMicroUsdV2(requestBody:string,maxTokens:number):bigint{
  if(!Number.isSafeInteger(maxTokens)||maxTokens<=0)throw new Error('topic_editorial_global_stage_request_invalid');
  return (BigInt(Buffer.byteLength(requestBody,'utf8'))*3n+BigInt(maxTokens)*15n+1n)/2n;
}
export function signalTopicEditorialGlobalStageRevisionConceptsV2(concepts:readonly {concept_key:string;kind:'topic'|'narrative';
  label:string;definition:string;locale:string;source:'numeric'|'model'|'human';metadata:unknown}[]){
  return concepts.map(({concept_key,kind,label,definition,locale,source})=>({concept_key,kind,label,definition,locale,source}));
}
function identity(item:SignalTopicEditorialGlobalStageItemV2):string{
  return signalTopicEditorialGlobalStageRequestIdentityV2(item);
}
async function tx<T>(database:SignalTopicEditorialGlobalStageDatabaseV2,work:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await database.connect();let begun=false;
  try{await client.query('BEGIN');begun=true;await client.query('SET LOCAL search_path=public,extensions,pg_temp');
    const result=await work(client);await client.query('COMMIT');begun=false;return result;
  }catch(error){if(begun)await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
}
/** Persist an immutable shard/merge/rank manifest as children of the original
 * paid execution. The migration's call trigger applies same-policy/day and
 * same-execution caps atomically, aggregating old editorial calls plus stages.
 * This is intentionally server-only: browser plans/evidence are never inputs. */
export async function prepareSignalTopicEditorialGlobalStageV2(args:{database:SignalTopicEditorialGlobalStageDatabaseV2;
  workspace_id:string;actor_user_id:string;execution_id:string;stage_id:string;snapshot_digest:string;
  screening_review_digest:string;stage_kind:'shard'|'merge'|'rank';round:number;
  items:SignalTopicEditorialGlobalStageItemV2[]}):Promise<SignalTopicEditorialGlobalStagePreparedV2>{
  if(!/^[0-9a-f-]{36}$/iu.test(args.stage_id)||!args.items.length||args.items.length>100
    ||!/^sha256:[0-9a-f]{64}$/u.test(args.snapshot_digest)||!/^sha256:[0-9a-f]{64}$/u.test(args.screening_review_digest)
    ||!Number.isSafeInteger(args.round)||args.round<0||args.items.some(item=>item.stage_id!==args.stage_id||item.stage_kind!==args.stage_kind))
    throw new Error('topic_editorial_global_stage_invalid');
  const identities=args.items.map(item=>identity(item));
  if(new Set(identities).size!==identities.length)throw new Error('topic_editorial_global_stage_identity_duplicate');
  const material=args.items.map(item=>({custom_id:item.provider_request.custom_id,call_id:item.call_id,stage_identity:identity(item),
    request_digest:item.stage_kind==='shard'?item.shard!.request_digest:item.review!.request_digest}))
    .sort((a,b)=>a.custom_id<b.custom_id?-1:a.custom_id>b.custom_id?1:0);
  const manifest=stable({stage_kind:args.stage_kind,items:material}),manifestDigest=sha(manifest);
  // The caller cannot choose or forge the screening seal. Recompute it from
  // the accepted immutable receipts before the stage becomes durable.
  const source=await loadSignalTopicEditorialGlobalUnitsV2({database:args.database,workspace_id:args.workspace_id,
    actor_user_id:args.actor_user_id,execution_id:args.execution_id});
  if(source.expected_group_count<1||signalTopicEditorialStagedScreeningReviewDigestV2({units:source.units,
      expected_group_count:source.expected_group_count})!==args.screening_review_digest
    ||source.units.some(unit=>unit.request.identity.snapshot_digest!==args.snapshot_digest))
    throw new Error('topic_editorial_global_stage_source_digest_invalid');
  return tx(args.database,async client=>{
    let execution=(await client.query<{organization_id:string;processing_admission_id:string;budget_date:string;budget_timezone:string;
      policy_version_id:string;hard_cap_micro_usd:string;stage:string;send_not_after:string;expected_group_count:number}>(`
      SELECT e.organization_id,e.processing_admission_id,
        CASE WHEN grant_row.execution_id IS NULL THEN a.budget_date ELSE (clock_timestamp() AT TIME ZONE a.budget_timezone)::date END budget_date,
        a.budget_timezone,a.policy_version_id,
        e.hard_cap_micro_usd::text,o.stage,o.send_not_after::text,run.expected_group_count
      FROM signal_topic_editorial_executions e JOIN signal_processing_admissions a ON a.id=e.processing_admission_id
      JOIN signal_topic_consolidation_runs run ON run.id=e.numeric_run_id AND run.workspace_id=e.workspace_id
      JOIN signal_topic_editorial_batch_owners_v2 o ON o.execution_id=e.id AND o.workspace_id=e.workspace_id
      LEFT JOIN signal_topic_editorial_global_continuations_v2 grant_row ON grant_row.execution_id=e.id
      WHERE e.id=$1::uuid AND e.workspace_id=$2::uuid AND e.actor_user_id=$3::uuid`,
    [args.execution_id,args.workspace_id,args.actor_user_id])).rows[0];
    if(!execution||execution.stage!=='review_pending')throw new Error('topic_editorial_global_stage_owner_invalid');
    await client.query('SELECT signal_processing_lock_v1($1::uuid,$2::date)',[execution.organization_id,execution.budget_date]);
    await client.query('SELECT signal_brand_context_processing_lock_actor_v1($1::uuid,$2::uuid)',[args.workspace_id,args.actor_user_id]);
    execution=(await client.query<{organization_id:string;processing_admission_id:string;budget_date:string;budget_timezone:string;
      policy_version_id:string;hard_cap_micro_usd:string;stage:string;send_not_after:string;expected_group_count:number}>(`SELECT e.organization_id,e.processing_admission_id,
        CASE WHEN grant_row.execution_id IS NULL THEN a.budget_date ELSE (clock_timestamp() AT TIME ZONE a.budget_timezone)::date END budget_date,
        a.budget_timezone,a.policy_version_id,
        e.hard_cap_micro_usd::text,o.stage,o.send_not_after::text,run.expected_group_count
      FROM signal_topic_editorial_executions e JOIN signal_processing_admissions a ON a.id=e.processing_admission_id
      JOIN signal_topic_consolidation_runs run ON run.id=e.numeric_run_id AND run.workspace_id=e.workspace_id
      JOIN signal_topic_editorial_batch_owners_v2 o ON o.execution_id=e.id AND o.workspace_id=e.workspace_id
      LEFT JOIN signal_topic_editorial_global_continuations_v2 grant_row ON grant_row.execution_id=e.id
      WHERE e.id=$1::uuid AND e.workspace_id=$2::uuid AND e.actor_user_id=$3::uuid FOR UPDATE OF e,o`,
      [args.execution_id,args.workspace_id,args.actor_user_id])).rows[0];
    if(!execution||execution.stage!=='review_pending')throw new Error('topic_editorial_global_stage_owner_invalid');
    const sourceCoverage=(await client.query<{expected:number;groups:number;ready:number}>(`SELECT run.expected_group_count expected,
      count(DISTINCT r.id)::int groups,
      count(DISTINCT r.id) FILTER(WHERE (reused.decision IS NOT NULL AND item.accepted IS NULL)
        OR (reused.decision IS NULL AND item.accepted IS NOT NULL AND item.settled))::int ready
      FROM signal_topic_editorial_executions e JOIN signal_topic_consolidation_runs run ON run.id=e.numeric_run_id
      LEFT JOIN signal_topic_editorial_requests r ON r.execution_id=e.id
      LEFT JOIN signal_topic_editorial_reused_decisions_v2 reused ON reused.request_id=r.id
      LEFT JOIN LATERAL(SELECT i.validation->'decision' accepted,c.status='settled' settled FROM signal_topic_editorial_batch_items_v2 i
        JOIN signal_topic_editorial_calls c ON c.id=i.call_id WHERE i.request_id=r.id AND i.validation->>'status'='accepted'
        ORDER BY i.validated_at DESC,i.batch_id DESC LIMIT 1)item ON true WHERE e.id=$1::uuid GROUP BY run.expected_group_count`,[args.execution_id])).rows[0];
    if(!sourceCoverage||sourceCoverage.expected!==execution.expected_group_count||sourceCoverage.groups!==sourceCoverage.expected
      ||sourceCoverage.ready!==sourceCoverage.expected)throw new Error('topic_editorial_global_stage_screening_incomplete');
    const stage=(await client.query<{stage_id:string}>(`INSERT INTO signal_topic_editorial_global_stages_v2(stage_id,workspace_id,organization_id,
        execution_id,processing_admission_id,snapshot_digest,screening_review_digest,expected_group_count)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8)
      ON CONFLICT(stage_id) DO NOTHING
      RETURNING stage_id::text`,[args.stage_id,args.workspace_id,execution.organization_id,args.execution_id,execution.processing_admission_id,
        args.snapshot_digest,args.screening_review_digest,execution.expected_group_count])).rows[0];
    if(stage?.stage_id!==args.stage_id){const replay=(await client.query<{stage_id:string}>(`SELECT stage_id::text FROM signal_topic_editorial_global_stages_v2
      WHERE stage_id=$1::uuid AND execution_id=$2::uuid AND snapshot_digest=$3 AND screening_review_digest=$4 FOR UPDATE`,
      [args.stage_id,args.execution_id,args.snapshot_digest,args.screening_review_digest])).rows[0];
      if(replay?.stage_id!==args.stage_id)throw new Error('topic_editorial_global_stage_identity_conflict');}
    let reserved=0n;
    const requestRows=[] as Array<{request_id:string;call_id:string;item:SignalTopicEditorialGlobalStageItemV2;stage_identity:string;request_digest:string;request_body:string;input_body:string;input_digest:string;max_tokens:number}>;
    for(const [index,item] of args.items.entries()){
      const body=item.stage_kind==='shard'?item.shard.request_body:item.review.request_body;
      const inputBody=item.stage_kind==='shard'?item.shard.input_body:item.review.input_body;
      const inputDigest=item.stage_kind==='shard'?item.shard.input_digest:item.review.input_digest;
      const requestDigest=item.stage_kind==='shard'?item.shard.request_digest:item.review.request_digest;
      const round=item.stage_kind==='shard'||item.stage_kind==='rank'?0:item.review.round;
      const batchIndex=item.stage_kind==='shard'?item.shard.batch_index:item.stage_kind==='rank'?0:item.review.batch_index;
      const batchCount=item.stage_kind==='shard'?item.shard.batch_count:item.stage_kind==='rank'?1:item.review.batch_count;
      if(typeof body!=='string'||!body||typeof requestDigest!=='string'||!requestDigest)throw new Error('topic_editorial_global_stage_request_invalid');
      const params=JSON.parse(body) as {model?:unknown;max_tokens?:unknown};
      if(params.model!=='claude-sonnet-4-6'||!Number.isSafeInteger(params.max_tokens)||Number(params.max_tokens)<=0
        ||stable(params)!==stable(item.provider_request.params))throw new Error('topic_editorial_global_stage_request_invalid');
      const stageIdentity=identity(item);
      const contractBody=stable(item.stage_kind==='shard'?item.shard:item.review);
      const prior=(await client.query<{id:string;request_body:string;input_body:string;stage_contract_body:string;custom_id:string;call_identity:string}>(`SELECT id::text,request_body,input_body,stage_contract_body,custom_id,call_identity
        FROM signal_topic_editorial_global_stage_requests_v2 WHERE stage_id=$1::uuid AND stage_kind=$2 AND round=$3
          AND batch_index=$4 AND input_digest=$5 AND request_digest=$6 FOR UPDATE`,
        [args.stage_id,item.stage_kind,round,batchIndex,inputDigest,requestDigest])).rows[0];
      let requestId:string;
      if(prior){if(prior.request_body!==body||prior.input_body!==inputBody||prior.stage_contract_body!==contractBody
          ||prior.custom_id!==item.provider_request.custom_id||prior.call_identity!==item.call_id)
          throw new Error('topic_editorial_global_stage_replay_conflict');requestId=prior.id;}
      else{
        const inserted=(await client.query<{id:string}>(`INSERT INTO signal_topic_editorial_global_stage_requests_v2(stage_id,stage_kind,round,batch_index,
            batch_count,input_digest,request_digest,stage_identity,input_body,request_body,stage_contract_body,custom_id,call_identity,model,max_tokens)
          VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id::text`,
          [args.stage_id,item.stage_kind,round,batchIndex,batchCount,inputDigest,requestDigest,stageIdentity,inputBody,body,contractBody,
            item.provider_request.custom_id,item.call_id,params.model,params.max_tokens])).rows[0];
        if(!inserted)throw new Error('topic_editorial_global_stage_store_invalid');requestId=inserted.id;
      }
      const requestRowsExisting=(await client.query<{id:string;status:string;reserved_micro_usd:string}>(`SELECT c.id::text,c.status,c.reserved_micro_usd::text
        FROM signal_topic_editorial_global_stage_calls_v2 c JOIN signal_topic_editorial_global_stage_requests_v2 r ON r.id=c.request_id
        WHERE c.request_id=$1::uuid AND r.call_identity=$2 ORDER BY c.reserved_at LIMIT 1`,[requestId,item.call_id])).rows[0];
      if(!requestRowsExisting){
        const reserve=signalTopicEditorialGlobalStageReservationMicroUsdV2(body,Number(params.max_tokens));
        const call=(await client.query<{id:string}>(`INSERT INTO signal_topic_editorial_global_stage_calls_v2(stage_id,request_id,workspace_id,organization_id,
            execution_id,reserved_micro_usd,budget_date,budget_timezone)
          VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::bigint,$7::date,$8) RETURNING id::text`,
          [args.stage_id,requestId,args.workspace_id,execution.organization_id,args.execution_id,reserve.toString(),execution.budget_date,execution.budget_timezone])).rows[0];
        if(!call)throw new Error('topic_editorial_global_stage_store_invalid');reserved+=reserve;
        requestRows.push({request_id:requestId,call_id:call.id,item,stage_identity:stageIdentity,request_digest:requestDigest,request_body:body,input_body:inputBody,
          input_digest:inputDigest,max_tokens:Number(params.max_tokens)});
      }else{
        requestRows.push({request_id:requestId,call_id:requestRowsExisting.id,item,stage_identity:stageIdentity,request_digest:requestDigest,request_body:body,input_body:inputBody,
          input_digest:inputDigest,max_tokens:Number(params.max_tokens)});
      }
    }
    const batchPrior=(await client.query<{id:string;manifest_digest:string}>(`SELECT id::text,manifest_digest FROM signal_topic_editorial_global_stage_batches_v2
      WHERE stage_id=$1::uuid AND manifest_digest=$2`,[args.stage_id,manifestDigest])).rows[0];
    let batchId=batchPrior?.id;
    if(batchPrior&&batchPrior.manifest_digest!==manifestDigest)throw new Error('topic_editorial_global_stage_manifest_conflict');
    if(!batchId){
      batchId=(await client.query<{id:string}>(`INSERT INTO signal_topic_editorial_global_stage_batches_v2(stage_id,stage_kind,manifest_body,manifest_digest)
        VALUES($1::uuid,$2,$3,$4) RETURNING id::text`,[args.stage_id,args.stage_kind,manifest,manifestDigest])).rows[0]?.id;
      if(!batchId)throw new Error('topic_editorial_global_stage_store_invalid');
      for(const row of requestRows)await client.query(`INSERT INTO signal_topic_editorial_global_stage_batch_items_v2(batch_id,stage_id,request_id,call_id,custom_id,call_identity)
        VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6)`,[batchId,args.stage_id,row.request_id,row.call_id,row.item.provider_request.custom_id,row.item.call_id]);
    }
    return {stage_id:args.stage_id,execution_id:args.execution_id,request_count:requestRows.length,batch_id:batchId,manifest_digest:manifestDigest,
      reserved_micro_usd:reserved.toString(),replayed:Boolean(batchPrior)};
  });
}

/** Strict source loader for the staged sequencer. Unlike the legacy monolithic
 * review loader, it never serializes every group's evidence into one provider
 * request body. */
export async function loadSignalTopicEditorialGlobalUnitsV2(args:{database:SignalTopicEditorialGlobalStageDatabaseV2;
  workspace_id:string;actor_user_id:string;execution_id:string}):Promise<{numeric_run_id:string;expected_group_count:number;units:SignalTopicEditorialGlobalUnitV2[]}> {
  const client=await args.database.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query('SET LOCAL search_path=public,extensions,pg_temp');
    const owner=(await client.query<{numeric_run_id:string;expected:number;stage:string;contract_version:string}>(`SELECT e.numeric_run_id::text,
      jsonb_array_length(e.plan->'requests') expected,o.stage,e.plan->>'contract_version' contract_version
      FROM signal_topic_editorial_executions e JOIN signal_topic_editorial_batch_owners_v2 o ON o.execution_id=e.id AND o.workspace_id=e.workspace_id
      WHERE e.id=$1::uuid AND e.workspace_id=$2::uuid AND e.actor_user_id=$3::uuid`,[args.execution_id,args.workspace_id,args.actor_user_id])).rows[0];
    if(!owner||owner.contract_version!=='signal-topic-editorial-admission-header-v3'||owner.stage!=='review_pending'||owner.expected<1)
      throw new Error('topic_editorial_global_not_ready');
    const units:SignalTopicEditorialGlobalUnitV2[]=[];
    for(let offset=0;offset<owner.expected;offset+=128){
      const rows=(await client.query<{request:SignalTopicEditorialGlobalUnitV2['request'];reused:SignalTopicEditorialGlobalUnitV2['decision'];
        accepted:SignalTopicEditorialGlobalUnitV2['decision'];settled:boolean}>(`SELECT r.receipts->'request' request,reused.decision reused,
        item.validation->'decision' accepted,item.settled FROM signal_topic_editorial_requests r
        LEFT JOIN signal_topic_editorial_reused_decisions_v2 reused ON reused.request_id=r.id
        LEFT JOIN LATERAL(SELECT entry.validation,c.status='settled' settled FROM signal_topic_editorial_batch_items_v2 entry
          JOIN signal_topic_editorial_calls c ON c.id=entry.call_id WHERE entry.request_id=r.id AND entry.validation->>'status'='accepted'
          AND c.status='settled' ORDER BY entry.validated_at DESC,entry.batch_id DESC LIMIT 1)item ON true
        WHERE r.execution_id=$1::uuid ORDER BY r.batch_index LIMIT $2 OFFSET $3`,[args.execution_id,128,offset])).rows;
      if(!rows.length)throw new Error('topic_editorial_global_coverage_incomplete');
      for(const row of rows){if(Boolean(row.reused)===Boolean(row.accepted)||row.accepted&&!row.settled)
        throw new Error('topic_editorial_global_decision_missing');
        units.push({request:row.request,decision:row.reused??row.accepted,technical_error_code:null});}
    }
    if(units.length!==owner.expected)throw new Error('topic_editorial_global_coverage_incomplete');
    await client.query('COMMIT');return {numeric_run_id:owner.numeric_run_id,expected_group_count:owner.expected,units};
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
}

/** Persist the exact full-census group citation sidecar before revision
 * materialization; a later retry must match its digest and bytes. */
export async function persistSignalTopicEditorialGlobalStageCatalogV2(args:{database:SignalTopicEditorialGlobalStageDatabaseV2;
  stage_id:string;catalog_digest:string;catalog_body:unknown;group_evidence:unknown[]}):Promise<{replayed:boolean}>{
  const body=stable(args.catalog_body),evidence=stable(args.group_evidence);
  if(!/^sha256:[0-9a-f]{64}$/u.test(args.catalog_digest)||sha(body)!==args.catalog_digest||!Array.isArray(args.group_evidence))
    throw new Error('topic_editorial_global_catalog_digest_invalid');
  return tx(args.database,async client=>{
    const stage=(await client.query<{expected_group_count:number}>(`SELECT expected_group_count FROM signal_topic_editorial_global_stages_v2
      WHERE stage_id=$1::uuid`,[args.stage_id])).rows[0];
    if(!stage||stage.expected_group_count!==args.group_evidence.length)throw new Error('topic_editorial_global_catalog_coverage_invalid');
    const source=(await client.query<{matching:number;distinct_count:number}>(`SELECT
      count(*) FILTER(WHERE EXISTS(SELECT 1 FROM signal_topic_atomic_groups g WHERE g.consolidation_run_id=e.numeric_run_id AND g.group_key=entry.value->>'group_key'))::int matching,
      count(DISTINCT entry.value->>'group_key')::int distinct_count
      FROM signal_topic_editorial_global_stages_v2 s JOIN signal_topic_editorial_executions e ON e.id=s.execution_id
      CROSS JOIN jsonb_array_elements($2::jsonb) AS entry(value) WHERE s.stage_id=$1::uuid`,[args.stage_id,evidence])).rows[0];
    const total=(await client.query<{total:number}>(`SELECT count(*)::int total FROM signal_topic_atomic_groups g
      JOIN signal_topic_editorial_executions e ON e.numeric_run_id=g.consolidation_run_id
      JOIN signal_topic_editorial_global_stages_v2 s ON s.execution_id=e.id
      WHERE s.stage_id=$1::uuid`,[args.stage_id])).rows[0]?.total;
    if(!source||source.matching!==stage.expected_group_count||source.distinct_count!==stage.expected_group_count||total!==stage.expected_group_count)
      throw new Error('topic_editorial_global_catalog_source_mismatch');
    const prior=(await client.query<{catalog_digest:string;catalog_body:unknown;group_evidence:unknown}>(`SELECT catalog_digest,catalog_body,group_evidence
      FROM signal_topic_editorial_global_stage_catalog_v2 WHERE stage_id=$1::uuid FOR UPDATE`,[args.stage_id])).rows[0];
    if(prior){if(prior.catalog_digest!==args.catalog_digest||stable(prior.catalog_body)!==body||stable(prior.group_evidence)!==evidence)
      throw new Error('topic_editorial_global_catalog_replay_conflict');return {replayed:true};}
    await client.query(`INSERT INTO signal_topic_editorial_global_stage_catalog_v2(stage_id,catalog_digest,catalog_body,group_evidence)
      VALUES($1::uuid,$2,$3::jsonb,$4::jsonb)`,[args.stage_id,args.catalog_digest,body,evidence]);
    return {replayed:false};
  });
}

export type SignalTopicEditorialGlobalStageProgressV2={stage_id:string;execution_id:string;workspace_id:string;actor_user_id:string;
  snapshot_digest:string;screening_review_digest:string;expected_group_count:number;requests:Array<{
    stage_kind:'shard'|'merge'|'rank';round:number;batch_index:number;descriptor:unknown;input_body:string;request_body:string;
    validation:SignalTopicEditorialGlobalStageValidationV2|null;raw_sha256:string|null;call_status:string|null;batch_state:string|null;error_code:string|null;
    retryable_receipt_error:boolean;
  }>;};

/** Read accepted, sealed requests and receipts in one MVCC snapshot. This is the
 * sequencer input; it deliberately returns technical failures as failures. */
export async function loadSignalTopicEditorialGlobalStageProgressV2(args:{database:SignalTopicEditorialGlobalStageDatabaseV2;stage_id:string}){
  const client=await args.database.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query('SET LOCAL search_path=public,extensions,pg_temp');
    const stage=(await client.query<{stage_id:string;execution_id:string;workspace_id:string;actor_user_id:string;snapshot_digest:string;
      screening_review_digest:string;expected_group_count:number;send_not_after:string;admission_not_after:string;policy_status:string;policy_valid_until:string}>(`SELECT s.stage_id::text,s.execution_id::text,s.workspace_id::text,e.actor_user_id::text,
      s.snapshot_digest,s.screening_review_digest,s.expected_group_count,
      CASE WHEN grant_row.execution_id IS NULL THEN o.send_not_after ELSE p.valid_until END::text send_not_after,
      CASE WHEN grant_row.execution_id IS NULL THEN a.admission_not_after ELSE p.valid_until END::text admission_not_after,
      p.status policy_status,p.valid_until::text policy_valid_until
      FROM signal_topic_editorial_global_stages_v2 s JOIN signal_topic_editorial_executions e ON e.id=s.execution_id
      JOIN signal_topic_editorial_batch_owners_v2 o ON o.execution_id=e.id AND o.workspace_id=e.workspace_id
      JOIN signal_processing_admissions a ON a.id=e.processing_admission_id JOIN signal_processing_policy_versions p ON p.id=a.policy_version_id
      LEFT JOIN signal_topic_editorial_global_continuations_v2 grant_row ON grant_row.execution_id=e.id
      WHERE s.stage_id=$1::uuid`,[args.stage_id])).rows[0];
    if(!stage)throw new Error('topic_editorial_global_stage_missing');
    const rows=(await client.query<{stage_kind:'shard'|'merge'|'rank';round:number;batch_index:number;stage_contract_body:string;
      input_body:string;request_body:string;validation:unknown;raw_sha256:string|null;call_status:string|null;batch_state:string|null;
      error_code:string|null;retryable_receipt_error:boolean}>(`SELECT r.stage_kind,r.round,r.batch_index,r.stage_contract_body,r.input_body,r.request_body,
        COALESCE(r.validation,attempt.validation) validation,
        attempt.raw_sha256,attempt.call_status,attempt.batch_state,attempt.error_code,
        COALESCE(r.validation IS NULL AND attempt.call_status='settled' AND (
          (attempt.settled_micro_usd=0 AND attempt.observed_micro_usd=0
            AND attempt.outcome='errored' AND attempt.validation->>'status'='provider_error'
            AND attempt.grammar_message LIKE 'Grammar compilation rate limit exceeded%')
          OR (attempt.outcome='succeeded' AND attempt.validation->>'status'='invalid_output'
            AND attempt.validation->>'code'='topic_editorial_global_shard_citation_invalid'))
          AND attempt.attempt_count<5 AND clock_timestamp()<least($2::timestamptz,$3::timestamptz,$4::timestamptz)
          AND $5='active',false) retryable_receipt_error
      FROM signal_topic_editorial_global_stage_requests_v2 r
      LEFT JOIN LATERAL (SELECT c.status call_status,c.error_code,c.settled_micro_usd,c.observed_micro_usd,b.state batch_state,i.validation,i.raw_sha256,
        i.outcome,c.response_body_private::jsonb->'result'->'error'->'error'->>'message' grammar_message,
        (SELECT count(*)::int FROM signal_topic_editorial_global_stage_calls_v2 tries WHERE tries.request_id=r.id) attempt_count
        FROM signal_topic_editorial_global_stage_batch_items_v2 i
        JOIN signal_topic_editorial_global_stage_calls_v2 c ON c.id=i.call_id JOIN signal_topic_editorial_global_stage_batches_v2 b ON b.id=i.batch_id
        WHERE i.request_id=r.id ORDER BY b.created_at DESC LIMIT 1) attempt ON true WHERE r.stage_id=$1::uuid
      ORDER BY r.stage_kind,r.round,r.batch_index`,[args.stage_id,stage.send_not_after,stage.admission_not_after,stage.policy_valid_until,stage.policy_status])).rows;
    await client.query('COMMIT');
    return {...stage,requests:rows.map(row=>({...row,descriptor:JSON.parse(row.stage_contract_body) as unknown,
      validation:row.validation===null?null:typeof row.validation==='string'?JSON.parse(row.validation) as SignalTopicEditorialGlobalStageValidationV2:
        row.validation as SignalTopicEditorialGlobalStageValidationV2,retryable_receipt_error:row.retryable_receipt_error}))} satisfies SignalTopicEditorialGlobalStageProgressV2;
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
}

/** Resolve only structurally recoverable paid shard or merge output. The
 * original Batch item stays immutable; the request's previously unused
 * validation slot records the exact raw receipt and structural changes. */
export async function recoverSignalTopicEditorialGlobalShardFormattingV2(args:{database:SignalTopicEditorialGlobalStageDatabaseV2}){
  return tx(args.database,async client=>{
    const stage=(await client.query<{stage_id:string}>(`SELECT s.stage_id::text FROM signal_topic_editorial_global_stages_v2 s
      WHERE s.state='blocked' AND EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_requests_v2 r
        JOIN signal_topic_editorial_global_stage_batch_items_v2 i ON i.request_id=r.id
        WHERE r.stage_id=s.stage_id AND r.validation IS NULL
          AND i.validation->>'code' IN('topic_editorial_global_shard_citation_invalid','topic_editorial_global_shard_coverage_invalid',
            'topic_editorial_global_merge_member_invalid','topic_editorial_global_ranking_output_invalid',
            'topic_editorial_global_ranking_coverage_invalid'))
        AND NOT EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_calls_v2 c WHERE c.stage_id=s.stage_id
          AND c.status NOT IN('settled','definitely_not_sent'))
        AND NOT EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_batches_v2 b WHERE b.stage_id=s.stage_id
          AND b.state<>'imported')
      ORDER BY s.created_at LIMIT 1 FOR UPDATE OF s`)).rows[0];
    if(!stage)return {recovered:false,reason:'no_blocked_shard'};
    const rows=(await client.query<{request_id:string;stage_kind:string;state:string;stage_contract_body:string;validation:unknown;
      raw_text:string|null;raw_sha256:string|null;latest_validation:unknown;prior_validation_sha256:string|null;batch_id:string|null;call_id:string|null;
      call_status:string|null;batch_state:string|null}>(`SELECT r.id::text request_id,r.stage_kind,r.state,r.stage_contract_body,r.validation,
      latest.raw_text,latest.raw_sha256,latest.validation latest_validation,latest.validation_sha256 prior_validation_sha256,
      latest.batch_id::text,latest.call_id::text,latest.call_status,latest.batch_state
      FROM signal_topic_editorial_global_stage_requests_v2 r
      LEFT JOIN LATERAL(SELECT i.raw_text,i.raw_sha256,i.validation,i.validation_sha256,i.batch_id,i.call_id,
        c.status call_status,b.state batch_state
        FROM signal_topic_editorial_global_stage_batch_items_v2 i
        JOIN signal_topic_editorial_global_stage_batches_v2 b ON b.id=i.batch_id
        JOIN signal_topic_editorial_global_stage_calls_v2 c ON c.id=i.call_id
        WHERE i.request_id=r.id ORDER BY b.created_at DESC LIMIT 1)latest ON true
      WHERE r.stage_id=$1::uuid ORDER BY r.stage_kind,r.round,r.batch_index`,[stage.stage_id])).rows;
    const corrections:Array<{request_id:string;raw_text:string;validation:unknown;removed:number;merged:number;replaced:number;deduplicated:number}>=[];
    for(const row of rows){
      const prior=row.validation as {status?:string}|null,latest=row.latest_validation as {status?:string}|null;
      const acceptedStatus=row.stage_kind==='shard'?'accepted_shard':row.stage_kind==='merge'?'accepted_merge':'accepted_rank';
      if(prior?.status===acceptedStatus||latest?.status===acceptedStatus)continue;
      if(!['shard','merge','rank'].includes(row.stage_kind)||row.call_status!=='settled'||row.batch_state!=='imported'
        ||row.state!=='submitted'||!row.raw_text||row.raw_sha256!==sha(row.raw_text)
        ||!row.prior_validation_sha256||!row.batch_id||!row.call_id)return {recovered:false,reason:'source_unavailable'};
      let response:unknown;
      try{const envelope=JSON.parse(row.raw_text) as {result?:{message?:{content?:Array<{type?:string;text?:string}>}}};
        const content=envelope.result?.message?.content?.filter(item=>item.type==='text');
        if(content?.length!==1||typeof content[0]?.text!=='string')return {recovered:false,reason:'raw_response_invalid'};
        response=JSON.parse(content[0].text);}
      catch{return {recovered:false,reason:'raw_response_invalid'};}
      if(row.stage_kind==='shard'){
        const shard=JSON.parse(row.stage_contract_body) as Parameters<typeof repairSignalTopicEditorialGlobalShardFormattingV2>[0]['shard'];
        const fixed=repairSignalTopicEditorialGlobalShardFormattingV2({shard,value:response});
        if(!fixed)return {recovered:false,reason:'format_not_repairable'};
        corrections.push({request_id:row.request_id,raw_text:row.raw_text,removed:fixed.removed_invalid_citations,
          merged:fixed.merged_noise_duplicates,replaced:0,deduplicated:0,validation:{status:'accepted_shard',result:fixed.result,
            structural_repair:{kind:'citation_surplus_or_duplicate_noise',source_batch_id:row.batch_id,source_call_id:row.call_id,
              prior_validation_sha256:row.prior_validation_sha256,removed_invalid_citations:fixed.removed_invalid_citations,
              merged_noise_duplicates:fixed.merged_noise_duplicates}}});
      }else if(row.stage_kind==='merge'){
        if((latest as {code?:string}|null)?.code!=='topic_editorial_global_merge_member_invalid')
          return {recovered:false,reason:'merge_validation_code_mismatch'};
        const review=JSON.parse(row.stage_contract_body) as Parameters<typeof repairSignalTopicEditorialGlobalMergeMemberKeysV2>[0]['review'];
        const fixed=repairSignalTopicEditorialGlobalMergeMemberKeysV2({review,value:response});
        if(!fixed)return {recovered:false,reason:'merge_keys_not_repairable'};
        corrections.push({request_id:row.request_id,raw_text:row.raw_text,removed:0,merged:0,
          replaced:fixed.replaced_child_keys,deduplicated:fixed.deduplicated_parent_keys,
          validation:{status:'accepted_merge',result:fixed.result,
            structural_repair:{kind:'complete_child_lineage_alias',source_batch_id:row.batch_id,source_call_id:row.call_id,
              prior_validation_sha256:row.prior_validation_sha256,replaced_child_keys:fixed.replaced_child_keys,
              deduplicated_parent_keys:fixed.deduplicated_parent_keys}}});
      }else{
        if(!['topic_editorial_global_ranking_output_invalid','topic_editorial_global_ranking_coverage_invalid']
          .includes((latest as {code?:string}|null)?.code??''))
          return {recovered:false,reason:'rank_validation_code_mismatch'};
        const review=JSON.parse(row.stage_contract_body) as Parameters<typeof repairSignalTopicEditorialGlobalRankingKeyV2>[0]['review'];
        const fixed=repairSignalTopicEditorialGlobalRankingKeyV2({review,value:response});
        if(!fixed)return {recovered:false,reason:'rank_key_not_repairable'};
        corrections.push({request_id:row.request_id,raw_text:row.raw_text,removed:0,merged:0,
          replaced:fixed.replaced_kind_prefixes,deduplicated:0,
          validation:{status:'accepted_rank',result:fixed.result,
            structural_repair:{kind:'exact_kind_prefix_alias',source_batch_id:row.batch_id,source_call_id:row.call_id,
              prior_validation_sha256:row.prior_validation_sha256,replaced_kind_prefixes:fixed.replaced_kind_prefixes}}});
      }
    }
    if(!corrections.length)return {recovered:false,reason:'no_corrections'};
    for(const row of corrections){
      await client.query(`UPDATE signal_topic_editorial_global_stage_requests_v2
        SET state='received',raw_text=$2,raw_sha256=$3,received_at=clock_timestamp()
        WHERE id=$1::uuid AND state='submitted' AND raw_text IS NULL`,[row.request_id,row.raw_text,sha(row.raw_text)]);
      const validation=stable(row.validation);
      await client.query(`UPDATE signal_topic_editorial_global_stage_requests_v2
        SET state='validated',validation=$2::jsonb,
          validation_sha256=signal_topic_editorial_global_validation_digest_v2($2::jsonb),validated_at=clock_timestamp()
        WHERE id=$1::uuid AND state='received' AND validation IS NULL`,[row.request_id,validation]);
    }
    const reopened=(await client.query<{stage_id:string}>(`UPDATE signal_topic_editorial_global_stages_v2
      SET state='open',completed_at=NULL WHERE stage_id=$1::uuid AND state='blocked' RETURNING stage_id::text`,[stage.stage_id])).rows[0];
    if(!reopened)throw new Error('topic_editorial_global_stage_recovery_conflict');
    return {recovered:true,stage_id:stage.stage_id,corrected_requests:corrections.length,
      removed_invalid_citations:corrections.reduce((n,row)=>n+row.removed,0),
      merged_noise_duplicates:corrections.reduce((n,row)=>n+row.merged,0),
      replaced_child_keys:corrections.reduce((n,row)=>n+row.replaced,0),
      deduplicated_parent_keys:corrections.reduce((n,row)=>n+row.deduplicated,0)};
  });
}

function decodeLeaseRow(row:{id:string;stage_id:string;stage_kind:'shard'|'merge'|'rank';state:SignalTopicEditorialGlobalStageLeaseV2['state'];
  provider_batch_id:string|null;lease_token:string;manifest_digest:string;custom_id:string;call_identity:string;stage_contract_body:string;
  request_body:string;raw_sha256:string|null;validation:unknown}){
  const descriptor=JSON.parse(row.stage_contract_body) as Record<string,unknown>;
  const base={stage_id:row.stage_id,stage_kind:row.stage_kind,call_id:row.call_identity,provider_request:{custom_id:row.custom_id,
    params:JSON.parse(row.request_body) as Record<string,unknown>},raw_sha256:row.raw_sha256,
    validation:row.validation===null?null:typeof row.validation==='string'?JSON.parse(row.validation) as SignalTopicEditorialGlobalStageValidationV2:
      row.validation as SignalTopicEditorialGlobalStageValidationV2};
  return row.stage_kind==='shard'?{...base,shard:descriptor}: {...base,review:descriptor};
}

/** Worker adapter for one already-prepared stage Batch. Every state transition
 * is fenced by its DB lease and exact persisted manifest. */
export function createSignalTopicEditorialGlobalStageRuntimeStoresV2(args:{database:SignalTopicEditorialGlobalStageDatabaseV2;batch_id:string}):SignalTopicEditorialGlobalStageStoresV2{
  const db=args.database;
  const withBatch=async<T>(lease:SignalTopicEditorialGlobalStageLeaseV2,work:(client:PoolClient,batch:{id:string;stage_id:string;state:string;lease_token:string;manifest_digest:string;provider_batch_id:string|null})=>Promise<T>,lockCallOwner=true)=>
    tx(db,async client=>{
      let executionId:string|undefined;
      if(lockCallOwner){
        // Match the call trigger and stage preparation lock order before taking
        // the Batch row lock. A Worker that locks Batch first can deadlock with
        // preparation: preparation owns org/day + actor + execution and may need
        // the same durable stage while the call trigger waits on execution.
        const scope=(await client.query<{execution_id:string;workspace_id:string;actor_user_id:string;organization_id:string;budget_date:string}>(`
          SELECT e.id::text execution_id,e.workspace_id::text,e.actor_user_id::text,e.organization_id::text,
            CASE WHEN grant_row.execution_id IS NULL THEN a.budget_date ELSE (clock_timestamp() AT TIME ZONE a.budget_timezone)::date END::text budget_date
          FROM signal_topic_editorial_global_stage_batches_v2 b
          JOIN signal_topic_editorial_global_stages_v2 s ON s.stage_id=b.stage_id
          JOIN signal_topic_editorial_executions e ON e.id=s.execution_id
          JOIN signal_processing_admissions a ON a.id=e.processing_admission_id
          LEFT JOIN signal_topic_editorial_global_continuations_v2 grant_row ON grant_row.execution_id=e.id
          WHERE b.id=$1::uuid`,[args.batch_id])).rows[0];
        if(!scope)throw new Error('topic_editorial_global_stage_lease_lost');
        await client.query('SELECT signal_processing_lock_v1($1::uuid,$2::date)',[scope.organization_id,scope.budget_date]);
        await client.query('SELECT signal_brand_context_processing_lock_actor_v1($1::uuid,$2::uuid)',[scope.workspace_id,scope.actor_user_id]);
        const owner=(await client.query<{id:string}>(`SELECT e.id::text FROM signal_topic_editorial_executions e
          JOIN signal_topic_editorial_batch_owners_v2 o ON o.execution_id=e.id AND o.workspace_id=e.workspace_id
          WHERE e.id=$1::uuid AND e.workspace_id=$2::uuid AND e.actor_user_id=$3::uuid AND e.organization_id=$4::uuid
          FOR UPDATE OF e,o`,[scope.execution_id,scope.workspace_id,scope.actor_user_id,scope.organization_id])).rows[0];
        if(owner?.id!==scope.execution_id)throw new Error('topic_editorial_global_stage_owner_invalid');
        executionId=scope.execution_id;
      }
      const batch=(await client.query<{id:string;stage_id:string;state:string;lease_token:string;manifest_digest:string;provider_batch_id:string|null}>(
        `SELECT b.id::text,b.stage_id::text,b.state,b.lease_token::text,b.manifest_digest,b.provider_batch_id
         FROM signal_topic_editorial_global_stage_batches_v2 b
         JOIN signal_topic_editorial_global_stages_v2 s ON s.stage_id=b.stage_id
         WHERE b.id=$1::uuid AND ($2::uuid IS NULL OR s.execution_id=$2::uuid) FOR UPDATE OF b`,[args.batch_id,executionId??null])).rows[0];
      if(!batch||batch.manifest_digest!==lease.manifest_digest||batch.lease_token!==lease.lease_token
        ||batch.stage_id!==lease.items[0]?.stage_id)throw new Error('topic_editorial_global_stage_lease_lost');
      return work(client,batch);
    });
  return {
    async claimDue(){return tx(db,async client=>{
      const picked=(await client.query<{id:string;stage_id:string;state:SignalTopicEditorialGlobalStageLeaseV2['state'];provider_batch_id:string|null;
        lease_token:string;manifest_digest:string;stage_kind:'shard'|'merge'|'rank'}>(`SELECT id::text,stage_id::text,state,provider_batch_id,manifest_digest,stage_kind
        FROM signal_topic_editorial_global_stage_batches_v2 WHERE id=$1::uuid AND state IN('prepared','submitting','submission_unknown','in_progress','canceling','ended')
          AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp()) AND (next_poll_at IS NULL OR next_poll_at<=clock_timestamp())
        FOR UPDATE SKIP LOCKED`,[args.batch_id])).rows[0];
      if(!picked)return null;
      const token=(await client.query<{token:string}>(`UPDATE signal_topic_editorial_global_stage_batches_v2
        SET lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '120 seconds' WHERE id=$1::uuid
        RETURNING lease_token::text token`,[picked.id])).rows[0]?.token;
      if(!token)throw new Error('topic_editorial_global_stage_lease_lost');
      const rows=(await client.query<{id:string;stage_id:string;stage_kind:'shard'|'merge'|'rank';state:SignalTopicEditorialGlobalStageLeaseV2['state'];
        provider_batch_id:string|null;lease_token:string;manifest_digest:string;custom_id:string;call_identity:string;stage_contract_body:string;
        request_body:string;raw_sha256:string|null;validation:unknown}>(`SELECT b.id::text,b.stage_id::text,b.stage_kind,b.state,b.provider_batch_id,b.lease_token::text,b.manifest_digest,
          r.custom_id,i.call_identity,r.stage_contract_body,r.request_body,i.raw_sha256,i.validation
        FROM signal_topic_editorial_global_stage_batches_v2 b JOIN signal_topic_editorial_global_stage_batch_items_v2 i ON i.batch_id=b.id
        JOIN signal_topic_editorial_global_stage_requests_v2 r ON r.id=i.request_id WHERE b.id=$1::uuid ORDER BY r.custom_id`,[picked.id])).rows;
      if(!rows.length)throw new Error('topic_editorial_global_stage_manifest_invalid');
      const first=rows[0]!;
      return {provider_batch_id:first.id,lease_token:token,manifest_digest:first.manifest_digest,stage_kind:first.stage_kind,
        state:first.state,provider_id:first.provider_batch_id,items:rows.map(decodeLeaseRow) as SignalTopicEditorialGlobalStageItemV2[]};
    });},
    async markSubmitting(lease){await withBatch(lease,async client=>{
      const r=await client.query(`UPDATE signal_topic_editorial_global_stage_batches_v2 SET state='submitting',error_code=NULL
        WHERE id=$1::uuid AND state='prepared' RETURNING id`,[args.batch_id]);
      if(!r.rowCount)throw new Error('topic_editorial_global_stage_transition_invalid');
      await client.query(`UPDATE signal_topic_editorial_global_stage_calls_v2 SET status='in_flight'
        WHERE id IN(SELECT call_id FROM signal_topic_editorial_global_stage_batch_items_v2 WHERE batch_id=$1::uuid) AND status='reserved'`,[args.batch_id]);
      await client.query(`UPDATE signal_topic_editorial_global_stage_requests_v2 r SET state='submitted' FROM signal_topic_editorial_global_stage_batch_items_v2 i
        WHERE i.batch_id=$1::uuid AND i.request_id=r.id AND r.state='prepared'`,[args.batch_id]);
    });},
    async attachProviderBatch(lease,state){await withBatch(lease,async client=>{
      const r=await client.query(`UPDATE signal_topic_editorial_global_stage_batches_v2 SET provider_batch_id=$2,state=$3,
        submitted_at=COALESCE(submitted_at,clock_timestamp()),next_poll_at=CASE WHEN $3='ended' THEN NULL ELSE clock_timestamp()+interval '60 seconds' END,
        ended_at=CASE WHEN $3='ended' THEN $4::timestamptz ELSE ended_at END WHERE id=$1::uuid AND state='submitting'
        AND (provider_batch_id IS NULL OR provider_batch_id=$2) RETURNING id`,[args.batch_id,state.id,state.processing_status,state.ended_at]);
      if(!r.rowCount)throw new Error('topic_editorial_global_stage_provider_identity_mismatch');
      await client.query(`UPDATE signal_topic_editorial_global_stage_calls_v2 SET provider_batch_id=$2 WHERE stage_id=$1::uuid
        AND id IN(SELECT call_id FROM signal_topic_editorial_global_stage_batch_items_v2 WHERE batch_id=$3::uuid)`,[lease.items[0]!.stage_id,state.id,args.batch_id]);
    });},
    async markSubmissionUncertain(lease,code){await withBatch(lease,async client=>{
      await client.query(`UPDATE signal_topic_editorial_global_stage_batches_v2 SET state='submission_unknown',error_code=$2,next_poll_at=NULL WHERE id=$1::uuid`,[args.batch_id,code]);
      await client.query(`UPDATE signal_topic_editorial_global_stage_calls_v2 SET status='submission_unknown',error_code=$2 WHERE id IN
        (SELECT call_id FROM signal_topic_editorial_global_stage_batch_items_v2 WHERE batch_id=$1::uuid) AND status='in_flight'`,[args.batch_id,code]);
    });},
    async markSubmissionRejected(lease,code,receipt){await withBatch(lease,async client=>{
      await client.query(`UPDATE signal_topic_editorial_global_stage_batches_v2 SET state='rejected',error_code=$2,next_poll_at=NULL,
        rejection_http_status=$3,provider_receipt_body=$4,provider_receipt_sha256=$5,ended_at=clock_timestamp() WHERE id=$1::uuid`,
        [args.batch_id,code,receipt?.http_status??null,receipt?.raw_body??null,receipt?sha(receipt.raw_body):null]);
      await client.query(`UPDATE signal_topic_editorial_global_stage_batch_items_v2 SET outcome='submission_rejected',received_at=clock_timestamp() WHERE batch_id=$1::uuid`,[args.batch_id]);
      await client.query(`UPDATE signal_topic_editorial_global_stage_calls_v2 SET status='definitely_not_sent',error_code=$2,
        observed_micro_usd=0,settled_micro_usd=0
        WHERE id IN(SELECT call_id FROM signal_topic_editorial_global_stage_batch_items_v2 WHERE batch_id=$1::uuid) AND status='in_flight'`,
        [args.batch_id,code]);
    });},
    async recordPoll(lease,state){await withBatch(lease,async client=>{
      await client.query(`UPDATE signal_topic_editorial_global_stage_batches_v2 SET state=$2,next_poll_at=CASE WHEN $2='ended' THEN NULL ELSE clock_timestamp()+interval '60 seconds' END,
        ended_at=CASE WHEN $2='ended' THEN $3::timestamptz ELSE ended_at END WHERE id=$1::uuid`,[args.batch_id,state.processing_status,state.ended_at]);
    });},
    async persistRawReceipt(lease,receipt){await withBatch(lease,async client=>{
      const item=lease.items.find(x=>x.provider_request.custom_id===receipt.custom_id);
      if(!item||item.call_id!==receipt.call_id||identity(item)!==receipt.stage_identity||sha(receipt.raw_text)!==receipt.raw_sha256)
        throw new Error('topic_editorial_global_stage_receipt_binding_invalid');
      let envelope:Record<string,unknown>;
      try{envelope=JSON.parse(receipt.raw_text) as Record<string,unknown>;}catch{throw new Error('topic_editorial_global_stage_receipt_invalid');}
      if(envelope.custom_id!==receipt.custom_id||!envelope.result||typeof envelope.result!=='object')throw new Error('topic_editorial_global_stage_receipt_binding_invalid');
      const call=(await client.query<{id:string;request_id:string;status:string}>(`SELECT c.id::text,c.request_id::text,c.status FROM signal_topic_editorial_global_stage_calls_v2 c
        JOIN signal_topic_editorial_global_stage_requests_v2 r ON r.id=c.request_id JOIN signal_topic_editorial_global_stage_batch_items_v2 i ON i.call_id=c.id
        WHERE i.batch_id=$1::uuid AND i.custom_id=$2 AND i.call_identity=$3 FOR UPDATE OF c`,[args.batch_id,receipt.custom_id,receipt.call_id])).rows[0];
      if(!call||!['in_flight','submission_unknown','response_persisted'].includes(call.status))throw new Error('topic_editorial_global_stage_call_invalid');
      const req=await client.query(`UPDATE signal_topic_editorial_global_stage_batch_items_v2 SET raw_text=$3,raw_sha256=$4,received_at=clock_timestamp(),outcome=$5
        WHERE batch_id=$1::uuid AND custom_id=$2 AND (raw_text IS NULL OR raw_sha256=$4)`,[args.batch_id,receipt.custom_id,receipt.raw_text,receipt.raw_sha256,
          (envelope.result as Record<string,unknown>).type]);
      const result=envelope.result as Record<string,unknown>;
      const outcome=typeof result.type==='string'?result.type:null;
      if(!['succeeded','errored','canceled','expired'].includes(outcome??''))throw new Error('topic_editorial_global_stage_receipt_invalid');
      if(!req.rowCount)throw new Error('topic_editorial_global_stage_receipt_changed');
      await client.query(`UPDATE signal_topic_editorial_global_stage_calls_v2 SET status='response_persisted',response_body_private=$2,response_sha256=$3,
        response_storage_key=$4,response_http_status=200,response_complete=true,response_provider_request_id=$5,response_at=clock_timestamp(),
        observed_micro_usd=$7::bigint,error_code=CASE WHEN $6='succeeded' THEN NULL ELSE 'provider_'||$6 END
        WHERE id=$1::uuid`,[call.id,receipt.raw_text,receipt.raw_sha256,`global-stage/${args.batch_id}/${receipt.custom_id}/${receipt.raw_sha256}`,lease.provider_id,outcome,
          observedBatchMicroUsd(envelope)]);
    });},
    async recordValidation(lease,args2){await withBatch(lease,async client=>{
      const item=lease.items.find(x=>x.provider_request.custom_id===args2.custom_id);
      if(!item)throw new Error('topic_editorial_global_stage_validation_binding_invalid');
      const result=await client.query(`UPDATE signal_topic_editorial_global_stage_batch_items_v2 SET validation=$4::jsonb,
        validation_sha256=signal_topic_editorial_global_validation_digest_v2($4::jsonb)
        WHERE batch_id=$1::uuid AND custom_id=$2 AND raw_sha256=$3 AND (validation IS NULL OR validation_sha256=signal_topic_editorial_global_validation_digest_v2($4::jsonb))`,
        [args.batch_id,args2.custom_id,args2.raw_sha256,JSON.stringify(args2.validation)]);
      if(!result.rowCount)throw new Error('topic_editorial_global_stage_validation_binding_invalid');
    });},
    async finishImport(lease,finish){await withBatch(lease,async client=>{
      const expected=lease.items.map(item=>item.provider_request.custom_id).sort();
      const actual=[...finish.received_custom_ids].sort();
      if(finish.provider_state.id!==lease.provider_id||finish.provider_state.processing_status!=='ended'||stable(expected)!==stable(actual))
        throw new Error('topic_editorial_global_stage_results_coverage_incomplete');
      const counts=(await client.query<{total:number;received:number;validated:number}>(`SELECT count(*)::int total,
        count(*) FILTER(WHERE i.outcome IS NOT NULL AND i.raw_sha256 IS NOT NULL)::int received,count(*) FILTER(WHERE i.validation IS NOT NULL)::int validated
        FROM signal_topic_editorial_global_stage_batch_items_v2 i
        WHERE i.batch_id=$1::uuid`,[args.batch_id])).rows[0];
      if(!counts||counts.total!==expected.length||counts.received!==expected.length||counts.validated!==expected.length)
        throw new Error('topic_editorial_global_stage_results_coverage_incomplete');
      await client.query(`UPDATE signal_topic_editorial_global_stage_calls_v2 SET status='settled',
        settled_micro_usd=signal_topic_editorial_batch_cost_v2(response_body_private::jsonb),settled_at=clock_timestamp()
        WHERE id IN(SELECT call_id FROM signal_topic_editorial_global_stage_batch_items_v2 WHERE batch_id=$1::uuid)
          AND status='response_persisted'`,[args.batch_id]);
      await client.query(`UPDATE signal_topic_editorial_global_stage_batches_v2 SET state='imported',next_poll_at=NULL,lease_expires_at=NULL
        WHERE id=$1::uuid`,[args.batch_id]);
    });},
    async release(lease,release){await withBatch(lease,async client=>{
      await client.query(`UPDATE signal_topic_editorial_global_stage_batches_v2 SET next_poll_at=$3::timestamptz,error_code=$4,lease_token=NULL,lease_expires_at=NULL
        WHERE id=$1::uuid AND lease_token=$2::uuid`,[args.batch_id,lease.lease_token,release.next_poll_at,release.error_code]);
    });},
  };
}

/** Persist the full staged catalog sidecar, then use the established immutable
 * revision materializer. This never selects or serves the revision in Signal. */
export async function materializeSignalTopicEditorialStagedGlobalCatalogV2(args:{database:Pool;workspace_id:string;actor_user_id:string;
  execution_id:string;stage_id:string;catalog:SignalTopicEditorialGlobalCatalogInputV2}){
  const {catalog}=args;
  if(!catalog.complete||!catalog.ready_to_materialize||!catalog.revision||catalog.blocking_group_keys.length||catalog.outcome_counts.technical_error)
    throw new Error('topic_editorial_global_catalog_not_materializable');
  const client=await args.database.connect();let numericRun:string;
  let snapshot:{snapshot_digest:string;screening_review_digest:string;expected_group_count:number;execution_id:string;workspace_id:string;actor_user_id:string}|undefined;
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query('SET LOCAL search_path=public,extensions,pg_temp');
    snapshot=(await client.query<{snapshot_digest:string;screening_review_digest:string;expected_group_count:number;execution_id:string;workspace_id:string;actor_user_id:string}>(`SELECT s.snapshot_digest,s.screening_review_digest,s.expected_group_count,s.execution_id::text,s.workspace_id::text,e.actor_user_id::text
      FROM signal_topic_editorial_global_stages_v2 s JOIN signal_topic_editorial_executions e ON e.id=s.execution_id
      WHERE s.stage_id=$1::uuid`,[args.stage_id])).rows[0];
    const run=(await client.query<{numeric_run_id:string}>(`SELECT numeric_run_id::text FROM signal_topic_editorial_executions WHERE id=$1::uuid`,[args.execution_id])).rows[0];
    if(!snapshot||!run||snapshot.execution_id!==args.execution_id||snapshot.workspace_id!==args.workspace_id||snapshot.actor_user_id!==args.actor_user_id
      ||snapshot.snapshot_digest!==catalog.snapshot_digest||snapshot.expected_group_count!==catalog.group_evidence.length)
      throw new Error('topic_editorial_global_catalog_source_mismatch');
    numericRun=run.numeric_run_id;
    const stageRequests=(await client.query<{request_count:number;terminal_count:number;technical:number}>(`SELECT count(*)::int request_count,
      count(*) FILTER(WHERE item.outcome IS NOT NULL AND COALESCE(req.validation,item.validation) IS NOT NULL
        AND call.status='settled')::int terminal_count,
      count(*) FILTER(WHERE COALESCE(req.validation,item.validation)->>'status'
        IN('invalid_output','provider_error','canceled','expired'))::int technical
      FROM signal_topic_editorial_global_stages_v2 s
      LEFT JOIN signal_topic_editorial_global_stage_requests_v2 req ON req.stage_id=s.stage_id
      LEFT JOIN LATERAL(SELECT i.outcome,i.validation,c.status FROM signal_topic_editorial_global_stage_batch_items_v2 i
        JOIN signal_topic_editorial_global_stage_batches_v2 b ON b.id=i.batch_id
        JOIN signal_topic_editorial_global_stage_calls_v2 c ON c.id=i.call_id
        WHERE i.request_id=req.id AND b.state='imported' ORDER BY b.created_at DESC LIMIT 1)item ON true
      LEFT JOIN LATERAL(SELECT c.status FROM signal_topic_editorial_global_stage_calls_v2 c WHERE c.request_id=req.id
        ORDER BY c.reserved_at DESC,c.id DESC LIMIT 1)call ON true WHERE s.stage_id=$1::uuid`,[args.stage_id])).rows[0];
    if(!stageRequests||stageRequests.request_count===0||stageRequests.terminal_count!==stageRequests.request_count||stageRequests.technical>0)
      throw new Error('topic_editorial_global_catalog_stage_incomplete');
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
  // Converter output is canonical at revision 1; choose the next actual
  // revision here and compare prior logical bodies before creating anything.
  const existingClient=await args.database.connect();let nextRevision:number;let numericGroupKeys:string[];
  try{
    await existingClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await existingClient.query('SET LOCAL search_path=public,extensions,pg_temp');
    const rows=(await existingClient.query<{id:string;revision:number;revision_digest:string;status:string}>(`SELECT id::text,revision,revision_digest,status
      FROM signal_topic_consolidation_revisions WHERE workspace_id=$1::uuid AND consolidation_run_id=$2::uuid AND status IN('validated','superseded')
      ORDER BY revision DESC`,[args.workspace_id,numericRun!])).rows;
    const groupRows=(await existingClient.query<{group_key:string}>(`SELECT group_key FROM signal_topic_atomic_groups
      WHERE consolidation_run_id=$1::uuid ORDER BY group_key COLLATE "C"`,[numericRun!])).rows;
    numericGroupKeys=groupRows.map(item=>item.group_key);
    const desiredLogical={concepts:catalog.revision!.concepts,decisions:catalog.revision!.decisions};
    for(const row of rows){
      const concepts=(await existingClient.query<{concept_key:string;kind:'topic'|'narrative';label:string;definition:string;locale:string;
        source:'numeric'|'model'|'human';metadata:unknown}>(`SELECT concept_key,kind,label,definition,locale,source,metadata
          FROM signal_topic_editorial_concepts WHERE revision_id=$1::uuid ORDER BY concept_key COLLATE "C"`,[row.id])).rows;
      const decisions=(await existingClient.query<{group_key:string;disposition:'topic'|'narrative'|'noise'|'unresolved';concept_key:string|null;
        source:'numeric'|'model'|'human';confidence:number|null;rationale:string|null}>(`SELECT atomic.group_key,d.disposition,c.concept_key,d.source,d.confidence,d.rationale
          FROM signal_topic_consolidation_decisions d JOIN signal_topic_atomic_groups atomic ON atomic.id=d.atomic_group_id
           AND atomic.consolidation_run_id=d.consolidation_run_id AND atomic.workspace_id=d.workspace_id
          LEFT JOIN signal_topic_editorial_concepts c ON c.id=d.concept_id AND c.revision_id=d.revision_id
          WHERE d.revision_id=$1::uuid ORDER BY atomic.group_key COLLATE "C"`,[row.id])).rows;
      if(decisions.length!==numericGroupKeys.length)continue;
      // Metadata is a separate editorial sidecar, not part of the strict
      // revision contract. Project it away before validating a replay.
      const revisionConcepts=signalTopicEditorialGlobalStageRevisionConceptsV2(concepts);
      let parsed;try{parsed=parseSignalTopicConsolidationRevisionV1({contract_version:'signal-topic-consolidation-revision-v1',revision:row.revision,
        concepts:revisionConcepts,decisions,revision_digest:row.revision_digest},numericGroupKeys);}catch{continue;}
      const metadata=new Map(concepts.map(item=>[item.concept_key,item.metadata]));
      const desired={...catalog.revision!,revision:1};
      const normalizeConcepts=<T extends {concept_key:string}>(items:T[])=>[...items].sort((a,b)=>a.concept_key.localeCompare(b.concept_key));
      const normalizeDecisions=<T extends {group_key:string}>(items:T[])=>[...items].sort((a,b)=>a.group_key.localeCompare(b.group_key));
      const expectedMetadata=new Map([...catalog.concept_metadata].map(([key,value])=>[key,{contract_version:'signal-topic-editorial-concept-metadata-v2',...value}]));
      const sameLogical=stable(normalizeConcepts(parsed.concepts))===stable(normalizeConcepts(desiredLogical.concepts))
        &&stable(normalizeDecisions(parsed.decisions))===stable(normalizeDecisions(desiredLogical.decisions))
        &&stable([...metadata.entries()].sort(([a],[b])=>a.localeCompare(b)))===stable([...expectedMetadata.entries()].sort(([a],[b])=>a.localeCompare(b)));
      if(sameLogical){
        await existingClient.query('COMMIT');
        await persistSignalTopicEditorialGlobalStageCatalogV2({database:args.database,stage_id:args.stage_id,catalog_digest:sha(stable({
          contract_version:catalog.contract_version,snapshot_digest:catalog.snapshot_digest,global_request_digest:catalog.global_request_digest,
          outcome_counts:catalog.outcome_counts,revision:catalog.revision})),catalog_body:{contract_version:catalog.contract_version,
          snapshot_digest:catalog.snapshot_digest,global_request_digest:catalog.global_request_digest,outcome_counts:catalog.outcome_counts,revision:catalog.revision},
          group_evidence:catalog.group_evidence});
        await tx(args.database,async db=>{
          await db.query(`UPDATE signal_topic_editorial_global_stage_catalog_v2 SET revision_id=$2::uuid,materialized_at=clock_timestamp()
            WHERE stage_id=$1::uuid AND (revision_id IS NULL OR revision_id=$2::uuid)`,[args.stage_id,row.id]);
          await db.query(`UPDATE signal_topic_editorial_global_stages_v2 SET state='materialized',completed_at=clock_timestamp()
            WHERE stage_id=$1::uuid AND state IN('open','complete')`,[args.stage_id]);
        });
        return {consolidation_run_id:numericRun!,revision_id:row.id,revision:row.revision,revision_digest:row.revision_digest,replayed:true,
          global_request_digest:catalog.global_request_digest,outcome_counts:catalog.outcome_counts};
      }
    }
    nextRevision=(rows[0]?.revision??0)+1;
    await existingClient.query('COMMIT');
  }catch(error){await existingClient.query('ROLLBACK').catch(()=>undefined);throw error;}finally{existingClient.release();}
  const revisionBody={contract_version:catalog.revision!.contract_version,revision:nextRevision,concepts:catalog.revision!.concepts,decisions:catalog.revision!.decisions};
  const revision={...revisionBody,revision_digest:signalTopicConsolidationDigestV1(revisionBody)};
  const catalogBody={contract_version:catalog.contract_version,snapshot_digest:catalog.snapshot_digest,global_request_digest:catalog.global_request_digest,
    outcome_counts:catalog.outcome_counts,revision:catalog.revision};
  const catalogDigest=sha(stable(catalogBody));
  await persistSignalTopicEditorialGlobalStageCatalogV2({database:args.database,stage_id:args.stage_id,catalog_digest:catalogDigest,
    catalog_body:catalogBody,group_evidence:catalog.group_evidence});
  const stored=await materializeSignalTopicConsolidationRevisionV1({database:args.database,workspace_id:args.workspace_id,actor_user_id:args.actor_user_id,
    consolidation_run_id:numericRun!,revision,concept_metadata:catalog.concept_metadata});
  await tx(args.database,async db=>{
    await db.query(`UPDATE signal_topic_editorial_global_stage_catalog_v2 SET revision_id=$2::uuid,materialized_at=clock_timestamp()
      WHERE stage_id=$1::uuid AND (revision_id IS NULL OR revision_id=$2::uuid)`,[args.stage_id,stored.revision_id]);
    await db.query(`UPDATE signal_topic_editorial_global_stages_v2 SET state='materialized',completed_at=clock_timestamp()
      WHERE stage_id=$1::uuid AND state IN('open','complete')`,[args.stage_id]);
  });
  return {...stored,global_request_digest:catalog.global_request_digest,outcome_counts:catalog.outcome_counts};
}

export async function markSignalTopicEditorialGlobalStageBlockedV2(args:{database:SignalTopicEditorialGlobalStageDatabaseV2;stage_id:string;error_code:string}){
  if(!/^topic_editorial_[a-z0-9_]{1,100}$/u.test(args.error_code))throw new Error('topic_editorial_global_stage_error_invalid');
  return tx(args.database,async client=>{
    const result=await client.query(`UPDATE signal_topic_editorial_global_stages_v2 SET state='blocked',completed_at=clock_timestamp()
      WHERE stage_id=$1::uuid AND state='open' AND NOT EXISTS(SELECT 1 FROM signal_topic_editorial_global_stage_batches_v2
        WHERE stage_id=$1::uuid AND state IN('prepared','submitting','submission_unknown','in_progress','canceling')) RETURNING stage_id::text`,[args.stage_id]);
    return {blocked:result.rowCount===1,error_code:args.error_code};
  });
}

/** Retry exact zero-cost grammar errors or a paid shard with invalid citations.
 * The sealed request is byte-identical; accepted paid siblings stay untouched.
 * Each retry is a new immutable call, at most five attempts per request. */
export async function prepareSignalTopicEditorialGlobalStageGrammarRetryV2(args:{database:SignalTopicEditorialGlobalStageDatabaseV2}){
  return tx(args.database,async client=>{
    const locked=(await client.query<{locked:boolean}>(`SELECT pg_try_advisory_xact_lock(hashtextextended('signal-topic-editorial-global-grammar-retry-v2',0)) locked`)).rows[0]?.locked;
    if(!locked)return null;
    const cooling=(await client.query<{blocked:boolean}>(`SELECT EXISTS(
      SELECT 1 FROM signal_topic_editorial_provider_batches_v2 b
       WHERE b.state IN('prepared','submitting','submission_unknown') OR b.submitted_at>clock_timestamp()-interval '75 seconds'
      UNION ALL SELECT 1 FROM signal_topic_editorial_global_stage_batches_v2 b
       WHERE b.state IN('prepared','submitting','submission_unknown','in_progress','canceling')
         OR b.submitted_at>clock_timestamp()-interval '75 seconds') blocked`)).rows[0]?.blocked;
    if(cooling)return null;
    const candidates=(await client.query<{stage_id:string;execution_id:string;workspace_id:string;organization_id:string;request_id:string;
      previous_call_id:string;stage_kind:'shard'|'merge'|'rank';custom_id:string;call_identity:string;stage_contract_body:string;request_body:string;
      input_digest:string;request_digest:string;reserved_date:string;budget_timezone:string;hard_cap:string;screening_review_digest:string;
    }>(`WITH latest AS(SELECT DISTINCT ON(c.request_id)c.* FROM signal_topic_editorial_global_stage_calls_v2 c
        ORDER BY c.request_id,c.reserved_at DESC,c.id DESC)
      SELECT s.stage_id::text,s.execution_id::text,s.workspace_id::text,s.organization_id::text,r.id::text request_id,
        c.id::text previous_call_id,r.stage_kind,r.custom_id,r.call_identity,r.stage_contract_body,r.request_body,r.input_digest,r.request_digest,
        CASE WHEN grant_row.execution_id IS NULL THEN a.budget_date ELSE (clock_timestamp() AT TIME ZONE a.budget_timezone)::date END::text reserved_date,
        a.budget_timezone,e.hard_cap_micro_usd::text hard_cap,s.screening_review_digest
      FROM signal_topic_editorial_global_stages_v2 s
      JOIN signal_topic_editorial_executions e ON e.id=s.execution_id
      JOIN signal_topic_editorial_batch_owners_v2 owner ON owner.execution_id=e.id AND owner.workspace_id=e.workspace_id
      JOIN signal_processing_admissions a ON a.id=e.processing_admission_id
      LEFT JOIN signal_topic_editorial_global_continuations_v2 grant_row ON grant_row.execution_id=e.id
      JOIN signal_topic_editorial_global_stage_requests_v2 r ON r.stage_id=s.stage_id
      JOIN latest c ON c.request_id=r.id
      JOIN signal_topic_editorial_global_stage_batch_items_v2 i ON i.call_id=c.id AND i.request_id=r.id
      JOIN signal_topic_editorial_global_stage_batches_v2 b ON b.id=i.batch_id
      WHERE s.state='open' AND owner.stage='review_pending' AND e.status IN('queued','running')
        AND c.status='settled' AND b.state='imported' AND (
          (c.settled_micro_usd=0 AND c.observed_micro_usd=0 AND i.outcome='errored'
            AND i.validation->>'status'='provider_error'
            AND c.response_body_private::jsonb->'result'->'error'->'error'->>'message' LIKE 'Grammar compilation rate limit exceeded%')
          OR (i.outcome='succeeded' AND i.validation->>'status'='invalid_output'
            AND i.validation->>'code'='topic_editorial_global_shard_citation_invalid'))
        AND r.validation IS NULL
        AND (SELECT count(*) FROM signal_topic_editorial_global_stage_calls_v2 attempts WHERE attempts.request_id=r.id)<5
      ORDER BY s.created_at,r.stage_kind,r.round,r.batch_index LIMIT 100`,[])).rows;
    if(!candidates.length)return null;
    // One provider Batch cannot mix stage_kind. Keep the earliest bounded homogeneous slice.
    const chosenKind=candidates[0]!.stage_kind,chosenStage=candidates[0]!.stage_id;
    const selected=candidates.filter(item=>item.stage_id===chosenStage&&item.stage_kind===chosenKind).slice(0,100);
    const items=selected.map(row=>{
      const callId=randomUUID(),descriptor=JSON.parse(row.stage_contract_body) as Record<string,unknown>;
      const provider_request={custom_id:row.custom_id,params:JSON.parse(row.request_body) as Record<string,unknown>};
      return row.stage_kind==='shard'?{stage_id:row.stage_id,stage_kind:'shard' as const,call_id:callId,shard:descriptor,provider_request,
        retry_of_call_id:row.previous_call_id,request_id:row.request_id,request_body:row.request_body}
        :{stage_id:row.stage_id,stage_kind:row.stage_kind,call_id:callId,review:descriptor,provider_request,
          retry_of_call_id:row.previous_call_id,request_id:row.request_id,request_body:row.request_body};
    });
    const manifestBody=stable({stage_kind:chosenKind,items:items.map(item=>({custom_id:item.provider_request.custom_id,call_id:item.call_id,
      stage_identity:signalTopicEditorialGlobalStageRequestIdentityV2(item as unknown as SignalTopicEditorialGlobalStageItemV2),
      request_digest:(item.stage_kind==='shard'?(item as {shard:Record<string,unknown>}).shard:(item as {review:Record<string,unknown>}).review).request_digest}))
      .sort((a,b)=>a.custom_id<b.custom_id?-1:a.custom_id>b.custom_id?1:0)});
    const manifestDigest=signalTopicEditorialGlobalStageManifestDigestV2({stage_kind:chosenKind,items:items as unknown as SignalTopicEditorialGlobalStageItemV2[]});
    const batchId=(await client.query<{id:string}>(`INSERT INTO signal_topic_editorial_global_stage_batches_v2(stage_id,stage_kind,manifest_body,manifest_digest)
      VALUES($1::uuid,$2,$3,$4) RETURNING id::text`,[chosenStage,chosenKind,manifestBody,manifestDigest])).rows[0]?.id;
    if(!batchId)throw new Error('topic_editorial_global_stage_store_invalid');
    let reserved=0n;
    for(const [index,item] of items.entries()){
      const row=selected[index]!,requestBody=item.request_body,params=item.provider_request.params;
      const maxTokens=Number(params.max_tokens);if(!Number.isSafeInteger(maxTokens)||maxTokens<=0)throw new Error('topic_editorial_global_stage_request_invalid');
      const amount=signalTopicEditorialGlobalStageReservationMicroUsdV2(requestBody,maxTokens);
      const callId=(await client.query<{id:string}>(`INSERT INTO signal_topic_editorial_global_stage_calls_v2(stage_id,request_id,workspace_id,organization_id,
        execution_id,retry_of_call_id,reserved_micro_usd,budget_date,budget_timezone)
        VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::bigint,$8::date,$9) RETURNING id::text`,
        [row.stage_id,row.request_id,row.workspace_id,row.organization_id,row.execution_id,row.previous_call_id,amount.toString(),row.reserved_date,row.budget_timezone])).rows[0]?.id;
      if(!callId)throw new Error('topic_editorial_global_stage_store_invalid');
      await client.query(`INSERT INTO signal_topic_editorial_global_stage_batch_items_v2(batch_id,stage_id,request_id,call_id,custom_id,call_identity)
        VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6)`,[batchId,row.stage_id,row.request_id,callId,item.provider_request.custom_id,item.call_id]);
      reserved+=amount;
    }
    return {stage_id:chosenStage,batch_id:batchId,request_count:items.length,manifest_digest:manifestDigest,reserved_micro_usd:reserved.toString(),replayed:false};
  });
}

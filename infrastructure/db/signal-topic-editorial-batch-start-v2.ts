import { buildSignalTopicEditorialBatchPlanFromPreparedInputV2 } from '../../packages/query-engine/src/signal-topic-consolidation-editorial-v2';
import type { Pool } from 'pg';
import { loadSignalWorkspaceCapabilitiesStoreV1 } from './signal-workspace-capabilities';
import { loadSignalTopicConsolidationEditorialInputV1 } from './signal-topic-consolidation-editorial-input';
import {replaySignalTopicEditorialBatchV2} from './signal-topic-editorial-batch-v2';
import {quoteSignalTopicEditorialChunkedAdmissionV3,replaySignalTopicEditorialChunkedAdmissionV3,
  requestSignalTopicEditorialChunkedAdmissionV3} from './signal-topic-editorial-admission-v3';
import { SignalTopicEditorialStoreError } from './signal-topic-consolidation-editorial';

type Args={database:Pick<Pool,'connect'>;workspace_id:string;actor_user_id:string;
  numeric_execution_id:string;idempotency_key:string};
const fail=(code:string,status=409):never=>{throw new SignalTopicEditorialStoreError(code,status);};

/** The same V2 source/quote/admission protocol used by Studio before the
 * HTTP timeout, now executed by the durable start Worker. This does not submit
 * to Claude; the separate manifest and batch jobs own provider transport. */
export async function performSignalTopicEditorialBatchStartV2(args:Args):Promise<{execution_id:string;replayed:boolean}>{
  const client=await args.database.connect();
  let runId:string;
  let existing:{quote_reference:string;hard_cap_micro_usd:string|null;contract_version:string}|undefined;
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query('SET LOCAL search_path=public,extensions,pg_temp');
    const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,workspace_id:args.workspace_id,actor_user_id:args.actor_user_id});
    if(!caps.can_view||!caps.can_request_processing)fail('processing_forbidden',403);
    const row=(await client.query<{run_id:string}>(`SELECT r.id::text run_id FROM signal_topic_consolidation_executions n
      JOIN signal_topic_consolidation_runs r ON r.id=n.consolidation_run_id AND r.workspace_id=n.workspace_id
      WHERE n.workspace_id=$1::uuid AND n.id=$2::uuid AND n.status='ready'`,
      [args.workspace_id,args.numeric_execution_id])).rows[0];
    if(!row)fail('topic_editorial_source_stale');
    runId=row!.run_id;
    existing=(await client.query<{quote_reference:string;hard_cap_micro_usd:string|null;contract_version:string}>(`SELECT e.quote_reference,e.hard_cap_micro_usd::text,
      e.plan->>'contract_version' contract_version
      FROM signal_topic_editorial_request_keys k JOIN signal_topic_editorial_executions e
        ON e.id=k.execution_id AND e.workspace_id=k.workspace_id
      WHERE k.workspace_id=$1::uuid AND k.actor_user_id=$2::uuid AND k.idempotency_key=$3
        AND e.numeric_run_id=$4::uuid AND e.plan->>'contract_version' IN
          ('signal-topic-editorial-screening-plan-v2','signal-topic-editorial-admission-header-v3')`,
      [args.workspace_id,args.actor_user_id,args.idempotency_key,runId!])).rows[0];
    if(!existing){
      // An expired policy blocks NEW work, never recovery of a committed key.
      const currentPolicy=(await client.query<{valid:boolean}>(`SELECT clock_timestamp()>=p.valid_from
        AND clock_timestamp()<p.valid_until valid FROM signal_workspaces w
        JOIN signal_processing_policy_versions p ON p.organization_id=w.organization_id AND p.status='active'
        WHERE w.id=$1::uuid`,[args.workspace_id])).rows[0];
      if(!currentPolicy?.valid)fail('policy_required');
    }
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}
  finally{client.release();}
  if(existing){
    const replay=await (existing.contract_version==='signal-topic-editorial-admission-header-v3'
      ?replaySignalTopicEditorialChunkedAdmissionV3:replaySignalTopicEditorialBatchV2)({database:args.database,workspace_id:args.workspace_id,
      actor_user_id:args.actor_user_id,numeric_execution_id:args.numeric_execution_id,
      idempotency_key:args.idempotency_key,quote_reference:existing.quote_reference,
      confirmed_cap_micro_usd:existing.hard_cap_micro_usd});
    if(!replay.replayed||!replay.execution_id)fail('topic_editorial_v2_replay_unavailable');
    return {execution_id:replay.execution_id!,replayed:true};
  }
  const input=await loadSignalTopicConsolidationEditorialInputV1({database:args.database,workspace_id:args.workspace_id,
    actor_user_id:args.actor_user_id,numeric_run_id:runId!});
  const plan=buildSignalTopicEditorialBatchPlanFromPreparedInputV2({input,run_id:runId!});
  const quote=await quoteSignalTopicEditorialChunkedAdmissionV3({database:args.database,workspace_id:args.workspace_id,
    actor_user_id:args.actor_user_id,plan,deadline:Math.floor(Date.now()/1000)+3300});
  if(quote.status!=='ready_to_authorize')fail(quote.status,quote.status==='access_required'?403:409);
  if(!quote.quote_reference)fail('topic_editorial_policy_limit_unavailable');
  const latest=await args.database.connect();let previous:string|null=null;
  try{
    previous=(await latest.query<{id:string}>(`SELECT id::text FROM signal_topic_editorial_executions
      WHERE workspace_id=$1::uuid AND numeric_run_id=$2::uuid ORDER BY created_at DESC,id DESC LIMIT 1`,
      [args.workspace_id,runId!])).rows[0]?.id??null;
  }finally{latest.release();}
  const admitted=await requestSignalTopicEditorialChunkedAdmissionV3({database:args.database,
    workspace_id:args.workspace_id,actor_user_id:args.actor_user_id,plan,
    idempotency_key:args.idempotency_key,quote_reference:quote.quote_reference!,
    previous_execution_id:previous??undefined});
  return {execution_id:admitted.execution_id,replayed:admitted.replayed};
}

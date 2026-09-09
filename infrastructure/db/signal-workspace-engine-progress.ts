import type {PoolClient} from 'pg';
import type {SignalWorkspaceTopicMaterializationMappingV1} from '@noisia/query-engine';
import type {SignalWorkspaceEngineArtifactV1,SignalWorkspaceEngineDatabaseV1,SignalWorkspaceEngineFitCheckpointV1,
 SignalWorkspaceEngineInterpretationCheckpointV1,SignalWorkspaceEngineSnapshotV1,SignalWorkspaceEngineUnitManifestV1} from './signal-workspace-engine';

/** Derivation of already-paid evidence. This scope is never an engine/provider lease. */
export const SIGNAL_WORKSPACE_ENGINE_PROGRESS_JOB_V1='signal_workspace_engine_progress_v1' as const;
export type SignalWorkspaceEngineProgressScopeV1={execution_id:string;workspace_id:string;actor_user_id:string};
export type SignalWorkspaceEngineProgressSourceV1=SignalWorkspaceEngineProgressScopeV1&{
 input_digest:string;snapshot:SignalWorkspaceEngineSnapshotV1;fit_checkpoint:SignalWorkspaceEngineFitCheckpointV1;
 coverage:SignalWorkspaceEngineUnitManifestV1;expected_coverage:SignalWorkspaceEngineUnitManifestV1;
 catalog_profile_id:string;needs_materialization:boolean;
};
export type SignalWorkspaceEngineProgressMetadataV1={
 contract_version:'workspace-topic-materialization-progress-v1';execution_id:string;
 interpretation_units_digest:string;interpreted_unit_count:number;
 expected_interpretation_units_digest:string;expected_interpretation_unit_count:number;interpretation_complete:boolean;
 output_catalog_profile_id:string;output_catalog_revision:number;topic_count:number;discovered_topic_count:number;mapping_digest:string;
};
export type SignalWorkspaceEngineProgressCheckpointV1={
 artifact_id:string;output_catalog_profile_id:string;mapping_digest:string;interpreted_unit_count:number;expected_interpretation_unit_count:number;
 interpretation_complete:boolean;topic_count:number;discovered_topic_count:number;projection_execution_id:string;generation_id:string;
};
export type SignalWorkspaceEngineProgressResultV1=SignalWorkspaceEngineProgressMetadataV1&{
 mapping:SignalWorkspaceTopicMaterializationMappingV1[];replayed:boolean;
};
export type SignalWorkspaceEngineProgressReadArgsV1=SignalWorkspaceEngineProgressScopeV1&{database:SignalWorkspaceEngineDatabaseV1};
export type SignalWorkspaceEngineProgressMaterializeArgsV1=SignalWorkspaceEngineProgressReadArgsV1&{
 expected_coverage:SignalWorkspaceEngineUnitManifestV1;expected_catalog_profile_id:string;
 proposals:AsyncIterable<{artifact_id:string;body:string}>;
};
export type SignalWorkspaceEngineProgressPersistArgsV1=SignalWorkspaceEngineProgressReadArgsV1&{
 expected_coverage:SignalWorkspaceEngineUnitManifestV1;artifact:SignalWorkspaceEngineArtifactV1;
};
export type SignalWorkspaceEngineProgressCheckpointPageV1={items:SignalWorkspaceEngineInterpretationCheckpointV1[];next_artifact_id:string|null;done:boolean};

import {signalWorkspaceEmbeddingDigestV1 as digest} from '@noisia/query-engine';
import {SignalWorkspaceEngineError,loadSignalWorkspaceEngineProgressInputWithClientV1,
 persistSignalWorkspaceEngineProgressArtifactWithClientV1,signalWorkspaceEngineProgressOwnerPredicateV1} from './signal-workspace-engine';
import {requestSignalWorkspaceTopicProjectionWithClientV1} from './signal-workspace-topic-projection';
export {materializeSignalWorkspaceEngineTopicsProgressV1} from './signal-topic-catalog';
const fail=(code:string,status=409):never=>{throw new SignalWorkspaceEngineError(code,status);};
async function tx<T>(database:SignalWorkspaceEngineDatabaseV1,work:(client:PoolClient)=>Promise<T>){
 const client=await database.connect();try{await client.query('BEGIN');await client.query('SET LOCAL search_path=public,extensions,pg_temp');
  await client.query('SET LOCAL TIME ZONE \'UTC\'');const value=await work(client);await client.query('COMMIT');return value;
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
const sameCoverage=(a:SignalWorkspaceEngineUnitManifestV1,b:SignalWorkspaceEngineUnitManifestV1)=>a.unit_count===b.unit_count&&a.unit_digest===b.unit_digest;
async function source(client:PoolClient,args:SignalWorkspaceEngineProgressScopeV1):Promise<SignalWorkspaceEngineProgressSourceV1>{
 const {run,snapshot,fit,coverage}=await loadSignalWorkspaceEngineProgressInputWithClientV1(client,args);
 const profile=(await client.query<{id:string}>(`SELECT id FROM signal_taxonomy_profiles WHERE workspace_id=$1::uuid AND kind='topic'
  AND status IN('draft','activating','active') AND metadata->>'contract_version'='signal-topic-catalog-v1' ORDER BY version DESC LIMIT 1`,[args.workspace_id])).rows[0];
 if(!profile)return fail('workspace_engine_progress_catalog_required');
 const confirmed=(await client.query<{exists:boolean}>(`SELECT EXISTS(SELECT 1 FROM analysis_artifacts WHERE engine_execution_id=$1::uuid
  AND metadata->>'contract_version' IN('workspace-topic-materialization-progress-v1','workspace-topic-materialization-v1')
  AND metadata->>'output_catalog_profile_id'=$4 AND metadata->>'interpretation_units_digest'=$2
  AND (metadata->>'contract_version'='workspace-topic-materialization-v1' OR (metadata->>'interpreted_unit_count')::bigint=$3)) exists`,
 [args.execution_id,coverage.unit_digest,coverage.unit_count,profile.id])).rows[0]!.exists;
 return{...args,input_digest:run.input_digest,snapshot,fit_checkpoint:fit,coverage,expected_coverage:fit.interpretation_manifest,
  catalog_profile_id:profile.id,needs_materialization:coverage.unit_count>0&&!confirmed};
}
export async function readSignalWorkspaceEngineMaterializationSourceV1(args:SignalWorkspaceEngineProgressReadArgsV1):Promise<SignalWorkspaceEngineProgressSourceV1>{
 return tx(args.database,client=>source(client,args));
}
export async function readSignalWorkspaceEngineMaterializationCheckpointsV1(args:SignalWorkspaceEngineProgressReadArgsV1&{
 expected_coverage:SignalWorkspaceEngineUnitManifestV1;after_artifact_id?:string|null;limit?:number}):Promise<SignalWorkspaceEngineProgressCheckpointPageV1>{
 const limit=args.limit??32;if(!Number.isInteger(limit)||limit<1||limit>32)return fail('workspace_engine_page_invalid',422);
 return tx(args.database,async client=>{const current=await source(client,args);
  if(!sameCoverage(current.coverage,args.expected_coverage))return fail('workspace_engine_progress_coverage_changed');
  const rows=(await client.query<SignalWorkspaceEngineInterpretationCheckpointV1&{valid:boolean}>(`SELECT artifact.id artifact_id,artifact.artifact_key,
   artifact.content->>'storage_key' storage_key,artifact.content->>'sha256' sha256,(artifact.content->>'size_bytes')::bigint::float8 size_bytes,
   artifact.content->>'media_type' media_type,artifact.metadata->'unit_keys' unit_keys,call.id call_id,call.call_configuration,
   call.metadata->>'interpretation_revision_digest' interpretation_revision_digest,
   COALESCE(call.call_state='settled' AND call.response_sha256=artifact.metadata->>'response_sha256'
    AND call.actor_user_id=$3::uuid AND call.call_configuration=workspace_engine_interpretation_configuration_v1(call.catalog_execution_id,call.metadata->>'interpretation_revision_digest')
    AND artifact.metadata->>'fit_checkpoint_digest'=$4,false) valid
   FROM analysis_artifacts artifact LEFT JOIN engine_cost_events call ON call.id=(artifact.metadata->>'call_id')::uuid
    AND call.catalog_execution_id=artifact.engine_execution_id AND call.workspace_id=artifact.workspace_id
   WHERE artifact.workspace_id=$1::uuid AND artifact.engine_execution_id=$2::uuid
    AND artifact.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1'
    AND ($5::uuid IS NULL OR artifact.id>$5::uuid) ORDER BY artifact.id LIMIT $6`,
  [args.workspace_id,args.execution_id,args.actor_user_id,current.fit_checkpoint.checkpoint_digest,args.after_artifact_id??null,limit+1])).rows;
  if(rows.some(row=>!row.valid))return fail('workspace_engine_interpretation_receipt_required');
  const items=rows.slice(0,limit).map(({valid:_valid,...row})=>row);
  return{items,next_artifact_id:items.at(-1)?.artifact_id??null,done:rows.length<=limit};
 });
}
export async function persistSignalWorkspaceEngineTopicsProgressV1(args:SignalWorkspaceEngineProgressPersistArgsV1):Promise<{
 artifact_id:string;projection_execution_id:string;generation_id:string;replayed:boolean}>{
 return tx(args.database,async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`signal-taxonomy:${args.workspace_id}:topic`]);
  const current=await source(client,args),metadata=args.artifact.metadata as unknown as SignalWorkspaceEngineProgressMetadataV1;
  if(!sameCoverage(current.coverage,args.expected_coverage))return fail('workspace_engine_progress_coverage_changed');
  if(metadata.contract_version!=='workspace-topic-materialization-progress-v1'||metadata.execution_id!==args.execution_id
   ||metadata.output_catalog_profile_id!==current.catalog_profile_id||metadata.interpretation_units_digest!==current.coverage.unit_digest
   ||metadata.interpreted_unit_count!==current.coverage.unit_count||metadata.expected_interpretation_unit_count!==current.expected_coverage.unit_count
   ||metadata.expected_interpretation_units_digest!==current.expected_coverage.unit_digest
   ||metadata.interpretation_complete!==sameCoverage(current.coverage,current.expected_coverage)
   ||args.artifact.artifact_key!==`materialization-progress-${metadata.output_catalog_profile_id}.json`)return fail('workspace_engine_progress_catalog_changed');
  const saved=await persistSignalWorkspaceEngineProgressArtifactWithClientV1(client,args,args.artifact);
  const projection=await requestSignalWorkspaceTopicProjectionWithClientV1(client,{workspace_id:args.workspace_id,actor_user_id:args.actor_user_id,
   engine_execution_id:args.execution_id,materialization_artifact_id:saved.artifact_id,idempotency_key:`workspace-progress-projection:${saved.artifact_id}`});
  const checkpoint:SignalWorkspaceEngineProgressCheckpointV1={artifact_id:saved.artifact_id,output_catalog_profile_id:metadata.output_catalog_profile_id,
   mapping_digest:metadata.mapping_digest,interpreted_unit_count:metadata.interpreted_unit_count,expected_interpretation_unit_count:metadata.expected_interpretation_unit_count,
   interpretation_complete:metadata.interpretation_complete,topic_count:metadata.topic_count,discovered_topic_count:metadata.discovered_topic_count,
   projection_execution_id:projection.execution_id,generation_id:projection.generation_id};
  await client.query(`UPDATE signal_topic_catalog_executions SET result_summary=result_summary||jsonb_build_object('materialization_progress',$2::jsonb,'materialized_topics',$3::int)
   WHERE id=$1::uuid AND status<>'ready'`,[args.execution_id,JSON.stringify(checkpoint),metadata.topic_count]);
  return{artifact_id:saved.artifact_id,projection_execution_id:projection.execution_id,generation_id:projection.generation_id,replayed:saved.replayed};
 });
}
export async function completeSignalWorkspaceEngineProgressDispatchV1(args:SignalWorkspaceEngineProgressReadArgsV1&{worker_job_id:string}):Promise<void>{
 return tx(args.database,async client=>{await source(client,args);
  await client.query(`UPDATE signal_topic_classification_outbox SET status='completed',completed_at=clock_timestamp(),error_code=NULL,
   lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE execution_id=$1::uuid AND workspace_id=$2::uuid
   AND dispatch_kind='engine_progress' AND worker_job_id=$3`,[args.execution_id,args.workspace_id,args.worker_job_id]);
 });
}
export async function failSignalWorkspaceEngineProgressDispatchV1(args:SignalWorkspaceEngineProgressReadArgsV1&{worker_job_id:string;error_code:string}):Promise<void>{
 const code=/^workspace_(engine|projection)_[a-z_]{1,90}$/u.test(args.error_code)?args.error_code:'workspace_engine_progress_failed';
 return tx(args.database,async client=>{
  const owned=(await client.query(`SELECT id FROM signal_topic_catalog_executions WHERE id=$1::uuid AND workspace_id=$2::uuid
   AND actor_user_id=$3::uuid AND input_contract='workspace-topic-engine-v1'`,[args.execution_id,args.workspace_id,args.actor_user_id])).rows[0];
  if(!owned)return fail('workspace_engine_progress_forbidden',403);
  await client.query(`UPDATE signal_topic_classification_outbox SET status='failed',completed_at=NULL,error_code=$4,
   lease_token=NULL,lease_expires_at=NULL,available_at=clock_timestamp()+interval '15 seconds',updated_at=clock_timestamp()
   WHERE execution_id=$1::uuid AND workspace_id=$2::uuid AND dispatch_kind='engine_progress' AND worker_job_id=$3`,
  [args.execution_id,args.workspace_id,args.worker_job_id,code]);
 });
}
export async function scheduleSignalWorkspaceEngineProgressV1(args:{database:SignalWorkspaceEngineDatabaseV1;limit?:number}):Promise<number>{
 const limit=args.limit??20;if(!Number.isInteger(limit)||limit<1||limit>100)return fail('workspace_engine_page_invalid',422);
 return tx(args.database,async client=>{
  const rows=(await client.query<{id:string;workspace_id:string;actor_user_id:string;coverage_digest:string;catalog_profile_id:string;observed_job_id:string|null}>(`SELECT execution.id,execution.workspace_id,execution.actor_user_id,coverage.unit_digest coverage_digest,catalog.id catalog_profile_id,dispatch.worker_job_id observed_job_id
   FROM signal_topic_catalog_executions execution CROSS JOIN LATERAL signal_workspace_engine_interpretation_coverage_v1(execution.id) coverage
   JOIN LATERAL(SELECT id FROM signal_taxonomy_profiles profile WHERE profile.workspace_id=execution.workspace_id AND profile.kind='topic'
    AND profile.status IN('draft','activating','active') AND profile.metadata->>'contract_version'='signal-topic-catalog-v1' ORDER BY profile.version DESC LIMIT 1) catalog ON true
   LEFT JOIN signal_topic_classification_outbox dispatch ON dispatch.execution_id=execution.id AND dispatch.dispatch_kind='engine_progress'
   WHERE execution.input_contract='workspace-topic-engine-v1' AND execution.status IN('running','failed','ready')
    AND execution.result_summary ? 'fit_checkpoint' AND (${signalWorkspaceEngineProgressOwnerPredicateV1})
    AND coverage.unit_count>0 AND coverage.unit_count=coverage.unique_count
    AND signal_workspace_classification_actor_v1(execution.workspace_id,execution.actor_user_id)
    AND execution.input_revision=(SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=execution.workspace_id)
    AND (execution.policy_valid_until IS NULL OR execution.policy_valid_until>clock_timestamp())
    AND NOT EXISTS(SELECT 1 FROM analysis_artifacts materialization WHERE materialization.engine_execution_id=execution.id
     AND materialization.metadata->>'contract_version' IN('workspace-topic-materialization-progress-v1','workspace-topic-materialization-v1')
     AND materialization.metadata->>'output_catalog_profile_id'=catalog.id::text
     AND materialization.metadata->>'interpretation_units_digest'=coverage.unit_digest)
    AND (dispatch.id IS NULL OR dispatch.attempt_count<8 OR dispatch.worker_job_id<>'workspace-progress-'||execution.id::text||'-'||catalog.id::text||'-'||substr(coverage.unit_digest,8))
    AND (dispatch.id IS NULL OR dispatch.status IN('completed','failed','dead_letter') AND dispatch.available_at<=clock_timestamp()
      OR dispatch.status='dispatched' AND dispatch.updated_at<clock_timestamp()-interval '180 seconds')
   ORDER BY execution.created_at LIMIT $1`,[limit])).rows;
  let scheduled=0;
  for(const row of rows){
   // Match the writer lock order. Recheck after acquisition so simultaneous
   // drainers coalesce a single row and never resurrect an in-progress dispatch.
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`signal-taxonomy:${row.workspace_id}:topic`]);
   let latest:SignalWorkspaceEngineProgressSourceV1;
   try{latest=await source(client,{execution_id:row.id,workspace_id:row.workspace_id,actor_user_id:row.actor_user_id});}
   catch(error){
    if(!(error instanceof Error)||!['workspace_engine_inputs_stale','workspace_engine_forbidden','workspace_topic_catalog_required','workspace_topic_catalog_empty','workspace_engine_progress_catalog_required','workspace_engine_progress_superseded'].includes(error.message))throw error;
    // Quarantine only this obsolete derivation identity. The source engine and
    // financial ledger remain untouched; a new profile/coverage is a new job.
    const rejectedJob=`workspace-progress-${row.id}-${row.catalog_profile_id}-${row.coverage_digest.slice(7)}`;
    await client.query(`INSERT INTO signal_topic_classification_outbox(execution_id,workspace_id,worker_job_id,dispatch_kind,status,attempt_count,error_code)
     VALUES($1::uuid,$2::uuid,$3,'engine_progress','dead_letter',8,'workspace_engine_progress_inputs_stale')
     ON CONFLICT(execution_id,dispatch_kind) DO UPDATE SET status='dead_letter',attempt_count=8,worker_job_id=EXCLUDED.worker_job_id,
      error_code=EXCLUDED.error_code,completed_at=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
     WHERE signal_topic_classification_outbox.status IN('failed','completed','dead_letter')
      OR signal_topic_classification_outbox.status='dispatched' AND signal_topic_classification_outbox.worker_job_id=$4
       AND signal_topic_classification_outbox.updated_at<clock_timestamp()-interval '180 seconds'`,[row.id,row.workspace_id,rejectedJob,row.observed_job_id]);
    continue;
   }
   if(!latest.needs_materialization)continue;
   const job=`workspace-progress-${row.id}-${latest.catalog_profile_id}-${latest.coverage.unit_digest.slice(7)}`;
   await client.query(`INSERT INTO signal_topic_classification_outbox(execution_id,workspace_id,worker_job_id,dispatch_kind)
    VALUES($1::uuid,$2::uuid,$3,'engine_progress') ON CONFLICT(execution_id,dispatch_kind) DO UPDATE SET status='pending',worker_job_id=EXCLUDED.worker_job_id,
    attempt_count=CASE WHEN signal_topic_classification_outbox.worker_job_id=EXCLUDED.worker_job_id THEN signal_topic_classification_outbox.attempt_count ELSE 0 END,available_at=clock_timestamp(),completed_at=NULL,dispatched_at=NULL,error_code=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
    WHERE (signal_topic_classification_outbox.worker_job_id<>EXCLUDED.worker_job_id OR signal_topic_classification_outbox.attempt_count<8)
     AND (signal_topic_classification_outbox.status IN('completed','failed','dead_letter') AND signal_topic_classification_outbox.available_at<=clock_timestamp()
     OR signal_topic_classification_outbox.status='dispatched' AND signal_topic_classification_outbox.updated_at<clock_timestamp()-interval '180 seconds') RETURNING id`,
   [row.id,row.workspace_id,job]).then(result=>{scheduled+=result.rowCount??0;});
  }return scheduled;
 });
}

/** Delivery heartbeat only. A direct UPDATE avoids engine/input/taxonomy locks
 * while the materializer's independent transaction consumes local packet files. */
export async function heartbeatSignalWorkspaceEngineProgressDispatchV1(args:SignalWorkspaceEngineProgressReadArgsV1&{worker_job_id:string}):Promise<void>{
 const result=await args.database.query(`UPDATE signal_topic_classification_outbox dispatch SET updated_at=clock_timestamp()
  FROM signal_topic_catalog_executions execution WHERE dispatch.execution_id=execution.id AND dispatch.workspace_id=execution.workspace_id
   AND dispatch.execution_id=$1::uuid AND dispatch.workspace_id=$2::uuid AND dispatch.dispatch_kind='engine_progress'
   AND dispatch.worker_job_id=$3 AND dispatch.status IN('dispatching','dispatched')
   AND execution.actor_user_id=$4::uuid AND execution.input_contract='workspace-topic-engine-v1'
   AND execution.status IN('running','failed','ready') AND execution.result_summary ? 'fit_checkpoint'
   AND signal_workspace_classification_actor_v1(execution.workspace_id,execution.actor_user_id)
   AND execution.input_revision=(SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=execution.workspace_id)
   AND (execution.policy_valid_until IS NULL OR execution.policy_valid_until>clock_timestamp()) RETURNING dispatch.id`,
 [args.execution_id,args.workspace_id,args.worker_job_id,args.actor_user_id]);
 if(result.rowCount!==1)return fail('workspace_engine_progress_dispatch_lost');
}

/** An explicit delivery retry remains separate from the editorial/provider run.
 * It cannot create the first progress outbox before the deployment gate opens. */
export async function retrySignalWorkspaceEngineProgressV1(args:SignalWorkspaceEngineProgressReadArgsV1&{idempotency_key:string}):Promise<{execution_id:string;worker_job_id:string;replayed:boolean}>{
 if(!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key))return fail('workspace_engine_request_invalid',422);
 return tx(args.database,async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`signal-taxonomy:${args.workspace_id}:topic`]);
  const current=await source(client,args),request_digest=digest({action:'retry_progress',execution_id:args.execution_id});
  const prior=(await client.query<{id:string;alias:{actor_user_id:string;request_digest:string;worker_job_id:string}|null}>(`SELECT id,engine_request_keys->$2 alias FROM signal_topic_catalog_executions
   WHERE workspace_id=$1::uuid AND (idempotency_key=$2 OR engine_request_keys ? $2)`,[args.workspace_id,args.idempotency_key])).rows[0];
  if(prior){if(prior.id!==args.execution_id||prior.alias?.actor_user_id!==args.actor_user_id||prior.alias.request_digest!==request_digest||!prior.alias.worker_job_id)
    return fail('workspace_engine_idempotency_conflict');
   return{execution_id:args.execution_id,worker_job_id:prior.alias.worker_job_id,replayed:true};}
  if(!current.needs_materialization)return fail('workspace_engine_progress_retry_unavailable');
  const existing=(await client.query<{id:string;status:string}>(`SELECT id,status FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid
   AND workspace_id=$2::uuid AND dispatch_kind='engine_progress' FOR UPDATE`,[args.execution_id,args.workspace_id])).rows[0];
  if(!existing||!['failed','dead_letter'].includes(existing.status))return fail('workspace_engine_progress_retry_unavailable');
  const job=`workspace-progress-${args.execution_id}-${current.catalog_profile_id}-${current.coverage.unit_digest.slice(7)}`;
  const alias={actor_user_id:args.actor_user_id,request_digest,worker_job_id:job};
  await client.query(`UPDATE signal_topic_catalog_executions SET engine_request_keys=engine_request_keys||jsonb_build_object($2::text,$3::jsonb) WHERE id=$1::uuid`,
   [args.execution_id,args.idempotency_key,JSON.stringify(alias)]);
  await client.query(`UPDATE signal_topic_classification_outbox SET status='pending',worker_job_id=$2,attempt_count=0,
   available_at=clock_timestamp(),completed_at=NULL,dispatched_at=NULL,error_code=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid`,[existing.id,job]);
  return{execution_id:args.execution_id,worker_job_id:job,replayed:false};
 });
}

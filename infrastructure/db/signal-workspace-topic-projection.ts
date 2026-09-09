import type {PoolClient} from 'pg';
import {signalWorkspaceEmbeddingDigestV1 as digest,type SignalTopicDefinitionV1,type SignalWorkspaceClassificationIdentityV1} from '@noisia/query-engine';
import {loadSignalWorkspaceCapabilitiesStoreV1} from './signal-workspace-capabilities';
import {loadSignalWorkspaceEngineInputIdentityV1,type SignalWorkspaceEngineSnapshotV1} from './signal-workspace-engine';
import {beginSignalWorkspaceClassificationWithClientV1,claimSignalWorkspaceClassificationV1,heartbeatSignalWorkspaceClassificationV1,
 loadSignalWorkspaceClassificationInputV1,SignalWorkspaceClassificationError,
 type SignalWorkspaceClassificationDatabaseV1,type SignalWorkspaceClassificationLeaseV1,type SignalWorkspaceClassificationProjectionV1} from './signal-workspace-classification';

export const SIGNAL_WORKSPACE_TOPIC_PROJECTION_JOB_V1='signal_workspace_topic_projection_v1' as const;
export const SIGNAL_WORKSPACE_TOPIC_PROJECTION_POLICY_V1={contract_version:'workspace-topic-projection-v1',
 population:'all-prepared-eligible-roots',aggregation:'all-chunks-open-and-guided-root-topic-union-v1',approval:'none',membership_basis:'computed_cluster'} as const;
export type SignalWorkspaceProjectionQueryableV1={query<R extends Record<string,unknown>>(sql:string,params?:unknown[]):Promise<{rows:R[]}>};
export type SignalWorkspaceTopicProjectionArtifactV1={artifact_id:string;artifact_key:string;artifact_type:string;
 content:{storage_key:string;sha256:string;size_bytes:number;media_type:string};metadata:Record<string,unknown>};
export type SignalWorkspaceTopicProjectionSourceV1=SignalWorkspaceClassificationProjectionV1&{artifacts:SignalWorkspaceTopicProjectionArtifactV1[]};
export type SignalWorkspaceTopicProjectionRunV1={execution_id:string;generation_id:string;source_engine_execution_id:string;
 status:'queued'|'running'|'ready'|'failed';is_current:boolean;complete:boolean;denominator:number;processed_roots:number;expected_chunks:number;processed_chunks:number;
 error_code:string|null;computed_at:string|null;taxonomy_profile_id:string;mapping_digest:string;model_version_id:string|null};
export type SignalWorkspaceTopicProjectionStatusV1={contract_version:'signal-workspace-topic-projection-v1';workspace_id:string;observed_at:string;
 latest_run:SignalWorkspaceTopicProjectionRunV1|null;latest_complete:SignalWorkspaceTopicProjectionRunV1|null};
const fail=(code:string,status=409):never=>{throw new SignalWorkspaceClassificationError(code,status);};
const contract='workspace-topic-classification-v1';
async function tx<T>(database:SignalWorkspaceClassificationDatabaseV1,work:(client:PoolClient)=>Promise<T>,readOnly=false){
 const client=await database.connect();try{await client.query(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');
  await client.query('SET LOCAL search_path=public,extensions,pg_temp');await client.query("SET LOCAL TIME ZONE 'UTC'");
  const result=await work(client);await client.query('COMMIT');return result;
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
async function authorize(queryable:SignalWorkspaceProjectionQueryableV1,workspace_id:string,actor_user_id:string,execute:boolean){
 const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable,workspace_id,actor_user_id});
 if(!caps.can_view||execute&&!caps.can_execute_topics)return fail('workspace_projection_forbidden',403);
}
const artifactSQL=`SELECT id artifact_id,artifact_key,artifact_type,content,metadata FROM analysis_artifacts`;
export type SignalWorkspaceTopicProjectionRequestV1={workspace_id:string;actor_user_id:string;engine_execution_id:string;idempotency_key:string;materialization_artifact_id?:string};
export async function requestSignalWorkspaceTopicProjectionV1(args:SignalWorkspaceTopicProjectionRequestV1&{database:SignalWorkspaceClassificationDatabaseV1}){
 return tx(args.database,client=>requestSignalWorkspaceTopicProjectionWithClientV1(client,args));
}
export async function requestSignalWorkspaceTopicProjectionWithClientV1(client:PoolClient,args:SignalWorkspaceTopicProjectionRequestV1){
 if(!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key))return fail('workspace_projection_request_invalid',422);
  await authorize(client,args.workspace_id,args.actor_user_id,true);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`signal-taxonomy:${args.workspace_id}:topic`]);
  const prior=(await client.query<{id:string;generation_id:string;actor_user_id:string;input_contract:string;worker_job_id:string;source:SignalWorkspaceClassificationProjectionV1}>(`
   SELECT execution.id,execution.generation_id,execution.actor_user_id,execution.input_contract,outbox.worker_job_id,execution.input_snapshot->'source_projection' source FROM signal_topic_catalog_executions execution
   LEFT JOIN signal_topic_classification_outbox outbox ON outbox.execution_id=execution.id AND outbox.dispatch_kind='execution'
   WHERE execution.workspace_id=$1::uuid AND execution.idempotency_key=$2`,[args.workspace_id,args.idempotency_key])).rows[0];
  if(prior){if(prior.input_contract!==contract||prior.source?.contract_version!=='workspace-topic-projection-v1'||prior.actor_user_id!==args.actor_user_id||prior.source?.engine_execution_id!==args.engine_execution_id||args.materialization_artifact_id&&prior.source.materialization_artifact_id!==args.materialization_artifact_id)return fail('workspace_projection_idempotency_conflict');
   return{execution_id:prior.id,generation_id:prior.generation_id,worker_job_id:prior.worker_job_id??`workspace-classification-${prior.id}`,replayed:true};}
  await client.query('SELECT workspace_id FROM signal_corpus_preparation_input_state WHERE workspace_id=$1::uuid FOR UPDATE',[args.workspace_id]);
  const engine=(await client.query<{id:string;embedding_run_id:string;input_digest:string;input_snapshot:SignalWorkspaceEngineSnapshotV1;result_summary:{
   fit_checkpoint:{model_artifact_id:string|null;output_artifact_id:string;result_kind:string};analysis_checkpoint:{materialization_artifact_id:string;output_catalog_profile_id:string;mapping_digest:string}}}>(`
   SELECT execution.id,execution.embedding_run_id,execution.input_digest,execution.input_snapshot,execution.result_summary
   FROM signal_topic_catalog_executions execution JOIN signal_corpus_preparation_input_state state USING(workspace_id)
   WHERE execution.id=$1::uuid AND execution.workspace_id=$2::uuid AND execution.input_contract='workspace-topic-engine-v1' AND (execution.status='ready' OR $3::uuid IS NOT NULL AND execution.status IN('running','failed'))
    AND execution.input_revision=state.input_revision AND (execution.policy_valid_until IS NULL OR execution.policy_valid_until>clock_timestamp()) FOR UPDATE OF execution`,
   [args.engine_execution_id,args.workspace_id,args.materialization_artifact_id??null])).rows[0];
  if(!engine?.result_summary.fit_checkpoint||!engine.result_summary.analysis_checkpoint&&!args.materialization_artifact_id)return fail('workspace_projection_analysis_required');
  const current=await loadSignalWorkspaceEngineInputIdentityV1({queryable:client,workspace_id:args.workspace_id,actor_user_id:args.actor_user_id});
  if(current.context_digest!==engine.input_snapshot.context_digest||current.catalog_digest!==engine.input_snapshot.catalog_digest)return fail('workspace_projection_inputs_stale');
  const input=await loadSignalWorkspaceClassificationInputV1({queryable:client,workspace_id:args.workspace_id,actor_user_id:args.actor_user_id});
  const fit=engine.result_summary.fit_checkpoint;
  const progress=args.materialization_artifact_id ? (await client.query<SignalWorkspaceTopicProjectionArtifactV1>(`${artifactSQL}
   WHERE id=$1::uuid AND workspace_id=$2::uuid AND engine_execution_id=$3::uuid AND artifact_type='engine_proposals'
    AND metadata->>'contract_version'='workspace-topic-materialization-progress-v1'`,[args.materialization_artifact_id,args.workspace_id,engine.id])).rows[0] : null;
  if(args.materialization_artifact_id&&!progress)return fail('workspace_projection_artifacts_required');
  const analysis=progress ? {materialization_artifact_id:progress.artifact_id,output_catalog_profile_id:String(progress.metadata.output_catalog_profile_id),mapping_digest:String(progress.metadata.mapping_digest)} : engine.result_summary.analysis_checkpoint;
  if(input.taxonomy_profile_id!==analysis.output_catalog_profile_id)return fail('workspace_projection_catalog_changed');
  const refs=(await client.query<SignalWorkspaceTopicProjectionArtifactV1>(`${artifactSQL} WHERE workspace_id=$1::uuid AND engine_execution_id=$2::uuid
   AND id=ANY($3::uuid[])`,[args.workspace_id,engine.id,[fit.output_artifact_id,analysis.materialization_artifact_id,...(fit.model_artifact_id?[fit.model_artifact_id]:[])]] )).rows;
  const model=refs.find(ref=>ref.artifact_id===fit.model_artifact_id),output=refs.find(ref=>ref.artifact_id===fit.output_artifact_id),materialization=refs.find(ref=>ref.artifact_id===analysis.materialization_artifact_id);
  if(!output||!materialization||fit.model_artifact_id&&!model||materialization.metadata.mapping_digest!==analysis.mapping_digest)return fail('workspace_projection_artifacts_required');
  // A complete progressive projection already covers the identical output. Final
  // editorial promotion reuses it rather than racing a second same-profile run.
  if(!progress){const existing=(await client.query<{execution_id:string;generation_id:string;worker_job_id:string}>(`SELECT execution.id execution_id,execution.generation_id,outbox.worker_job_id
   FROM signal_topic_catalog_executions execution JOIN signal_classification_generations generation ON generation.id=execution.generation_id
   JOIN signal_topic_classification_outbox outbox ON outbox.execution_id=execution.id AND outbox.dispatch_kind='execution'
   WHERE execution.workspace_id=$1::uuid AND execution.taxonomy_profile_id=$2::uuid AND execution.actor_user_id=$3::uuid
    AND execution.status IN('queued','running','ready') AND execution.input_contract='workspace-topic-classification-v1'
    AND execution.input_snapshot->'source_projection'->>'engine_execution_id'=$4
    AND execution.input_snapshot->'source_projection'->>'mapping_digest'=$5
    AND execution.input_snapshot->'source_projection'->'interpretation_coverage'->>'complete'='true'
    AND signal_workspace_projection_source_current_v1(generation) ORDER BY execution.created_at DESC LIMIT 1`,
   [args.workspace_id,input.taxonomy_profile_id,args.actor_user_id,engine.id,analysis.mapping_digest])).rows[0];
   if(existing)return{...existing,replayed:true};}
  const identity:SignalWorkspaceClassificationIdentityV1={contract_version:'signal-workspace-classification-v1',workspace_id:args.workspace_id,
   engine_key:'workspace-computed-cluster-projection',engine_version:1,engine_artifact_digest:model?.content.sha256??output.content.sha256,
   embedding_config_digest:input.embedding_config_digest,catalog_digest:input.catalog_digest,compiler_digest:input.compiler_digest,
   context_digest:input.context_digest,decision_policy_digest:digest(SIGNAL_WORKSPACE_TOPIC_PROJECTION_POLICY_V1)};
  let model_version_id:string|null=null;
  if(model){const config={contract_version:'workspace-topic-projection-v1',engine_execution_id:engine.id,model_artifact_id:model.artifact_id,
    materialization_artifact_id:materialization.artifact_id,mapping_digest:analysis.mapping_digest,workspace_classification_identity:identity,approval_policy:'none'};
   const seal=digest(config);
   model_version_id=(await client.query<{model_version_id:string}>(`SELECT model_version_id FROM register_signal_tagging_model_v1(
    $1::uuid,$2::uuid,$3,$4,'workspace-python',NULL,$5,'python','workspace-model-bundle-v1',$6::jsonb,$7,$8,NULL,NULL,$7,NULL,$9::uuid,$7,$7)`,
    [args.workspace_id,input.taxonomy_profile_id,`workspace-projection:${args.workspace_id}`,`${engine.id}:${input.taxonomy_profile_id}:${materialization.artifact_id}`,model.content.sha256,JSON.stringify(config),seal,engine.input_digest,args.actor_user_id])).rows[0]!.model_version_id;}
  const source:SignalWorkspaceClassificationProjectionV1={contract_version:'workspace-topic-projection-v1',engine_execution_id:engine.id,
   model_artifact_id:model?.artifact_id??null,output_artifact_id:output.artifact_id,materialization_artifact_id:materialization.artifact_id,
   mapping_digest:analysis.mapping_digest,policy_digest:identity.decision_policy_digest,model_version_id,
   ...(progress ? {interpretation_coverage:{interpreted_unit_count:Number(progress.metadata.interpreted_unit_count),
     expected_unit_count:Number(progress.metadata.expected_interpretation_unit_count),unit_digest:String(progress.metadata.interpretation_units_digest),
     expected_unit_digest:String(progress.metadata.expected_interpretation_units_digest),complete:progress.metadata.interpretation_complete===true}} : {})};
  const created=await beginSignalWorkspaceClassificationWithClientV1(client,{...args,identity,embedding_run_id:engine.embedding_run_id,source_projection:source});
  await client.query(`INSERT INTO signal_topic_classification_outbox(execution_id,workspace_id,worker_job_id) VALUES($1::uuid,$2::uuid,$3)
   ON CONFLICT(execution_id,dispatch_kind) DO NOTHING`,[created.execution_id,args.workspace_id,created.worker_job_id]);
  return created;
}
async function sourceFor(queryable:SignalWorkspaceProjectionQueryableV1,lease:SignalWorkspaceClassificationLeaseV1){
 const row=(await queryable.query<{source:SignalWorkspaceClassificationProjectionV1}>(`SELECT input_snapshot->'source_projection' source
  FROM signal_topic_catalog_executions WHERE id=$1::uuid AND workspace_id=$2::uuid AND input_contract=$3 AND execution_token=$4::uuid
   AND status='running' AND execution_expires_at>clock_timestamp() AND input_digest=$5 AND cursor_root_id IS NOT DISTINCT FROM $6::uuid
   AND signal_workspace_classification_actor_v1(workspace_id,actor_user_id)
   AND input_revision=(SELECT state.input_revision FROM signal_corpus_preparation_input_state state WHERE state.workspace_id=signal_topic_catalog_executions.workspace_id)
   AND (policy_valid_until IS NULL OR policy_valid_until>clock_timestamp())`,
  [lease.execution_id,lease.workspace_id,contract,lease.execution_token,lease.input_digest,lease.cursor_root_id])).rows[0];
 if(!row?.source)return fail('workspace_projection_lease_lost');return row.source;
}
export async function claimSignalWorkspaceTopicProjectionV1(args:{database:SignalWorkspaceClassificationDatabaseV1;execution_id:string;worker_job_id:string}){
 const lease=await claimSignalWorkspaceClassificationV1(args);if(!lease)return null;
 try{return await tx(args.database,async client=>{const source=await sourceFor(client,lease);
  const artifacts=(await client.query<SignalWorkspaceTopicProjectionArtifactV1>(`${artifactSQL} WHERE workspace_id=$1::uuid AND engine_execution_id=$2::uuid
   AND (artifact_type IN('engine_output','engine_model') OR id=$3::uuid) ORDER BY artifact_key LIMIT 35`,
   [lease.workspace_id,source.engine_execution_id,source.materialization_artifact_id])).rows;
  if(artifacts.length>34)return fail('workspace_projection_artifact_capacity');
  return{lease,source:{...source,artifacts},model_version_id:source.model_version_id};
 });}catch(error){throw error;}
}
export const heartbeatSignalWorkspaceTopicProjectionV1=heartbeatSignalWorkspaceClassificationV1;
export async function readSignalWorkspaceTopicProjectionTopicsV1(args:{database:SignalWorkspaceClassificationDatabaseV1;lease:SignalWorkspaceClassificationLeaseV1;after_term_key:string|null;limit?:number}){
 const limit=args.limit??128;if(!Number.isInteger(limit)||limit<1||limit>128)return fail('workspace_projection_page_invalid',422);
 await heartbeatSignalWorkspaceClassificationV1(args);
 return tx(args.database,async client=>{await sourceFor(client,args.lease);
  const rows=(await client.query<{taxonomy_term_id:string;definition:SignalTopicDefinitionV1}>(`SELECT term.id taxonomy_term_id,term.metadata->'topic' definition
   FROM signal_topic_catalog_executions execution JOIN signal_taxonomy_profiles profile ON profile.id=execution.taxonomy_profile_id
   JOIN taxonomy_terms term ON term.taxonomy_id=profile.taxonomy_id
   WHERE execution.id=$1::uuid AND ($2::text IS NULL OR term.term_key> $2 COLLATE "C")
   ORDER BY term.term_key COLLATE "C" LIMIT $3`,[args.lease.execution_id,args.after_term_key,limit+1])).rows;
  const items=rows.slice(0,limit).map(row=>({...row,term_key:row.definition.term_key,definition_digest:row.definition.definition_digest,definition_revision:row.definition.definition_revision}));
  return{items,next_term_key:items.at(-1)?.term_key??args.after_term_key,done:rows.length<=limit};
 });
}
export async function readSignalWorkspaceTopicProjectionProposalsV1(args:{database:SignalWorkspaceClassificationDatabaseV1;lease:SignalWorkspaceClassificationLeaseV1;after_artifact_id:string|null;limit?:number}){
 const limit=args.limit??32;if(!Number.isInteger(limit)||limit<1||limit>32)return fail('workspace_projection_page_invalid',422);
 await heartbeatSignalWorkspaceClassificationV1(args);
 return tx(args.database,async client=>{const source=await sourceFor(client,args.lease);
  const rows=(await client.query<SignalWorkspaceTopicProjectionArtifactV1>(`${artifactSQL} WHERE workspace_id=$1::uuid AND engine_execution_id=$2::uuid
   AND artifact_type='engine_proposals' AND metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1'
   AND ($3::uuid IS NULL OR id>$3::uuid) ORDER BY id LIMIT $4`,[args.lease.workspace_id,source.engine_execution_id,args.after_artifact_id,limit+1])).rows;
  const items=rows.slice(0,limit);return{items,next_artifact_id:items.at(-1)?.artifact_id??args.after_artifact_id,done:rows.length<=limit};
 });
}
export async function loadSignalWorkspaceTopicProjectionStatusWithQueryableV1(args:{queryable:SignalWorkspaceProjectionQueryableV1;workspace_id:string;actor_user_id:string}):Promise<SignalWorkspaceTopicProjectionStatusV1>{
 await authorize(args.queryable,args.workspace_id,args.actor_user_id,false);
 const observed=(await args.queryable.query<{observed_at:string}>(`SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') observed_at`)).rows[0]!.observed_at;
 const rows=(await args.queryable.query<SignalWorkspaceTopicProjectionRunV1&{identity:SignalWorkspaceClassificationIdentityV1;correction_digest:string;generation_version:number;source_current:boolean}>(`WITH runs AS(
  SELECT execution.id execution_id,generation.id generation_id,generation.taxonomy_profile_id,generation.generation_version,execution.status,
   generation.input_snapshot->'source_projection'->>'engine_execution_id' source_engine_execution_id,
   generation.input_snapshot->'source_projection'->>'mapping_digest' mapping_digest,generation.input_snapshot->'source_projection'->>'model_version_id' model_version_id,
   generation.input_snapshot->'identity' identity,generation.input_snapshot->>'correction_digest' correction_digest,generation.denominator,execution.processed_roots,
   execution.expected_chunks::int expected_chunks,execution.processed_chunks::int processed_chunks,execution.error_code,
   to_char(generation.finalized_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') computed_at,
   generation.status='ready' AND NOT EXISTS(SELECT 1 FROM signal_classification_generation_items item WHERE item.generation_id=generation.id AND item.resolution_state='error') complete,
   generation.input_revision=state.input_revision AND (generation.policy_valid_until IS NULL OR generation.policy_valid_until>clock_timestamp())
    AND signal_workspace_projection_source_current_v1(generation)
    AND NOT EXISTS(SELECT 1 FROM signal_classification_assignments assignment WHERE assignment.generation_id=generation.id
     AND NOT signal_workspace_classification_assignment_current_v1(assignment,generation)) source_current
  FROM signal_topic_catalog_executions execution JOIN signal_classification_generations generation ON generation.id=execution.generation_id
  JOIN signal_corpus_preparation_input_state state ON state.workspace_id=generation.workspace_id
  WHERE execution.workspace_id=$1::uuid AND execution.input_contract=$2 AND generation.input_snapshot->'source_projection' IS NOT NULL)
 SELECT * FROM runs WHERE execution_id=(SELECT execution_id FROM runs ORDER BY generation_version DESC LIMIT 1)
  OR execution_id=(SELECT execution_id FROM runs WHERE complete ORDER BY generation_version DESC LIMIT 1) ORDER BY generation_version DESC`,[args.workspace_id,contract])).rows;
 let current:Awaited<ReturnType<typeof loadSignalWorkspaceClassificationInputV1>>|null=null;
 if(rows.length){try{current=await loadSignalWorkspaceClassificationInputV1(args);}catch(error){if(!(error instanceof SignalWorkspaceClassificationError)||error.code!=='workspace_classification_catalog_unavailable')throw error;}}
 const views=rows.map(({identity,correction_digest,generation_version:_version,source_current,...row})=>({...row,is_current:Boolean(source_current&&current
  &&current.catalog_digest===identity.catalog_digest&&current.compiler_digest===identity.compiler_digest
  &&current.context_digest===identity.context_digest&&current.embedding_config_digest===identity.embedding_config_digest&&current.correction_digest===correction_digest)}));
 return{contract_version:'signal-workspace-topic-projection-v1',workspace_id:args.workspace_id,observed_at:observed,latest_run:views[0]??null,latest_complete:views.find(row=>row.complete)??null};
}
export async function loadSignalWorkspaceTopicProjectionStatusV1(args:{database:SignalWorkspaceClassificationDatabaseV1;workspace_id:string;actor_user_id:string}){
 return tx(args.database,queryable=>loadSignalWorkspaceTopicProjectionStatusWithQueryableV1({...args,queryable}),true);
}
export async function scheduleSignalWorkspaceTopicProjectionsV1(args:{database:SignalWorkspaceClassificationDatabaseV1;limit?:number}){
 const limit=args.limit??20;if(!Number.isInteger(limit)||limit<1||limit>100)return fail('workspace_projection_page_invalid',422);
 return tx(args.database,async client=>{const rows=(await client.query<{id:string;status:string;dispatch_generation:number;worker_job_id:string}>(`
  SELECT execution.id,execution.status,execution.dispatch_generation,outbox.worker_job_id FROM signal_topic_catalog_executions execution
  JOIN signal_topic_classification_outbox outbox ON outbox.execution_id=execution.id AND outbox.dispatch_kind='execution' WHERE execution.input_contract=$1
   AND execution.input_snapshot->'source_projection' IS NOT NULL AND ((execution.status='running' AND execution.execution_expires_at<=clock_timestamp())
    OR(execution.status='queued' AND outbox.status='dispatched' AND outbox.updated_at<clock_timestamp()-interval '30 seconds'))
  ORDER BY execution.updated_at,execution.id FOR UPDATE OF execution SKIP LOCKED LIMIT $2`,[contract,limit])).rows;
  for(const row of rows){const generation=row.dispatch_generation+(row.status==='running'?1:0);
   await client.query(`UPDATE signal_topic_catalog_executions SET status='queued',execution_token=NULL,execution_expires_at=NULL,error_code=NULL,
    completed_at=NULL,dispatch_generation=$2,updated_at=clock_timestamp() WHERE id=$1::uuid`,[row.id,generation]);
   await client.query(`UPDATE signal_topic_classification_outbox SET status='pending',worker_job_id=$2,attempt_count=0,available_at=clock_timestamp(),
    lease_token=NULL,lease_expires_at=NULL,completed_at=NULL,error_code=NULL,updated_at=clock_timestamp() WHERE dispatch_kind='execution' AND execution_id=$1::uuid`,
    [row.id,row.status==='running'?`workspace-classification-${row.id}-${generation}`:row.worker_job_id]);}
  return{requeued:rows.length};
 });
}

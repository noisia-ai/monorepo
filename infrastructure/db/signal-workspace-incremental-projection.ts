import type {PoolClient} from 'pg';
import type {SignalWorkspaceIncrementalProjectionSourceV1,SignalWorkspaceIncrementalUnitBindingV1,
 SignalWorkspaceIncrementalProjectionProposalV1,SignalWorkspaceIncrementalProjectionTopicV1,
 SignalWorkspaceClassificationIdentityV1,SignalWorkspaceIncrementalRootV1} from '@noisia/query-engine';
import {signalWorkspaceEmbeddingDigestV1 as digest,signalWorkspaceIncrementalProjectionSourceSchemaV1} from '@noisia/query-engine';
import {loadSignalWorkspaceCapabilitiesStoreV1} from './signal-workspace-capabilities';
import {loadSignalWorkspaceEngineInputIdentityV1,withSignalWorkspaceEngineTransactionV1,
 persistSignalWorkspaceEngineArtifactWithClientV1,
 type SignalWorkspaceEngineDatabaseV1,type SignalWorkspaceEngineArtifactV1,type SignalWorkspaceEngineSnapshotV1} from './signal-workspace-engine';
import type {SignalWorkspaceIncrementalCheckpointV1,SignalWorkspaceIncrementalArtifactRefV1} from './signal-workspace-engine-incremental';
import {readSignalWorkspaceNumericRecoveryWithQueryableV1} from './signal-workspace-engine-incremental';
import {loadSignalWorkspaceClassificationInputV1,beginSignalWorkspaceClassificationWithClientV1,claimSignalWorkspaceClassificationV1,failSignalWorkspaceClassificationV1,SignalWorkspaceClassificationError,
 type SignalWorkspaceClassificationLeaseV1} from './signal-workspace-classification';

export const SIGNAL_WORKSPACE_INCREMENTAL_PROJECTION_JOB_V1='signal_workspace_incremental_projection_v1' as const;
export const SIGNAL_WORKSPACE_INCREMENTAL_DERIVATION_JOB_V1='signal_workspace_incremental_derivation_v1' as const;
export const SIGNAL_WORKSPACE_INCREMENTAL_PROJECTION_POLICY_V1={contract_version:'workspace-topic-incremental-projection-v1',
 population:'all-current-prepared-roots',membership:'frozen-component-current-occurrences',historical_editorial:'sealed-parent-cuts',approval:'none'} as const;
/** This is a derived outbox scope, never a numerical or provider lease. */
export type SignalWorkspaceIncrementalProjectionScopeV1={execution_id:string;workspace_id:string;actor_user_id:string;worker_job_id:string};
export type SignalWorkspaceIncrementalProjectionResultV1={binding_artifact_id:string;projection_execution_id:string;generation_id:string;replayed:boolean};
export type SignalWorkspaceIncrementalProjectionDerivationV1=SignalWorkspaceIncrementalProjectionScopeV1&{
 derivation_digest:string;input_digest:string;snapshot:SignalWorkspaceEngineSnapshotV1;numeric_checkpoint:SignalWorkspaceIncrementalCheckpointV1;
 catalog_profile_id:string;identity:SignalWorkspaceClassificationIdentityV1;correction_digest:string;editorial_cut_digest:string;
 artifacts:SignalWorkspaceIncrementalArtifactRefV1[];completed_projection:SignalWorkspaceIncrementalProjectionResultV1|null;
};
export type SignalWorkspaceIncrementalProjectionReadV1=SignalWorkspaceIncrementalProjectionScopeV1&{database:SignalWorkspaceEngineDatabaseV1;derivation_digest:string};
export type SignalWorkspaceIncrementalProjectionSummaryV1={binding_digest:string;editorial_cut_digest:string;
 interpretation_coverage:SignalWorkspaceIncrementalProjectionSourceV1['interpretation_coverage'];
 discovery_coverage:SignalWorkspaceIncrementalProjectionSourceV1['discovery_coverage'];};
export type SignalWorkspaceIncrementalProjectionBindingPageArgsV1=SignalWorkspaceIncrementalProjectionReadV1&{
 artifact:SignalWorkspaceEngineArtifactV1;summary:SignalWorkspaceIncrementalProjectionSummaryV1;bindings:readonly SignalWorkspaceIncrementalUnitBindingV1[];};
export type SignalWorkspaceIncrementalProjectionProposalRefV1=Omit<SignalWorkspaceIncrementalProjectionProposalV1,'body'>&SignalWorkspaceIncrementalArtifactRefV1;
type Queryable=Pick<PoolClient,'query'>;
const fail=(code:string,status=409):never=>{throw new SignalWorkspaceClassificationError(`workspace_incremental_projection_${code}`,status);};
const limitOf=(value:number|undefined,max:number)=>{const limit=value??max;if(!Number.isSafeInteger(limit)||limit<1||limit>max)return fail('page_invalid',422);return limit;};
const refColumns=`artifact.id artifact_id,artifact.engine_execution_id owner_execution_id,artifact.artifact_key,
 artifact.content->>'storage_key' storage_key,artifact.content->>'sha256' sha256,(artifact.content->>'size_bytes')::bigint::float8 size_bytes,
 artifact.content->>'media_type' media_type,artifact.metadata`;
const names=['manifest.json','roots.jsonl','population.jsonl','memberships.jsonl','pending-cohort.jsonl','model-components.json'];
async function authority(client:Queryable,args:Pick<SignalWorkspaceIncrementalProjectionScopeV1,'workspace_id'|'actor_user_id'>){
 if(!(await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,...args})).can_execute_topics)return fail('forbidden',403);
}
async function source(client:PoolClient,args:SignalWorkspaceIncrementalProjectionScopeV1,requireDispatch=true):Promise<SignalWorkspaceIncrementalProjectionDerivationV1>{
 await authority(client,args);
 const run=(await client.query<{id:string;input_digest:string;input_snapshot:SignalWorkspaceEngineSnapshotV1;checkpoint:SignalWorkspaceIncrementalCheckpointV1}>(`
  SELECT engine.id,engine.input_digest,engine.input_snapshot-'guides' input_snapshot,engine.result_summary->'numeric_checkpoint' checkpoint
  FROM signal_topic_catalog_executions engine LEFT JOIN signal_topic_classification_outbox dispatch ON dispatch.execution_id=engine.id
   AND dispatch.workspace_id=engine.workspace_id AND dispatch.dispatch_kind='incremental_projection'
  WHERE engine.id=$1::uuid AND engine.workspace_id=$2::uuid AND engine.actor_user_id=$3::uuid AND engine.status='ready'
   AND (NOT $5::boolean OR dispatch.worker_job_id=$4 AND dispatch.status IN('dispatching','dispatched','completed'))
   AND engine.input_revision=(SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=engine.workspace_id)
   AND (engine.policy_valid_until IS NULL OR engine.policy_valid_until>clock_timestamp())
   AND signal_workspace_incremental_execution_current_v1(engine.id)
   AND signal_workspace_incremental_projection_history_current_v1(engine.id)
   AND NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions newer WHERE newer.workspace_id=engine.workspace_id
    AND newer.input_snapshot ? 'numeric_descriptor' AND newer.status='ready' AND newer.input_revision=engine.input_revision
    AND (newer.created_at,newer.id)>(engine.created_at,engine.id))`,[args.execution_id,args.workspace_id,args.actor_user_id,args.worker_job_id,requireDispatch])).rows[0];
 if(!run?.checkpoint)return fail('source_unavailable');
 const current=await loadSignalWorkspaceEngineInputIdentityV1({queryable:client,...args});
 if(current.context_digest!==run.input_snapshot.context_digest||current.catalog_digest!==run.input_snapshot.catalog_digest)return fail('inputs_changed');
 const input=await loadSignalWorkspaceClassificationInputV1({queryable:client,...args});
 const artifacts=(await client.query<SignalWorkspaceIncrementalArtifactRefV1>(`SELECT ${refColumns} FROM analysis_artifacts artifact
  WHERE artifact.workspace_id=$1::uuid AND artifact.engine_execution_id=$2::uuid AND artifact.artifact_key=ANY($3::text[]) ORDER BY artifact.artifact_key`,
  [args.workspace_id,args.execution_id,names])).rows;
 if(artifacts.length!==names.length)return fail('artifacts_missing');
 const bank=run.checkpoint.model_bank_artifact_id?(await client.query<{sha256:string}>(`SELECT content->>'sha256' sha256 FROM analysis_artifacts
  WHERE id=$1::uuid AND workspace_id=$2::uuid AND engine_execution_id=$3::uuid`,[run.checkpoint.model_bank_artifact_id,args.workspace_id,args.execution_id])).rows[0]:null;
 const identity:SignalWorkspaceClassificationIdentityV1={contract_version:'signal-workspace-classification-v1',workspace_id:args.workspace_id,
  engine_key:'workspace-incremental-cluster-projection',engine_version:1,engine_artifact_digest:bank?.sha256??artifacts.find(ref=>ref.artifact_id===run.checkpoint.output_artifact_id)!.sha256,
  embedding_config_digest:input.embedding_config_digest,catalog_digest:input.catalog_digest,compiler_digest:input.compiler_digest,
  context_digest:input.context_digest,decision_policy_digest:digest(SIGNAL_WORKSPACE_INCREMENTAL_PROJECTION_POLICY_V1)};
 const editorial=(await client.query<{digest:string}>('SELECT signal_workspace_incremental_projection_editorial_digest_v1($1::uuid) digest',[run.id])).rows[0]!.digest;
 const derivation_digest=digest({engine_execution_id:run.id,numeric_checkpoint_digest:run.checkpoint.checkpoint_digest,
  catalog_profile_id:input.taxonomy_profile_id,identity,correction_digest:input.correction_digest,editorial_cut_digest:editorial});
 const completed=(await client.query<{binding_artifact_id:string;projection_execution_id:string;generation_id:string}>(`SELECT binding.id binding_artifact_id,
  projection.id projection_execution_id,projection.generation_id FROM analysis_artifacts binding
  JOIN signal_topic_catalog_executions projection ON projection.workspace_id=binding.workspace_id
   AND projection.input_snapshot->'source_projection'->>'binding_artifact_id'=binding.id::text
  WHERE binding.engine_execution_id=$1::uuid AND binding.workspace_id=$2::uuid AND binding.metadata->>'derivation_digest'=$3
   AND binding.metadata->>'contract_version'='workspace-incremental-binding-index-v1' ORDER BY projection.created_at DESC LIMIT 1`,[run.id,args.workspace_id,derivation_digest])).rows[0];
 return{...args,derivation_digest,input_digest:run.input_digest,snapshot:run.input_snapshot,numeric_checkpoint:run.checkpoint,
  catalog_profile_id:input.taxonomy_profile_id,identity,correction_digest:input.correction_digest,editorial_cut_digest:editorial,artifacts,
  completed_projection:completed?{...completed,replayed:true}:null};
}
async function scoped(client:PoolClient,args:SignalWorkspaceIncrementalProjectionReadV1){const result=await source(client,args);
 if(result.derivation_digest!==args.derivation_digest)return fail('inputs_changed');return result;}
export async function readSignalWorkspaceIncrementalProjectionDerivationV1(args:SignalWorkspaceIncrementalProjectionScopeV1&{database:SignalWorkspaceEngineDatabaseV1}){
 return withSignalWorkspaceEngineTransactionV1(args.database,client=>source(client,args));
}
export async function readSignalWorkspaceIncrementalProjectionTopicsV1(args:SignalWorkspaceIncrementalProjectionReadV1&{after_term_key?:string;limit?:number}){
 const limit=limitOf(args.limit,128);return withSignalWorkspaceEngineTransactionV1(args.database,async client=>{const current=await scoped(client,args);
  const rows=(await client.query<SignalWorkspaceIncrementalProjectionTopicV1>(`SELECT term.id taxonomy_term_id,term.metadata->'topic' definition
   FROM signal_taxonomy_profiles profile JOIN taxonomy_terms term ON term.taxonomy_id=profile.taxonomy_id
   WHERE profile.id=$1::uuid AND profile.workspace_id=$2::uuid AND ($3::text IS NULL OR term.term_key>$3 COLLATE "C")
   ORDER BY term.term_key COLLATE "C" LIMIT $4`,[current.catalog_profile_id,args.workspace_id,args.after_term_key??null,limit+1])).rows;
  const items=rows.slice(0,limit);return{items,next_cursor:items.at(-1)?.definition.term_key??null,done:rows.length<=limit};});
}
export async function readSignalWorkspaceIncrementalProjectionProposalsV1(args:SignalWorkspaceIncrementalProjectionReadV1&{after_artifact_id?:string;limit?:number}){
 const limit=limitOf(args.limit,32);return withSignalWorkspaceEngineTransactionV1(args.database,async client=>{await scoped(client,args);
  const rows=(await client.query<SignalWorkspaceIncrementalProjectionProposalRefV1>(`SELECT ${refColumns},artifact.content->>'sha256' artifact_sha256,
   call.id call_id,call.request_digest,call.call_configuration,owner.input_snapshot->>'context_digest' context_digest
   FROM signal_workspace_incremental_projection_history_v1($1::uuid) history JOIN analysis_artifacts artifact ON artifact.id=history.artifact_id
   JOIN engine_cost_events call ON call.id=(artifact.metadata->>'call_id')::uuid
   JOIN signal_topic_catalog_executions owner ON owner.id=artifact.engine_execution_id
   WHERE ($2::uuid IS NULL OR artifact.id>$2::uuid) ORDER BY artifact.id LIMIT $3`,[args.execution_id,args.after_artifact_id??null,limit+1])).rows;
  await scoped(client,args);const items=rows.slice(0,limit);return{items,next_cursor:items.at(-1)?.artifact_id??null,done:rows.length<=limit};});
}
export async function heartbeatSignalWorkspaceIncrementalProjectionDispatchV1(args:SignalWorkspaceIncrementalProjectionScopeV1&{database:SignalWorkspaceEngineDatabaseV1}){
 const result=await args.database.query(`UPDATE signal_topic_classification_outbox dispatch SET updated_at=clock_timestamp()
  FROM signal_topic_catalog_executions engine WHERE dispatch.execution_id=engine.id AND engine.id=$1::uuid AND engine.workspace_id=$2::uuid
   AND engine.actor_user_id=$3::uuid AND dispatch.dispatch_kind='incremental_projection' AND dispatch.worker_job_id=$4
   AND dispatch.status IN('dispatching','dispatched') RETURNING dispatch.id`,[args.execution_id,args.workspace_id,args.actor_user_id,args.worker_job_id]);
 if(result.rows.length!==1)return fail('dispatch_lost');
}
export async function failSignalWorkspaceIncrementalProjectionDispatchV1(args:SignalWorkspaceIncrementalProjectionScopeV1&{database:SignalWorkspaceEngineDatabaseV1;error_code:string}){
 const code=/^workspace_[a-z_]{1,100}$/u.test(args.error_code)?args.error_code:'workspace_incremental_projection_failed';
 await args.database.query(`UPDATE signal_topic_classification_outbox dispatch SET status='failed',error_code=$5,
  lease_token=NULL,lease_expires_at=NULL,available_at=clock_timestamp()+interval '15 seconds',updated_at=clock_timestamp()
  FROM signal_topic_catalog_executions engine WHERE dispatch.execution_id=engine.id AND engine.id=$1::uuid AND engine.workspace_id=$2::uuid
   AND engine.actor_user_id=$3::uuid AND dispatch.dispatch_kind='incremental_projection' AND dispatch.worker_job_id=$4
   AND dispatch.status IN('dispatching','dispatched')`,[args.execution_id,args.workspace_id,args.actor_user_id,args.worker_job_id,code]);
}
export async function readSignalWorkspaceIncrementalProjectionRootsV1(args:SignalWorkspaceIncrementalProjectionReadV1&{after_root_id?:string;limit?:number}){
 const limit=limitOf(args.limit,128);return withSignalWorkspaceEngineTransactionV1(args.database,async client=>{const current=await scoped(client,args);
  const rows=(await client.query<SignalWorkspaceIncrementalRootV1>(`SELECT item.root_id,item.fingerprint root_fingerprint,item.asset_sha256,
   jsonb_array_length(asset.chunks->'chunks') expected_chunks,signal_workspace_classification_chunk_digest_v1(asset.chunks) chunk_coverage_digest,
   'sha256:'||encode(sha256(convert_to(COALESCE((SELECT string_agg(jsonb_build_array(correction.term_key,correction.correction_operation_id,
    correction.disposition,correction.definition_revision,correction.definition_digest)::text,'' ORDER BY correction.term_key)
    FROM signal_topic_membership_overrides correction WHERE correction.workspace_id=item.workspace_id AND correction.canonical_root_id=item.root_id
     AND correction.origin_input_contract='workspace-topic-classification-v1' AND correction.root_fingerprint=item.fingerprint
     AND correction.context_digest=$4),''),'UTF8')),'hex') correction_digest
   FROM signal_corpus_preparation_items item JOIN signal_corpus_text_assets asset ON asset.workspace_id=item.workspace_id
    AND asset.text_sha256=item.asset_sha256 AND asset.chunk_policy_version=item.chunk_policy_version
   WHERE item.run_id=$1::uuid AND item.workspace_id=$2::uuid AND item.disposition='eligible' AND ($3::uuid IS NULL OR item.root_id>$3::uuid)
   ORDER BY item.root_id LIMIT $5`,[current.snapshot.preparation_run_id,args.workspace_id,args.after_root_id??null,current.snapshot.context_digest,limit+1])).rows;
  const items=rows.slice(0,limit);return{items,next_cursor:items.at(-1)?.root_id??null,done:rows.length<=limit};});
}
function metadata(current:SignalWorkspaceIncrementalProjectionDerivationV1,summary:SignalWorkspaceIncrementalProjectionSummaryV1){
 if(current.editorial_cut_digest!==summary.editorial_cut_digest)return fail('history_changed');
 return{engine_execution_id:current.execution_id,actor_user_id:current.actor_user_id,numeric_checkpoint_digest:current.numeric_checkpoint.checkpoint_digest,
  derivation_digest:current.derivation_digest,worker_job_id:current.worker_job_id,catalog_profile_id:current.catalog_profile_id,
  identity:current.identity,correction_digest:current.correction_digest,...summary};
}
export async function persistSignalWorkspaceIncrementalProjectionBindingsPageV1(args:SignalWorkspaceIncrementalProjectionBindingPageArgsV1):Promise<{items:Array<{artifact_id:string;replayed:boolean}>}>{
 limitOf(args.bindings.length,128);
 return withSignalWorkspaceEngineTransactionV1(args.database,async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`signal-taxonomy:${args.workspace_id}:topic`]);
  const current=await scoped(client,args),base=metadata(current,args.summary),items:Array<{artifact_id:string;replayed:boolean}>=[];
  for(const binding of args.bindings){items.push(await persistSignalWorkspaceEngineArtifactWithClientV1(client,
   {id:current.execution_id,workspace_id:current.workspace_id,input_digest:current.input_digest},{...args.artifact,artifact_type:'engine_output',
    artifact_key:`incremental-unit-${digest([current.derivation_digest,binding.unit_key]).slice(7)}`,
    metadata:{contract_version:'workspace-incremental-unit-binding-v1',...base,binding}}));}
  return{items};
 });
}
export async function persistSignalWorkspaceIncrementalProjectionUnitsPageV1(args:SignalWorkspaceIncrementalProjectionReadV1&{
 units:readonly {component_key:string;local_label:number;unit_key:string;birth_membership_digest:string}[]
}):Promise<void>{
 limitOf(args.units.length,128);
 await withSignalWorkspaceEngineTransactionV1(args.database,async client=>{
  const current=await scoped(client,args),ref=current.artifacts.find(item=>item.artifact_key==='model-components.json')!;
  for(const {component_key,...unit} of args.units)await persistSignalWorkspaceEngineArtifactWithClientV1(client,
   {id:current.execution_id,workspace_id:current.workspace_id,input_digest:current.input_digest},
   {artifact_type:'engine_output',artifact_key:`incremental-census-${digest([current.derivation_digest,unit.unit_key]).slice(7)}`,title:'Reconciled numerical unit reference',
    storage_key:ref.storage_key,sha256:ref.sha256,size_bytes:ref.size_bytes,media_type:ref.media_type,
    metadata:{contract_version:'workspace-incremental-unit-census-v1',derivation_digest:current.derivation_digest,
     worker_job_id:current.worker_job_id,actor_user_id:current.actor_user_id,numeric_checkpoint_digest:current.numeric_checkpoint.checkpoint_digest,
     component_key,unit}});
 });
}
export async function completeSignalWorkspaceIncrementalProjectionBindingsV1(args:SignalWorkspaceIncrementalProjectionReadV1&{
 artifact:SignalWorkspaceEngineArtifactV1;summary:SignalWorkspaceIncrementalProjectionSummaryV1}):Promise<SignalWorkspaceIncrementalProjectionResultV1>{
 return withSignalWorkspaceEngineTransactionV1(args.database,async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`signal-taxonomy:${args.workspace_id}:topic`]);
  const current=await scoped(client,args);if(current.completed_projection)return current.completed_projection;
  if(args.artifact.artifact_key!==`incremental-bindings-${current.derivation_digest.slice(7)}.jsonl`)return fail('binding_artifact_invalid');
  const saved=await persistSignalWorkspaceEngineArtifactWithClientV1(client,{id:current.execution_id,workspace_id:current.workspace_id,input_digest:current.input_digest},
   {...args.artifact,artifact_type:'engine_output',metadata:{contract_version:'workspace-incremental-binding-index-v1',...metadata(current,args.summary)}});
  let model_version_id:string|null=null;
  if(current.numeric_checkpoint.model_bank_artifact_id){const configuration={contract_version:'workspace-topic-incremental-projection-v1',
    engine_execution_id:current.execution_id,model_artifact_id:current.numeric_checkpoint.model_bank_artifact_id,binding_artifact_id:saved.artifact_id,
    binding_digest:args.summary.binding_digest,numeric_checkpoint_digest:current.numeric_checkpoint.checkpoint_digest,
    workspace_classification_identity:current.identity,approval_policy:'none'},seal=digest(configuration);
   model_version_id=(await client.query<{model_version_id:string}>(`SELECT model_version_id FROM register_signal_tagging_model_v1(
    $1::uuid,$2::uuid,$3,$4,'workspace-python',NULL,$5,'python','workspace-incremental-model-bank-v1',$6::jsonb,$7,$8,NULL,NULL,$7,NULL,$9::uuid,$7,$7)`,
    [args.workspace_id,current.catalog_profile_id,`workspace-incremental-projection:${args.workspace_id}`,saved.artifact_id,current.identity.engine_artifact_digest,
     JSON.stringify(configuration),seal,current.input_digest,args.actor_user_id])).rows[0]!.model_version_id;
  }
  const get=(name:string)=>current.artifacts.find(ref=>ref.artifact_key===name)!;
  const projectionSource=signalWorkspaceIncrementalProjectionSourceSchemaV1.parse({contract_version:'workspace-topic-incremental-projection-v1',workspace_id:args.workspace_id,
   engine_execution_id:args.execution_id,numeric_checkpoint_digest:current.numeric_checkpoint.checkpoint_digest,population_digest:current.numeric_checkpoint.population_digest,
   output_artifact_id:current.numeric_checkpoint.output_artifact_id,output_manifest_sha256:get('manifest.json').sha256,
   memberships_artifact_id:get('memberships.jsonl').artifact_id,roots_artifact_id:get('roots.jsonl').artifact_id,
   model_bank_artifact_id:current.numeric_checkpoint.model_bank_artifact_id,model_version_id,binding_artifact_id:saved.artifact_id,
   policy_digest:current.identity.decision_policy_digest,...args.summary});
  const projection=await beginSignalWorkspaceClassificationWithClientV1(client,{workspace_id:args.workspace_id,actor_user_id:args.actor_user_id,
   embedding_run_id:current.snapshot.embedding_run_id,idempotency_key:`incremental-projection:${saved.artifact_id}`,identity:current.identity,source_projection:projectionSource});
  await client.query(`INSERT INTO signal_topic_classification_outbox(execution_id,workspace_id,worker_job_id) VALUES($1::uuid,$2::uuid,$3)
   ON CONFLICT(execution_id,dispatch_kind) DO NOTHING`,[projection.execution_id,args.workspace_id,projection.worker_job_id]);
  await completeDispatch(client,args);
  return{binding_artifact_id:saved.artifact_id,projection_execution_id:projection.execution_id,generation_id:projection.generation_id,replayed:saved.replayed};
 });
}
async function completeDispatch(client:Queryable,args:SignalWorkspaceIncrementalProjectionScopeV1){
 await client.query(`UPDATE signal_topic_classification_outbox SET status='completed',completed_at=clock_timestamp(),error_code=NULL,
  lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE execution_id=$1::uuid AND workspace_id=$2::uuid
   AND dispatch_kind='incremental_projection' AND worker_job_id=$3`,[args.execution_id,args.workspace_id,args.worker_job_id]);
}
export async function completeSignalWorkspaceIncrementalProjectionDispatchV1(args:SignalWorkspaceIncrementalProjectionReadV1){
 return withSignalWorkspaceEngineTransactionV1(args.database,async client=>{const current=await scoped(client,args);
  if(!current.completed_projection)return fail('binding_required');await completeDispatch(client,args);});
}
export async function claimSignalWorkspaceIncrementalProjectionV1(args:{database:SignalWorkspaceEngineDatabaseV1;execution_id:string;worker_job_id:string}):Promise<{
 lease:SignalWorkspaceClassificationLeaseV1;source:SignalWorkspaceIncrementalProjectionSourceV1;artifacts:SignalWorkspaceIncrementalArtifactRefV1[];
 derivation:SignalWorkspaceIncrementalProjectionDerivationV1}|null>{
 const lease=await claimSignalWorkspaceClassificationV1(args);if(!lease)return null;
 try{return await withSignalWorkspaceEngineTransactionV1(args.database,async client=>{const row=(await client.query<{source:unknown}>(`SELECT input_snapshot->'source_projection' source
  FROM signal_topic_catalog_executions WHERE id=$1::uuid AND workspace_id=$2::uuid AND execution_token=$3::uuid AND status='running'`,
  [lease.execution_id,lease.workspace_id,lease.execution_token])).rows[0];
  const projectionSource=signalWorkspaceIncrementalProjectionSourceSchemaV1.parse(row?.source);
  const artifacts=(await client.query<SignalWorkspaceIncrementalArtifactRefV1>(`SELECT ${refColumns} FROM analysis_artifacts artifact
   WHERE workspace_id=$1::uuid AND engine_execution_id=$2::uuid AND (artifact_key=ANY($3::text[]) OR id=$4::uuid) ORDER BY artifact_key`,
   [lease.workspace_id,projectionSource.engine_execution_id,names,projectionSource.binding_artifact_id])).rows;
  if(artifacts.length!==names.length+1)return fail('artifacts_missing');
  const binding=artifacts.find(ref=>ref.artifact_id===projectionSource.binding_artifact_id)!;
  const derivation=await source(client,{execution_id:projectionSource.engine_execution_id,workspace_id:lease.workspace_id,
   actor_user_id:String(binding.metadata.actor_user_id),worker_job_id:String(binding.metadata.worker_job_id)});
  if(derivation.derivation_digest!==binding.metadata.derivation_digest||derivation.completed_projection?.binding_artifact_id!==binding.artifact_id
   ||derivation.completed_projection.projection_execution_id!==lease.execution_id)return fail('inputs_changed');
  return{lease,source:projectionSource,artifacts,derivation};});}
 catch(error){await failSignalWorkspaceClassificationV1({database:args.database,lease,error_code:signalWorkspaceIncrementalDeliveryTransportErrorV1(error)??'workspace_classification_projection_source_invalid'});throw error;}
}

/** The ready numerical checkpoint is the durable producer. Only the latest
 * ready numeric owner is eligible; attempts are bounded per input identity. */
export async function scheduleSignalWorkspaceIncrementalProjectionsV1(args:{database:SignalWorkspaceEngineDatabaseV1;limit?:number}):Promise<number>{
 const limit=limitOf(args.limit??20,100);
 return withSignalWorkspaceEngineTransactionV1(args.database,async client=>{
  const candidates=(await client.query<SignalWorkspaceIncrementalProjectionScopeV1&{observed_job_id:string|null}>(`
   WITH candidates AS MATERIALIZED(SELECT engine.id execution_id,engine.workspace_id,engine.actor_user_id,
    'workspace-incremental-projection-'||engine.id::text||'-'||encode(sha256(convert_to(signal_semantic_context_canonical_json_v1(jsonb_build_array(
     engine.result_summary->'numeric_checkpoint'->>'checkpoint_digest',catalog.id::text,
     signal_workspace_incremental_correction_epoch_v1(engine.workspace_id),signal_workspace_incremental_projection_editorial_digest_v1(engine.id))),'UTF8')),'hex') worker_job_id
    FROM signal_topic_catalog_executions engine JOIN signal_corpus_preparation_input_state state USING(workspace_id)
    JOIN LATERAL(SELECT id FROM signal_taxonomy_profiles WHERE workspace_id=engine.workspace_id AND kind='topic'
     AND status IN('draft','activating','active') AND metadata->>'contract_version'='signal-topic-catalog-v1' ORDER BY version DESC LIMIT 1) catalog ON true
    WHERE engine.input_snapshot ? 'numeric_descriptor' AND engine.status='ready' AND engine.input_revision=state.input_revision
     AND engine.result_summary ? 'numeric_checkpoint' AND signal_workspace_classification_actor_v1(engine.workspace_id,engine.actor_user_id)
     AND (engine.policy_valid_until IS NULL OR engine.policy_valid_until>clock_timestamp())
     AND signal_workspace_incremental_execution_current_v1(engine.id) AND signal_workspace_incremental_projection_history_current_v1(engine.id)
     AND NOT EXISTS(SELECT 1 FROM signal_topic_catalog_executions newer WHERE newer.workspace_id=engine.workspace_id
      AND newer.input_snapshot ? 'numeric_descriptor' AND newer.status='ready' AND newer.input_revision=engine.input_revision
      AND (newer.created_at,newer.id)>(engine.created_at,engine.id)))
   SELECT candidate.*,dispatch.worker_job_id observed_job_id FROM candidates candidate
   LEFT JOIN signal_topic_classification_outbox dispatch ON dispatch.execution_id=candidate.execution_id AND dispatch.dispatch_kind='incremental_projection'
   WHERE (dispatch.id IS NULL OR dispatch.worker_job_id<>candidate.worker_job_id OR dispatch.attempt_count<8)
    AND (dispatch.id IS NULL OR dispatch.worker_job_id<>candidate.worker_job_id OR dispatch.status NOT IN('failed','dead_letter')
     OR dispatch.error_code IN('workspace_incremental_projection_transport_unavailable','workspace_classification_transport_unavailable'))
    AND NOT EXISTS(SELECT 1 FROM analysis_artifacts binding JOIN signal_topic_catalog_executions projection
     ON projection.workspace_id=binding.workspace_id AND projection.input_snapshot->'source_projection'->>'binding_artifact_id'=binding.id::text
     WHERE binding.engine_execution_id=candidate.execution_id AND binding.metadata->>'contract_version'='workspace-incremental-binding-index-v1'
      AND binding.metadata->>'worker_job_id'=candidate.worker_job_id)
    AND (dispatch.id IS NULL OR dispatch.status IN('completed','failed','dead_letter') AND dispatch.available_at<=clock_timestamp()
     OR dispatch.status='dispatched' AND dispatch.updated_at<clock_timestamp()-interval '180 seconds')
   ORDER BY candidate.execution_id LIMIT $1`,[limit])).rows;
  let scheduled=0;
  for(const row of candidates){
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`signal-taxonomy:${row.workspace_id}:topic`]);
   try{if((await source(client,row,false)).completed_projection)continue;}
   catch(error){if(!(error instanceof SignalWorkspaceClassificationError))throw error;
    await client.query(`INSERT INTO signal_topic_classification_outbox(execution_id,workspace_id,dispatch_kind,worker_job_id,status,attempt_count,error_code)
     VALUES($1::uuid,$2::uuid,'incremental_projection',$3,'dead_letter',8,$5)
     ON CONFLICT(execution_id,dispatch_kind) DO UPDATE SET worker_job_id=EXCLUDED.worker_job_id,status='dead_letter',attempt_count=8,error_code=EXCLUDED.error_code,
      lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
     WHERE signal_topic_classification_outbox.status IN('completed','failed','dead_letter') OR signal_topic_classification_outbox.status='dispatched'
      AND signal_topic_classification_outbox.worker_job_id=$4 AND signal_topic_classification_outbox.updated_at<clock_timestamp()-interval '180 seconds'`,
     [row.execution_id,row.workspace_id,row.worker_job_id,row.observed_job_id,error.code]);continue;
   }
   const result=await client.query(`INSERT INTO signal_topic_classification_outbox(execution_id,workspace_id,dispatch_kind,worker_job_id)
    VALUES($1::uuid,$2::uuid,'incremental_projection',$3) ON CONFLICT(execution_id,dispatch_kind) DO UPDATE SET
     status='pending',worker_job_id=EXCLUDED.worker_job_id,
     attempt_count=CASE WHEN signal_topic_classification_outbox.worker_job_id=EXCLUDED.worker_job_id THEN signal_topic_classification_outbox.attempt_count ELSE 0 END,
     available_at=clock_timestamp(),completed_at=NULL,dispatched_at=NULL,error_code=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
    WHERE (signal_topic_classification_outbox.worker_job_id<>EXCLUDED.worker_job_id OR signal_topic_classification_outbox.attempt_count<8)
     AND (signal_topic_classification_outbox.status IN('completed','failed','dead_letter') AND signal_topic_classification_outbox.available_at<=clock_timestamp()
      OR signal_topic_classification_outbox.status='dispatched' AND signal_topic_classification_outbox.updated_at<clock_timestamp()-interval '180 seconds') RETURNING id`,
    [row.execution_id,row.workspace_id,row.worker_job_id]);scheduled+=result.rowCount??0;
  }return scheduled;
 });
}

/** Only observed connection failures qualify; no generic/semantic error is a retry grant. */
export const SIGNAL_WORKSPACE_INCREMENTAL_DELIVERY_TRANSPORT_ERRORS_V1 = [
 'workspace_incremental_projection_transport_unavailable', 'workspace_classification_transport_unavailable'
] as const;
export function signalWorkspaceIncrementalDeliveryTransportErrorV1(error:unknown):string|null {
 const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';
 return ['ECONNRESET','ETIMEDOUT','ECONNREFUSED','EPIPE','ENOTFOUND','57P01','57P02','57P03','08000','08003','08006','40001','40P01'].includes(code)
  ?'workspace_classification_transport_unavailable':null;
}
export type SignalWorkspaceIncrementalDeliveryReceiptV1={execution_id:string;phase:'derivation'|'projection';
 binding_artifact_id:string|null;projection_execution_id:string|null;generation_id:string|null;worker_job_id:string};
export type SignalWorkspaceIncrementalDeliveryStatusV1={phase:'derivation'|'projection'|null;retry_available:boolean;error_code:string|null};
type DeliveryArgs={database:SignalWorkspaceEngineDatabaseV1;workspace_id:string;actor_user_id:string;execution_id:string;idempotency_key:string};
type DeliveryAlias={actor_user_id:string;request_digest:string;delivery_receipt:SignalWorkspaceIncrementalDeliveryReceiptV1;
 delivery_seal:{numeric_checkpoint_digest:string;derivation_digest:string;projection_input_digest:string|null;cursor_root_id:string|null;prior_worker_job_id:string}};
const deliveryTransport=(code:string|null)=>SIGNAL_WORKSPACE_INCREMENTAL_DELIVERY_TRANSPORT_ERRORS_V1.some(value=>value===code);
async function deliveryState(client:PoolClient,args:Omit<DeliveryArgs,'database'|'idempotency_key'>,lock=false){
 const dispatch=(await client.query<{worker_job_id:string;status:string;error_code:string|null;attempt_count:number}>(`
  SELECT worker_job_id,status,error_code,attempt_count FROM signal_topic_classification_outbox
  WHERE execution_id=$1::uuid AND workspace_id=$2::uuid AND dispatch_kind='incremental_projection' ${lock?'FOR UPDATE':''}`,[args.execution_id,args.workspace_id])).rows[0];
 // A recovery action cannot create the first rollout-gated delivery.
 if(!dispatch)return fail('delivery_unavailable');
 const current=await source(client,{...args,worker_job_id:dispatch.worker_job_id},false);
 const epoch=(await client.query<{epoch:string}>('SELECT signal_workspace_incremental_correction_epoch_v1($1::uuid) epoch',[args.workspace_id])).rows[0]!.epoch;
 const expectedJob=`workspace-incremental-projection-${current.execution_id}-${digest([current.numeric_checkpoint.checkpoint_digest,current.catalog_profile_id,epoch,current.editorial_cut_digest]).slice(7)}`;
 if(dispatch.worker_job_id!==expectedJob)return fail('inputs_changed');
 const projection=current.completed_projection?(await client.query<{id:string;generation_id:string;status:string;error_code:string|null;input_digest:string;
  cursor_root_id:string|null;worker_job_id:string;dispatch_generation:number;outbox_status:string;source_current:boolean}>(`
  SELECT engine.id,engine.generation_id,engine.status,engine.error_code,engine.input_digest,engine.cursor_root_id,engine.dispatch_generation,
   outbox.worker_job_id,outbox.status outbox_status,signal_workspace_projection_source_current_v1(generation) source_current
  FROM signal_topic_catalog_executions engine JOIN signal_classification_generations generation ON generation.id=engine.generation_id
   AND generation.workspace_id=engine.workspace_id JOIN signal_topic_classification_outbox outbox ON outbox.execution_id=engine.id AND outbox.dispatch_kind='execution'
  WHERE engine.id=$1::uuid AND engine.workspace_id=$2::uuid AND engine.actor_user_id=$3::uuid
   AND engine.input_contract='workspace-topic-classification-v1' AND engine.taxonomy_profile_id=$4::uuid
   AND engine.input_snapshot->'identity'=$5::jsonb AND engine.input_snapshot->>'correction_digest'=$6
   AND engine.input_snapshot->'source_projection'->>'contract_version'='workspace-topic-incremental-projection-v1'
   AND engine.input_snapshot->'source_projection'->>'engine_execution_id'=$7
   AND engine.input_snapshot->'source_projection'->>'binding_artifact_id'=$8
   AND engine.input_snapshot->'source_projection'->>'numeric_checkpoint_digest'=$9
   AND engine.input_revision=(SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=$2::uuid)
   AND (engine.policy_valid_until IS NULL OR engine.policy_valid_until>clock_timestamp()) ${lock?'FOR UPDATE OF engine,outbox':''}`,
  [current.completed_projection.projection_execution_id,args.workspace_id,args.actor_user_id,current.catalog_profile_id,JSON.stringify(current.identity),current.correction_digest,
   current.execution_id,current.completed_projection.binding_artifact_id,current.numeric_checkpoint.checkpoint_digest])).rows[0]:null;
 if(current.completed_projection&&(!projection||!projection.source_current))return fail('inputs_changed');
 const error_code=projection?.error_code??dispatch.error_code;
 const retry_available=projection?projection.status==='failed'&&deliveryTransport(projection.error_code)
  :['failed','dead_letter'].includes(dispatch.status)&&deliveryTransport(dispatch.error_code);
 const view:SignalWorkspaceIncrementalDeliveryStatusV1={phase:projection?'projection':'derivation',retry_available,error_code};
 return{current,dispatch,projection,view};
}
/** One accepted key grants one delivery attempt. Numeric, money and checkpoints
 * stay sealed; ready/busy races record an inert receipt instead of enqueueing. */
export async function retrySignalWorkspaceIncrementalDeliveryV1(args:DeliveryArgs):Promise<SignalWorkspaceIncrementalDeliveryReceiptV1&{replayed:boolean}>{
 if(!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key)||!/^([0-9a-f]{8})(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(args.execution_id))return fail('request_invalid',422);
 const execution_id=args.execution_id.toLowerCase(),request_digest=digest({action:'retry_incremental_delivery',execution_id});
 return withSignalWorkspaceEngineTransactionV1(args.database,async client=>{
  await authority(client,args);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`signal-taxonomy:${args.workspace_id}:topic`]);
  await client.query('SELECT workspace_id FROM signal_corpus_preparation_input_state WHERE workspace_id=$1::uuid FOR UPDATE',[args.workspace_id]);
  const prior=(await client.query<{id:string;alias:DeliveryAlias|null}>(`SELECT id,engine_request_keys->$2 alias FROM signal_topic_catalog_executions
   WHERE workspace_id=$1::uuid AND (idempotency_key=$2 OR engine_request_keys ? $2)`,[args.workspace_id,args.idempotency_key])).rows[0];
  if(prior){if(prior.id!==execution_id||prior.alias?.actor_user_id!==args.actor_user_id||prior.alias?.request_digest!==request_digest
   ||prior.alias.delivery_receipt?.execution_id!==execution_id)return fail('idempotency_conflict');
   return{...prior.alias.delivery_receipt,replayed:true};}
  const run=(await client.query(`SELECT id FROM signal_topic_catalog_executions WHERE id=$1::uuid AND workspace_id=$2::uuid
   AND actor_user_id=$3::uuid AND input_snapshot ? 'numeric_descriptor' AND status='ready' FOR UPDATE`,[execution_id,args.workspace_id,args.actor_user_id])).rows[0];
  if(!run)return fail('delivery_unavailable');
  const state=await deliveryState(client,{...args,execution_id},true),{current,dispatch,projection}=state;
  const inert=projection?['queued','running','ready'].includes(projection.status):['pending','dispatching','dispatched'].includes(dispatch.status);
  if(!state.view.retry_available&&!inert)return fail('delivery_unavailable');
  let worker_job_id=projection?.worker_job_id??dispatch.worker_job_id;
  if(!inert){
   if(projection){worker_job_id=`workspace-classification-${projection.id}-${projection.dispatch_generation+1}`;
    await client.query(`UPDATE signal_topic_catalog_executions SET status='queued',error_code=NULL,completed_at=NULL,execution_token=NULL,execution_expires_at=NULL,
     dispatch_generation=dispatch_generation+1,updated_at=clock_timestamp() WHERE id=$1::uuid AND status='failed'`,[projection.id]);}
   const updated=await client.query(`UPDATE signal_topic_classification_outbox SET status='pending',worker_job_id=$4,attempt_count=0,
    available_at=clock_timestamp(),completed_at=NULL,dispatched_at=NULL,lease_token=NULL,lease_expires_at=NULL,error_code=NULL,updated_at=clock_timestamp()
    WHERE execution_id=$1::uuid AND workspace_id=$2::uuid AND dispatch_kind=$3 RETURNING id`,
    [projection?.id??execution_id,args.workspace_id,projection?'execution':'incremental_projection',worker_job_id]);
   if(updated.rows.length!==1)return fail('dispatch_lost');
  }
  const receipt:SignalWorkspaceIncrementalDeliveryReceiptV1={execution_id,phase:projection?'projection':'derivation',binding_artifact_id:current.completed_projection?.binding_artifact_id??null,
   projection_execution_id:projection?.id??null,generation_id:projection?.generation_id??null,worker_job_id};
  const alias:DeliveryAlias={actor_user_id:args.actor_user_id,request_digest,delivery_receipt:receipt,delivery_seal:{numeric_checkpoint_digest:current.numeric_checkpoint.checkpoint_digest,
   derivation_digest:current.derivation_digest,projection_input_digest:projection?.input_digest??null,cursor_root_id:projection?.cursor_root_id??null,
   prior_worker_job_id:projection?.worker_job_id??dispatch.worker_job_id}};
  await client.query('UPDATE signal_topic_catalog_executions SET engine_request_keys=engine_request_keys||jsonb_build_object($2::text,$3::jsonb) WHERE id=$1::uuid',
   [execution_id,args.idempotency_key,JSON.stringify(alias)]);
  return{...receipt,replayed:inert};
 });
}

export type SignalWorkspaceAnalysisUpdateV1={desired_revision:string;input_revision:string;has_pending_work:boolean;
 numeric:{execution_id:string;status:'queued'|'running'|'ready'|'failed';phase:string;progress:number;expected_roots:number;processed_roots:number;is_current:boolean;error_code:string|null;retry_available:boolean};
 request_numeric:{action:'retry_numeric';execution_id:string;idempotency_key:string}|null;
 delivery:SignalWorkspaceIncrementalDeliveryStatusV1;
 request_delivery:({action:'retry_incremental_delivery';idempotency_key:string}&Omit<SignalWorkspaceIncrementalDeliveryReceiptV1,'worker_job_id'|'binding_artifact_id'>)|null;
 derivation:{status:string;error_code:string|null}|null;
 projection:{execution_id:string;generation_id:string;status:'queued'|'running'|'ready'|'failed';expected_roots:number;processed_roots:number;is_current:boolean;error_code:string|null}|null;
 serving:{generation_id:string;input_revision:string;is_current:boolean;
  interpretation_coverage:SignalWorkspaceIncrementalProjectionSourceV1['interpretation_coverage']|null;
  discovery_coverage:SignalWorkspaceIncrementalProjectionSourceV1['discovery_coverage']|null}|null};
/** Read-only status for the existing analysis GET. Ready numeric evidence is
 * pending before dispatch exists; terminal derivation failures stop polling. */
export async function loadSignalWorkspaceAnalysisUpdateV1(args:{database:SignalWorkspaceEngineDatabaseV1;workspace_id:string;actor_user_id:string;idempotency_key?:string}):Promise<SignalWorkspaceAnalysisUpdateV1|null>{
 if(args.idempotency_key!==undefined&&!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key))return fail('request_invalid',422);
 const client=await args.database.connect();
 try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const capabilities=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,...args});if(!capabilities.can_view)return fail('forbidden',403);
  const row=(await client.query<{execution_id:string;status:SignalWorkspaceAnalysisUpdateV1['numeric']['status'];phase:string;progress:number;
   expected_roots:number;processed_roots:number;error_code:string|null;input_revision:string;desired_revision:string;context_digest:string;catalog_digest:string;is_current:boolean;history_current:boolean}>(`
   SELECT engine.id execution_id,engine.status,COALESCE(engine.result_summary->>'phase',engine.status) phase,engine.progress,
    engine.denominator expected_roots,engine.processed_roots,engine.error_code,engine.input_revision::text,state.input_revision::text desired_revision,
    engine.input_snapshot->>'context_digest' context_digest,engine.input_snapshot->>'catalog_digest' catalog_digest,
    signal_workspace_incremental_projection_history_current_v1(engine.id) history_current,engine.input_revision=state.input_revision AND (engine.policy_valid_until IS NULL OR engine.policy_valid_until>now())
     AND signal_workspace_incremental_execution_current_v1(engine.id) is_current
   FROM signal_topic_catalog_executions engine JOIN signal_corpus_preparation_input_state state USING(workspace_id)
   WHERE engine.workspace_id=$1::uuid AND engine.input_snapshot ? 'numeric_descriptor' ORDER BY engine.created_at DESC,engine.id DESC LIMIT 1`,[args.workspace_id])).rows[0];
  if(!row){await client.query('COMMIT');return null;}
  // Acceptance is historical evidence: a later input revision or failed retry
  // cannot erase the receipt or turn it into permission for another dispatch.
  const accepted=args.idempotency_key?(await client.query<{id:string;alias:Partial<DeliveryAlias>|null}>(`
   SELECT id,engine_request_keys->$3 alias FROM signal_topic_catalog_executions
   WHERE workspace_id=$1::uuid AND actor_user_id=$2::uuid AND input_snapshot ? 'numeric_descriptor'
    AND engine_request_keys ? $3`,[args.workspace_id,args.actor_user_id,args.idempotency_key])).rows[0]:null;
  const requestDelivery:SignalWorkspaceAnalysisUpdateV1['request_delivery']=accepted?.alias?.actor_user_id===args.actor_user_id
   &&accepted.alias.request_digest===digest({action:'retry_incremental_delivery',execution_id:accepted.id})&&accepted.alias.delivery_receipt?.execution_id===accepted.id
   ?{action:'retry_incremental_delivery',idempotency_key:args.idempotency_key!,execution_id:accepted.id,phase:accepted.alias.delivery_receipt.phase,
    projection_execution_id:accepted.alias.delivery_receipt.projection_execution_id,generation_id:accepted.alias.delivery_receipt.generation_id}:null;
  const requestNumeric:SignalWorkspaceAnalysisUpdateV1['request_numeric']=accepted?.alias?.actor_user_id===args.actor_user_id
   &&accepted.alias.request_digest===digest({action:'retry_numeric',execution_id:accepted.id})
   ?{action:'retry_numeric',execution_id:accepted.id,idempotency_key:args.idempotency_key!}:null;
  const identity=await loadSignalWorkspaceEngineInputIdentityV1({queryable:client,...args});
  const current=row.is_current&&identity.context_digest===row.context_digest&&identity.catalog_digest===row.catalog_digest;
  const numericRecovery=current&&row.status==='failed'&&capabilities.can_execute_topics
   ?await readSignalWorkspaceNumericRecoveryWithQueryableV1({queryable:client,...args,execution_id:row.execution_id}):null;
  const {loadSignalWorkspaceTopicProjectionStatusWithQueryableV1}=await import('./signal-workspace-topic-projection');
  const status=await loadSignalWorkspaceTopicProjectionStatusWithQueryableV1({queryable:client,...args});
  const latest=status.latest_run?.source_engine_execution_id===row.execution_id?status.latest_run:null;
  const dispatch=(await client.query<{status:string;error_code:string|null;attempt_count:number;profile_current:boolean}>(`SELECT dispatch.status,dispatch.error_code,dispatch.attempt_count,
   EXISTS(SELECT 1 FROM analysis_artifacts binding WHERE binding.engine_execution_id=$1::uuid AND binding.metadata->>'contract_version'='workspace-incremental-binding-index-v1'
    AND binding.metadata->>'worker_job_id'=dispatch.worker_job_id AND binding.metadata->>'catalog_profile_id'=(SELECT id::text FROM signal_taxonomy_profiles
     WHERE workspace_id=$2::uuid AND kind='topic' AND status IN('draft','activating','active') AND metadata->>'contract_version'='signal-topic-catalog-v1' ORDER BY version DESC LIMIT 1)) profile_current
   FROM signal_topic_classification_outbox dispatch WHERE dispatch.execution_id=$1::uuid AND dispatch.dispatch_kind='incremental_projection'`,[row.execution_id,args.workspace_id])).rows[0]??null;
  const complete=status.latest_complete;
  const served=complete?(await client.query<{input_revision:string;interpretation_coverage:SignalWorkspaceIncrementalProjectionSourceV1['interpretation_coverage']|null;
   discovery_coverage:SignalWorkspaceIncrementalProjectionSourceV1['discovery_coverage']|null}>(`SELECT input_revision::text,
    input_snapshot->'source_projection'->'interpretation_coverage' interpretation_coverage,input_snapshot->'source_projection'->'discovery_coverage' discovery_coverage
    FROM signal_classification_generations WHERE id=$1::uuid AND workspace_id=$2::uuid`,[complete.generation_id,args.workspace_id])).rows[0]:null;
  const recoverable=latest?.status==='failed'&&['workspace_incremental_projection_transport_unavailable','workspace_classification_transport_unavailable'].includes(latest.error_code??'')
   &&(await client.query(`SELECT 1 FROM signal_topic_catalog_executions WHERE id=$1::uuid AND dispatch_generation<8`,[latest.execution_id])).rows.length>0;
  let delivery:SignalWorkspaceIncrementalDeliveryStatusV1={phase:latest?'projection':dispatch?'derivation':null,retry_available:false,error_code:latest?.error_code??dispatch?.error_code??null};
  if(current&&row.history_current&&row.status==='ready'&&capabilities.can_execute_topics&&dispatch){try{
   delivery=(await deliveryState(client,{...args,execution_id:row.execution_id})).view;
  }catch(error){if(!(error instanceof SignalWorkspaceClassificationError))throw error;delivery={...delivery,error_code:error.code};}}
  const pending=current&&row.history_current&&(row.status==='queued'||row.status==='running'||row.status==='ready'&&
   (latest?.status==='queued'||latest?.status==='running'||recoverable||(!latest||!dispatch?.profile_current)&&(!dispatch||dispatch.status!=='dead_letter'&&dispatch.attempt_count<8&&(dispatch.status!=='failed'||deliveryTransport(dispatch.error_code)))));
  const result:SignalWorkspaceAnalysisUpdateV1={desired_revision:row.desired_revision,input_revision:row.input_revision,has_pending_work:pending,
   numeric:{execution_id:row.execution_id,status:row.status,phase:row.phase,progress:row.progress,expected_roots:row.expected_roots,processed_roots:row.processed_roots,is_current:current,error_code:row.error_code,retry_available:numericRecovery?.retry_available===true},
   request_numeric:requestNumeric,delivery,request_delivery:requestDelivery,
   derivation:!row.history_current?{status:'blocked',error_code:'workspace_incremental_projection_history_changed'}:dispatch?{status:dispatch.status,error_code:dispatch.error_code}:null,
   projection:latest?{execution_id:latest.execution_id,generation_id:latest.generation_id,status:latest.status,expected_roots:latest.denominator,processed_roots:latest.processed_roots,is_current:latest.is_current,error_code:latest.error_code}:null,
   serving:complete&&served?{generation_id:complete.generation_id,input_revision:served.input_revision,is_current:complete.is_current,
    interpretation_coverage:served.interpretation_coverage,discovery_coverage:served.discovery_coverage}:null};
  await client.query('COMMIT');return result;
 }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
}

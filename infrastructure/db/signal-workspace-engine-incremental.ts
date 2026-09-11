import type { PoolClient } from 'pg';
import { signalWorkspaceIncrementalDigestV1 as digest, signalWorkspaceIncrementalInputSchemaV1,
  signalWorkspaceIncrementalOutputSchemaV1, type SignalWorkspaceIncrementalInputV1,
  type SignalWorkspaceIncrementalRootV1 } from '@noisia/query-engine';
import { beginSignalWorkspaceEngineV1, SignalWorkspaceEngineError,
  withSignalWorkspaceEngineLeaseV1, withSignalWorkspaceEngineTransactionV1,
  persistSignalWorkspaceEngineArtifactWithClientV1,
  loadSignalWorkspaceEngineInputIdentityV1,
  retrySignalWorkspaceEngineV1,
  type SignalWorkspaceEngineArtifactV1, type SignalWorkspaceEngineDatabaseV1,
  type SignalWorkspaceEngineLeaseV1 } from './signal-workspace-engine';
import { loadSignalWorkspaceCapabilitiesStoreV1 } from './signal-workspace-capabilities';

export type SignalWorkspaceIncrementalCompatibilityV1 = SignalWorkspaceIncrementalInputV1['compatibility'];
export type SignalWorkspaceIncrementalDescriptorV1 = {
  contract_version:'workspace-incremental-numeric-descriptor-v1';descriptor_digest:string;
  policy_version:'workspace-frozen-model-cohort-v1';mode:'frozen-model-delta';
  parent:{execution_id:string;output_artifact_id:string;manifest_sha256:string;
    manifest_contract:'workspace-topic-engine-output-v1'|'workspace-topic-incremental-output-v1';
    checkpoint_digest:string;model_version_id:string|null;model_bank_artifact_id:string|null};
  root_correction_epoch:string;compatibility:SignalWorkspaceIncrementalCompatibilityV1;discovery:{close_requested:boolean};
  editorial_cut:{unit_count:number;unit_digest:string};
};
export type SignalWorkspaceIncrementalArtifactRefV1 = {artifact_id:string;owner_execution_id:string;
  artifact_key:string;storage_key:string;sha256:string;size_bytes:number;media_type:string;metadata:Record<string,unknown>};
export type SignalWorkspaceIncrementalComponentV1 = {
  component_key:string;lane:'open'|'guided';model_artifact_id:string;center_artifact_id:string|null;
  model_origin:{execution_id:string;model_artifact_sha256:string};
  origin_model_artifact_id:string;origin_registry_id:string;parent_component_artifact_id:string|null;
  unit_count:number;unit_digest:string;
};
export type SignalWorkspaceIncrementalValidationV1 = {
 contract_version:'workspace-incremental-file-validation-v1';request_digest:string;population_digest:string;
 complete_file_digest:string;origin_digest:string;roots:number;occurrences:number;memberships:number;pending_occurrences:number;
 relations_scope:'new_candidates_in_this_execution';
};
export type SignalWorkspaceIncrementalCheckpointV1 = {
  contract_version:'workspace-incremental-numeric-checkpoint-v1';checkpoint_digest:string;descriptor_digest:string;
  input_artifact_id:string;output_index_artifact_id:string;output_artifact_id:string;model_bank_artifact_id:string|null;
  model_version_id:string|null;population_digest:string;roots:number;occurrences:number;components:number;
  component_digest:string;model_bank_bytes:number;discovery_status:string;relations_status:'pending'|'none';
  history_artifact_id:string;numeric_complete:true;analysis_complete:false;
};
type Queryable=Pick<PoolClient,'query'>;
const hash=/^sha256:[0-9a-f]{64}$/u;
const fail=(code:string,status=409):never=>{throw new SignalWorkspaceEngineError(`workspace_engine_incremental_${code}`,status);};
const limitOf=(limit=128)=>{if(!Number.isSafeInteger(limit)||limit<1||limit>128)return fail('page_invalid',422);return limit;};
const count=(value:unknown)=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<0)return fail('count_invalid');return n;};
export const SIGNAL_WORKSPACE_NUMERIC_RETRY_ERRORS_V1=[
 'workspace_engine_incremental_transport_unavailable','workspace_engine_storage_transport_failed',
 'workspace_engine_storage_unavailable','workspace_engine_queue_unavailable','topic_queue_unavailable',
] as const;
export const isSignalWorkspaceNumericRetryableErrorV1=(code:string|null)=>
 (SIGNAL_WORKSPACE_NUMERIC_RETRY_ERRORS_V1 as readonly string[]).includes(code??'');
/** Shared by the locked retry and read-only status. No provider authorization is
 * inherited from the parent; persisted checkpoints are retained for recovery. */
export async function readSignalWorkspaceNumericRecoveryWithQueryableV1(args:{queryable:Queryable;workspace_id:string;actor_user_id:string;execution_id:string}){
 const row=(await args.queryable.query<{status:string;error_code:string|null;valid:boolean}>(`SELECT execution.status,execution.error_code,
  COALESCE(execution.actor_user_id=$3::uuid AND execution.input_snapshot ? 'numeric_descriptor'
   AND execution.input_snapshot->>'claude_cap_micro_usd'='0'
   AND execution.input_snapshot->'interpretation_config' IS NULL AND execution.interpretation_revision IS NULL
   AND execution.input_revision=state.input_revision AND (execution.policy_valid_until IS NULL OR execution.policy_valid_until>clock_timestamp())
   AND signal_workspace_classification_actor_v1(execution.workspace_id,$3::uuid)
   AND signal_workspace_incremental_execution_current_v1(execution.id)
   AND signal_workspace_incremental_projection_history_current_v1(execution.id)
   AND NOT EXISTS(SELECT 1 FROM engine_cost_events call WHERE call.catalog_execution_id=execution.id)
   AND (inventory.id IS NULL OR input.id IS NOT NULL AND inventory.metadata->>'input_artifact_id'=input.id::text)
   AND (NOT execution.result_summary ? 'numeric_checkpoint' OR
    input.id::text=execution.result_summary->'numeric_checkpoint'->>'input_artifact_id'
    AND inventory.id::text=execution.result_summary->'numeric_checkpoint'->>'output_index_artifact_id'
    AND execution.result_summary->'numeric_checkpoint'->>'descriptor_digest'=execution.input_snapshot->'numeric_descriptor'->>'descriptor_digest'),false) valid
  FROM signal_topic_catalog_executions execution JOIN signal_corpus_preparation_input_state state USING(workspace_id)
  LEFT JOIN analysis_artifacts input ON input.engine_execution_id=execution.id AND input.workspace_id=execution.workspace_id AND input.artifact_key='incremental-input.json'
  LEFT JOIN analysis_artifacts inventory ON inventory.engine_execution_id=execution.id AND inventory.workspace_id=execution.workspace_id AND inventory.artifact_key='incremental-output-index.json'
  WHERE execution.id=$1::uuid AND execution.workspace_id=$2::uuid AND execution.input_contract='workspace-topic-engine-v1'`,
  [args.execution_id,args.workspace_id,args.actor_user_id])).rows[0];
 return{valid:row?.valid===true,retry_available:row?.valid===true&&row.status==='failed'&&isSignalWorkspaceNumericRetryableErrorV1(row.error_code)};
}
export async function retrySignalWorkspaceNumericUpdateV1(args:{database:SignalWorkspaceEngineDatabaseV1;workspace_id:string;actor_user_id:string;execution_id:string;idempotency_key:string}){
 return retrySignalWorkspaceEngineV1({...args,numeric_only:true});
}
const refSql=`artifact.id artifact_id,artifact.engine_execution_id owner_execution_id,artifact.artifact_key,
 artifact.content->>'storage_key' storage_key,artifact.content->>'sha256' sha256,
 (artifact.content->>'size_bytes')::bigint size_bytes,artifact.content->>'media_type' media_type,artifact.metadata`;
const publicRefs=(rows:SignalWorkspaceIncrementalArtifactRefV1[])=>rows.map(row=>({...row,size_bytes:count(row.size_bytes)}));
function descriptorOf(lease:SignalWorkspaceEngineLeaseV1){const descriptor=lease.snapshot.numeric_descriptor;
 if(!descriptor)return fail('descriptor_required');return descriptor;}

/** Numeric authority is distinct from editorial completion and current population. */
export async function loadSignalWorkspaceIncrementalParentV1(args:{queryable:Queryable;workspace_id:string;actor_user_id:string;
  embedding_config_digest:string;context_digest:string;catalog_digest:string;engine_config:Record<string,unknown>;
  parent_execution_id?:string;guides:Array<{guide_key:string;role:string;input_digest:string}>}){
 const capability=await loadSignalWorkspaceCapabilitiesStoreV1(args);if(!capability.can_execute_topics)return fail('forbidden',403);
 const parent=(await args.queryable.query<{id:string;input_snapshot:Record<string,unknown>;result_summary:Record<string,unknown>}>(`
  SELECT id,input_snapshot,result_summary FROM signal_topic_catalog_executions
  WHERE workspace_id=$1::uuid AND input_contract='workspace-topic-engine-v1' AND status IN('running','failed','ready')
   AND (result_summary ? 'fit_checkpoint' OR result_summary ? 'numeric_checkpoint')
   AND (NOT input_snapshot ? 'numeric_descriptor' OR status='ready')
   AND ($2::uuid IS NULL OR id=$2::uuid)
   AND embedding_config_digest=$3 AND input_snapshot->>'context_digest'=$4 AND input_snapshot->>'catalog_digest'=$5
   AND input_snapshot->'engine_config'=$6::jsonb
  ORDER BY created_at DESC,id DESC LIMIT 1`,[args.workspace_id,args.parent_execution_id??null,args.embedding_config_digest,args.context_digest,args.catalog_digest,JSON.stringify(args.engine_config)])).rows[0];
 if(!parent)return {available:false as const,reason:'no_compatible_numeric_parent' as const};
 if((await args.queryable.query<{valid:boolean}>('SELECT signal_workspace_incremental_parent_current_v1($1::uuid,$2::uuid,$3::uuid) valid',
  [parent.id,args.workspace_id,args.actor_user_id])).rows[0]?.valid!==true)return fail('parent_invalid');
 const numeric=parent.result_summary.numeric_checkpoint as SignalWorkspaceIncrementalCheckpointV1|undefined;
 const checkpoint=(numeric??parent.result_summary.fit_checkpoint) as {checkpoint_digest:string;output_artifact_id:string;model_version_id:string|null;model_artifact_id?:string|null;model_bank_artifact_id?:string|null};
 const artifacts=(await args.queryable.query<SignalWorkspaceIncrementalArtifactRefV1>(`SELECT ${refSql} FROM analysis_artifacts artifact
  WHERE artifact.workspace_id=$1::uuid AND artifact.engine_execution_id=$2::uuid
   AND (artifact.id=$3::uuid OR artifact.artifact_key='guide-vectors.npy')`,[args.workspace_id,parent.id,checkpoint.output_artifact_id])).rows;
 const output=artifacts.find(row=>row.artifact_id===checkpoint.output_artifact_id),vectors=artifacts.find(row=>row.artifact_key==='guide-vectors.npy');
 if(!output||!vectors)return fail('parent_artifacts_missing');
 const model=checkpoint.model_version_id?(await args.queryable.query<{configuration:Record<string,unknown>}>(
  'SELECT configuration FROM tagging_model_versions WHERE id=$1::uuid',[checkpoint.model_version_id])).rows[0]:null;
 let compatibility:SignalWorkspaceIncrementalCompatibilityV1;
 if(numeric){compatibility=(parent.input_snapshot.numeric_descriptor as SignalWorkspaceIncrementalDescriptorV1).compatibility;}
 else{
  const versions=model?.configuration.versions;
  if(!versions||typeof versions!=='object')return fail('parent_runtime_missing');
  compatibility={embedding_config_digest:args.embedding_config_digest,chunk_policy_version:'corpus-text-chunks-v1',
   context_digest:args.context_digest,input_interest_catalog_digest:args.catalog_digest,
   guides_digest:digest({rows:args.guides.map((guide,ordinal)=>({ordinal,guide_key:guide.guide_key,role:guide.role,input_digest:guide.input_digest})),vectors:vectors.sha256}),
   fit_config_digest:digest(args.engine_config),runtime_digest:digest(versions)};
 }
 const selected:SignalWorkspaceIncrementalDescriptorV1['parent']={execution_id:parent.id,output_artifact_id:output.artifact_id,
  manifest_sha256:output.sha256,manifest_contract:numeric?'workspace-topic-incremental-output-v1':'workspace-topic-engine-output-v1',
  checkpoint_digest:checkpoint.checkpoint_digest,model_version_id:checkpoint.model_version_id,
  model_bank_artifact_id:checkpoint.model_bank_artifact_id??checkpoint.model_artifact_id??null};
 return{available:true as const,parent:selected,compatibility};
}
export async function buildSignalWorkspaceIncrementalDescriptorWithClientV1(args:Parameters<typeof loadSignalWorkspaceIncrementalParentV1>[0]&{close_requested:boolean}){
 if(typeof args.close_requested!=='boolean')return fail('request_invalid',422);
 const selected=await loadSignalWorkspaceIncrementalParentV1(args);if(!selected.available)return fail('parent_unavailable');
 const coverage=(await args.queryable.query<{unit_count:string;unit_digest:string}>(
  'SELECT unit_count::text,unit_digest FROM signal_workspace_incremental_editorial_at_v1($1::uuid,$2::uuid,transaction_timestamp())',
  [selected.parent.execution_id,args.workspace_id])).rows[0]!;
 const body={contract_version:'workspace-incremental-numeric-descriptor-v1' as const,policy_version:'workspace-frozen-model-cohort-v1' as const,
  mode:'frozen-model-delta' as const,parent:selected.parent,compatibility:selected.compatibility,discovery:{close_requested:args.close_requested},
  editorial_cut:{unit_count:count(coverage.unit_count),unit_digest:coverage.unit_digest},
  root_correction_epoch:(await args.queryable.query<{digest:string}>('SELECT signal_workspace_incremental_correction_epoch_v1($1::uuid) digest',[args.workspace_id])).rows[0]!.digest};
 return{...body,descriptor_digest:digest(body)};
}
export async function beginSignalWorkspaceIncrementalEngineV1(args:{database:SignalWorkspaceEngineDatabaseV1;workspace_id:string;actor_user_id:string;
 idempotency_key:string;embedding_run_id:string;expected_context_digest:string;expected_catalog_digest:string;
 engine_config:Record<string,unknown>;close_requested:boolean;parent_execution_id?:string;taxonomy_profile_id?:string;
 automatic_admission?:import('./signal-workspace-numeric-producer').SignalWorkspaceNumericAdmissionV1}){
 return beginSignalWorkspaceEngineV1({...args,claude_cap_micro_usd:0,
  incremental_options:{close_requested:args.close_requested,parent_execution_id:args.parent_execution_id,taxonomy_profile_id:args.taxonomy_profile_id,
   automatic_admission:args.automatic_admission}});
}

export async function readSignalWorkspaceIncrementalRootsV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;
 after_root_id:string|null;limit?:number}){
 const limit=limitOf(args.limit);descriptorOf(args.lease);
 return withSignalWorkspaceEngineLeaseV1(args,async(client,run)=>{
  const rows=(await client.query<SignalWorkspaceIncrementalRootV1>(`SELECT item.root_id,item.fingerprint root_fingerprint,item.asset_sha256,
   jsonb_array_length(asset.chunks->'chunks') expected_chunks,
   signal_workspace_classification_chunk_digest_v1(asset.chunks) chunk_coverage_digest,
   'sha256:'||encode(sha256(convert_to(COALESCE((SELECT string_agg(jsonb_build_array(correction.term_key,correction.correction_operation_id,
    correction.disposition,correction.definition_revision,correction.definition_digest)::text,'' ORDER BY correction.term_key)
    FROM signal_topic_membership_overrides correction WHERE correction.workspace_id=item.workspace_id AND correction.canonical_root_id=item.root_id
     AND correction.origin_input_contract='workspace-topic-classification-v1' AND correction.root_fingerprint=item.fingerprint
     AND correction.context_digest=$4),''),'UTF8')),'hex') correction_digest
   FROM signal_corpus_preparation_items item JOIN signal_corpus_text_assets asset ON asset.workspace_id=item.workspace_id
    AND asset.text_sha256=item.asset_sha256 AND asset.chunk_policy_version=item.chunk_policy_version
   WHERE item.run_id=$1::uuid AND item.workspace_id=$2::uuid AND item.disposition='eligible'
    AND ($3::uuid IS NULL OR item.root_id>$3::uuid) ORDER BY item.root_id LIMIT $5`,
  [run.input_snapshot.preparation_run_id,run.workspace_id,args.after_root_id,run.input_snapshot.context_digest,limit+1])).rows;
  const items=rows.slice(0,limit);return{items,next_cursor:items.at(-1)?.root_id??args.after_root_id,done:rows.length<=limit};
 });
}
export async function readSignalWorkspaceIncrementalParentArtifactsV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;
 after_artifact_key?:string;limit?:number}){
 const limit=limitOf(args.limit),descriptor=descriptorOf(args.lease);
 return withSignalWorkspaceEngineLeaseV1({...args,full:true},async(client,run)=>{
  if((await client.query<{valid:boolean}>('SELECT signal_workspace_incremental_parent_current_v1($1::uuid,$2::uuid,$3::uuid) valid',
   [descriptor.parent.execution_id,run.workspace_id,run.actor_user_id])).rows[0]?.valid!==true)return fail('parent_invalid');
  const rows=(await client.query<SignalWorkspaceIncrementalArtifactRefV1>(`SELECT ${refSql} FROM analysis_artifacts artifact
   WHERE artifact.workspace_id=$1::uuid AND artifact.engine_execution_id=$2::uuid AND artifact.artifact_type IN('engine_output','engine_model')
    AND artifact.metadata->>'filename'=artifact.artifact_key
    AND artifact.artifact_key NOT IN('model-manifest.json','incremental-input.json','current-roots.jsonl','incremental-output-index.json','incremental-history.json')
    AND ($3::text IS NULL OR artifact.artifact_key COLLATE "C">$3 COLLATE "C") ORDER BY artifact.artifact_key COLLATE "C" LIMIT $4`,
   [run.workspace_id,descriptor.parent.execution_id,args.after_artifact_key??null,limit+1])).rows;
  const items=publicRefs(rows.slice(0,limit));return{items,next_cursor:items.at(-1)?.artifact_key??args.after_artifact_key??null,done:rows.length<=limit};
 });
}

export async function persistSignalWorkspaceIncrementalInputV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;
 artifact:SignalWorkspaceEngineArtifactV1;input:SignalWorkspaceIncrementalInputV1;roots_count:number;chunks_count:number;
 input_files:Array<{name:string;storage_key:string;sha256:string;size_bytes:number;media_type:string}>}){
 const input=signalWorkspaceIncrementalInputSchemaV1.parse(args.input),descriptor=descriptorOf(args.lease);
 const names=['manifest.json','chunks.jsonl','vectors.npy','guides.jsonl','guide-vectors.npy','current-roots.jsonl'];
 const prefix=`workspace-engine/${args.lease.workspace_id}/${args.lease.execution_id}/`;
 if(args.input_files.length!==names.length||new Set(args.input_files.map(ref=>ref.name)).size!==names.length
  ||args.input_files.some(ref=>!names.includes(ref.name)||!ref.storage_key.startsWith(prefix)||ref.storage_key.includes('..')
   ||!hash.test(ref.sha256)||!Number.isSafeInteger(ref.size_bytes)||ref.size_bytes<0||!ref.media_type||ref.media_type.length>120)
  ||args.input_files.find(ref=>ref.name==='manifest.json')?.sha256!==input.current_input_manifest.sha256
  ||args.input_files.find(ref=>ref.name==='manifest.json')?.size_bytes!==input.current_input_manifest.bytes
  ||args.input_files.find(ref=>ref.name==='current-roots.jsonl')?.sha256!==input.current_roots.sha256
  ||args.input_files.find(ref=>ref.name==='current-roots.jsonl')?.size_bytes!==input.current_roots.bytes)return fail('input_files_invalid',422);
 if(input.workspace_id!==args.lease.workspace_id||input.execution_id!==args.lease.execution_id
  ||input.parent.execution_id!==descriptor.parent.execution_id||input.parent.manifest_sha256!==descriptor.parent.manifest_sha256
  ||digest(input.compatibility)!==digest(descriptor.compatibility)||input.discovery.close_requested!==descriptor.discovery.close_requested
  ||args.artifact.artifact_key!=='incremental-input.json'||args.artifact.artifact_type!=='engine_output')return fail('input_invalid',422);
 return withSignalWorkspaceEngineLeaseV1({...args,full:true},async(client,run)=>{
  if(args.roots_count!==run.input_snapshot.expected_roots||args.chunks_count!==run.input_snapshot.expected_chunks)return fail('coverage_invalid');
  const saved=await persistSignalWorkspaceEngineArtifactWithClientV1(client,run,{...args.artifact,metadata:{
   contract_version:'workspace-incremental-input-checkpoint-v1',descriptor_digest:descriptor.descriptor_digest,input_digest:run.input_digest,
   roots_count:args.roots_count,chunks_count:args.chunks_count,input,input_files:args.input_files}});
  await client.query(`UPDATE signal_topic_catalog_executions SET result_summary=result_summary||jsonb_build_object('numeric_input_artifact_id',$2::text),
   updated_at=clock_timestamp() WHERE id=$1::uuid`,[run.id,saved.artifact_id]);return saved;
 });
}
export async function persistSignalWorkspaceIncrementalOutputIndexV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;
 artifact:SignalWorkspaceEngineArtifactV1;input_artifact_id:string;output_manifest:{sha256:string;size_bytes:number};file_count:number}){
 const descriptor=descriptorOf(args.lease);
 if(args.artifact.artifact_key!=='incremental-output-index.json'||args.artifact.artifact_type!=='engine_output'
  ||!hash.test(args.output_manifest.sha256)||count(args.output_manifest.size_bytes)<1||count(args.file_count)<1)return fail('output_index_invalid',422);
 return withSignalWorkspaceEngineLeaseV1({...args,full:true},async(client,run)=>{
  if(run.result_summary.numeric_input_artifact_id!==args.input_artifact_id)return fail('input_checkpoint_required');
  return persistSignalWorkspaceEngineArtifactWithClientV1(client,run,{...args.artifact,metadata:{contract_version:'workspace-incremental-output-index-v1',
   descriptor_digest:descriptor.descriptor_digest,input_artifact_id:args.input_artifact_id,output_manifest:args.output_manifest,file_count:args.file_count}});
 });
}
export async function readSignalWorkspaceIncrementalCheckpointV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1}){
 descriptorOf(args.lease);
 return withSignalWorkspaceEngineLeaseV1({...args,full:true},async(client,run)=>{
  const rows=publicRefs((await client.query<SignalWorkspaceIncrementalArtifactRefV1>(`SELECT ${refSql} FROM analysis_artifacts artifact
   WHERE artifact.workspace_id=$1::uuid AND artifact.engine_execution_id=$2::uuid
    AND artifact.artifact_key IN('incremental-input.json','incremental-output-index.json')`,[run.workspace_id,run.id])).rows);
  const input_artifact=rows.find(row=>row.artifact_key==='incremental-input.json')??null;
  const output_index_artifact=rows.find(row=>row.artifact_key==='incremental-output-index.json')??null;
  const numeric_checkpoint=(run.result_summary.numeric_checkpoint??null) as SignalWorkspaceIncrementalCheckpointV1|null;
  if(output_index_artifact&&!input_artifact||numeric_checkpoint&&(!input_artifact||!output_index_artifact))return fail('checkpoint_invalid');
  return{input_artifact,output_index_artifact,numeric_checkpoint};
 });
}
/** The draft bank anchors bytes, not approval. Components are checked separately
 * before a complete numerical checkpoint can expose it as a usable parent. */
export async function registerSignalWorkspaceIncrementalModelBankV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;
 model_bank_artifact_id:string;output_artifact_id:string}){
 const descriptor=descriptorOf(args.lease);
 return withSignalWorkspaceEngineLeaseV1({...args,full:true},async(client,run)=>{
  const rows=(await client.query<{id:string;artifact_type:string;content:{sha256:string}}>(`SELECT id,artifact_type,content FROM analysis_artifacts
   WHERE workspace_id=$1::uuid AND engine_execution_id=$2::uuid AND id=ANY($3::uuid[])`,[run.workspace_id,run.id,[args.model_bank_artifact_id,args.output_artifact_id]])).rows;
  const model=rows.find(row=>row.id===args.model_bank_artifact_id&&row.artifact_type==='engine_model');
  const output=rows.find(row=>row.id===args.output_artifact_id&&row.artifact_type==='engine_output');if(!model||!output)return fail('bank_artifacts_missing');
  const configuration={contract_version:'workspace-topic-engine-v1',numeric_contract:'workspace-incremental-model-bank-v1',
   execution_id:run.id,input_digest:run.input_digest,descriptor_digest:descriptor.descriptor_digest,
   model_artifact_id:model.id,output_artifact_id:output.id,compatibility:descriptor.compatibility,approval_policy:'none'};
  const request=digest({configuration,artifact:model.content.sha256});
  return(await client.query<{model_version_id:string}>(`SELECT model_version_id FROM register_signal_tagging_model_v1(
   $1::uuid,$2::uuid,$3,$4,'workspace-python',NULL,$5,'python','workspace-incremental-model-bank-v1',$6::jsonb,$7,$8,NULL,NULL,$9,NULL,$10::uuid,$11,$11)`,
   [run.workspace_id,run.input_snapshot.taxonomy_profile_id,`workspace-incremental:${run.workspace_id}`,run.id,model.content.sha256,
    JSON.stringify(configuration),digest(configuration),run.input_digest,digest({model:model.content.sha256,output:output.content.sha256,input:run.input_digest}),run.actor_user_id,request])).rows[0]!;
 });
}
export async function registerSignalWorkspaceIncrementalComponentsV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;
 model_version_id:string;components:Array<Omit<SignalWorkspaceIncrementalComponentV1,'origin_model_artifact_id'|'origin_registry_id'|'parent_component_artifact_id'>>}){
 const descriptor=descriptorOf(args.lease);limitOf(args.components.length);
 return withSignalWorkspaceEngineLeaseV1({...args,full:true},async(client,run)=>{
  const saved:Array<{artifact_id:string;component_key:string;replayed:boolean}>=[];
  for(const component of args.components){
   if(!hash.test(component.component_key)||!hash.test(component.model_origin.model_artifact_sha256)||!hash.test(component.unit_digest)
    ||!['open','guided'].includes(component.lane)||count(component.unit_count)<0
    ||component.component_key!==digest([component.model_origin.execution_id,component.model_origin.model_artifact_sha256,component.lane]))return fail('component_invalid',422);
   const model=(await client.query<{artifact_key:string;content:{storage_key:string;sha256:string;size_bytes:number;media_type:string}}>(
    `SELECT artifact_key,content FROM analysis_artifacts WHERE id=$1::uuid AND workspace_id=$2::uuid AND engine_execution_id=$3::uuid AND artifact_type='engine_model'`,
    [component.model_artifact_id,run.workspace_id,run.id])).rows[0];
   if(!model||model.content.sha256!==component.model_origin.model_artifact_sha256)return fail('component_model_invalid');
   const own=component.model_origin.execution_id===run.id;
   const origin=own?{artifact_id:component.model_artifact_id,registry_id:args.model_version_id}:
    (await client.query<{artifact_id:string;registry_id:string}>(`SELECT artifact.id artifact_id,
     COALESCE(origin.result_summary->'numeric_checkpoint'->>'model_version_id',origin.result_summary->'fit_checkpoint'->>'model_version_id') registry_id
     FROM signal_topic_catalog_executions origin JOIN analysis_artifacts artifact ON artifact.engine_execution_id=origin.id AND artifact.workspace_id=origin.workspace_id
     WHERE origin.id=$1::uuid AND origin.workspace_id=$2::uuid AND artifact.artifact_type='engine_model'
      AND artifact.content->>'sha256'=$3 AND artifact.metadata->>'filename'=artifact.artifact_key
     ORDER BY artifact.id LIMIT 1`,[component.model_origin.execution_id,run.workspace_id,component.model_origin.model_artifact_sha256])).rows[0];
   if(!origin)return fail('component_origin_invalid');
   const parentAlias=(await client.query<{id:string}>(`SELECT id FROM analysis_artifacts WHERE workspace_id=$1::uuid AND engine_execution_id=$2::uuid
    AND metadata->>'contract_version'='workspace-incremental-component-v1' AND metadata->>'component_key'=$3`,
    [run.workspace_id,descriptor.parent.execution_id,component.component_key])).rows[0];
   const metadata={contract_version:'workspace-incremental-component-v1',...component,
    descriptor_digest:descriptor.descriptor_digest,origin_model_artifact_id:origin.artifact_id,origin_registry_id:origin.registry_id,
    parent_component_artifact_id:parentAlias?.id??null,bank_registry_id:args.model_version_id};
   const result=await persistSignalWorkspaceEngineArtifactWithClientV1(client,run,{artifact_key:`component-${component.component_key.slice(7)}`,
    artifact_type:'engine_model',title:'Frozen numeric component',...model.content,size_bytes:count(model.content.size_bytes),metadata});
   saved.push({...result,component_key:component.component_key});
  }
  return{items:saved};
 });
}
export async function readSignalWorkspaceIncrementalParentComponentsV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;
 after_component_key?:string;limit?:number}){
 const limit=limitOf(args.limit),descriptor=descriptorOf(args.lease);
 return withSignalWorkspaceEngineLeaseV1({...args,full:true},async(client,run)=>{
  const rows=(await client.query<{artifact_id:string;metadata:SignalWorkspaceIncrementalComponentV1}>(`SELECT id artifact_id,metadata FROM analysis_artifacts
   WHERE workspace_id=$1::uuid AND engine_execution_id=$2::uuid AND metadata->>'contract_version'='workspace-incremental-component-v1'
    AND ($3::text IS NULL OR metadata->>'component_key'>$3) ORDER BY metadata->>'component_key' LIMIT $4`,
   [run.workspace_id,descriptor.parent.execution_id,args.after_component_key??null,limit+1])).rows;
  const items=rows.slice(0,limit);return{items,next_cursor:items.at(-1)?.metadata.component_key??args.after_component_key??null,done:rows.length<=limit};
 });
}

export async function readSignalWorkspaceIncrementalEditorialHistoryV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;
 after_artifact_id?:string;limit?:number}){
 const descriptor=descriptorOf(args.lease),limit=limitOf(args.limit);
 return withSignalWorkspaceEngineLeaseV1({...args,full:true},async(client,run)=>{
  const parent=descriptor.parent.execution_id;
  await assertEditorialCut(client,run.id,descriptor);
  const history=(await client.query<SignalWorkspaceIncrementalArtifactRefV1>(`SELECT ${refSql} FROM signal_topic_catalog_executions parent
   JOIN analysis_artifacts artifact ON artifact.id::text=parent.result_summary->'numeric_checkpoint'->>'history_artifact_id'
   AND artifact.workspace_id=parent.workspace_id WHERE parent.id=$1::uuid AND parent.workspace_id=$2::uuid`,[parent,run.workspace_id])).rows;
  const rows=(await client.query<SignalWorkspaceIncrementalArtifactRefV1>(`SELECT ${refSql} FROM analysis_artifacts artifact
   JOIN engine_cost_events call ON call.id::text=artifact.metadata->>'call_id' AND call.catalog_execution_id=artifact.engine_execution_id
    AND call.workspace_id=artifact.workspace_id AND call.call_state='settled' AND call.response_storage_key IS NOT NULL
    AND COALESCE((call.metadata->>'response_complete')::boolean,true)
   WHERE artifact.workspace_id=$1::uuid AND artifact.engine_execution_id=$2::uuid
    AND artifact.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1'
    AND artifact.created_at<=(SELECT created_at FROM signal_topic_catalog_executions WHERE id=$5::uuid)
    AND ($3::uuid IS NULL OR artifact.id>$3::uuid) ORDER BY artifact.id LIMIT $4`,[run.workspace_id,parent,args.after_artifact_id??null,limit+1,run.id])).rows;
  await assertEditorialCut(client,run.id,descriptor);
  const items=publicRefs(rows.slice(0,limit));return{parent_history:publicRefs(history)[0]??null,items,
   next_cursor:items.at(-1)?.artifact_id??args.after_artifact_id??null,done:rows.length<=limit};
 });
}
async function assertEditorialCut(client:Queryable,executionId:string,descriptor:SignalWorkspaceIncrementalDescriptorV1){
 const cut=(await client.query<{unit_count:string;unit_digest:string}>(
  'SELECT unit_count::text,unit_digest FROM signal_workspace_incremental_editorial_cut_v1($1::uuid,$2::uuid)',
  [descriptor.parent.execution_id,executionId])).rows[0]!;
 if(count(cut.unit_count)!==descriptor.editorial_cut.unit_count||cut.unit_digest!==descriptor.editorial_cut.unit_digest)return fail('history_changed');
}
export async function persistSignalWorkspaceIncrementalHistoryV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;
 artifact:SignalWorkspaceEngineArtifactV1;relations_artifact_id:string}){
 const descriptor=descriptorOf(args.lease);
 if(args.artifact.artifact_key!=='incremental-history.json'||args.artifact.artifact_type!=='engine_output')return fail('history_invalid');
 return withSignalWorkspaceEngineLeaseV1({...args,full:true},async(client,run)=>{
  await assertEditorialCut(client,run.id,descriptor);
  const history=(await client.query<{parent_history_artifact_id:string|null;unit_count:string;unit_digest:string}>(`SELECT
   parent.result_summary->'numeric_checkpoint'->>'history_artifact_id' parent_history_artifact_id,
   coverage.unit_count::text,coverage.unit_digest FROM signal_topic_catalog_executions parent
   CROSS JOIN LATERAL signal_workspace_incremental_editorial_cut_v1(parent.id,$3::uuid) coverage
   WHERE parent.id=$1::uuid AND parent.workspace_id=$2::uuid`,[descriptor.parent.execution_id,run.workspace_id,run.id])).rows[0]!;
  return persistSignalWorkspaceEngineArtifactWithClientV1(client,run,{...args.artifact,metadata:{contract_version:'workspace-incremental-history-v1',
   parent_execution_id:descriptor.parent.execution_id,parent_manifest_sha256:descriptor.parent.manifest_sha256,
   parent_history_artifact_id:history.parent_history_artifact_id,parent_paid_units:count(history.unit_count),parent_paid_unit_digest:history.unit_digest,
   relations_artifact_id:args.relations_artifact_id,relations_scope:'execution',editorial_completion:'not_evaluated'}});
 });
}

export async function checkpointSignalWorkspaceIncrementalOutputV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;
 input_artifact_id:string;output_index_artifact_id:string;output_artifact_id:string;model_bank_artifact_id:string|null;model_version_id:string|null;
 history_artifact_id:string;output:unknown;validation:SignalWorkspaceIncrementalValidationV1}):Promise<SignalWorkspaceIncrementalCheckpointV1>{
 const output=signalWorkspaceIncrementalOutputSchemaV1.parse(args.output),descriptor=descriptorOf(args.lease);
 if(output.workspace_id!==args.lease.workspace_id||output.execution_id!==args.lease.execution_id
  ||output.previous_manifest_sha256!==descriptor.parent.manifest_sha256||digest(output.compatibility)!==digest(descriptor.compatibility))return fail('output_invalid');
 return withSignalWorkspaceEngineLeaseV1({...args,full:true},async(client,run)=>{
  if(output.counts.roots!==run.input_snapshot.expected_roots||output.counts.occurrences!==run.input_snapshot.expected_chunks
   ||run.processed_roots!==output.counts.roots||count(run.processed_chunks)!==output.counts.occurrences)return fail('coverage_invalid');
  const input=(await client.query<{metadata:{input:SignalWorkspaceIncrementalInputV1}}>(`SELECT metadata FROM analysis_artifacts WHERE id=$1::uuid
   AND workspace_id=$2::uuid AND engine_execution_id=$3::uuid AND metadata->>'contract_version'='workspace-incremental-input-checkpoint-v1'`,
   [args.input_artifact_id,run.workspace_id,run.id])).rows[0];
  if(!input||output.request_digest!==digest({input:input.metadata.input,runtime_digest:descriptor.compatibility.runtime_digest}))return fail('input_checkpoint_invalid');
  // Require all manifest files as immutable artifact rows before finalizing. No
  // array of memberships or component labels is written to the execution row.
  const files=(await client.query<{artifact_key:string;content:{sha256:string;size_bytes:number}}>(`SELECT artifact_key,content FROM analysis_artifacts
   WHERE workspace_id=$1::uuid AND engine_execution_id=$2::uuid AND metadata->>'filename'=artifact_key`,[run.workspace_id,run.id])).rows;
  const byFile=new Map(files.map(file=>[file.artifact_key,file]));
  for(const file of output.artifacts){const stored=byFile.get(file.file);if(!stored||stored.content.sha256!==file.sha256||count(stored.content.size_bytes)!==file.bytes)return fail('output_artifacts_missing');}
  const manifestFile=byFile.get('manifest.json');if(!manifestFile)return fail('output_artifacts_missing');
  const allFiles=[{file:'manifest.json',sha256:manifestFile.content.sha256,bytes:count(manifestFile.content.size_bytes)},...output.artifacts]
   .sort((a,b)=>a.file<b.file?-1:1);
  const originDigest=digest(output.components.map(component=>({component_key:component.component_key,lane:component.lane,model_origin:component.model_origin,
   model:{sha256:component.model.sha256,bytes:component.model.bytes},center:component.center&&{sha256:component.center.sha256,bytes:component.center.bytes},units:component.units})));
  const validation:SignalWorkspaceIncrementalValidationV1={contract_version:'workspace-incremental-file-validation-v1',request_digest:output.request_digest,
   population_digest:output.population_digest,complete_file_digest:digest(allFiles),origin_digest:originDigest,roots:output.counts.roots,
   occurrences:output.counts.occurrences,memberships:output.counts.memberships,pending_occurrences:output.counts.pending_occurrences,relations_scope:'new_candidates_in_this_execution'};
  if(digest(args.validation)!==digest(validation))return fail('file_validation_invalid');
  const aliases=(await client.query<{metadata:SignalWorkspaceIncrementalComponentV1}>(`SELECT metadata FROM analysis_artifacts WHERE workspace_id=$1::uuid
   AND engine_execution_id=$2::uuid AND metadata->>'contract_version'='workspace-incremental-component-v1'`,[run.workspace_id,run.id])).rows;
  for(const component of output.components){const alias=aliases.find(row=>row.metadata.component_key===component.component_key)?.metadata;
   if(!alias||alias.unit_count!==component.units.length||alias.unit_digest!==digest(component.units)||digest(alias.model_origin)!==digest(component.model_origin))return fail('component_manifest_invalid');
   const model=files.find(row=>row.content.sha256===component.model.sha256&&row.artifact_key===component.model.file);
   const center=component.center?files.find(row=>row.content.sha256===component.center!.sha256&&row.artifact_key===component.center!.file):null;
   if(!model||component.center&&!center)return fail('component_manifest_invalid');
  }
  const components=[...output.components].sort((a,b)=>a.component_key.localeCompare(b.component_key)).map(component=>[
   component.component_key,component.lane,component.model_origin,component.units.length,digest(component.units)]);
  const body={contract_version:'workspace-incremental-numeric-checkpoint-v1' as const,descriptor_digest:descriptor.descriptor_digest,
   input_artifact_id:args.input_artifact_id,output_index_artifact_id:args.output_index_artifact_id,output_artifact_id:args.output_artifact_id,
   model_bank_artifact_id:args.model_bank_artifact_id,model_version_id:args.model_version_id,history_artifact_id:args.history_artifact_id,
   validation_digest:digest(validation),population_digest:output.population_digest,roots:output.counts.roots,occurrences:output.counts.occurrences,components:output.counts.components,
   component_digest:digest(components),model_bank_bytes:output.counts.model_bank_bytes,
   discovery_status:output.discovery_status,relations_status:output.relations_status,numeric_complete:true as const,analysis_complete:false as const};
  const checkpoint={...body,checkpoint_digest:digest(body)};
  const prior=run.result_summary.numeric_checkpoint as SignalWorkspaceIncrementalCheckpointV1|undefined;
  if(prior){if(prior.checkpoint_digest!==checkpoint.checkpoint_digest)return fail('checkpoint_conflict');return prior;}
  await client.query(`UPDATE signal_topic_catalog_executions SET result_summary=result_summary||jsonb_build_object('numeric_checkpoint',$2::jsonb,
   'phase','persisting','numeric_complete',true,'analysis_complete',false),progress=90,updated_at=clock_timestamp() WHERE id=$1::uuid`,[run.id,JSON.stringify(checkpoint)]);
  return checkpoint;
 });
}
export async function finishSignalWorkspaceIncrementalNumericV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;checkpoint_digest:string}){
 descriptorOf(args.lease);
 return withSignalWorkspaceEngineLeaseV1({...args,full:true},async(client,run)=>{
  const checkpoint=run.result_summary.numeric_checkpoint as SignalWorkspaceIncrementalCheckpointV1|undefined;
  if(!checkpoint||checkpoint.checkpoint_digest!==args.checkpoint_digest)return fail('checkpoint_required');
  await client.query(`UPDATE signal_topic_catalog_executions SET status='ready',progress=100,result_summary=result_summary||
   jsonb_build_object('phase','complete','result_kind','incremental_numeric','numeric_complete',true,'analysis_complete',false),
   execution_token=NULL,execution_expires_at=NULL,completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1::uuid`,[run.id]);
  await client.query(`UPDATE signal_topic_classification_outbox SET status='completed',completed_at=clock_timestamp(),lease_token=NULL,
   lease_expires_at=NULL,updated_at=clock_timestamp() WHERE execution_id=$1::uuid AND dispatch_kind='execution'`,[run.id]);
  return{execution_id:run.id,numeric_complete:true as const,analysis_complete:false as const,checkpoint};
 });
}
export async function loadSignalWorkspaceIncrementalStatusV1(args:{database:SignalWorkspaceEngineDatabaseV1;workspace_id:string;actor_user_id:string;execution_id:string}){
 return withSignalWorkspaceEngineTransactionV1(args.database,async client=>{
  if(!(await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,...args})).can_view)return fail('forbidden',403);
  const row=(await client.query<{execution_id:string;status:'queued'|'running'|'failed'|'ready';phase:string;error_code:string|null;
   numeric_checkpoint:SignalWorkspaceIncrementalCheckpointV1|null;input_revision:string;is_current:boolean;context_digest:string;catalog_digest:string;taxonomy_profile_id:string}>(`SELECT id execution_id,status,result_summary->>'phase' phase,error_code,
    result_summary->'numeric_checkpoint' numeric_checkpoint,input_revision::text,input_snapshot->>'context_digest' context_digest,input_snapshot->>'catalog_digest' catalog_digest,input_snapshot->>'taxonomy_profile_id' taxonomy_profile_id,
    input_revision=(SELECT input_revision FROM signal_corpus_preparation_input_state WHERE workspace_id=$1::uuid)
     AND (policy_valid_until IS NULL OR policy_valid_until>clock_timestamp()) AND signal_workspace_incremental_execution_current_v1(id) is_current
    FROM signal_topic_catalog_executions WHERE workspace_id=$1::uuid AND id=$2::uuid AND input_contract='workspace-topic-engine-v1'
     AND input_snapshot ? 'numeric_descriptor'`,[args.workspace_id,args.execution_id])).rows[0];
  if(!row)return null;
  const {context_digest,catalog_digest,taxonomy_profile_id,...view}=row;
  if(view.is_current){try{const identity=await loadSignalWorkspaceEngineInputIdentityV1({queryable:client,...args,taxonomy_profile_id});
   view.is_current=identity.context_digest===context_digest&&identity.catalog_digest===catalog_digest;
  }catch(error){if(error instanceof Error&&['workspace_topic_catalog_required','workspace_topic_catalog_empty'].includes(error.message))view.is_current=false;else throw error;}}
  return{...view,numeric_complete:!!row.numeric_checkpoint,analysis_complete:false as const};
 });
}

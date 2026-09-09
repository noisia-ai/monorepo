import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {signalWorkspaceIncrementalDigestV1 as digest,type SignalWorkspaceIncrementalInputV1} from '@noisia/query-engine';
import * as engine from '../signal-workspace-engine';
import * as numeric from '../signal-workspace-engine-incremental';
import * as progress from '../signal-workspace-engine-progress';
import * as projection from '../signal-workspace-topic-projection';
import * as classification from '../signal-workspace-classification';
import {signalWorkspaceTopicProjectionJobV1} from '../../../services/workers/src/workers/signal-workspace-topic-projection';
import {type WorkspaceProjectionCheckpointFixtureV1,fixtureSha} from './signal-workspace-topic-projection.fixture';
/** Genuine local ledger/fit/checkpoint APIs with explicit synthetic numerical
 * bytes. No model is loaded and no provider is called by this fixture. */
export async function incrementalProjectionFixtureV1(f:WorkspaceProjectionCheckpointFixtureV1,clusterIds:readonly[string,string],options:{
 emerging_component?:boolean;migrations_applied?:boolean;
 onInputCheckpoint?:(args:{lease:engine.SignalWorkspaceEngineLeaseV1;artifact_id:string})=>Promise<engine.SignalWorkspaceEngineLeaseV1>;
 onOutputIndex?:(args:{lease:engine.SignalWorkspaceEngineLeaseV1;artifact_id:string})=>Promise<engine.SignalWorkspaceEngineLeaseV1>;
 onNumericCheckpoint?:(args:{lease:engine.SignalWorkspaceEngineLeaseV1;checkpoint:numeric.SignalWorkspaceIncrementalCheckpointV1})=>Promise<void>;
}={}){
 const {database,query,access,bodies}=f,workspace_id=access.workspace_id,source=f.lease,parentId=source.execution_id;
 if(!options.migrations_applied){await query(await readFile(new URL('./0145_signal_workspace_incremental_numeric.sql',import.meta.url),'utf8'));
 await query(await readFile(new URL('./0146_signal_workspace_incremental_projection.sql',import.meta.url),'utf8'));}
 const artifact=(lease:engine.SignalWorkspaceEngineLeaseV1,name:string,type:engine.SignalWorkspaceEngineArtifactV1['artifact_type'],body:string,
  metadata:Record<string,unknown>={}):engine.SignalWorkspaceEngineArtifactV1=>{
  const storage_key=`workspace-engine/${workspace_id}/${lease.execution_id}/${name}`;bodies.set(storage_key,body);
  return{artifact_key:name,artifact_type:type,title:'Explicit local incremental projection fixture',storage_key,
   sha256:fixtureSha(body),size_bytes:Buffer.byteLength(body),media_type:'application/octet-stream',metadata:{filename:name,...metadata}};
 };
 const modelBodies={open:'opaque open fixture model',guided:'opaque guided fixture model'},centerBody='opaque fixed center';
 for(const lane of ['open','guided'] as const)await engine.persistSignalWorkspaceEngineArtifactV1({database,lease:source,artifact:artifact(source,`model.${lane}.joblib`,'engine_model',modelBodies[lane])});
 await engine.persistSignalWorkspaceEngineArtifactV1({database,lease:source,artifact:artifact(source,'guide-center.npy','engine_model',centerBody)});
 await engine.persistSignalWorkspaceEngineArtifactV1({database,lease:source,artifact:artifact(source,'guide-vectors.npy','engine_output','local guide bytes')});
 const scope={...access,execution_id:parentId};
 const current=await progress.readSignalWorkspaceEngineMaterializationSourceV1(scope);
 async function* packets(){yield*f.proposals;}
 const materialized=await progress.materializeSignalWorkspaceEngineTopicsProgressV1({...scope,expected_coverage:current.coverage,
  expected_catalog_profile_id:current.catalog_profile_id,proposals:packets()});
 const {mapping,replayed:_replayed,...metadata}=materialized;
 const progressArtifact=artifact(source,`materialization-progress-${materialized.output_catalog_profile_id}.json`,'engine_proposals',JSON.stringify({...metadata,mapping}),metadata);
 progressArtifact.metadata=metadata;
 const old=await progress.persistSignalWorkspaceEngineTopicsProgressV1({...scope,expected_coverage:current.coverage,artifact:progressArtifact});
 const storage={get:async({stored,destination}:{stored:{storage_key:string};destination:string})=>{
  const body=bodies.get(stored.storage_key);if(body===undefined)throw Error('local artifact missing');await writeFile(destination,body);},
  put:async({execution_id,file,sha256,size_bytes,media_type}:{execution_id:string;file:string;sha256:string;size_bytes:number;media_type:string})=>{
   const storage_key=`workspace-engine/${workspace_id}/${execution_id}/${basename(file)}`;bodies.set(storage_key,await readFile(file,'utf8'));return{storage_key,sha256,size_bytes,media_type};}};
 const oldJob=(await query("SELECT worker_job_id FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid AND dispatch_kind='execution'",[old.projection_execution_id])).rows[0]!.worker_job_id;
 await signalWorkspaceTopicProjectionJobV1({id:oldJob,data:{execution_id:old.projection_execution_id},updateProgress:async()=>{}},{database,storage,stores:{claim:projection.claimSignalWorkspaceTopicProjectionV1,heartbeat:projection.heartbeatSignalWorkspaceTopicProjectionV1,readTopics:projection.readSignalWorkspaceTopicProjectionTopicsV1,readProposals:projection.readSignalWorkspaceTopicProjectionProposalsV1,readPage:classification.readSignalWorkspaceClassificationPageV1,readChunksPage:classification.readSignalWorkspaceClassificationChunksPageV1,commitPage:classification.commitSignalWorkspaceClassificationPageV1,finish:classification.finishSignalWorkspaceClassificationV1,fail:classification.failSignalWorkspaceClassificationV1}});
 await engine.failSignalWorkspaceEngineV1({database,lease:source,error_code:'workspace_engine_interpretation_daily_authority_expired'});
 const request=await numeric.beginSignalWorkspaceIncrementalEngineV1({...access,idempotency_key:randomUUID(),embedding_run_id:source.snapshot.embedding_run_id,
  expected_context_digest:source.snapshot.context_digest,expected_catalog_digest:source.snapshot.catalog_digest,engine_config:source.snapshot.engine_config,close_requested:false});
 const claimed=await engine.claimSignalWorkspaceEngineV1({database,...request,worker_job_id:`workspace-engine-${request.execution_id}-1`});if(!claimed)throw Error('numeric fixture lease missing');
 let lease:engine.SignalWorkspaceEngineLeaseV1=claimed;
 const descriptor=lease.snapshot.numeric_descriptor!,roots=(await numeric.readSignalWorkspaceIncrementalRootsV1({database,lease,after_root_id:null})).items;
 const chunks:Array<Awaited<ReturnType<typeof engine.readSignalWorkspaceEngineChunksV1>>['items'][number]>=[];
 let after:Parameters<typeof engine.readSignalWorkspaceEngineChunksV1>[0]['after']=null;
 for(;;){const page=await engine.readSignalWorkspaceEngineChunksV1({database,lease,after,limit:128});chunks.push(...page.items);if(page.done)break;after=page.next_cursor;}
 const rootBody=roots.map(row=>JSON.stringify(row)+'\n').join('');
 const input:SignalWorkspaceIncrementalInputV1={contract_version:'workspace-topic-incremental-input-v1',workspace_id,execution_id:lease.execution_id,
  mode:'frozen-model-delta',policy_version:'workspace-frozen-model-cohort-v1',current_input_manifest:{file:'manifest.json',sha256:fixtureSha('local input manifest'),bytes:20},
  current_roots:{file:'current-roots.jsonl',sha256:fixtureSha(rootBody),bytes:Buffer.byteLength(rootBody),rows:roots.length},
  parent:{execution_id:parentId,manifest_sha256:descriptor.parent.manifest_sha256},compatibility:descriptor.compatibility,
  discovery:{cohort_key:fixtureSha('local pending cohort'),close_requested:false}};
 const inputFiles=['manifest.json','chunks.jsonl','vectors.npy','guides.jsonl','guide-vectors.npy','current-roots.jsonl'].map(name=>({name,
  storage_key:`workspace-engine/${workspace_id}/${lease.execution_id}/input/${name}`,sha256:name==='manifest.json'?input.current_input_manifest.sha256:name==='current-roots.jsonl'?input.current_roots.sha256:fixtureSha(name),
  size_bytes:name==='manifest.json'?input.current_input_manifest.bytes:name==='current-roots.jsonl'?input.current_roots.bytes:1,media_type:'application/octet-stream'}));
 const savedInput=await numeric.persistSignalWorkspaceIncrementalInputV1({database,lease,input,roots_count:roots.length,chunks_count:chunks.length,input_files:inputFiles,
  artifact:artifact(lease,'incremental-input.json','engine_output',JSON.stringify(input))});
 if(options.onInputCheckpoint)lease=await options.onInputCheckpoint({lease,artifact_id:savedInput.artifact_id});
 const modelRefs=(['open','guided'] as const).map(lane=>({file:`model.${lane}.joblib`,sha256:fixtureSha(modelBodies[lane]),bytes:Buffer.byteLength(modelBodies[lane])}));
 const center={file:'guide-center.npy',sha256:fixtureSha(centerBody),bytes:Buffer.byteLength(centerBody)};
 const components=(['open','guided'] as const).map((lane,index)=>({component_key:digest([options.emerging_component&&index===1?lease.execution_id:parentId,modelRefs[index]!.sha256,lane]),lane,
  model_origin:{execution_id:options.emerging_component&&index===1?lease.execution_id:parentId,model_artifact_sha256:modelRefs[index]!.sha256},model:modelRefs[index]!,center:lane==='guided'?center:null,
  units:[{local_label:0,unit_key:`${lane}:${clusterIds[index]}`,birth_membership_digest:fixtureSha(`synthetic original ${lane} birth`)},...(options.emerging_component&&index===1?[{local_label:1,unit_key:'guided:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',birth_membership_digest:fixtureSha('synthetic empty emerging unit')}]:[])]})).sort((a,b)=>options.emerging_component?(a.component_key>b.component_key?-1:1):(a.component_key<b.component_key?-1:1));
 const populations=chunks.map((chunk,ordinal)=>({ordinal,root_id:chunk.root_id,root_fingerprint:chunk.root_fingerprint,
  asset_sha256:roots.find(root=>root.root_id===chunk.root_id)!.asset_sha256,expected_chunks:roots.find(root=>root.root_id===chunk.root_id)!.expected_chunks,
  chunk_index:chunk.chunk_index,start:chunk.start,end:chunk.end,chunk_sha256:chunk.chunk_sha256}));
 const population=digest(populations);
 const memberships=chunks.flatMap(chunk=>components.map(component=>({root_id:chunk.root_id,root_fingerprint:chunk.root_fingerprint,chunk_index:chunk.chunk_index,
  start:chunk.start,end:chunk.end,chunk_sha256:chunk.chunk_sha256,lane:component.lane,unit_key:component.units[0]!.unit_key,model_component_key:component.component_key,strength:0.8,
  model_origin:component.model_origin,evaluation_origin:{execution_id:lease.execution_id,input_population_digest:population,
   evaluation_key:digest([lease.execution_id,component.component_key,population,component.model_origin.execution_id===lease.execution_id?'fitted_member':'predicted_member']),basis:component.model_origin.execution_id===lease.execution_id?'fitted_member':'predicted_member'},carried_from:null})));
 const pendingRoot=roots[0]!.root_id,pending=populations.filter(row=>row.root_id===pendingRoot);
 const numericBodies=new Map<string,string>([
  ['population.jsonl',populations.map(row=>JSON.stringify(row)+'\n').join('')],['memberships.jsonl',memberships.map(row=>JSON.stringify(row)+'\n').join('')],
  ['roots.jsonl',roots.map(root=>JSON.stringify({...root,unit_keys:components.map(component=>component.units[0]!.unit_key).sort(),state:'computed',discovery_pending:root.root_id===pendingRoot})+'\n').join('')],
  ['pending-cohort.jsonl',pending.map(row=>JSON.stringify(row)+'\n').join('')],['model-components.json',JSON.stringify(components)],
  ['root-transitions.jsonl',''],['candidate-groups.json','[]'],['relations.json','[]'],['guides.jsonl',''],['guide-vectors.npy','local guide bytes'],
  ['model.open.joblib',modelBodies.open],['model.guided.joblib',modelBodies.guided],['guide-center.npy',centerBody]]);
 const files=[...numericBodies].map(([file,body])=>({file,sha256:fixtureSha(body),bytes:Buffer.byteLength(body)}));
 const output={contract_version:'workspace-topic-incremental-output-v1',workspace_id,execution_id:lease.execution_id,request_digest:digest({input,runtime_digest:descriptor.compatibility.runtime_digest}),
  previous_manifest_sha256:descriptor.parent.manifest_sha256,compatibility:descriptor.compatibility,policy_version:'workspace-frozen-model-cohort-v1',status:'completed',quality:'uncalibrated',approval_policy:'none',
  discovery_status:'pending_cohort_close',relations_status:'none',population_digest:population,counts:{roots:roots.length,occurrences:chunks.length,added_roots:0,
   content_changed_roots:0,metadata_changed_roots:0,unchanged_roots:roots.length,removed_roots:0,delta_occurrences:0,cohort_occurrences:pending.length,pending_occurrences:pending.length,
   memberships:memberships.length,components:components.length,new_components:options.emerging_component?1:0,model_bank_bytes:modelRefs.reduce((n,row)=>n+row.bytes,center.bytes)},
  components,artifacts:files,coverage:components.map(component=>({component_key:component.component_key,population_digest:population,expected_occurrences:chunks.length,copied_occurrences:0,transformed_occurrences:component.model_origin.execution_id===lease.execution_id?0:chunks.length,fitted_occurrences:component.model_origin.execution_id===lease.execution_id?chunks.length:0})),
  operations:{fit:components.filter(component=>component.model_origin.execution_id===lease.execution_id).map(component=>({component_key:component.component_key,occurrences:chunks.length,population_digest:population})),transform:components.filter(component=>component.model_origin.execution_id!==lease.execution_id).map(component=>({component_key:component.component_key,occurrences:chunks.length,pages:2,maximum_page_rows:128}))},metrics:{resident_bytes:0,elapsed_seconds:0},limitations:['Explicit local synthetic evidence; no fit or provider.']};
 const outputBody=JSON.stringify(output),manifest={file:'manifest.json',sha256:fixtureSha(outputBody),bytes:Buffer.byteLength(outputBody)};
 const index=await numeric.persistSignalWorkspaceIncrementalOutputIndexV1({database,lease,input_artifact_id:savedInput.artifact_id,output_manifest:{sha256:manifest.sha256,size_bytes:manifest.bytes},file_count:files.length+3,
  artifact:artifact(lease,'incremental-output-index.json','engine_output','local inventory')});
 if(options.onOutputIndex)lease=await options.onOutputIndex({lease,artifact_id:index.artifact_id});
 const stored=new Map<string,string>();for(const [name,body] of numericBodies)stored.set(name,(await engine.persistSignalWorkspaceEngineArtifactV1({database,lease,
  artifact:artifact(lease,name,name.endsWith('.joblib')||name==='guide-center.npy'?'engine_model':'engine_output',body)})).artifact_id);
 const outputArtifact=await engine.persistSignalWorkspaceEngineArtifactV1({database,lease,artifact:artifact(lease,'manifest.json','engine_output',outputBody)});
 const bankArtifact=await engine.persistSignalWorkspaceEngineArtifactV1({database,lease,artifact:artifact(lease,'model-manifest.json','engine_model','local bank')});
 const registry=await numeric.registerSignalWorkspaceIncrementalModelBankV1({database,lease,model_bank_artifact_id:bankArtifact.artifact_id,output_artifact_id:outputArtifact.artifact_id});
 await numeric.registerSignalWorkspaceIncrementalComponentsV1({database,lease,model_version_id:registry.model_version_id,components:components.map(component=>({component_key:component.component_key,lane:component.lane,
  model_origin:component.model_origin,model_artifact_id:stored.get(component.model.file)!,center_artifact_id:component.center?stored.get(component.center.file)!:null,unit_count:component.units.length,unit_digest:digest(component.units)}))});
 const history=await numeric.persistSignalWorkspaceIncrementalHistoryV1({database,lease,relations_artifact_id:stored.get('relations.json')!,artifact:artifact(lease,'incremental-history.json','engine_output','paid parent references')});
 await engine.heartbeatSignalWorkspaceEngineV1({database,lease,phase:'persisting',exported:{roots:roots.length,chunks:chunks.length,guides:lease.snapshot.expected_guides,stream_digest:input.current_input_manifest.sha256}});
 const checkpoint=await numeric.checkpointSignalWorkspaceIncrementalOutputV1({database,lease,input_artifact_id:savedInput.artifact_id,output_index_artifact_id:index.artifact_id,output_artifact_id:outputArtifact.artifact_id,
  model_bank_artifact_id:bankArtifact.artifact_id,model_version_id:registry.model_version_id,history_artifact_id:history.artifact_id,output,validation:{contract_version:'workspace-incremental-file-validation-v1',
   request_digest:output.request_digest,population_digest:population,complete_file_digest:digest([manifest,...files].sort((a,b)=>a.file<b.file?-1:1)),
   origin_digest:digest(components.map(component=>({component_key:component.component_key,lane:component.lane,model_origin:component.model_origin,
    model:{sha256:component.model.sha256,bytes:component.model.bytes},center:component.center?{sha256:component.center.sha256,bytes:component.center.bytes}:null,units:component.units}))),
   roots:roots.length,occurrences:chunks.length,memberships:memberships.length,pending_occurrences:pending.length,relations_scope:'new_candidates_in_this_execution'}});
 await options.onNumericCheckpoint?.({lease,checkpoint});
 await numeric.finishSignalWorkspaceIncrementalNumericV1({database,lease,checkpoint_digest:checkpoint.checkpoint_digest});
 return{...f,lease,roots,chunks,components,checkpoint,old,storage,artifact,output};
}

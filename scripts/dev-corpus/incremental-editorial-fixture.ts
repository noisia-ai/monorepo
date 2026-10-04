/** Explicit synthetic numeric artifacts for rollback-only MFP ledger checks. Never invokes Python or a provider. */
import {createHash,randomUUID} from 'node:crypto';
import {signalWorkspaceIncrementalDigestV1 as digest,type SignalWorkspaceIncrementalInputV1} from '../../packages/query-engine/src/signal-workspace-engine-incremental-v1';
import * as engine from '../../infrastructure/db/signal-workspace-engine';
import * as numeric from '../../infrastructure/db/signal-workspace-engine-incremental';
const fixtureSha=(s:string)=>`sha256:${createHash('sha256').update(s).digest('hex')}`;
export async function createMfpSyntheticNumericCheckpointV1(args:{database:engine.SignalWorkspaceEngineDatabaseV1;lease:engine.SignalWorkspaceEngineLeaseV1}){
 const {database,lease}=args,workspace_id=lease.workspace_id,parentId=lease.snapshot.numeric_descriptor!.parent.execution_id;
 const clusterIds=[randomUUID()],modelBodies={open:'explicit simulated open model'};
 const bodies=new Map<string,string>();
 const artifact=(lease:engine.SignalWorkspaceEngineLeaseV1,name:string,type:engine.SignalWorkspaceEngineArtifactV1['artifact_type'],body:string,
  metadata:Record<string,unknown>={}):engine.SignalWorkspaceEngineArtifactV1=>{
  const storage_key=`workspace-engine/${workspace_id}/${lease.execution_id}/${name}`;bodies.set(storage_key,body);
  return{artifact_key:name,artifact_type:type,title:'MFP rollback simulated numeric evidence',storage_key,
   sha256:fixtureSha(body),size_bytes:Buffer.byteLength(body),media_type:'application/octet-stream',metadata:{filename:name,...metadata}};
 };
 const descriptor=lease.snapshot.numeric_descriptor!;
 const roots:Array<Awaited<ReturnType<typeof numeric.readSignalWorkspaceIncrementalRootsV1>>['items'][number]>=[];let cursor:string|null=null;
 for(;;){const page=await numeric.readSignalWorkspaceIncrementalRootsV1({database,lease,after_root_id:cursor,limit:200});roots.push(...page.items);cursor=page.next_cursor;if(page.done)break;}
 const chunks:Array<Awaited<ReturnType<typeof engine.readSignalWorkspaceEngineChunksV1>>['items'][number]>=[];
 let after:Parameters<typeof engine.readSignalWorkspaceEngineChunksV1>[0]['after']=null;
 for(;;){const page=await engine.readSignalWorkspaceEngineChunksV1({database,lease,after,limit:128});chunks.push(...page.items);if(page.done)break;after=page.next_cursor;}
 const rootBody=roots.map(row=>JSON.stringify(row)+'\n').join('');
 const input:SignalWorkspaceIncrementalInputV1={contract_version:'workspace-topic-incremental-input-v1',workspace_id,execution_id:lease.execution_id,
  mode:'frozen-model-delta',policy_version:'workspace-frozen-model-cohort-v1',current_input_manifest:{file:'manifest.json',sha256:fixtureSha('local input manifest'),bytes:20},
  current_roots:{file:'current-roots.jsonl',sha256:fixtureSha(rootBody),bytes:Buffer.byteLength(rootBody),rows:roots.length},
  parent:{execution_id:parentId,manifest_sha256:descriptor.parent.manifest_sha256},compatibility:descriptor.compatibility,
  discovery:{...descriptor.discovery,cohort_key:fixtureSha('explicit simulated cohort')}};
 const inputFiles=['manifest.json','chunks.jsonl','vectors.npy','guides.jsonl','guide-vectors.npy','current-roots.jsonl'].map(name=>({name,
  storage_key:`workspace-engine/${workspace_id}/${lease.execution_id}/input/${name}`,sha256:name==='manifest.json'?input.current_input_manifest.sha256:name==='current-roots.jsonl'?input.current_roots.sha256:fixtureSha(name),
  size_bytes:name==='manifest.json'?input.current_input_manifest.bytes:name==='current-roots.jsonl'?input.current_roots.bytes:1,media_type:'application/octet-stream'}));
 const savedInput=await numeric.persistSignalWorkspaceIncrementalInputV1({database,lease,input,roots_count:roots.length,chunks_count:chunks.length,input_files:inputFiles,
  artifact:artifact(lease,'incremental-input.json','engine_output',JSON.stringify(input))});
 const modelRefs=(['open'] as const).map(lane=>({file:`model.${lane}.joblib`,sha256:fixtureSha(modelBodies[lane]),bytes:Buffer.byteLength(modelBodies[lane])}));
 const components=(['open'] as const).map((lane,index)=>({component_key:digest([lease.execution_id,modelRefs[index]!.sha256,lane]),lane,
  model_origin:{execution_id:lease.execution_id,model_artifact_sha256:modelRefs[index]!.sha256},model:modelRefs[index]!,center:null,
  units:[{local_label:0,unit_key:`${lane}:${clusterIds[index]}`,birth_membership_digest:fixtureSha(`synthetic original ${lane} birth`)}]})).sort((a,b)=>a.component_key<b.component_key?-1:1);
 const populations=chunks.map((chunk,ordinal)=>({ordinal,root_id:chunk.root_id,root_fingerprint:chunk.root_fingerprint,
  asset_sha256:roots.find(root=>root.root_id===chunk.root_id)!.asset_sha256,expected_chunks:roots.find(root=>root.root_id===chunk.root_id)!.expected_chunks,
  chunk_index:chunk.chunk_index,start:chunk.start,end:chunk.end,chunk_sha256:chunk.chunk_sha256}));
 const population=digest(populations);
 const memberships=chunks.flatMap(chunk=>components.map(component=>({root_id:chunk.root_id,root_fingerprint:chunk.root_fingerprint,chunk_index:chunk.chunk_index,
  start:chunk.start,end:chunk.end,chunk_sha256:chunk.chunk_sha256,lane:component.lane,unit_key:component.units[0]!.unit_key,model_component_key:component.component_key,strength:0.8,
  model_origin:component.model_origin,evaluation_origin:{execution_id:lease.execution_id,input_population_digest:population,
   evaluation_key:digest([lease.execution_id,component.component_key,population,component.model_origin.execution_id===lease.execution_id?'fitted_member':'predicted_member']),basis:component.model_origin.execution_id===lease.execution_id?'fitted_member':'predicted_member'},carried_from:null})));
 // Wire order is independent from the deliberately nonlexical model-bank order.
 memberships.sort((a,b)=>(a.root_id<b.root_id?-1:a.root_id>b.root_id?1:0)||a.chunk_index-b.chunk_index||(a.model_component_key<b.model_component_key?-1:1));
 // Optional complete, synthetic birth evidence for the real free-preparation
 // Worker. Existing projection-only fixtures retain their original bytes.
 const candidates=components.filter(component=>component.model_origin.execution_id===lease.execution_id).flatMap(component=>component.units.map(unit=>{
  const assigned=new Set(memberships.filter(row=>row.unit_key===unit.unit_key).map(row=>`${row.root_id}:${row.chunk_index}`));
  const birth=populations.filter(row=>assigned.has(`${row.root_id}:${row.chunk_index}`)).map(({ordinal,root_id,chunk_index,start,end,chunk_sha256})=>({ordinal,root_id,chunk_index,start,end,chunk_sha256}));
  unit.birth_membership_digest=digest(birth);
  const distinct=roots.map(root=>birth.find(row=>row.root_id===root.root_id)).filter((row):row is typeof birth[number]=>row!==undefined),boundary=distinct[1];
  const high=distinct.filter(row=>row!==boundary).slice(0,boundary?9:10);
  return{unit_key:unit.unit_key,component_key:component.component_key,birth_membership_digest:unit.birth_membership_digest,
   root_count:distinct.length,chunk_count:birth.length,terms:['Explicit local evidence'],representatives:[
    ...high.map(row=>({...row,strength:0.8,selection_reason:'high_affiliation'})),
    ...(boundary?[{...boundary,strength:0.8,selection_reason:'low_affiliation_boundary'}]:[])]};
 }));
 const pendingRoot=roots[0]!.root_id,pending=populations.filter(row=>row.root_id===pendingRoot);
 const numericBodies=new Map<string,string>([
  ['population.jsonl',populations.map(row=>JSON.stringify(row)+'\n').join('')],['memberships.jsonl',memberships.map(row=>JSON.stringify(row)+'\n').join('')],
  ['roots.jsonl',roots.map(root=>JSON.stringify({...root,unit_keys:[...new Set(memberships.filter(row=>row.root_id===root.root_id).map(row=>row.unit_key))].sort(),state:'computed',discovery_pending:root.root_id===pendingRoot})+'\n').join('')],
  ['pending-cohort.jsonl',pending.map(row=>JSON.stringify(row)+'\n').join('')],['model-components.json',JSON.stringify(components)],
  ['root-transitions.jsonl',''],['candidate-groups.json',JSON.stringify(candidates)],['relations.json','[]'],['guides.jsonl',''],['guide-vectors.npy','local guide bytes'],
  ['model.open.joblib',modelBodies.open]]);
 const files=[...numericBodies].map(([file,body])=>({file,sha256:fixtureSha(body),bytes:Buffer.byteLength(body)}));
 const output={contract_version:'workspace-topic-incremental-output-v1',workspace_id,execution_id:lease.execution_id,request_digest:digest({input,runtime_digest:descriptor.compatibility.runtime_digest}),
  previous_manifest_sha256:descriptor.parent.manifest_sha256,compatibility:descriptor.compatibility,policy_version:'workspace-frozen-model-cohort-v1',status:'completed',quality:'uncalibrated',approval_policy:'none',
  discovery_status:'pending_cohort_close',relations_status:'none',population_digest:population,counts:{roots:roots.length,occurrences:chunks.length,added_roots:0,
   content_changed_roots:0,metadata_changed_roots:0,unchanged_roots:roots.length,removed_roots:0,delta_occurrences:0,cohort_occurrences:pending.length,pending_occurrences:pending.length,
   memberships:memberships.length,components:components.length,new_components:1,model_bank_bytes:modelRefs.reduce((n,row)=>n+row.bytes,0)},
  components,artifacts:files,coverage:components.map(component=>({component_key:component.component_key,population_digest:population,expected_occurrences:chunks.length,copied_occurrences:0,transformed_occurrences:component.model_origin.execution_id===lease.execution_id?0:chunks.length,fitted_occurrences:component.model_origin.execution_id===lease.execution_id?chunks.length:0})),
  operations:{fit:components.filter(component=>component.model_origin.execution_id===lease.execution_id).map(component=>({component_key:component.component_key,occurrences:chunks.length,population_digest:population})),transform:components.filter(component=>component.model_origin.execution_id!==lease.execution_id).map(component=>({component_key:component.component_key,occurrences:chunks.length,pages:2,maximum_page_rows:128}))},metrics:{resident_bytes:0,elapsed_seconds:0},limitations:['Explicit local synthetic evidence; no fit or provider.']};
 const outputBody=JSON.stringify(output),manifest={file:'manifest.json',sha256:fixtureSha(outputBody),bytes:Buffer.byteLength(outputBody)};
 const index=await numeric.persistSignalWorkspaceIncrementalOutputIndexV1({database,lease,input_artifact_id:savedInput.artifact_id,output_manifest:{sha256:manifest.sha256,size_bytes:manifest.bytes},file_count:files.length+3,
  artifact:artifact(lease,'incremental-output-index.json','engine_output','local inventory')});
 const stored=new Map<string,string>();for(const [name,body] of numericBodies)stored.set(name,(await engine.persistSignalWorkspaceEngineArtifactV1({database,lease,
  artifact:artifact(lease,name,name.endsWith('.joblib')||name==='guide-center.npy'?'engine_model':'engine_output',body)})).artifact_id);
 const outputArtifact=await engine.persistSignalWorkspaceEngineArtifactV1({database,lease,artifact:artifact(lease,'manifest.json','engine_output',outputBody)});
 const bankArtifact=await engine.persistSignalWorkspaceEngineArtifactV1({database,lease,artifact:artifact(lease,'model-manifest.json','engine_model','local bank')});
 const registry=await numeric.registerSignalWorkspaceIncrementalModelBankV1({database,lease,model_bank_artifact_id:bankArtifact.artifact_id,output_artifact_id:outputArtifact.artifact_id});
 await numeric.registerSignalWorkspaceIncrementalComponentsV1({database,lease,model_version_id:registry.model_version_id,components:components.map(component=>({component_key:component.component_key,lane:component.lane,
  model_origin:component.model_origin,model_artifact_id:stored.get(component.model.file)!,center_artifact_id:null,unit_count:component.units.length,unit_digest:digest(component.units)}))});
 const history=await numeric.persistSignalWorkspaceIncrementalHistoryV1({database,lease,relations_artifact_id:stored.get('relations.json')!,artifact:artifact(lease,'incremental-history.json','engine_output','paid parent references')});
 await engine.heartbeatSignalWorkspaceEngineV1({database,lease,phase:'persisting',exported:{roots:roots.length,chunks:chunks.length,guides:lease.snapshot.expected_guides,stream_digest:input.current_input_manifest.sha256}});
 const checkpoint=await numeric.checkpointSignalWorkspaceIncrementalOutputV1({database,lease,input_artifact_id:savedInput.artifact_id,output_index_artifact_id:index.artifact_id,output_artifact_id:outputArtifact.artifact_id,
  model_bank_artifact_id:bankArtifact.artifact_id,model_version_id:registry.model_version_id,history_artifact_id:history.artifact_id,output,validation:{contract_version:'workspace-incremental-file-validation-v1',
   request_digest:output.request_digest,population_digest:population,complete_file_digest:digest([manifest,...files].sort((a,b)=>a.file<b.file?-1:1)),
   origin_digest:digest(components.map(component=>({component_key:component.component_key,lane:component.lane,model_origin:component.model_origin,
    model:{sha256:component.model.sha256,bytes:component.model.bytes},center:null,units:component.units}))),
   roots:roots.length,occurrences:chunks.length,memberships:memberships.length,pending_occurrences:pending.length,relations_scope:'new_candidates_in_this_execution'}});
 await numeric.finishSignalWorkspaceIncrementalNumericV1({database,lease,checkpoint_digest:checkpoint.checkpoint_digest});
 return{lease,roots,chunks,components,memberships,checkpoint,artifact,output,bodies};
}

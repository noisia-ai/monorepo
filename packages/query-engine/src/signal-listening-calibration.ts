import {signalWorkspaceEmbeddingDigestV1 as digest} from './signal-workspace-embeddings-v1';
import {validateSignalListeningConfigurationV1,readSignalListeningSnapshotV1,type SignalListeningCompiledSnapshotV1,type SignalListeningConfigurationV1,type SignalListeningInputV1} from './signal-listening-contracts';
export type SignalListeningCalibrationShapeV1={compiler_version:'listening-jev-v1';model:string;phase:'base'|'all'|'consumer_category'|'mixed';
 questions:Array<{type:'choice'|'noul';scope:'all'|'consumer_category';topic_source:'defined'|'discovered'|null;option_count:number}>;shape_digest:string};
export type SignalListeningCalibrationProfileV1={scope:{workspace_id:string;configuration_digest:string;model:string;compiler_version:'listening-jev-v1';shape_digest:string;phase:SignalListeningCalibrationShapeV1['phase']};
 scope_digest:string;source_digest:string;source_call_ids:string[];source_run_id:string;request_min_bytes:number;request_max_bytes:number;
 max_input_tokens_per_byte:number;sample_count:number;status:'measured'};
/** Shape excludes candidate keys; configuration identity remains a separate exact scope. */
export function signalListeningCalibrationShapeV1(configuration:SignalListeningConfigurationV1,input:Pick<SignalListeningInputV1,'question_keys'>):SignalListeningCalibrationShapeV1{
 const c=validateSignalListeningConfigurationV1(configuration),keys=[...new Set(input.question_keys)];
 if(!keys.length||keys.length!==input.question_keys.length)throw Error('listening_calibration_shape_invalid');
 const selected=keys.map(key=>{const q=c.questions.find(q=>q.key===key);if(!q)throw Error('listening_calibration_question_unknown');return q;});
 const phase:SignalListeningCalibrationShapeV1['phase']=selected.every(q=>q.origin==='base')?'base':selected.every(q=>q.scope==='all')?'all':selected.every(q=>q.scope==='consumer_category')?'consumer_category':'mixed';
 const questions=selected.map(q=>({type:q.type,scope:q.scope,topic_source:q.topic_source??null,option_count:q.type==='choice'?q.options.length:0})).sort((a,b)=>digest(a).localeCompare(digest(b)));
 const shape={compiler_version:'listening-jev-v1' as const,model:c.model,phase,questions};return {...shape,shape_digest:digest(shape)};
}

/** Snapshot-local structural shapes. The small bounded cache contains no input
 * text, answers, permission decision, profile or provider result. */
export type SignalListeningShapeCompilerV1={shape(input:Pick<SignalListeningInputV1,'question_keys'>):SignalListeningCalibrationShapeV1;
 work():{digests:number;cached_shapes:number;max_cached_shapes:number}};
// Only constructor-authenticated immutable handles key this weak registry.
const compiledShapes=new WeakMap<SignalListeningCompiledSnapshotV1,SignalListeningShapeCompilerV1>();
export function createSignalListeningShapeCompilerV1(snapshot:SignalListeningCompiledSnapshotV1):SignalListeningShapeCompilerV1{
 const prior=compiledShapes.get(snapshot);if(prior)return prior;
 const c=readSignalListeningSnapshotV1(snapshot).configuration;
 const descriptors=new Map<string,{question:SignalListeningConfigurationV1['questions'][number];value:SignalListeningCalibrationShapeV1['questions'][number];sort_digest:string}>();
 const descriptorHashes=new Map<string,string>();let digests=0;
 for(const q of c.questions){const value={type:q.type,scope:q.scope,topic_source:q.topic_source??null,option_count:q.type==='choice'?q.options.length:0},key=JSON.stringify(value);
  let sort_digest=descriptorHashes.get(key);if(!sort_digest){sort_digest=digest(value);digests++;descriptorHashes.set(key,sort_digest);}descriptors.set(q.key,{question:q,value,sort_digest});}
 const cache=new Map<string,SignalListeningCalibrationShapeV1>();
 const compiler=Object.freeze({shape(input:Pick<SignalListeningInputV1,'question_keys'>):SignalListeningCalibrationShapeV1{
  const keys=[...new Set(input.question_keys)];if(!keys.length||keys.length!==input.question_keys.length)throw Error('listening_calibration_shape_invalid');
  const selected=keys.map(key=>{const q=descriptors.get(key);if(!q)throw Error('listening_calibration_question_unknown');return q;});
  const phase:SignalListeningCalibrationShapeV1['phase']=selected.every(q=>q.question.origin==='base')?'base':selected.every(q=>q.question.scope==='all')?'all':selected.every(q=>q.question.scope==='consumer_category')?'consumer_category':'mixed';
  const questions=selected.sort((a,b)=>a.sort_digest.localeCompare(b.sort_digest)).map(q=>q.value);
  const shape={compiler_version:'listening-jev-v1' as const,model:c.model,phase,questions},key=JSON.stringify(shape);let found=cache.get(key);
  if(!found){found={...shape,shape_digest:digest(shape)};digests++;if(cache.size===64)cache.delete(cache.keys().next().value!);cache.set(key,found);}
  return structuredClone(found);
 },work(){return{digests,cached_shapes:cache.size,max_cached_shapes:64};}});
 compiledShapes.set(snapshot,compiler);return compiler;
}

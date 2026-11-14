import {signalWorkspaceEmbeddingDigestV1 as digest} from './signal-workspace-embeddings-v1';
import {validateSignalListeningConfigurationV1,type SignalListeningConfigurationV1,type SignalListeningInputV1} from './signal-listening-contracts';
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

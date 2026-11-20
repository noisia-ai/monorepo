import {getSignalListeningEffectiveServingSnapshotV1,getSignalListeningConfigurationV1,readSignalListeningEffectiveTopicLabelsV1} from '@noisia/db';
import type {SignalMentionListeningLabelsV1} from './signal-listening-human-contract';
type Scope={workspace_id:string;actor_user_id:string};
type Binding=Awaited<ReturnType<typeof getSignalListeningEffectiveServingSnapshotV1>>;
export type SignalListeningMentionLabelDependenciesV1={
 snapshot(scope:Scope):Promise<Binding>;
 configuration(scope:Scope,id:string):ReturnType<typeof getSignalListeningConfigurationV1>;
 labels(scope:Scope,args:{configuration_id:string;map_id:string;root_ids:string[];question_keys:string[]}):ReturnType<typeof readSignalListeningEffectiveTopicLabelsV1>;
};
function stale():never{throw Object.assign(Error('Listening snapshot changed.'),{code:'workspace_mentions_listening_source_changed',status:409});}
const bindingKey=(b:NonNullable<Binding>)=>JSON.stringify([b.id,b.configuration_id,b.generation_id,b.map_id,b.snapshot_digest,b.human_snapshot_id]);
/** Add a separate namespace to already-authorized native mentions. Neither a
 * historical tag nor a classifier probability becomes a human decision. The
 * post-read binding check rejects mixed snapshots if an edit races pagination. */
export async function loadSignalMentionListeningLabelsV1(scope:Scope,root_ids:string[],dependencies?:SignalListeningMentionLabelDependenciesV1){
 const output=new Map<string,SignalMentionListeningLabelsV1>();
 if(!root_ids.length||!dependencies&&process.env.NOISIA_SIGNAL_LISTENING_ENABLED!=='true')return output;
 if(root_ids.length>200||new Set(root_ids).size!==root_ids.length)stale();
 let deps=dependencies;
 if(!deps){const {pool}=await import('@/lib/db');deps={
  snapshot:scope=>getSignalListeningEffectiveServingSnapshotV1({database:pool,...scope}),
  configuration:(scope,configuration_id)=>getSignalListeningConfigurationV1({database:pool,...scope,configuration_id}),
  labels:(scope,args)=>readSignalListeningEffectiveTopicLabelsV1({database:pool,...scope,...args}),
 };}
 let snapshot:Binding;
 try{snapshot=await deps.snapshot(scope);}catch(error){
  if(error instanceof Error&&'code'in error&&['listening_human_snapshot_unavailable','listening_not_enabled'].includes(String(error.code)))return output;
  throw error;
 }
 if(!snapshot)stale();
 const cfg=await deps.configuration(scope,snapshot.configuration_id);
 if(!cfg||cfg.id!==snapshot.configuration_id||cfg.workspace_id!==scope.workspace_id||cfg.state!=='published')stale();
 const questions=cfg.configuration.questions.filter(q=>q.topic_source&&q.type==='noul'&&q.domain!=='outside');
 const known=new Map(questions.map(q=>[q.key,q])),roots=new Set(root_ids);
 const binding:SignalMentionListeningLabelsV1['binding']={snapshot_id:snapshot.id,configuration_id:snapshot.configuration_id,generation_id:snapshot.generation_id,
  map_id:snapshot.map_id,snapshot_digest:snapshot.snapshot_digest,human_snapshot_id:snapshot.human_snapshot_id};
 for(const id of root_ids)output.set(id,{binding,labels:[]});
 const seen=new Set<string>();
 for(let offset=0;offset<questions.length;offset+=8){
  const question_keys=questions.slice(offset,offset+8).map(q=>q.key);
  const rows=await deps.labels(scope,{configuration_id:snapshot.configuration_id,map_id:snapshot.map_id,root_ids,question_keys});
  for(const row of rows){
   const q=known.get(row.question_key),identity=row.root_id+':'+row.question_key;
   if(!roots.has(row.root_id)||!q||!question_keys.includes(row.question_key)||seen.has(identity))stale();seen.add(identity);
   const answer=row.answer&&typeof row.answer==='object'?row.answer as Record<string,unknown>:null;
   const probability=answer?.type==='noul'&&typeof answer.noul==='number'&&Number.isFinite(answer.noul)&&answer.noul>=0&&answer.noul<=1?answer.noul:null;
   output.get(row.root_id)!.labels.push({question_key:q.key,name:q.localization?.original.name??q.text,
    ...(q.localization?{names:{original:q.localization.original.name,en:q.localization.en.name,es:q.localization.es.name}}:{}),domain:q.domain??'category',scope:q.scope,
    effective_belongs:row.effective_belongs,probability,human_belongs:row.human_belongs,human_decision_id:row.human_decision_id,label_source:row.label_source});
  }
 }
 const current=await deps.snapshot(scope);if(!current||bindingKey(current)!==bindingKey(snapshot))stale();
 return output;
}

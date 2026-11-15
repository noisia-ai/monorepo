import{signalStudyPromotionProposalV1}from'@noisia/query-engine';
import{studyTransactionV1,studyAuthorizeV1,studyFailV1 as fail,studyDigestV1 as digest,studyUuidV1,type StudyAccessV1,type SignalStudyExecutionRecordV1}from'./signal-study-core';
import{loadSignalListeningConfigurationWithClientV1,saveSignalListeningConfigurationWithClientV1}from'./signal-listening-configuration';
import{readSignalStudySourceWithClientV1}from'./signal-study-source';
import{replaySignalStudyWithClientV1}from'./signal-study-replay';
/** A separate human action, never called by the Study worker. It publishes only
 * replayed committed motives and preserves current Listening, locks and history.
 * Saving definitions makes no provider request and grants no classification cap. */
export async function promoteSignalStudyMotivesV1(args:StudyAccessV1&{execution_id:string;motive_keys:string[];expected_listening_revision:number;idempotency_key:string}){
 if(!studyUuidV1.test(args.execution_id)||!Number.isSafeInteger(args.expected_listening_revision)||args.expected_listening_revision<1||!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key)
  ||!args.motive_keys.length||args.motive_keys.length>256||new Set(args.motive_keys).size!==args.motive_keys.length||args.motive_keys.some(key=>!/^[a-z][a-z0-9_]{0,63}$/u.test(key)))fail('promotion_invalid',422);
 const keys=[...args.motive_keys].sort(),request_digest=digest({execution_id:args.execution_id,motive_keys:keys,expected_listening_revision:args.expected_listening_revision});
 return studyTransactionV1(args.database,async c=>{
  // No money mutation: Listening configuration -> actor is the existing native
  // publication order, with no Study parent/run lock in the opposite direction.
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-listening-config:'||$1,0))",[args.workspace_id]);await studyAuthorizeV1(c,args,'edit');
  const prior=(await c.query<{id:string;request_digest:string;output_configuration_id:string;output_configuration_digest:string}>('SELECT * FROM signal_study_promotions WHERE workspace_id=$1 AND actor_user_id=$2 AND idempotency_key=$3',[args.workspace_id,args.actor_user_id,args.idempotency_key])).rows[0];
  if(prior){if(prior.request_digest!==request_digest)fail('idempotency_conflict');return{promotion_id:prior.id,configuration_id:prior.output_configuration_id,configuration_digest:prior.output_configuration_digest};}
  const p=(await c.query<SignalStudyExecutionRecordV1>('SELECT * FROM signal_study_executions WHERE id=$1 AND workspace_id=$2',[args.execution_id,args.workspace_id])).rows[0];
  if(!p||p.status!=='completed')fail('completed_report_required');
  const authorized=(await c.query('SELECT o.output_digest FROM signal_study_outputs o JOIN signal_study_configurations cfg ON cfg.id=o.configuration_id JOIN signal_listening_serving_snapshots s ON s.id=cfg.listening_snapshot_id WHERE o.execution_id=$1 AND o.workspace_id=$2 AND signal_study_generation_header_current_v1(s.generation_id) AND NOT EXISTS(SELECT 1 FROM signal_study_source_roots r WHERE r.execution_id=o.execution_id AND NOT signal_listening_root_right_v1(r.workspace_id,r.root_id,\'client-derived-metrics\'))',[p.id,args.workspace_id])).rows[0]as{output_digest:string}|undefined;
  if(!authorized)fail('source_changed');const source=await readSignalStudySourceWithClientV1(c,p),replay=await replaySignalStudyWithClientV1(c,p.id,source);
  if(replay.operation.kind!=='output'||digest(replay.operation.output)!==authorized.output_digest||!replay.resolved_motives)fail('completed_report_required');
  const current=await loadSignalListeningConfigurationWithClientV1(c,args.workspace_id);if(!current||current.revision!==args.expected_listening_revision)fail('listening_revision_conflict');
  const proposed=keys.map(key=>{const motive=replay.resolved_motives!.find(m=>m.key===key);if(!motive)fail('motive_unavailable');const proposal=signalStudyPromotionProposalV1({study:source.configuration.study,template_snapshot:source.configuration.template_snapshot,motive,explicit_action:true,target_revision:current.revision});
   // Stable external binding avoids silently replacing another taxonomy key.
   return{...proposal.question,key:'study_'+digest({study_id:p.study_id,motive_key:key}).slice(7,39)};});
  if(proposed.some(q=>current.configuration.questions.some(old=>old.key===q.key)||current.configuration.retired_question_keys.includes(q.key)))fail('promotion_key_conflict');
  const saved=await saveSignalListeningConfigurationWithClientV1(c,{...args,expected_revision:current.revision,provenance:'human',configuration:{...current.configuration,questions:[...current.configuration.questions,...proposed]}});
  await c.query("SELECT set_config('noisia.study_promotion_v1',$1,true)",[JSON.stringify({execution_id:p.id,request_digest,configuration_id:saved.id})]);
  const row=(await c.query<{id:string}>(`INSERT INTO signal_study_promotions(workspace_id,execution_id,actor_user_id,idempotency_key,request_digest,motive_keys,expected_listening_revision,output_configuration_id,output_configuration_digest)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[args.workspace_id,p.id,args.actor_user_id,args.idempotency_key,request_digest,keys,current.revision,saved.id,saved.configuration_digest])).rows[0]!;
  return{promotion_id:row.id,configuration_id:saved.id,configuration_digest:saved.configuration_digest};
 });
}

import {randomUUID} from 'node:crypto';
import {validateSignalStudyExecutionConfigurationV1,assertSignalStudyConfigurationRevisionV1} from '@noisia/query-engine';
import {studyTransactionV1,studyAuthorizeV1,studyFailV1 as fail,studyDigestV1 as digest,studyConfigurationWithClientV1,type StudyAccessV1,type SignalStudyConfigurationRecordV1} from './signal-study-core';
import {mapCurrent} from './signal-mass-labeling';

/** Thin identity for the workspace-owned corpus. It never imports, copies data,
 * creates a paused multimethod Study or purchases embeddings. */
export async function ensureSignalStudyCorpusV1(args:StudyAccessV1){
 return studyTransactionV1(args.database,async c=>{await studyAuthorizeV1(c,args,'edit');
  return(await c.query<{id:string;workspace_id:string}>(`INSERT INTO signal_study_corpora(workspace_id,created_by_user_id) VALUES($1,$2)
   ON CONFLICT(workspace_id) DO UPDATE SET workspace_id=EXCLUDED.workspace_id RETURNING id,workspace_id`,[args.workspace_id,args.actor_user_id])).rows[0]!;
 });
}
export async function saveSignalStudyConfigurationV1(args:StudyAccessV1&{study_id?:string;expected_revision:number;configuration:unknown;listening_snapshot_id:string;provenance:'human'|'agent';idempotency_key?:string}){
 if(args.idempotency_key!==undefined&&!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key))fail('idempotency_key_invalid',422);
 const envelope=validateSignalStudyExecutionConfigurationV1(args.configuration);if(envelope.study.workspace_id!==args.workspace_id||envelope.question_configuration.provenance!==args.provenance)fail('configuration_scope_invalid',422);
 return studyTransactionV1(args.database,async c=>{
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-study-config:'||$1,0))",[args.study_id??args.workspace_id]);await studyAuthorizeV1(c,args,'edit');
  const request_digest=digest({study_id:args.study_id??null,expected_revision:args.expected_revision,configuration:envelope,listening_snapshot_id:args.listening_snapshot_id,provenance:args.provenance});
  if(args.idempotency_key){await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-study-save:'||$1||':'||$2||':'||$3,0))",[args.workspace_id,args.actor_user_id,args.idempotency_key]);
   const prior=(await c.query<SignalStudyConfigurationRecordV1&{request_digest:string}>('SELECT * FROM signal_study_configurations WHERE workspace_id=$1 AND created_by_user_id=$2 AND idempotency_key=$3',[args.workspace_id,args.actor_user_id,args.idempotency_key])).rows[0];
   if(prior){if(prior.request_digest!==request_digest)fail('idempotency_conflict');return prior;}
  }
  if(!(await c.query('SELECT 1 FROM signal_study_corpora WHERE id=$1 AND workspace_id=$2',[envelope.study.corpus_id,args.workspace_id])).rows.length)fail('corpus_unavailable');
  const snapshot=(await c.query<{map_id:string;configuration_id:string;current:boolean}>(`SELECT s.map_id,s.configuration_id,signal_listening_discovery_source_current_v1(s.generation_id) current
   FROM signal_listening_serving_snapshots s WHERE s.id=$1 AND s.workspace_id=$2`,[args.listening_snapshot_id,args.workspace_id])).rows[0];
  if(!snapshot?.current||snapshot.configuration_id!==envelope.source_listening.configuration_id)fail('listening_source_unavailable');await mapCurrent(c,args.workspace_id,snapshot.map_id);
  let study=args.study_id;
  if(study){
   const current=(await c.query<SignalStudyConfigurationRecordV1>('SELECT * FROM signal_study_configurations WHERE study_id=$1 AND workspace_id=$2 ORDER BY revision DESC LIMIT 1',[study,args.workspace_id])).rows[0];
   if(!current||current.revision!==args.expected_revision||current.listening_snapshot_id!==args.listening_snapshot_id)fail('configuration_revision_conflict');
   assertSignalStudyConfigurationRevisionV1({current:current.envelope,next:envelope,actor:args.provenance,expected_revision:args.expected_revision});
  }else{
   if(args.expected_revision!==0||envelope.question_configuration.revision!==1||envelope.study.revision!==1)fail('configuration_revision_conflict');study=randomUUID();
   const{revision:_revision,provenance:_provenance,...definition}=envelope.study;
   await c.query('INSERT INTO signal_studies(id,workspace_id,corpus_id,definition,definition_digest,created_by_user_id) VALUES($1,$2,$3,$4::jsonb,$5,$6)',[study,args.workspace_id,envelope.study.corpus_id,JSON.stringify(definition),digest(definition),args.actor_user_id]);
  }
  return(await c.query<SignalStudyConfigurationRecordV1>(`INSERT INTO signal_study_configurations(workspace_id,study_id,revision,envelope,configuration_digest,human_revision_digest,provenance,
   listening_snapshot_id,listening_configuration_id,listening_configuration_digest,created_by_user_id,idempotency_key,request_digest)
   VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[args.workspace_id,study,envelope.question_configuration.revision,JSON.stringify(envelope),digest(envelope),
   digest({study_id:study,revision:envelope.question_configuration.revision,configuration_digest:digest(envelope),questions:envelope.question_configuration}),args.provenance,args.listening_snapshot_id,envelope.source_listening.configuration_id,envelope.source_listening.configuration_digest,args.actor_user_id,args.idempotency_key??null,args.idempotency_key?request_digest:null])).rows[0]!;
 });
}
export async function readSignalStudyConfigurationV1(args:StudyAccessV1&{configuration_id:string}){
 return studyTransactionV1(args.database,async c=>{await studyAuthorizeV1(c,args);return studyConfigurationWithClientV1(c,args.workspace_id,args.configuration_id);});
}

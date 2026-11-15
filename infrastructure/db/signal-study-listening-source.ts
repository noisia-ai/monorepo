import type{SignalListeningConfigurationV1}from'@noisia/query-engine';
import{studyTransactionV1,studyAuthorizeV1,studyUuidV1,studyFailV1 as fail,type StudyAccessV1}from'./signal-study-core';
export type SignalStudyListeningSourceV1={id:string;kind:'serving'|'human_edit';base_snapshot_id:string;map_id:string;configuration_id:string;configuration_digest:string;
 configuration:SignalListeningConfigurationV1;generation_id:string;generation_digest:string;source_digest:string;is_current:boolean;is_latest:boolean};
/** Exact ID lookup supports lost-ACK replay of an already saved configuration.
 * A historical result is explicitly marked; only native save/admit decides if a
 * NEW Study can use it. This method never silently replaces it with latest. */
export async function readSignalStudyListeningSourceV1(args:StudyAccessV1&{source_id:string;source_kind?:'serving'|'human_edit'}){
 if(!studyUuidV1.test(args.source_id)||args.source_kind!==undefined&&!['serving','human_edit'].includes(args.source_kind))fail('listening_source_invalid',422);
 return studyTransactionV1(args.database,async c=>{await studyAuthorizeV1(c,args,'view');
  const rows=(await c.query<SignalStudyListeningSourceV1>(`SELECT s.id,s.source_kind kind,s.base_snapshot_id,s.map_id,s.configuration_id,cfg.configuration_digest,cfg.configuration,s.generation_id,g.snapshot_digest generation_digest,s.snapshot_digest source_digest,
   signal_listening_discovery_source_current_v1(s.generation_id) is_current,signal_study_listening_source_latest_v1(s.workspace_id,s.source_kind,s.id) is_latest
   FROM signal_study_listening_sources_v1 s JOIN signal_listening_configurations cfg ON cfg.id=s.configuration_id AND cfg.workspace_id=s.workspace_id
   JOIN signal_listening_discovery_generations g ON g.id=s.generation_id AND g.workspace_id=s.workspace_id AND g.configuration_id=cfg.id AND g.status='ready'
   WHERE s.id=$1 AND s.workspace_id=$2 AND($3::text IS NULL OR s.source_kind=$3)`,[args.source_id,args.workspace_id,args.source_kind??null])).rows;
  if(rows.length>1)fail('listening_source_ambiguous');return rows[0]??null;
 });
}

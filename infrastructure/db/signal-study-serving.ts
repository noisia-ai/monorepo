import type{StudyRuntimeLeaseV1,StudyRuntimeOutputV1}from'../../services/workers/src/workers/signal-study-runtime';
import{studyTransactionV1,studyDigestV1 as digest,studyFailV1 as fail,studyAuthorizeV1,type StudyDatabaseV1,type StudyAccessV1}from'./signal-study-core';
import{lockSignalStudyExecutionWithClientV1}from'./signal-study-executions';
import{readSignalStudySourceWithClientV1}from'./signal-study-source';
import{replaySignalStudyWithClientV1}from'./signal-study-replay';
export async function finishSignalStudyExecutionV1(args:{database:StudyDatabaseV1;lease:StudyRuntimeLeaseV1;output:StudyRuntimeOutputV1;output_digest:string}){
 if(digest(args.output)!==args.output_digest)fail('output_digest_invalid',422);
 return studyTransactionV1(args.database,async c=>{const p=await lockSignalStudyExecutionWithClientV1(c,args.lease),next=(await replaySignalStudyWithClientV1(c,p.id,await readSignalStudySourceWithClientV1(c,p))).operation;
  if(next.kind!=='output'||digest(next.output)!==args.output_digest)fail('output_not_derived');
  if(BigInt((await c.query<{v:string}>('SELECT signal_study_exposure_v1($1)::text v',[p.id])).rows[0]!.v)>BigInt(p.cap_micro_usd))fail('parent_cap_exhausted');
  await c.query("SELECT set_config('noisia.study_output_v1',$1,true)",[JSON.stringify({execution_id:p.id,execution_token:args.lease.execution_token,output_digest:args.output_digest})]);
  await c.query(`INSERT INTO signal_study_outputs(workspace_id,execution_id,study_id,configuration_id,source_digest,output,output_digest) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,[p.workspace_id,p.id,p.study_id,p.configuration_id,p.source_digest,JSON.stringify(next.output),args.output_digest]);
  await c.query("UPDATE signal_study_executions SET status='completed',output=$2::jsonb,output_digest=$3 WHERE id=$1",[p.id,JSON.stringify(next.output),args.output_digest]);return true;});
}
/** Exact frozen report, with latest-configuration status explicit. Current
 * client rights and source hashes are checked; no latest Listening questions,
 * motifs or labels are mixed into an older completed methodology. */
export async function readSignalStudyOutputV1(args:StudyAccessV1&{execution_id:string}){
 return studyTransactionV1(args.database,async c=>{await studyAuthorizeV1(c,args,'view');
  const row=(await c.query<{execution_id:string;configuration_id:string;configuration_is_latest:boolean;configuration:unknown;listening_source_binding:{kind:'serving'|'human_edit';id:string;generation_id:string;base_snapshot_id:string};source_digest:string;output:StudyRuntimeOutputV1;output_digest:string}>(`SELECT o.execution_id,o.configuration_id,cfg.envelope configuration,
   cfg.id=(SELECT id FROM signal_study_configurations WHERE study_id=cfg.study_id AND workspace_id=cfg.workspace_id ORDER BY revision DESC LIMIT 1) configuration_is_latest,
   jsonb_build_object('kind',s.source_kind,'id',s.id,'configuration_id',s.configuration_id,'generation_id',s.generation_id,'source_digest',s.snapshot_digest,'base_snapshot_id',s.base_snapshot_id) listening_source_binding,o.source_digest,o.output,o.output_digest FROM signal_study_outputs o JOIN signal_study_executions p ON p.id=o.execution_id AND p.workspace_id=o.workspace_id
   JOIN signal_study_configurations cfg ON cfg.id=o.configuration_id AND cfg.workspace_id=o.workspace_id JOIN signal_study_configuration_sources_v1 s ON s.study_configuration_id=cfg.id AND s.workspace_id=o.workspace_id
   WHERE o.execution_id=$1 AND o.workspace_id=$2 AND p.status='completed' AND signal_study_generation_header_current_v1(s.generation_id)
   AND NOT EXISTS(SELECT 1 FROM signal_study_source_roots root WHERE root.execution_id=p.id AND NOT signal_listening_root_right_v1(p.workspace_id,root.root_id,'client-derived-metrics'))`,[args.execution_id,args.workspace_id])).rows[0];
  if(!row)return null;if(digest(row.output)!==row.output_digest||row.output.source_digest!==row.source_digest)fail('output_integrity_invalid');return row;});
}

type StudySummaryV1=StudyRuntimeOutputV1['summary'];
export type SignalStudyReportSectionV1='motives'|'topics'|'channels'|'series'|'evidence';
export type SignalStudyReportRowsV1={motives:StudySummaryV1['motives'];topics:StudySummaryV1['motive_by_topic'];channels:StudySummaryV1['motive_by_channel'];series:StudySummaryV1['series'];evidence:StudyRuntimeOutputV1['verified_evidence']};
const reportScope=`FROM signal_study_outputs o JOIN signal_study_executions p ON p.id=o.execution_id AND p.workspace_id=o.workspace_id
 JOIN signal_study_configurations cfg ON cfg.id=o.configuration_id AND cfg.workspace_id=o.workspace_id JOIN signal_study_configuration_sources_v1 s ON s.study_configuration_id=cfg.id AND s.workspace_id=o.workspace_id
 WHERE o.execution_id=$1 AND o.workspace_id=$2 AND p.status='completed' AND signal_study_generation_header_current_v1(s.generation_id)
 AND NOT EXISTS(SELECT 1 FROM signal_study_source_roots root WHERE root.execution_id=p.id AND NOT signal_listening_root_right_v1(p.workspace_id,root.root_id,'client-derived-metrics'))`;
export type SignalStudyReportOverviewV1={execution_id:string;study_id:string;configuration_id:string;configuration_is_latest:boolean;configuration:unknown;listening_source_binding:{kind:'serving'|'human_edit';id:string;configuration_id:string;generation_id:string;source_digest:string;base_snapshot_id:string};source_digest:string;output_digest:string;
 overview:Omit<StudyRuntimeOutputV1,'summary'|'verified_evidence'|'dominance'>&{dominance:(Omit<NonNullable<StudyRuntimeOutputV1['dominance']>,'reask_root_ids'>&{reask_root_count:number})|null;summary:Omit<StudySummaryV1,'motives'|'motive_by_topic'|'motive_by_channel'|'series'>};section_counts:Record<SignalStudyReportSectionV1,number>};
/** Project away every potentially large report array inside PostgreSQL. */
export async function readSignalStudyReportOverviewV1(args:StudyAccessV1&{execution_id:string}){
 return studyTransactionV1(args.database,async c=>{await studyAuthorizeV1(c,args,'view');return(await c.query<SignalStudyReportOverviewV1>(`SELECT o.execution_id,o.study_id,o.configuration_id,cfg.envelope configuration,
 cfg.id=(SELECT id FROM signal_study_configurations WHERE study_id=cfg.study_id AND workspace_id=cfg.workspace_id ORDER BY revision DESC LIMIT 1) configuration_is_latest,
 jsonb_build_object('kind',s.source_kind,'id',s.id,'configuration_id',s.configuration_id,'generation_id',s.generation_id,'source_digest',s.snapshot_digest,'base_snapshot_id',s.base_snapshot_id) listening_source_binding,o.source_digest,o.output_digest,(o.output-ARRAY['summary','verified_evidence','dominance'])||jsonb_build_object('dominance',CASE WHEN o.output->'dominance'='null'::jsonb THEN 'null'::jsonb ELSE(o.output->'dominance')-'reask_root_ids'||jsonb_build_object('reask_root_count',jsonb_array_length(o.output#>'{dominance,reask_root_ids}')) END,'summary',(o.output->'summary')-ARRAY['motives','motive_by_topic','motive_by_channel','series']) overview,
 jsonb_build_object('motives',jsonb_array_length(o.output#>'{summary,motives}'),'topics',jsonb_array_length(o.output#>'{summary,motive_by_topic}'),'channels',jsonb_array_length(o.output#>'{summary,motive_by_channel}'),'series',jsonb_array_length(o.output#>'{summary,series}'),'evidence',jsonb_array_length(o.output->'verified_evidence')) section_counts
 ${reportScope}`,[args.execution_id,args.workspace_id])).rows[0]??null;});
}
export async function readSignalStudyReportPageV1<S extends SignalStudyReportSectionV1>(args:StudyAccessV1&{execution_id:string;section:S;offset?:number;limit?:number}){
 const offset=args.offset??0,limit=args.limit??50,paths={motives:['summary','motives'],topics:['summary','motive_by_topic'],channels:['summary','motive_by_channel'],series:['summary','series'],evidence:['verified_evidence']}as const;
 if(!Object.hasOwn(paths,args.section)||!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)fail('pagination_invalid',422);
 return studyTransactionV1(args.database,async c=>{await studyAuthorizeV1(c,args,'view');const row=(await c.query<{total:number;rows:SignalStudyReportRowsV1[S]}>(`SELECT jsonb_array_length(o.output#>$3::text[]) total,
 COALESCE((SELECT jsonb_agg(value ORDER BY ordinality) FROM(SELECT value,ordinality FROM jsonb_array_elements(o.output#>$3::text[]) WITH ORDINALITY items WHERE ordinality>$4 ORDER BY ordinality LIMIT $5)page),'[]'::jsonb) rows
 ${reportScope}`,[args.execution_id,args.workspace_id,paths[args.section],offset,limit])).rows[0];return row?{section:args.section,offset,limit,total:row.total,rows:row.rows,next_offset:offset+row.rows.length<row.total?offset+row.rows.length:null}:null;});
}

import{studyTransactionV1,studyAuthorizeV1,studyUuidV1,studyFailV1 as fail,type StudyAccessV1,type SignalStudyConfigurationRecordV1,type SignalStudyExecutionRecordV1}from'./signal-study-core';
export type SignalStudyExecutionStatusV1=Pick<SignalStudyExecutionRecordV1,'id'|'workspace_id'|'study_id'|'configuration_id'|'configuration_digest'|'source_digest'|'status'|'error_code'|'cap_micro_usd'|'source_roots'>&{
 exposure_micro_usd:string;created_at:string|Date;updated_at:string|Date;output_available:boolean;phase:string|null;numeric_status:string|null;steps_committed:number;steps_unknown:number;steps_total:number};
const executionColumns=`p.id,p.workspace_id,p.study_id,p.configuration_id,p.configuration_digest,p.source_digest,p.status,p.error_code,p.cap_micro_usd::text,p.source_roots,p.created_at,p.updated_at,
 signal_study_exposure_v1(p.id)::text exposure_micro_usd,EXISTS(SELECT 1 FROM signal_study_outputs o WHERE o.execution_id=p.id AND o.workspace_id=p.workspace_id) output_available,
 (SELECT b.stage FROM signal_study_jev_batches b WHERE b.execution_id=p.id ORDER BY b.created_at DESC,b.id DESC LIMIT 1) phase,
 (SELECT n.verification_status FROM signal_study_numeric_checkpoints n WHERE n.execution_id=p.id ORDER BY n.created_at DESC,n.id DESC LIMIT 1) numeric_status,
 (SELECT count(*)::int FROM signal_study_steps s WHERE s.execution_id=p.id AND s.status='committed') steps_committed,
 (SELECT count(*)::int FROM signal_study_steps s WHERE s.execution_id=p.id AND s.status='unknown') steps_unknown,
 (SELECT count(*)::int FROM signal_study_steps s WHERE s.execution_id=p.id) steps_total`;
/** Metadata only: source text, raw receipts, vectors and provider secrets never
 * cross the status boundary. Report access separately checks current rights. */
export async function readSignalStudyExecutionStatusV1(args:StudyAccessV1&{execution_id:string}){
 if(!studyUuidV1.test(args.execution_id))fail('execution_invalid',422);
 return studyTransactionV1(args.database,async c=>{await studyAuthorizeV1(c,args,'view');return(await c.query<SignalStudyExecutionStatusV1>(`SELECT ${executionColumns} FROM signal_study_executions p WHERE p.id=$1 AND p.workspace_id=$2`,[args.execution_id,args.workspace_id])).rows[0]??null;});
}
export async function listSignalStudiesV1(args:StudyAccessV1&{limit?:number;after_study_id?:string}){
 const limit=args.limit??20;if(!Number.isInteger(limit)||limit<1||limit>100||args.after_study_id&&!studyUuidV1.test(args.after_study_id))fail('pagination_invalid',422);
 return studyTransactionV1(args.database,async c=>{await studyAuthorizeV1(c,args,'view');
  const rows=(await c.query<{study_id:string;configuration_id:string;revision:number;configuration_digest:string;methodology:string;subject_name:string;created_at:string|Date;execution:SignalStudyExecutionStatusV1|null}>(`SELECT s.id study_id,cfg.id configuration_id,cfg.revision,cfg.configuration_digest,cfg.envelope#>>'{study,methodology,key}' methodology,cfg.envelope#>>'{study,subject,name}' subject_name,s.created_at,
   (SELECT to_jsonb(e) FROM(SELECT ${executionColumns} FROM signal_study_executions p WHERE p.study_id=s.id AND p.workspace_id=s.workspace_id ORDER BY p.created_at DESC,p.id DESC LIMIT 1)e) execution
   FROM signal_studies s CROSS JOIN LATERAL(SELECT * FROM signal_study_configurations c WHERE c.study_id=s.id AND c.workspace_id=s.workspace_id ORDER BY c.revision DESC LIMIT 1)cfg
   WHERE s.workspace_id=$1 AND($2::uuid IS NULL OR(s.created_at,s.id)<(SELECT prior.created_at,prior.id FROM signal_studies prior WHERE prior.id=$2 AND prior.workspace_id=$1)) ORDER BY s.created_at DESC,s.id DESC LIMIT $3`,[args.workspace_id,args.after_study_id??null,limit+1])).rows;
  return{studies:rows.slice(0,limit),next_after_study_id:rows.length>limit?rows[limit-1]!.study_id:null};
 });
}
export async function readLatestSignalStudyConfigurationV1(args:StudyAccessV1&{study_id:string}){
 if(!studyUuidV1.test(args.study_id))fail('study_invalid',422);
 return studyTransactionV1(args.database,async c=>{await studyAuthorizeV1(c,args,'view');return(await c.query<SignalStudyConfigurationRecordV1>('SELECT * FROM signal_study_configurations WHERE study_id=$1 AND workspace_id=$2 ORDER BY revision DESC LIMIT 1',[args.study_id,args.workspace_id])).rows[0]??null;});
}
export async function readLatestSignalStudyExecutionStatusV1(args:StudyAccessV1&{study_id:string}){
 if(!studyUuidV1.test(args.study_id))fail('study_invalid',422);
 return studyTransactionV1(args.database,async c=>{await studyAuthorizeV1(c,args,'view');return(await c.query<SignalStudyExecutionStatusV1>(`SELECT ${executionColumns} FROM signal_study_executions p WHERE p.study_id=$1 AND p.workspace_id=$2 ORDER BY p.created_at DESC,p.id DESC LIMIT 1`,[args.study_id,args.workspace_id])).rows[0]??null;});
}

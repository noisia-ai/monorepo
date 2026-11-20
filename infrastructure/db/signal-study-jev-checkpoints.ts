import type{StudyRuntimeLeaseV1,StudyRuntimeJevBatchCheckpointV1}from'../../services/workers/src/workers/signal-study-runtime';
import{studyTransactionV1,studyDigestV1 as digest,studyFailV1 as fail,type StudyDatabaseV1}from'./signal-study-core';
import{lockSignalStudyExecutionWithClientV1}from'./signal-study-executions';
import{loadStudyBatchWithClientV1}from'./signal-study-jev-batches';
import{createLabelingRawCallPageReaderV1}from'./signal-labeling-raw-page-store';
import type{LabelingRawPageStorageV1}from'./signal-labeling-raw-pages';
export async function readSignalStudyJevBatchCheckpointV1(args:{database:StudyDatabaseV1;lease:StudyRuntimeLeaseV1;batch_id:string;raw_pages:LabelingRawPageStorageV1}):Promise<StudyRuntimeJevBatchCheckpointV1|null>{
 const initial=await studyTransactionV1(args.database,async c=>{await lockSignalStudyExecutionWithClientV1(c,args.lease);const b=await loadStudyBatchWithClientV1(c,args.lease,args.batch_id);if(!b)return null;if(b.checkpoint)return{b,rows:[],existing:true as const};
  const run=b.run_id?(await c.query<{status:string;error_code:string|null}>('SELECT status,error_code FROM signal_labeling_runs WHERE id=$1 AND workspace_id=$2',[b.run_id,b.workspace_id])).rows[0]:null;
  const rows=(await c.query<{root_id:string;request_sha256:string;request_digest:string;call_id:string;raw_sha256:string;raw_page_id:string;page_sha256:string;status:string;results_applied:boolean;results:Array<{status:string;answers:unknown}>}>(`SELECT m.root_id,m.request_sha256,c.request_digest,c.id call_id,c.raw_sha256,member.page_id raw_page_id,page.sha256 page_sha256,c.status,c.results_applied,c.results
   FROM signal_study_jev_members m LEFT JOIN signal_study_jev_calls link ON link.batch_id=m.batch_id AND link.root_id=m.root_id
   LEFT JOIN signal_labeling_calls c ON c.id=link.call_id AND c.workspace_id=link.workspace_id LEFT JOIN signal_labeling_raw_page_members member ON member.call_id=c.id AND member.workspace_id=c.workspace_id AND member.run_id=c.run_id LEFT JOIN signal_labeling_raw_pages page ON page.id=member.page_id AND page.status='verified'
   WHERE m.batch_id=$1 AND m.workspace_id=$2 ORDER BY m.root_id`,[b.id,b.workspace_id])).rows;
  const unknown=rows.some(row=>row.status==='unknown'&&!row.raw_page_id),recoverable=rows.some(row=>row.call_id&&!row.results_applied&&row.raw_page_id);
  const status:StudyRuntimeJevBatchCheckpointV1['status']=run?.status==='failed'&&/cap|budget/u.test(run.error_code??'')?'budget_exhausted':unknown?'outcome_unknown':run?.status==='failed'&&!recoverable||run?.status==='completed'&&rows.some(r=>r.status!=='settled'||!r.results_applied||r.results?.[0]?.status!=='labeled')?'stale':!run?'planned':run.status==='completed'?'completed':'running';
  return{b,rows,status,existing:false as const};});
 if(!initial)return null;if(initial.existing)return initial.b.checkpoint;
 const rawReader=createLabelingRawCallPageReaderV1({database:args.database,loadPage:args.raw_pages.load});
 for(const row of initial.rows.filter(r=>r.call_id&&!r.results_applied&&r.raw_page_id)){const raw=await rawReader({workspace_id:initial.b.workspace_id,run_id:initial.b.run_id!,call_id:row.call_id,request_digest:row.request_digest});if(!raw)continue;try{const w=JSON.parse(raw.raw_text),body=JSON.parse(w.body);if(w.http_status!==200||w.complete===false||body.model!=='jev-1.13.0'||!Number.isSafeInteger(body.usage?.input_tokens)||!Number.isSafeInteger(body.usage?.output_tokens))initial.status='outcome_unknown';}catch{initial.status='outcome_unknown';}}
 const result:Omit<StudyRuntimeJevBatchCheckpointV1,'checkpoint_digest'>={batch_id:initial.b.id,plan_digest:initial.b.plan_digest,status:initial.status!,results:[]};
 if(result.status==='completed'){
  const read=createLabelingRawCallPageReaderV1({database:args.database,loadPage:args.raw_pages.load});
  if(initial.rows.length!==initial.b.request_count||initial.rows.some(r=>r.status!=='settled'||!r.results_applied||!r.raw_page_id||!r.page_sha256||r.results?.[0]?.status!=='labeled'))fail('batch_completion_incomplete');
  for(const row of initial.rows){const raw=await read({workspace_id:initial.b.workspace_id,run_id:initial.b.run_id!,call_id:row.call_id,request_digest:row.request_digest});if(!raw||raw.raw_sha256!==row.raw_sha256)fail('batch_raw_checksum_invalid');const wrapper=JSON.parse(raw.raw_text)as{http_status:number;body:string;complete?:boolean};
   if(wrapper.http_status!==200||wrapper.complete===false)fail('batch_transport_unknown');const response=JSON.parse(wrapper.body)as{model:string;answers:unknown};
   if(response.model!=='jev-1.13.0'||digest(response.answers)!==digest(row.results[0]!.answers))fail('batch_result_raw_mismatch');
   result.results.push({root_id:row.root_id,request_sha256:row.request_sha256,call_id:row.call_id,complete:true,http_status:200,receipt_page:{page_id:row.raw_page_id,sha256:row.page_sha256,verified:true},response});
  }
 }
 const checkpoint={...result,checkpoint_digest:digest(result)};
 if(result.status==='outcome_unknown'||result.status==='stale'||result.status==='budget_exhausted')await studyTransactionV1(args.database,async c=>{const p=await lockSignalStudyExecutionWithClientV1(c,args.lease);await c.query("UPDATE signal_study_jev_batches SET status=$2 WHERE id=$1 AND status<>'completed'",[initial.b.id,result.status]);await c.query("UPDATE signal_study_executions SET status=$2,error_code=$3 WHERE id=$1",[p.id,result.status==='outcome_unknown'?'outcome_unknown':result.status==='budget_exhausted'?'budget_exhausted':'failed',result.status==='outcome_unknown'?'study_jev_outcome_unknown':result.status==='budget_exhausted'?'study_jev_budget_exhausted':'study_jev_response_invalid']);});
 if(result.status==='completed')return studyTransactionV1(args.database,async c=>{await lockSignalStudyExecutionWithClientV1(c,args.lease);const b=await loadStudyBatchWithClientV1(c,args.lease,args.batch_id);if(!b||b.plan_digest!==checkpoint.plan_digest)fail('batch_changed');if(b.checkpoint)return b.checkpoint;
  await c.query("UPDATE signal_study_jev_batches SET status='completed',checkpoint=$2::jsonb WHERE id=$1",[b.id,JSON.stringify(checkpoint)]);return checkpoint;});
 return checkpoint;
}

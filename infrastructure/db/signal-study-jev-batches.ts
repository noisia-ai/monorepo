import{createHash,randomUUID}from'node:crypto';
import type{PoolClient}from'pg';
import{entityContextDigestV1,signalStudyJevIdentityV1,signalStudyJevTargetDigestV1,signalStudyJevQuestionDigestV1,labelerDigestV1,type SignalStudyJevBindingV1,signalWorkspaceEmbeddingDigestV1 as digest}from'@noisia/query-engine';
import type{StudyRuntimeJevBatchPlanV1,StudyRuntimeJevBatchCheckpointV1,StudyRuntimeLeaseV1}from'../../services/workers/src/workers/signal-study-runtime';
import{studyTransactionV1,studyFailV1 as fail,type StudyDatabaseV1,type SignalStudyExecutionRecordV1,studyConfigurationWithClientV1}from'./signal-study-core';
import{lockSignalStudyExecutionWithClientV1}from'./signal-study-executions';
import{withSignalStudySourceWithClientV1}from'./signal-study-source';
import{replaySignalStudyWithClientV1}from'./signal-study-replay';
import{requestMentionFacetsV1}from'./signal-labeling-runs';
const sha=(value:string)=>'sha256:'+createHash('sha256').update(value).digest('hex');
export type StudyBatchRowV1={id:string;workspace_id:string;execution_id:string;run_id:string|null;stage:string;plan_header:SignalStudyJevBindingV1['plan'];plan_digest:string;stage_configuration:SignalStudyJevBindingV1['stage_configuration'];stage_configuration_digest:string;stage_lineage:unknown;target_digest:string;request_count:number;run_cap_micro_usd:string;request_census_digest:string;parent_execution_token:string;status:StudyRuntimeJevBatchCheckpointV1['status'];checkpoint:StudyRuntimeJevBatchCheckpointV1|null};
export async function loadStudyBatchWithClientV1(c:Pick<PoolClient,'query'>,lease:StudyRuntimeLeaseV1,id:string,current=true){
 const row=(await c.query<StudyBatchRowV1>('SELECT * FROM signal_study_jev_batches WHERE id=$1 AND execution_id=$2 AND workspace_id=$3',[id,lease.execution_id,lease.workspace_id])).rows[0];if(!row)return null;
 if(current&&row.parent_execution_token!==lease.execution_token)fail('batch_lease_lost');return row;
}
export async function studyJevBindingWithClientV1(c:Pick<PoolClient,'query'>,p:SignalStudyExecutionRecordV1,b:StudyBatchRowV1,runId=b.run_id){
 if(!runId)fail('batch_run_missing');const cfg=await studyConfigurationWithClientV1(c,p.workspace_id,p.configuration_id);if(!cfg)fail('configuration_unavailable');
 const binding:SignalStudyJevBindingV1={contract_version:'signal-study-jev-native-binding-v1',scope:'study',batch_id:b.id,run_id:runId,actor_user_id:p.actor_user_id,configuration:cfg.envelope,stage_configuration:b.stage_configuration,
  plan:b.plan_header,human_revision_digest:p.human_revision_digest,policy_version_id:p.policy_version_id,entity_context_digest:p.entity_context_digest,stage_checkpoint:{id:b.id,digest:b.plan_digest},labeler_digest:''};
 binding.labeler_digest=labelerDigestV1(signalStudyJevIdentityV1(binding));return binding;
}
/** Stage admission is a distinct native transaction: only a sealed immutable
 * batch exists before common H1 request; its persist hook binds the real run in
 * the SAME transaction as that run's own governed admission. No nested/fake TX. */
export async function prepareSignalStudyJevBatchV1(args:{database:StudyDatabaseV1;lease:StudyRuntimeLeaseV1;plan:StudyRuntimeJevBatchPlanV1;provider_available:boolean}){
 const {plan,lease}=args,{plan_digest,...body}=plan;if(plan_digest!==digest(body)||plan.execution_id!==lease.execution_id||plan.workspace_id!==lease.workspace_id||plan.source_digest!==lease.source_digest||!plan.requests.length)fail('batch_plan_invalid',422);
 const prepared=await studyTransactionV1(args.database,async c=>{
  const p=await lockSignalStudyExecutionWithClientV1(c,lease);
  let b=(await c.query<StudyBatchRowV1>('SELECT * FROM signal_study_jev_batches WHERE execution_id=$1 AND stage=$2 AND plan_digest=$3',[p.id,plan.stage,plan.plan_digest])).rows[0];
  if(b){if(digest(b.plan_header)!==digest(header(plan))||b.request_count!==plan.requests.length)fail('batch_plan_conflict');await c.query('UPDATE signal_study_jev_batches SET parent_execution_token=$2 WHERE id=$1',[b.id,lease.execution_token]);b.parent_execution_token=lease.execution_token;return{p,b};}
  const expected=(await withSignalStudySourceWithClientV1(c,p,source=>replaySignalStudyWithClientV1(c,p.id,source))).operation;if(expected.kind!=='jev'||digest(expected.plan)!==digest(plan))fail('batch_not_next');
  const cfg=await studyConfigurationWithClientV1(c,p.workspace_id,p.configuration_id);if(!cfg)fail('configuration_unavailable');const remaining=BigInt(p.cap_micro_usd)-BigInt((await c.query<{v:string}>('SELECT signal_study_exposure_v1($1)::text v',[p.id])).rows[0]!.v);if(remaining<=0n){await c.query("UPDATE signal_study_executions SET status='budget_exhausted',error_code='study_parent_cap_exhausted' WHERE id=$1",[p.id]);return null;}
  const policyCap=(await c.query<{max_execution_micro_usd:string|null}>("SELECT max_execution_micro_usd::text FROM signal_processing_policy_actions WHERE policy_version_id=$1 AND action='mass_labeling_jev'",[p.policy_version_id])).rows[0]?.max_execution_micro_usd;const runCap=policyCap===null||policyCap===undefined?remaining:BigInt(policyCap)<remaining?BigInt(policyCap):remaining;
  const id=randomUUID(),target=signalStudyJevTargetDigestV1(cfg.envelope),census=digest(plan.requests.map(r=>[r.root_id,r.request_sha256]));
  await c.query("SELECT set_config('noisia.study_batch_plan_v1',$1,true)",[JSON.stringify({execution_id:p.id,execution_token:lease.execution_token,batch_id:id,plan_digest:plan.plan_digest,census_digest:census})]);
  b=(await c.query<StudyBatchRowV1>(`INSERT INTO signal_study_jev_batches(id,workspace_id,execution_id,stage,plan_header,plan_digest,stage_configuration,stage_configuration_digest,stage_lineage,target_digest,run_cap_micro_usd,request_count,request_census_digest,parent_execution_token)
   VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9::jsonb,$10,$11,$12,$13,$14) RETURNING *`,[id,p.workspace_id,p.id,plan.stage,JSON.stringify(header(plan)),plan.plan_digest,JSON.stringify(plan.stage_configuration),plan.stage_configuration_digest,JSON.stringify(plan.stage_dependencies),target,String(runCap),plan.requests.length,census,lease.execution_token])).rows[0]!;
  const binding=await studyJevBindingWithClientV1(c,p,b,randomUUID());
  const rows=plan.requests.map(r=>{const req=JSON.parse(r.request_body)as{state:string;questions:Record<string,unknown>},keys=Object.keys(req.questions).sort(),qdigests=Object.fromEntries(keys.map(key=>[key,signalStudyJevQuestionDigestV1(binding,key)]));
   return{...r,state_sha256:sha(req.state),question_keys:keys,question_digests:qdigests,input_digest:digest({scope:'study',root_id:r.root_id,source_digest:p.source_digest,state_sha256:sha(req.state),target_digest:target})};});
  await c.query(`INSERT INTO signal_study_jev_members(batch_id,workspace_id,execution_id,root_id,request_body,request_sha256,state_sha256,input_digest,question_digests,question_keys,target_digest)
   SELECT $1,$2,$3,x.root_id,x.request_body,x.request_sha256,x.state_sha256,x.input_digest,x.question_digests,x.question_keys,$4 FROM jsonb_to_recordset($5::jsonb)x(root_id uuid,request_body text,request_sha256 text,state_sha256 text,input_digest text,question_digests jsonb,question_keys text[])`,[id,p.workspace_id,p.id,target,JSON.stringify(rows)]);
  await c.query('ANALYZE signal_study_jev_members');await c.query("UPDATE signal_study_jev_batches SET status='planned' WHERE id=$1",[id]);b.status='planned';return{p,b};
 });
 if(!prepared)return null;
 if(!prepared.b.run_id){if(!args.provider_available)return null;
  const late=await studyTransactionV1(args.database,async c=>{const p=await lockSignalStudyExecutionWithClientV1(c,lease);if((await c.query<{blocked:boolean}>('SELECT signal_study_prior_unknown_v1($1) blocked',[prepared.b.id])).rows[0]?.blocked){await c.query("UPDATE signal_study_executions SET status='outcome_unknown',error_code='study_prior_question_outcome_unknown' WHERE id=$1",[p.id]);await c.query("UPDATE signal_study_jev_batches SET status='outcome_unknown' WHERE id=$1",[prepared.b.id]);return true;}if(!(await c.query<{late:boolean}>('SELECT signal_study_late_cache_v1($1,NULL) late',[prepared.b.id])).rows[0]?.late)return false;await c.query("UPDATE signal_study_executions SET status='stale',error_code='study_late_cache_replan_required' WHERE id=$1",[p.id]);await c.query("UPDATE signal_study_jev_batches SET status='stale' WHERE id=$1",[prepared.b.id]);return true;});if(late)return null;
  const binding=await studyTransactionV1(args.database,c=>studyJevBindingWithClientV1(c,prepared.p,prepared.b,randomUUID()));const identity=signalStudyJevIdentityV1(binding);
  // No parent lock is held while retiring obsolete H1 owners: common H1 locks
  // run before invoking its adapter. Keep leases so observed RAW can drain.
  await studyTransactionV1(args.database,async c=>{await c.query("SELECT pg_advisory_xact_lock(hashtextextended('mfp-labeling:'||$1,0))",[lease.workspace_id]);await c.query("SELECT r.id FROM signal_labeling_runs r JOIN signal_study_jev_batches b ON b.run_id=r.id JOIN signal_study_executions p ON p.id=b.execution_id WHERE p.workspace_id=$1 AND p.status='stale' AND r.status IN('queued','running') ORDER BY r.id FOR UPDATE OF r",[lease.workspace_id]);await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1,0))",[prepared.p.organization_id]);await c.query("UPDATE signal_labeling_runs r SET status='failed',error_code='study_configuration_changed',updated_at=clock_timestamp() FROM signal_study_jev_batches b JOIN signal_study_executions p ON p.id=b.execution_id WHERE r.id=b.run_id AND p.workspace_id=$1 AND p.status='stale' AND r.status IN('queued','running')",[lease.workspace_id]);});
  await requestMentionFacetsV1({database:args.database,workspace_id:lease.workspace_id,actor_user_id:prepared.p.actor_user_id,idempotency_key:'study-batch:'+prepared.b.id,cap_micro_usd:Number(prepared.b.run_cap_micro_usd),provider_available:args.provider_available,identity,full_recalculation:true,
   adapter:{policy_action:'mass_labeling_jev',feature:'mass_labeling',select_labeler:false,request_identity:{contract_version:'signal-study-jev-native-run-v1',batch_id:prepared.b.id,plan_digest:plan.plan_digest},
    validateIdentity:v=>{if(labelerDigestV1(v)!==binding.labeler_digest)fail('jev_identity_invalid');},
    prepare:async(c,workspace,_run,_labeler,context)=>{const p=await lockSignalStudyExecutionWithClientV1(c,lease),b=await loadStudyBatchWithClientV1(c,lease,prepared.b.id);if(!b||b.run_id||workspace!==p.workspace_id||entityContextDigestV1(context)!==p.entity_context_digest)fail('batch_source_changed');
     if((await c.query<{blocked:boolean}>('SELECT signal_study_prior_unknown_v1($1) blocked',[b.id])).rows[0]?.blocked)fail('prior_question_outcome_unknown');if((await c.query<{late:boolean}>('SELECT signal_study_late_cache_v1($1,NULL) late',[b.id])).rows[0]?.late)fail('late_cache_replan_required');
     const bytes=Number((await c.query<{n:string}>('SELECT sum(octet_length(request_body))::text n FROM signal_study_jev_members WHERE batch_id=$1',[b.id])).rows[0]!.n);
     return{roots:b.request_count,estimated_micro_usd:Math.ceil((bytes*4+b.request_count*8192)*.042),concept_set_digest:b.stage_configuration_digest,snapshot:{contract_version:'signal-study-jev-native-run-v1',batch_id:b.id,plan_digest:b.plan_digest,source_digest:p.source_digest,stage_configuration_digest:b.stage_configuration_digest}};},
    persist:async(c,run,preparedRun)=>{await lockSignalStudyExecutionWithClientV1(c,lease);await c.query('UPDATE signal_labeling_runs SET membership_snapshot=$2::jsonb,concept_set_digest=$3 WHERE id=$1',[run,JSON.stringify(preparedRun.snapshot),preparedRun.concept_set_digest]);await c.query("UPDATE signal_study_jev_batches SET run_id=$2,status='running' WHERE id=$1 AND run_id IS NULL",[prepared.b.id,run]);},
   }});
 }
 return{batch_id:prepared.b.id,plan_digest:plan.plan_digest};
}
function header(plan:StudyRuntimeJevBatchPlanV1){const{requests,stage_configuration:_config,...body}=plan;return{...body,contract_version:'signal-study-jev-plan-header-v1' as const,request_count:requests.length};}

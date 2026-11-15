import type{SignalStudyEditorialFormatStopV1}from'@noisia/query-engine';
import{createHash,randomUUID}from'node:crypto';
import type{PoolClient}from'pg';
import type{StudyRuntimeLeaseV1,StudyRuntimeStepPlanV1,StudyRuntimeStepV1,StudyRuntimeReceiptV1}from'../../services/workers/src/workers/signal-study-runtime';
import{studyTransactionV1,studyFailV1 as fail,studyDigestV1 as digest,type StudyDatabaseV1,type SignalStudyExecutionRecordV1}from'./signal-study-core';
import{lockSignalStudyExecutionWithClientV1,validateSignalStudyLeaseV1}from'./signal-study-executions';
import{readSignalStudySourceWithClientV1,signalStudySourceUrlStateV1}from'./signal-study-source';
import{replaySignalStudyWithClientV1,validateSignalStudyCurrentStepWithClientV1}from'./signal-study-replay';
import{admitSignalProcessingWithClientV1}from'./signal-processing-policy';
const sha=(body:string|Buffer)=>'sha256:'+createHash('sha256').update(body).digest('hex');
export type SignalStudyRawDescriptorV1={workspace_id:string;execution_id:string;step_id:string;name:string;raw_text:string;raw_sha256:string;size_bytes:number};
export type SignalStudyRawStorageV1={reference(d:SignalStudyRawDescriptorV1):{storage_key:string};store(d:SignalStudyRawDescriptorV1):Promise<{storage_key:string;sha256:string;size_bytes:number;verified:true}>;
 load(d:{storage_key:string;sha256:string;size_bytes:number}):Promise<string>};
type Step={id:string;workspace_id:string;execution_id:string;step_key:string;request_body:string;request_sha256:string;source_digest:string;status:StudyRuntimeStepV1['status'];sent_token:string|null;reservation_micro_usd:string;value?:unknown;value_digest?:string;raw_json?:string;verification_status?:string};
function validatePlan(lease:StudyRuntimeLeaseV1,plan:StudyRuntimeStepPlanV1){validateSignalStudyLeaseV1(lease);if(plan.kind!=='sonnet'||plan.source_digest!==lease.source_digest||sha(plan.request_body)!==plan.request_sha256||!/^sha256:[a-f0-9]{64}$/u.test(plan.key))fail('step_plan_invalid',422);}
function mapped(row:Step):StudyRuntimeStepV1{
 const receipt=row.verification_status==='verified'&&row.raw_json?JSON.parse(row.raw_json)as StudyRuntimeReceiptV1&{contract_version?:string}:undefined;if(receipt)delete receipt.contract_version;
 return{kind:'sonnet',key:row.step_key,request_body:row.request_body,request_sha256:row.request_sha256,source_digest:row.source_digest,status:row.status,...(receipt?{receipt}:{}),...(row.value?{value:row.value,value_digest:row.value_digest}:{})};
}
async function readStep(c:Pick<PoolClient,'query'>,lease:StudyRuntimeLeaseV1,plan:StudyRuntimeStepPlanV1){
 const row=(await c.query<Step>(`SELECT s.*,r.raw_json,r.verification_status FROM signal_study_steps s LEFT JOIN signal_study_receipts r ON r.step_id=s.id
  WHERE s.execution_id=$1 AND s.workspace_id=$2 AND s.step_key=$3`,[lease.execution_id,lease.workspace_id,plan.key])).rows[0];
 if(row&&(row.request_body!==plan.request_body||row.request_sha256!==plan.request_sha256||row.source_digest!==plan.source_digest))fail('step_binding_invalid');return row;
}
async function recoveryLock(c:PoolClient,lease:StudyRuntimeLeaseV1){
 // Bookkeeping retains original authority and exact attempt even if permission
 // changed after sending. This path can neither reserve nor send nor publish.
 validateSignalStudyLeaseV1(lease);const p=(await c.query<SignalStudyExecutionRecordV1>('SELECT * FROM signal_study_executions WHERE id=$1 AND workspace_id=$2',[lease.execution_id,lease.workspace_id])).rows[0];
 if(!p||p.source_digest!==lease.source_digest||p.configuration_digest!==lease.configuration_digest||p.human_revision_digest!==lease.human_revision_digest)fail('execution_unavailable');
 await c.query("SELECT pg_advisory_xact_lock(hashtextextended('signal-processing-policy:'||$1,0))",[p.organization_id]);
 await c.query('SELECT signal_processing_lock_v1($1,(clock_timestamp() AT TIME ZONE policy.budget_timezone)::date) FROM signal_processing_policy_versions policy WHERE policy.id=$2',[p.organization_id,p.policy_version_id]);
 await c.query('SELECT id FROM signal_study_executions WHERE id=$1 FOR UPDATE',[p.id]);return p;
}
export async function readSignalStudyStepV1(args:{database:StudyDatabaseV1;lease:StudyRuntimeLeaseV1;plan:StudyRuntimeStepPlanV1}){
 validatePlan(args.lease,args.plan);return studyTransactionV1(args.database,async c=>{await lockSignalStudyExecutionWithClientV1(c,args.lease,false);const row=await readStep(c,args.lease,args.plan);return row?mapped(row):null;});
}
export async function planSignalStudyStepV1(args:{database:StudyDatabaseV1;lease:StudyRuntimeLeaseV1;plan:StudyRuntimeStepPlanV1}){
 validatePlan(args.lease,args.plan);return studyTransactionV1(args.database,async c=>{
  const p=await lockSignalStudyExecutionWithClientV1(c,args.lease),old=await readStep(c,args.lease,args.plan);if(old)return mapped(old);
  const source=await readSignalStudySourceWithClientV1(c,p),expected=(await replaySignalStudyWithClientV1(c,p.id,source)).operation;
  if(expected.kind!=='sonnet'||digest(expected.plan)!==digest(args.plan))fail('step_not_next');
  const roots=new Map(source.roots.map(root=>[root.root_id,root]));
  if(expected.editorial.mode!=='reconciliation'&&expected.editorial.source_samples.some(group=>!group.rows.some(row=>{const root=roots.get(row.root_id);return root&&signalStudySourceUrlStateV1(root.source_url)==='valid';})))fail('verbatim_source_unavailable',422);
  const body=JSON.parse(args.plan.request_body)as{model:string;max_tokens:number};if(body.model!=='claude-sonnet-4-6'||body.max_tokens!==32768||Buffer.byteLength(args.plan.request_body)>524288)fail('step_request_invalid');
  const reservation=(Buffer.byteLength(args.plan.request_body)+4096)*6+body.max_tokens*15;
  const exposure=BigInt((await c.query<{v:string}>('SELECT signal_study_exposure_v1($1)::text v',[p.id])).rows[0]!.v);
  if(exposure+BigInt(reservation)>BigInt(p.cap_micro_usd)){await c.query("UPDATE signal_study_executions SET status='budget_exhausted',error_code='study_parent_cap_exhausted' WHERE id=$1",[p.id]);return null;}
  await c.query("SELECT set_config('noisia.study_expected_step_v1',$1,true)",[JSON.stringify({execution_id:p.id,execution_token:args.lease.execution_token,step_key:args.plan.key,request_sha256:args.plan.request_sha256,mode:expected.editorial.mode})]);
  const row=(await c.query<Step>(`INSERT INTO signal_study_steps(workspace_id,execution_id,step_key,request_body,request_sha256,source_digest,mode,maximum_output_tokens,reservation_micro_usd)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[p.workspace_id,p.id,args.plan.key,args.plan.request_body,args.plan.request_sha256,p.source_digest,expected.editorial.mode,body.max_tokens,reservation])).rows[0]!;
  const admission=await admitSignalProcessingWithClientV1(c,{workspace_id:p.workspace_id,actor_user_id:p.actor_user_id,action:'study_analysis',target_id:row.id,idempotency_key:'study-step:'+row.id,request_digest:row.request_sha256,execution_cap_micro_usd:String(reservation)});
  await c.query('UPDATE signal_study_steps SET admission_id=$2 WHERE id=$1',[row.id,admission.receipt.id]);
  await c.query(`INSERT INTO engine_cost_events(workspace_contract,workspace_id,study_step_id,actor_user_id,provider,model,operation,idempotency_key,request_digest,request_seal,call_configuration,call_state,
   attempt_token,reserved_micro_usd,budget_date,budget_timezone,budget_daily_cap_micro_usd,metadata)
   SELECT 'signal-study-step-v1',s.workspace_id,s.id,p.actor_user_id,'anthropic','claude-sonnet-4-6','signal-study-analysis','study-step:'||s.id::text,s.request_sha256,s.request_sha256,
   signal_study_analysis_configuration_v1(),'reserved',gen_random_uuid(),s.reservation_micro_usd,a.budget_date,a.budget_timezone,policy.daily_cap_micro_usd,jsonb_build_object('lease_token',p.execution_token)
   FROM signal_study_steps s JOIN signal_study_executions p ON p.id=s.execution_id JOIN signal_processing_admissions a ON a.id=s.admission_id JOIN signal_processing_policy_versions policy ON policy.id=a.policy_version_id WHERE s.id=$1`,[row.id]);return mapped(row);
 });
}
export async function markSignalStudyStepSentV1(args:{database:StudyDatabaseV1;lease:StudyRuntimeLeaseV1;plan:StudyRuntimeStepPlanV1;provider_available:boolean}):Promise<'sent'|'stale'|'budget_exhausted'>{
 validatePlan(args.lease,args.plan);if(!args.provider_available)return'stale';
 return studyTransactionV1(args.database,async c=>{const p=await lockSignalStudyExecutionWithClientV1(c,args.lease),row=await readStep(c,args.lease,args.plan);if(!row)fail('step_unavailable');
  const call=(await c.query<{id:string;call_state:string;attempt_token:string}>('SELECT * FROM engine_cost_events WHERE study_step_id=$1 FOR UPDATE',[row.id])).rows[0];if(!call||call.call_state!=='reserved'||row.status!=='planned')return'stale';
  if(BigInt((await c.query<{v:string}>('SELECT signal_study_exposure_v1($1)::text v',[p.id])).rows[0]!.v)>BigInt(p.cap_micro_usd))return'budget_exhausted';
  await c.query("UPDATE engine_cost_events SET metadata=jsonb_set(metadata,'{lease_token}',to_jsonb($2::text)) WHERE id=$1",[call.id,args.lease.execution_token]);
  await c.query("UPDATE engine_cost_events SET call_state='in_flight',sent_at=clock_timestamp() WHERE id=$1 AND call_state='reserved'",[call.id]);
  await c.query("UPDATE signal_study_steps SET status='sent',sent_token=$2 WHERE id=$1",[row.id,call.attempt_token]);return'sent';});
}
export async function persistSignalStudyReceiptV1(args:{database:StudyDatabaseV1;lease:StudyRuntimeLeaseV1;plan:StudyRuntimeStepPlanV1;receipt:StudyRuntimeReceiptV1;storage:SignalStudyRawStorageV1}){
 validatePlan(args.lease,args.plan);const receipt=args.receipt,bytes=Buffer.from(receipt.body_base64,'base64');
 if(bytes.toString('base64')!==receipt.body_base64||bytes.length!==receipt.body_bytes||bytes.length>8388608||sha(bytes)!==receipt.sha256||typeof receipt.complete!=='boolean'||receipt.http_status!==null&&(!Number.isInteger(receipt.http_status)||receipt.http_status<100||receipt.http_status>599)||receipt.provider_request_id!==null&&(typeof receipt.provider_request_id!=='string'||receipt.provider_request_id.length>200))fail('receipt_invalid',422);
 const raw_text=JSON.stringify({contract_version:'signal-study-receipt-v1',...receipt}),raw_sha256=sha(raw_text);
 const scoped=await studyTransactionV1(args.database,async c=>{await recoveryLock(c,args.lease);const row=await readStep(c,args.lease,args.plan);if(!row?.sent_token)fail('step_unsent');return row;});
 const descriptor:SignalStudyRawDescriptorV1={workspace_id:args.lease.workspace_id,execution_id:args.lease.execution_id,step_id:scoped.id,name:'study-'+raw_sha256.slice(7)+'.json',raw_text,raw_sha256,size_bytes:Buffer.byteLength(raw_text)},ref=args.storage.reference(descriptor);
 if(!ref.storage_key.startsWith('workspace-engine/'+descriptor.workspace_id+'/'+descriptor.execution_id+'/'))fail('storage_scope_invalid');
 const previous=await studyTransactionV1(args.database,async c=>{await recoveryLock(c,args.lease);const prior=(await c.query<{raw_json:string;storage_key:string;verification_status:string}>('SELECT * FROM signal_study_receipts WHERE step_id=$1',[scoped.id])).rows[0];
  if(prior){if(prior.raw_json!==raw_text||prior.storage_key!==ref.storage_key)fail('receipt_conflict');return prior.verification_status;}
  await c.query(`INSERT INTO signal_study_receipts(step_id,workspace_id,execution_id,attempt_token,raw_json,raw_sha256,raw_size_bytes,storage_key,body_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[scoped.id,descriptor.workspace_id,descriptor.execution_id,scoped.sent_token,raw_text,raw_sha256,descriptor.size_bytes,ref.storage_key,receipt.sha256]);return'planned';});
 if(previous!=='verified'){const stored=await args.storage.store(descriptor);if(!stored.verified||stored.storage_key!==ref.storage_key||stored.sha256!==raw_sha256||stored.size_bytes!==descriptor.size_bytes)fail('storage_verification_failed');}
 const readback=await args.storage.load({storage_key:ref.storage_key,sha256:raw_sha256,size_bytes:descriptor.size_bytes});if(readback!==raw_text||sha(readback)!==raw_sha256)fail('storage_checksum_invalid');
 await studyTransactionV1(args.database,async c=>{await recoveryLock(c,args.lease);const stored=(await c.query<{verification_status:string}>('SELECT verification_status FROM signal_study_receipts WHERE step_id=$1 FOR UPDATE',[scoped.id])).rows[0];if(stored?.verification_status==='verified')return;
  await c.query("UPDATE signal_study_receipts SET verification_status='verified',verified_at=clock_timestamp() WHERE step_id=$1",[scoped.id]);
  let complete=receipt.complete;try{new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{complete=false;}const valid=complete&&receipt.http_status===200;
  await c.query(`UPDATE engine_cost_events SET call_state=$2,response_storage_key=$3,response_sha256=$4,response_size_bytes=$5,response_http_status=$6,provider_request_id=$7,response_received_at=clock_timestamp(),metadata=metadata||jsonb_build_object('response_complete',$8::boolean) WHERE study_step_id=$1`,[scoped.id,valid?'response_persisted':'outcome_unknown',ref.storage_key,raw_sha256,descriptor.size_bytes,receipt.http_status,receipt.provider_request_id,complete]);
  await c.query("UPDATE signal_study_steps SET status=$2 WHERE id=$1",[scoped.id,valid?'raw':'unknown']);
  if(!valid)await c.query("UPDATE signal_study_executions SET status='outcome_unknown',error_code='study_transport_unknown' WHERE id=$1",[descriptor.execution_id]);
 });
}
export async function settleSignalStudyStepV1(args:{database:StudyDatabaseV1;lease:StudyRuntimeLeaseV1;plan:StudyRuntimeStepPlanV1}):Promise<'settled'|'unknown'>{
 validatePlan(args.lease,args.plan);return studyTransactionV1(args.database,async c=>{const p=await recoveryLock(c,args.lease),s=await readStep(c,args.lease,args.plan);if(!s)fail('step_unavailable');
  const call=(await c.query<{id:string;call_state:string}>('SELECT * FROM engine_cost_events WHERE study_step_id=$1 FOR UPDATE',[s.id])).rows[0];if(call?.call_state==='settled')return'settled';if(call?.call_state!=='response_persisted'||s.verification_status!=='verified'||!s.raw_json)return'unknown';
  const unresolved=async()=>{await c.query("UPDATE engine_cost_events SET call_state='outcome_unknown',metadata=metadata||'{\"error_code\":\"study_usage_invalid\"}'::jsonb WHERE id=$1",[call.id]);await c.query("UPDATE signal_study_steps SET status='unknown',error_code='study_usage_invalid' WHERE id=$1 AND status='raw'",[s.id]);await c.query("UPDATE signal_study_executions SET status='outcome_unknown',error_code='study_usage_invalid' WHERE id=$1 AND status='running'",[p.id]);return'unknown' as const;};
  let body:{model:string;usage:Record<string,unknown>};try{const r=JSON.parse(s.raw_json)as StudyRuntimeReceiptV1;body=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.from(r.body_base64,'base64')));}catch{return unresolved();}
  const usage=body.usage as{input_tokens:number;output_tokens:number;cache_read_input_tokens?:number;cache_creation_input_tokens?:number;cache_creation?:{ephemeral_5m_input_tokens?:number;ephemeral_1h_input_tokens?:number}};
  const t=[usage?.input_tokens,usage?.output_tokens,usage?.cache_read_input_tokens??0,usage?.cache_creation_input_tokens??0,usage?.cache_creation?.ephemeral_5m_input_tokens??0,usage?.cache_creation?.ephemeral_1h_input_tokens??0];
  if(!/^claude-sonnet-4-6(?:-[0-9]{8})?$/u.test(body.model??'')||t.some(v=>!Number.isSafeInteger(v)||v<0)||t[0]!>1000000||t[1]!>32768||t[2]!+t[3]!+t[0]!>1000000||t[3]!==t[4]!+t[5]!)return unresolved();
  const cost=Math.ceil(t[0]!*3+t[1]!*15+t[2]!*.3+t[4]!*3.75+t[5]!*6);
  await c.query(`UPDATE engine_cost_events SET call_state='settled',input_tokens=$2,output_tokens=$3,total_tokens=$4,settled_micro_usd=$5,settled_at=clock_timestamp(),metadata=metadata||jsonb_build_object('usage',$6::jsonb) WHERE id=$1`,[call.id,t[0],t[1],t.slice(0,4).reduce((a,b)=>a!+b!,0),cost,JSON.stringify(usage)]);
  if(BigInt((await c.query<{v:string}>('SELECT signal_study_exposure_v1($1)::text v',[p.id])).rows[0]!.v)>BigInt(p.cap_micro_usd))await c.query("UPDATE signal_study_executions SET status='budget_exhausted',error_code='study_observed_over_cap' WHERE id=$1 AND status IN('queued','running','outcome_unknown')",[p.id]);return'settled';});
}
export async function commitSignalStudyStepV1(args:{database:StudyDatabaseV1;lease:StudyRuntimeLeaseV1;plan:StudyRuntimeStepPlanV1;value:unknown;value_digest:string}){
 validatePlan(args.lease,args.plan);if(digest(args.value)!==args.value_digest)fail('step_value_digest_invalid');return studyTransactionV1(args.database,async c=>{const p=await lockSignalStudyExecutionWithClientV1(c,args.lease),row=await readStep(c,args.lease,args.plan);if(!row)fail('step_unavailable');
  if(row.status==='committed')return row.value_digest===args.value_digest;
  if(BigInt((await c.query<{v:string}>('SELECT signal_study_exposure_v1($1)::text v',[p.id])).rows[0]!.v)>BigInt(p.cap_micro_usd))fail('parent_cap_exhausted');
  if(row.status!=='raw'||!row.raw_json||row.verification_status!=='verified')return false;
  const receipt=JSON.parse(row.raw_json)as StudyRuntimeReceiptV1,rawValue=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.from(receipt.body_base64,'base64')));
  if(digest(rawValue)!==args.value_digest||!(await c.query("SELECT 1 FROM engine_cost_events WHERE study_step_id=$1 AND call_state='settled'",[row.id])).rows.length)fail('settled_receipt_required');
  const validated=await validateSignalStudyCurrentStepWithClientV1(c,p.id,await readSignalStudySourceWithClientV1(c,p),{plan:args.plan,value:rawValue});if(!validated||validated.value_digest!==args.value_digest)fail('step_not_next');
  await c.query("SELECT set_config('noisia.study_commit_v1',$1,true)",[JSON.stringify({execution_id:p.id,execution_token:args.lease.execution_token,step_key:args.plan.key,value_digest:args.value_digest})]);
  await c.query("UPDATE signal_study_steps SET status='committed',value=$2::jsonb,value_digest=$3 WHERE id=$1",[row.id,JSON.stringify(rawValue),args.value_digest]);return true;});
}
export async function markSignalStudyUnknownV1(args:{database:StudyDatabaseV1;lease:StudyRuntimeLeaseV1;plan:StudyRuntimeStepPlanV1;code:string}){
 validatePlan(args.lease,args.plan);if(!/^study_[a-z_]{1,120}$/u.test(args.code))fail('error_code_invalid',422);await studyTransactionV1(args.database,async c=>{await recoveryLock(c,args.lease);const row=await readStep(c,args.lease,args.plan);if(!row||row.status==='committed')return;
  await c.query("UPDATE engine_cost_events SET call_state='outcome_unknown',metadata=metadata||jsonb_build_object('error_code',$2::text) WHERE study_step_id=$1 AND call_state IN('in_flight','response_persisted')",[row.id,args.code]);
  await c.query("UPDATE signal_study_steps SET status='unknown',error_code=$2 WHERE id=$1 AND status IN('sent','raw')",[row.id,args.code]);await c.query("UPDATE signal_study_executions SET status='outcome_unknown',error_code=$2 WHERE id=$1 AND status='running'",[args.lease.execution_id,args.code]);});
}
/** Lost acknowledgements are reconciled before a new runtime claim, including
 * when authority was revoked after the send. This function never plans a step,
 * admits money, invokes a provider or publishes an interpretation. */
export async function reconcileSignalStudyReceiptsV1(args:{database:StudyDatabaseV1;execution_id:string;storage:SignalStudyRawStorageV1}){
 const p=(await args.database.query<SignalStudyExecutionRecordV1>('SELECT * FROM signal_study_executions WHERE id=$1',[args.execution_id])).rows[0];if(!p?.source_digest)return;
 const lease:StudyRuntimeLeaseV1={execution_id:p.id,workspace_id:p.workspace_id,execution_token:p.execution_token??randomUUID(),source_digest:p.source_digest,configuration_digest:p.configuration_digest,human_revision_digest:p.human_revision_digest};
 await studyTransactionV1(args.database,async c=>{await recoveryLock(c,lease);await c.query("UPDATE engine_cost_events c SET call_state='definitely_not_sent',metadata=metadata||'{\"error_code\":\"study_stale_before_send\"}'::jsonb FROM signal_study_steps s,signal_study_executions p WHERE c.study_step_id=s.id AND s.execution_id=p.id AND p.id=$1 AND p.status IN('stale','failed','budget_exhausted') AND c.call_state='reserved' AND c.sent_at IS NULL AND NOT EXISTS(SELECT 1 FROM signal_study_receipts WHERE step_id=s.id)",[p.id]);});
 const rows=(await args.database.query<Step>(`SELECT s.*,r.raw_json,r.verification_status FROM signal_study_steps s JOIN signal_study_receipts r ON r.step_id=s.id JOIN engine_cost_events c ON c.study_step_id=s.id
  WHERE s.execution_id=$1 AND c.call_state<>'settled' ORDER BY s.created_at,s.id`,[p.id])).rows;
 for(const row of rows){const plan=mapped(row),{contract_version:_contract,...receipt}=JSON.parse(row.raw_json!)as StudyRuntimeReceiptV1&{contract_version:string};
  await persistSignalStudyReceiptV1({database:args.database,lease,plan,receipt,storage:args.storage});await settleSignalStudyStepV1({database:args.database,lease,plan});}
}

/** The stop is recompiled from the native frozen source and committed prefix.
 * Caller diagnostics never create authority, usage, an admission or a receipt. */
export async function recordSignalStudyFormatStopV1(args:{database:StudyDatabaseV1;lease:StudyRuntimeLeaseV1;stop:SignalStudyEditorialFormatStopV1}):Promise<void>{
 validateSignalStudyLeaseV1(args.lease);const stop_digest=digest(args.stop),stop_json=JSON.stringify(args.stop);if(Buffer.byteLength(stop_json)>8192)fail('format_stop_invalid',422);
 await studyTransactionV1(args.database,async c=>{
  const scope=(await c.query<SignalStudyExecutionRecordV1>('SELECT * FROM signal_study_executions WHERE id=$1 AND workspace_id=$2',[args.lease.execution_id,args.lease.workspace_id])).rows[0];
  if(!scope||scope.source_digest!==args.lease.source_digest||scope.configuration_digest!==args.lease.configuration_digest||scope.human_revision_digest!==args.lease.human_revision_digest)fail('execution_unavailable');
  const replayed=async()=>{const prior=(await c.query<{stop_digest:string;stop_json:unknown;recorded_by_token:string;source_digest:string}>('SELECT * FROM signal_study_format_stops WHERE execution_id=$1 AND workspace_id=$2',[scope.id,scope.workspace_id])).rows[0];
   if(!prior)return false;if(prior.stop_digest!==stop_digest||digest(prior.stop_json)!==stop_digest||prior.recorded_by_token!==args.lease.execution_token||prior.source_digest!==args.lease.source_digest)fail('format_stop_conflict');return true;};
  if(await replayed())return;
  let p:SignalStudyExecutionRecordV1;try{p=await lockSignalStudyExecutionWithClientV1(c,args.lease);}catch(error){
   // A concurrent identical recorder can commit while this transaction waits
   // for the native parent lock. Only its exact existing receipt is a replay.
   if(error instanceof Error&&/^study_(source_changed|lease_lost)$/u.test(error.message)&&await replayed())return;throw error;
  }
  const next=(await replaySignalStudyWithClientV1(c,p.id,await readSignalStudySourceWithClientV1(c,p))).operation;
  if(next.kind!=='format_stop'||digest(next.stop)!==stop_digest)fail('format_stop_not_derived');
  if(BigInt((await c.query<{v:string}>('SELECT signal_study_exposure_v1($1)::text v',[p.id])).rows[0]!.v)>BigInt(p.cap_micro_usd))fail('parent_cap_exhausted');
  await c.query("SELECT set_config('noisia.study_format_stop_v1',$1,true)",[JSON.stringify({execution_id:p.id,execution_token:args.lease.execution_token,stop_digest})]);
  await c.query(`INSERT INTO signal_study_format_stops(execution_id,workspace_id,actor_user_id,source_digest,compiler_version,stop_json,stop_digest,recorded_by_token)
   VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,[p.id,p.workspace_id,p.actor_user_id,p.source_digest,next.stop.compiler_version,stop_json,stop_digest,args.lease.execution_token]);
  await c.query("UPDATE signal_study_executions SET status='failed',error_code='study_editorial_format_stop',updated_at=clock_timestamp() WHERE id=$1",[p.id]);
 });
}

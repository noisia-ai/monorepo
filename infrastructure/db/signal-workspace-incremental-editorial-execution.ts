import {randomUUID,createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1 as sonnet,signalWorkspaceEmbeddingDigestV1 as digest,
 buildSignalWorkspaceInterpretationBatchV1,buildSignalWorkspaceInterpretationRepairBatchV1,validateSignalWorkspaceInterpretationResultV1,
 type SignalWorkspaceInterpretationBatchV1,type SignalWorkspaceInterpretationContextV1,type SignalWorkspaceInterpretationV1} from '@noisia/query-engine';
import {SignalWorkspaceEngineError,withSignalWorkspaceEngineTransactionV1 as tx,loadSignalWorkspaceEngineInputIdentityV1,type SignalWorkspaceEngineDatabaseV1,type SignalWorkspaceEngineAnalysisConfigV1} from './signal-workspace-engine';
import {loadSignalWorkspaceCapabilitiesStoreV1} from './signal-workspace-capabilities';
import {loadSignalTopicInheritedContextStoreV1} from './signal-topic-catalog';
import {loadSignalWorkspaceTopicInputSnapshotWithQueryableV1} from './signal-workspace-topic-computation';
import type {SignalWorkspaceIncrementalEditorialReceiptV1} from './signal-workspace-incremental-editorial';
import type {SignalWorkspaceIncrementalEditorialEvidenceV1,SignalWorkspaceIncrementalEditorialEvidenceUnitV1} from './signal-workspace-incremental-editorial';

export type SignalWorkspaceIncrementalEditorialExecutionScopeV1={database:SignalWorkspaceEngineDatabaseV1;workspace_id:string;actor_user_id:string;execution_id:string};
export type SignalWorkspaceIncrementalEditorialLeaseV1={execution_id:string;workspace_id:string;actor_user_id:string;execution_token:string;worker_job_id:string;input_digest:string;
 interpretation_admission:SignalWorkspaceIncrementalEditorialReceiptV1;config:SignalWorkspaceEngineAnalysisConfigV1;
 numeric_execution_id:string;numeric_checkpoint_digest:string;evidence_plan_artifact_id:string;evidence_digest:string;target_unit_digest:string;target_binding_digest:string;target_units:number};
export type SignalWorkspaceIncrementalEditorialStoredV1={storage_key:string;sha256:string;size_bytes:number;media_type:string};
export type SignalWorkspaceIncrementalEditorialRequestV1={index:number;batch_key:string;request_digest:string;unit_keys:string[];reserved_micro_usd:number;offset:number;size_bytes:number;sha256:string};
export type SignalWorkspaceIncrementalEditorialRequestPlanV1={contract_version:'workspace-incremental-editorial-batch-plan-v1';workspace_id:string;editorial_execution_id:string;numeric_execution_id:string;
 evidence_digest:string;target_unit_digest:string;target_binding_digest:string;context_digest:string;configuration_digest:string;units:number;batches:number;
 requests:SignalWorkspaceIncrementalEditorialRequestV1[];stream:{bytes:number;sha256:string};plan_digest:string};
export type SignalWorkspaceIncrementalEditorialCheckpointV1={artifact_id:string;artifact_key:string;stored:SignalWorkspaceIncrementalEditorialStoredV1;call_id:string;request_digest:string;unit_keys:string[];response_sha256:string};
type Scope=SignalWorkspaceIncrementalEditorialExecutionScopeV1;type Lease=SignalWorkspaceIncrementalEditorialLeaseV1;
type Snapshot={context_digest:string;catalog_input_digest:string;interpretation_configuration:typeof sonnet;budget_policy:{budget_timezone:string;daily_cap_micro_usd:number};numeric_execution_id:string;numeric_checkpoint_digest:string;evidence_plan_artifact_id:string;evidence_digest:string;target_unit_digest:string;target_binding_digest:string;target_units:number};
const fail=(suffix:string,status=409):never=>{throw new SignalWorkspaceEngineError(`workspace_incremental_editorial_${suffix}`,status);};
const hash=/^sha256:[0-9a-f]{64}$/u;const MAX=8*1024*1024;
const authority=(input:string,id:string)=>`sha256:${createHash('sha256').update(`${input}:${id}`).digest('hex')}`;
async function access(c:PoolClient,workspace_id:string,actor_user_id:string){if(!(await loadSignalWorkspaceCapabilitiesStoreV1({queryable:c,workspace_id,actor_user_id})).can_execute_topics)return fail('forbidden',403);}
async function locked(c:PoolClient,scope:{workspace_id:string;actor_user_id:string;execution_id:string},lease?:Lease,current=true){
 await access(c,scope.workspace_id,scope.actor_user_id);
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workspace-interpretation-budget:${scope.actor_user_id}`]);
 const row=(await c.query<{id:string;workspace_id:string;actor_user_id:string;status:string;input_digest:string;input_snapshot:Snapshot;execution_token:string|null;lease_live:boolean;worker_job_id:string|null;result_summary:Record<string,unknown>;current:boolean;receipt:SignalWorkspaceIncrementalEditorialReceiptV1}>(`SELECT *,result_summary->>'worker_job_id' worker_job_id,execution_expires_at>clock_timestamp() lease_live,workspace_incremental_editorial_execution_current_v1(id) current,workspace_interpretation_admission_receipt_v1(id) receipt FROM signal_topic_catalog_executions WHERE id=$1::uuid AND workspace_id=$2::uuid AND input_contract='workspace-incremental-editorial-v1' FOR UPDATE`,[scope.execution_id,scope.workspace_id])).rows[0];
 if(!row||row.actor_user_id!==scope.actor_user_id)return fail('not_found',404);
 if(lease&&(row.status!=='running'||!row.lease_live||row.execution_token!==lease.execution_token||row.worker_job_id!==lease.worker_job_id))return fail('lease_conflict');
 if(current){if(!row.current)return fail('source_stale');const identity=await loadSignalWorkspaceEngineInputIdentityV1({queryable:c,...scope,execution_id:row.id});
  if(identity.context_digest!==row.input_snapshot.context_digest||identity.catalog_digest!==row.input_snapshot.catalog_input_digest)return fail('source_stale');}
 return row;
}
function leaseView(row:Awaited<ReturnType<typeof locked>>):Lease{const s=row.input_snapshot;return{execution_id:row.id,workspace_id:row.workspace_id,actor_user_id:row.actor_user_id,execution_token:row.execution_token!,worker_job_id:row.worker_job_id!,input_digest:row.input_digest,
 interpretation_admission:{...row.receipt,admission_not_after:new Date(row.receipt.admission_not_after).toISOString()},config:{call_configuration:s.interpretation_configuration,budget_timezone:s.budget_policy.budget_timezone,daily_cap_micro_usd:s.budget_policy.daily_cap_micro_usd},
 numeric_execution_id:s.numeric_execution_id,numeric_checkpoint_digest:s.numeric_checkpoint_digest,evidence_plan_artifact_id:s.evidence_plan_artifact_id,evidence_digest:s.evidence_digest,target_unit_digest:s.target_unit_digest,target_binding_digest:s.target_binding_digest,target_units:s.target_units};}
/** Explicit server-only dispatch; admission itself remains inert until the consumer is installed. */
export async function enqueueSignalWorkspaceIncrementalEditorialV1(args:Scope){return tx(args.database,c=>enqueueSignalWorkspaceIncrementalEditorialWithClientV1(c,args));}
/** Compose admission and its durable dispatch without a commit between them. */
export async function enqueueSignalWorkspaceIncrementalEditorialWithClientV1(c:PoolClient,args:Scope){const run=await locked(c,args);
 const worker_job_id=`signal-workspace-incremental-editorial-${run.id}-1`;
 if(!['queued','running','ready'].includes(run.status))return fail('dispatch_unavailable');
 await c.query(`INSERT INTO signal_topic_classification_outbox(execution_id,workspace_id,worker_job_id,dispatch_kind) VALUES($1::uuid,$2::uuid,$3,'execution') ON CONFLICT(execution_id,dispatch_kind) DO NOTHING`,[run.id,args.workspace_id,worker_job_id]);return{execution_id:run.id,worker_job_id};}
export async function claimSignalWorkspaceIncrementalEditorialV1(args:{database:SignalWorkspaceEngineDatabaseV1;execution_id:string;worker_job_id:string}):Promise<Lease|{completed:true;execution_id:string;worker_job_id:string}>{return tx(args.database,async c=>{
 const scope=(await c.query<{workspace_id:string;actor_user_id:string}>(`SELECT workspace_id,actor_user_id FROM signal_topic_catalog_executions WHERE id=$1::uuid AND input_contract='workspace-incremental-editorial-v1'`,[args.execution_id])).rows[0];if(!scope)return fail('not_found',404);
 const run=await locked(c,{...scope,execution_id:args.execution_id},undefined,false);
 if(run.status==='ready'){if(run.worker_job_id!==args.worker_job_id||!(await c.query("SELECT 1 FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid AND worker_job_id=$2 AND dispatch_kind='execution' AND status='completed'",[run.id,args.worker_job_id])).rows[0])return fail('lease_conflict');return{completed:true as const,execution_id:run.id,worker_job_id:args.worker_job_id};}
 await locked(c,{...scope,execution_id:args.execution_id});
 const dispatch=(await c.query(`SELECT 1 FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid AND workspace_id=$2::uuid AND dispatch_kind='execution' AND worker_job_id=$3 AND status IN('dispatching','dispatched') FOR UPDATE`,[run.id,scope.workspace_id,args.worker_job_id])).rows[0];
 if(!dispatch||run.status==='failed'||run.status==='running'&&run.lease_live)return fail('lease_conflict');
 const token=randomUUID();await c.query(`UPDATE signal_topic_catalog_executions SET status='running',execution_token=$3::uuid,execution_expires_at=clock_timestamp()+interval '180 seconds',heartbeat_at=clock_timestamp(),started_at=COALESCE(started_at,clock_timestamp()),result_summary=result_summary||'{"phase":"editorial","analysis_complete":false}'::jsonb||jsonb_build_object('worker_job_id',$2::text) WHERE id=$1::uuid`,[run.id,args.worker_job_id,token]);
 return leaseView({...run,status:'running',worker_job_id:args.worker_job_id,execution_token:token});});}
export async function heartbeatSignalWorkspaceIncrementalEditorialV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:Lease}){return tx(args.database,async c=>{await locked(c,args.lease,args.lease,false);await c.query(`UPDATE signal_topic_catalog_executions SET heartbeat_at=clock_timestamp(),execution_expires_at=clock_timestamp()+interval '180 seconds' WHERE id=$1::uuid`,[args.lease.execution_id]);return{heartbeat:true};});}
export async function readSignalWorkspaceIncrementalEditorialContextV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:Lease}){return tx(args.database,async c=>{const run=await locked(c,args.lease,args.lease);
 const brand_os=await loadSignalTopicInheritedContextStoreV1({queryable:c,workspace_id:run.workspace_id,complete_context:true});
 const source=await loadSignalWorkspaceTopicInputSnapshotWithQueryableV1({queryable:c,workspace_id:run.workspace_id,actor_user_id:run.actor_user_id,allow_empty:true,input_interests_only:true});
 const context:SignalWorkspaceInterpretationContextV1={workspace_id:run.workspace_id,execution_id:run.id,context_digest:run.input_snapshot.context_digest,data:{brand_os,interests:source.input.topics.map(topic=>topic.definition)}};
 const plan=(await c.query<{content:SignalWorkspaceIncrementalEditorialStoredV1;metadata:{descriptor:Omit<SignalWorkspaceIncrementalEditorialEvidenceV1,'units'>}}>('SELECT content-\'contract_version\' content,metadata FROM analysis_artifacts WHERE id=$1::uuid',[run.input_snapshot.evidence_plan_artifact_id])).rows[0]!;
 return{context,evidence:{artifact_id:run.input_snapshot.evidence_plan_artifact_id,stored:plan.content,descriptor:plan.metadata.descriptor},lease:leaseView(run)};});}
function storedValid(stored:SignalWorkspaceIncrementalEditorialStoredV1,lease:Lease){if(!hash.test(stored.sha256)||!Number.isSafeInteger(stored.size_bytes)||stored.size_bytes<=0||stored.storage_key.includes('..')||!stored.storage_key.startsWith(`workspace-engine/${lease.workspace_id}/${lease.execution_id}/`)||!stored.media_type||stored.media_type.length>120)return fail('artifact_invalid',422);}
async function insertArtifact(c:PoolClient,lease:Lease,key:string,type:'engine_output'|'engine_proposals',stored:SignalWorkspaceIncrementalEditorialStoredV1,metadata:Record<string,unknown>){
 const old=(await c.query<{id:string;content:unknown;metadata:unknown}>('SELECT id,content,metadata FROM analysis_artifacts WHERE engine_execution_id=$1::uuid AND artifact_key=$2',[lease.execution_id,key])).rows[0];
 const content={contract_version:'workspace-engine-private-artifact-v1',...stored};if(old){if(digest(old.content)!==digest(content)||digest(old.metadata)!==digest(metadata))return fail('artifact_conflict');return{artifact_id:old.id,replayed:true};}
 const id=randomUUID(),seal=authority(lease.input_digest,lease.execution_id);await c.query(`INSERT INTO analysis_artifacts(id,workspace_id,engine_execution_id,artifact_key,artifact_type,title,content,metadata,workspace_artifact_kind,discovery_run_digest,workspace_authority_digest) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,'Incremental editorial evidence',$6::jsonb,$7::jsonb,'topic_discovery',$8,$8)`,[id,lease.workspace_id,lease.execution_id,key,type,JSON.stringify(content),JSON.stringify(metadata),seal]);return{artifact_id:id,replayed:false};
}
export async function persistSignalWorkspaceIncrementalEditorialRequestPlanV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:Lease;plan:SignalWorkspaceIncrementalEditorialRequestPlanV1;stored:SignalWorkspaceIncrementalEditorialStoredV1}){
 const {plan_digest,...body}=args.plan;storedValid(args.stored,args.lease);
 if(digest(body)!==plan_digest||Buffer.byteLength(JSON.stringify(args.plan))>MAX||args.plan.stream.sha256!==args.stored.sha256||args.plan.stream.bytes!==args.stored.size_bytes)return fail('request_plan_invalid',422);
 return tx(args.database,async c=>{const run=await locked(c,args.lease,args.lease);const {requests,...header}=args.plan;
 for(const request of requests)await insertArtifact(c,args.lease,`editorial-request-${request.index}`,'engine_output',args.stored,{contract_version:'workspace-incremental-editorial-request-v1',plan_digest,request});
 const result=await insertArtifact(c,args.lease,'editorial-request-plan.jsonl','engine_output',args.stored,{contract_version:'workspace-incremental-editorial-request-plan-v1',plan:header});
 const valid=(await c.query<{valid:boolean}>('SELECT workspace_incremental_editorial_request_plan_valid_v1($1::uuid) valid',[result.artifact_id])).rows[0]?.valid;if(!valid)return fail('request_plan_invalid');
 if(run.result_summary.request_plan_artifact_id&&run.result_summary.request_plan_artifact_id!==result.artifact_id)return fail('request_plan_conflict');
 await c.query(`UPDATE signal_topic_catalog_executions SET result_summary=result_summary||jsonb_build_object('request_plan_artifact_id',$2::text,'request_plan_digest',$3::text) WHERE id=$1::uuid`,[run.id,result.artifact_id,plan_digest]);return{...result,plan_digest};});}
export async function readSignalWorkspaceIncrementalEditorialRequestsV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:Lease;after_index?:number;limit?:number}){return tx(args.database,async c=>{await locked(c,args.lease,args.lease,false);
 return(await c.query<{artifact_id:string;request:SignalWorkspaceIncrementalEditorialRequestV1;stored:SignalWorkspaceIncrementalEditorialStoredV1}>(`SELECT id artifact_id,metadata->'request' request,content-'contract_version' stored FROM analysis_artifacts WHERE engine_execution_id=$1::uuid AND metadata->>'contract_version'='workspace-incremental-editorial-request-v1' AND (metadata->'request'->>'index')::int>$2 ORDER BY (metadata->'request'->>'index')::int LIMIT $3`,[args.lease.execution_id,args.after_index??-1,Math.max(1,Math.min(128,args.limit??128))])).rows;});}
export async function readSignalWorkspaceIncrementalEditorialCheckpointsV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:Lease;after_artifact_id?:string;limit?:number}){return tx(args.database,async c=>{await locked(c,args.lease,args.lease,false);return(await c.query<SignalWorkspaceIncrementalEditorialCheckpointV1>(`SELECT id artifact_id,artifact_key,content-'contract_version' stored,metadata->>'call_id' call_id,metadata->>'request_digest' request_digest,metadata->'unit_keys' unit_keys,metadata->>'response_sha256' response_sha256 FROM analysis_artifacts WHERE engine_execution_id=$1::uuid AND metadata->>'contract_version'='workspace-incremental-editorial-checkpoint-v1' AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT $3`,[args.lease.execution_id,args.after_artifact_id??null,Math.max(1,Math.min(128,args.limit??128))])).rows;});}
/** Rebuild the canonical request before sealing a repair; no receipt is normalized. */
export async function persistSignalWorkspaceIncrementalEditorialRepairV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:Lease;original:SignalWorkspaceInterpretationBatchV1;batch:SignalWorkspaceInterpretationBatchV1;stored:SignalWorkspaceIncrementalEditorialStoredV1}){
 const repair=args.batch.editorial_repair;if(!repair)return fail('repair_invalid',422);
 const rebuilt=buildSignalWorkspaceInterpretationRepairBatchV1(args.original,{source_call_id:repair.source_call_id,source_response_sha256:repair.source_response_sha256,diagnostic:'output_invalid'});
 if(digest(rebuilt)!==digest(args.batch))return fail('repair_invalid',422);storedValid(args.stored,args.lease);
 return tx(args.database,async c=>{await locked(c,args.lease,args.lease);return insertArtifact(c,args.lease,`editorial-repair-${repair.source_call_id}`,'engine_output',args.stored,{contract_version:'workspace-incremental-editorial-repair-request-v1',request_digest:args.batch.request_digest,unit_keys:args.batch.clusters.map(v=>v.cluster_id),reserved_micro_usd:args.batch.reserved_micro_usd,editorial_repair:repair});});}
export async function persistSignalWorkspaceIncrementalEditorialCheckpointV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:Lease;batch:SignalWorkspaceInterpretationBatchV1;interpretations:SignalWorkspaceInterpretationV1[];call_id:string;response_sha256:string;stored:SignalWorkspaceIncrementalEditorialStoredV1}){
 storedValid(args.stored,args.lease);const original=buildSignalWorkspaceInterpretationBatchV1(args.batch.context,args.batch.clusters,sonnet);
 const rebuilt=args.batch.editorial_repair?buildSignalWorkspaceInterpretationRepairBatchV1(original,{source_call_id:args.batch.editorial_repair.source_call_id,source_response_sha256:args.batch.editorial_repair.source_response_sha256,diagnostic:'output_invalid'}):original;
 if(digest(rebuilt)!==digest(args.batch)||args.batch.context.execution_id!==args.lease.execution_id||args.batch.context.workspace_id!==args.lease.workspace_id)return fail('checkpoint_invalid',422);
 const interpretations=validateSignalWorkspaceInterpretationResultV1(args.batch,{interpretations:args.interpretations});
 const body={contract_version:'workspace-incremental-editorial-result-v1',context:args.batch.context,clusters:args.batch.clusters,interpretations,...args.batch.editorial_repair?{editorial_repair:args.batch.editorial_repair}:{}};
 const bytes=JSON.stringify(body),sha256=`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
 if(sha256!==args.stored.sha256||Buffer.byteLength(bytes)!==args.stored.size_bytes)return fail('checkpoint_invalid',422);
 return tx(args.database,async c=>{await locked(c,args.lease,args.lease,false);return insertArtifact(c,args.lease,`editorial-checkpoint-${args.call_id}`,'engine_proposals',args.stored,{contract_version:'workspace-incremental-editorial-checkpoint-v1',numeric_execution_id:args.lease.numeric_execution_id,numeric_checkpoint_digest:args.lease.numeric_checkpoint_digest,evidence_digest:args.lease.evidence_digest,target_binding_digest:args.lease.target_binding_digest,call_id:args.call_id,response_sha256:args.response_sha256,request_digest:args.batch.request_digest,unit_keys:args.batch.clusters.map(v=>v.cluster_id)});});}
export async function finishSignalWorkspaceIncrementalEditorialV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:Lease}){return tx(args.database,async c=>{const run=await locked(c,args.lease,undefined,false);if(run.status==='ready'){if(run.worker_job_id!==args.lease.worker_job_id)return fail('lease_conflict');return{execution_id:run.id,ready:true,replayed:true};}await locked(c,args.lease,args.lease,false);
 if(!(await c.query<{valid:boolean}>('SELECT workspace_incremental_editorial_output_complete_v1($1::uuid) valid',[run.id])).rows[0]?.valid)return fail('checkpoint_incomplete');
 await c.query(`UPDATE signal_topic_catalog_executions SET status='ready',progress=100,completed_at=clock_timestamp(),execution_token=NULL,execution_expires_at=NULL,result_summary=result_summary||'{"phase":"editorial_complete","editorial_complete":true,"analysis_complete":false}'::jsonb WHERE id=$1::uuid`,[run.id]);
 await c.query("UPDATE signal_topic_classification_outbox SET status='completed',completed_at=clock_timestamp() WHERE execution_id=$1::uuid AND dispatch_kind='execution' AND worker_job_id=$2",[run.id,args.lease.worker_job_id]);return{execution_id:run.id,ready:true,replayed:false};});}
export async function failSignalWorkspaceIncrementalEditorialV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:Lease;error_code:string}){return tx(args.database,async c=>{await locked(c,args.lease,args.lease,false);const code=(/^workspace_(?:engine_interpretation|incremental_editorial)_[a-z_]{1,100}$/u.test(args.error_code)||['workspace_engine_storage_transport_failed','workspace_engine_storage_unavailable'].includes(args.error_code))?args.error_code:'workspace_incremental_editorial_worker_failed';await c.query(`UPDATE signal_topic_catalog_executions SET status='failed',error_code=$2,execution_token=NULL,execution_expires_at=NULL WHERE id=$1::uuid`,[args.lease.execution_id,code]);await c.query("UPDATE signal_topic_classification_outbox SET status='failed',error_code=$3 WHERE execution_id=$1::uuid AND dispatch_kind='execution' AND worker_job_id=$2",[args.lease.execution_id,args.lease.worker_job_id,code]);return{failed:true};});}

export async function readSignalWorkspaceIncrementalEditorialEvidenceUnitsV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:Lease;after_unit_key?:string;limit?:number}){return tx(args.database,async c=>{const run=await locked(c,args.lease,args.lease,false);return(await c.query<{unit:SignalWorkspaceIncrementalEditorialEvidenceUnitV1}>(`SELECT metadata->'unit' unit FROM analysis_artifacts WHERE metadata->>'contract_version'='workspace-incremental-editorial-plan-unit-v1' AND metadata->>'plan_artifact_id'=$1 AND workspace_id=$4::uuid AND ($2::text IS NULL OR metadata->'unit'->>'unit_key' COLLATE "C">$2) ORDER BY metadata->'unit'->>'unit_key' COLLATE "C" LIMIT $3`,[run.input_snapshot.evidence_plan_artifact_id,args.after_unit_key??null,Math.max(1,Math.min(128,args.limit??128)),run.workspace_id])).rows.map(row=>row.unit);});}
export async function readSignalWorkspaceIncrementalEditorialRequestPlanV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:Lease}){return tx(args.database,async c=>{await locked(c,args.lease,args.lease,false);return(await c.query<{artifact_id:string;plan:Omit<SignalWorkspaceIncrementalEditorialRequestPlanV1,'requests'>;stored:SignalWorkspaceIncrementalEditorialStoredV1}>(`SELECT id artifact_id,metadata->'plan' plan,content-'contract_version' stored FROM analysis_artifacts WHERE engine_execution_id=$1::uuid AND metadata->>'contract_version'='workspace-incremental-editorial-request-plan-v1'`,[args.lease.execution_id])).rows[0]??null;});}

/** Server recovery of a confirmed transport failure only; no permission is renewed. */
export async function requeueSignalWorkspaceIncrementalEditorialV1(args:Scope&{worker_job_id:string}){return tx(args.database,c=>requeueSignalWorkspaceIncrementalEditorialWithClientV1(c,args));}
export async function requeueSignalWorkspaceIncrementalEditorialWithClientV1(c:PoolClient,args:Scope&{worker_job_id:string}){const run=await locked(c,args);
 const dispatch=(await c.query<{worker_job_id:string}>("SELECT worker_job_id FROM signal_topic_classification_outbox WHERE execution_id=$1::uuid AND workspace_id=$2::uuid AND dispatch_kind='execution'",[run.id,args.workspace_id])).rows[0];
 if(!dispatch||dispatch.worker_job_id!==args.worker_job_id||run.worker_job_id!==null&&run.worker_job_id!==args.worker_job_id)return fail('lease_conflict');
 if(['queued','running','ready'].includes(run.status))return{execution_id:run.id,worker_job_id:args.worker_job_id,requeued:false};
 const row=await readSignalWorkspaceIncrementalEditorialRetryWithQueryableV1(c,run.id);
 if(!row.can_retry)return fail('retry_unavailable');
 await c.query(`UPDATE signal_topic_catalog_executions SET status='queued',error_code=NULL,completed_at=NULL,result_summary=result_summary||jsonb_build_object('delivery_retry_count',$2::int) WHERE id=$1::uuid`,[run.id,row.retry_count+1]);
 const changed=await c.query(`UPDATE signal_topic_classification_outbox SET status='pending',attempt_count=0,available_at=clock_timestamp(),completed_at=NULL,lease_token=NULL,lease_expires_at=NULL,error_code=NULL WHERE execution_id=$1::uuid AND dispatch_kind='execution' AND worker_job_id=$2`,[run.id,args.worker_job_id]);if(changed.rowCount!==1)return fail('dispatch_unavailable');
 return{execution_id:run.id,worker_job_id:args.worker_job_id,requeued:true};}

/** The UI and mutation share the existing 0149 recovery predicate. No rights are granted here. */
export async function readSignalWorkspaceIncrementalEditorialRetryWithQueryableV1(c:Pick<PoolClient,'query'>,execution_id:string){
 const row=(await c.query<{error_code:string|null;retry_count:number;unknown:boolean;persisted_response:boolean;confirmed_terminal:boolean}>(`SELECT error_code,
  COALESCE((result_summary->>'delivery_retry_count')::int,0) retry_count,
  EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=$1::uuid AND call_state IN('in_flight','outcome_unknown')) unknown,
  EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=$1::uuid AND call_state='response_persisted' AND response_storage_key IS NOT NULL AND COALESCE((metadata->>'response_complete')::boolean,true)) persisted_response,
  EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=$1::uuid AND call_state='terminal_confirmed' AND metadata ? 'provider_terminal_receipt'
   HAVING count(*)>0 AND NOT EXISTS(SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=$1::uuid AND call_state='terminal_confirmed' GROUP BY request_digest HAVING count(*)>1)) confirmed_terminal
  FROM signal_topic_catalog_executions WHERE id=$1::uuid`,[execution_id])).rows[0];
 if(!row)return fail('not_found',404);
 const can_retry=!row.unknown&&row.retry_count<8&&[
  'workspace_incremental_editorial_transport_unavailable','workspace_engine_storage_transport_failed','workspace_engine_storage_unavailable',
  'workspace_engine_interpretation_transport_terminal_confirmed','workspace_engine_interpretation_receipt_recovery_required',
 ].includes(row.error_code??'')
  &&(row.error_code!=='workspace_engine_interpretation_receipt_recovery_required'||row.persisted_response)
  &&(row.error_code!=='workspace_engine_interpretation_transport_terminal_confirmed'||row.confirmed_terminal);
 return{...row,can_retry};
}

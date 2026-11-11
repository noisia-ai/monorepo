import {loadMassLabelingProductCategoryContextV2} from "./signal-mass-labeling-product";
import {createHash,randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import {buildMassLabelingConsolidationRequestV1,recoverMassLabelingConsolidationResponseV1,parseMassLabelingConsolidationRecoveryDecisionV1,
 signalWorkspaceEmbeddingDigestV1 as digest,type MassLabelingConsolidationBatchV1,type MassLabelingConsolidationRecoveryDecisionV1} from "@noisia/query-engine";
import {withSignalWorkspaceEngineTransactionV1,withSignalWorkspaceEngineLeaseV1,assertSignalWorkspaceMassLabelingRecoveryReadyV1,
 type SignalWorkspaceEngineDatabaseV1,type SignalWorkspaceEngineLeaseV1} from "./signal-workspace-engine";
import {loadSignalWorkspaceCapabilitiesStoreV1} from "./signal-workspace-capabilities";
import {signalWorkspaceFeatureEnabledV1} from "./signal-workspace-features";
import {verifyMassLabelingSourceCheckpointsWithClientV1,type MassLabelingSourceCheckpointV1} from "./signal-mass-labeling-source";

export type SignalWorkspaceMassLabelingGlobalReceiptDecisionV1={decision_id:string;workspace_id:string;execution_id:string;call_id:string;
 request_digest:string;response_sha256:string;source_groups_digest:string;input_digest:string;fit_checkpoint_digest:string;decision_digest:string;
 decision:MassLabelingConsolidationRecoveryDecisionV1;created_by_user_id:string;created_at:string};
export type SignalWorkspaceMassLabelingOperatorReceiptRecoveryV1={contract_version:"workspace-mass-labeling-global-receipt-decision-v1";decision_id:string;decision_digest:string};
function fail(code="workspace_engine_global_receipt_decision_invalid"):never {throw new Error(code);}
const sha=(s:string)=>`sha256:${createHash("sha256").update(s).digest("hex")}`;
export const MASS_LABELING_GLOBAL_RECEIPT_DECISION_SELECT_V1=`SELECT id decision_id,workspace_id,execution_id,call_id,request_digest,response_sha256,source_groups_digest,
 input_digest,fit_checkpoint_digest,decision_digest,decision,created_by_user_id,created_at::text FROM signal_mass_labeling_global_receipt_decisions`;
type Scope={workspace_id:string;execution_id:string;actor_user_id:string};
async function authorize(client:Pick<PoolClient,"query">,scope:Scope,nativeV2=false){
 const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,workspace_id:scope.workspace_id,actor_user_id:scope.actor_user_id});
 const actor=(await client.query(`SELECT 1 FROM users WHERE id=$1 AND status='active' AND
  ($4::boolean AND EXISTS(SELECT 1 FROM signal_topic_catalog_executions e WHERE e.id=$2 AND e.workspace_id=$3
    AND e.actor_user_id=$1 AND signal_mass_labeling_product_engine_v2(e.workspace_id,e.input_contract,e.input_snapshot))
   OR NOT $4::boolean AND user_type='noisia_internal' AND primary_role IN('noisia_admin','admin','founder'))`,
  [scope.actor_user_id,scope.execution_id,scope.workspace_id,nativeV2])).rows[0];
 const run=(await client.query("SELECT 1 FROM signal_topic_catalog_executions WHERE id=$1 AND workspace_id=$2 AND actor_user_id=$3",[scope.execution_id,scope.workspace_id,scope.actor_user_id])).rows[0];
 if(!actor||!run||!caps.can_request_processing||!caps.can_edit_topics||!await signalWorkspaceFeatureEnabledV1({queryable:client,workspace_id:scope.workspace_id,feature:"mass_labeling"}))fail("workspace_engine_global_receipt_forbidden");
}
async function binding(client:Pick<PoolClient,"query">,scope:Scope&{call_id:string}){
 const row=(await client.query<{request_digest:string;response_sha256:string;response_size_bytes:string;source_groups_digest:string;call_configuration:unknown;usage:unknown;
  input_digest:string;fit_checkpoint_digest:string;status:string;result_summary:Record<string,unknown>}>(`SELECT call.request_digest,call.response_sha256,call.response_size_bytes::text,
  call.metadata#>>'{mass_labeling_stage,source_groups_digest}' source_groups_digest,call.call_configuration,call.metadata->'usage' usage,
  execution.input_digest,execution.result_summary#>>'{fit_checkpoint,checkpoint_digest}' fit_checkpoint_digest,execution.status,execution.result_summary
  FROM engine_cost_events call JOIN signal_topic_catalog_executions execution ON execution.id=call.catalog_execution_id AND execution.workspace_id=call.workspace_id
  WHERE call.id=$1 AND call.workspace_id=$2 AND call.catalog_execution_id=$3 AND call.actor_user_id=$4 AND execution.actor_user_id=$4
   AND call.workspace_contract='workspace-engine-interpretation-v1' AND call.call_state='settled' AND call.settled_micro_usd IS NOT NULL
   AND call.response_http_status=200 AND call.response_storage_key IS NOT NULL AND call.response_size_bytes>0
   AND COALESCE((call.metadata->>'response_complete')::boolean,true) AND NOT call.metadata ? 'editorial_repair'
   AND call.metadata#>>'{mass_labeling_stage,stage}'='global-consolidation-v1'
   AND call.call_configuration=workspace_engine_interpretation_configuration_v1(execution.id,call.metadata->>'interpretation_revision_digest')`,
  [scope.call_id,scope.workspace_id,scope.execution_id,scope.actor_user_id])).rows[0];
 if(!row)fail();return row;
}
function proof(row:Awaited<ReturnType<typeof binding>>,scope:Scope&{call_id:string},args:{batch:MassLabelingConsolidationBatchV1;raw_response:string;decision:unknown}){
 if(Buffer.byteLength(args.raw_response)>2*1024*1024||sha(args.raw_response)!==row.response_sha256||Buffer.byteLength(args.raw_response)!==Number(row.response_size_bytes))fail();
 const batch=buildMassLabelingConsolidationRequestV1({workspace_id:scope.workspace_id,source_engine_execution_id:scope.execution_id,source_groups:args.batch.source_groups,configuration:args.batch.configuration,category_context:args.batch.category_context});
 if(digest(batch)!==digest(args.batch)||batch.request_digest!==row.request_digest||batch.source_groups_digest!==row.source_groups_digest
  ||digest(batch.configuration)!==digest(row.call_configuration))fail();
 const decision=parseMassLabelingConsolidationRecoveryDecisionV1(args.decision);
 if(decision.call_id!==scope.call_id)fail();
 const parsed=recoverMassLabelingConsolidationResponseV1(batch,args.raw_response,decision);
 if(digest(parsed.usage)!==digest(row.usage))fail();
 return{...parsed,decision};
}
/** New evidence requires the failed current fit and every signed source packet.
 * Repeating the identical authenticated disposition is a read, including READY. */
export async function recordSignalWorkspaceMassLabelingGlobalReceiptDecisionV1(args:Scope&{database:SignalWorkspaceEngineDatabaseV1;call_id:string;
 request_digest:string;response_sha256:string;source_groups_digest:string;decision:unknown;batch:MassLabelingConsolidationBatchV1;raw_response:string;
 source_checkpoints:MassLabelingSourceCheckpointV1[]}):Promise<SignalWorkspaceMassLabelingGlobalReceiptDecisionV1&{replayed:boolean}>{
 await assertSignalWorkspaceMassLabelingRecoveryReadyV1(args);
 return withSignalWorkspaceEngineTransactionV1(args.database,async client=>{
  await authorize(client,args,parseMassLabelingConsolidationRecoveryDecisionV1(args.decision).contract_version==="workspace-mass-labeling-receipt-recovery-v2");await client.query("SELECT id FROM signal_topic_catalog_executions WHERE id=$1 AND workspace_id=$2 FOR UPDATE",[args.execution_id,args.workspace_id]);
  const row=await binding(client,args),decision=parseMassLabelingConsolidationRecoveryDecisionV1(args.decision),decisionDigest=digest(decision);
  if(args.request_digest!==row.request_digest||args.response_sha256!==row.response_sha256||args.source_groups_digest!==row.source_groups_digest
    ||decision.call_id!==args.call_id||decision.request_digest!==row.request_digest||decision.response_sha256!==row.response_sha256
    ||decision.source_groups_digest!==row.source_groups_digest||decision.workspace_id!==args.workspace_id||decision.execution_id!==args.execution_id)fail();
  const prior=(await client.query<SignalWorkspaceMassLabelingGlobalReceiptDecisionV1>(`${MASS_LABELING_GLOBAL_RECEIPT_DECISION_SELECT_V1} WHERE execution_id=$1 AND workspace_id=$2`,[args.execution_id,args.workspace_id])).rows[0];
  if(prior){if(prior.call_id!==args.call_id||prior.decision_digest!==decisionDigest||prior.created_by_user_id!==args.actor_user_id
    ||sha(args.raw_response)!==prior.response_sha256||row.input_digest!==prior.input_digest||row.fit_checkpoint_digest!==prior.fit_checkpoint_digest)fail();return{...prior,replayed:true};}
  if(row.status!=="failed"||row.result_summary.analysis_checkpoint)fail();
  proof(row,args,{...args,decision});
  const sources=await verifyMassLabelingSourceCheckpointsWithClientV1(client,{workspace_id:args.workspace_id,actor_user_id:args.actor_user_id,
   source_engine_execution_id:args.execution_id,source_checkpoints:args.source_checkpoints,expected_group_ids:args.batch.source_groups.map(group=>group.group_id),
   claimed_source_groups:args.batch.source_groups,failed_receipt_recovery:{call_id:args.call_id,request_digest:row.request_digest,response_sha256:row.response_sha256}});
  if(sources.source_groups_digest!==row.source_groups_digest)fail();
  const id=randomUUID();await client.query(`INSERT INTO signal_mass_labeling_global_receipt_decisions(id,workspace_id,execution_id,call_id,request_digest,response_sha256,source_groups_digest,
   input_digest,fit_checkpoint_digest,decision_digest,decision,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`,
   [id,args.workspace_id,args.execution_id,args.call_id,row.request_digest,row.response_sha256,row.source_groups_digest,row.input_digest,row.fit_checkpoint_digest,decisionDigest,JSON.stringify(decision),args.actor_user_id]);
  return{...(await client.query<SignalWorkspaceMassLabelingGlobalReceiptDecisionV1>(`${MASS_LABELING_GLOBAL_RECEIPT_DECISION_SELECT_V1} WHERE id=$1`,[id])).rows[0]!,replayed:false};
 });
}
export async function readSignalWorkspaceMassLabelingGlobalReceiptDecisionV1(args:{database:SignalWorkspaceEngineDatabaseV1;call_id?:string}&(
 {lease:SignalWorkspaceEngineLeaseV1}|Scope)):Promise<SignalWorkspaceMassLabelingGlobalReceiptDecisionV1|null>{
 const read=async(client:Pick<PoolClient,"query">,scope:Scope)=>{
  const sealed=(await client.query<SignalWorkspaceMassLabelingGlobalReceiptDecisionV1>(`${MASS_LABELING_GLOBAL_RECEIPT_DECISION_SELECT_V1}
   WHERE workspace_id=$1 AND execution_id=$2 AND created_by_user_id=$3 AND ($4::uuid IS NULL OR call_id=$4::uuid)`,[scope.workspace_id,scope.execution_id,scope.actor_user_id,args.call_id??null])).rows[0];
  await authorize(client,scope,sealed?.decision.contract_version==="workspace-mass-labeling-receipt-recovery-v2");
  return(await client.query<SignalWorkspaceMassLabelingGlobalReceiptDecisionV1>(`${MASS_LABELING_GLOBAL_RECEIPT_DECISION_SELECT_V1}
   WHERE workspace_id=$1 AND execution_id=$2 AND created_by_user_id=$3 AND ($4::uuid IS NULL OR call_id=$4::uuid)`,[scope.workspace_id,scope.execution_id,scope.actor_user_id,args.call_id??null])).rows[0]??null;
 };
 if("lease"in args)return withSignalWorkspaceEngineLeaseV1({...args,full:true},async(client,run)=>read(client,{workspace_id:run.workspace_id,execution_id:run.id,actor_user_id:run.actor_user_id}));
 return withSignalWorkspaceEngineTransactionV1(args.database,client=>read(client,args));
}
/** Adoption replays only the stored, authenticated rule against the original raw.
 * The caller verifies source checkpoints independently and owns authorization. */
export async function verifySignalWorkspaceMassLabelingGlobalReceiptRecoveryWithClientV1(client:Pick<PoolClient,"query">,args:Scope&{call_id:string;decision_id:string;
 decision_digest:string;batch:MassLabelingConsolidationBatchV1;raw_response:string}){
 const row=await binding(client,args);
 const decision=(await client.query<SignalWorkspaceMassLabelingGlobalReceiptDecisionV1>(`${MASS_LABELING_GLOBAL_RECEIPT_DECISION_SELECT_V1}
  WHERE id=$1 AND workspace_id=$2 AND execution_id=$3 AND call_id=$4 AND created_by_user_id=$5`,[args.decision_id,args.workspace_id,args.execution_id,args.call_id,args.actor_user_id])).rows[0];
 if(!decision||decision.decision_digest!==args.decision_digest||decision.decision_digest!==digest(decision.decision)
  ||decision.request_digest!==row.request_digest||decision.response_sha256!==row.response_sha256||decision.source_groups_digest!==row.source_groups_digest
  ||decision.input_digest!==row.input_digest||decision.fit_checkpoint_digest!==row.fit_checkpoint_digest
  ||row.result_summary.global_receipt_recovery_decision_id!==decision.decision_id)fail();
 await authorize(client,args,decision.decision.contract_version==="workspace-mass-labeling-receipt-recovery-v2");
 return proof(row,args,{batch:args.batch,raw_response:args.raw_response,decision:decision.decision});
}

/** Scope and lineage for the native resume control. Storage is read by Studio;
 * only signed checkpoint bodies and the exact settled raw may form a decision. */
export async function loadSignalWorkspaceMassLabelingGlobalReplaySourceV2(args:Scope&{database:SignalWorkspaceEngineDatabaseV1}) {
 const source=await withSignalWorkspaceEngineTransactionV1(args.database,async client=>{
  await authorize(client,args,true);
  const run=(await client.query<{input_digest:string;fit_checkpoint_digest:string}>(`SELECT e.input_digest,
   e.result_summary#>>'{fit_checkpoint,checkpoint_digest}' fit_checkpoint_digest FROM signal_topic_catalog_executions e
   JOIN signal_corpus_preparation_input_state state ON state.workspace_id=e.workspace_id AND state.input_revision=e.input_revision
   CROSS JOIN LATERAL signal_workspace_engine_interpretation_coverage_v1(e.id) coverage
   WHERE e.id=$1 AND e.workspace_id=$2 AND e.actor_user_id=$3 AND e.status='failed'
    AND e.error_code='workspace_engine_worker_failed' AND signal_mass_labeling_product_engine_v2(e.workspace_id,e.input_contract,e.input_snapshot)
    AND NOT e.result_summary ? 'analysis_checkpoint' AND (e.policy_valid_until IS NULL OR e.policy_valid_until>clock_timestamp())
    AND coverage.unit_count=coverage.unique_count AND coverage.unit_count>0
    AND coverage.unit_count=(e.result_summary#>>'{fit_checkpoint,interpretation_manifest,unit_count}')::bigint
    AND coverage.unit_digest=e.result_summary#>>'{fit_checkpoint,interpretation_manifest,unit_digest}'
    AND NOT EXISTS(SELECT 1 FROM engine_cost_events pending WHERE pending.catalog_execution_id=e.id
     AND pending.workspace_contract='workspace-engine-interpretation-v1'
     AND (pending.call_state IN('reserved','in_flight','response_persisted','outcome_unknown')
      OR pending.call_state='terminal_confirmed' AND NOT pending.metadata ? 'provider_terminal_billing_reconciliation'))`,
   [args.execution_id,args.workspace_id,args.actor_user_id])).rows[0];
  if(!run)fail();
  const calls=(await client.query<{call_id:string;request_digest:string;response_sha256:string;source_groups_digest:string;
   configuration:MassLabelingConsolidationBatchV1['configuration'];response:{storage_key:string;sha256:string;size_bytes:number;media_type:string}}>(`SELECT id call_id,request_digest,response_sha256,
    metadata#>>'{mass_labeling_stage,source_groups_digest}' source_groups_digest,call_configuration configuration,
    jsonb_build_object('storage_key',response_storage_key,'sha256',response_sha256,'size_bytes',response_size_bytes,'media_type','application/json') response
    FROM engine_cost_events WHERE catalog_execution_id=$1 AND workspace_id=$2 AND actor_user_id=$3
     AND workspace_contract='workspace-engine-interpretation-v1' AND metadata#>>'{mass_labeling_stage,stage}'='global-consolidation-v1'
     AND response_storage_key IS NOT NULL AND call_state='settled' AND response_http_status=200
     AND response_size_bytes>0 AND COALESCE((metadata->>'response_complete')::boolean,true)
     AND settled_micro_usd IS NOT NULL AND NOT metadata ? 'editorial_repair'`,[args.execution_id,args.workspace_id,args.actor_user_id])).rows;
  if(calls.length!==1)fail();
  const call=calls[0]!;await binding(client,{...args,call_id:call.call_id});
  const checkpoints=(await client.query<{artifact_id:string;content:{storage_key:string;sha256:string;size_bytes:number;media_type:string};metadata:Record<string,unknown>}>(`SELECT id artifact_id,content,metadata FROM analysis_artifacts
   WHERE workspace_id=$1 AND engine_execution_id=$2 AND artifact_type='engine_proposals'
    AND metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1' ORDER BY id`,[args.workspace_id,args.execution_id])).rows;
  if(!checkpoints.length)fail();
  return{workspace_id:args.workspace_id,execution_id:args.execution_id,actor_user_id:args.actor_user_id,...run,...call,source_checkpoints:checkpoints};
 });
 const category_context=await loadMassLabelingProductCategoryContextV2(args);
 return{...source,category_context};
}

/** The queue uses this sealed binding to select receipt-only replay. Reading it
 * never creates authority or changes a monetary row. */
export async function readSignalWorkspaceMassLabelingNativeReplayV2(args:{database:SignalWorkspaceEngineDatabaseV1;execution_id:string}) {
 return withSignalWorkspaceEngineTransactionV1(args.database,async client=>{
  const row=(await client.query<{workspace_id:string;actor_user_id:string;decision_id:string;decision_digest:string;decision:MassLabelingConsolidationRecoveryDecisionV1}>(`SELECT e.workspace_id,e.actor_user_id,d.id decision_id,d.decision_digest,d.decision
   FROM signal_topic_catalog_executions e JOIN signal_mass_labeling_global_receipt_decisions d
    ON d.execution_id=e.id AND d.workspace_id=e.workspace_id AND d.created_by_user_id=e.actor_user_id
    AND d.id::text=e.result_summary->>'global_receipt_recovery_decision_id'
   WHERE e.id=$1 AND signal_mass_labeling_product_engine_v2(e.workspace_id,e.input_contract,e.input_snapshot)
    AND d.decision->>'contract_version'='workspace-mass-labeling-receipt-recovery-v2'
    AND d.input_digest=e.input_digest AND d.fit_checkpoint_digest=e.result_summary#>>'{fit_checkpoint,checkpoint_digest}'`,[args.execution_id])).rows[0];
  if(!row)return null;
  if(digest(parseMassLabelingConsolidationRecoveryDecisionV1(row.decision))!==row.decision_digest)fail();
  await authorize(client,{...row,execution_id:args.execution_id},true);
  await binding(client,{...row,execution_id:args.execution_id,call_id:row.decision.call_id});
  return{decision_id:row.decision_id,decision_digest:row.decision_digest};
 });
}

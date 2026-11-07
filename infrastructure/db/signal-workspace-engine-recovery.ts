import type {PoolClient} from "pg";
import {buildSignalWorkspaceInterpretationBatchV1,parseSignalWorkspaceInterpretationConfigurationV1,
  signalWorkspaceEmbeddingDigestV1 as digest,type SignalWorkspaceInterpretationBatchV1} from "@noisia/query-engine";
import {withSignalWorkspaceEngineLeaseV1,type SignalWorkspaceEngineDatabaseV1,type SignalWorkspaceEngineLeaseV1} from "./signal-workspace-engine";

const fail=(code:string):never=>{throw new Error(code);};
export const isMassLabelingRecoveryProfileV1=(profile:unknown)=>["workspace-bertopic-mass-labeling-v1","workspace-bertopic-mass-labeling-v2","workspace-bertopic-mass-labeling-v3"].includes(String(profile));
type Run={id:string;workspace_id:string;actor_user_id:string;input_digest:string;result_summary:Record<string,unknown>;input_snapshot:{context_digest:string;engine_config:Record<string,unknown>}};
function keysFor(keys:string[]){const sorted=[...keys].sort();
  if(!sorted.length||sorted.length>128||new Set(sorted).size!==sorted.length||sorted.some(key=>!/^[A-Za-z0-9:._-]{1,200}$/u.test(key)))fail("workspace_engine_interpretation_units_invalid");return sorted;}
/** This helper never creates a call. A historical request must be reconstructed
 * exactly before its individual units can fence subsequent paid requests. */
export async function registerSignalWorkspaceEngineInterpretationUnitsV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;
  call_id:string;request_digest:string;unit_keys:string[];batch:SignalWorkspaceInterpretationBatchV1}):Promise<{replayed:boolean}>{
 return withSignalWorkspaceEngineLeaseV1({...args,full:true},async(client,run)=>{
  const call=(await client.query<{request_digest:string;call_configuration:unknown}>(`SELECT request_digest,call_configuration FROM engine_cost_events
   WHERE id=$1 AND workspace_id=$2 AND catalog_execution_id=$3 AND actor_user_id=$4
    AND workspace_contract='workspace-engine-interpretation-v1' AND NOT metadata ? 'editorial_repair' AND NOT metadata ? 'mass_labeling_stage'`,
   [args.call_id,run.workspace_id,run.id,run.actor_user_id])).rows[0];
  const batch=buildSignalWorkspaceInterpretationBatchV1(args.batch.context,args.batch.clusters,parseSignalWorkspaceInterpretationConfigurationV1(call?.call_configuration));
  if(!call||batch.request_digest!==call.request_digest||args.request_digest!==call.request_digest
    ||args.batch.context.workspace_id!==run.workspace_id||args.batch.context.execution_id!==run.id
    ||args.batch.context.context_digest!==run.input_snapshot.context_digest||digest(keysFor(args.unit_keys))!==digest(batch.clusters.map(c=>c.cluster_id).sort()))
    return fail("workspace_engine_interpretation_unit_claim_invalid");
  return registerSignalWorkspaceEngineInterpretationUnitsWithClientV1(client,run,{call_id:args.call_id,request_digest:args.request_digest,unit_keys:args.unit_keys});
 });
}
/** Reservation and receipt backfill use the same transaction and execution lock. */
export async function registerSignalWorkspaceEngineInterpretationUnitsWithClientV1(client:Pick<PoolClient,"query">,run:Run,args:{call_id:string;request_digest:string;unit_keys:string[]}):Promise<{replayed:boolean}>{
 const keys=keysFor(args.unit_keys),fit=run.result_summary.fit_checkpoint as {checkpoint_digest:string}|undefined;
 if(!isMassLabelingRecoveryProfileV1(run.input_snapshot.engine_config.profile_version)||!fit)fail("workspace_engine_interpretation_unit_claim_invalid");
 const existing=(await client.query<{unit_key:string;original_request_digest:string}>(`SELECT unit_key,original_request_digest FROM signal_workspace_interpretation_unit_claims
  WHERE execution_id=$1 AND (unit_key=ANY($2::text[]) OR original_request_digest=$3)`,[run.id,keys,args.request_digest])).rows;
 if(existing.length){
  if(existing.length!==keys.length||existing.some(row=>row.original_request_digest!==args.request_digest||!keys.includes(row.unit_key)))fail("workspace_engine_interpretation_unit_already_sent");
  return{replayed:true};
 }
 await client.query(`INSERT INTO signal_workspace_interpretation_unit_claims(workspace_id,execution_id,unit_key,original_call_id,original_request_digest,input_digest,fit_checkpoint_digest,created_by_user_id)
  SELECT $1::uuid,$2::uuid,key,$3::uuid,$4,$5,$6,$7::uuid FROM unnest($8::text[]) unit(key)`,
 [run.workspace_id,run.id,args.call_id,args.request_digest,run.input_digest,fit!.checkpoint_digest,run.actor_user_id,keys]);
 return{replayed:false};
}
/** Future calls cannot skip unaccounted paid originals. The sole repair lane may
 * consume a reviewed invalid original, under the pre-existing repair authority. */
export async function assertSignalWorkspaceEngineInterpretationReceiptsRecoveredV1(client:Pick<PoolClient,"query">,executionId:string,allowNeedsRepair=false,excludeCallId:string|null=null){
 if((await client.query(`SELECT 1 FROM engine_cost_events WHERE catalog_execution_id=$1
  AND workspace_contract='workspace-engine-interpretation-v1' AND (call_state IN('in_flight','outcome_unknown')
   OR call_state='response_persisted' AND NOT COALESCE((metadata->>'response_complete')::boolean,true)) LIMIT 1`,[executionId])).rows.length)
  fail("workspace_engine_interpretation_outcome_unknown");
 const blocked=(await client.query(`SELECT call.id FROM engine_cost_events call
  WHERE call.catalog_execution_id=$1 AND call.workspace_contract='workspace-engine-interpretation-v1'
   AND NOT call.metadata ? 'editorial_repair' AND NOT call.metadata ? 'mass_labeling_stage'
   AND ($3::uuid IS NULL OR call.id<>$3::uuid)
   AND call.call_state<>'definitely_not_sent'
   AND (NOT EXISTS(SELECT 1 FROM signal_workspace_interpretation_unit_claims claim WHERE claim.execution_id=$1 AND claim.original_request_digest=call.request_digest)
    OR NOT EXISTS(SELECT 1 FROM analysis_artifacts artifact LEFT JOIN engine_cost_events repair
       ON repair.id::text=artifact.metadata->>'call_id' AND repair.metadata#>>'{editorial_repair,source_call_id}'=call.id::text
      WHERE artifact.workspace_id=call.workspace_id AND artifact.engine_execution_id=$1
       AND artifact.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1'
       AND (artifact.metadata->>'call_id'=call.id::text OR repair.id IS NOT NULL))
      AND NOT($2::boolean AND EXISTS(SELECT 1 FROM signal_workspace_interpretation_receipt_reviews review WHERE review.call_id=call.id AND review.response_sha256=call.response_sha256)))
  LIMIT 1`,[executionId,allowNeedsRepair,excludeCallId])).rows[0];
 if(blocked)fail("workspace_engine_interpretation_receipt_recovery_required");
}
export async function recordSignalWorkspaceEngineInterpretationRecoveryReviewV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;
 call_id:string;request_digest:string;response_sha256:string;unit_keys:string[];outcome:"needs_repair";validator_version:string}):Promise<{replayed:boolean}>{
 return withSignalWorkspaceEngineLeaseV1({...args,full:true},async(client,run)=>{
  const keys=keysFor(args.unit_keys);
  const prior=(await client.query<{request_digest:string;response_sha256:string;unit_manifest:string[];validator_version:string}>("SELECT request_digest,response_sha256,unit_manifest,validator_version FROM signal_workspace_interpretation_receipt_reviews WHERE call_id=$1",[args.call_id])).rows[0];
  if(prior){if(prior.request_digest!==args.request_digest||prior.response_sha256!==args.response_sha256||digest(prior.unit_manifest)!==digest(keys)||prior.validator_version!==args.validator_version)fail("workspace_engine_interpretation_recovery_review_conflict");return{replayed:true};}
  await client.query(`INSERT INTO signal_workspace_interpretation_receipt_reviews(call_id,workspace_id,execution_id,response_sha256,request_digest,unit_manifest,outcome,validator_version,input_digest,fit_checkpoint_digest,created_by_user_id)
   VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11)`,[args.call_id,run.workspace_id,run.id,args.response_sha256,args.request_digest,JSON.stringify(keys),args.outcome,args.validator_version,run.input_digest,
    (run.result_summary.fit_checkpoint as {checkpoint_digest:string}).checkpoint_digest,run.actor_user_id]);
  return{replayed:false};
 });
}
export async function pauseSignalWorkspaceEngineInterpretationRecoveryV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1;
 reason:"bounded_repair_pending"|"unprocessed_units_pending"}):Promise<{execution_id:string;status:"failed";recovery_status:typeof args.reason;recovered_units:number;pending_units:number}>{
 return withSignalWorkspaceEngineLeaseV1({...args,full:true},async(client,run)=>{
  if(!isMassLabelingRecoveryProfileV1(run.input_snapshot.engine_config.profile_version))fail("workspace_engine_interpretation_recovery_invalid");
  const expected=Number((run.result_summary.fit_checkpoint as {interpretation_manifest:{unit_count:number}}).interpretation_manifest.unit_count);
  const count=(await client.query<{n:number}>(`SELECT count(DISTINCT unit.key)::int n FROM analysis_artifacts artifact
   CROSS JOIN LATERAL jsonb_array_elements_text(artifact.metadata->'unit_keys') unit(key)
   WHERE artifact.engine_execution_id=$1 AND artifact.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1'`,[run.id])).rows[0]!.n;
  const result={execution_id:run.id,status:"failed" as const,recovery_status:args.reason,recovered_units:count,pending_units:expected-count};
  await client.query(`UPDATE signal_topic_catalog_executions SET status='failed',error_code='workspace_engine_interpretation_output_invalid',
   execution_token=NULL,execution_expires_at=NULL,completed_at=clock_timestamp(),updated_at=clock_timestamp(),
   result_summary=result_summary||jsonb_build_object('phase','failed','interpretation_receipt_recovery',$2::jsonb)
   WHERE id=$1`,[run.id,JSON.stringify(result)]);
  await client.query(`UPDATE signal_topic_classification_outbox SET status='completed',completed_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
   WHERE execution_id=$1 AND dispatch_kind='execution'`,[run.id]);
  return result;
 });
}

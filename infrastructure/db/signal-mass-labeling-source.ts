import {createHash} from "node:crypto";
import type {PoolClient} from "pg";
import {
  buildSignalWorkspaceInterpretationBatchV1,buildSignalWorkspaceInterpretationRepairBatchV1,
  parseSignalWorkspaceInterpretationConfigurationV1,parseSignalWorkspaceInterpretationEditorialRepairV1,
  validateSignalWorkspaceInterpretationResultV1,signalWorkspaceInterpretationUniverseDigestV1,
  signalWorkspaceEmbeddingDigestV1 as digest,
  type MassLabelingSourceGroupV1,type SignalWorkspaceInterpretationContextV1,
  type SignalWorkspaceInterpretationClusterV1,
} from "@noisia/query-engine";
import type {LabelingDatabaseV1} from "./signal-mention-facets";
import type {SignalWorkspaceEngineLeaseV1} from "./signal-workspace-engine";
import {loadSignalWorkspaceCapabilitiesStoreV1} from "./signal-workspace-capabilities";
import {signalWorkspaceFeatureEnabledV1} from "./signal-workspace-features";
import {SignalLabelingError} from "./signal-labeling-runs";

export type MassLabelingSourceCheckpointV1={artifact_id:string;body:string};
type SourceArgs={
  workspace_id:string;actor_user_id:string;source_engine_execution_id:string;
  source_checkpoints:MassLabelingSourceCheckpointV1[];expected_group_ids:string[];
  expected_cluster_digests?:Record<string,string>;lease?:SignalWorkspaceEngineLeaseV1;
  claimed_source_groups?:MassLabelingSourceGroupV1[];
};
function fail():never {throw new SignalLabelingError("mass_labeling_source_checkpoint_invalid");}
const sha=(text:string)=>`sha256:${createHash("sha256").update(text).digest("hex")}`;

/** Validate the complete editorial input before requesting the global paid stage. */
export async function verifyMassLabelingSourceCheckpointsV1(args:SourceArgs&{database:LabelingDatabaseV1}) {
  const client=await args.database.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,workspace_id:args.workspace_id,
      actor_user_id:args.actor_user_id});
    if(!caps.can_request_processing||!caps.can_edit_topics||!await signalWorkspaceFeatureEnabledV1({
      queryable:client,workspace_id:args.workspace_id,feature:"mass_labeling"}))
      throw new SignalLabelingError("mass_labeling_forbidden",403);
    const result=await verifyMassLabelingSourceCheckpointsWithClientV1(client,args);
    await client.query("COMMIT");return result;
  } catch(error) {await client.query("ROLLBACK");throw error;}
  finally {client.release();}
}

/** The adoption caller already holds workspace authorization and its transaction. */
export async function verifyMassLabelingSourceCheckpointsWithClientV1(client:Pick<PoolClient,"query">,args:SourceArgs) {
  const keys=[...args.expected_group_ids].sort();
  if(!keys.length||keys.length>200||new Set(keys).size!==keys.length||!args.source_checkpoints.length
    ||new Set(args.source_checkpoints.map(packet=>packet.artifact_id)).size!==args.source_checkpoints.length)fail();
  const engine=(await client.query<{status:string;actor_user_id:string;context_digest:string;
    fit:{checkpoint_digest:string;interpretation_manifest:{unit_count:number;unit_digest:string}};
    execution_token:string|null;lease_live:boolean}>(`SELECT execution.status,execution.actor_user_id,
      execution.input_snapshot->>'context_digest' context_digest,execution.result_summary->'fit_checkpoint' fit,
      execution.execution_token,execution.execution_expires_at>clock_timestamp() lease_live
      FROM signal_topic_catalog_executions execution
      JOIN signal_corpus_preparation_input_state state ON state.workspace_id=execution.workspace_id AND state.input_revision=execution.input_revision
      JOIN signal_corpus_preparation_runs prep ON prep.workspace_id=execution.workspace_id AND prep.id=execution.preparation_run_id
        AND prep.status='completed' AND (prep.policy_valid_until IS NULL OR prep.policy_valid_until>now())
      WHERE execution.workspace_id=$1 AND execution.id=$2
        AND execution.input_snapshot#>>'{engine_config,profile_version}' IN ('workspace-bertopic-mass-labeling-v1','workspace-bertopic-mass-labeling-v2')`,
    [args.workspace_id,args.source_engine_execution_id])).rows[0];
  if(!engine||engine.actor_user_id!==args.actor_user_id||!engine.fit
    ||Number(engine.fit.interpretation_manifest.unit_count)!==keys.length
    ||engine.fit.interpretation_manifest.unit_digest!==signalWorkspaceInterpretationUniverseDigestV1(keys))fail();
  if(engine.status!=="ready"&&(engine.status!=="running"||!args.lease||!engine.lease_live
    ||args.lease.workspace_id!==args.workspace_id||args.lease.execution_id!==args.source_engine_execution_id
    ||args.lease.execution_token!==engine.execution_token))fail();
  const receipts=(await client.query<{id:string;content:{sha256:string;size_bytes:number};metadata:{
    unit_keys:string[];fit_checkpoint_digest:string;execution_id:string};request_digest:string;call_configuration:unknown}>(
    `SELECT artifact.id,artifact.content,artifact.metadata,call.request_digest,call.call_configuration
     FROM analysis_artifacts artifact JOIN engine_cost_events call ON call.id::text=artifact.metadata->>'call_id'
       AND call.workspace_id=artifact.workspace_id AND call.catalog_execution_id=artifact.engine_execution_id
       AND call.workspace_contract='workspace-engine-interpretation-v1' AND call.call_state='settled'
       AND call.response_sha256=artifact.metadata->>'response_sha256' AND call.actor_user_id=$3
       AND call.response_http_status=200
       AND call.call_configuration=workspace_engine_interpretation_configuration_v1(artifact.engine_execution_id,call.metadata->>'interpretation_revision_digest')
     WHERE artifact.workspace_id=$1 AND artifact.engine_execution_id=$2 AND artifact.id=ANY($4::uuid[])
       AND artifact.artifact_type='engine_proposals'
       AND artifact.metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1'`,
    [args.workspace_id,args.source_engine_execution_id,args.actor_user_id,args.source_checkpoints.map(packet=>packet.artifact_id)])).rows;
  if(receipts.length!==args.source_checkpoints.length)fail();
  const found=new Set<string>(),source_groups:MassLabelingSourceGroupV1[]=[];
  for(const checkpoint of args.source_checkpoints) {
    const receipt=receipts.find(row=>row.id===checkpoint.artifact_id);
    if(!receipt||sha(checkpoint.body)!==receipt.content.sha256||Buffer.byteLength(checkpoint.body)!==Number(receipt.content.size_bytes)
      ||receipt.metadata.execution_id!==args.source_engine_execution_id||receipt.metadata.fit_checkpoint_digest!==engine.fit.checkpoint_digest)fail();
    const packet=JSON.parse(checkpoint.body) as {contract_version:string;execution_id:string;
      context:SignalWorkspaceInterpretationContextV1;clusters:SignalWorkspaceInterpretationClusterV1[];
      interpretations:unknown[];editorial_repair?:unknown};
    if(!packet||Object.keys(packet).some(key=>!["contract_version","execution_id","context","clusters","interpretations","editorial_repair"].includes(key))
      ||packet.contract_version!=="workspace-engine-interpretation-result-v1"||packet.execution_id!==args.source_engine_execution_id
      ||packet.context?.workspace_id!==args.workspace_id||packet.context.execution_id!==args.source_engine_execution_id
      ||packet.context.context_digest!==engine.context_digest)fail();
    let batch=buildSignalWorkspaceInterpretationBatchV1(packet.context,packet.clusters,
      parseSignalWorkspaceInterpretationConfigurationV1(receipt.call_configuration));
    if(packet.editorial_repair!==undefined) {
      const repair=parseSignalWorkspaceInterpretationEditorialRepairV1(packet.editorial_repair);
      batch=buildSignalWorkspaceInterpretationRepairBatchV1(batch,repair);
      if(digest(batch.editorial_repair)!==digest(repair))fail();
    }
    if(batch.request_digest!==receipt.request_digest||digest(batch.clusters.map(group=>group.cluster_id).sort())!==digest(receipt.metadata.unit_keys))fail();
    const results=validateSignalWorkspaceInterpretationResultV1(batch,{interpretations:packet.interpretations});
    for(const result of results) {
      if(found.has(result.cluster_id)||!keys.includes(result.cluster_id)
        ||args.expected_cluster_digests&&args.expected_cluster_digests[result.cluster_id]!==result.cluster_digest)fail();
      found.add(result.cluster_id);
      source_groups.push({group_id:result.cluster_id,cluster_digest:result.cluster_digest,name:result.name,
        definition:result.definition,status:result.status,source_artifact_id:checkpoint.artifact_id});
    }
  }
  if(found.size!==keys.length)fail();
  source_groups.sort((left,right)=>left.group_id.localeCompare(right.group_id));
  const source_groups_digest=digest(source_groups);
  if(args.claimed_source_groups!==undefined&&digest([...args.claimed_source_groups].sort((left,right)=>left.group_id.localeCompare(right.group_id)))!==source_groups_digest)fail();
  return {source_groups,source_groups_digest};
}

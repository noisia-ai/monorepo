import {createHash,randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import {buildSignalWorkspaceInterpretationBatchV1,buildSignalWorkspaceInterpretationRepairBatchV1,
 parseSignalWorkspaceInterpretationConfigurationV1,parseSignalWorkspaceInterpretationEditorialRepairV1,
 recoverSignalWorkspaceInterpretationInsufficiencyV1,signalWorkspaceEmbeddingDigestV1 as digest,
 type SignalWorkspaceInterpretationBatchV1} from "@noisia/query-engine";
import {withSignalWorkspaceEngineTransactionV1,withSignalWorkspaceEngineLeaseV1,loadSignalWorkspaceEngineInputIdentityV1,
 type SignalWorkspaceEngineDatabaseV1,type SignalWorkspaceEngineLeaseV1} from "./signal-workspace-engine";
import {loadSignalWorkspaceCapabilitiesStoreV1} from "./signal-workspace-capabilities";
import {signalWorkspaceFeatureEnabledV1} from "./signal-workspace-features";

export type SignalWorkspaceEngineInsufficiencyDecisionV1={decision_id:string;workspace_id:string;execution_id:string;exception_id:string;unit_key:string;
 original_call_id:string;repair_call_id:string;original_response_sha256:string;repair_response_sha256:string;input_digest:string;fit_checkpoint_digest:string;
 reason:"missing_general_citations";created_by_user_id:string;created_at:string};
export type SignalWorkspaceEngineOperatorInsufficiencyV1={contract_version:"workspace-interpretation-operator-insufficiency-v1";decision_id:string;original_response:string;repair_response:string};
type Binding={original_call_id:string;repair_call_id:string;original_response_sha256:string;repair_response_sha256:string;
 original_request_digest:string;repair_request_digest:string;unit_manifest:string[];call_configuration:unknown};
function fail(code="workspace_engine_insufficiency_decision_invalid"):never {throw new Error(code);}
const sha=(text:string)=>`sha256:${createHash("sha256").update(text).digest("hex")}`;
const decisionSelect=`SELECT decision.id decision_id,decision.workspace_id,decision.execution_id,decision.exception_id,decision.unit_key,
 decision.original_call_id,decision.repair_call_id,decision.original_response_sha256,decision.repair_response_sha256,
 decision.input_digest,decision.fit_checkpoint_digest,decision.reason,decision.created_by_user_id,decision.created_at::text
 FROM signal_workspace_interpretation_insufficiency_decisions decision`;
function proof(binding:Binding,args:{batch:SignalWorkspaceInterpretationBatchV1;unit_key:string;original_response:string;repair_response:string}){
 if(sha(args.original_response)!==binding.original_response_sha256||sha(args.repair_response)!==binding.repair_response_sha256
  ||!binding.unit_manifest.includes(args.unit_key)||args.batch.request_digest!==binding.repair_request_digest
  ||args.batch.editorial_repair?.source_call_id!==binding.original_call_id
  ||args.batch.editorial_repair.source_request_digest!==binding.original_request_digest
  ||args.batch.editorial_repair.source_response_sha256!==binding.original_response_sha256
  ||digest(args.batch.configuration)!==digest(parseSignalWorkspaceInterpretationConfigurationV1(binding.call_configuration)))fail();
 return recoverSignalWorkspaceInterpretationInsufficiencyV1(args);
}
export async function recordSignalWorkspaceEngineInsufficiencyDecisionV1(args:{database:SignalWorkspaceEngineDatabaseV1;workspace_id:string;actor_user_id:string;execution_id:string;
 exception_id:string;unit_key:string;original_response_sha256:string;repair_response_sha256:string;reason:"missing_general_citations";
 batch:SignalWorkspaceInterpretationBatchV1;original_response:string;repair_response:string}):Promise<SignalWorkspaceEngineInsufficiencyDecisionV1&{replayed:boolean}>{
 return withSignalWorkspaceEngineTransactionV1(args.database,async client=>{
  const caps=await loadSignalWorkspaceCapabilitiesStoreV1({queryable:client,workspace_id:args.workspace_id,actor_user_id:args.actor_user_id,lock_authority:true});
  const actor=(await client.query("SELECT 1 FROM users WHERE id=$1 AND status='active' AND user_type='noisia_internal' AND primary_role IN('noisia_admin','admin','founder')",[args.actor_user_id])).rows[0];
  if(!actor||!caps.can_request_processing||!caps.can_edit_topics||!await signalWorkspaceFeatureEnabledV1({queryable:client,workspace_id:args.workspace_id,feature:"mass_labeling"}))fail("workspace_engine_insufficiency_forbidden");
  const run=(await client.query<{id:string;actor_user_id:string;input_digest:string;context_digest:string;catalog_digest:string;fit_checkpoint_digest:string;current:boolean}>(`SELECT execution.id,execution.actor_user_id,execution.input_digest,
   execution.input_snapshot->>'context_digest' context_digest,execution.input_snapshot->>'catalog_digest' catalog_digest,
   execution.result_summary#>>'{fit_checkpoint,checkpoint_digest}' fit_checkpoint_digest,
   execution.input_revision=state.input_revision AND (execution.policy_valid_until IS NULL OR execution.policy_valid_until>clock_timestamp()) current
   FROM signal_topic_catalog_executions execution JOIN signal_corpus_preparation_input_state state USING(workspace_id)
   WHERE execution.id=$1 AND execution.workspace_id=$2 FOR UPDATE OF execution`,[args.execution_id,args.workspace_id])).rows[0];
  if(!run||run.actor_user_id!==args.actor_user_id)fail("workspace_engine_insufficiency_forbidden");
  const identity=await loadSignalWorkspaceEngineInputIdentityV1({queryable:client,workspace_id:args.workspace_id,actor_user_id:args.actor_user_id,execution_id:args.execution_id});
  if(!run.current||identity.context_digest!==run.context_digest||identity.catalog_digest!==run.catalog_digest)fail();
  const binding=(await client.query<Binding>(`SELECT exception.original_call_id,exception.repair_call_id,exception.original_response_sha256,exception.repair_response_sha256,
    exception.original_request_digest,exception.repair_request_digest,exception.unit_manifest,repair.call_configuration
   FROM signal_workspace_interpretation_exceptions exception JOIN engine_cost_events repair ON repair.id=exception.repair_call_id
   WHERE exception.id=$1 AND exception.workspace_id=$2 AND exception.execution_id=$3`,[args.exception_id,args.workspace_id,args.execution_id])).rows[0];
  if(!binding||binding.original_response_sha256!==args.original_response_sha256||binding.repair_response_sha256!==args.repair_response_sha256
   ||args.batch.context.workspace_id!==args.workspace_id||args.batch.context.execution_id!==args.execution_id||args.batch.context.context_digest!==run.context_digest
   ||args.reason!=="missing_general_citations")fail();
  proof(binding,args);
  const prior=(await client.query<SignalWorkspaceEngineInsufficiencyDecisionV1>(`${decisionSelect} WHERE decision.exception_id=$1 AND decision.unit_key=$2`,[args.exception_id,args.unit_key])).rows[0];
  if(prior){if(prior.workspace_id!==args.workspace_id||prior.execution_id!==args.execution_id||prior.created_by_user_id!==args.actor_user_id
   ||prior.original_response_sha256!==args.original_response_sha256||prior.repair_response_sha256!==args.repair_response_sha256||prior.reason!==args.reason)fail();return{...prior,replayed:true};}
  const id=randomUUID();await client.query(`INSERT INTO signal_workspace_interpretation_insufficiency_decisions(id,workspace_id,execution_id,exception_id,unit_key,
   original_call_id,repair_call_id,original_response_sha256,repair_response_sha256,input_digest,fit_checkpoint_digest,reason,created_by_user_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[id,args.workspace_id,args.execution_id,args.exception_id,args.unit_key,binding.original_call_id,binding.repair_call_id,
    args.original_response_sha256,args.repair_response_sha256,run.input_digest,run.fit_checkpoint_digest,args.reason,args.actor_user_id]);
  return{...(await client.query<SignalWorkspaceEngineInsufficiencyDecisionV1>(`${decisionSelect} WHERE decision.id=$1`,[id])).rows[0]!,replayed:false};
 });
}
/** Include resolved decisions: every historical checkpoint replay revalidates its authority. */
export async function readSignalWorkspaceEngineInsufficiencyDecisionsV1(args:{database:SignalWorkspaceEngineDatabaseV1;lease:SignalWorkspaceEngineLeaseV1}):Promise<SignalWorkspaceEngineInsufficiencyDecisionV1[]>{
 return withSignalWorkspaceEngineLeaseV1({...args,full:true},async(client,run)=>(await client.query<SignalWorkspaceEngineInsufficiencyDecisionV1>(`${decisionSelect}
  WHERE decision.workspace_id=$1 AND decision.execution_id=$2 ORDER BY decision.id`,[run.workspace_id,run.id])).rows);
}
/** Apply the same proof at initial checkpoint, source adoption, and materialization. */
export async function verifySignalWorkspaceEngineInsufficiencyCheckpointWithClientV1(client:Pick<PoolClient,"query">,args:{workspace_id:string;execution_id:string;actor_user_id:string;
 call_id:string;decision_id:string;body:string;sha256:string;size_bytes:number}){
 if(sha(args.body)!==args.sha256||Buffer.byteLength(args.body)!==Number(args.size_bytes)||Buffer.byteLength(args.body)>2*1024*1024)fail("workspace_engine_insufficiency_checkpoint_invalid");
 const packet=JSON.parse(args.body) as {contract_version:string;execution_id:string;context:SignalWorkspaceInterpretationBatchV1["context"];clusters:SignalWorkspaceInterpretationBatchV1["clusters"];
  interpretations:unknown;editorial_repair?:unknown;operator_insufficiency?:SignalWorkspaceEngineOperatorInsufficiencyV1};
 const operator=packet.operator_insufficiency;
 if(!operator||Object.keys(operator).sort().join(",")!=="contract_version,decision_id,original_response,repair_response"
  ||operator.contract_version!=="workspace-interpretation-operator-insufficiency-v1"||operator.decision_id!==args.decision_id
  ||packet.contract_version!=="workspace-engine-interpretation-result-v1"||packet.execution_id!==args.execution_id
  ||packet.context.workspace_id!==args.workspace_id||packet.context.execution_id!==args.execution_id)fail("workspace_engine_insufficiency_checkpoint_invalid");
 const record=(await client.query<SignalWorkspaceEngineInsufficiencyDecisionV1&Binding>(`${decisionSelect}, signal_workspace_interpretation_exceptions exception,
  engine_cost_events repair,signal_topic_catalog_executions execution
  WHERE decision.id=$1 AND decision.workspace_id=$2 AND decision.execution_id=$3 AND decision.created_by_user_id=$4
   AND exception.id=decision.exception_id AND exception.workspace_id=decision.workspace_id AND exception.execution_id=decision.execution_id
   AND repair.id=decision.repair_call_id AND repair.id=$5 AND repair.workspace_id=decision.workspace_id AND repair.catalog_execution_id=decision.execution_id
   AND repair.actor_user_id=$4 AND repair.call_state='settled' AND repair.response_http_status=200
   AND repair.response_sha256=decision.repair_response_sha256 AND repair.response_storage_key IS NOT NULL
   AND execution.id=decision.execution_id AND execution.workspace_id=decision.workspace_id AND execution.actor_user_id=$4
   AND execution.input_digest=decision.input_digest AND execution.result_summary#>>'{fit_checkpoint,checkpoint_digest}'=decision.fit_checkpoint_digest`,
  [args.decision_id,args.workspace_id,args.execution_id,args.actor_user_id,args.call_id])).rows[0];
 // Additional binding fields are read separately to keep the public decision DTO closed.
 const binding=(await client.query<Binding>(`SELECT exception.original_call_id,exception.repair_call_id,exception.original_response_sha256,exception.repair_response_sha256,
   exception.original_request_digest,exception.repair_request_digest,exception.unit_manifest,repair.call_configuration
  FROM signal_workspace_interpretation_exceptions exception JOIN engine_cost_events repair ON repair.id=exception.repair_call_id
  WHERE exception.id=$1 AND exception.workspace_id=$2 AND exception.execution_id=$3`,[record?.exception_id,args.workspace_id,args.execution_id])).rows[0];
 if(!record||!binding)fail("workspace_engine_insufficiency_checkpoint_invalid");
 let batch=buildSignalWorkspaceInterpretationBatchV1(packet.context,packet.clusters,parseSignalWorkspaceInterpretationConfigurationV1(binding.call_configuration));
 batch=buildSignalWorkspaceInterpretationRepairBatchV1(batch,parseSignalWorkspaceInterpretationEditorialRepairV1(packet.editorial_repair));
 const interpretations=proof(binding,{batch,unit_key:record.unit_key,original_response:operator.original_response,repair_response:operator.repair_response});
 if(digest(interpretations)!==digest(packet.interpretations))fail("workspace_engine_insufficiency_checkpoint_invalid");
 return{decision:record,interpretations};
}

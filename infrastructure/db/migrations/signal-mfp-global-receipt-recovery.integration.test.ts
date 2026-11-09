import assert from "node:assert/strict";
import test from "node:test";
import {createHash,randomUUID} from "node:crypto";
import type {Pool} from "pg";
import {buildMassLabelingConsolidationRequestV1,parseMassLabelingConsolidationResponseV1,signalWorkspaceEmbeddingDigestV1 as digest,
 SIGNAL_WORKSPACE_MASS_LABELING_EDITORIAL_CONFIGURATION_V1 as configuration} from "@noisia/query-engine";
import {seedSignalTopicEditorialRenewalSourceV1,createSignalTopicEditorialRenewalSyntheticSavesV1} from "./signal-topic-editorial-renewal.synthetic.fixture";
import * as engine from "../signal-workspace-engine";
import * as money from "../signal-workspace-engine-interpretation";
import {verifyMassLabelingSourceCheckpointsV1,type MassLabelingSourceCheckpointV1} from "../signal-mass-labeling-source";
import {materializeSignalWorkspaceEngineTopicsV1} from "../signal-topic-catalog";
import {createMassLabelingMapV1,exportMassLabelingSnapshotV1} from "../signal-mass-labeling";
const sha=(s:string)=>`sha256:${createHash("sha256").update(s).digest("hex")}`;

test("a scoped paid global receipt decision replays offline and is recomputed at map adoption",{
 skip:process.env.NOISIA_MFP_PG_CI!=="true",timeout:300_000,
},async()=>{
 const{openDatabase}=await import(new URL("../../../scripts/dev-corpus/guard.mjs",import.meta.url).href);
 const pool:Pool=await openDatabase(),raw=await pool.connect(),flag=process.env.NOISIA_MASS_LABELING_ENABLED;
 process.env.NOISIA_MASS_LABELING_ENABLED="true";await raw.query("BEGIN");let seq=0;const stack:string[]=[];
 const query=async(sql:string,args?:unknown[])=>{
  if(sql.startsWith("BEGIN")){const save=`global_recovery_${++seq}`;stack.push(save);return raw.query(`SAVEPOINT ${save}`);}
  if(sql==="COMMIT")return raw.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
  if(sql==="ROLLBACK"){const save=stack.pop()!;await raw.query(`ROLLBACK TO SAVEPOINT ${save}`);return raw.query(`RELEASE SAVEPOINT ${save}`);}
  if(sql.startsWith("SET TRANSACTION"))return raw.query("SELECT 1");return raw.query(sql,args);
 };
 const scoped=Object.assign(Object.create(raw),{query,release(){}}),database=Object.assign(Object.create(pool),{query,connect:async()=>scoped}) as Pool;
 let packetRaw="",artifactId="",decisionId="",ledgerBefore:unknown,checkpointsBefore:unknown,fitBefore:unknown,sourceCheckpoints:MassLabelingSourceCheckpointV1[]=[];
 let sourceExecutionId="",assignmentsRaw="";let replayRecord:(()=>Promise<{replayed:boolean}>)|undefined;
 const done=new Error("synthetic global receipt acceptance complete");let completed=false;
 let catalog:Array<{topic_key:string;name:string;definition:string;group_ids:string[]}>=[];
 try{
  await assert.rejects(seedSignalTopicEditorialRenewalSourceV1({database,scoped,query,cleanup:async()=>{},
   saves:createSignalTopicEditorialRenewalSyntheticSavesV1(undefined,{brand_name:"Synthetic fixture"}),numeric_daily_cap_micro_usd:10_000_000,
   before_numeric_policy_activation:async({identity})=>{
  const access={database,workspace_id:identity.workspace_id,actor_user_id:identity.actor_user_id};
  const assignment=(await query("SELECT id,content FROM analysis_artifacts WHERE engine_execution_id=$1 AND artifact_key='assignments.guided.jsonl'",[sourceExecutionId])).rows[0]!;
  const args={...access,source_engine_execution_id:sourceExecutionId,assignments_artifact_id:assignment.id,assignments_raw:assignmentsRaw,
   consolidation_artifact_id:artifactId,consolidation_raw:packetRaw,source_checkpoints:sourceCheckpoints,catalog};
  const map=await createMassLabelingMapV1(args);assert.equal((await createMassLabelingMapV1(args)).map_id,map.map_id);
  const altered=JSON.parse(packetRaw);altered.output.topics[0].definition="An invented definition";
  await assert.rejects(createMassLabelingMapV1({...args,consolidation_raw:JSON.stringify(altered),catalog:altered.output.topics}));
  const noDecision=JSON.parse(packetRaw);delete noDecision.operator_receipt_recovery;
  await assert.rejects(createMassLabelingMapV1({...args,consolidation_raw:JSON.stringify(noDecision)}));
  const snapshot=await exportMassLabelingSnapshotV1({...access,map_id:map.map_id});
  assert.equal(snapshot.stage_receipts.global_receipt_recovery_decision!.decision_id,decisionId);
  assert.equal(snapshot.stage_receipts.consolidation_artifact!.metadata.recovery_decision_id,decisionId);
  assert.deepEqual(snapshot.map.catalog.map(t=>t.topic_key).sort(),["cafe","otro","tema"]);
  const recovery=await import("../signal-mass-labeling-global-recovery");
  const readScope={...access,execution_id:sourceExecutionId};
  const firstRead=await recovery.readSignalWorkspaceMassLabelingGlobalReceiptDecisionV1(readScope);
  assert.equal(firstRead!.decision_id,decisionId);assert.deepEqual(await recovery.readSignalWorkspaceMassLabelingGlobalReceiptDecisionV1(readScope),firstRead);
  assert.equal((await replayRecord!()).replayed,true,"the same authenticated decision remains an idempotent read after READY");
  assert.deepEqual((await query("SELECT row_to_json(call) body FROM engine_cost_events call WHERE catalog_execution_id=$1 ORDER BY id",[sourceExecutionId])).rows,ledgerBefore,
   "record, replay, materialize and adoption neither reserve nor change any paid receipt");
  assert.deepEqual((await query("SELECT row_to_json(artifact) body FROM analysis_artifacts artifact WHERE engine_execution_id=$1 AND metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1' ORDER BY id",[sourceExecutionId])).rows,checkpointsBefore);
  assert.deepEqual((await query("SELECT input_digest,result_summary->'fit_checkpoint' fit FROM signal_topic_catalog_executions WHERE id=$1",[sourceExecutionId])).rows[0],fitBefore);
    completed=true;throw done;
   },
   projection:{split_guided_groups:3,interpretation_configuration:configuration,engine_config:{profile_version:"workspace-bertopic-mass-labeling-v1",fixture:true},
    onCheckpoint:async fixture=>{
     if(fixture.proposals.length!==3)return;
     sourceCheckpoints=[...fixture.proposals];sourceExecutionId=fixture.lease.execution_id;
     assignmentsRaw=[...fixture.bodies].find(([key])=>key.endsWith("/assignments.guided.jsonl"))![1];
     const groupIds=fixture.proposals.map(p=>JSON.parse(p.body).interpretations[0].cluster_id as string).sort();
     const verified=await verifyMassLabelingSourceCheckpointsV1({...fixture.access,source_engine_execution_id:fixture.lease.execution_id,
      source_checkpoints:sourceCheckpoints,expected_group_ids:groupIds,lease:fixture.lease});
     const batch=buildMassLabelingConsolidationRequestV1({workspace_id:fixture.access.workspace_id,source_engine_execution_id:fixture.lease.execution_id,source_groups:verified.source_groups});
     const [first,second,third]=batch.source_groups;assert.ok(first&&second&&third&&first.definition);
     const points=[...first.definition],prefix=10,removed=1,suffix=points.length-prefix-removed;
     const keys=["café","temá","ótro"],normalized=keys.map(key=>key.normalize("NFKD").replace(/\p{M}/gu,""));
     const output={topics:[{topic_key:keys[0]!,name:first.name!,definition:points.slice(0,prefix).join("")+points.slice(prefix+removed).join(""),group_ids:[first.group_id]},
      {topic_key:keys[1]!,name:second.name!,definition:second.definition!,group_ids:[first.group_id,second.group_id]},
      {topic_key:keys[2]!,name:third.name!,definition:third.definition!,group_ids:[third.group_id]}],excluded_groups:[]};
     const response=JSON.stringify({id:"msg_synthetic_recovery",type:"message",role:"assistant",model:configuration.model,stop_reason:"end_turn",
      content:[{type:"text",text:JSON.stringify(output)}],usage:{input_tokens:100,output_tokens:50}});
     assert.throws(()=>parseMassLabelingConsolidationResponseV1(batch,response),"ordinary parsing remains strict");
     const reservation={...fixture.access,execution_id:fixture.lease.execution_id,idempotency_key:randomUUID(),request_digest:batch.request_digest,
      configuration:batch.configuration,reserved_micro_usd:batch.reserved_micro_usd,budget_timezone:fixture.budget.timezone,daily_cap_micro_usd:30_000_000,
      execution_token:fixture.lease.execution_token,mass_labeling_stage:{stage:"global-consolidation-v1" as const,source_groups_digest:batch.source_groups_digest}};
     const call=await money.reserveSignalWorkspaceEngineInterpretationV1(reservation),token={database,call_id:call.call_id,attempt_token:call.attempt_token};
     await money.markSignalWorkspaceEngineInterpretationSentV1({...token,execution_token:fixture.lease.execution_token});
     await money.persistSignalWorkspaceEngineInterpretationResponseV1({...token,response:{storage_key:`workspace-engine/${fixture.access.workspace_id}/${fixture.lease.execution_id}/paid-global.json`,
      sha256:sha(response),size_bytes:Buffer.byteLength(response),http_status:200,provider_request_id:"req_synthetic_paid_recovery"}});
     await money.settleSignalWorkspaceEngineInterpretationV1({...token,usage:{input_tokens:100,output_tokens:50,cache_read_input_tokens:0,cache_creation_input_tokens:0}});
     await engine.failSignalWorkspaceEngineV1({database,lease:fixture.lease,error_code:"workspace_engine_worker_failed"});
     ledgerBefore=(await query("SELECT row_to_json(call) body FROM engine_cost_events call WHERE catalog_execution_id=$1 ORDER BY id",[fixture.lease.execution_id])).rows;
     checkpointsBefore=(await query("SELECT row_to_json(artifact) body FROM analysis_artifacts artifact WHERE engine_execution_id=$1 AND metadata->>'contract_version'='workspace-engine-interpretation-checkpoint-v1' ORDER BY id",[fixture.lease.execution_id])).rows;
     fitBefore=(await query("SELECT input_digest,result_summary->'fit_checkpoint' fit FROM signal_topic_catalog_executions WHERE id=$1",[fixture.lease.execution_id])).rows[0];
     const recovery=await import("../signal-mass-labeling-global-recovery");
     const decision={contract_version:"workspace-mass-labeling-receipt-recovery-v1" as const,workspace_id:fixture.access.workspace_id,execution_id:fixture.lease.execution_id,
      call_id:call.call_id,request_digest:batch.request_digest,response_sha256:sha(response),source_groups_digest:batch.source_groups_digest,
      topic_key_changes:keys.map((from,index)=>({from,to:normalized[index]!})),assignment_resolution:{method:"source_segments_and_exact_remaining_summary" as const,
       group_id:first.group_id,keep_topic_key:keys[0]!,remove_topic_key:keys[1]!,definition_omission:{unit:"unicode_code_points" as const,prefix_length:prefix,removed_length:removed,suffix_length:suffix}}};
     const args={...fixture.access,execution_id:fixture.lease.execution_id,call_id:call.call_id,request_digest:batch.request_digest,response_sha256:sha(response),
      source_groups_digest:batch.source_groups_digest,batch,raw_response:response,source_checkpoints:sourceCheckpoints,decision};
     const otherAdmin=randomUUID();
     await query(`INSERT INTO users(id,email,user_type,primary_role,status,organization_id)
      SELECT $1,$2,'noisia_internal','noisia_admin','active',organization_id FROM users WHERE id=$3`,[otherAdmin,`${otherAdmin}@example.invalid`,fixture.access.actor_user_id]);
     await assert.rejects(recovery.recordSignalWorkspaceMassLabelingGlobalReceiptDecisionV1({...args,actor_user_id:otherAdmin}),/global_receipt_forbidden|workspace_engine_forbidden/);
     await assert.rejects(recovery.recordSignalWorkspaceMassLabelingGlobalReceiptDecisionV1({...args,workspace_id:randomUUID()}));
     await assert.rejects(recovery.recordSignalWorkspaceMassLabelingGlobalReceiptDecisionV1({...args,response_sha256:digest("other raw")}));
     const groupCall=(await query("SELECT metadata->>'call_id' id FROM analysis_artifacts WHERE id=$1",[sourceCheckpoints[0]!.artifact_id])).rows[0]!.id;
     await assert.rejects(recovery.recordSignalWorkspaceMassLabelingGlobalReceiptDecisionV1({...args,call_id:groupCall}));
     await assert.rejects(recovery.recordSignalWorkspaceMassLabelingGlobalReceiptDecisionV1({...args,decision:{...decision,assignment_resolution:{...decision.assignment_resolution,keep_topic_key:keys[2]!}}}));
     await assert.rejects(recovery.recordSignalWorkspaceMassLabelingGlobalReceiptDecisionV1({...args,request_digest:digest("foreign request")}));
     await assert.rejects(recovery.recordSignalWorkspaceMassLabelingGlobalReceiptDecisionV1({...args,raw_response:response+" "}));
     await assert.rejects(recovery.recordSignalWorkspaceMassLabelingGlobalReceiptDecisionV1({...args,source_checkpoints:sourceCheckpoints.slice(1)}));
     const recorded=await recovery.recordSignalWorkspaceMassLabelingGlobalReceiptDecisionV1(args);decisionId=recorded.decision_id;replayRecord=()=>recovery.recordSignalWorkspaceMassLabelingGlobalReceiptDecisionV1(args);
     await query("SAVEPOINT immutable_recovery_binding");
     await assert.rejects(query("UPDATE signal_topic_catalog_executions SET result_summary=result_summary-'global_receipt_recovery_decision_id' WHERE id=$1",[fixture.lease.execution_id]),/binding is immutable/);
     await query("ROLLBACK TO SAVEPOINT immutable_recovery_binding");await query("RELEASE SAVEPOINT immutable_recovery_binding");
     assert.equal((await recovery.recordSignalWorkspaceMassLabelingGlobalReceiptDecisionV1(args)).replayed,true);
     for(const sql of ["UPDATE signal_mass_labeling_global_receipt_decisions SET decision='{}' WHERE id=$1","DELETE FROM signal_mass_labeling_global_receipt_decisions WHERE id=$1"]){
      await query("SAVEPOINT immutable_global_decision");await assert.rejects(query(sql,[decisionId]),/append-only/);
      await query("ROLLBACK TO SAVEPOINT immutable_global_decision");await query("RELEASE SAVEPOINT immutable_global_decision");
     }
     await query("SAVEPOINT foreign_decision_request");
     await assert.rejects(query(`INSERT INTO signal_mass_labeling_global_receipt_decisions SELECT (jsonb_populate_record(NULL::signal_mass_labeling_global_receipt_decisions,to_jsonb(d)||$2::jsonb)).*
      FROM signal_mass_labeling_global_receipt_decisions d WHERE id=$1`,[decisionId,JSON.stringify({id:randomUUID(),request_digest:digest("other request")})]),/global_receipt_decision_invalid/);
     await query("ROLLBACK TO SAVEPOINT foreign_decision_request");await query("RELEASE SAVEPOINT foreign_decision_request");
     await engine.retrySignalWorkspaceEngineV1({...fixture.access,execution_id:fixture.lease.execution_id,idempotency_key:randomUUID()});
     const resumed=await engine.claimSignalWorkspaceEngineV1({database,execution_id:fixture.lease.execution_id,worker_job_id:"synthetic-offline-global-receipt"});assert.ok(resumed);Object.assign(fixture.lease,resumed);
     const read=await recovery.readSignalWorkspaceMassLabelingGlobalReceiptDecisionV1({database,lease:fixture.lease,call_id:call.call_id});assert.equal(read!.decision_id,decisionId);
     await assert.rejects(recovery.readSignalWorkspaceMassLabelingGlobalReceiptDecisionV1({database,lease:{...fixture.lease,execution_token:randomUUID()}}),/workspace_engine_lease_conflict/);
     await assert.rejects(money.reserveSignalWorkspaceEngineInterpretationV1({...reservation,idempotency_key:randomUUID(),request_digest:digest("new paid request"),execution_token:fixture.lease.execution_token}),/global_receipt_recovery_no_send/);
     assert.equal((await money.markSignalWorkspaceEngineInterpretationSentV1({...token,execution_token:fixture.lease.execution_token})).send_authorized,false);
     const parsed=await recovery.verifySignalWorkspaceMassLabelingGlobalReceiptRecoveryWithClientV1(scoped,{workspace_id:fixture.access.workspace_id,execution_id:fixture.lease.execution_id,
      actor_user_id:fixture.access.actor_user_id,call_id:call.call_id,decision_id:decisionId,decision_digest:recorded.decision_digest,batch,raw_response:response});
     catalog=parsed.output.topics;
     packetRaw=JSON.stringify({contract_version:"workspace-mass-labeling-consolidation-v1",workspace_id:fixture.access.workspace_id,source_engine_execution_id:fixture.lease.execution_id,
      source_groups:batch.source_groups,source_groups_digest:batch.source_groups_digest,raw_response:response,output:parsed.output,
      operator_receipt_recovery:{contract_version:"workspace-mass-labeling-global-receipt-decision-v1",decision_id:decisionId,decision_digest:recorded.decision_digest}});
     const artifact={artifact_key:"mass-labeling-consolidation.json",artifact_type:"engine_proposals" as const,title:"Synthetic recovered global receipt",
      storage_key:`workspace-engine/${fixture.access.workspace_id}/${fixture.lease.execution_id}/global-recovered.json`,sha256:sha(packetRaw),size_bytes:Buffer.byteLength(packetRaw),media_type:"application/json",
      metadata:{contract_version:"workspace-mass-labeling-consolidation-v1",source_engine_execution_id:fixture.lease.execution_id,stage:"global-consolidation-v1",source_groups_digest:batch.source_groups_digest,
       call_id:call.call_id,request_digest:batch.request_digest,response_sha256:sha(response),recovery_decision_id:decisionId,recovery_decision_digest:recorded.decision_digest}};
     const {recovery_decision_id:_id,recovery_decision_digest:_digest,...noProvenance}=artifact.metadata;
     await assert.rejects(engine.persistSignalWorkspaceEngineArtifactV1({database,lease:fixture.lease,artifact:{...artifact,metadata:noProvenance}}),/global_receipt_artifact_invalid/);
     // Even a byte-matching, signed global packet cannot substitute its output:
     // adoption must recompute the authenticated disposition from the paid raw.
     await query("SAVEPOINT signed_but_invented_output");
     const invented=JSON.parse(packetRaw);invented.output.topics[0].definition="An invented normalized definition";
     const inventedRaw=JSON.stringify(invented);
     const bad=await engine.persistSignalWorkspaceEngineArtifactV1({database,lease:fixture.lease,artifact:{...artifact,sha256:sha(inventedRaw),size_bytes:Buffer.byteLength(inventedRaw)}});
     const materialization=await materializeSignalWorkspaceEngineTopicsV1({database,lease:fixture.lease,proposals:(async function*(){yield* sourceCheckpoints;})()});
     const materializationBody=JSON.stringify(materialization),fit=(await query("SELECT result_summary->'fit_checkpoint' fit FROM signal_topic_catalog_executions WHERE id=$1",[fixture.lease.execution_id])).rows[0]!.fit;
     const materialized=await engine.persistSignalWorkspaceEngineArtifactV1({database,lease:fixture.lease,artifact:{artifact_key:"materialization.json",artifact_type:"engine_proposals",title:"Synthetic adoption probe",
      storage_key:`workspace-engine/${fixture.access.workspace_id}/${fixture.lease.execution_id}/materialization.json`,sha256:sha(materializationBody),size_bytes:Buffer.byteLength(materializationBody),media_type:"application/json",
      metadata:{contract_version:"workspace-topic-materialization-v1",execution_id:fixture.lease.execution_id,interpretation_units_digest:fit.interpretation_manifest.unit_digest,
       output_catalog_profile_id:materialization.output_catalog_profile_id,output_catalog_revision:materialization.output_catalog_revision,topic_count:materialization.topic_count,mapping_digest:materialization.mapping_digest}}});
     await engine.completeSignalWorkspaceEngineAnalysisV1({database,lease:fixture.lease,materialization_artifact_id:materialized.artifact_id});
     const assignment=(await query("SELECT id FROM analysis_artifacts WHERE engine_execution_id=$1 AND artifact_key='assignments.guided.jsonl'",[fixture.lease.execution_id])).rows[0]!;
     await assert.rejects(createMassLabelingMapV1({...fixture.access,source_engine_execution_id:fixture.lease.execution_id,assignments_artifact_id:assignment.id,assignments_raw:assignmentsRaw,
      consolidation_artifact_id:bad.artifact_id,consolidation_raw:inventedRaw,source_checkpoints:sourceCheckpoints,catalog:invented.output.topics}),/mass_labeling_consolidation_receipt_invalid/);
     assert.equal((await query("SELECT count(*)::int n FROM signal_mass_labeling_maps WHERE source_engine_execution_id=$1",[fixture.lease.execution_id])).rows[0]!.n,0);
     await query("ROLLBACK TO SAVEPOINT signed_but_invented_output");await query("RELEASE SAVEPOINT signed_but_invented_output");
     artifactId=(await engine.persistSignalWorkspaceEngineArtifactV1({database,lease:fixture.lease,artifact})).artifact_id;
    }}}),error=>{if(error!==done)console.error(error);return error===done;});
  assert.ok(completed);

 }finally{await raw.query("ROLLBACK");raw.release();await pool.end();if(flag===undefined)delete process.env.NOISIA_MASS_LABELING_ENABLED;else process.env.NOISIA_MASS_LABELING_ENABLED=flag;}
});

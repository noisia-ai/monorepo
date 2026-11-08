import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import test from "node:test";
import type {Pool} from "pg";
import {buildSignalWorkspaceInterpretationBatchV1,buildSignalWorkspaceInterpretationRepairBatchV1,
 signalWorkspaceEmbeddingDigestV1 as digest,signalWorkspaceInterpretationReferenceIdV1,recoverSignalWorkspaceInterpretationInsufficiencyV1,
 SIGNAL_WORKSPACE_MASS_LABELING_EDITORIAL_CONFIGURATION_V1 as configuration} from "@noisia/query-engine";
import {seedSignalTopicEditorialRenewalSourceV1,createSignalTopicEditorialRenewalSyntheticSavesV1} from "./signal-topic-editorial-renewal.synthetic.fixture";
import * as engine from "../signal-workspace-engine";
import * as money from "../signal-workspace-engine-interpretation";
import {recordSignalWorkspaceEngineInterpretationRecoveryReviewV1} from "../signal-workspace-engine-recovery";
import {recordSignalWorkspaceEngineInsufficiencyDecisionV1,readSignalWorkspaceEngineInsufficiencyDecisionsV1} from "../signal-workspace-engine-insufficiency";
import {verifyMassLabelingSourceCheckpointsV1} from "../signal-mass-labeling-source";
import {materializeSignalWorkspaceEngineTopicsV1} from "../signal-topic-catalog";
const sha=(text:string)=>`sha256:${createHash("sha256").update(text).digest("hex")}`;

test("operator insufficiency is scoped durable evidence and preserves the valid paid sibling",{
 skip:process.env.NOISIA_MFP_PG_CI!=="true",timeout:300_000,
},async()=>{
 const {openDatabase}=await import(new URL("../../../scripts/dev-corpus/guard.mjs",import.meta.url).href);
 const pool:Pool=await openDatabase(),raw=await pool.connect(),flag=process.env.NOISIA_MASS_LABELING_ENABLED;
 process.env.NOISIA_MASS_LABELING_ENABLED="true";
 await raw.query("BEGIN");let seq=0;const stack:string[]=[];
 const query=async(sql:string,args?:unknown[])=>{
  if(sql.startsWith("BEGIN")){const key=`insufficient_${++seq}`;stack.push(key);return raw.query(`SAVEPOINT ${key}`);}
  if(sql==="COMMIT")return raw.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
  if(sql==="ROLLBACK"){const key=stack.pop()!;await raw.query(`ROLLBACK TO SAVEPOINT ${key}`);return raw.query(`RELEASE SAVEPOINT ${key}`);}
  return raw.query(sql,args);
 };
 const scoped=Object.assign(Object.create(raw),{query,release(){}}),database=Object.assign(Object.create(pool),{query,connect:async()=>scoped}) as Pool;
 const stop=new Error("synthetic operator acceptance complete");let complete=false;
 try{
  await assert.rejects(seedSignalTopicEditorialRenewalSourceV1({database,scoped,query,cleanup:async()=>{},
   saves:createSignalTopicEditorialRenewalSyntheticSavesV1(undefined,{brand_name:"Synthetic fixture"}),numeric_daily_cap_micro_usd:10_000_000,
   projection:{split_guided_groups:3,interpretation_configuration:configuration,engine_config:{profile_version:"workspace-bertopic-mass-labeling-v1",fixture:true},
    onCheckpoint:async fixture=>{
     if(fixture.proposals.length!==1)return;
     let lease=fixture.lease;const access={...fixture.access,execution_id:lease.execution_id};
     const first=fixture.proposals[0]!,firstPacket=JSON.parse(first.body);
     const rows=(await engine.readSignalWorkspaceEngineChunksV1({database,lease,after:null,limit:128})).items;
     const assignments=[...fixture.bodies].find(([key])=>key.endsWith("/assignments.guided.jsonl"))![1].trim().split("\n").map(line=>JSON.parse(line));
     const groupKeys=[...new Set(assignments.map(row=>`guided:${row.stable_cluster_id}`))].sort();
     const clusterDigests:Record<string,string>={};
     const clusters=groupKeys.filter(key=>key!==firstPacket.clusters[0].cluster_id).map(key=>{
      const assigned=assignments.filter(row=>`guided:${row.stable_cluster_id}`===key);
      const item=assigned[0],chunk=rows.find(row=>row.root_id===item.root_id&&row.chunk_index===item.chunk_index)!;
      const identity={root_id:chunk.root_id,chunk_index:chunk.chunk_index,start:chunk.start,end:chunk.end,chunk_sha256:chunk.chunk_sha256};
      const cluster_digest=sha(assigned.map(row=>JSON.stringify({ordinal:row.ordinal,root_id:row.root_id,chunk_index:row.chunk_index,start:row.start,end:row.end,chunk_sha256:row.chunk_sha256})+"\n").join(""));
      clusterDigests[key]=cluster_digest;
      return{cluster_id:key,lane:"guided" as const,cluster_digest,root_count:1,chunk_count:1,terms:["synthetic conversation"],representatives:[{...identity,
       ref_id:signalWorkspaceInterpretationReferenceIdV1(identity),text:chunk.text,strength:0.8,selection_reason:"high_affiliation" as const}]};
     });
     clusterDigests[firstPacket.clusters[0].cluster_id]=firstPacket.clusters[0].cluster_digest;
     const selected=clusters[0]!.cluster_id,brother=clusters[1]!.cluster_id;
     const originalBatch=buildSignalWorkspaceInterpretationBatchV1(firstPacket.context,clusters,configuration);
     const response=(brotherName:string)=>JSON.stringify({type:"message",role:"assistant",model:configuration.model,stop_reason:"end_turn",
      usage:{input_tokens:100,output_tokens:50},content:[{type:"text",text:JSON.stringify({interpretations:clusters.map(cluster=>({cluster_id:cluster.cluster_id,cluster_digest:cluster.cluster_digest,
       status:cluster.cluster_id===selected?"mixed":"coherent",name:cluster.cluster_id===selected?"Synthetic mixed group":brotherName,
       definition:"Synthetic bounded group evidence.",inclusion:[{text:"Synthetic included condition",citations:[String(configuration.model)==="claude-opus-5"?cluster.representatives[0]!.ref_id:"r1"]}],exclusion:[],
       citations:cluster.cluster_id===selected?[]:[String(configuration.model)==="claude-opus-5"?cluster.representatives[0]!.ref_id:"r1"]}))})}]});
     const originalRaw=response("Original coherent sibling"),repairRaw=response("Repaired coherent sibling");
     const reserve={...access,execution_token:lease.execution_token,configuration,budget_timezone:"America/Mexico_City",daily_cap_micro_usd:30_000_000,unit_keys:clusters.map(c=>c.cluster_id)};
     const paid=async(batch:typeof originalBatch,body:string)=>{
      const call=await money.reserveSignalWorkspaceEngineInterpretationV1({...reserve,idempotency_key:batch.batch_key,request_digest:batch.request_digest,reserved_micro_usd:batch.reserved_micro_usd,
       ...(batch.editorial_repair?{editorial_repair:batch.editorial_repair}:{})});
      const token={database,call_id:call.call_id,attempt_token:call.attempt_token};
      await money.markSignalWorkspaceEngineInterpretationSentV1({...token,execution_token:lease.execution_token});
      await money.persistSignalWorkspaceEngineInterpretationResponseV1({...token,response:{storage_key:`workspace-engine/${access.workspace_id}/${lease.execution_id}/raw-${call.call_id}.json`,sha256:sha(body),size_bytes:Buffer.byteLength(body),http_status:200,provider_request_id:null}});
      await money.settleSignalWorkspaceEngineInterpretationV1({...token,usage:{input_tokens:100,output_tokens:50,cache_read_input_tokens:0,cache_creation_input_tokens:0}});return call;
     };
     const original=await paid(originalBatch,originalRaw);
     await recordSignalWorkspaceEngineInterpretationRecoveryReviewV1({database,lease,call_id:original.call_id,request_digest:originalBatch.request_digest,response_sha256:sha(originalRaw),
      unit_keys:reserve.unit_keys,outcome:"needs_repair",validator_version:"pilot30-v1"});
     const batch=buildSignalWorkspaceInterpretationRepairBatchV1(originalBatch,{source_call_id:original.call_id,source_response_sha256:sha(originalRaw),diagnostic:"output_invalid"});
     const repair=await paid(batch,repairRaw);
     const exception=await engine.quarantineSignalWorkspaceEngineInterpretationBatchV1({database,lease,original_call_id:original.call_id,repair_call_id:repair.call_id,
      original_request_digest:originalBatch.request_digest,repair_request_digest:batch.request_digest,original_response_sha256:sha(originalRaw),repair_response_sha256:sha(repairRaw),
      batch_digest:digest(originalBatch),unit_keys:reserve.unit_keys,validator_version:"pilot30-v1"});
     await engine.failSignalWorkspaceEngineV1({database,lease,error_code:"workspace_engine_interpretation_output_invalid"});
     const ledger=async()=>(await query("SELECT jsonb_agg(to_jsonb(receipt) ORDER BY receipt.id) body FROM engine_cost_events receipt WHERE catalog_execution_id=$1",[lease.execution_id])).rows[0]!.body;
     const beforeLedger=await ledger(),beforeCheckpoint=(await query("SELECT to_jsonb(artifact) body FROM analysis_artifacts artifact WHERE id=$1",[first.artifact_id])).rows[0]!.body;
     const beforeException=(await query("SELECT to_jsonb(exception) body FROM signal_workspace_interpretation_exceptions exception WHERE id=$1",[exception.exception_id])).rows[0]!.body;
     const decisionArgs={...access,exception_id:exception.exception_id,unit_key:selected,original_response_sha256:sha(originalRaw),repair_response_sha256:sha(repairRaw),
      reason:"missing_general_citations" as const,batch,original_response:originalRaw,repair_response:repairRaw};
     const otherActor=randomUUID();
     await query(`INSERT INTO users(id,email,organization_id,user_type,primary_role,status)
      SELECT $1,$2,organization_id,'noisia_internal','noisia_admin','active' FROM users WHERE id=$3`,[otherActor,`${otherActor}@example.invalid`,access.actor_user_id]);
     await assert.rejects(recordSignalWorkspaceEngineInsufficiencyDecisionV1({...decisionArgs,actor_user_id:otherActor}),/forbidden/);
     await assert.rejects(recordSignalWorkspaceEngineInsufficiencyDecisionV1({...decisionArgs,workspace_id:randomUUID()}),/forbidden/);
     await assert.rejects(recordSignalWorkspaceEngineInsufficiencyDecisionV1({...decisionArgs,unit_key:brother}),/insufficiency_decision_invalid/);
     await assert.rejects(recordSignalWorkspaceEngineInsufficiencyDecisionV1({...decisionArgs,repair_response_sha256:sha("tampered")}),/insufficiency_decision_invalid/);
     const decision=await recordSignalWorkspaceEngineInsufficiencyDecisionV1(decisionArgs);
     assert.equal((await recordSignalWorkspaceEngineInsufficiencyDecisionV1(decisionArgs)).decision_id,decision.decision_id);
     await query("SAVEPOINT immutable_operator_decision");
     await assert.rejects(query("UPDATE signal_workspace_interpretation_insufficiency_decisions SET reason=reason WHERE id=$1",[decision.decision_id]),/append-only/);
     await query("ROLLBACK TO SAVEPOINT immutable_operator_decision");await query("RELEASE SAVEPOINT immutable_operator_decision");
     assert.deepEqual(await ledger(),beforeLedger);
     await engine.retrySignalWorkspaceEngineV1({...access,idempotency_key:randomUUID()});
     lease=(await engine.claimSignalWorkspaceEngineV1({database,execution_id:lease.execution_id,worker_job_id:"synthetic-approved-insufficient"}))!;assert.ok(lease);
     assert.equal((await readSignalWorkspaceEngineInsufficiencyDecisionsV1({database,lease}))[0]!.decision_id,decision.decision_id);
     const interpretations=recoverSignalWorkspaceInterpretationInsufficiencyV1({batch,original_response:originalRaw,repair_response:repairRaw,unit_key:selected});
     assert.equal(interpretations.find(item=>item.cluster_id===selected)!.status,"insufficient");
     assert.equal(interpretations.find(item=>item.cluster_id===brother)!.name,"Repaired coherent sibling");
     const packet={contract_version:"workspace-engine-interpretation-result-v1",execution_id:lease.execution_id,context:batch.context,clusters:batch.clusters,editorial_repair:batch.editorial_repair,
      interpretations,operator_insufficiency:{contract_version:"workspace-interpretation-operator-insufficiency-v1",decision_id:decision.decision_id,original_response:originalRaw,repair_response:repairRaw}};
     const checkpointArgs=(body:string,key:string)=>({database,lease,call_id:repair.call_id,unit_keys:reserve.unit_keys,insufficiency_decision_id:decision.decision_id,insufficiency_packet:body,
      artifact:{artifact_key:key,artifact_type:"engine_proposals" as const,title:"Synthetic operator decision checkpoint",storage_key:`workspace-engine/${access.workspace_id}/${lease.execution_id}/${key}`,
       sha256:sha(body),size_bytes:Buffer.byteLength(body),media_type:"application/json",metadata:{}}});
     const tampered=JSON.stringify({...packet,interpretations:interpretations.map(item=>item.cluster_id===brother?{...item,name:"Altered sibling"}:item)});
     await assert.rejects(engine.checkpointSignalWorkspaceEngineInterpretationV1(checkpointArgs(tampered,"bad-sibling.json")),/insufficiency.*invalid/);
     const body=JSON.stringify(packet),checkpoint=await engine.checkpointSignalWorkspaceEngineInterpretationV1(checkpointArgs(body,"operator-recovery.json"));
     assert.equal((await engine.checkpointSignalWorkspaceEngineInterpretationV1(checkpointArgs(body,"operator-recovery.json"))).artifact_id,checkpoint.artifact_id);
     assert.equal(checkpoint.interpreted_units,3);assert.equal((await engine.readSignalWorkspaceEngineInterpretationExceptionsV1({database,lease})).length,0);
     assert.equal((await engine.readSignalWorkspaceEngineInterpretationCheckpointsV1({database,lease})).items.find(item=>item.artifact_id===checkpoint.artifact_id)!.insufficiency_decision_id,decision.decision_id);
     const sources=[first,{artifact_id:checkpoint.artifact_id,body}];
     const verified=await verifyMassLabelingSourceCheckpointsV1({...fixture.access,source_engine_execution_id:lease.execution_id,source_checkpoints:sources,
      expected_group_ids:groupKeys,expected_cluster_digests:clusterDigests,lease});
     assert.equal(verified.source_groups.find(group=>group.group_id===selected)!.status,"insufficient");
     assert.equal(verified.source_groups.find(group=>group.group_id===brother)!.name,"Repaired coherent sibling");
     const materialized=await materializeSignalWorkspaceEngineTopicsV1({database,lease,proposals:(async function*(){yield* sources;})()});
     assert.equal(materialized.topic_count,3,"materialization retains the native insufficient placeholder and both supported groups");
     assert.equal(materialized.mapping.find(item=>item.unit_key===selected)!.status,"insufficient");
     assert.equal(materialized.mapping.find(item=>item.unit_key===brother)!.status,"coherent");
     assert.deepEqual(await ledger(),beforeLedger);
     assert.deepEqual((await query("SELECT to_jsonb(artifact) body FROM analysis_artifacts artifact WHERE id=$1",[first.artifact_id])).rows[0]!.body,beforeCheckpoint);
     assert.deepEqual((await query("SELECT to_jsonb(exception) body FROM signal_workspace_interpretation_exceptions exception WHERE id=$1",[exception.exception_id])).rows[0]!.body,beforeException);
     assert.equal((await recordSignalWorkspaceEngineInsufficiencyDecisionV1(decisionArgs)).decision_id,decision.decision_id);
     complete=true;throw stop;
    }}}),error=>{if(error!==stop)console.error(error);return error===stop;});
  assert.ok(complete);
 }finally{await raw.query("ROLLBACK");raw.release();await pool.end();if(flag===undefined)delete process.env.NOISIA_MASS_LABELING_ENABLED;else process.env.NOISIA_MASS_LABELING_ENABLED=flag;}
});

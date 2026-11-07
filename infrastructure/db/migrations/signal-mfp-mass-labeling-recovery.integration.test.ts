import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import type {Pool} from "pg";
import {seedSignalTopicEditorialRenewalSourceV1,createSignalTopicEditorialRenewalSyntheticSavesV1} from "./signal-topic-editorial-renewal.synthetic.fixture";
import {buildSignalWorkspaceInterpretationBatchV1,buildSignalWorkspaceInterpretationRepairBatchV1,
  signalWorkspaceEmbeddingDigestV1 as digest,SIGNAL_WORKSPACE_MASS_LABELING_EDITORIAL_CONFIGURATION_V1 as configuration} from "@noisia/query-engine";
import * as engine from "../signal-workspace-engine";
import * as money from "../signal-workspace-engine-interpretation";
import {registerSignalWorkspaceEngineInterpretationUnitsV1,recordSignalWorkspaceEngineInterpretationRecoveryReviewV1,
  pauseSignalWorkspaceEngineInterpretationRecoveryV1} from "../signal-workspace-engine-recovery";

for(const mode of ["legacy_boolean","needs_repair","quarantine_original","quarantine_repair","terminal_successor","unsent_successor","repair_terminal_successor"] as const) test(`paid pilot recovers a failed execution without resending units (${mode})`, {
  skip:process.env.NOISIA_MFP_PG_CI!=="true",timeout:300_000,
},async()=>{
  const {openDatabase}=await import(new URL("../../../scripts/dev-corpus/guard.mjs",import.meta.url).href);
  const pool:Pool=await openDatabase(),raw=await pool.connect(),previous=process.env.NOISIA_MASS_LABELING_ENABLED;
  process.env.NOISIA_MASS_LABELING_ENABLED="true";
  await raw.query("BEGIN");let sequence=0;const stack:string[]=[];
  const query=async(sql:string,values?:unknown[])=>{
    if(sql.startsWith("BEGIN")){const key=`recovery_${++sequence}`;stack.push(key);return raw.query(`SAVEPOINT ${key}`);}
    if(sql==="COMMIT")return raw.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
    if(sql==="ROLLBACK"){const key=stack.pop()!;await raw.query(`ROLLBACK TO SAVEPOINT ${key}`);return raw.query(`RELEASE SAVEPOINT ${key}`);}
    return raw.query(sql,values);
  };
  const scoped=Object.assign(Object.create(raw),{query,release(){}});
  const database=Object.assign(Object.create(pool),{query,connect:async()=>scoped}) as Pool;
  const done=new Error("synthetic recovery assertions finished");let asserted=false;
  try{
    await assert.rejects(seedSignalTopicEditorialRenewalSourceV1({database,scoped,query,cleanup:async()=>{},
      saves:createSignalTopicEditorialRenewalSyntheticSavesV1(undefined,{brand_name:"Synthetic fixture"}),numeric_daily_cap_micro_usd:10_000_000,
      projection:{complete_output_bundle:mode==="legacy_boolean",split_guided_groups:mode==="legacy_boolean"?undefined:mode.endsWith("successor")?3:true,interpretation_configuration:configuration,
        engine_config:mode==="legacy_boolean"?{fixture:true}:{profile_version:"workspace-bertopic-mass-labeling-v1",fixture:true},
        onCheckpoint:async fixture=>{
          if(fixture.proposals.length!==(mode==="legacy_boolean"?2:1))return;
          let lease=fixture.lease;
          const access={...fixture.access,execution_id:lease.execution_id};
          if(mode==="legacy_boolean"){
            await engine.failSignalWorkspaceEngineV1({database,lease,error_code:"workspace_engine_interpretation_output_invalid"});
            const status=await engine.loadSignalWorkspaceEngineStatusV1(access);
            assert.equal(status.latest_run?.editorial_repair_recovery_eligible,false,
              "legacy profile absence is false when all receipts already have checkpoints");
            await assert.rejects(engine.retrySignalWorkspaceEngineV1({...access,idempotency_key:randomUUID()}),/workspace_engine_retry_unavailable/);
            asserted=true;throw done;
          }
          assert.equal((await engine.assertSignalWorkspaceMassLabelingRecoveryReadyV1(access)).pilot,true);
          if(mode==="needs_repair"){
            await query("SAVEPOINT nofit_preclaim_gate");
            await engine.failSignalWorkspaceEngineV1({database,lease,error_code:"workspace_engine_interpretation_output_invalid"});
            const fresh=await engine.beginSignalWorkspaceEngineV1({...fixture.access,idempotency_key:randomUUID(),embedding_run_id:lease.snapshot.embedding_run_id,
              expected_context_digest:lease.snapshot.context_digest,expected_catalog_digest:lease.snapshot.catalog_digest,engine_config:lease.snapshot.engine_config,
              claude_cap_micro_usd:lease.snapshot.claude_cap_micro_usd,interpretation_config:lease.snapshot.interpretation_config!,parent_execution_id:null});
            const beforeGate=(await query("SELECT status,execution_token,result_summary FROM signal_topic_catalog_executions WHERE id=$1",[fresh.execution_id])).rows[0];
            await assert.rejects(engine.assertSignalWorkspaceMassLabelingRecoveryReadyV1({...fixture.access,execution_id:fresh.execution_id}),/workspace_engine_interpretation_recovery_fit_required/);
            assert.deepEqual((await query("SELECT status,execution_token,result_summary FROM signal_topic_catalog_executions WHERE id=$1",[fresh.execution_id])).rows[0],beforeGate,
              "preclaim recovery gate cannot claim or fit an unfinished numerical run");
            await query("ROLLBACK TO SAVEPOINT nofit_preclaim_gate");await query("RELEASE SAVEPOINT nofit_preclaim_gate");
          }
          const fitIdentity=(await query("SELECT input_digest,result_summary->'fit_checkpoint' fit FROM signal_topic_catalog_executions WHERE id=$1",[lease.execution_id])).rows[0];
          const firstPacket=JSON.parse(fixture.proposals[0]!.body);
          const firstBatch=buildSignalWorkspaceInterpretationBatchV1(firstPacket.context,firstPacket.clusters,configuration);
          const callsBefore=await money.readSignalWorkspaceEngineInterpretationRecoveryCallsV1({database,lease});
          assert.equal(callsBefore.length,1);
          const firstCall=callsBefore[0]!;
          assert.deepEqual(firstCall.checkpointed_unit_keys,firstBatch.clusters.map(c=>c.cluster_id));
          assert.equal((await registerSignalWorkspaceEngineInterpretationUnitsV1({database,lease,call_id:firstCall.call_id,
            request_digest:firstCall.request_digest,unit_keys:firstCall.checkpointed_unit_keys,batch:firstBatch})).replayed,true);
          const assignments=[...fixture.bodies].find(([key])=>key.endsWith("/assignments.guided.jsonl"))![1];
          const secondKey=assignments.trim().split("\n").map(line=>`guided:${JSON.parse(line).stable_cluster_id}`).find(key=>key!==firstBatch.clusters[0]!.cluster_id)!;
          assert.ok(secondKey);
          const cluster={...firstBatch.clusters[0]!,cluster_id:secondKey};
          const batch=buildSignalWorkspaceInterpretationBatchV1(firstPacket.context,[cluster],configuration);
          const reserve={...access,execution_token:lease.execution_token,idempotency_key:batch.batch_key,
            request_digest:batch.request_digest,configuration,reserved_micro_usd:batch.reserved_micro_usd,
            budget_timezone:"America/Mexico_City",daily_cap_micro_usd:30_000_000,unit_keys:[secondKey]};
          const original=await money.reserveSignalWorkspaceEngineInterpretationV1(reserve);
          const token={database,call_id:original.call_id,attempt_token:original.attempt_token};
          if(mode==="terminal_successor"||mode==="unsent_successor"){
            if(mode==="terminal_successor"){
              await money.markSignalWorkspaceEngineInterpretationSentV1({...token,execution_token:lease.execution_token});
              await money.failSignalWorkspaceEngineInterpretationV1({...token,outcome:"outcome_unknown",error_code:"workspace_engine_interpretation_outcome_unknown"});
              await engine.failSignalWorkspaceEngineV1({database,lease,error_code:"workspace_engine_interpretation_outcome_unknown"});
              const window=(await query("SELECT sent_at FROM engine_cost_events WHERE id=$1",[original.call_id])).rows[0]!.sent_at;
              await money.reconcileSignalWorkspaceEngineTerminalV1({...token,workspace_id:access.workspace_id,execution_id:lease.execution_id,
                expected_request_digest:batch.request_digest,verifier_user_id:access.actor_user_id,terminal:{source:"anthropic_console",provider_request_id:"req_synthetic_terminal",provider_model:configuration.model,
                  started_at:new Date(window).toISOString(),ended_at:new Date().toISOString(),http_status:499,reason:"client_disconnected",
                  usage:{input_tokens:100,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0},
                  evidence:{storage_key:`workspace-engine/${access.workspace_id}/${lease.execution_id}/synthetic-console-receipt.json`,sha256:digest("console receipt"),size_bytes:15}}});
              await engine.retrySignalWorkspaceEngineV1({...access,idempotency_key:randomUUID()});
              lease=(await engine.claimSignalWorkspaceEngineV1({database,execution_id:lease.execution_id,worker_job_id:"synthetic-terminal-successor"}))!;
              assert.ok(lease);
            }else await money.failSignalWorkspaceEngineInterpretationV1({...token,outcome:"definitely_not_sent",error_code:"workspace_engine_interpretation_provider_unavailable"});
            const beforeBudget=await money.loadSignalWorkspaceEngineInterpretationBudgetV1(access);
            const beforeOriginal=(await query("SELECT call_state,reserved_micro_usd,settled_micro_usd,metadata FROM engine_cost_events WHERE id=$1",[original.call_id])).rows[0];
            const successorArgs={...reserve,execution_token:lease.execution_token,idempotency_key:`${batch.batch_key}:retry:${original.call_id}`,retry_of_call_id:original.call_id};
            const successor=await money.reserveSignalWorkspaceEngineInterpretationV1(successorArgs);
            const sent=await money.markSignalWorkspaceEngineInterpretationSentV1({database,call_id:successor.call_id,attempt_token:successor.attempt_token,execution_token:lease.execution_token});
            assert.equal(sent.send_authorized,true);
            assert.equal((await money.markSignalWorkspaceEngineInterpretationSentV1({database,call_id:successor.call_id,attempt_token:successor.attempt_token,execution_token:lease.execution_token})).send_authorized,false);
            assert.equal((await money.reserveSignalWorkspaceEngineInterpretationV1(successorArgs)).call_id,successor.call_id);
            assert.deepEqual((await query("SELECT call_state,reserved_micro_usd,settled_micro_usd,metadata FROM engine_cost_events WHERE id=$1",[original.call_id])).rows[0],beforeOriginal);
            const afterBudget=await money.loadSignalWorkspaceEngineInterpretationBudgetV1(access);
            assert.equal(afterBudget.reserved_micro_usd,beforeBudget.reserved_micro_usd+successor.reserved_micro_usd,
              "known terminal exposure remains reserved when its one authorized successor is sent");
            assert.equal((await query("SELECT count(*)::int n FROM engine_cost_events WHERE catalog_execution_id=$1",[lease.execution_id])).rows[0]!.n,3);
            const successorToken={database,call_id:successor.call_id,attempt_token:successor.attempt_token};
            await money.persistSignalWorkspaceEngineInterpretationResponseV1({...successorToken,response:{storage_key:`workspace-engine/${access.workspace_id}/${lease.execution_id}/paid-successor.json`,
              sha256:digest("paid successor"),size_bytes:14,http_status:200,provider_request_id:null}});
            await money.settleSignalWorkspaceEngineInterpretationV1({...successorToken,usage:{input_tokens:100,output_tokens:50,cache_read_input_tokens:0,cache_creation_input_tokens:0}});
            await assert.rejects(reserveNextGroup(),/workspace_engine_interpretation_receipt_recovery_required/,
              "a terminal remains unresolved until its same-request successor owns a valid checkpoint");
            await checkpointRecovered(successor.call_id,batch,"successor");
            await reserveNextGroup();
            assert.deepEqual((await query("SELECT call_state,reserved_micro_usd,settled_micro_usd,metadata FROM engine_cost_events WHERE id=$1",[original.call_id])).rows[0],beforeOriginal);
            asserted=true;throw done;
          }
          await money.markSignalWorkspaceEngineInterpretationSentV1({...token,execution_token:lease.execution_token});
          await money.persistSignalWorkspaceEngineInterpretationResponseV1({...token,response:{storage_key:`workspace-engine/${access.workspace_id}/${lease.execution_id}/paid-original.json`,
            sha256:digest("paid original"),size_bytes:13,http_status:200,provider_request_id:null}});
          await money.settleSignalWorkspaceEngineInterpretationV1({...token,usage:{input_tokens:100,output_tokens:50,cache_read_input_tokens:0,cache_creation_input_tokens:0}});
          async function checkpointRecovered(callId:string,recoveredBatch:typeof batch,suffix:string){
            const body=JSON.stringify({contract_version:"workspace-engine-interpretation-result-v1",execution_id:lease.execution_id,
              context:recoveredBatch.context,clusters:recoveredBatch.clusters,
              interpretations:firstPacket.interpretations.map((result:Record<string,unknown>)=>({...result,cluster_id:secondKey})),
              ...(recoveredBatch.editorial_repair?{editorial_repair:recoveredBatch.editorial_repair}:{})});
            const sha=`sha256:${(await import("node:crypto")).createHash("sha256").update(body).digest("hex")}`;
            return engine.checkpointSignalWorkspaceEngineInterpretationV1({database,lease,call_id:callId,unit_keys:[secondKey],
              artifact:{artifact_key:`recovered-${suffix}.json`,artifact_type:"engine_proposals",title:"Synthetic recovered transport response",
                storage_key:`workspace-engine/${access.workspace_id}/${lease.execution_id}/recovered-${suffix}.json`,sha256:sha,size_bytes:Buffer.byteLength(body),media_type:"application/json",metadata:{}}});
          }
          async function reserveNextGroup(){
            const nextKey=assignments.trim().split("\n").map(line=>`guided:${JSON.parse(line).stable_cluster_id}`)
              .find(key=>![firstBatch.clusters[0]!.cluster_id,secondKey].includes(key))!;
            assert.ok(nextKey,"the next unpaid unit belongs to the same sealed fit");
            const nextBatch=buildSignalWorkspaceInterpretationBatchV1(firstPacket.context,[{...cluster,cluster_id:nextKey}],configuration);
            const next=await money.reserveSignalWorkspaceEngineInterpretationV1({...reserve,execution_token:lease.execution_token,
              idempotency_key:nextBatch.batch_key,request_digest:nextBatch.request_digest,unit_keys:[nextKey]});
            assert.equal((await money.markSignalWorkspaceEngineInterpretationSentV1({database,call_id:next.call_id,attempt_token:next.attempt_token,
              execution_token:lease.execution_token})).send_authorized,true,"a checkpointed transport successor unblocks the next unpaid fit unit");
            assert.deepEqual((await query("SELECT input_digest,result_summary->'fit_checkpoint' fit FROM signal_topic_catalog_executions WHERE id=$1",[lease.execution_id])).rows[0],fitIdentity,
              "transport and repair successors keep the same execution input and sealed fit");
          }
          let paidRepair:Awaited<ReturnType<typeof money.reserveSignalWorkspaceEngineInterpretationV1>>|null=null;
          let repairBatch:ReturnType<typeof buildSignalWorkspaceInterpretationRepairBatchV1>|null=null;
          if(mode.startsWith("quarantine")){
            await recordSignalWorkspaceEngineInterpretationRecoveryReviewV1({database,lease,call_id:original.call_id,request_digest:batch.request_digest,
              response_sha256:digest("paid original"),unit_keys:[secondKey],outcome:"needs_repair",validator_version:"pilot30-v1"});
            repairBatch=buildSignalWorkspaceInterpretationRepairBatchV1(batch,{source_call_id:original.call_id,source_response_sha256:digest("paid original"),diagnostic:"output_invalid"});
            paidRepair=await money.reserveSignalWorkspaceEngineInterpretationV1({...reserve,idempotency_key:repairBatch.batch_key,
              request_digest:repairBatch.request_digest,editorial_repair:repairBatch.editorial_repair!});
            const repairToken={database,call_id:paidRepair.call_id,attempt_token:paidRepair.attempt_token};
            await money.markSignalWorkspaceEngineInterpretationSentV1({...repairToken,execution_token:lease.execution_token});
            await money.persistSignalWorkspaceEngineInterpretationResponseV1({...repairToken,response:{storage_key:`workspace-engine/${access.workspace_id}/${lease.execution_id}/paid-repair.json`,
              sha256:digest("paid repair"),size_bytes:11,http_status:200,provider_request_id:null}});
            await money.settleSignalWorkspaceEngineInterpretationV1({...repairToken,usage:{input_tokens:100,output_tokens:50,cache_read_input_tokens:0,cache_creation_input_tokens:0}});
            await engine.quarantineSignalWorkspaceEngineInterpretationBatchV1({database,lease,original_call_id:original.call_id,repair_call_id:paidRepair.call_id,
              original_request_digest:batch.request_digest,repair_request_digest:repairBatch.request_digest,original_response_sha256:digest("paid original"),repair_response_sha256:digest("paid repair"),
              batch_digest:digest(batch),unit_keys:[secondKey],validator_version:"legacy10-v1"});
          }
          const fitBefore=(await query("SELECT input_digest,result_summary->'fit_checkpoint' fit FROM signal_topic_catalog_executions WHERE id=$1",[lease.execution_id])).rows[0];
          const ledgerBefore=(await query("SELECT id,request_seal,call_state,response_sha256,settled_micro_usd FROM engine_cost_events WHERE catalog_execution_id=$1 ORDER BY id",[lease.execution_id])).rows;
          if(!mode.startsWith("quarantine"))await engine.failSignalWorkspaceEngineV1({database,lease,error_code:"workspace_engine_interpretation_output_invalid"});
          else await engine.completeSignalWorkspaceEngineAnalysisWithExceptionsV1({database,lease});
          const retryKey=randomUUID();
          const retried=await engine.retrySignalWorkspaceEngineV1({...access,idempotency_key:retryKey});
          assert.equal(retried.execution_id,lease.execution_id);
          lease=(await engine.claimSignalWorkspaceEngineV1({database,execution_id:lease.execution_id,worker_job_id:"synthetic-offline-recovery"}))!;
          assert.ok(lease);
          const read=await money.readSignalWorkspaceEngineInterpretationRecoveryCallsV1({database,lease});
          assert.equal(read.length,mode.startsWith("quarantine")?3:2);assert.equal(read.find(c=>c.call_id===original.call_id)!.response!.http_status,200);
          if(mode.startsWith("quarantine")){
            const beforeException=(await query("SELECT row_to_json(exception) body FROM signal_workspace_interpretation_exceptions exception WHERE execution_id=$1",[lease.execution_id])).rows;
            assert.equal((await engine.readSignalWorkspaceEngineInterpretationExceptionsV1({database,lease})).length,1);
            const recovery=await engine.readSignalWorkspaceEngineInterpretationRecoveryRequestDigestsV1({database,lease});
            assert.ok(recovery.includes(batch.request_digest));assert.ok(recovery.includes(repairBatch!.request_digest));
            const resolvedBatch=mode==="quarantine_original"?batch:repairBatch!;
            const resolvedCall=mode==="quarantine_original"?original:paidRepair!;
            const body=JSON.stringify({contract_version:"workspace-engine-interpretation-result-v1",execution_id:lease.execution_id,
              context:resolvedBatch.context,clusters:resolvedBatch.clusters,
              interpretations:firstPacket.interpretations.map((result:Record<string,unknown>)=>({...result,cluster_id:secondKey})),
              ...(resolvedBatch.editorial_repair?{editorial_repair:resolvedBatch.editorial_repair}:{})});
            const sha=`sha256:${(await import("node:crypto")).createHash("sha256").update(body).digest("hex")}`;
            const checkpointArgs={database,lease,call_id:resolvedCall.call_id,unit_keys:[secondKey],artifact:{artifact_key:`recovered-${resolvedCall.call_id}.json`,
              artifact_type:"engine_proposals" as const,title:"Synthetic recovered paid response",storage_key:`workspace-engine/${access.workspace_id}/${lease.execution_id}/recovered.json`,
              sha256:sha,size_bytes:Buffer.byteLength(body),media_type:"application/json",metadata:{}}};
            const checkpoint=await engine.checkpointSignalWorkspaceEngineInterpretationV1(checkpointArgs);
            assert.equal((await engine.checkpointSignalWorkspaceEngineInterpretationV1(checkpointArgs)).artifact_id,checkpoint.artifact_id);
            assert.equal((await engine.readSignalWorkspaceEngineInterpretationExceptionsV1({database,lease})).length,0);
            assert.deepEqual((await query("SELECT row_to_json(exception) body FROM signal_workspace_interpretation_exceptions exception WHERE execution_id=$1",[lease.execution_id])).rows,beforeException,
              "resolving quarantine keeps original exception and both raw SHAs byte for byte");
            const resolution=(await query("SELECT original_response_sha256,repair_response_sha256,resolved_response_sha256 FROM signal_workspace_interpretation_exception_resolutions WHERE execution_id=$1",[lease.execution_id])).rows;
            const summary=(await query("SELECT result_summary FROM signal_topic_catalog_executions WHERE id=$1",[lease.execution_id])).rows[0]!.result_summary;
            assert.equal(summary.interpretation_exceptions,0);assert.equal(summary.interpretation_exception_units,0);
            assert.equal(summary.interpretation_exceptions_historical,1);assert.equal(summary.interpretation_exceptions_resolved,1);
            assert.equal(summary.interpretation_exception_units_historical,1);assert.equal(summary.interpretation_exception_units_resolved,1);
            assert.equal(resolution.length,1);assert.equal(resolution[0]!.original_response_sha256,digest("paid original"));
            assert.equal(resolution[0]!.repair_response_sha256,digest("paid repair"));
            assert.equal(resolution[0]!.resolved_response_sha256,digest(mode==="quarantine_original"?"paid original":"paid repair"));
            assert.deepEqual((await query("SELECT id,request_seal,call_state,response_sha256,settled_micro_usd FROM engine_cost_events WHERE catalog_execution_id=$1 ORDER BY id",[lease.execution_id])).rows,ledgerBefore);
            await assert.rejects(registerSignalWorkspaceEngineInterpretationUnitsV1({database,lease:{...lease,workspace_id:randomUUID()},call_id:original.call_id,
              request_digest:batch.request_digest,unit_keys:[secondKey],batch}),/workspace_engine_lease_conflict/);
            const regrouped=buildSignalWorkspaceInterpretationBatchV1(firstPacket.context,[firstBatch.clusters[0]!,cluster].sort((a,b)=>a.cluster_id.localeCompare(b.cluster_id)),configuration);
            await assert.rejects(money.reserveSignalWorkspaceEngineInterpretationV1({...reserve,idempotency_key:randomUUID(),execution_token:lease.execution_token,
              request_digest:regrouped.request_digest,unit_keys:regrouped.clusters.map(c=>c.cluster_id)}),/workspace_engine_interpretation_unit_already_sent/);
            const paused=await pauseSignalWorkspaceEngineInterpretationRecoveryV1({database,lease,reason:"unprocessed_units_pending"});
            assert.equal(paused.pending_units,0);
            const status=await engine.loadSignalWorkspaceEngineStatusV1(access);
            assert.equal(status.latest_run?.editorial_repair_recovery_eligible,true,
              "an eligible pilot retains its recovery authority after every paid group is checkpointed");
            asserted=true;throw done;
          }
          const review={database,lease,call_id:original.call_id,request_digest:batch.request_digest,
            response_sha256:digest("paid original"),unit_keys:[secondKey],outcome:"needs_repair" as const,validator_version:"pilot30-v1"};
          assert.equal((await recordSignalWorkspaceEngineInterpretationRecoveryReviewV1(review)).replayed,false);
          assert.equal((await recordSignalWorkspaceEngineInterpretationRecoveryReviewV1(review)).replayed,true);
          const paused=await pauseSignalWorkspaceEngineInterpretationRecoveryV1({database,lease,reason:"bounded_repair_pending"});
          assert.equal(paused.status,"failed");assert.equal(paused.recovery_status,"bounded_repair_pending");
          assert.deepEqual((await query("SELECT input_digest,result_summary->'fit_checkpoint' fit FROM signal_topic_catalog_executions WHERE id=$1",[lease.execution_id])).rows[0],fitBefore);
          assert.deepEqual((await query("SELECT id,request_seal,call_state,response_sha256,settled_micro_usd FROM engine_cost_events WHERE catalog_execution_id=$1 ORDER BY id",[lease.execution_id])).rows,ledgerBefore,
            "offline review/pause neither reserves nor changes paid receipts");
          assert.equal((await engine.retrySignalWorkspaceEngineV1({...access,idempotency_key:retryKey})).replayed,true);
          assert.equal((await query("SELECT status FROM signal_topic_catalog_executions WHERE id=$1",[lease.execution_id])).rows[0]!.status,"failed",
            "replaying the prior retry key cannot dispatch again after an offline pause");
          await engine.retrySignalWorkspaceEngineV1({...access,idempotency_key:randomUUID()});
          lease=(await engine.claimSignalWorkspaceEngineV1({database,execution_id:lease.execution_id,worker_job_id:"synthetic-bounded-repair"}))!;
          assert.ok(lease);
          const regrouped=buildSignalWorkspaceInterpretationBatchV1(firstPacket.context,[firstBatch.clusters[0]!,cluster].sort((a,b)=>a.cluster_id.localeCompare(b.cluster_id)),configuration);
          await assert.rejects(money.reserveSignalWorkspaceEngineInterpretationV1({...reserve,execution_token:lease.execution_token,
            idempotency_key:randomUUID(),request_digest:regrouped.request_digest,unit_keys:regrouped.clusters.map(c=>c.cluster_id)}),/workspace_engine_interpretation_(?:unit|receipt)/);
          const repair=buildSignalWorkspaceInterpretationRepairBatchV1(batch,{source_call_id:original.call_id,source_response_sha256:digest("paid original"),diagnostic:"output_invalid"});
          const repairArgs={...reserve,execution_token:lease.execution_token,idempotency_key:repair.batch_key,
            request_digest:repair.request_digest,editorial_repair:repair.editorial_repair!};
          const repairCall=await money.reserveSignalWorkspaceEngineInterpretationV1(repairArgs);
          assert.equal((await money.reserveSignalWorkspaceEngineInterpretationV1(repairArgs)).call_id,repairCall.call_id);
          if(mode==="repair_terminal_successor"){
            const repairToken={database,call_id:repairCall.call_id,attempt_token:repairCall.attempt_token};
            await money.markSignalWorkspaceEngineInterpretationSentV1({...repairToken,execution_token:lease.execution_token});
            await money.failSignalWorkspaceEngineInterpretationV1({...repairToken,outcome:"outcome_unknown",error_code:"workspace_engine_interpretation_outcome_unknown"});
            await engine.failSignalWorkspaceEngineV1({database,lease,error_code:"workspace_engine_interpretation_outcome_unknown"});
            const window=(await query("SELECT sent_at FROM engine_cost_events WHERE id=$1",[repairCall.call_id])).rows[0]!.sent_at;
            await money.reconcileSignalWorkspaceEngineTerminalV1({...repairToken,workspace_id:access.workspace_id,execution_id:lease.execution_id,
              expected_request_digest:repair.request_digest,verifier_user_id:access.actor_user_id,terminal:{source:"anthropic_console",provider_request_id:"req_synthetic_repair_terminal",provider_model:configuration.model,
                started_at:new Date(window).toISOString(),ended_at:new Date().toISOString(),http_status:499,reason:"client_disconnected",
                usage:{input_tokens:100,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0},
                evidence:{storage_key:`workspace-engine/${access.workspace_id}/${lease.execution_id}/synthetic-repair-terminal.json`,sha256:digest("repair console receipt"),size_bytes:22}}});
            const terminalBefore=(await query("SELECT call_state,reserved_micro_usd,settled_micro_usd,metadata FROM engine_cost_events WHERE id=$1",[repairCall.call_id])).rows[0];
            await engine.retrySignalWorkspaceEngineV1({...access,idempotency_key:randomUUID()});
            lease=(await engine.claimSignalWorkspaceEngineV1({database,execution_id:lease.execution_id,worker_job_id:"synthetic-repair-terminal-successor"}))!;
            assert.ok(lease);
            const successor=await money.reserveSignalWorkspaceEngineInterpretationV1({...repairArgs,execution_token:lease.execution_token,
              idempotency_key:`${repair.batch_key}:retry:${repairCall.call_id}`,retry_of_call_id:repairCall.call_id});
            const successorToken={database,call_id:successor.call_id,attempt_token:successor.attempt_token};
            assert.equal((await money.markSignalWorkspaceEngineInterpretationSentV1({...successorToken,execution_token:lease.execution_token})).send_authorized,true);
            await money.persistSignalWorkspaceEngineInterpretationResponseV1({...successorToken,response:{storage_key:`workspace-engine/${access.workspace_id}/${lease.execution_id}/paid-repair-successor.json`,
              sha256:digest("paid repair successor"),size_bytes:21,http_status:200,provider_request_id:null}});
            await money.settleSignalWorkspaceEngineInterpretationV1({...successorToken,usage:{input_tokens:100,output_tokens:50,cache_read_input_tokens:0,cache_creation_input_tokens:0}});
            await assert.rejects(reserveNextGroup(),/workspace_engine_interpretation_receipt_recovery_required/);
            await checkpointRecovered(successor.call_id,repair,"repair-successor");await reserveNextGroup();
            assert.deepEqual((await query("SELECT call_state,reserved_micro_usd,settled_micro_usd,metadata FROM engine_cost_events WHERE id=$1",[repairCall.call_id])).rows[0],terminalBefore,
              "paid repair successor preserves the terminal repair's original exposure and evidence");
            const receipts=await money.readSignalWorkspaceEngineInterpretationRecoveryCallsV1({database,lease});
            assert.ok(receipts.find(call=>call.call_id===original.call_id)!.checkpointed_unit_keys.includes(secondKey));
            asserted=true;throw done;
          }
          assert.equal((await query("SELECT count(*)::int n FROM engine_cost_events WHERE catalog_execution_id=$1",[lease.execution_id])).rows[0]!.n,3,
            "only one repair is newly reserved after explicit continuation");
          asserted=true;throw done;
        }}}),error=>{if(error!==done)console.error(error);return error===done;});
    assert.ok(asserted);
  }finally{
    await raw.query("ROLLBACK");raw.release();await pool.end();
    if(previous===undefined)delete process.env.NOISIA_MASS_LABELING_ENABLED;else process.env.NOISIA_MASS_LABELING_ENABLED=previous;
  }
});

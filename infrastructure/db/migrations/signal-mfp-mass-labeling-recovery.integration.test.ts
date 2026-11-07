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

test("paid pilot recovers a failed execution without resending quarantined or regrouped units", {
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
      projection:{split_guided_groups:true,interpretation_configuration:configuration,
        engine_config:{profile_version:"workspace-bertopic-mass-labeling-v1",fixture:true},
        onCheckpoint:async fixture=>{
          if(fixture.proposals.length!==1)return;
          let lease=fixture.lease;
          const access={...fixture.access,execution_id:lease.execution_id};
          const firstPacket=JSON.parse(fixture.proposals[0]!.body);
          const firstBatch=buildSignalWorkspaceInterpretationBatchV1(firstPacket.context,firstPacket.clusters,configuration);
          const callsBefore=await money.readSignalWorkspaceEngineInterpretationRecoveryCallsV1({database,lease});
          assert.equal(callsBefore.length,1);
          const firstCall=callsBefore[0]!;
          assert.deepEqual(firstCall.checkpointed_unit_keys,firstBatch.clusters.map(c=>c.cluster_id));
          assert.equal((await registerSignalWorkspaceEngineInterpretationUnitsV1({database,lease,call_id:firstCall.call_id,
            request_digest:firstCall.request_digest,unit_keys:firstCall.checkpointed_unit_keys,batch:firstBatch})).replayed,true);
          const secondKey=firstBatch.clusters[0]!.cluster_id.endsWith("alternate")?"guided:stable_two":"guided:stable_two_alternate";
          const cluster={...firstBatch.clusters[0]!,cluster_id:secondKey};
          const batch=buildSignalWorkspaceInterpretationBatchV1(firstPacket.context,[cluster],configuration);
          const reserve={...access,execution_token:lease.execution_token,idempotency_key:batch.batch_key,
            request_digest:batch.request_digest,configuration,reserved_micro_usd:batch.reserved_micro_usd,
            budget_timezone:"America/Mexico_City",daily_cap_micro_usd:30_000_000,unit_keys:[secondKey]};
          const original=await money.reserveSignalWorkspaceEngineInterpretationV1(reserve);
          const token={database,call_id:original.call_id,attempt_token:original.attempt_token};
          await money.markSignalWorkspaceEngineInterpretationSentV1({...token,execution_token:lease.execution_token});
          await money.persistSignalWorkspaceEngineInterpretationResponseV1({...token,response:{storage_key:`workspace-engine/${access.workspace_id}/${lease.execution_id}/paid-original.json`,
            sha256:digest("paid original"),size_bytes:13,http_status:200,provider_request_id:null}});
          await money.settleSignalWorkspaceEngineInterpretationV1({...token,usage:{input_tokens:100,output_tokens:50,cache_read_input_tokens:0,cache_creation_input_tokens:0}});
          const fitBefore=(await query("SELECT input_digest,result_summary->'fit_checkpoint' fit FROM signal_topic_catalog_executions WHERE id=$1",[lease.execution_id])).rows[0];
          const ledgerBefore=(await query("SELECT id,request_seal,call_state,response_sha256,settled_micro_usd FROM engine_cost_events WHERE catalog_execution_id=$1 ORDER BY id",[lease.execution_id])).rows;
          await engine.failSignalWorkspaceEngineV1({database,lease,error_code:"workspace_engine_interpretation_output_invalid"});
          const retried=await engine.retrySignalWorkspaceEngineV1({...access,idempotency_key:randomUUID()});
          assert.equal(retried.execution_id,lease.execution_id);
          lease=(await engine.claimSignalWorkspaceEngineV1({database,execution_id:lease.execution_id,worker_job_id:"synthetic-offline-recovery"}))!;
          assert.ok(lease);
          const read=await money.readSignalWorkspaceEngineInterpretationRecoveryCallsV1({database,lease});
          assert.equal(read.length,2);assert.equal(read.find(c=>c.call_id===original.call_id)!.response!.http_status,200);
          const review={database,lease,call_id:original.call_id,request_digest:batch.request_digest,
            response_sha256:digest("paid original"),unit_keys:[secondKey],outcome:"needs_repair" as const,validator_version:"pilot30-v1"};
          assert.equal((await recordSignalWorkspaceEngineInterpretationRecoveryReviewV1(review)).replayed,false);
          assert.equal((await recordSignalWorkspaceEngineInterpretationRecoveryReviewV1(review)).replayed,true);
          const paused=await pauseSignalWorkspaceEngineInterpretationRecoveryV1({database,lease,reason:"bounded_repair_pending"});
          assert.equal(paused.status,"failed");assert.equal(paused.recovery_status,"bounded_repair_pending");
          assert.deepEqual((await query("SELECT input_digest,result_summary->'fit_checkpoint' fit FROM signal_topic_catalog_executions WHERE id=$1",[lease.execution_id])).rows[0],fitBefore);
          assert.deepEqual((await query("SELECT id,request_seal,call_state,response_sha256,settled_micro_usd FROM engine_cost_events WHERE catalog_execution_id=$1 ORDER BY id",[lease.execution_id])).rows,ledgerBefore,
            "offline review/pause neither reserves nor changes paid receipts");
          await engine.retrySignalWorkspaceEngineV1({...access,idempotency_key:randomUUID()});
          lease=(await engine.claimSignalWorkspaceEngineV1({database,execution_id:lease.execution_id,worker_job_id:"synthetic-bounded-repair"}))!;
          assert.ok(lease);
          const regrouped=buildSignalWorkspaceInterpretationBatchV1(firstPacket.context,[firstBatch.clusters[0]!,cluster],configuration);
          await assert.rejects(money.reserveSignalWorkspaceEngineInterpretationV1({...reserve,execution_token:lease.execution_token,
            idempotency_key:randomUUID(),request_digest:regrouped.request_digest,unit_keys:regrouped.clusters.map(c=>c.cluster_id)}),/workspace_engine_interpretation_(?:unit|receipt)/);
          const repair=buildSignalWorkspaceInterpretationRepairBatchV1(batch,{source_call_id:original.call_id,source_response_sha256:digest("paid original"),diagnostic:"output_invalid"});
          const repairArgs={...reserve,execution_token:lease.execution_token,idempotency_key:repair.batch_key,
            request_digest:repair.request_digest,editorial_repair:repair.editorial_repair!};
          const repairCall=await money.reserveSignalWorkspaceEngineInterpretationV1(repairArgs);
          assert.equal((await money.reserveSignalWorkspaceEngineInterpretationV1(repairArgs)).call_id,repairCall.call_id);
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

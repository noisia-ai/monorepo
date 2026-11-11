import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {massLabelingReceiptRecoveryFixtureV2} from "../../../../packages/query-engine/src/signal-mass-labeling-receipt-recovery-v2.synthetic.fixture";
import {signalWorkspaceEmbeddingDigestV1 as digest,SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,signalWorkspaceMassLabelingConfigV1} from "@noisia/query-engine";
import type {SignalWorkspaceEngineLeaseV1,SignalWorkspaceEngineInterpretationCallV1} from "@noisia/db";
import {consolidateMassLabelingGroupsV1} from "./signal-mass-labeling-consolidation";
const sha=(value:string|Uint8Array)=>`sha256:${createHash('sha256').update(value).digest('hex')}`;

test("native worker replays the settled V2 raw with no reserve, send or ledger rewrite and sealed adoption provenance",async()=>{
 const f=massLabelingReceiptRecoveryFixtureV2();const directory=await mkdtemp(join(tmpdir(),'native-global-v2-'));
 try{
 const lease={input_digest:sha("synthetic snapshot"),workspace_id:f.batch.workspace_id,execution_id:f.batch.source_engine_execution_id,execution_token:f.call_id,
  snapshot:{contract_version:"workspace-topic-engine-v1",taxonomy_profile_id:f.call_id,preparation_run_id:f.call_id,embedding_run_id:f.call_id,input_revision:"1",context_digest:sha("context"),catalog_digest:sha("catalog"),prototype_plan_digest:sha("plan"),expected_roots:80,expected_chunks:80,expected_guides:0,parent_execution_id:null,context_refs:[],workspace_id:f.batch.workspace_id,mass_labeling_product:true,embedding_profile:SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1,
   engine_config:signalWorkspaceMassLabelingConfigV1(80),claude_cap_micro_usd:null,
   interpretation_config:{call_configuration:f.batch.configuration,budget_timezone:'UTC',daily_cap_micro_usd:null}}} as SignalWorkspaceEngineLeaseV1;
 const response={storage_key:`workspace-engine/${lease.workspace_id}/${lease.execution_id}/global.json`,sha256:sha(f.raw),size_bytes:Buffer.byteLength(f.raw),http_status:200,provider_request_id:'synthetic-paid',complete:true};
 const call={call_id:f.call_id,workspace_id:lease.workspace_id,execution_id:lease.execution_id,request_digest:f.batch.request_digest,
  state:'settled',attempt_token:f.call_id,response,editorial_repair:null,settled_micro_usd:1500} as SignalWorkspaceEngineInterpretationCallV1;
 const before=structuredClone(call);const packets=await Promise.all(f.batch.source_groups.map(async g=>{const file=join(directory,g.source_artifact_id+'.json');await writeFile(file,JSON.stringify({synthetic:true}));return{artifact_id:g.source_artifact_id,file};}));
 let reserves=0,sends=0,persists=0;let artifactBytes='';
 const denied=async()=>{throw Error('no mutation permitted');};
 const output=await consolidateMassLabelingGroupsV1({database:{} as never,lease,actor_user_id:f.call_id,proposals:packets,
  expected_group_ids:f.batch.source_groups.map(g=>g.group_id),expected_cluster_digests:Object.fromEntries(f.batch.source_groups.map(g=>[g.group_id,g.cluster_digest])),directory,
  recovery_only:true,recovery_call:call,provider_enabled:false,send:async()=>{sends++;return denied();},
  storage:{get:async args=>{assert.equal(args.stored.sha256,response.sha256);await writeFile(args.destination,f.raw);},put:async args=>{artifactBytes=await readFile(args.file,'utf8');assert.equal(sha(artifactBytes),args.sha256);return{storage_key:'synthetic-artifact',sha256:args.sha256,size_bytes:args.size_bytes,media_type:args.media_type};}},
  stores:{verifySources:async()=>({source_groups:f.batch.source_groups,source_groups_digest:f.batch.source_groups_digest}) as never,
   categoryContext:async()=>f.batch.category_context!,reserve:async()=>{reserves++;return denied();},sent:denied,response:denied,fail:denied,
   settle:async()=>{assert.equal(call.state,'settled');return call;},persist:async args=>{persists++;assert.equal(args.artifact.metadata.recovery_decision_digest,digest(f.decision));return{artifact_id:f.call_id} as never;},
   receiptDecision:async()=>({decision_id:f.call_id,workspace_id:lease.workspace_id,execution_id:lease.execution_id,call_id:f.call_id,
    request_digest:f.batch.request_digest,response_sha256:sha(f.raw),source_groups_digest:f.batch.source_groups_digest,decision_digest:digest(f.decision),decision:f.decision}) as never,
  }});
 assert.equal(output.output.topics.length,2);assert.equal(persists,1);assert.equal(reserves,0);assert.equal(sends,0);assert.deepEqual(call,before);
 const packet=JSON.parse(artifactBytes);assert.equal(packet.raw_response,f.raw);assert.equal(packet.operator_receipt_recovery.decision_digest,digest(f.decision));
 assert.deepEqual(packet.configuration,f.batch.configuration);assert.deepEqual(packet.category_context,f.batch.category_context);
 }finally{await rm(directory,{recursive:true,force:true});}
});

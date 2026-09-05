import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { signalTopicEvaluationDigestV2 } from "@noisia/query-engine";

import { SIGNAL_TOPIC_EVALUATION_LAB_V2_PROVIDER_CREDENTIAL_NAME,
  parseSignalTopicEvaluationLabTargetV2,preflightSignalTopicEvaluationLabV2,
  signalTopicEvaluationLabProviderConfiguredV2 } from "./preflight-signal-topic-evaluation-lab-v2";

const digest=(value:string)=>signalTopicEvaluationDigestV2(value);
const clone="noisia_topic_eval_lab_20260904_a";
const target=parseSignalTopicEvaluationLabTargetV2(`postgres://local@127.0.0.1:55439/${clone}`,clone);
const artifacts={records:21195,labels:21195,topics:115,assigned:11186,outliers:10009,
  source_manifest_digest:digest("source-manifest"),packet_source_manifest_digest:digest("packet-source"),
  source_export_digest:digest("source-export"),assignment_digest:digest("assignment"),
  result_digest:digest("result"),packet_file_digest:digest("packet-file"),packet_digest:digest("packet"),
  artifact_binding_digest:digest("artifact-binding")};
const authority={snapshots:1,catalog_entries:116,historical_proposals:115,canonical_roots:21195,
  unique_assignment_indexes:21195,unique_mentions:21195,unique_source_records:21195,assigned:11186,
  outliers:10009,state:"frozen",import_contract_version:"signal-topic-evaluation-frozen-membership-import-v1",
  source_run_key:"backend-10c2c-2026-08-21-final-2-bertopic-bge-detail-seed-17",
  source_algorithm_key:"bertopic-bge-detail",source_seed:17,snapshot_digest:digest("snapshot"),
  rights_digest:digest("rights"),semantic_context_authority_digest:digest("semantic"),
  source_manifest_digest:artifacts.source_manifest_digest,
  packet_source_manifest_digest:artifacts.packet_source_manifest_digest,
  source_export_digest:artifacts.source_export_digest,source_assignment_digest:artifacts.assignment_digest,
  source_result_digest:artifacts.result_digest,source_packet_file_digest:artifacts.packet_file_digest,
  packet_digest:artifacts.packet_digest,artifact_binding_digest:artifacts.artifact_binding_digest,
  membership_binding_digest:digest("membership-binding")};
const ledger=[
  {ordinal:112,migration_name:"0112_signal_topic_evaluation_full_evidence_control_plane.sql",
    checksum_sha256:"sha256:51f6fbff712ec1737b41da9997bda86b068abb81f4edafc9a338af590c462ab5",disposition:"applied"},
  {ordinal:113,migration_name:"0113_signal_topic_evaluation_full_evidence_execution_authority.sql",
    checksum_sha256:"sha256:8bb7f5be275d33d4f284f72a9e882314f488466ccdd3adee3ade2acb195f0f71",disposition:"applied"},
  {ordinal:114,migration_name:"0114_signal_topic_evaluation_v2_execution_outbox.sql",
    checksum_sha256:"sha256:f63774eae48b6fc3332feafdd8d033afeb8d4ae44d5479fd87ea44fa26e02582",disposition:"applied"}];

function harness(changes:{authority?:Record<string,unknown>;work?:Record<string,number>;
  sentinels?:Record<string,boolean>}={}){
  const statements:string[]=[];const receipts:unknown[]=[];
  const client={query:async<T=Record<string,unknown>>(sql:string):Promise<{rows:T[]}>=>{statements.push(sql);
    let rows:unknown[];
    if(sql.startsWith("BEGIN")||sql==="ROLLBACK")rows=[];
    else if(sql.includes("current_database()"))rows=[{database_name:clone,read_only:"on"}];
    else if(sql.includes("FROM signal_topic_evaluation_v2_snapshots snapshot"))rows=[{...authority,
      ...changes.authority}];
    else if(sql.includes("migration_ledger"))rows=ledger;
    else if(sql.includes("pending_only_candidates"))rows=[{review_operations:true,
      editorial_revisions:true,review_events:true,pending_only_candidates:true,
      no_adoption_publication_serving:true,...changes.sentinels}];
    else if(sql.includes("execution_authorizations) authorities"))rows=[{authorities:0,runs:0,
      outboxes:0,retrievals:0,model_turns:0,candidates:0,candidate_evidence:0,rankings:0,
      review_operations:0,editorial_revisions:0,review_events:0,provider_calls:0,...changes.work}];
    else if(sql.includes("txid_current_if_assigned"))rows=[{value:null}];
    else throw new Error("unexpected query");
    return{rows:rows as T[]};},release:()=>undefined};
  return{pool:{connect:async()=>client},statements,receipts,dependencies:{now:()=>0,
    verifyArtifacts:async()=>artifacts,migration0115Digest:async()=>
      "sha256:7a6b61cc16dba808e0c98645855e2597db8d0f8ca4665979945c866a0bc3e946",
    writeReceipt:async(value:unknown)=>{receipts.push(value);}}};
}

test("target accepts only an explicitly named loopback disposable clone",()=>{
  assert.equal(target.database,clone);assert.equal(target.endpoint_class,"named-loopback-disposable-clone");
  for(const [url,name] of [[`postgres://x@db.example.com:5432/${clone}`,clone],
    ["postgres://x@127.0.0.1:55439/preview", "preview"],
    [`postgres://x@127.0.0.1:55439/${clone}?sslmode=require`,clone],
    [`postgres://x@127.0.0.1:55439/${clone}`,`${clone}_different`]] as const){
    assert.throws(()=>parseSignalTopicEvaluationLabTargetV2(url,name),/topic_evaluation_lab_target_invalid/u);
  }
});

test("provider configuration check observes presence only and never reads its value",()=>{
  let read=false;const env=new Proxy({[SIGNAL_TOPIC_EVALUATION_LAB_V2_PROVIDER_CREDENTIAL_NAME]:"hidden"},
    {get(targetValue,key,receiver){if(key===SIGNAL_TOPIC_EVALUATION_LAB_V2_PROVIDER_CREDENTIAL_NAME)read=true;
      return Reflect.get(targetValue,key,receiver);}});
  assert.equal(signalTopicEvaluationLabProviderConfiguredV2(env),true);assert.equal(read,false);
  assert.equal(signalTopicEvaluationLabProviderConfiguredV2({}),false);
});

test("valid preflight reattests full real-import shape and emits a disabled sanitized flight card",async()=>{
  const run=harness();const receipt=await preflightSignalTopicEvaluationLabV2({pool:run.pool,target,
    provider_configuration_present:false,dependencies:run.dependencies});
  assert.equal(receipt.source_authority.canonical_roots,21195);
  assert.equal(receipt.source_authority.historical_proposals,115);
  assert.equal(receipt.source_authority.catalog_entries,116);
  assert.equal(receipt.source_authority.assigned,11186);assert.equal(receipt.source_authority.outliers,10009);
  assert.equal(receipt.flight_card.execution_enabled,false);
  assert.equal(receipt.flight_card.provider_transport_allowed,false);
  assert.equal(receipt.flight_card.evaluations_allowed,1);
  assert.equal(receipt.flight_card.cost_maximum_micro_usd,2_100_000);
  assert.ok(receipt.flight_card.cost_maximum_micro_usd<=18_147_816);
  assert.equal(receipt.flight_card.output_status,"pending");assert.equal(receipt.flight_card.adoption_allowed,false);
  assert.equal(receipt.flight_card.publication_allowed,false);assert.equal(receipt.flight_card.serving_allowed,false);
  assert.equal(receipt.isolated_execution_path.uat_worker_process_used,false);
  assert.equal(receipt.isolated_execution_path.queue_used,false);
  assert.equal(receipt.isolated_execution_path.product_credential_lane_used,false);
  assert.equal(receipt.effects.database_writes,0);assert.equal(receipt.effects.provider_calls,0);
  assert.equal(run.receipts.length,1);
  assert.doesNotMatch(JSON.stringify(receipt),/postgres:\/\/|password[^_]?:/u);
  assert.equal(run.statements.some((sql)=>/^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/iu.test(sql)),false);
});

test("authority drift, synthetic-sized mismatch, nonempty work and missing candidate guards fail closed",async()=>{
  for(const run of [harness({authority:{unique_mentions:21194}}),
    harness({authority:{source_export_digest:digest("forged")}}),harness({work:{runs:1}}),
    harness({sentinels:{pending_only_candidates:false}})]){
    await assert.rejects(preflightSignalTopicEvaluationLabV2({pool:run.pool,target,
      provider_configuration_present:false,dependencies:run.dependencies}),
    /topic_evaluation_lab_(frozen_authority_mismatch|not_empty|schema_incomplete)/u);
    assert.equal(run.receipts.length,0);
  }
});

test("Lab runner contains no UAT Worker, queue, env loader, provider transport or secret-value access",async()=>{
  const source=await readFile(new URL("./preflight-signal-topic-evaluation-lab-v2.ts",import.meta.url),"utf8");
  const provider=await readFile(new URL("../src/providers/anthropic-full-evidence-topic-evaluation.ts",
    import.meta.url),"utf8");
  const worker=await readFile(new URL("../src/workers/signal-topic-evaluation-v2.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/env\/load|bullmq|signal-topic-evaluation-v2-outbox|generateAnthropicBoundedText|createAnthropicFullEvidence/u);
  assert.match(source,/Object\.hasOwn\(env,SIGNAL_TOPIC_EVALUATION_LAB_V2_PROVIDER_CREDENTIAL_NAME\)/u);
  assert.match(provider,/transport: BoundedTransport/u);
  assert.match(worker,/export async function processSignalTopicEvaluationV2ProviderRun/u);
});

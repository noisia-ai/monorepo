import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { signalTopicEvaluationDigestV2 } from "@noisia/query-engine";

import type { SignalTopicEvaluationLabHostReceiptV1 } from
  "./signal-topic-evaluation-lab-host-provenance-v2";

import { SIGNAL_TOPIC_EVALUATION_LAB_V2_PROVIDER_CREDENTIAL_NAME,
  SIGNAL_TOPIC_EVALUATION_LAB_V2_RUNTIME_PROFILE,parseSignalTopicEvaluationLabTargetV2,
  preflightSignalTopicEvaluationLabV2,prepareSignalTopicEvaluationLabInvocationV2,
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
const marker={marker_namespace:"noisia.topic-evaluation.disposable-lab-clone",
  contract_version:"signal-topic-evaluation-lab-clone-provenance-v1",clone_name:clone,
  source_run_key:authority.source_run_key,source_snapshot_digest:authority.snapshot_digest,
  source_artifact_binding_digest:authority.artifact_binding_digest,
  recorded_system_identifier:"7462383493939691021",current_system_identifier:"7462383493939691021"};
const hostReceiptUnsigned:Omit<SignalTopicEvaluationLabHostReceiptV1,"receipt_digest">={
  contract_version:"signal-topic-evaluation-lab-host-provenance-v1",
  marker_namespace:"noisia.topic-evaluation.disposable-lab-host-anchor" as const,
  created_at:"2026-09-04T20:30:00.000Z",container_name:"noisia-r24a-provenance-pg" as const,
  container_id:"a".repeat(64),image_id:`sha256:${"b".repeat(64)}`,
  image_reference:"pgvector/pgvector:pg17" as const,endpoint_host:"127.0.0.1" as const,
  endpoint_port:55439,clone_name:clone,server_system_identifier:marker.current_system_identifier,
  source_database_name:"noisia_r32_clean_20260904",
  source_run_key:"backend-10c2c-2026-08-21-final-2-bertopic-bge-detail-seed-17",
  source_snapshot_digest:authority.snapshot_digest,
  source_artifact_binding_digest:authority.artifact_binding_digest,
  source_membership_binding_digest:authority.membership_binding_digest,
  candidate_review_migration_digest:
    "sha256:7a6b61cc16dba808e0c98645855e2597db8d0f8ca4665979945c866a0bc3e946" as const,
  database_marker_setup_digest:
    "sha256:0906a2b7cfebbbfb5408d94b48c50652645d6313030f05a01632b16ae6be242b" as const};
const hostReceipt={...hostReceiptUnsigned,receipt_digest:signalTopicEvaluationDigestV2(hostReceiptUnsigned)};
const ledger=[
  {ordinal:112,migration_name:"0112_signal_topic_evaluation_full_evidence_control_plane.sql",
    checksum_sha256:"sha256:51f6fbff712ec1737b41da9997bda86b068abb81f4edafc9a338af590c462ab5",disposition:"applied"},
  {ordinal:113,migration_name:"0113_signal_topic_evaluation_full_evidence_execution_authority.sql",
    checksum_sha256:"sha256:8bb7f5be275d33d4f284f72a9e882314f488466ccdd3adee3ade2acb195f0f71",disposition:"applied"},
  {ordinal:114,migration_name:"0114_signal_topic_evaluation_v2_execution_outbox.sql",
    checksum_sha256:"sha256:f63774eae48b6fc3332feafdd8d033afeb8d4ae44d5479fd87ea44fa26e02582",disposition:"applied"}];

function harness(changes:{authority?:Record<string,unknown>;marker?:Record<string,unknown>;
  markerPresent?:boolean;work?:Record<string,number>;sentinels?:Record<string,boolean>}={}){
  const statements:string[]=[];const receipts:unknown[]=[];
  const client={query:async<T=Record<string,unknown>>(sql:string):Promise<{rows:T[]}>=>{statements.push(sql);
    let rows:unknown[];
    if(sql.startsWith("BEGIN")||sql==="ROLLBACK")rows=[];
    else if(sql.includes("current_database()"))rows=[{database_name:clone,read_only:"on"}];
    else if(sql.includes("FROM signal_topic_evaluation_v2_snapshots snapshot"))rows=[{...authority,
      ...changes.authority}];
    else if(sql.includes("to_regclass('noisia_topic_evaluation_lab.clone_provenance')"))rows=[{
      marker_present:changes.markerPresent??true}];
    else if(sql.includes("FROM noisia_topic_evaluation_lab.clone_provenance"))rows=[{...marker,
      ...changes.marker}];
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
  for(const name of ["noisia_topic_eval_lab_preview_20260904","noisia_topic_eval_lab_uat_20260904",
    "noisia_topic_eval_lab_production_20260904"]){
    assert.throws(()=>parseSignalTopicEvaluationLabTargetV2(`postgres://x@127.0.0.1:55439/${name}`,name),
      /topic_evaluation_lab_target_invalid/u);
  }
});

test("closed local Lab profile rejects missing, unknown and remote profiles before anchor access",async()=>{
  for(const profile of [undefined,"local","preview","uat","staging","production"]){
    let anchorRead=false;
    const base:NodeJS.ProcessEnv={};
    if(profile!==undefined)base.NOISIA_RUNTIME_PROFILE=profile;
    await assert.rejects(prepareSignalTopicEvaluationLabInvocationV2(base,{verifyHostReceipt:async()=>{
      anchorRead=true;return{receipt:hostReceipt,container:{} as never};}}),
    /topic_evaluation_lab_runtime_profile_invalid/u);
    assert.equal(anchorRead,false);
  }
  const prepared=await prepareSignalTopicEvaluationLabInvocationV2({
    NOISIA_RUNTIME_PROFILE:SIGNAL_TOPIC_EVALUATION_LAB_V2_RUNTIME_PROFILE},{
    verifyHostReceipt:async()=>({receipt:hostReceipt,container:{} as never})});
  assert.equal(prepared.target.database,clone);
  assert.equal(prepared.anchor.receipt_digest,hostReceipt.receipt_digest);
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
    host_receipt:hostReceipt,provider_configuration_present:false,dependencies:run.dependencies});
  assert.equal(receipt.source_authority.canonical_roots,21195);
  assert.equal(receipt.source_authority.historical_proposals,115);
  assert.equal(receipt.source_authority.catalog_entries,116);
  assert.equal(receipt.source_authority.assigned,11186);assert.equal(receipt.source_authority.outliers,10009);
  assert.match(receipt.target.clone_provenance_digest,/^sha256:[0-9a-f]{64}$/u);
  assert.equal(receipt.target.host_anchor_receipt_digest,hostReceipt.receipt_digest);
  assert.match(receipt.target.container_identity_digest,/^sha256:[0-9a-f]{64}$/u);
  assert.equal(receipt.target.runtime_profile,SIGNAL_TOPIC_EVALUATION_LAB_V2_RUNTIME_PROFILE);
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
      host_receipt:hostReceipt,provider_configuration_present:false,dependencies:run.dependencies}),
    /topic_evaluation_lab_(frozen_authority_mismatch|not_empty|schema_incomplete)/u);
    assert.equal(run.receipts.length,0);
  }
});

test("missing or mismatched server-owned clone provenance fails inside the read-only transaction",async()=>{
  for(const [run,expected] of [[harness({markerPresent:false}),"clone_provenance_missing"],
    [harness({marker:{clone_name:"noisia_topic_eval_lab_other_20260904"}}),"clone_provenance_invalid"],
    [harness({marker:{source_snapshot_digest:digest("other-snapshot")}}),"clone_provenance_invalid"],
    [harness({marker:{current_system_identifier:"9000000000000000000"}}),"clone_provenance_invalid"]] as const){
    await assert.rejects(preflightSignalTopicEvaluationLabV2({pool:run.pool,target,
      host_receipt:hostReceipt,provider_configuration_present:false,dependencies:run.dependencies}),
    new RegExp(expected,"u"));
    assert.equal(run.receipts.length,0);
    assert.equal(run.statements[0],"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  }
});

test("Lab runner contains no UAT Worker, queue, env loader, provider transport or secret-value access",async()=>{
  const source=await readFile(new URL("./preflight-signal-topic-evaluation-lab-v2.ts",import.meta.url),"utf8");
  const setup=await readFile(new URL("./setup-signal-topic-evaluation-lab-provenance-v2.sql",import.meta.url),
    "utf8");
  const provider=await readFile(new URL("../src/providers/anthropic-full-evidence-topic-evaluation.ts",
    import.meta.url),"utf8");
  const worker=await readFile(new URL("../src/workers/signal-topic-evaluation-v2.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/env\/load|bullmq|signal-topic-evaluation-v2-outbox|generateAnthropicBoundedText|createAnthropicFullEvidence/u);
  assert.doesNotMatch(source,/NOISIA_TOPIC_EVALUATION_LAB_DATABASE_URL|NOISIA_TOPIC_EVALUATION_LAB_CLONE_NAME/u);
  assert.match(source,/Object\.hasOwn\(env,SIGNAL_TOPIC_EVALUATION_LAB_V2_PROVIDER_CREDENTIAL_NAME\)/u);
  assert.match(provider,/transport: BoundedTransport/u);
  assert.match(worker,/export async function processSignalTopicEvaluationV2ProviderRun/u);
  assert.match(setup,/current_database\(\)/u);
  assert.match(setup,/pg_control_system\(\)/u);
  assert.match(setup,/signal_topic_evaluation_lab_clone_provenance_immutable/u);
  assert.match(setup,/backend-10c2c-2026-08-21-final-2-bertopic-bge-detail-seed-17/u);
  assert.doesNotMatch(setup,/\\set|DATABASE_URL|password|credential/iu);
});

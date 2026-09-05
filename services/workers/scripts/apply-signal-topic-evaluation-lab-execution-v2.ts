import { createHash } from "node:crypto";
import { mkdir,readFile,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { signalTopicEvaluationDigestV2 } from "@noisia/query-engine";

import { createSignalTopicEvaluationLabDockerPoolV1 } from "./signal-topic-evaluation-lab-docker-pool-v2";
import { runSignalTopicEvaluationLabDockerV1 } from "./signal-topic-evaluation-lab-docker-transport-v2";
import { SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,
  verifyFixedSignalTopicEvaluationLabHostReceiptV1 } from "./signal-topic-evaluation-lab-host-provenance-v2";
import { preflightSignalTopicEvaluationLabV2,prepareSignalTopicEvaluationLabInvocationV2 } from
  "./preflight-signal-topic-evaluation-lab-v2";

const ROOT=resolve(fileURLToPath(new URL("../../..",import.meta.url)));
const MIGRATION_NAME="0116_signal_topic_evaluation_disposable_lab_execution.sql";
const MIGRATION_PATH=resolve(ROOT,"infrastructure/db/migrations",MIGRATION_NAME);
const APPROVAL="APPLY_0116_TO_EXTERNALLY_ANCHORED_DISPOSABLE_LAB";

export async function applySignalTopicEvaluationLabExecutionMigrationV2(env:NodeJS.ProcessEnv){
  if(env.NOISIA_TOPIC_EVALUATION_LAB_MIGRATION_APPLY_ENABLED!=="true"||
      env.NOISIA_TOPIC_EVALUATION_LAB_MIGRATION_CONFIRMATION!==APPROVAL)throw new Error(
    "topic_evaluation_lab_migration_apply_disabled");
  const prepared=await prepareSignalTopicEvaluationLabInvocationV2(env);
  const verified=await verifyFixedSignalTopicEvaluationLabHostReceiptV1();
  if(verified.receipt.receipt_digest!==prepared.anchor.receipt_digest)throw new Error(
    "topic_evaluation_lab_host_anchor_drift");
  const preflight=await preflightSignalTopicEvaluationLabV2({
    pool:createSignalTopicEvaluationLabDockerPoolV1(prepared.anchor),target:prepared.target,
    host_receipt:prepared.anchor,provider_configuration_present:false,write_receipt:false});
  const bytes=await readFile(MIGRATION_PATH);
  const checksum=`sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const existing=await query(prepared.anchor.clone_name,`SELECT count(*)::int FROM
    signal_workspace_data_plane_migration_ledger WHERE ordinal=116 OR migration_name='${MIGRATION_NAME}'`);
  if(existing!=="0")throw new Error("topic_evaluation_lab_migration_already_applied");
  const ledger=`INSERT INTO signal_workspace_data_plane_migration_ledger(migration_name,ordinal,
    checksum_sha256,disposition,runner_version,target_fingerprint) VALUES('${MIGRATION_NAME}',116,
    '${checksum}','applied','signal-topic-evaluation-disposable-lab-migrator-v1',
    '${prepared.anchor.receipt_digest}');`;
  await runSignalTopicEvaluationLabDockerV1(["exec","--interactive",
    SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,"psql","--no-psqlrc","--quiet","--set",
    "ON_ERROR_STOP=1","--username","postgres","--dbname",prepared.anchor.clone_name],
  Buffer.from(`BEGIN;\n${bytes.toString("utf8")}\n${ledger}\nCOMMIT;\n`));
  const proofRaw=await query(prepared.anchor.clone_name,`SELECT json_build_object(
    'ledger_count',(SELECT count(*) FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=116
      AND migration_name='${MIGRATION_NAME}' AND checksum_sha256='${checksum}' AND disposition='applied'),
    'authority_channel',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name=
      'signal_topic_evaluation_v2_execution_authorizations' AND column_name='authority_channel'),
    'lab_function',to_regprocedure('signal_topic_evaluation_v2_lab_create_and_claim_v1(jsonb)') IS NOT NULL,
    'lab_validator',to_regprocedure('signal_topic_evaluation_v2_lab_authority_valid_v1(uuid)') IS NOT NULL,
    'authorities',(SELECT count(*) FROM signal_topic_evaluation_v2_execution_authorizations),
    'runs',(SELECT count(*) FROM signal_topic_evaluation_v2_runs),
    'outboxes',(SELECT count(*) FROM signal_topic_evaluation_v2_execution_outbox),
    'candidates',(SELECT count(*) FROM signal_topic_evaluation_v2_candidates))::text`);
  const proof=JSON.parse(proofRaw) as Record<string,unknown>;
  if(proof.ledger_count!==1||proof.authority_channel!==true||proof.lab_function!==true||
      proof.lab_validator!==true||[proof.authorities,proof.runs,proof.outboxes,proof.candidates]
        .some((value)=>Number(value)!==0))throw new Error("topic_evaluation_lab_migration_verify_failed");
  const receipt={contract_version:"signal-topic-evaluation-disposable-lab-migration-v1",
    recorded_at:new Date().toISOString(),target_fingerprint:preflight.target.target_fingerprint,
    host_anchor_receipt_digest:prepared.anchor.receipt_digest,migration:{ordinal:116,name:MIGRATION_NAME,
      checksum_sha256:checksum,applied_exactly_once:true},sentinels:proof,
    source:{snapshot_digest:preflight.source_authority.snapshot_digest,
      membership_binding_digest:preflight.source_authority.membership_binding_digest,
      canonical_memberships:21195,historical_proposals:115,assigned:11186,outliers:10009},
    effects:{provider_calls:0,queue_jobs:0,runs:0,candidates:0,adoptions:0,publications:0,
      serving_effects:0,uat_connections:0,production_accessed:false}};
  const dir=resolve(ROOT,".data/signal-topic-evaluation/lab-2a",prepared.anchor.clone_name);
  await mkdir(dir,{recursive:true,mode:0o700});const path=resolve(dir,"migration-0116.sanitized.json");
  await writeFile(path,`${JSON.stringify(receipt,null,2)}\n`,{mode:0o600,flag:"wx"});
  return{receipt,path,receipt_digest:signalTopicEvaluationDigestV2(receipt)};
}

async function query(database:string,sql:string){return runSignalTopicEvaluationLabDockerV1([
  "exec",SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,"psql","--no-psqlrc","--quiet","--tuples-only",
  "--no-align","--set","ON_ERROR_STOP=1","--username","postgres","--dbname",database,"--command",sql]);}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  applySignalTopicEvaluationLabExecutionMigrationV2(process.env).then(({receipt,path,receipt_digest})=>{
    process.stdout.write(`${JSON.stringify({status:"applied_once",migration:receipt.migration,
      receipt_path:path,receipt_digest,effects:receipt.effects})}\n`);
  }).catch((error:unknown)=>{process.stderr.write(`${error instanceof Error?error.message:
    "topic_evaluation_lab_migration_failed"}\n`);process.exitCode=1;});
}

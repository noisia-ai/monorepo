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
const MIGRATION_NAME="0117_signal_topic_evaluation_lab_evaluation_brief.sql";
const MIGRATION_PATH=resolve(ROOT,"infrastructure/db/migrations",MIGRATION_NAME);
const APPROVAL="APPLY_0117_TO_EXTERNALLY_ANCHORED_DISPOSABLE_LAB";
const PREVIOUS_MIGRATION="0116_signal_topic_evaluation_disposable_lab_execution.sql";

/** Applies only the append-only Lab compatibility constraint after a fresh no-provider preflight. */
export async function applySignalTopicEvaluationLabEvaluationBriefMigrationV2(env:NodeJS.ProcessEnv){
  if(env.NOISIA_TOPIC_EVALUATION_LAB_MIGRATION_APPLY_ENABLED!=="true"||
      env.NOISIA_TOPIC_EVALUATION_LAB_MIGRATION_CONFIRMATION!==APPROVAL)throw new Error(
    "topic_evaluation_lab_evaluation_brief_migration_apply_disabled");
  const prepared=await prepareSignalTopicEvaluationLabInvocationV2(env);
  const verified=await verifyFixedSignalTopicEvaluationLabHostReceiptV1();
  if(verified.receipt.receipt_digest!==prepared.anchor.receipt_digest)throw new Error(
    "topic_evaluation_lab_host_anchor_drift");
  const preflight=await preflightSignalTopicEvaluationLabV2({
    pool:createSignalTopicEvaluationLabDockerPoolV1(prepared.anchor),target:prepared.target,
    host_receipt:prepared.anchor,provider_configuration_present:false,write_receipt:false});
  const bytes=await readFile(MIGRATION_PATH);
  const checksum=`sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const before=await query(prepared.anchor.clone_name,`SELECT json_build_object(
    'previous',(SELECT count(*) FROM signal_workspace_data_plane_migration_ledger
      WHERE ordinal=116 AND migration_name='${PREVIOUS_MIGRATION}' AND disposition='applied'),
    'current',(SELECT count(*) FROM signal_workspace_data_plane_migration_ledger
      WHERE ordinal=117 OR migration_name='${MIGRATION_NAME}'),
    'authorities',(SELECT count(*) FROM signal_topic_evaluation_v2_execution_authorizations),
    'runs',(SELECT count(*) FROM signal_topic_evaluation_v2_runs),
    'retrievals',(SELECT count(*) FROM signal_topic_evaluation_v2_retrievals),
    'candidates',(SELECT count(*) FROM signal_topic_evaluation_v2_candidates))::text`);
  const state=JSON.parse(before) as Record<string,unknown>;
  if(state.previous!==1||state.current!==0||[state.authorities,state.runs,state.retrievals,state.candidates]
      .some((value)=>Number(value)!==0))throw new Error("topic_evaluation_lab_evaluation_brief_migration_not_pristine");
  const ledger=`INSERT INTO signal_workspace_data_plane_migration_ledger(migration_name,ordinal,
    checksum_sha256,disposition,runner_version,target_fingerprint) VALUES('${MIGRATION_NAME}',117,
    '${checksum}','applied','signal-topic-evaluation-lab-evaluation-brief-migrator-v1',
    '${prepared.anchor.receipt_digest}');`;
  await runSignalTopicEvaluationLabDockerV1(["exec","--interactive",
    SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,"psql","--no-psqlrc","--quiet","--set",
    "ON_ERROR_STOP=1","--username","postgres","--dbname",prepared.anchor.clone_name],
  Buffer.from(`BEGIN;\n${bytes.toString("utf8")}\n${ledger}\nCOMMIT;\n`));
  const proof=JSON.parse(await query(prepared.anchor.clone_name,`SELECT json_build_object(
    'ledger_count',(SELECT count(*) FROM signal_workspace_data_plane_migration_ledger WHERE ordinal=117
      AND migration_name='${MIGRATION_NAME}' AND checksum_sha256='${checksum}' AND disposition='applied'),
    'brief_allowed',position('evaluation_brief' in COALESCE(pg_get_constraintdef(
      (SELECT oid FROM pg_constraint WHERE conname='signal_topic_evaluation_v2_retrieval_shape')),''))>0,
    'authorities',(SELECT count(*) FROM signal_topic_evaluation_v2_execution_authorizations),
    'runs',(SELECT count(*) FROM signal_topic_evaluation_v2_runs),
    'outboxes',(SELECT count(*) FROM signal_topic_evaluation_v2_execution_outbox),
    'retrievals',(SELECT count(*) FROM signal_topic_evaluation_v2_retrievals),
    'candidates',(SELECT count(*) FROM signal_topic_evaluation_v2_candidates))::text`)) as Record<string,unknown>;
  if(proof.ledger_count!==1||proof.brief_allowed!==true||[proof.authorities,proof.runs,proof.outboxes,
      proof.retrievals,proof.candidates].some((value)=>Number(value)!==0))throw new Error(
    "topic_evaluation_lab_evaluation_brief_migration_verify_failed");
  const receipt={contract_version:"signal-topic-evaluation-disposable-lab-migration-v1",
    recorded_at:new Date().toISOString(),target_fingerprint:preflight.target.target_fingerprint,
    host_anchor_receipt_digest:prepared.anchor.receipt_digest,migration:{ordinal:117,name:MIGRATION_NAME,
      checksum_sha256:checksum,applied_exactly_once:true},sentinels:proof,
    effects:{provider_calls:0,queue_jobs:0,runs:0,candidates:0,adoptions:0,publications:0,
      serving_effects:0,uat_connections:0,production_accessed:false}};
  const dir=resolve(ROOT,".data/signal-topic-evaluation/lab-2c",prepared.anchor.clone_name);
  await mkdir(dir,{recursive:true,mode:0o700});const path=resolve(dir,"migration-0117.sanitized.json");
  await writeFile(path,`${JSON.stringify(receipt,null,2)}\n`,{mode:0o600,flag:"wx"});
  return{receipt,path,receipt_digest:signalTopicEvaluationDigestV2(receipt)};
}

async function query(database:string,sql:string){return runSignalTopicEvaluationLabDockerV1([
  "exec",SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,"psql","--no-psqlrc","--quiet","--tuples-only",
  "--no-align","--set","ON_ERROR_STOP=1","--username","postgres","--dbname",database,"--command",sql]);}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  applySignalTopicEvaluationLabEvaluationBriefMigrationV2(process.env).then(({receipt,path,receipt_digest})=>{
    process.stdout.write(`${JSON.stringify({status:"applied_once",migration:receipt.migration,
      receipt_path:path,receipt_digest,effects:receipt.effects})}\n`);
  }).catch((error:unknown)=>{process.stderr.write(`${error instanceof Error?error.message:
    "topic_evaluation_lab_evaluation_brief_migration_failed"}\n`);process.exitCode=1;});
}

/**
 * Creates one fresh disposable Topic Evaluation Lab clone inside the fixed local pgvector
 * container and emits the external host-side provenance anchor consumed by the read-only preflight.
 * It accepts no target, container, source database, clone name, marker, URI or credential input.
 */
import { randomBytes,createHash } from "node:crypto";
import { constants } from "node:fs";
import { access,readFile,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { verifyRegisteredSignalTopicEvaluationArtifactsV2 } from "@noisia/db";
import { signalTopicEvaluationDigestV2 } from "@noisia/query-engine";

import { SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,SIGNAL_TOPIC_EVALUATION_LAB_HOST_RECEIPT_PATH,
  SIGNAL_TOPIC_EVALUATION_LAB_SOURCE_DATABASE,ensureSignalTopicEvaluationLabHostReceiptDirectoryV1,
  inspectSignalTopicEvaluationLabContainerV1,signalTopicEvaluationLabHostReceiptDigestV1,
  type SignalTopicEvaluationLabHostReceiptV1 }
  from "./signal-topic-evaluation-lab-host-provenance-v2";

process.umask(0o077);

const REPO_ROOT=resolve(fileURLToPath(new URL("../../..",import.meta.url)));
const SOURCE_RUN="backend-10c2c-2026-08-21-final-2-bertopic-bge-detail-seed-17";
const MIGRATION_PATH=resolve(REPO_ROOT,"infrastructure/db/migrations/0115_signal_topic_evaluation_v2_candidate_review.sql");
const MARKER_PATH=resolve(REPO_ROOT,"services/workers/scripts/setup-signal-topic-evaluation-lab-provenance-v2.sql");
const MIGRATION_DIGEST="sha256:7a6b61cc16dba808e0c98645855e2597db8d0f8ca4665979945c866a0bc3e946";
const MARKER_DIGEST="sha256:0906a2b7cfebbbfb5408d94b48c50652645d6313030f05a01632b16ae6be242b";

class LabCloneCreationError extends Error{
  constructor(readonly code:string){super(code);this.name="LabCloneCreationError";}
}

async function runDocker(args:string[],input?:Buffer){
  return new Promise<string>((resolveRun,reject)=>{
    const child=spawn("docker",args,{stdio:["pipe","pipe","pipe"]}) as ChildProcessWithoutNullStreams;
    const stdout:Buffer[]=[];const stderr:Buffer[]=[];let size=0;
    child.stdout.on("data",(chunk:Buffer)=>{size+=chunk.length;if(size<=1024*1024)stdout.push(chunk);});
    child.stderr.on("data",(chunk:Buffer)=>{size+=chunk.length;if(size<=1024*1024)stderr.push(chunk);});
    child.on("error",()=>reject(new LabCloneCreationError("topic_evaluation_lab_docker_exec_failed")));
    child.on("close",(code)=>{if(code!==0||size>1024*1024)reject(new LabCloneCreationError(
      "topic_evaluation_lab_docker_exec_failed"));else resolveRun(Buffer.concat(stdout).toString("utf8").trim());});
    child.stdin.end(input);
  });
}

async function queryJson(database:string,sql:string){
  const output=await runDocker(["exec",SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,"psql","--no-psqlrc",
    "--quiet","--tuples-only","--no-align","--set","ON_ERROR_STOP=1","--username","postgres",
    "--dbname",database,"--command",sql]);
  try{return JSON.parse(output) as Record<string,unknown>;}catch{throw new LabCloneCreationError(
    "topic_evaluation_lab_database_proof_invalid");}
}

const PROOF_BODY=`SELECT
  current_database() database_name,(pg_control_system()).system_identifier::text system_identifier,
  snapshot.source_run_key,snapshot.snapshot_digest,snapshot.artifact_binding_digest,
  snapshot.membership_binding_digest,
  (SELECT count(*)::int FROM signal_topic_evaluation_v2_clusters) catalog_entries,
  (SELECT count(*)::int FROM signal_topic_evaluation_v2_clusters WHERE proposal_key IS NOT NULL) proposals,
  (SELECT count(*)::int FROM signal_topic_evaluation_v2_cluster_memberships) memberships,
  (SELECT count(*)::int FROM signal_topic_evaluation_v2_cluster_memberships WHERE assignment_label>=0) assigned,
  (SELECT count(*)::int FROM signal_topic_evaluation_v2_cluster_memberships WHERE assignment_label=-1) outliers
FROM signal_topic_evaluation_v2_snapshots snapshot WHERE snapshot.state='frozen'`;
const PROOF_SQL=`SELECT row_to_json(proof) FROM (${PROOF_BODY}) proof`;
const CLONE_PROOF_SQL=`SELECT row_to_json(proof) FROM (SELECT source_proof.*,
  (SELECT count(*)::int FROM noisia_topic_evaluation_lab.clone_provenance) marker_rows,
  to_regclass('signal_topic_evaluation_v2_candidate_review_operations') IS NOT NULL review_schema
FROM (${PROOF_BODY}) source_proof) proof`;

function assertSourceProof(value:Record<string,unknown>,database:string,artifacts:{artifact_binding_digest:string}){
  if(value.database_name!==database||value.source_run_key!==SOURCE_RUN
      ||value.catalog_entries!==116||value.proposals!==115||value.memberships!==21_195
      ||value.assigned!==11_186||value.outliers!==10_009
      ||value.artifact_binding_digest!==artifacts.artifact_binding_digest
      ||typeof value.snapshot_digest!=="string"||typeof value.membership_binding_digest!=="string"
      ||typeof value.system_identifier!=="string"||!/^\d+$/u.test(value.system_identifier)){
    throw new LabCloneCreationError("topic_evaluation_lab_frozen_source_invalid");
  }
}

async function main(){
  if(process.env.NOISIA_RUNTIME_PROFILE!=="local_disposable_lab_v1"){
    throw new LabCloneCreationError("topic_evaluation_lab_runtime_profile_invalid");
  }
  try{await access(SIGNAL_TOPIC_EVALUATION_LAB_HOST_RECEIPT_PATH,constants.F_OK);
    throw new LabCloneCreationError("topic_evaluation_lab_host_receipt_already_exists");}
  catch(error){if(error instanceof LabCloneCreationError)throw error;
    if((error as NodeJS.ErrnoException).code!=="ENOENT")throw new LabCloneCreationError(
      "topic_evaluation_lab_host_receipt_unavailable");}

  const migration=await readFile(MIGRATION_PATH);const marker=await readFile(MARKER_PATH);
  const rawDigest=(value:Buffer)=>`sha256:${createHash("sha256").update(value).digest("hex")}`;
  if(rawDigest(migration)!==MIGRATION_DIGEST||rawDigest(marker)!==MARKER_DIGEST){
    throw new LabCloneCreationError("topic_evaluation_lab_local_schema_checksum_mismatch");
  }
  const artifacts=await verifyRegisteredSignalTopicEvaluationArtifactsV2(SOURCE_RUN);
  if(artifacts.records.length!==21_195||artifacts.labels.length!==21_195||artifacts.topics.length!==115
      ||artifacts.assigned_count!==11_186||artifacts.outlier_count!==10_009){
    throw new LabCloneCreationError("topic_evaluation_lab_registered_artifacts_invalid");
  }
  const before=await inspectSignalTopicEvaluationLabContainerV1();
  const source=await queryJson(SIGNAL_TOPIC_EVALUATION_LAB_SOURCE_DATABASE,PROOF_SQL);
  assertSourceProof(source,SIGNAL_TOPIC_EVALUATION_LAB_SOURCE_DATABASE,artifacts);

  const day=new Date().toISOString().slice(0,10).replaceAll("-","");
  const cloneName=`noisia_topic_eval_lab_${day}_${randomBytes(6).toString("hex")}`;
  await runDocker(["exec",SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,"createdb","--username","postgres",
    "--template",SIGNAL_TOPIC_EVALUATION_LAB_SOURCE_DATABASE,cloneName]);
  await runDocker(["exec","--interactive",SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,"psql","--no-psqlrc",
    "--quiet","--set","ON_ERROR_STOP=1","--username","postgres","--dbname",cloneName],migration);
  await runDocker(["exec","--interactive",SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,"psql","--no-psqlrc",
    "--quiet","--set","ON_ERROR_STOP=1","--username","postgres","--dbname",cloneName],marker);

  const clone=await queryJson(cloneName,CLONE_PROOF_SQL);
  assertSourceProof(clone,cloneName,artifacts);
  if(clone.marker_rows!==1||clone.review_schema!==true||clone.system_identifier!==source.system_identifier){
    throw new LabCloneCreationError("topic_evaluation_lab_clone_verification_failed");
  }
  const after=await inspectSignalTopicEvaluationLabContainerV1();
  if(JSON.stringify(before)!==JSON.stringify(after))throw new LabCloneCreationError(
    "topic_evaluation_lab_container_changed_during_setup");

  const unsigned:Omit<SignalTopicEvaluationLabHostReceiptV1,"receipt_digest">={
    contract_version:"signal-topic-evaluation-lab-host-provenance-v1",
    marker_namespace:"noisia.topic-evaluation.disposable-lab-host-anchor" as const,
    created_at:new Date().toISOString(),container_name:before.container_name,
    container_id:before.container_id,image_id:before.image_id,image_reference:before.image_reference,
    endpoint_host:before.endpoint_host,endpoint_port:before.endpoint_port,clone_name:cloneName,
    server_system_identifier:String(source.system_identifier),
    source_database_name:SIGNAL_TOPIC_EVALUATION_LAB_SOURCE_DATABASE,source_run_key:SOURCE_RUN,
    source_snapshot_digest:String(source.snapshot_digest),
    source_artifact_binding_digest:String(source.artifact_binding_digest),
    source_membership_binding_digest:String(source.membership_binding_digest),
    candidate_review_migration_digest:MIGRATION_DIGEST as typeof MIGRATION_DIGEST,
    database_marker_setup_digest:MARKER_DIGEST as typeof MARKER_DIGEST};
  const receipt={...unsigned,receipt_digest:signalTopicEvaluationLabHostReceiptDigestV1(unsigned)};
  await ensureSignalTopicEvaluationLabHostReceiptDirectoryV1();
  await writeFile(SIGNAL_TOPIC_EVALUATION_LAB_HOST_RECEIPT_PATH,`${JSON.stringify(receipt,null,2)}\n`,
    {mode:0o600,flag:"wx"});
  console.log(JSON.stringify({status:"created",clone_name:cloneName,
    container_identity_digest:signalTopicEvaluationDigestV2({container_id:before.container_id,
      image_id:before.image_id}),host_receipt_digest:receipt.receipt_digest,
    source:{canonical_roots:21_195,proposals:115,catalog_entries:116,assigned:11_186,outliers:10_009},
    effects:{local_clones_created:1,local_migrations_applied:1,provider_calls:0,uat_connections:0,
      adoption:0,publication:0,serving:0}}));
}

await main().catch((error:unknown)=>{console.error(error instanceof LabCloneCreationError?error.code:
  "topic_evaluation_lab_clone_creation_failed");process.exitCode=1;});

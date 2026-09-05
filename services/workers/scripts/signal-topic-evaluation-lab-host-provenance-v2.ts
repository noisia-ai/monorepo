import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { mkdir,open } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { signalTopicEvaluationDigestV2 } from "@noisia/query-engine";
import { z } from "zod";

const execFileAsync=promisify(execFile);
const REPO_ROOT=resolve(fileURLToPath(new URL("../../..",import.meta.url)));
const DIGEST=/^sha256:[0-9a-f]{64}$/u;
const CONTAINER_ID=/^[0-9a-f]{64}$/u;

export const SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME="noisia-r24a-provenance-pg";
export const SIGNAL_TOPIC_EVALUATION_LAB_SOURCE_DATABASE="noisia_r32_clean_20260904";
export const SIGNAL_TOPIC_EVALUATION_LAB_HOST_RECEIPT_PATH=resolve(REPO_ROOT,
  ".data/signal-topic-evaluation/lab-1b/clone-provenance.current.json");

const hostReceiptSchema=z.object({
  contract_version:z.literal("signal-topic-evaluation-lab-host-provenance-v1"),
  marker_namespace:z.literal("noisia.topic-evaluation.disposable-lab-host-anchor"),
  created_at:z.string().datetime({offset:true}),
  container_name:z.literal(SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME),
  container_id:z.string().regex(CONTAINER_ID),
  image_id:z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  image_reference:z.literal("pgvector/pgvector:pg17"),
  endpoint_host:z.literal("127.0.0.1"),
  endpoint_port:z.number().int().min(1024).max(65535),
  clone_name:z.string().regex(/^noisia_topic_eval_lab_[a-z0-9_]{8,64}$/u),
  server_system_identifier:z.string().regex(/^\d+$/u),
  source_database_name:z.literal(SIGNAL_TOPIC_EVALUATION_LAB_SOURCE_DATABASE),
  source_run_key:z.literal("backend-10c2c-2026-08-21-final-2-bertopic-bge-detail-seed-17"),
  source_snapshot_digest:z.string().regex(DIGEST),
  source_artifact_binding_digest:z.string().regex(DIGEST),
  source_membership_binding_digest:z.string().regex(DIGEST),
  candidate_review_migration_digest:z.literal(
    "sha256:7a6b61cc16dba808e0c98645855e2597db8d0f8ca4665979945c866a0bc3e946"),
  database_marker_setup_digest:z.literal(
    "sha256:0906a2b7cfebbbfb5408d94b48c50652645d6313030f05a01632b16ae6be242b"),
  receipt_digest:z.string().regex(DIGEST)
}).strict();

export type SignalTopicEvaluationLabHostReceiptV1=z.infer<typeof hostReceiptSchema>;
export type SignalTopicEvaluationLabContainerIdentityV1={
  container_name:typeof SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME;container_id:string;
  image_id:string;image_reference:"pgvector/pgvector:pg17";endpoint_host:"127.0.0.1";
  endpoint_port:number};

export class SignalTopicEvaluationLabHostProvenanceError extends Error{
  constructor(public readonly code:string){super(code);this.name="SignalTopicEvaluationLabHostProvenanceError";}
}

export function signalTopicEvaluationLabHostReceiptDigestV1(value:Omit<
  SignalTopicEvaluationLabHostReceiptV1,"receipt_digest">){
  return signalTopicEvaluationDigestV2(value);
}

export function parseSignalTopicEvaluationLabHostReceiptV1(value:unknown){
  let parsed:SignalTopicEvaluationLabHostReceiptV1;
  try{parsed=hostReceiptSchema.parse(value);}catch{throw new SignalTopicEvaluationLabHostProvenanceError(
    "topic_evaluation_lab_host_receipt_invalid");}
  const {receipt_digest:receiptDigest,...unsigned}=parsed;
  if(signalTopicEvaluationLabHostReceiptDigestV1(unsigned)!==receiptDigest){
    throw new SignalTopicEvaluationLabHostProvenanceError("topic_evaluation_lab_host_receipt_digest_invalid");
  }
  return parsed;
}

export async function inspectSignalTopicEvaluationLabContainerV1(){
  let stdout:string;
  try{
    const result=await execFileAsync("docker",["inspect","--type","container","--format",
      "{{.Id}}|{{.Image}}|{{.Name}}|{{.Config.Image}}|{{.State.Status}}|{{json (index .NetworkSettings.Ports \"5432/tcp\")}}",
      SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME],{encoding:"utf8",maxBuffer:64*1024});
    stdout=String(result.stdout).trim();
  }catch{throw new SignalTopicEvaluationLabHostProvenanceError("topic_evaluation_lab_container_unavailable");}
  const [containerId,imageId,rawName,imageReference,status,rawPorts,...extra]=stdout.split("|");
  let ports:unknown;
  try{ports=JSON.parse(rawPorts??"");}catch{throw new SignalTopicEvaluationLabHostProvenanceError(
    "topic_evaluation_lab_container_identity_invalid");}
  const binding=Array.isArray(ports)&&ports.length===1?ports[0] as Record<string,unknown>:undefined;
  const port=Number(binding?.HostPort);
  const identity={container_name:(rawName??"").replace(/^\//u,""),container_id:containerId??"",
    image_id:imageId??"",image_reference:imageReference??"",endpoint_host:binding?.HostIp,
    endpoint_port:port};
  if(extra.length!==0||identity.container_name!==SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME
      ||!CONTAINER_ID.test(identity.container_id)||!/^sha256:[0-9a-f]{64}$/u.test(identity.image_id)
      ||identity.image_reference!=="pgvector/pgvector:pg17"||status!=="running"
      ||identity.endpoint_host!=="127.0.0.1"||!Number.isSafeInteger(port)||port<1024||port>65535){
    throw new SignalTopicEvaluationLabHostProvenanceError("topic_evaluation_lab_container_identity_invalid");
  }
  return identity as SignalTopicEvaluationLabContainerIdentityV1;
}

export async function loadFixedSignalTopicEvaluationLabHostReceiptV1(){
  let handle;
  try{handle=await open(SIGNAL_TOPIC_EVALUATION_LAB_HOST_RECEIPT_PATH,
    constants.O_RDONLY|constants.O_NOFOLLOW);}catch{throw new SignalTopicEvaluationLabHostProvenanceError(
    "topic_evaluation_lab_host_receipt_missing");}
  try{
    const stat=await handle.stat();
    const owner=typeof process.getuid==="function"?process.getuid():stat.uid;
    if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o777)!==0o600||stat.uid!==owner){
      throw new SignalTopicEvaluationLabHostProvenanceError("topic_evaluation_lab_host_receipt_custody_invalid");
    }
    try{return parseSignalTopicEvaluationLabHostReceiptV1(JSON.parse(await handle.readFile("utf8")));}
    catch(error){if(error instanceof SignalTopicEvaluationLabHostProvenanceError)throw error;
      throw new SignalTopicEvaluationLabHostProvenanceError("topic_evaluation_lab_host_receipt_invalid");}
  }finally{await handle.close();}
}

export async function verifyFixedSignalTopicEvaluationLabHostReceiptV1(dependencies:{
  loadReceipt?:typeof loadFixedSignalTopicEvaluationLabHostReceiptV1;
  inspectContainer?:typeof inspectSignalTopicEvaluationLabContainerV1}={}){
  const receipt=await(dependencies.loadReceipt??loadFixedSignalTopicEvaluationLabHostReceiptV1)();
  const container=await(dependencies.inspectContainer??inspectSignalTopicEvaluationLabContainerV1)();
  if(receipt.container_name!==container.container_name||receipt.container_id!==container.container_id
      ||receipt.image_id!==container.image_id||receipt.image_reference!==container.image_reference
      ||receipt.endpoint_host!==container.endpoint_host||receipt.endpoint_port!==container.endpoint_port){
    throw new SignalTopicEvaluationLabHostProvenanceError("topic_evaluation_lab_host_anchor_drift");
  }
  return{receipt,container};
}

export async function ensureSignalTopicEvaluationLabHostReceiptDirectoryV1(){
  await mkdir(resolve(SIGNAL_TOPIC_EVALUATION_LAB_HOST_RECEIPT_PATH,".."),{recursive:true,mode:0o700});
}

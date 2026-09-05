import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,SIGNAL_TOPIC_EVALUATION_LAB_HOST_RECEIPT_PATH,
  parseSignalTopicEvaluationLabHostReceiptV1,signalTopicEvaluationLabHostReceiptDigestV1,
  verifyFixedSignalTopicEvaluationLabHostReceiptV1,type SignalTopicEvaluationLabHostReceiptV1 }
  from "./signal-topic-evaluation-lab-host-provenance-v2";

const unsigned:Omit<SignalTopicEvaluationLabHostReceiptV1,"receipt_digest">={
  contract_version:"signal-topic-evaluation-lab-host-provenance-v1",
  marker_namespace:"noisia.topic-evaluation.disposable-lab-host-anchor" as const,
  created_at:"2026-09-04T20:30:00.000Z",container_name:SIGNAL_TOPIC_EVALUATION_LAB_CONTAINER_NAME,
  container_id:"a".repeat(64),image_id:`sha256:${"b".repeat(64)}`,
  image_reference:"pgvector/pgvector:pg17" as const,endpoint_host:"127.0.0.1" as const,
  endpoint_port:55439,clone_name:"noisia_topic_eval_lab_20260904_abcdef012345",
  server_system_identifier:"7462383493939691021",
  source_database_name:"noisia_r32_clean_20260904" as const,
  source_run_key:"backend-10c2c-2026-08-21-final-2-bertopic-bge-detail-seed-17" as const,
  source_snapshot_digest:`sha256:${"c".repeat(64)}`,
  source_artifact_binding_digest:`sha256:${"d".repeat(64)}`,
  source_membership_binding_digest:`sha256:${"e".repeat(64)}`,
  candidate_review_migration_digest:
    "sha256:7a6b61cc16dba808e0c98645855e2597db8d0f8ca4665979945c866a0bc3e946" as const,
  database_marker_setup_digest:
    "sha256:0906a2b7cfebbbfb5408d94b48c50652645d6313030f05a01632b16ae6be242b" as const};
const receipt={...unsigned,receipt_digest:signalTopicEvaluationLabHostReceiptDigestV1(unsigned)};
const container={container_name:receipt.container_name,container_id:receipt.container_id,
  image_id:receipt.image_id,image_reference:receipt.image_reference,endpoint_host:receipt.endpoint_host,
  endpoint_port:receipt.endpoint_port};

test("closed host receipt validates its own digest and exact keys",()=>{
  assert.deepEqual(parseSignalTopicEvaluationLabHostReceiptV1(receipt),receipt);
  assert.throws(()=>parseSignalTopicEvaluationLabHostReceiptV1({...receipt,clone_name:
    "noisia_topic_eval_lab_20260904_copied000000"}),/host_receipt_digest_invalid/u);
  assert.throws(()=>parseSignalTopicEvaluationLabHostReceiptV1({...receipt,extra:true}),
    /host_receipt_invalid/u);
});

test("copied receipt and changed immutable container identity fail closed",async()=>{
  for(const changed of [{container_id:"f".repeat(64)},{image_id:`sha256:${"f".repeat(64)}`},
    {endpoint_port:55440}]){
    await assert.rejects(verifyFixedSignalTopicEvaluationLabHostReceiptV1({
      loadReceipt:async()=>receipt,inspectContainer:async()=>({...container,...changed})}),
    /topic_evaluation_lab_host_anchor_drift/u);
  }
});

test("missing external receipt propagates a closed preconnection failure",async()=>{
  await assert.rejects(verifyFixedSignalTopicEvaluationLabHostReceiptV1({
    loadReceipt:async()=>{throw new Error("topic_evaluation_lab_host_receipt_missing");},
    inspectContainer:async()=>container}),/topic_evaluation_lab_host_receipt_missing/u);
});

test("fixed host path and runner sources contain no credential extraction path",async()=>{
  assert.match(SIGNAL_TOPIC_EVALUATION_LAB_HOST_RECEIPT_PATH,
    /\.data\/signal-topic-evaluation\/lab-1b\/clone-provenance\.current\.json$/u);
  const files=await Promise.all(["./signal-topic-evaluation-lab-host-provenance-v2.ts",
    "./create-signal-topic-evaluation-lab-clone-v2.ts",
    "./signal-topic-evaluation-lab-docker-pool-v2.ts",
    "./signal-topic-evaluation-lab-docker-transport-v2.ts"].map((path)=>readFile(new URL(path,import.meta.url),
    "utf8")));
  assert.doesNotMatch(files.join("\n"),/printenv|POSTGRES_PASSWORD|Config\.Env|docker inspect.*Env/iu);
});

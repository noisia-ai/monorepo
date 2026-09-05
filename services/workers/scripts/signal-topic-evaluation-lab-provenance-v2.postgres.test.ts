import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { verifyRegisteredSignalTopicEvaluationArtifactsV2 } from "@noisia/db";

import { createSignalTopicEvaluationLabDockerPoolV1 } from
  "./signal-topic-evaluation-lab-docker-pool-v2";
import { signalTopicEvaluationLabHostReceiptDigestV1 } from
  "./signal-topic-evaluation-lab-host-provenance-v2";
import { preflightSignalTopicEvaluationLabV2,prepareSignalTopicEvaluationLabInvocationV2 }
  from "./preflight-signal-topic-evaluation-lab-v2";

const approved=process.env.NOISIA_TOPIC_EVALUATION_LAB_POSTGRES_TEST_APPROVED==="true";
const root=resolve(fileURLToPath(new URL("../../..",import.meta.url)));

test("fixed external anchor proves the real disposable clone and rejects changed server identity",
  {skip:!approved},async()=>{
    const invocation=await prepareSignalTopicEvaluationLabInvocationV2({
      NOISIA_RUNTIME_PROFILE:"local_disposable_lab_v1"});
    const dependencies={now:()=>0,verifyArtifacts:async(sourceRunKey:string)=>{
      const value=await verifyRegisteredSignalTopicEvaluationArtifactsV2(sourceRunKey);return{
        records:value.records.length,labels:value.labels.length,topics:value.topics.length,
        assigned:value.assigned_count,outliers:value.outlier_count,
        source_manifest_digest:value.source_manifest_digest,
        packet_source_manifest_digest:value.packet_source_manifest_digest,
        source_export_digest:value.source_export_digest,assignment_digest:value.assignment_digest,
        result_digest:value.result_digest,packet_file_digest:value.packet_file_digest,
        packet_digest:value.packet_digest,artifact_binding_digest:value.artifact_binding_digest};},
      migration0115Digest:async()=>`sha256:${createHash("sha256").update(await readFile(resolve(root,
        "infrastructure/db/migrations/0115_signal_topic_evaluation_v2_candidate_review.sql"))).digest("hex")}`,
      writeReceipt:async()=>undefined};
    const receipt=await preflightSignalTopicEvaluationLabV2({
      pool:createSignalTopicEvaluationLabDockerPoolV1(invocation.anchor),target:invocation.target,
      host_receipt:invocation.anchor,provider_configuration_present:false,dependencies});
    assert.equal(receipt.source_authority.canonical_roots,21_195);
    assert.equal(receipt.source_authority.historical_proposals,115);
    assert.equal(receipt.source_authority.catalog_entries,116);
    assert.equal(receipt.source_authority.assigned,11_186);
    assert.equal(receipt.source_authority.outliers,10_009);
    assert.equal(receipt.effects.database_writes,0);

    const {receipt_digest:ignored,...anchorUnsigned}=invocation.anchor;
    const changedUnsigned={...anchorUnsigned,server_system_identifier:"9000000000000000000"};
    await assert.rejects(preflightSignalTopicEvaluationLabV2({
      pool:createSignalTopicEvaluationLabDockerPoolV1(invocation.anchor),target:invocation.target,
      host_receipt:{...changedUnsigned,
        receipt_digest:signalTopicEvaluationLabHostReceiptDigestV1(changedUnsigned)},
      provider_configuration_present:false,dependencies}),/topic_evaluation_lab_clone_provenance_invalid/u);
  });

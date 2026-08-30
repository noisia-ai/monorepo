import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";

import {
  SignalTopicEvaluationFrozenImportError,
  signalTopicEvaluationV2ImportTestOnly,
  verifyRegisteredSignalTopicEvaluationArtifactsV2
} from "./signal-topic-evaluation-v2-import";

test("registered R24A artifacts reconcile the real 21,195-member assignment and packet",async()=>{
  const verified=await verifyRegisteredSignalTopicEvaluationArtifactsV2(
    signalTopicEvaluationV2ImportTestOnly.sourceRunKey);
  assert.deepEqual({records:verified.records.length,labels:verified.labels.length,
    unique_records:new Set(verified.records.map((record)=>record.record_key)).size,
    unique_labels:new Set(verified.labels).size,topics:verified.topics.length,
    assigned:verified.assigned_count,outliers:verified.outlier_count},
  {records:21195,labels:21195,unique_records:21195,unique_labels:116,topics:115,
    assigned:11186,outliers:10009});
  assert.match(verified.artifact_binding_digest,/^sha256:[0-9a-f]{64}$/u);
});

test("assignment index swaps and forged source record digests do not match the sealed packet",async()=>{
  const verified=await verifyRegisteredSignalTopicEvaluationArtifactsV2(
    signalTopicEvaluationV2ImportTestOnly.sourceRunKey);
  const swapped=new Int32Array(verified.labels);let right=1;
  while(swapped[right]===swapped[0])right+=1;
  [swapped[0],swapped[right]]=[swapped[right]!,swapped[0]!];
  assert.throws(()=>signalTopicEvaluationV2ImportTestOnly.validateAssignments(verified.records,swapped,
    verified.strengths,verified.topics,verified.packet_policy_digest),
  (error)=>error instanceof SignalTopicEvaluationFrozenImportError
    &&error.code==="topic_evaluation_v2_assignment_packet_mismatch");
  const assignedIndex=verified.labels.findIndex((label)=>label>=0);
  const forged=verified.records.slice();forged[assignedIndex]={...forged[assignedIndex]!,content_hash:
    "sha256:0000000000000000000000000000000000000000000000000000000000000000"};
  assert.throws(()=>signalTopicEvaluationV2ImportTestOnly.validateAssignments(forged,verified.labels,
    verified.strengths,verified.topics,verified.packet_policy_digest),
  (error)=>error instanceof SignalTopicEvaluationFrozenImportError
    &&error.code==="topic_evaluation_v2_assignment_packet_mismatch");
});

test("artifact and manifest checksum drift fails before canonical mapping",async()=>{
  const root=await mkdtemp(resolve(tmpdir(),"noisia-r24a-artifacts-"));
  let repo=resolve(process.cwd());while(!existsSync(resolve(repo,".data"))&&dirname(repo)!==repo)repo=dirname(repo);
  const modelRel=".data/signal-semantic-lab/backend-10c2c/run-2026-08-21T020023-0600/model-run-final-2";
  const evidenceManifestRel=".data/signal-semantic-lab/backend-10c2c/run-2026-08-21T020023-0600/manifest.sanitized.json";
  const packetRel=".data/signal-semantic-lab/backend-10c3a/run-2026-08-21T100838-0600/operator-review/blind-review-packet.private.json";
  const keyRel=".data/signal-semantic-lab/backend-10c2c/run-2026-08-21T020023-0600/remote-export/pseudonym-key.private.bin";
  const files=[`${modelRel}/source-export.private.jsonl`,`${modelRel}/source-export.manifest.private.json`,
    `${modelRel}/full/bertopic-bge-detail.seed-17.result.json`,packetRel,keyRel,evidenceManifestRel];
  for(const relative of files){await mkdir(dirname(resolve(root,relative)),{recursive:true});
    await symlink(resolve(repo,relative),resolve(root,relative));}
  const assignment=`${modelRel}/full/bertopic-bge-detail.seed-17.assignments.npz`;
  await mkdir(dirname(resolve(root,assignment)),{recursive:true});await copyFile(resolve(repo,assignment),resolve(root,assignment));
  const bytes=await readFile(resolve(root,assignment));bytes[bytes.length-1]=(bytes[bytes.length-1]??0)^1;
  await writeFile(resolve(root,assignment),bytes);
  await chmod(resolve(root,assignment),0o600);
  await assert.rejects(signalTopicEvaluationV2ImportTestOnly.verifyBundle(root),
    (error)=>error instanceof SignalTopicEvaluationFrozenImportError
      &&error.code==="topic_evaluation_v2_artifact_checksum_mismatch");
});

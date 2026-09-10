/** Custody boundary for the one direct, local clone of completed LAB-2G output. */
import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { signalTopicEvaluationDigestV2 } from "@noisia/query-engine";
import { z } from "zod";

import { inspectSignalTopicEvaluationLabContainerV1 } from "./signal-topic-evaluation-lab-host-provenance-v2";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const CONTAINER_ID = /^[0-9a-f]{64}$/u;

export const SIGNAL_TOPIC_REFINEMENT_SUCCESSOR_PARENT_DATABASE = "noisia_topic_eval_lab_20260905_20e4b67a137a";
export const SIGNAL_TOPIC_REFINEMENT_SUCCESSOR_HOST_RECEIPT_PATH = resolve(REPO_ROOT,
  ".data/signal-topic-evaluation/lab-1b/clone-provenance.current.json");

const receiptSchema = z.object({
  contract_version: z.literal("signal-topic-candidate-refinement-successor-host-provenance-v1"),
  created_at: z.string().datetime({ offset: true }),
  container_name: z.literal("noisia-r24a-provenance-pg"),
  container_id: z.string().regex(CONTAINER_ID),
  image_id: z.string().regex(DIGEST),
  image_reference: z.literal("pgvector/pgvector:pg17"),
  endpoint_host: z.literal("127.0.0.1"),
  endpoint_port: z.number().int().min(1024).max(65535),
  clone_name: z.string().regex(/^noisia_topic_eval_lab_[a-z0-9_]{8,64}$/u),
  parent_clone_name: z.literal(SIGNAL_TOPIC_REFINEMENT_SUCCESSOR_PARENT_DATABASE),
  source_run_key: z.literal("backend-10c2c-2026-08-21-final-2-bertopic-bge-detail-seed-17"),
  source_snapshot_digest: z.string().regex(DIGEST),
  source_artifact_binding_digest: z.string().regex(DIGEST),
  source_membership_binding_digest: z.string().regex(DIGEST),
  parent_output_digest: z.string().regex(DIGEST),
  server_system_identifier: z.string().regex(/^\d+$/u),
  receipt_digest: z.string().regex(DIGEST)
}).strict();

export type SignalTopicCandidateRefinementSuccessorHostReceiptV1 = z.infer<typeof receiptSchema>;

export class SignalTopicCandidateRefinementSuccessorHostProvenanceError extends Error {
  constructor(readonly code: string) { super(code); }
}

export function signalTopicCandidateRefinementSuccessorHostReceiptDigestV1(value: Omit<
  SignalTopicCandidateRefinementSuccessorHostReceiptV1, "receipt_digest">) {
  return signalTopicEvaluationDigestV2(value);
}

export function parseSignalTopicCandidateRefinementSuccessorHostReceiptV1(value: unknown) {
  let receipt: SignalTopicCandidateRefinementSuccessorHostReceiptV1;
  try { receipt = receiptSchema.parse(value); }
  catch { throw new SignalTopicCandidateRefinementSuccessorHostProvenanceError("topic_refinement_successor_host_receipt_invalid"); }
  const { receipt_digest: digest, ...unsigned } = receipt;
  if (signalTopicCandidateRefinementSuccessorHostReceiptDigestV1(unsigned) !== digest) {
    throw new SignalTopicCandidateRefinementSuccessorHostProvenanceError("topic_refinement_successor_host_receipt_digest_invalid");
  }
  return receipt;
}

export async function loadFixedSignalTopicCandidateRefinementSuccessorHostReceiptV1() {
  let handle;
  try { handle = await open(SIGNAL_TOPIC_REFINEMENT_SUCCESSOR_HOST_RECEIPT_PATH, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { throw new SignalTopicCandidateRefinementSuccessorHostProvenanceError("topic_refinement_successor_host_receipt_missing"); }
  try {
    const stat = await handle.stat();
    const owner = typeof process.getuid === "function" ? process.getuid() : stat.uid;
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.uid !== owner) {
      throw new SignalTopicCandidateRefinementSuccessorHostProvenanceError("topic_refinement_successor_host_receipt_custody_invalid");
    }
    try { return parseSignalTopicCandidateRefinementSuccessorHostReceiptV1(JSON.parse(await handle.readFile("utf8"))); }
    catch (error) {
      if (error instanceof SignalTopicCandidateRefinementSuccessorHostProvenanceError) throw error;
      throw new SignalTopicCandidateRefinementSuccessorHostProvenanceError("topic_refinement_successor_host_receipt_invalid");
    }
  } finally { await handle.close(); }
}

export async function verifyFixedSignalTopicCandidateRefinementSuccessorHostReceiptV1() {
  const [receipt, container] = await Promise.all([
    loadFixedSignalTopicCandidateRefinementSuccessorHostReceiptV1(), inspectSignalTopicEvaluationLabContainerV1()
  ]);
  if (receipt.container_name !== container.container_name || receipt.container_id !== container.container_id
      || receipt.image_id !== container.image_id || receipt.image_reference !== container.image_reference
      || receipt.endpoint_host !== container.endpoint_host || receipt.endpoint_port !== container.endpoint_port) {
    throw new SignalTopicCandidateRefinementSuccessorHostProvenanceError("topic_refinement_successor_host_anchor_drift");
  }
  return { receipt, container };
}

export async function ensureSignalTopicCandidateRefinementSuccessorHostReceiptDirectoryV1() {
  await mkdir(resolve(SIGNAL_TOPIC_REFINEMENT_SUCCESSOR_HOST_RECEIPT_PATH, ".."), { recursive: true, mode: 0o700 });
}

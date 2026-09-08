import type { Job } from "bullmq";
import {
  claimSignalWorkspaceEmbeddingRunV1,
  readSignalWorkspaceEmbeddingBatchV1,
  reserveSignalWorkspaceEmbeddingCallV1,
  markSignalWorkspaceEmbeddingCallSentV1,
  persistSignalWorkspaceEmbeddingResponseV1,
  commitSignalWorkspaceEmbeddingBatchV1,
  finishSignalWorkspaceEmbeddingsV1,
  failSignalWorkspaceEmbeddingCallV1,
  type SignalWorkspaceEmbeddingsDatabaseV1,
  type SignalWorkspaceEmbeddingCursorV1,
  type SignalWorkspaceEmbeddingInputContractV1,
  type SignalWorkspaceEmbeddingCallV1,
  type SignalWorkspaceEmbeddingLeaseV1,
  type SignalWorkspaceEmbeddingTextCacheV1
} from "@noisia/db";
import {
  assertSignalWorkspaceEmbeddingProfileV1,
  validateSignalWorkspaceEmbeddingInputsV1
} from "@noisia/query-engine";
import {
  createWorkspaceVoyageEmbeddingProviderV1,
  validateWorkspaceVoyageResponseV1,
  WorkspaceEmbeddingProviderErrorV1,
  type WorkspaceEmbeddingProviderV1,
  type WorkspaceEmbeddingRawResponseV1
} from "./signal-workspace-embeddings-provider";

export const SIGNAL_WORKSPACE_EMBEDDINGS_JOB_NAME = "signal-workspace-embeddings-v1";
export type SignalWorkspaceEmbeddingsJobV1 = { run_id: string };
const stores = {
  claim: claimSignalWorkspaceEmbeddingRunV1,
  readBatch: readSignalWorkspaceEmbeddingBatchV1,
  reserve: reserveSignalWorkspaceEmbeddingCallV1,
  markSent: markSignalWorkspaceEmbeddingCallSentV1,
  persistResponse: persistSignalWorkspaceEmbeddingResponseV1,
  commit: commitSignalWorkspaceEmbeddingBatchV1,
  finish: finishSignalWorkspaceEmbeddingsV1,
  fail: failSignalWorkspaceEmbeddingCallV1
};
type Options = {
  database?: SignalWorkspaceEmbeddingsDatabaseV1;
  stores?: typeof stores;
  provider?: WorkspaceEmbeddingProviderV1;
};

export async function signalWorkspaceEmbeddingsJobV1(
  job: Pick<Job<SignalWorkspaceEmbeddingsJobV1>, "id" | "data" | "updateProgress">,
  options: Options = {}
) {
  if (!job.id || typeof job.data?.run_id !== "string") throw new Error("workspace_embedding_job_invalid");
  const database = options.database ?? (await import("../db/client")).pool;
  const store = options.stores ?? stores;
  let lease: SignalWorkspaceEmbeddingLeaseV1 | null = await store.claim({
    database, run_id: job.data.run_id, worker_job_id: job.id
  });
  if (!lease) return { run_id: job.data.run_id, replayed: true };
  const provider = options.provider ?? createWorkspaceVoyageEmbeddingProviderV1();
  // Only the current immutable asset is retained, with a server-enforced byte cap.
  // Never share text across jobs or workspaces through module-level memory.
  const textCache: SignalWorkspaceEmbeddingTextCacheV1 = {};
  let call: SignalWorkspaceEmbeddingCallV1 | null = null;
  let transportStarted = false;
  let responsePersisted = false;
  let batches = 0;
  try {
    assertSignalWorkspaceEmbeddingProfileV1(lease.profile);
    const contract = inputContract(lease.input_contract);
    if (!sameCursor(lease.cursor, lease.cursor, contract)) throw new Error("workspace_embedding_cursor_mismatch");
    for (;;) {
      call = null; transportStarted = false; responsePersisted = false;
      const batch = await store.readBatch({ database, lease, text_cache: textCache });
      if (inputContract(batch.input_contract) !== contract || !sameCursor(batch.cursor, lease.cursor, contract)
        || !sameCursor(batch.next_cursor, batch.next_cursor, contract)
        || batch.items.length > 0 && sameCursor(batch.next_cursor, lease.cursor, contract)) {
        throw new Error("workspace_embedding_cursor_mismatch");
      }
      if (!batch.items.length) {
        if (!batch.done) throw new Error("workspace_embedding_batch_stalled");
        break;
      }
      if (batch.inputs.length) validateSignalWorkspaceEmbeddingInputsV1(batch.inputs);
      call = await store.reserve({ database, lease, batch });
      let validated;
      if (call) {
        let raw: WorkspaceEmbeddingRawResponseV1;
        if (call.state === "reserved") {
          await store.markSent({ database, lease, call_id: call.call_id, attempt_token: call.attempt_token });
          transportStarted = true;
          raw = await provider.embedBatch(batch.inputs);
          // A response is an accounting receipt even if authority changes during fetch.
          // The subsequent cache/checkpoint commit revalidates current authority.
          await store.persistResponse({ database, call_id: call.call_id,
            attempt_token: call.attempt_token, response: raw });
          responsePersisted = true;
        } else {
          if (call.response_body === null || call.response_http_status === null) {
            throw new Error("workspace_embedding_response_receipt_missing");
          }
          raw = { body: call.response_body, http_status: call.response_http_status,
            provider_request_id: call.provider_request_id };
          responsePersisted = true;
        }
        const response = validateWorkspaceVoyageResponseV1(batch.inputs, raw);
        validated = { vectors: response.embeddings.map(entry => ({
          chunk_sha256: batch.inputs[entry.index]!.chunk_sha256, embedding: entry.vector
        })), total_tokens: response.total_tokens, provider_request_id: response.provider_request_id };
      }
      const next = await store.commit({ database, lease, batch, call_id: call?.call_id ?? null,
        attempt_token: call?.attempt_token, validated });
      if (inputContract(next.input_contract) !== contract || !sameCursor(next.cursor, batch.next_cursor, contract)
        || sameCursor(next.cursor, lease.cursor, contract)) {
        throw new Error("workspace_embedding_checkpoint_invalid");
      }
      lease = next;
      call = null; transportStarted = false; responsePersisted = false;
      batches++;
      await job.updateProgress({ batches_completed_this_attempt: batches }).catch(() => undefined);
      if (batch.done) break;
    }
    const result = await store.finish({ database, lease });
    await job.updateProgress(100).catch(() => undefined);
    return { run_id: job.data.run_id, ...result };
  } catch (error) {
    const boundary = error instanceof WorkspaceEmbeddingProviderErrorV1 ? error : null;
    const outcome = boundary?.outcome ?? (transportStarted && !responsePersisted ? "outcome_unknown" : "local_failure");
    const error_code = boundary?.outcome === "definitely_not_sent"
      ? "workspace_embedding_definitely_not_sent" : safeWorkspaceEmbeddingErrorV1(error);
    await store.fail({ database, lease, call_id: call?.call_id, attempt_token: call?.attempt_token,
      outcome, error_code, total_tokens: boundary?.evidence.total_tokens }).catch(() => undefined);
    // Do not put unknown provider/DB messages or corpus material in BullMQ's error record.
    throw new Error(error_code);
  }
}

function inputContract(value: unknown): SignalWorkspaceEmbeddingInputContractV1 {
  // Older corpus-only store injections omit the discriminator. No other implicit
  // conversion is allowed; job.data never chooses a run's input authority.
  if (value === undefined || value === "corpus") return "corpus";
  if (value === "topic_prototypes") return value;
  throw new Error("workspace_embedding_input_contract_invalid");
}

function sameCursor(left: SignalWorkspaceEmbeddingCursorV1, right: SignalWorkspaceEmbeddingCursorV1,
  contract: SignalWorkspaceEmbeddingInputContractV1) {
  const valid = (value: SignalWorkspaceEmbeddingCursorV1) => {
    if (value === null) return true;
    if (!value || typeof value !== "object") return false;
    if (contract === "topic_prototypes") return Object.keys(value).join(",") === "input_sha256"
      && "input_sha256" in value && typeof value.input_sha256 === "string" && value.input_sha256.length > 0;
    return Object.keys(value).sort().join(",") === "asset_sha256,chunk_index"
      && "asset_sha256" in value && typeof value.asset_sha256 === "string" && value.asset_sha256.length > 0
      && "chunk_index" in value && Number.isSafeInteger(value.chunk_index) && value.chunk_index >= 0;
  };
  if (!valid(left) || !valid(right)) return false;
  if (left === null || right === null) return left === right;
  if ("input_sha256" in left && "input_sha256" in right) return left.input_sha256 === right.input_sha256;
  return "asset_sha256" in left && "asset_sha256" in right
    && left.asset_sha256 === right.asset_sha256 && left.chunk_index === right.chunk_index;
}

export function safeWorkspaceEmbeddingErrorV1(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (typeof code === "string" && /^workspace_embeddings?_[a-z_]{1,100}$/u.test(code)) return code;
  const message = error instanceof Error ? error.message : "";
  return /^workspace_embeddings?_[a-z_]{1,100}$/u.test(message)
    ? message : "workspace_embedding_worker_failed";
}

import { createHash } from "node:crypto";
import type { Job } from "bullmq";
import {
  parseSignalWorkspaceClassificationOutcomeV1,
  signalWorkspaceClassificationIdentitySchemaV1,
  signalWorkspaceClassificationRootIdentitySchemaV1,
  signalWorkspaceEmbeddingDigestV1,
  type SignalWorkspaceClassificationIdentityV1,
  type SignalWorkspaceClassificationRootIdentityV1,
  type SignalWorkspaceClassificationOutcomeV1
} from "@noisia/query-engine";

export type SignalWorkspaceClassificationLeaseV1 = {
  execution_id: string;
  workspace_id: string;
  execution_token: string;
  cursor_root_id: string | null;
  input_digest: string;
  identity: SignalWorkspaceClassificationIdentityV1;
};
export type SignalWorkspaceClassificationRootV1 = SignalWorkspaceClassificationRootIdentityV1 & {
  asset_sha256: string;
  expected_chunks: number;
  chunk_coverage_digest: string;
  reuse_item_id: string | null;
};
export type SignalWorkspaceClassificationChunkV1 = {
  chunk_index: number;
  start: number;
  end: number;
  chunk_sha256: string;
  text: string;
};
export type SignalWorkspaceClassificationChunkPageV1 = {
  root_id: string;
  asset_sha256: string;
  expected_chunks: number;
  after_chunk_index: number | null;
  items: SignalWorkspaceClassificationChunkV1[];
  next_chunk_index: number | null;
  done: boolean;
};

/** No default DB or engine: this integration is intentionally not registered
 * as a product job until a real decision engine and its authority are ready. */
export type SignalWorkspaceClassificationStoresV1<Database> = {
  claim(args: { database: Database; execution_id: string; worker_job_id: string }): Promise<SignalWorkspaceClassificationLeaseV1 | null>;
  readRoots(args: { database: Database; lease: SignalWorkspaceClassificationLeaseV1; limit: number }): Promise<{
    items: SignalWorkspaceClassificationRootV1[]; done: boolean;
  }>;
  readChunks(args: { database: Database; lease: SignalWorkspaceClassificationLeaseV1; root_id: string;
    after_chunk_index: number | null; limit: number }): Promise<SignalWorkspaceClassificationChunkPageV1>;
  copyRoot(args: { database: Database; lease: SignalWorkspaceClassificationLeaseV1; root_id: string;
    source_item_id: string }): Promise<SignalWorkspaceClassificationLeaseV1>;
  commitRoot(args: { database: Database; lease: SignalWorkspaceClassificationLeaseV1;
    outcome: SignalWorkspaceClassificationOutcomeV1 }): Promise<SignalWorkspaceClassificationLeaseV1>;
  finish(args: { database: Database; lease: SignalWorkspaceClassificationLeaseV1 }): Promise<unknown>;
  fail(args: { database: Database; lease: SignalWorkspaceClassificationLeaseV1; error_code: string }): Promise<unknown>;
};
export type SignalWorkspaceClassificationEngineV1 = Pick<SignalWorkspaceClassificationIdentityV1,
  "engine_key" | "engine_version" | "engine_artifact_digest"> & {
  classifyRoot(args: {
    identity: SignalWorkspaceClassificationIdentityV1;
    root: SignalWorkspaceClassificationRootV1;
    chunks: AsyncIterable<ReadonlyArray<SignalWorkspaceClassificationChunkV1>>;
  }): Promise<SignalWorkspaceClassificationOutcomeV1>;
};

type Options<Database> = {
  database: Database;
  stores: SignalWorkspaceClassificationStoresV1<Database>;
  engine: SignalWorkspaceClassificationEngineV1;
  root_page_size?: number;
  chunk_page_size?: number;
};

export async function signalWorkspaceClassificationJobV1<Database>(
  job: Pick<Job<{ execution_id: string }>, "id" | "data" | "updateProgress">,
  options: Options<Database>
) {
  if (!options?.engine || typeof options.engine.classifyRoot !== "function" || !options.stores
    || !("database" in options)) throw new Error("workspace_classification_dependencies_required");
  if (!job.id || typeof job.data?.execution_id !== "string") throw new Error("workspace_classification_job_invalid");
  const rootLimit = boundedSize(options.root_page_size, 100), chunkLimit = boundedSize(options.chunk_page_size, 128);
  const { database, stores: store, engine } = options;
  let lease = await store.claim({ database, execution_id: job.data.execution_id, worker_job_id: job.id })
    .catch(error => { throw new Error(safeWorkspaceClassificationErrorV1(error)); });
  if (!lease) return { execution_id: job.data.execution_id, replayed: true };
  let processed = 0, reused = 0;
  try {
    const identity = signalWorkspaceClassificationIdentitySchemaV1.parse(lease.identity);
    if (lease.execution_id !== job.data.execution_id || lease.workspace_id !== identity.workspace_id
      || engine.engine_key !== identity.engine_key || engine.engine_version !== identity.engine_version
      || engine.engine_artifact_digest !== identity.engine_artifact_digest) {
      throw new Error("workspace_classification_engine_identity_mismatch");
    }
    for (;;) {
      const page = await store.readRoots({ database, lease, limit: rootLimit });
      if (page.items.length > rootLimit || page.items.length === 0 && !page.done) {
        throw new Error("workspace_classification_root_page_invalid");
      }
      for (const root of page.items) {
        const rootIdentity = signalWorkspaceClassificationRootIdentitySchemaV1.parse({
          root_id: root.root_id, fingerprint: root.fingerprint, correction_digest: root.correction_digest
        });
        if (lease.cursor_root_id !== null && root.root_id <= lease.cursor_root_id
          || !Number.isSafeInteger(root.expected_chunks) || root.expected_chunks < 1) {
          throw new Error("workspace_classification_root_sequence_invalid");
        }
        let next: SignalWorkspaceClassificationLeaseV1;
        if (root.reuse_item_id !== null) {
          // The store verifies equivalence, complete source generation, source
          // authority and current rights again in the atomic copy transaction.
          next = await store.copyRoot({ database, lease, root_id: root.root_id, source_item_id: root.reuse_item_id });
          reused++;
        } else {
          const stream = verifiedChunks(root, lease);
          const raw = await engine.classifyRoot({ identity, root, chunks: stream.chunks });
          const outcome = parseSignalWorkspaceClassificationOutcomeV1({ identity, root: rootIdentity, outcome: raw });
          if (outcome.coverage.expected_chunks !== root.expected_chunks
            || outcome.coverage.processed_chunks !== stream.processed()
            || outcome.coverage.chunk_coverage_digest !== root.chunk_coverage_digest
            || outcome.resolution_state !== "error" && !stream.complete()) {
            throw new Error("workspace_classification_chunk_coverage_incomplete");
          }
          next = await store.commitRoot({ database, lease, outcome });
          processed++;
        }
        assertCheckpoint(lease, next, root.root_id);
        lease = next;
        await job.updateProgress({ phase: "classifying", processed_roots_this_attempt: processed,
          reused_roots_this_attempt: reused }).catch(() => undefined);
      }
      if (page.done) break;
    }
    const result = await store.finish({ database, lease });
    await job.updateProgress(100).catch(() => undefined);
    return result;
  } catch (error) {
    const code = safeWorkspaceClassificationErrorV1(error);
    await store.fail({ database, lease, error_code: code }).catch(() => undefined);
    throw new Error(code);
  }

  function verifiedChunks(root: SignalWorkspaceClassificationRootV1, activeLease: SignalWorkspaceClassificationLeaseV1) {
    let processedChunks = 0, nextStart = 0, complete = false, started = false;
    const assetHash = createHash("sha256");
    // Reuse the ordered fragment receipt from workspace search/0134 without
    // retaining metadata for every fragment of a very large document.
    const coverageHash = createHash("sha256");
    const chunks: AsyncIterable<ReadonlyArray<SignalWorkspaceClassificationChunkV1>> = {
      [Symbol.asyncIterator]: async function* () {
        if (started) throw new Error("workspace_classification_chunk_stream_reused");
        started = true;
        let after: number | null = null;
        for (;;) {
          const page = await store.readChunks({ database, lease: activeLease, root_id: root.root_id,
            after_chunk_index: after, limit: chunkLimit });
          if (page.root_id !== root.root_id || page.asset_sha256 !== root.asset_sha256
            || page.expected_chunks !== root.expected_chunks || page.after_chunk_index !== after
            || page.items.length > chunkLimit || page.items.length === 0 && !page.done) {
            throw new Error("workspace_classification_chunk_page_invalid");
          }
          for (const chunk of page.items) {
            if (chunk.chunk_index !== processedChunks || chunk.start !== nextStart
              || chunk.end !== chunk.start + chunk.text.length || chunk.text.length < 1 || chunk.text.length > 1400
              || chunk.chunk_sha256 !== `sha256:${createHash("sha256").update(chunk.text, "utf8").digest("hex")}`) {
              throw new Error("workspace_classification_chunk_integrity_failed");
            }
            assetHash.update(chunk.text, "utf8");
            coverageHash.update(JSON.stringify([chunk.chunk_index, chunk.start, chunk.end, chunk.chunk_sha256]) + "\n");
            processedChunks++;
            nextStart = chunk.end;
          }
          if (processedChunks > root.expected_chunks
            || page.next_chunk_index !== (page.items.at(-1)?.chunk_index ?? after)) {
            throw new Error("workspace_classification_chunk_cursor_invalid");
          }
          after = page.next_chunk_index;
          if (page.done) {
            if (processedChunks !== root.expected_chunks
              || `sha256:${assetHash.digest("hex")}` !== root.asset_sha256
              || `sha256:${coverageHash.digest("hex")}` !== root.chunk_coverage_digest) {
              throw new Error("workspace_classification_chunk_coverage_incomplete");
            }
            complete = true;
          }
          if (page.items.length > 0) yield page.items;
          if (page.done) return;
        }
      }
    };
    return { chunks, processed: () => processedChunks, complete: () => complete };
  }
}

function assertCheckpoint(previous: SignalWorkspaceClassificationLeaseV1,
  next: SignalWorkspaceClassificationLeaseV1, rootId: string) {
  if (next.cursor_root_id !== rootId || next.execution_id !== previous.execution_id
    || next.workspace_id !== previous.workspace_id || next.execution_token !== previous.execution_token
    || next.input_digest !== previous.input_digest
    || signalWorkspaceEmbeddingDigestV1(next.identity) !== signalWorkspaceEmbeddingDigestV1(previous.identity)) {
    throw new Error("workspace_classification_checkpoint_invalid");
  }
}

function boundedSize(value: number | undefined, maximum: number) {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error("workspace_classification_page_size_invalid");
  return value;
}

export function safeWorkspaceClassificationErrorV1(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  const value = typeof code === "string" ? code : error instanceof Error ? error.message : "";
  return /^workspace_classification_[a-z_]{1,100}$/u.test(value) ? value : "workspace_classification_worker_failed";
}

import { createHash } from "node:crypto";
import type { Job } from "bullmq";
import {
  parseSignalWorkspaceClassificationOutcomeV1,
  signalWorkspaceClassificationIdentitySchemaV1,
  signalWorkspaceClassificationRootIdentitySchemaV1,
  signalWorkspaceEmbeddingDigestV1,
  type SignalWorkspaceClassificationOutcomeV1,
} from "@noisia/query-engine";
import type {
  SignalWorkspaceClassificationPageV1,
  SignalWorkspaceClassificationChunksPageV1,
  SignalWorkspaceClassificationChunksCursorV1,
} from "@noisia/db";
import {
  safeWorkspaceClassificationErrorV1,
  type SignalWorkspaceClassificationLeaseV1 as Lease,
  type SignalWorkspaceClassificationRootV1 as Root,
  type SignalWorkspaceClassificationChunkV1 as Chunk,
  type SignalWorkspaceClassificationEngineV1 as Engine,
} from "./signal-workspace-classification";

export const WORKSPACE_PROJECTION_PAGE_BYTES_V1 = 8 * 1024 * 1024;
export type WorkspaceProjectionPageStoresV1<Database> = {
  readPage(args: { database: Database; lease: Lease; limit: number }): Promise<SignalWorkspaceClassificationPageV1>;
  readChunksPage(args: { database: Database; lease: Lease; root_ids: string[];
    after: SignalWorkspaceClassificationChunksCursorV1 | null; limit: number }): Promise<SignalWorkspaceClassificationChunksPageV1>;
  commitPage(args: { database: Database; lease: Lease; outcomes: SignalWorkspaceClassificationOutcomeV1[] }): Promise<Lease>;
  finish(args: { database: Database; lease: Lease }): Promise<unknown>;
  fail(args: { database: Database; lease: Lease; error_code: string }): Promise<unknown>;
};

/** The projection job has already checked the numerical census and claimed the
 * execution. Commit complete root prefixes together; never buffer an entire
 * corpus, truncate a long mention, or manufacture a copied result. */
export async function projectWorkspaceClassificationPagesV1<Database>(args: {
  job: Pick<Job<{ execution_id: string }>, "id" | "data" | "updateProgress">;
  database: Database; lease: Lease; stores: WorkspaceProjectionPageStoresV1<Database>; engine: Engine;
  root_page_size?: number; chunk_page_size?: number; page_bytes?: number;
}) {
  const { database, stores: store, job, engine } = args;
  let lease = args.lease, processed = 0;
  const rootLimit = limit(args.root_page_size, 128), chunkLimit = limit(args.chunk_page_size, 128);
  const byteLimit = limit(args.page_bytes, WORKSPACE_PROJECTION_PAGE_BYTES_V1);
  try {
    const identity = signalWorkspaceClassificationIdentitySchemaV1.parse(lease.identity);
    if (!job.id || lease.execution_id !== job.data.execution_id || lease.workspace_id !== identity.workspace_id
      || engine.engine_key !== identity.engine_key || engine.engine_version !== identity.engine_version
      || engine.engine_artifact_digest !== identity.engine_artifact_digest) invalid("engine_identity_mismatch");
    for (;;) {
      const page = await store.readPage({ database, lease, limit: rootLimit });
      if (page.items.length > rootLimit || !page.items.length && !page.done) invalid("root_page_invalid");
      let prior = lease.cursor_root_id;
      for (const { root } of page.items) {
        signalWorkspaceClassificationRootIdentitySchemaV1.parse({ root_id: root.root_id,
          fingerprint: root.fingerprint, correction_digest: root.correction_digest });
        if (prior !== null && root.root_id <= prior || !Number.isSafeInteger(root.expected_chunks)
          || root.expected_chunks < 1) invalid("root_sequence_invalid");
        prior = root.root_id;
      }
      let committed = 0;
      let buffer: SignalWorkspaceClassificationChunksPageV1["items"] = [], bufferIndex = 0;
      let chunkCursor: SignalWorkspaceClassificationChunksCursorV1 | null = null, chunksDone = false;
      let outcomes: SignalWorkspaceClassificationOutcomeV1[] = [], bytes = 2;
      const flush = async () => {
        if (!outcomes.length) return;
        const next = await store.commitPage({ database, lease, outcomes });
        const last = outcomes.at(-1)!.root.root_id;
        if (next.cursor_root_id !== last || next.execution_id !== lease.execution_id
          || next.workspace_id !== lease.workspace_id || next.execution_token !== lease.execution_token
          || next.input_digest !== lease.input_digest
          || signalWorkspaceEmbeddingDigestV1(next.identity) !== signalWorkspaceEmbeddingDigestV1(lease.identity)) invalid("checkpoint_invalid");
        committed += outcomes.length; processed += outcomes.length; lease = next;
        if (chunkCursor && chunkCursor.root_id <= last) chunkCursor = null;
        outcomes = []; bytes = 2;
        await job.updateProgress({ phase: "classifying", processed_roots_this_attempt: processed,
          reused_roots_this_attempt: 0 }).catch(() => undefined);
      };
      const nextChunk = async () => {
        if (bufferIndex < buffer.length) return buffer[bufferIndex++];
        if (chunksDone) invalid("chunk_coverage_incomplete");
        const remaining = page.items.slice(committed).map(item => item.root.root_id);
        const chunkPage = await store.readChunksPage({ database, lease, root_ids: remaining,
          after: chunkCursor, limit: chunkLimit });
        if (chunkPage.items.length > chunkLimit || !chunkPage.items.length && !chunkPage.done) invalid("chunk_page_invalid");
        let previous = chunkCursor;
        for (const chunk of chunkPage.items) {
          if (!remaining.includes(chunk.root_id) || previous !== null
            && (chunk.root_id < previous.root_id || chunk.root_id === previous.root_id && chunk.chunk_index <= previous.chunk_index))
            invalid("chunk_cursor_invalid");
          previous = { root_id: chunk.root_id, chunk_index: chunk.chunk_index };
        }
        if (JSON.stringify(chunkPage.next_cursor) !== JSON.stringify(previous)) invalid("chunk_cursor_invalid");
        chunkCursor = previous; chunksDone = chunkPage.done; buffer = chunkPage.items; bufferIndex = 0;
        if (!buffer.length) invalid("chunk_coverage_incomplete");
        return buffer[bufferIndex++];
      };
      for (const { root } of page.items) {
        let count = 0, start = 0, complete = false, used = false;
        const assetHash = createHash("sha256"), coverageHash = createHash("sha256");
        const chunks: AsyncIterable<ReadonlyArray<Chunk>> = { [Symbol.asyncIterator]: async function* () {
          if (used) invalid("chunk_stream_reused"); used = true;
          while (count < root.expected_chunks) {
            const result: Chunk[] = [];
            while (result.length < chunkLimit && count < root.expected_chunks) {
              const chunk = await nextChunk();
              if (!chunk || chunk.root_id !== root.root_id || chunk.asset_sha256 !== root.asset_sha256
                || chunk.expected_chunks !== root.expected_chunks || chunk.chunk_index !== count || chunk.start !== start
                || chunk.end !== chunk.start + chunk.text.length || !chunk.text.length || chunk.text.length > 1400
                || chunk.chunk_sha256 !== `sha256:${createHash("sha256").update(chunk.text, "utf8").digest("hex")}`)
                invalid("chunk_integrity_failed");
              assetHash.update(chunk.text, "utf8");
              coverageHash.update(JSON.stringify([chunk.chunk_index, chunk.start, chunk.end, chunk.chunk_sha256]) + "\n");
              count++; start = chunk.end; result.push(chunk);
            }
            if (count === root.expected_chunks) {
              if (`sha256:${assetHash.digest("hex")}` !== root.asset_sha256
                || `sha256:${coverageHash.digest("hex")}` !== root.chunk_coverage_digest) invalid("chunk_coverage_incomplete");
              complete = true;
            }
            yield result;
          }
        } };
        const outcome = parseSignalWorkspaceClassificationOutcomeV1({ identity,
          root: { root_id: root.root_id, fingerprint: root.fingerprint, correction_digest: root.correction_digest },
          outcome: await engine.classifyRoot({ identity, root: root as Root, chunks }) });
        if (!complete || outcome.coverage.expected_chunks !== root.expected_chunks || outcome.coverage.processed_chunks !== count
          || outcome.coverage.chunk_coverage_digest !== root.chunk_coverage_digest) invalid("chunk_coverage_incomplete");
        const size = Buffer.byteLength(JSON.stringify(outcome), "utf8");
        if (size + 2 > byteLimit) invalid("page_capacity_exceeded");
        if (bytes + size + (outcomes.length ? 1 : 0) > byteLimit) await flush();
        bytes += size + (outcomes.length ? 1 : 0); outcomes.push(outcome);
      }
      // Detect a surplus fragment even when every expected root was consumed.
      if (bufferIndex !== buffer.length) invalid("chunk_coverage_incomplete");
      if (page.items.length && !chunksDone) {
        const tail = await store.readChunksPage({ database, lease,
          root_ids: page.items.slice(committed).map(item => item.root.root_id), after: chunkCursor, limit: chunkLimit });
        if (!tail.done || tail.items.length || JSON.stringify(tail.next_cursor) !== JSON.stringify(chunkCursor)) invalid("chunk_coverage_incomplete");
      }
      await flush();
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
}

function invalid(suffix: string): never { throw new Error(`workspace_classification_${suffix}`); }
function limit(value: number | undefined, maximum: number) {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) invalid("page_size_invalid");
  return value;
}

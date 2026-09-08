import type { Job } from "bullmq";
import {
  claimSignalWorkspaceTopicComputationV1,
  readSignalWorkspaceTopicRootPageV1,
  readSignalWorkspaceTopicRootChunksV1,
  readSignalWorkspaceTopicDefinitionsV1,
  readSignalWorkspaceTopicPrototypesV1,
  commitSignalWorkspaceTopicRootV1,
  finishSignalWorkspaceTopicComputationV1,
  failSignalWorkspaceTopicComputationV1,
  type SignalWorkspaceTopicDatabaseV1,
  type SignalWorkspaceTopicLeaseV1,
  type SignalWorkspaceTopicRootV1,
  type SignalWorkspaceTopicTextCacheV1
} from "@noisia/db";
import {
  SIGNAL_WORKSPACE_TOPIC_SEARCH_JOB_NAME_V1,
  createSignalWorkspaceTopicSearchAccumulatorV1,
  createSignalWorkspaceTopicSearchShortlistV1,
  type SignalWorkspaceSearchTopicV1
} from "@noisia/query-engine";

export const SIGNAL_WORKSPACE_TOPIC_COMPUTATION_JOB_NAME = SIGNAL_WORKSPACE_TOPIC_SEARCH_JOB_NAME_V1;
export type SignalWorkspaceTopicComputationJobV1 = { execution_id: string };

const stores = {
  claim: claimSignalWorkspaceTopicComputationV1,
  readRoots: readSignalWorkspaceTopicRootPageV1,
  readChunks: readSignalWorkspaceTopicRootChunksV1,
  readTopics: readSignalWorkspaceTopicDefinitionsV1,
  readPrototypes: readSignalWorkspaceTopicPrototypesV1,
  commitRoot: commitSignalWorkspaceTopicRootV1,
  finish: finishSignalWorkspaceTopicComputationV1,
  fail: failSignalWorkspaceTopicComputationV1
};
type Options = { database?: SignalWorkspaceTopicDatabaseV1; stores?: typeof stores;
  root_page_size?: number; chunk_page_size?: number; topic_page_size?: number };

/** Exhaustive chunk evaluation with a bounded retrieval shortlist. This handler
 * has no provider transport and creates no semantic approvals or serving state. */
export async function signalWorkspaceTopicComputationJobV1(
  job: Pick<Job<SignalWorkspaceTopicComputationJobV1>, "id" | "data" | "updateProgress">,
  options: Options = {}
) {
  if (!job.id || typeof job.data?.execution_id !== "string") throw new Error("workspace_topic_job_invalid");
  const database = options.database ?? (await import("../db/client")).pool;
  const store = options.stores ?? stores;
  let lease: SignalWorkspaceTopicLeaseV1 | null = await store.claim({ database,
    execution_id: job.data.execution_id, worker_job_id: job.id }).catch((error) => {
    throw new Error(safeWorkspaceTopicErrorV1(error));
  });
  if (!lease) return { execution_id: job.data.execution_id, replayed: true };
  let completedRoots = 0;
  try {
    for (;;) {
      const page = await store.readRoots({ database, lease, limit: boundedSize(options.root_page_size, 100) });
      if (page.items.length === 0 && !page.done) throw new Error("workspace_topic_root_page_stalled");
      for (const root of page.items) {
        if (lease.cursor_root_id !== null && root.root_id <= lease.cursor_root_id) {
          throw new Error("workspace_topic_root_sequence_invalid");
        }
        const result = await scoreRoot(root, lease);
        const next = await store.commitRoot({ database, lease, root_id: root.root_id, result });
        if (next.cursor_root_id !== root.root_id || next.execution_id !== lease.execution_id
          || next.input_digest !== lease.input_digest || next.workspace_id !== lease.workspace_id) {
          throw new Error("workspace_topic_checkpoint_invalid");
        }
        lease = next;
        completedRoots++;
        // Redis progress cannot undo an already durable root result and cursor.
        await job.updateProgress({ phase: "searching", completed_roots_this_attempt: completedRoots }).catch(() => undefined);
      }
      if (page.done) break;
    }
    const result = await store.finish({ database, lease });
    await job.updateProgress(100).catch(() => undefined);
    return result;
  } catch (error) {
    const code = safeWorkspaceTopicErrorV1(error);
    await store.fail({ database, lease, error_code: code }).catch(() => undefined);
    throw new Error(code);
  }

  async function scoreRoot(root: SignalWorkspaceTopicRootV1, activeLease: SignalWorkspaceTopicLeaseV1) {
    const shortlist = createSignalWorkspaceTopicSearchShortlistV1();
    const textCache: SignalWorkspaceTopicTextCacheV1 = {};
    let afterTerm: string | null = null;
    let scannedChunks = false;
    for (;;) {
      const page = await store.readTopics({ database, lease: activeLease,
        after_term_key: afterTerm, limit: boundedSize(options.topic_page_size, 32) });
      if (page.items.length === 0 && !page.done) throw new Error("workspace_topic_definition_page_stalled");
      const topics: SignalWorkspaceSearchTopicV1[] = [];
      for (const item of page.items) {
        const term = item.term_key;
        if (afterTerm !== null && term <= afterTerm) throw new Error("workspace_topic_definition_sequence_invalid");
        afterTerm = term;
        if (root.semantic_scope_available && !root.scopes.includes(item.scope)) continue;
        topics.push(item);
      }
      if (page.items.length > 0 && page.next_term_key !== afterTerm) {
        throw new Error("workspace_topic_definition_cursor_invalid");
      }
      if (topics.length > 0) {
        shortlist.addBlock(await scanChunks(topics));
        scannedChunks = true;
      }
      if (page.done) break;
    }
    // A root without compatible Topics still needs complete chunk coverage.
    if (!scannedChunks) await scanChunks([]);
    return { ...shortlist.finish(), processed_chunks: root.expected_chunks,
      root_fingerprint: root.fingerprint, semantic_scope_available: root.semantic_scope_available };

    async function scanChunks(topics: SignalWorkspaceSearchTopicV1[]) {
      const accumulator = createSignalWorkspaceTopicSearchAccumulatorV1({ asset_sha256: root.asset_sha256,
        expected_chunks: root.expected_chunks, topics });
      let afterChunk: number | null = null;
      for (;;) {
        const page = await store.readChunks({ database, lease: activeLease, root_id: root.root_id,
          after_chunk_index: afterChunk, limit: boundedSize(options.chunk_page_size, 128), text_cache: textCache });
        if (page.root_id !== root.root_id || page.asset_sha256 !== root.asset_sha256
          || page.expected_chunks !== root.expected_chunks || page.after_chunk_index !== afterChunk) {
          throw new Error("workspace_topic_chunk_snapshot_mismatch");
        }
        if (page.items.length === 0 && !page.done) throw new Error("workspace_topic_chunk_page_stalled");
        if (page.items.length > 0) {
          accumulator.beginChunkPage(page.items);
          if (topics.length > 0) {
            let after: { term_key: string; input_digest: string } | null = null;
            for (;;) {
              const prototypes = await store.readPrototypes({ database, lease: activeLease,
                term_keys: topics.map(topic => topic.term_key), after, limit: 128 });
              if (prototypes.items.length === 0 && !prototypes.done) throw new Error("workspace_topic_prototype_page_stalled");
              if (prototypes.items.length > 0) {
                accumulator.addPrototypePage(prototypes.items);
                const last = prototypes.items[prototypes.items.length - 1]!;
                if (prototypes.next_cursor?.term_key !== last.term_key
                  || prototypes.next_cursor?.input_digest !== last.input_digest) {
                  throw new Error("workspace_topic_prototype_cursor_invalid");
                }
                after = prototypes.next_cursor;
              }
              if (prototypes.done) break;
            }
          }
          accumulator.finishChunkPage();
        }
        if (page.items.length > 0) {
          const last = page.items[page.items.length - 1]!.chunk_index;
          if (page.next_chunk_index !== last || afterChunk !== null && last <= afterChunk) {
            throw new Error("workspace_topic_chunk_cursor_invalid");
          }
          afterChunk = last;
        }
        if (page.done) break;
      }
      return accumulator.finish();
    }
  }
}

function boundedSize(value: number | undefined, maximum: number) {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error("workspace_topic_page_size_invalid");
  return value;
}

export function safeWorkspaceTopicErrorV1(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  const value = typeof code === "string" ? code : error instanceof Error ? error.message : "";
  return /^workspace_topic_[a-z_]{1,100}$/u.test(value) ? value : "workspace_topic_worker_failed";
}

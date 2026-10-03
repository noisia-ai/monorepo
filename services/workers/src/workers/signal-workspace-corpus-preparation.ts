import type { Job } from "bullmq";
import {
  claimSignalWorkspaceCorpusPreparationRunV1,
  snapshotSignalWorkspaceCorpusPreparationV1,
  readSignalWorkspaceCorpusPreparationPageV1,
  readSignalWorkspaceCorpusPreparationAssetsV1,
  commitSignalWorkspaceCorpusPreparationPageV1,
  finishSignalWorkspaceCorpusPreparationV1,
  failSignalWorkspaceCorpusPreparationV1,
  type SignalWorkspaceCorpusPreparationDatabaseV1,
  type SignalWorkspaceCorpusPreparationLeaseV1,
  type SignalCorpusTextChunksV1
} from "@noisia/db";

import { prepareWorkspaceCorpusTextChunksV1 } from "./signal-workspace-corpus-preparation-chunks";

export const SIGNAL_WORKSPACE_CORPUS_PREPARATION_JOB_NAME = "signal-workspace-corpus-preparation-v1";
export type SignalWorkspaceCorpusPreparationJobV1 = { run_id: string };

const stores = {
  claim: claimSignalWorkspaceCorpusPreparationRunV1,
  snapshot: snapshotSignalWorkspaceCorpusPreparationV1,
  readPage: readSignalWorkspaceCorpusPreparationPageV1,
  readAssets: readSignalWorkspaceCorpusPreparationAssetsV1,
  commitPage: commitSignalWorkspaceCorpusPreparationPageV1,
  finish: finishSignalWorkspaceCorpusPreparationV1,
  fail: failSignalWorkspaceCorpusPreparationV1
};
type Options = {
  database?: SignalWorkspaceCorpusPreparationDatabaseV1;
  stores?: typeof stores;
  page_size?: number;
};

/** Only prepares sealed workspace text. No provider, study corpus, classification,
 * population promotion, or serving work is dispatched from this handler. */
export async function signalWorkspaceCorpusPreparationJobV1(
  job: Pick<Job<SignalWorkspaceCorpusPreparationJobV1>, "id" | "data" | "updateProgress">,
  options: Options = {}
) {
  if (!job.id || typeof job.data?.run_id !== "string") {
    throw new Error("corpus_preparation_job_invalid");
  }
  const database = options.database ?? (await import("../db/client")).pool;
  const store = options.stores ?? stores;
  let lease: SignalWorkspaceCorpusPreparationLeaseV1 | null = await store.claim({
    database, run_id: job.data.run_id, worker_job_id: job.id
  });
  if (!lease) return { run_id: job.data.run_id, replayed: true };
  let pages = 0;
  try {
    if (lease.phase === "snapshotting") lease = await store.snapshot({ database, lease });
    for (;;) {
      const page = await store.readPage({ database, lease, limit: options.page_size });
      if (page.cursor !== lease.cursor) throw new Error("corpus_preparation_cursor_mismatch");
      if (page.items.length === 0) {
        if (!page.done) throw new Error("corpus_preparation_page_stalled");
        break;
      }
      const prepared = new Map<string, SignalCorpusTextChunksV1>();
      const pending = new Set(page.items.filter((item) => item.asset_sha256 && !item.asset_ready)
        .map((item) => item.asset_sha256!));
      // PostgreSQL bounds the page by bytes; an oversized asset is returned alone.
      // One transaction checks authority and reads this complete bounded asset set.
      const assets = pending.size > 0 ? await store.readAssets({ database, lease, page }) : [];
      for (const asset of assets) {
        if (!pending.has(asset.text_sha256)) {
          throw new Error("corpus_preparation_asset_hash_mismatch");
        }
        if (!asset.chunks) prepared.set(asset.text_sha256,
          prepareWorkspaceCorpusTextChunksV1(asset.text, asset.text_sha256));
      }
      const next = await store.commitPage({ database, lease, page,
        assets: Array.from(prepared, ([text_sha256, chunks]) => ({ text_sha256, chunks })) });
      if (next.cursor !== page.next_cursor || next.cursor === lease.cursor) {
        throw new Error("corpus_preparation_checkpoint_invalid");
      }
      lease = next;
      pages += 1;
      // Progress is advisory; a Redis failure cannot undo a durable page commit.
      await job.updateProgress({ phase: "chunking", pages_completed_this_attempt: pages }).catch(() => undefined);
      if (page.done) break;
    }
    const result = await store.finish({ database, lease });
    await job.updateProgress(100).catch(() => undefined);
    return { run_id: job.data.run_id, ...result };
  } catch (error) {
    await store.fail({ database, lease, error_code: safePreparationErrorV1(error) }).catch(() => undefined);
    throw error;
  }
}

export function safePreparationErrorV1(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (typeof code === "string" && /^corpus_preparation_[a-z_]{1,100}$/u.test(code)) return code;
  const message = error instanceof Error ? error.message : "";
  return /^corpus_preparation_[a-z_]{1,100}$/u.test(message)
    ? message : "corpus_preparation_worker_failed";
}

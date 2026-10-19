import type { Job } from "bullmq";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { TextDecoder } from "node:util";
import { z } from "zod";
import {
  claimSignalWorkspaceIncrementalProjectionV1, heartbeatSignalWorkspaceClassificationV1,
  readSignalWorkspaceClassificationPageV1, readSignalWorkspaceClassificationChunksPageV1,
  commitSignalWorkspaceClassificationPageV1, finishSignalWorkspaceClassificationV1,
  failSignalWorkspaceClassificationV1, type SignalWorkspaceEngineDatabaseV1,
} from "@noisia/db";
import { projectSignalWorkspaceIncrementalRootV1, signalWorkspaceEmbeddingDigestV1 as digest,
  type SignalWorkspaceClassificationDecisionV1, type SignalWorkspaceIncrementalUnitBindingV1,
} from "@noisia/query-engine";
import { createWorkspaceEngineStorageV1, type WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";
import { projectWorkspaceClassificationPagesV1, type WorkspaceProjectionPageStoresV1 } from "./signal-workspace-projection-pages";
import { loadWorkspaceIncrementalProjectionInputV1, workspaceIncrementalDerivationStoresV1,
  safeWorkspaceIncrementalProjectionErrorV1, type WorkspaceIncrementalDerivationStoresV1,
} from "./signal-workspace-incremental-derivation";
import type { WorkspaceIncrementalProjectionFileRootV1 } from "./signal-workspace-incremental-projection-files";

export const SIGNAL_WORKSPACE_INCREMENTAL_PROJECTION_JOB_NAME = "signal_workspace_incremental_projection_v1";
const stores = { claim: claimSignalWorkspaceIncrementalProjectionV1, heartbeat: heartbeatSignalWorkspaceClassificationV1,
  readPage: readSignalWorkspaceClassificationPageV1, readChunksPage: readSignalWorkspaceClassificationChunksPageV1,
  commitPage: commitSignalWorkspaceClassificationPageV1, finish: finishSignalWorkspaceClassificationV1,
  fail: failSignalWorkspaceClassificationV1 };
export type WorkspaceIncrementalProjectionOptionsV1 = { database?: SignalWorkspaceEngineDatabaseV1; stores?: typeof stores;
  source_stores?: Pick<WorkspaceIncrementalDerivationStoresV1, "topics" | "proposals">;
  storage?: WorkspaceEngineStorageV1; scratch_root?: string };
function invalid(suffix: string): never { throw new Error(`workspace_incremental_projection_${suffix}`); }

/** Projects the complete current corpus using original interpretations and
 * current Topics. The existing page writer preserves human corrections and
 * selection; numerical relations never create Topics or approve meaning. */
export async function signalWorkspaceIncrementalProjectionJobV1(
  job: Pick<Job<{ execution_id: string }>, "id" | "data" | "updateProgress">,
  options: WorkspaceIncrementalProjectionOptionsV1 = {},
) {
  if (!job.id || !z.string().uuid().safeParse(job.data?.execution_id).success) invalid("job_invalid");
  const database = options.database ?? (await import("../db/client")).pool, store = options.stores ?? stores;
  const claimed = await store.claim({ database, execution_id: job.data.execution_id, worker_job_id: job.id });
  if (!claimed) return { execution_id: job.data.execution_id, replayed: true };
  let lease = claimed.lease, directory: string | undefined;
  let pending: Promise<unknown> | null = null, failure: unknown;
  const heartbeat = async () => {
    if (failure) throw failure;
    pending ??= store.heartbeat({ database, lease }).catch(error => { failure = error; throw error; }).finally(() => { pending = null; });
    await pending;
  };
  const timer = setInterval(() => { void heartbeat().catch(() => undefined); }, 15000); timer.unref();
  let rows: AsyncIterator<WorkspaceIncrementalProjectionFileRootV1> | undefined;
  let pageProjectionStarted = false;
  try {
    const { source, derivation } = claimed;
    if (lease.execution_id !== job.data.execution_id || source.engine_execution_id !== derivation.execution_id
      || source.workspace_id !== lease.workspace_id || source.numeric_checkpoint_digest !== derivation.numeric_checkpoint.checkpoint_digest
      || digest(lease.identity) !== digest(derivation.identity)) invalid("source_invalid");
    const storage = options.storage ?? createWorkspaceEngineStorageV1();
    const root = resolve(options.scratch_root ?? join(tmpdir(), "noisia-workspace-projection"));
    await mkdir(root, { recursive: true, mode: 0o700 }); const storageRoot = await realpath(root);
    directory = await mkdtemp(join(storageRoot, "project-"));
    const loaded = await loadWorkspaceIncrementalProjectionInputV1({ database, derivation, directory, storage_root: storageRoot,
      storage, stores: options.source_stores ?? workspaceIncrementalDerivationStoresV1, heartbeat });
    const { files, bindings } = loaded;
    if (source.binding_digest !== bindings.binding_digest || source.editorial_cut_digest !== bindings.editorial_cut_digest
      || digest(source.interpretation_coverage) !== digest(bindings.interpretation_coverage)
      || source.discovery_coverage.state !== files.manifest.discovery_status || source.discovery_coverage.pending_roots !== files.census.pending_roots)
      invalid("binding_coverage_invalid");
    const binding = claimed.artifacts.find(ref => ref.artifact_id === source.binding_artifact_id);
    if (!binding || binding.owner_execution_id !== source.engine_execution_id) invalid("binding_artifact_missing");
    const bindingPath = join(directory, "sealed-bindings.jsonl");
    await storage.get({ workspace_id: lease.workspace_id, execution_id: source.engine_execution_id,
      stored: binding, destination: bindingPath });
    await verifyBindings(bindingPath, bindings.bindings); await heartbeat();
    rows = files.roots()[Symbol.asyncIterator](); let next = await rows.next();
    const skip = async (rootId: string, inclusive = false) => {
      while (!next.done && (next.value.root.root_id < rootId || inclusive && next.value.root.root_id === rootId)) next = await rows!.next();
    };
    let corrections = new Map<string, SignalWorkspaceClassificationDecisionV1[]>();
    const pageStores: WorkspaceProjectionPageStoresV1<SignalWorkspaceEngineDatabaseV1> = { ...store,
      readPage: async args => {
        const page = await store.readPage(args);
        corrections = new Map(page.items.map(item => [item.root.root_id, item.corrections])); return page;
      },
      commitPage: async args => { lease = await store.commitPage(args); return lease; },
      finish: async args => {
        if (args.lease.cursor_root_id) await skip(args.lease.cursor_root_id, true);
        if (!next.done) invalid("population_incomplete");
        return store.finish(args);
      },
    };
    // Page readers and commits renew the lease and cursor atomically. A timer
    // using a preceding cursor must not race those commits.
    clearInterval(timer); await pending;
    pageProjectionStarted = true;
    return await projectWorkspaceClassificationPagesV1({ job, database, lease, stores: pageStores, engine: {
      ...lease.identity,
      classifyRoot: async ({ identity, root: current, chunks }) => {
        await skip(current.root_id);
        if (next.done || next.value.root.root_id !== current.root_id) invalid("population_changed");
        const packet = next.value;
        if (packet.root.root_fingerprint !== current.fingerprint || packet.root.correction_digest !== current.correction_digest
          || packet.root.asset_sha256 !== current.asset_sha256 || packet.root.expected_chunks !== current.expected_chunks
          || packet.root.chunk_coverage_digest !== current.chunk_coverage_digest) invalid("population_changed");
        let chunkCount = 0;
        for await (const page of chunks) for (const chunk of page) {
          const expected = packet.chunks[chunkCount++];
          if (!expected || digest(expected) !== digest({ chunk_index: chunk.chunk_index, start: chunk.start,
            end: chunk.end, chunk_sha256: chunk.chunk_sha256 })) invalid("chunk_changed");
        }
        if (chunkCount !== packet.chunks.length) invalid("chunk_coverage_incomplete");
        const outcome = projectSignalWorkspaceIncrementalRootV1({ source, identity, root: packet.root,
          chunks: packet.chunks, memberships: packet.memberships, bindings,
          corrections: (corrections.get(current.root_id) ?? []).map(decision => ({ decision, context_digest: identity.context_digest,
            root: { root_id: current.root_id, fingerprint: current.fingerprint, correction_digest: current.correction_digest } })) });
        next = await rows!.next(); return outcome;
      },
    } });
  } catch (error) {
    const code = safeWorkspaceIncrementalProjectionErrorV1(error);
    if (!pageProjectionStarted) await store.fail({ database, lease, error_code: code }).catch(() => undefined);
    throw new Error(code);
  } finally {
    clearInterval(timer); await Promise.resolve(pending).catch(() => undefined); await rows?.return?.().catch(() => undefined);
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function verifyBindings(path: string, expected: readonly SignalWorkspaceIncrementalUnitBindingV1[]) {
  let buffer = Buffer.alloc(0), index = 0;
  for await (const raw of createReadStream(path, { highWaterMark: 64 * 1024 })) {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(raw) ? raw : Buffer.from(raw)]);
    for (;;) {
      const end = buffer.indexOf(10); if (end < 0) break;
      if (!end || end > 8 * 1024 * 1024 || index >= expected.length) invalid("binding_file_invalid");
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, end)));
      if (digest(value) !== digest(expected[index++])) invalid("binding_file_invalid");
      buffer = buffer.subarray(end + 1);
    }
    if (buffer.length > 8 * 1024 * 1024) invalid("binding_file_capacity_exceeded");
  }
  if (buffer.length || index !== expected.length) invalid("binding_file_incomplete");
}

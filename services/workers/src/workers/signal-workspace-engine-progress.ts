import type { Job } from "bullmq";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  readSignalWorkspaceEngineMaterializationSourceV1,
  readSignalWorkspaceEngineMaterializationCheckpointsV1,
  materializeSignalWorkspaceEngineTopicsProgressV1,
  persistSignalWorkspaceEngineTopicsProgressV1,
  completeSignalWorkspaceEngineProgressDispatchV1,
  heartbeatSignalWorkspaceEngineProgressDispatchV1,
  failSignalWorkspaceEngineProgressDispatchV1,
  type SignalWorkspaceEngineProgressScopeV1,
  type SignalWorkspaceEngineDatabaseV1,
} from "@noisia/db";
import { createWorkspaceEngineStorageV1, type WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";

const stores = {
  source: readSignalWorkspaceEngineMaterializationSourceV1,
  checkpoints: readSignalWorkspaceEngineMaterializationCheckpointsV1,
  materialize: materializeSignalWorkspaceEngineTopicsProgressV1,
  persist: persistSignalWorkspaceEngineTopicsProgressV1,
  complete: completeSignalWorkspaceEngineProgressDispatchV1,
  heartbeat: heartbeatSignalWorkspaceEngineProgressDispatchV1,
  fail: failSignalWorkspaceEngineProgressDispatchV1,
};
type Options = { database?: SignalWorkspaceEngineDatabaseV1; stores?: typeof stores;
  storage?: WorkspaceEngineStorageV1; storage_root?: string };
const digest = (bytes: Uint8Array | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const safeError = (error: unknown) => error instanceof Error && /^workspace_engine_[a-z_]{1,100}$/u.test(error.message)
  ? error.message : "workspace_engine_progress_failed";

/** Derive editable Topics from existing, settled checkpoints. This job never
 * claims the engine, starts numerical work, or imports a provider transport. */
export async function signalWorkspaceEngineProgressJobV1(
  job: Pick<Job<SignalWorkspaceEngineProgressScopeV1>, "id" | "data" | "updateProgress">,
  options: Options = {},
) {
  if (!job.id || !job.data || [job.data.execution_id, job.data.workspace_id, job.data.actor_user_id]
    .some(value => typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)))
    throw new Error("workspace_engine_progress_job_invalid");
  const database = options.database ?? (await import("../db/client")).pool;
  const store = options.stores ?? stores, scope = { database, ...job.data };
  let directory: string | null = null;
  let heartbeatError: unknown, heartbeatPending: Promise<unknown> | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  const checkHeartbeat = () => { if (heartbeatError) throw heartbeatError; };
  const heartbeat = async () => {
    checkHeartbeat();
    if (heartbeatPending) return heartbeatPending;
    heartbeatPending = store.heartbeat({ ...scope, worker_job_id: job.id! });
    try { return await heartbeatPending; } catch (error) { heartbeatError = error; throw error; }
    finally { heartbeatPending = null; }
  };
  try {
    const source = await store.source(scope);
    if (!source.needs_materialization) {
      await store.complete({ ...scope, worker_job_id: job.id });
      return { execution_id: scope.execution_id, replayed: true };
    }
    await heartbeat();
    timer = setInterval(() => { void heartbeat().catch(() => undefined); }, 30_000);
    timer.unref();
    const storage = options.storage ?? createWorkspaceEngineStorageV1();
    const root = resolve(options.storage_root ?? process.env.NOISIA_WORKSPACE_ENGINE_SCRATCH_ROOT ?? join(tmpdir(), "noisia-workspace-engine"));
    await mkdir(root, { recursive: true, mode: 0o700 });
    directory = await mkdtemp(join(root, `progress-${scope.execution_id}-`));
    const scratch = directory;
    // Spool before entering the catalog transaction. Its iterable must never
    // open a second DB connection while the catalog/engine locks are held.
    const checkpoints: Array<{ artifact_id: string; destination: string }> = [];
    let after: string | null = null;
    for (;;) {
      checkHeartbeat();
      const page = await store.checkpoints({ ...scope, expected_coverage: source.coverage, after_artifact_id: after, limit: 32 });
      if (page.items.length > 32 || !page.done && !page.items.length)
        throw new Error("workspace_engine_interpretation_checkpoint_invalid");
      for (const checkpoint of page.items) {
        checkHeartbeat();
        if (after !== null && checkpoint.artifact_id <= after || !Number.isSafeInteger(checkpoint.size_bytes)
          || checkpoint.size_bytes <= 0 || checkpoint.size_bytes > 2 * 1024 * 1024 || checkpoint.media_type !== "application/json")
          throw new Error("workspace_engine_interpretation_checkpoint_invalid");
        after = checkpoint.artifact_id;
        if (checkpoints.length >= source.coverage.unit_count) throw new Error("workspace_engine_interpretation_checkpoint_invalid");
        const destination = join(scratch, `checkpoint-${checkpoints.length + 1}.json`);
        await storage.get({ workspace_id: scope.workspace_id, execution_id: scope.execution_id, stored: checkpoint, destination });
        if ((await stat(destination)).size !== checkpoint.size_bytes) throw new Error("workspace_engine_interpretation_checkpoint_invalid");
        const bytes = await readFile(destination);
        if (digest(bytes) !== checkpoint.sha256) throw new Error("workspace_engine_interpretation_checkpoint_invalid");
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        checkpoints.push({ artifact_id: checkpoint.artifact_id, destination });
      }
      if (page.next_artifact_id !== after) throw new Error("workspace_engine_interpretation_checkpoint_invalid");
      if (page.done) break;
    }
    checkHeartbeat();
    const materialized = await store.materialize({ ...scope, expected_coverage: source.coverage,
      expected_catalog_profile_id: source.catalog_profile_id,
      proposals: (async function* () {
        for (const checkpoint of checkpoints) yield { artifact_id: checkpoint.artifact_id,
          body: new TextDecoder("utf-8", { fatal: true }).decode(await readFile(checkpoint.destination)) };
      })() });
    checkHeartbeat();
    const { mapping, replayed: _replayed, ...metadata } = materialized;
    const body = JSON.stringify({ ...metadata, mapping }), sha256 = digest(body);
    const filename = `materialization-progress-${metadata.output_catalog_profile_id}.json`, file = join(scratch, filename);
    await writeFile(file, body, { flag: "wx", mode: 0o600 });
    const stored = await storage.put({ workspace_id: scope.workspace_id, execution_id: scope.execution_id,
      file, sha256, size_bytes: Buffer.byteLength(body), media_type: "application/json" });
    checkHeartbeat();
    const persisted = await store.persist({ ...scope, expected_coverage: source.coverage,
      artifact: { ...stored, artifact_key: filename, artifact_type: "engine_proposals", title: "Available editable topics", metadata } });
    clearInterval(timer); await heartbeatPending; checkHeartbeat();
    await store.complete({ ...scope, worker_job_id: job.id });
    await job.updateProgress({ interpreted_units: metadata.interpreted_unit_count,
      expected_units: metadata.expected_interpretation_unit_count, topics: metadata.topic_count }).catch(() => undefined);
    return persisted;
  } catch (error) {
    clearInterval(timer); await Promise.resolve(heartbeatPending).catch(() => undefined);
    const code = safeError(error);
    await store.fail({ ...scope, worker_job_id: job.id, error_code: code }).catch(() => undefined);
    throw new Error(code);
  } finally {
    clearInterval(timer);
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

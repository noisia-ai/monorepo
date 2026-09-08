import type { Job } from "bullmq";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  claimSignalWorkspaceEngineV1, readSignalWorkspaceEngineChunksV1, readSignalWorkspaceEngineGuidesV1,
  readSignalWorkspaceEngineParentArtifactsV1, heartbeatSignalWorkspaceEngineV1,
  readSignalWorkspaceEngineCheckpointV1,
  persistSignalWorkspaceEngineArtifactV1, finishSignalWorkspaceEngineFitV1, failSignalWorkspaceEngineV1,
  type SignalWorkspaceEngineDatabaseV1, type SignalWorkspaceEngineCursorV1, type SignalWorkspaceEngineGuideCursorV1,
  type SignalWorkspaceEngineLeaseV1
} from "@noisia/db";
import { type SignalWorkspaceEngineChunkV1 as WireChunk, type SignalWorkspaceEngineGuideV1 as WireGuide } from "@noisia/query-engine";
import { hashWorkspaceEngineFileV1, spoolSignalWorkspaceEngineInputV1 } from "./signal-workspace-engine-files";
import { runWorkspaceEngineProcessV1, validateWorkspaceEngineOutputV1 } from "./signal-workspace-engine-process";
import { readWorkspaceEngineInterpretationEvidenceV1 } from "./signal-workspace-engine-evidence";
import { interpretWorkspaceEngineV1 } from "./signal-workspace-engine-interpret";
import { createWorkspaceEngineStorageV1, type WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";

const stores = { claim: claimSignalWorkspaceEngineV1, chunks: readSignalWorkspaceEngineChunksV1,
  guides: readSignalWorkspaceEngineGuidesV1, parent: readSignalWorkspaceEngineParentArtifactsV1,
  checkpoint: readSignalWorkspaceEngineCheckpointV1,
  heartbeat: heartbeatSignalWorkspaceEngineV1, persist: persistSignalWorkspaceEngineArtifactV1,
  finish: finishSignalWorkspaceEngineFitV1, fail: failSignalWorkspaceEngineV1 };
type Options = { database?: SignalWorkspaceEngineDatabaseV1; stores?: typeof stores; storage?: WorkspaceEngineStorageV1;
  python?: string; module_root?: string; storage_root?: string; timeout_ms?: number;
  process?: typeof runWorkspaceEngineProcessV1; interpret?: typeof interpretWorkspaceEngineV1 };
const name = /^[a-z][a-z0-9_.-]{0,100}$/u;
const safe = (error: unknown) => error instanceof Error && /^workspace_engine_[a-z_]{1,100}$/u.test(error.message)
  ? error.message : "workspace_engine_worker_failed";

/** One existing outbox job consumes a complete current manifest and persists
 * immutable fitted artifacts. Interpretation and approval remain separate facts. */
export async function signalWorkspaceEngineJobV1(job: Pick<Job<{ execution_id: string }>, "id" | "data" | "updateProgress">,
  options: Options = {}) {
  if (!job.id || typeof job.data?.execution_id !== "string") throw new Error("workspace_engine_job_invalid");
  const database = options.database ?? (await import("../db/client")).pool, store = options.stores ?? stores;
  const lease = await store.claim({ database, execution_id: job.data.execution_id, worker_job_id: job.id });
  if (!lease) return { execution_id: job.data.execution_id, replayed: true };
  let heartbeatPromise: Promise<void> | null = null, heartbeatError: unknown = null;
  let attemptDirectory: string | null = null;
  let phase: "exporting" | "fitting" | "persisting" | "interpreting" | "materializing" = "exporting";
  const heartbeat = async () => {
    if (heartbeatError) throw heartbeatError;
    if (!heartbeatPromise) heartbeatPromise = store.heartbeat({ database, lease, phase })
      .catch(error => { heartbeatError = error; throw error; }).finally(() => { heartbeatPromise = null; });
    await heartbeatPromise;
  };
  const timer = setInterval(() => { void heartbeat().catch(() => undefined); }, 15000); timer.unref();
  try {
    const storage = options.storage ?? createWorkspaceEngineStorageV1();
    const root = resolve(options.storage_root ?? process.env.NOISIA_WORKSPACE_ENGINE_SCRATCH_ROOT ?? join(tmpdir(), "noisia-workspace-engine"));
    await mkdir(root, { recursive: true, mode: 0o700 });
    const storageRoot = await realpath(root), attempt = await mkdtemp(join(storageRoot, `${lease.execution_id}-`));
    attemptDirectory = attempt;
    const inputDir = join(attempt, "input"), outputDir = join(attempt, "output"), s = lease.snapshot;
    const input = await spoolSignalWorkspaceEngineInputV1({ storage_root: storageRoot, directory: inputDir,
      snapshot: { workspace_id: s.workspace_id, input_revision: Number(s.input_revision), preparation_run_id: s.preparation_run_id,
        embedding_run_id: s.embedding_run_id, embedding_config_digest: s.embedding_profile.config_digest,
        context_digest: s.context_digest, catalog_digest: s.catalog_digest, chunk_policy_version: "corpus-text-chunks-v1",
        roots: s.expected_roots, chunks: s.expected_chunks, guides: s.expected_guides, dimensions: 1024, config: s.engine_config },
      chunks: allChunks(lease), guides: allGuides(lease), onProgress: async counts => {
        if (heartbeatError) throw heartbeatError;
        await job.updateProgress({ phase, processed_chunks: counts.chunks, processed_roots: counts.roots }).catch(() => undefined);
      } });
    const inputHash = await hashWorkspaceEngineFileV1(join(inputDir, "manifest.json"));
    await store.heartbeat({ database, lease, phase: "fitting", exported: {
      roots: input.records.roots, chunks: input.records.rows, guides: input.guides.rows, stream_digest: inputHash } });
    phase = "fitting";
    const checkpoint = await store.checkpoint({ database, lease });
    let previous: { directory: string; manifest_sha256: string } | null = null;
    let previousHash: string | undefined;
    let restoredBundle: Array<{ name: string; storage_key: string; sha256: string; size_bytes: number; media_type: string }> | null = null;
    if (checkpoint) {
      restoredBundle = await downloadCheckpoint(storage, outputDir, lease, checkpoint);
      const saved = JSON.parse(await readFile(join(outputDir, "manifest.json"), "utf8")) as { previous_manifest_sha256: string | null };
      previousHash = saved.previous_manifest_sha256 ?? undefined;
    } else {
      previous = await downloadParent(storage, attempt, lease); previousHash = previous?.manifest_sha256;
      await (options.process ?? runWorkspaceEngineProcessV1)({
      python: options.python ?? process.env.NOISIA_WORKSPACE_ENGINE_PYTHON ?? "/opt/noisia-engine/bin/python",
      module_root: options.module_root ?? process.env.NOISIA_WORKSPACE_ENGINE_MODULE_ROOT ?? "/app/tools/signal-semantic-lab/src",
      storage_root: storageRoot, input_directory: inputDir, output_directory: outputDir,
        ...(previous ? { previous } : {}), timeout_ms: options.timeout_ms, heartbeat });
    }
    const output = await validateWorkspaceEngineOutputV1({ directory: outputDir, storage_root: storageRoot, input,
      input_manifest_sha256: inputHash, previous_manifest_sha256: previousHash });
    phase = "persisting"; await heartbeat();
    const files = [{ file: "manifest.json", sha256: await hashWorkspaceEngineFileV1(join(outputDir, "manifest.json")),
      bytes: Buffer.byteLength(await readFile(join(outputDir, "manifest.json"))) }, ...output.artifacts];
    if (output.status === "completed" && !restoredBundle) {
      const modelBundle = JSON.stringify({ contract_version: "workspace-model-bundle-v1", config: output.config,
        versions: output.versions, input_identity: output.input_identity, output_manifest_sha256: files[0]!.sha256,
        models: output.artifacts.filter(file => file.file.endsWith(".joblib")) });
      await writeFile(join(outputDir, "model-manifest.json"), modelBundle, { flag: "wx", mode: 0o600 });
      files.push({ file: "model-manifest.json", sha256: await hashWorkspaceEngineFileV1(join(outputDir, "model-manifest.json")),
        bytes: Buffer.byteLength(modelBundle) });
    }
    const bundle: Array<{ name: string; storage_key: string; sha256: string; size_bytes: number; media_type: string }> = restoredBundle ?? [];
    for (const file of restoredBundle ? [] : files) {
      const stored = await storage.put({ workspace_id: lease.workspace_id, execution_id: lease.execution_id,
        file: join(outputDir, file.file), sha256: file.sha256, size_bytes: file.bytes,
        media_type: file.file.endsWith(".json") ? "application/json" : file.file.endsWith(".jsonl") ? "application/x-ndjson" : "application/octet-stream" });
      bundle.push({ name: file.file, ...stored }); if (heartbeatError) throw heartbeatError;
    }
    let outputId: string | null = null, modelId: string | null = null;
    for (const file of bundle) {
      const isModel = file.name.endsWith(".joblib") || file.name === "model-manifest.json";
      const artifact = await store.persist({ database, lease, artifact: { artifact_key: file.name,
        artifact_type: isModel ? "engine_model" : "engine_output",
        title: file.name, storage_key: file.storage_key, sha256: file.sha256, size_bytes: file.size_bytes, media_type: file.media_type,
        metadata: { filename: file.name, ...(file.name === "manifest.json" ? { bundle } : {}),
          quality: "uncalibrated", semantic_approval: "none" } } });
      if (file.name === "manifest.json") outputId = artifact.artifact_id;
      if (file.name === "model-manifest.json") modelId = artifact.artifact_id;
    }
    if (!outputId || (output.status === "completed" && !modelId)) throw new Error("workspace_engine_artifacts_incomplete");
    await heartbeat();
    const fit = { model_artifact_id: modelId, output_artifact_id: outputId,
      coverage: { roots: input.records.roots, chunks: input.records.rows, guides: input.guides.rows },
      result_kind: output.status === "completed" ? "computational_grouping" as const : "insufficient_population" as const,
      model_configuration: { ...output.config, versions: output.versions, input_identity: output.input_identity },
      runtime_kind: "python", artifact_format: "workspace-model-bundle-v1", license_key: null };
    const finished = lease.snapshot.interpretation_config
      ? await (options.interpret ?? interpretWorkspaceEngineV1)({ database, lease, fit,
        clusters: await readWorkspaceEngineInterpretationEvidenceV1({ input_directory: inputDir, output_directory: outputDir, output }),
        directory: attempt, storage, heartbeat: async next => { phase = next; await heartbeat(); } })
      : await store.finish({ database, lease, ...fit });
    await job.updateProgress(100).catch(() => undefined); return finished;
  } catch (error) { const code = safe(error);
    await store.fail({ database, lease, error_code: code }).catch(() => undefined); throw new Error(code);
  } finally {
    clearInterval(timer); await Promise.resolve(heartbeatPromise).catch(() => undefined);
    // This invocation alone created the private scratch directory. Durable
    // artifacts live in object storage; retaining full matrices here fills disk.
    if (attemptDirectory) await rm(attemptDirectory, { recursive: true, force: true }).catch(() => undefined);
  }

  async function* allChunks(active: SignalWorkspaceEngineLeaseV1): AsyncGenerator<WireChunk[]> {
    let after: SignalWorkspaceEngineCursorV1 | null = null;
    for (;;) { const page = await store.chunks({ database, lease: active, after, limit: 128 });
      if (!page.done && (!page.items.length || JSON.stringify(page.next_cursor) === JSON.stringify(after))) throw new Error("workspace_engine_page_stalled");
      yield page.items.map(row => ({ ...row, expected_chunks: row.expected_root_chunks }));
      if (page.done) return; after = page.next_cursor;
    }
  }
  async function* allGuides(active: SignalWorkspaceEngineLeaseV1): AsyncGenerator<WireGuide[]> {
    let after: SignalWorkspaceEngineGuideCursorV1 | null = null;
    for (;;) { const page = await store.guides({ database, lease: active, after, limit: 128 });
      if (!page.done && (!page.items.length || JSON.stringify(page.next_cursor) === JSON.stringify(after))) throw new Error("workspace_engine_page_stalled");
      yield page.items; if (page.done) return; after = page.next_cursor;
    }
  }
  async function downloadParent(storage: WorkspaceEngineStorageV1, attempt: string, active: SignalWorkspaceEngineLeaseV1) {
    const page = await store.parent({ database, lease: active, limit: 128 });
    if (!page.available) return null;
    if (!page.done || !active.snapshot.parent_execution_id) throw new Error("workspace_engine_parent_invalid");
    const directory = join(attempt, "previous"); await mkdir(directory, { mode: 0o700 });
    let manifestHash: string | null = null;
    for (const item of page.items) {
      const filename = item.metadata.filename;
      if (typeof filename !== "string" || !name.test(filename) || filename.includes("..")) throw new Error("workspace_engine_parent_invalid");
      const ref = item.content as { storage_key: string; sha256: string; size_bytes: number; media_type: string };
      await storage.get({ workspace_id: active.workspace_id, execution_id: active.snapshot.parent_execution_id,
        stored: ref, destination: join(directory, filename) });
      if (filename === "manifest.json") manifestHash = ref.sha256;
    }
    if (!manifestHash) throw new Error("workspace_engine_parent_invalid");
    return { directory, manifest_sha256: manifestHash };
  }
  async function downloadCheckpoint(storage: WorkspaceEngineStorageV1, directory: string, active: SignalWorkspaceEngineLeaseV1,
    checkpoint: NonNullable<Awaited<ReturnType<typeof readSignalWorkspaceEngineCheckpointV1>>>) {
    const bundle = checkpoint.metadata.bundle;
    if (!Array.isArray(bundle) || !bundle.length || bundle.length > 34) throw new Error("workspace_engine_checkpoint_invalid");
    await mkdir(directory, { mode: 0o700 }); const seen = new Set<string>();
    for (const item of bundle) {
      if (!item || typeof item !== "object" || typeof item.name !== "string" || !name.test(item.name)
        || item.name.includes("..") || seen.has(item.name)) throw new Error("workspace_engine_checkpoint_invalid");
      seen.add(item.name);
      if (item.name === "manifest.json" && (item.sha256 !== checkpoint.content.sha256
        || item.storage_key !== checkpoint.content.storage_key || item.size_bytes !== checkpoint.content.size_bytes)) throw new Error("workspace_engine_checkpoint_invalid");
      await storage.get({ workspace_id: active.workspace_id, execution_id: active.execution_id, stored: item,
        destination: join(directory, item.name) });
    }
    if (!seen.has("manifest.json")) throw new Error("workspace_engine_checkpoint_invalid");
    return bundle as Array<{ name: string; storage_key: string; sha256: string; size_bytes: number; media_type: string }>;
  }
}

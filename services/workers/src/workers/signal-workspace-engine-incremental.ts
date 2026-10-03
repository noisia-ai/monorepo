import type { Job } from "bullmq";
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  heartbeatSignalWorkspaceEngineV1, failSignalWorkspaceEngineV1, persistSignalWorkspaceEngineArtifactV1,
  readSignalWorkspaceEngineChunksV1, readSignalWorkspaceEngineGuidesV1,
  readSignalWorkspaceIncrementalRootsV1, readSignalWorkspaceIncrementalParentArtifactsV1,
  readSignalWorkspaceIncrementalCheckpointV1, persistSignalWorkspaceIncrementalInputV1,
  persistSignalWorkspaceIncrementalOutputIndexV1, registerSignalWorkspaceIncrementalModelBankV1,
  registerSignalWorkspaceIncrementalComponentsV1, readSignalWorkspaceIncrementalEditorialHistoryV1,
  persistSignalWorkspaceIncrementalHistoryV1, checkpointSignalWorkspaceIncrementalOutputV1,
  finishSignalWorkspaceIncrementalNumericV1,
  type SignalWorkspaceEngineDatabaseV1, type SignalWorkspaceEngineLeaseV1,
  type SignalWorkspaceEngineArtifactV1,
} from "@noisia/db";
import { parseSignalWorkspaceIncrementalInputV1, signalWorkspaceIncrementalDigestV1 as digest,
  type SignalWorkspaceEngineChunkV1, type SignalWorkspaceEngineGuideV1,
} from "@noisia/query-engine";
import { hashWorkspaceEngineFileV1, spoolSignalWorkspaceEngineInputV1 } from "./signal-workspace-engine-files";
import { runWorkspaceEngineProcessV1 } from "./signal-workspace-engine-process";
import { prepareSignalWorkspaceIncrementalInputFilesV1, validateSignalWorkspaceIncrementalOutputFilesV1,
  type WorkspaceIncrementalFileRefV1, type WorkspaceIncrementalParentFilesV1,
} from "./signal-workspace-engine-incremental-files";
import { createWorkspaceEngineStorageV1, type WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";

const stores = {
  heartbeat: heartbeatSignalWorkspaceEngineV1, fail: failSignalWorkspaceEngineV1, persist: persistSignalWorkspaceEngineArtifactV1,
  chunks: readSignalWorkspaceEngineChunksV1, guides: readSignalWorkspaceEngineGuidesV1,
  roots: readSignalWorkspaceIncrementalRootsV1, parent: readSignalWorkspaceIncrementalParentArtifactsV1,
  checkpoint: readSignalWorkspaceIncrementalCheckpointV1, input: persistSignalWorkspaceIncrementalInputV1,
  index: persistSignalWorkspaceIncrementalOutputIndexV1, bank: registerSignalWorkspaceIncrementalModelBankV1,
  components: registerSignalWorkspaceIncrementalComponentsV1, history: readSignalWorkspaceIncrementalEditorialHistoryV1,
  persistHistory: persistSignalWorkspaceIncrementalHistoryV1, checkpointOutput: checkpointSignalWorkspaceIncrementalOutputV1,
  finish: finishSignalWorkspaceIncrementalNumericV1,
};
export type WorkspaceIncrementalJobOptionsV1 = {
  stores?: typeof stores; storage?: WorkspaceEngineStorageV1; python?: string; module_root?: string;
  storage_root?: string; timeout_ms?: number; process?: typeof runWorkspaceEngineProcessV1;
};
const hash = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const fileName = z.string().regex(/^[a-z][a-z0-9_.-]{0,100}$/u).refine(value => !value.includes(".."));
const stored = z.object({ name: fileName, storage_key: z.string().min(1).max(1024), sha256: hash,
  size_bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), media_type: z.string().min(1).max(120) }).strict();
type Stored = z.infer<typeof stored>;
const inputNames = ["manifest.json", "chunks.jsonl", "vectors.npy", "guides.jsonl", "guide-vectors.npy", "current-roots.jsonl"];
const maxMetadata = 8 * 1024 * 1024;
function fail(code: string): never { throw new Error(`workspace_engine_incremental_${code}`); }
export function safeWorkspaceIncrementalErrorV1(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (typeof code === "string" && ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE", "ENOTFOUND",
    "57P01", "57P02", "57P03", "08000", "08003", "08006", "40001", "40P01"].includes(code))
    return "workspace_engine_incremental_transport_unavailable";
  return error instanceof Error && /^workspace_engine_[a-z_]{1,100}$/u.test(error.message)
    ? error.message : "workspace_engine_worker_failed";
}
const mediaType = (file: string) => file.endsWith(".json") ? "application/json"
  : file.endsWith(".jsonl") ? "application/x-ndjson" : "application/octet-stream";
async function readJson(path: string): Promise<unknown> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxMetadata) fail("checkpoint_capacity_exceeded");
  return JSON.parse(await readFile(path, "utf8"));
}

/** The existing engine job has already claimed its lease. This branch never
 * calls interpretation, creates Topics, or silently falls back to a full fit. */
export async function runSignalWorkspaceIncrementalJobV1(args: {
  job: Pick<Job<{ execution_id: string }>, "id" | "data" | "updateProgress">;
  database: SignalWorkspaceEngineDatabaseV1; lease: SignalWorkspaceEngineLeaseV1;
}, options: WorkspaceIncrementalJobOptionsV1 = {}) {
  const { database, lease, job } = args, store = options.stores ?? stores;
  const descriptor = lease.snapshot.numeric_descriptor;
  if (!descriptor || descriptor.parent.execution_id !== lease.snapshot.parent_execution_id
    || lease.snapshot.interpretation_config) return fail("descriptor_required");
  let storage: WorkspaceEngineStorageV1;
  let phase: "exporting" | "fitting" | "persisting" = "exporting";
  let pending: Promise<void> | null = null, heartbeatError: unknown, attempt: string | null = null;
  const heartbeat = async () => {
    if (heartbeatError) throw heartbeatError;
    pending ??= store.heartbeat({ database, lease, phase }).catch(error => { heartbeatError = error; throw error; })
      .finally(() => { pending = null; });
    await pending;
  };
  const timer = setInterval(() => { void heartbeat().catch(() => undefined); }, 15000); timer.unref();
  try {
    const checkpoint = await store.checkpoint({ database, lease });
    if (checkpoint.numeric_checkpoint) {
      return await store.finish({ database, lease, checkpoint_digest: checkpoint.numeric_checkpoint.checkpoint_digest });
    }
    storage = options.storage ?? createWorkspaceEngineStorageV1();
    const root = resolve(options.storage_root ?? process.env.NOISIA_WORKSPACE_ENGINE_SCRATCH_ROOT ?? join(tmpdir(), "noisia-workspace-engine"));
    await mkdir(root, { recursive: true, mode: 0o700 }); const storageRoot = await realpath(root);
    attempt = await mkdtemp(join(storageRoot, `${lease.execution_id}-`));
    const inputDir = join(attempt, "input"), outputDir = join(attempt, "output"), parentDir = join(attempt, "previous");
    await mkdir(parentDir, { mode: 0o700 });
    const parentFiles: WorkspaceIncrementalFileRefV1[] = [];
    let parentCursor: string | undefined;
    for (;;) {
      const page = await store.parent({ database, lease, after_artifact_key: parentCursor, limit: 128 });
      if (page.items.length > 128 || !page.done && (!page.items.length || page.next_cursor === parentCursor)) fail("parent_page_stalled");
      for (const item of page.items) {
        const name = fileName.parse(item.artifact_key);
        if (item.owner_execution_id !== descriptor.parent.execution_id || parentFiles.some(ref => ref.file === name)) fail("parent_invalid");
        await storage.get({ workspace_id: lease.workspace_id, execution_id: descriptor.parent.execution_id,
          stored: item, destination: join(parentDir, name) });
        parentFiles.push({ file: name, sha256: item.sha256, bytes: item.size_bytes });
        if (Buffer.byteLength(JSON.stringify(parentFiles)) > maxMetadata) fail("parent_capacity_exceeded");
      }
      await heartbeat(); if (page.done) break; parentCursor = page.next_cursor ?? undefined;
    }
    const parent = (): WorkspaceIncrementalParentFilesV1 => ({ directory: parentDir, files: pages(parentFiles) });
    let inputArtifactId: string, inputRef: WorkspaceIncrementalFileRefV1;
    if (checkpoint.input_artifact) {
      await mkdir(inputDir, { mode: 0o700 });
      const refs = stored.array().length(6).parse(checkpoint.input_artifact.metadata.input_files);
      if (new Set(refs.map(ref => ref.name)).size !== 6 || refs.some(ref => !inputNames.includes(ref.name))) fail("input_checkpoint_invalid");
      for (const ref of refs) await storage.get({ workspace_id: lease.workspace_id, execution_id: lease.execution_id,
        stored: ref, destination: join(inputDir, ref.name) });
      await storage.get({ workspace_id: lease.workspace_id, execution_id: lease.execution_id,
        stored: checkpoint.input_artifact, destination: join(inputDir, "incremental.json") });
      inputRef = { file: "incremental.json", sha256: checkpoint.input_artifact.sha256, bytes: checkpoint.input_artifact.size_bytes };
      inputArtifactId = checkpoint.input_artifact.artifact_id;
    } else {
      if (checkpoint.output_index_artifact) fail("input_checkpoint_missing");
      const s = lease.snapshot;
      const input = await spoolSignalWorkspaceEngineInputV1({ storage_root: storageRoot, directory: inputDir,
        snapshot: { workspace_id: s.workspace_id, input_revision: Number(s.input_revision), preparation_run_id: s.preparation_run_id,
          embedding_run_id: s.embedding_run_id, embedding_config_digest: s.embedding_profile.config_digest,
          context_digest: s.context_digest, catalog_digest: s.catalog_digest, chunk_policy_version: "corpus-text-chunks-v1",
          roots: s.expected_roots, chunks: s.expected_chunks, guides: s.expected_guides, dimensions: 1024, config: s.engine_config },
        chunks: allChunks(), guides: allGuides(), onProgress: async counts => {
          if (heartbeatError) throw heartbeatError;
          await job.updateProgress({ phase, processed_chunks: counts.chunks, processed_roots: counts.roots }).catch(() => undefined);
        } });
      const prepared = await prepareSignalWorkspaceIncrementalInputFilesV1({ storage_root: storageRoot, input_directory: inputDir,
        input_manifest_ref: await reference(inputDir, "manifest.json"), execution_id: lease.execution_id,
        descriptor, roots: allRoots(), parent: parent() });
      inputRef = prepared.input_ref;
      const refs: Stored[] = [];
      for (const name of inputNames) refs.push(await upload(inputDir, name));
      const savedInput = await upload(inputDir, "incremental.json");
      inputArtifactId = (await store.input({ database, lease, input: prepared.input,
        artifact: artifact(savedInput, "incremental-input.json"), input_files: refs,
        roots_count: input.records.roots, chunks_count: input.records.rows })).artifact_id;
    }
    const input = parseSignalWorkspaceIncrementalInputV1(await readJson(join(inputDir, "incremental.json")));
    if (input.execution_id !== lease.execution_id || input.workspace_id !== lease.workspace_id
      || digest(input.compatibility) !== digest(descriptor.compatibility)
      || input.parent.manifest_sha256 !== descriptor.parent.manifest_sha256) fail("input_checkpoint_invalid");
    await store.heartbeat({ database, lease, phase: "fitting", exported: {
      roots: lease.snapshot.expected_roots, chunks: lease.snapshot.expected_chunks,
      guides: lease.snapshot.expected_guides, stream_digest: input.current_input_manifest.sha256 } });
    phase = "fitting";
    let bundle: Stored[] | null = null, outputIndexId = checkpoint.output_index_artifact?.artifact_id;
    if (checkpoint.output_index_artifact) {
      await mkdir(outputDir, { mode: 0o700 });
      await storage.get({ workspace_id: lease.workspace_id, execution_id: lease.execution_id,
        stored: checkpoint.output_index_artifact, destination: join(outputDir, "incremental-output-index.json") });
      const index = z.object({ contract_version: z.literal("workspace-incremental-output-index-v1"),
        execution_id: z.literal(lease.execution_id), descriptor_digest: z.literal(descriptor.descriptor_digest),
        input_artifact_id: z.literal(inputArtifactId), files: stored.array().min(1) }).strict()
        .parse(await readJson(join(outputDir, "incremental-output-index.json")));
      bundle = index.files;
      if (new Set(bundle.map(ref => ref.name)).size !== bundle.length
        || bundle.some(ref => ref.name === "incremental-output-index.json")
        || bundle.length !== checkpoint.output_index_artifact.metadata.file_count) fail("output_index_invalid");
      for (const ref of bundle) await storage.get({ workspace_id: lease.workspace_id, execution_id: lease.execution_id,
        stored: ref, destination: join(outputDir, ref.name) });
    } else {
      await (options.process ?? runWorkspaceEngineProcessV1)({ mode: "incremental_numeric",
        python: options.python ?? process.env.NOISIA_WORKSPACE_ENGINE_PYTHON ?? "/opt/noisia-engine/bin/python",
        module_root: options.module_root ?? process.env.NOISIA_WORKSPACE_ENGINE_MODULE_ROOT ?? "/app/tools/signal-semantic-lab/src",
        storage_root: storageRoot, input_directory: inputDir, output_directory: outputDir,
        previous: { directory: parentDir, manifest_sha256: descriptor.parent.manifest_sha256 }, timeout_ms: options.timeout_ms, heartbeat });
    }
    const verified = await validateSignalWorkspaceIncrementalOutputFilesV1({ storage_root: storageRoot, input_directory: inputDir,
      output_directory: outputDir, input_ref: inputRef, descriptor, parent: parent(),
      ...(bundle ? { output_manifest_ref: asFile(bundle.find(ref => ref.name === "manifest.json")) } : {}) });
    phase = "persisting"; await heartbeat();
    const output = verified.manifest;
    if (!bundle) {
      bundle = [];
      for (const ref of verified.files) bundle.push(await upload(outputDir, ref.file));
      if (output.components.length) {
        await writeFile(join(outputDir, "model-manifest.json"), JSON.stringify({ contract_version: "workspace-incremental-model-bank-v1",
          descriptor_digest: descriptor.descriptor_digest, output_manifest_sha256: verified.manifest_ref.sha256,
          components_file: verified.files.find(ref => ref.file === "model-components.json"),
          origin_digest: verified.validation.origin_digest, approval_policy: "none" }), { flag: "wx", mode: 0o600 });
        bundle.push(await upload(outputDir, "model-manifest.json"));
      }
      await historyFile(outputDir); bundle.push(await upload(outputDir, "incremental-history.json"));
      const index = JSON.stringify({ contract_version: "workspace-incremental-output-index-v1", execution_id: lease.execution_id,
        descriptor_digest: descriptor.descriptor_digest, input_artifact_id: inputArtifactId, files: bundle });
      if (Buffer.byteLength(index) > maxMetadata) fail("output_index_capacity_exceeded");
      await writeFile(join(outputDir, "incremental-output-index.json"), index, { flag: "wx", mode: 0o600 });
      const ref = await upload(outputDir, "incremental-output-index.json");
      outputIndexId = (await store.index({ database, lease, artifact: artifact(ref), input_artifact_id: inputArtifactId,
        output_manifest: { sha256: verified.manifest_ref.sha256, size_bytes: verified.manifest_ref.bytes }, file_count: bundle.length })).artifact_id;
    }
    // The index is durable before any individual output row. A lost ACK or
    // partial DB write can restore these exact files without another process.
    if (!outputIndexId) fail("output_index_missing");
    const expected = new Set([...verified.files.map(ref => ref.file), "incremental-history.json",
      ...(output.components.length ? ["model-manifest.json"] : [])]);
    if (bundle.length !== expected.size || bundle.some(ref => !expected.has(ref.name))) fail("output_index_invalid");
    const ids = new Map<string, string>();
    for (const ref of bundle.filter(ref => ref.name !== "incremental-history.json")) {
      const saved = await store.persist({ database, lease, artifact: artifact(ref) }); ids.set(ref.name, saved.artifact_id);
      await heartbeat();
    }
    const outputId = ids.get("manifest.json"), bankId = ids.get("model-manifest.json") ?? null;
    if (!outputId) fail("output_artifact_missing");
    const modelId = bankId ? (await store.bank({ database, lease, model_bank_artifact_id: bankId, output_artifact_id: outputId })).model_version_id : null;
    if (modelId) for await (const components of pages(output.components)) {
      await store.components({ database, lease, model_version_id: modelId, components: components.map(component => {
        const model = ids.get(component.model.file), center = component.center ? ids.get(component.center.file) : null;
        if (!model || component.center && !center) return fail("component_artifact_missing");
        return { component_key: component.component_key, lane: component.lane, model_artifact_id: model,
          center_artifact_id: center ?? null, model_origin: component.model_origin, unit_count: component.units.length,
          unit_digest: digest(component.units) };
      }) });
    }
    const relationsId = ids.get("relations.json"), history = bundle.find(ref => ref.name === "incremental-history.json");
    if (!relationsId || !history) fail("history_missing");
    const historyId = (await store.persistHistory({ database, lease, artifact: artifact(history), relations_artifact_id: relationsId })).artifact_id;
    const finished = await store.checkpointOutput({ database, lease, input_artifact_id: inputArtifactId,
      output_index_artifact_id: outputIndexId, output_artifact_id: outputId, model_bank_artifact_id: bankId,
      model_version_id: modelId, history_artifact_id: historyId, output, validation: verified.validation });
    const result = await store.finish({ database, lease, checkpoint_digest: finished.checkpoint_digest });
    await job.updateProgress(100).catch(() => undefined); return result;
  } catch (error) {
    const code = safeWorkspaceIncrementalErrorV1(error);
    await store.fail({ database, lease, error_code: code }).catch(() => undefined); throw new Error(code);
  } finally {
    clearInterval(timer); await Promise.resolve(pending).catch(() => undefined);
    if (attempt) await rm(attempt, { recursive: true, force: true }).catch(() => undefined);
  }

  async function upload(directory: string, name: string): Promise<Stored> {
    const ref = await reference(directory, name);
    const saved = await storage.put({ workspace_id: lease.workspace_id, execution_id: lease.execution_id,
      file: join(directory, name), sha256: ref.sha256, size_bytes: ref.bytes, media_type: mediaType(name) });
    await heartbeat(); return { name, ...saved };
  }
  async function* allChunks(): AsyncGenerator<SignalWorkspaceEngineChunkV1[]> {
    let after: Parameters<typeof store.chunks>[0]["after"] = null;
    for (;;) { const page = await store.chunks({ database, lease, after, limit: 128 });
      if (page.items.length > 128 || !page.done && (!page.items.length || digest(page.next_cursor) === digest(after))) fail("page_stalled");
      if (page.items.length) yield page.items.map(row => ({ ...row, expected_chunks: row.expected_root_chunks }));
      if (page.done) break; after = page.next_cursor;
    }
  }
  async function* allGuides(): AsyncGenerator<SignalWorkspaceEngineGuideV1[]> {
    let after: Parameters<typeof store.guides>[0]["after"] = null;
    for (;;) { const page = await store.guides({ database, lease, after, limit: 128 });
      if (page.items.length > 128 || !page.done && (!page.items.length || digest(page.next_cursor) === digest(after))) fail("page_stalled");
      if (page.items.length) yield page.items; if (page.done) break; after = page.next_cursor;
    }
  }
  async function* allRoots() {
    let after: string | null = null;
    for (;;) { const page = await store.roots({ database, lease, after_root_id: after, limit: 128 });
      if (page.items.length > 128 || !page.done && (!page.items.length || page.next_cursor === after)) fail("page_stalled");
      if (page.items.length) yield page.items; if (page.done) break; after = page.next_cursor;
    }
  }
  async function historyFile(directory: string) {
    const file = await open(join(directory, "incremental-history.json"), "wx", 0o600);
    try {
      const header = JSON.stringify({ contract_version: "workspace-incremental-history-v1", execution_id: lease.execution_id,
        descriptor_digest: descriptor!.descriptor_digest, parent: descriptor!.parent, editorial_completion: "not_evaluated" });
      await file.writeFile(header.slice(0, -1) + ',"references":[');
      let after: string | undefined, count = 0, parentHistory: string | null | undefined;
      for (;;) { const page = await store.history({ database, lease, after_artifact_id: after, limit: 128 });
        if (page.items.length > 128 || !page.done && (!page.items.length || page.next_cursor === after)) fail("history_page_stalled");
        const parentId = page.parent_history?.artifact_id ?? null;
        if (parentHistory !== undefined && parentHistory !== parentId) fail("history_parent_changed");
        if (parentHistory === undefined && page.parent_history) {
          await file.writeFile(JSON.stringify(page.parent_history)); count++;
        }
        parentHistory = parentId;
        for (const ref of page.items) { await file.writeFile((count++ ? "," : "") + JSON.stringify(ref)); }
        if (page.done) break; after = page.next_cursor ?? undefined;
      }
      await file.writeFile("]}\n"); await file.sync();
    } finally { await file.close(); }
  }
}

async function reference(directory: string, file: string): Promise<WorkspaceIncrementalFileRefV1> {
  fileName.parse(file); const path = join(directory, file), info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) return fail("file_invalid");
  return { file, sha256: await hashWorkspaceEngineFileV1(path), bytes: info.size };
}
function asFile(ref: Stored | undefined): WorkspaceIncrementalFileRefV1 {
  if (!ref) return fail("manifest_missing"); return { file: ref.name, sha256: ref.sha256, bytes: ref.size_bytes };
}
function artifact(ref: Stored, key = ref.name): SignalWorkspaceEngineArtifactV1 {
  return { artifact_key: key, artifact_type: key.endsWith(".joblib") || key === "model-manifest.json" ? "engine_model" : "engine_output",
    title: key, storage_key: ref.storage_key, sha256: ref.sha256, size_bytes: ref.size_bytes, media_type: ref.media_type,
    metadata: { filename: key, quality: "uncalibrated", semantic_approval: "none" } };
}
async function* pages<T>(values: readonly T[]): AsyncGenerator<T[]> {
  for (let i = 0; i < values.length; i += 128) yield values.slice(i, i + 128);
}

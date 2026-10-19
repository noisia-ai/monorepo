import type { Job } from "bullmq";
import { readFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, open, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import {
  readSignalWorkspaceIncrementalProjectionDerivationV1, readSignalWorkspaceIncrementalProjectionRootsV1,
  readSignalWorkspaceIncrementalProjectionTopicsV1, readSignalWorkspaceIncrementalProjectionProposalsV1,
  persistSignalWorkspaceIncrementalProjectionBindingsPageV1, completeSignalWorkspaceIncrementalProjectionBindingsV1,
  heartbeatSignalWorkspaceIncrementalProjectionDispatchV1, failSignalWorkspaceIncrementalProjectionDispatchV1,
  completeSignalWorkspaceIncrementalProjectionDispatchV1,
  persistSignalWorkspaceIncrementalProjectionUnitsPageV1,
  materializeSignalWorkspaceIncrementalEditorialTopicsV1,
  type SignalWorkspaceEngineDatabaseV1, type SignalWorkspaceEngineArtifactV1,
  type SignalWorkspaceIncrementalProjectionDerivationV1, type SignalWorkspaceIncrementalProjectionProposalRefV1,
} from "@noisia/db";
import { resolveSignalWorkspaceIncrementalBindingsV1, signalWorkspaceEmbeddingDigestV1 as digest,
  type SignalWorkspaceIncrementalProjectionProposalV1, type SignalWorkspaceIncrementalProjectionTopicV1,
} from "@noisia/query-engine";
import { hashWorkspaceEngineFileV1 } from "./signal-workspace-engine-files";
import { createWorkspaceEngineStorageV1, type WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";
import { prepareWorkspaceIncrementalProjectionFilesV1 } from "./signal-workspace-incremental-projection-files";
import { safeWorkspaceClassificationErrorV1 } from "./signal-workspace-classification";

export const SIGNAL_WORKSPACE_INCREMENTAL_DERIVATION_JOB_NAME = "signal_workspace_incremental_derivation_v1";
export const workspaceIncrementalDerivationStoresV1 = {
  read: readSignalWorkspaceIncrementalProjectionDerivationV1, roots: readSignalWorkspaceIncrementalProjectionRootsV1,
  topics: readSignalWorkspaceIncrementalProjectionTopicsV1, proposals: readSignalWorkspaceIncrementalProjectionProposalsV1,
  bindings: persistSignalWorkspaceIncrementalProjectionBindingsPageV1, finish: completeSignalWorkspaceIncrementalProjectionBindingsV1,
  heartbeat: heartbeatSignalWorkspaceIncrementalProjectionDispatchV1, fail: failSignalWorkspaceIncrementalProjectionDispatchV1,
  completeDispatch: completeSignalWorkspaceIncrementalProjectionDispatchV1,
  units: persistSignalWorkspaceIncrementalProjectionUnitsPageV1,
};
export type WorkspaceIncrementalDerivationStoresV1 = typeof workspaceIncrementalDerivationStoresV1 & {
  materialize?: typeof materializeSignalWorkspaceIncrementalEditorialTopicsV1;
};
type Options = { database?: SignalWorkspaceEngineDatabaseV1; stores?: WorkspaceIncrementalDerivationStoresV1;
  storage?: WorkspaceEngineStorageV1; scratch_root?: string };
const uuid = z.string().uuid(), maximumMetadata = 8 * 1024 * 1024, maximumEditorialBytes = 64 * 1024 * 1024;
const safeName = z.string().regex(/^[a-z][a-z0-9_.-]{0,100}$/u).refine(value => !value.includes(".."));
function invalid(suffix: string): never { throw new Error(`workspace_incremental_projection_${suffix}`); }
export function safeWorkspaceIncrementalProjectionErrorV1(error: unknown) {
  if (safeWorkspaceClassificationErrorV1(error) === "workspace_classification_transport_unavailable"
    || error instanceof Error && ["workspace_engine_storage_transport_failed", "workspace_engine_storage_unavailable"].includes(error.message))
    return "workspace_incremental_projection_transport_unavailable";
  return error instanceof Error && /^workspace_[a-z_]{1,100}$/u.test(error.message)
    ? error.message : "workspace_incremental_projection_worker_failed";
}

/** A derived outbox job owns no numeric/provider lease. It validates existing
 * bytes, seals the historical binding and atomically requests classification. */
export async function signalWorkspaceIncrementalDerivationJobV1(
  job: Pick<Job<{ execution_id: string; workspace_id: string; actor_user_id: string }>, "id" | "data" | "updateProgress">,
  options: Options = {},
) {
  if (!job.id || ![job.data?.execution_id, job.data?.workspace_id, job.data?.actor_user_id].every(value => uuid.safeParse(value).success))
    invalid("job_invalid");
  const database = options.database ?? (await import("../db/client")).pool;
  const store: WorkspaceIncrementalDerivationStoresV1 = options.stores ?? workspaceIncrementalDerivationStoresV1;
  const scope = { database, ...job.data, worker_job_id: job.id };
  let directory: string | undefined, pending: Promise<unknown> | null = null, failure: unknown;
  const heartbeat = async () => {
    if (failure) throw failure;
    pending ??= store.heartbeat(scope).catch(error => { failure = error; throw error; }).finally(() => { pending = null; });
    await pending;
  };
  const timer = setInterval(() => { void heartbeat().catch(() => undefined); }, 15000); timer.unref();
  try {
    const derivation = await store.read(scope);
    const request = { ...scope, derivation_digest: derivation.derivation_digest };
    if (derivation.completed_projection) {
      await store.completeDispatch(request); return derivation.completed_projection;
    }
    const storage = options.storage ?? createWorkspaceEngineStorageV1();
    const root = resolve(options.scratch_root ?? join(tmpdir(), "noisia-workspace-projection"));
    await mkdir(root, { recursive: true, mode: 0o700 }); const storageRoot = await realpath(root);
    directory = await mkdtemp(join(storageRoot, "derive-"));
    const loaded = await loadWorkspaceIncrementalProjectionInputV1({ database, derivation, directory, storage_root: storageRoot,
      storage, stores: store, heartbeat });
    // Compare the complete current DB population before sealing a binding.
    const roots = loaded.files.roots()[Symbol.asyncIterator](); let next = await roots.next(), after: string | undefined;
    try {
      for (;;) {
        const page = await store.roots({ ...request, after_root_id: after, limit: 128 });
        if (page.items.length > 128 || !page.done && !page.items.length) invalid("root_page_invalid");
        for (const current of page.items) {
          if (next.done || after !== undefined && current.root_id <= after) invalid("population_changed");
          const { unit_keys: _units, state: _state, discovery_pending: _pending, ...identity } = next.value.root;
          if (digest(current) !== digest(identity)) invalid("population_changed");
          after = current.root_id; next = await roots.next();
        }
        if (page.next_cursor !== (after ?? null)) invalid("root_page_invalid");
        await heartbeat(); if (page.done) break;
      }
      if (!next.done) invalid("population_changed");
    } finally { await roots.return?.(); }
    const { bindings, files } = loaded;
    async function persistUnits() {
    // Persist the entire model-bank census, including units with no interpreted
    // Topic or no current members. These aliases reuse the stored bank bytes.
    let units: Array<Parameters<typeof store.units>[0]["units"][number]> = [];
    for (const component of files.manifest.components) for (const unit of component.units) {
      units.push({ component_key: component.component_key, ...unit });
      if (units.length === 128) { await store.units({ ...request, units }); units = []; await heartbeat(); }
    }
    if (units.length) { await store.units({ ...request, units }); await heartbeat(); }
    }
    if (loaded.has_incremental_editorial) {
      await persistUnits();
      const result = await (store.materialize ?? materializeSignalWorkspaceIncrementalEditorialTopicsV1)({ ...request,
        proposals: (async function* () { yield* loaded.packets(); })() });
      if (result.requires_dispatch_refresh) {
        // Publishing a catalog changes the dispatch identity. Finish this real
        // catalog stage; the existing scheduler admits the next scoped stage.
        if (!result.catalog_receipt) invalid("catalog_receipt_invalid");
        await store.completeDispatch({ ...request, catalog_receipt: result.catalog_receipt });
        return { phase: "catalog" as const, catalog_receipt: result.catalog_receipt,
          binding_artifact_id: null, projection_execution_id: null, generation_id: null, replayed: false };
      }
    }

    const summary = { binding_digest: bindings.binding_digest, editorial_cut_digest: bindings.editorial_cut_digest,
      interpretation_coverage: bindings.interpretation_coverage,
      discovery_coverage: { state: files.manifest.discovery_status, pending_roots: files.census.pending_roots } };
    const name = `incremental-bindings-${derivation.derivation_digest.slice(7)}.jsonl`, path = join(directory, name);
    const stream = await open(path, "wx", 0o600);
    try { for (const binding of bindings.bindings) await stream.writeFile(JSON.stringify(binding) + "\n"); }
    finally { await stream.close(); }
    const stored = await storage.put({ workspace_id: scope.workspace_id, execution_id: scope.execution_id, file: path,
      sha256: await hashWorkspaceEngineFileV1(path), size_bytes: (await lstat(path)).size, media_type: "application/x-ndjson" });
    const artifact: SignalWorkspaceEngineArtifactV1 = { ...stored, artifact_key: name, artifact_type: "engine_output",
      title: "Current Topics and original interpretation evidence", metadata: {} };
    if (!loaded.has_incremental_editorial) await persistUnits();
    for (let offset = 0; offset < bindings.bindings.length; offset += 128) {
      await store.bindings({ ...request, artifact, summary, bindings: bindings.bindings.slice(offset, offset + 128) }); await heartbeat();
    }
    const result = await store.finish({ ...request, artifact, summary });
    await job.updateProgress(100).catch(() => undefined); return result;
  } catch (error) {
    const code = safeWorkspaceIncrementalProjectionErrorV1(error);
    await store.fail({ ...scope, error_code: code }).catch(() => undefined); throw new Error(code);
  } finally {
    clearInterval(timer); await Promise.resolve(pending).catch(() => undefined);
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Shared by derivation and projection. Only the six certified numerical
 * streams and original paid interpretation packets are downloaded, no models. */
export async function loadWorkspaceIncrementalProjectionInputV1(args: {
  database: SignalWorkspaceEngineDatabaseV1; derivation: SignalWorkspaceIncrementalProjectionDerivationV1;
  directory: string; storage_root: string; storage: WorkspaceEngineStorageV1;
  stores: Pick<WorkspaceIncrementalDerivationStoresV1, "topics" | "proposals">; heartbeat(): Promise<unknown>;
}) {
  const { derivation: d, database, storage, directory, stores: store, heartbeat } = args;
  const request = { database, execution_id: d.execution_id, workspace_id: d.workspace_id, actor_user_id: d.actor_user_id,
    worker_job_id: d.worker_job_id, derivation_digest: d.derivation_digest };
  const allowed = new Set(["manifest.json", "roots.jsonl", "population.jsonl", "memberships.jsonl", "pending-cohort.jsonl", "model-components.json"]);
  if (d.artifacts.length !== allowed.size || d.artifacts.some(ref => !allowed.has(ref.artifact_key))) invalid("artifact_scope_invalid");
  const names = new Set<string>();
  for (const ref of d.artifacts) {
    const name = safeName.parse(ref.artifact_key);
    if (ref.owner_execution_id !== d.execution_id || names.has(name)) invalid("artifact_scope_invalid"); names.add(name);
    await storage.get({ workspace_id: d.workspace_id, execution_id: d.execution_id, stored: ref, destination: join(directory, name) });
    await heartbeat();
  }
  const manifest = d.artifacts.find(ref => ref.artifact_id === d.numeric_checkpoint.output_artifact_id);
  if (!manifest || manifest.artifact_key !== "manifest.json") invalid("manifest_missing");
  const files = await prepareWorkspaceIncrementalProjectionFilesV1({ storage_root: args.storage_root, directory,
    manifest_ref: { file: "manifest.json", sha256: manifest.sha256, bytes: manifest.size_bytes },
    checkpoint: { ...d.numeric_checkpoint, workspace_id: d.workspace_id, execution_id: d.execution_id,
      discovery_status: z.enum(["complete", "pending_insufficient_population", "pending_cohort_close"]).parse(d.numeric_checkpoint.discovery_status),
      relations_status: z.enum(["pending", "none"]).parse(d.numeric_checkpoint.relations_status) } });
  const topics: SignalWorkspaceIncrementalProjectionTopicV1[] = [];
  let term: string | undefined, metadataBytes = 0;
  for (;;) {
    const page = await store.topics({ ...request, after_term_key: term, limit: 128 });
    if (page.items.length > 128 || !page.done && !page.items.length) invalid("topic_page_invalid");
    for (const topic of page.items) {
      if (term !== undefined && topic.definition.term_key <= term) invalid("topic_page_invalid"); term = topic.definition.term_key;
      metadataBytes += Buffer.byteLength(JSON.stringify(topic)); if (metadataBytes > maximumEditorialBytes) invalid("catalog_capacity_exceeded");
      topics.push(topic);
    }
    if (page.next_cursor !== (term ?? null)) invalid("topic_page_invalid");
    await heartbeat(); if (page.done) break;
  }
  const proposalDirectory = join(directory, "proposals"); await mkdir(proposalDirectory, { mode: 0o700 });
  const proposals: SignalWorkspaceIncrementalProjectionProposalRefV1[] = [];
  let after: string | undefined, proposalBytes = 0, refBytes = 0;
  for (;;) {
    const page = await store.proposals({ ...request, after_artifact_id: after, limit: 32 });
    if (page.items.length > 32 || !page.done && !page.items.length) invalid("proposal_page_invalid");
    for (const ref of page.items) {
      uuid.parse(ref.artifact_id); uuid.parse(ref.owner_execution_id);
      if (after !== undefined && ref.artifact_id <= after || ref.size_bytes > 2 * 1024 * 1024) invalid("proposal_page_invalid");
      proposalBytes += ref.size_bytes; refBytes += Buffer.byteLength(JSON.stringify(ref));
      if (proposalBytes > maximumEditorialBytes || refBytes > maximumMetadata) invalid("history_capacity_exceeded");
      await storage.get({ workspace_id: d.workspace_id, execution_id: ref.owner_execution_id,
        stored: ref, destination: join(proposalDirectory, ref.artifact_id + ".json") });
      after = ref.artifact_id; proposals.push(ref); await heartbeat();
    }
    if (page.next_cursor !== (after ?? null)) invalid("proposal_page_invalid");
    if (page.done) break;
  }
  function* packets(): Generator<SignalWorkspaceIncrementalProjectionProposalV1> {
    for (const ref of proposals) yield { ...ref, body: readFileSync(join(proposalDirectory, ref.artifact_id + ".json"), "utf8") };
  }
  await heartbeat();
  const bindings = resolveSignalWorkspaceIncrementalBindingsV1({ workspace_id: d.workspace_id,
    components: files.manifest.components, topics, proposals: packets() });
  if (bindings.editorial_cut_digest !== d.editorial_cut_digest
    || bindings.interpretation_coverage.expected_unit_count !== files.census.expected_unit_count
    || bindings.interpretation_coverage.expected_unit_digest !== files.census.expected_unit_digest) invalid("binding_coverage_invalid");
  await heartbeat(); return { files, bindings, packets, has_incremental_editorial: proposals.some(ref => ref.source?.kind === "incremental_editorial") };
}

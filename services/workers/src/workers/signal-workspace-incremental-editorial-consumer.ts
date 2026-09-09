import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  claimSignalWorkspaceIncrementalEditorialV1, heartbeatSignalWorkspaceIncrementalEditorialV1,
  readSignalWorkspaceIncrementalEditorialContextV1, readSignalWorkspaceIncrementalEditorialEvidenceUnitsV1,
  readSignalWorkspaceIncrementalEditorialRequestPlanV1, readSignalWorkspaceIncrementalEditorialRequestsV1,
  readSignalWorkspaceIncrementalEditorialCheckpointsV1, persistSignalWorkspaceIncrementalEditorialRequestPlanV1,
  persistSignalWorkspaceIncrementalEditorialRepairV1, persistSignalWorkspaceIncrementalEditorialCheckpointV1,
  finishSignalWorkspaceIncrementalEditorialV1, failSignalWorkspaceIncrementalEditorialV1,
  type SignalWorkspaceEngineDatabaseV1, type SignalWorkspaceIncrementalEditorialCheckpointV1,
  type SignalWorkspaceIncrementalEditorialStoredV1,
} from "@noisia/db";
import {
  SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1 as configuration,
  signalWorkspaceEmbeddingDigestV1 as digest, buildSignalWorkspaceInterpretationRepairBatchV1,
  parseSignalWorkspaceInterpretationEditorialRepairV1, validateSignalWorkspaceInterpretationResultV1,
  type SignalWorkspaceInterpretationBatchV1, type SignalWorkspaceInterpretationV1,
} from "@noisia/query-engine";
import { hashWorkspaceEngineFileV1 } from "./signal-workspace-engine-files";
import { sendWorkspaceInterpretationV1 } from "../providers/workspace-interpretation";
import { createWorkspaceEngineStorageV1, type WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";
import { executeWorkspaceInterpretationBatchV1, type WorkspaceInterpretationBatchExecutionV1 } from "./signal-workspace-interpretation-batch";
import { prepareWorkspaceIncrementalEditorialBatchReaderV1, stageWorkspaceIncrementalEditorialBatchesV1,
  type WorkspaceIncrementalEditorialBatchPlanV1 } from "./signal-workspace-incremental-editorial-batches";
import type { WorkspaceIncrementalEditorialEvidenceDescriptorV1 } from "./signal-workspace-incremental-editorial-evidence";

const stores = {
  claim: claimSignalWorkspaceIncrementalEditorialV1, heartbeat: heartbeatSignalWorkspaceIncrementalEditorialV1,
  context: readSignalWorkspaceIncrementalEditorialContextV1, units: readSignalWorkspaceIncrementalEditorialEvidenceUnitsV1,
  plan: readSignalWorkspaceIncrementalEditorialRequestPlanV1, requests: readSignalWorkspaceIncrementalEditorialRequestsV1,
  checkpoints: readSignalWorkspaceIncrementalEditorialCheckpointsV1, persistPlan: persistSignalWorkspaceIncrementalEditorialRequestPlanV1,
  repair: persistSignalWorkspaceIncrementalEditorialRepairV1, checkpoint: persistSignalWorkspaceIncrementalEditorialCheckpointV1,
  finish: finishSignalWorkspaceIncrementalEditorialV1, fail: failSignalWorkspaceIncrementalEditorialV1,
};
const MAX_BYTES = 8 * 1024 * 1024, PAGE = 128;
const sha = (body: Uint8Array | string) => `sha256:${createHash("sha256").update(body).digest("hex")}`;
const hash = /^sha256:[0-9a-f]{64}$/u;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
function fail(suffix: string): never { throw new Error(`workspace_incremental_editorial_${suffix}`); }
const same = (a: unknown, b: unknown) => digest(a) === digest(b);
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const safeError = (error: unknown, fromBatchExecution: boolean, fromReceiptRead = false) => {
  const code = error instanceof Error ? error.message : "";
  if (fromReceiptRead && ["workspace_engine_storage_transport_failed", "workspace_engine_storage_unavailable"].includes(code))
    return "workspace_incremental_editorial_transport_unavailable";
  if (fromBatchExecution && !/^workspace_engine_interpretation_[a-z_]+$/u.test(code))
    return "workspace_incremental_editorial_worker_failed";
  if (["workspace_engine_storage_transport_failed", "workspace_engine_storage_unavailable",
    "workspace_engine_interpretation_receipt_recovery_required"].includes(code))
    return "workspace_incremental_editorial_transport_unavailable";
  return /^workspace_(?:engine_interpretation|incremental_editorial)_[a-z_]{1,100}$/u.test(code)
    ? code : "workspace_incremental_editorial_worker_failed";
};
const resultBody = (batch: SignalWorkspaceInterpretationBatchV1, interpretations: SignalWorkspaceInterpretationV1[]) => ({
  contract_version: "workspace-incremental-editorial-result-v1", context: batch.context, clusters: batch.clusters, interpretations,
  ...(batch.editorial_repair ? { editorial_repair: batch.editorial_repair } : {}),
});

export type WorkspaceIncrementalEditorialConsumerOptionsV1 = {
  database: SignalWorkspaceEngineDatabaseV1; execution_id: string; worker_job_id: string;
  stores?: typeof stores; storage?: WorkspaceEngineStorageV1; storage_root?: string;
  batch_stores?: WorkspaceInterpretationBatchExecutionV1["stores"];
  send?: WorkspaceInterpretationBatchExecutionV1["send"];
  api_key?: string; provider_enabled?: boolean; authorization_expires_at?: string;
};

/** Standalone consumer of an explicitly admitted editorial execution. No fit,
 * numerical fallback, admission, dispatch or catalog mutation lives here. All
 * requests reach a durable exact plan before the first reservation. Text stays
 * on disk except one bounded batch/checkpoint; metadata is capped at 8 MiB. */
export async function runWorkspaceIncrementalEditorialConsumerV1(args: WorkspaceIncrementalEditorialConsumerOptionsV1) {
  if (!uuid.test(args.execution_id) || !args.worker_job_id) return fail("job_invalid");
  const store = args.stores ?? stores, database = args.database;
  const claimed = await store.claim({ database, execution_id: args.execution_id, worker_job_id: args.worker_job_id })
    .catch(error => { throw new Error(safeError(error, false)); });
  if ("completed" in claimed) return { execution_id: claimed.execution_id, completed: true, replayed: true };
  let lease = claimed, attempt: string | undefined, heartbeatError: unknown = null, heartbeatPromise: Promise<void> | null = null;
  let batchError: unknown, receiptReadError: unknown;
  const heartbeat = async () => {
    if (heartbeatError) throw heartbeatError;
    heartbeatPromise ??= store.heartbeat({ database, lease }).then(() => undefined)
      .catch(error => { heartbeatError = error; throw error; }).finally(() => { heartbeatPromise = null; });
    await heartbeatPromise;
  };
  const timer = setInterval(() => { void heartbeat().catch(() => undefined); }, 15000); timer.unref();
  try {
    await heartbeat();
    const source = await store.context({ database, lease });
    // The authoritative admission may have been revoked after claim. Keep all
    // immutable lease/plan fields exact, refresh only that receipt, and let the
    // ledger block new sends while paid checkpoints remain recoverable.
    if (!same({ ...source.lease, interpretation_admission: null }, { ...lease, interpretation_admission: null })
      || source.context.workspace_id !== lease.workspace_id
      || source.context.execution_id !== lease.execution_id || lease.execution_id.toLowerCase() === lease.numeric_execution_id.toLowerCase()
      || !same(lease.config.call_configuration, configuration)) return fail("context_invalid");
    lease = source.lease;
    const storage = args.storage ?? createWorkspaceEngineStorageV1();
    const root = resolve(args.storage_root ?? join(tmpdir(), "noisia-incremental-editorial"));
    await mkdir(root, { recursive: true, mode: 0o700 });
    attempt = await mkdtemp(join(await realpath(root), "attempt-"));
    const directory = attempt;
    let header = await store.plan({ database, lease });
    if (!header) {
      const units: WorkspaceIncrementalEditorialEvidenceDescriptorV1["units"] = [];
      let after: string | undefined, metadataBytes = size(source.evidence.descriptor);
      for (;;) {
        await heartbeat();
        const page = await store.units({ database, lease, after_unit_key: after, limit: PAGE });
        if (page.length > PAGE) return fail("evidence_invalid");
        for (const unit of page) {
          if (after !== undefined && unit.unit_key <= after) return fail("evidence_invalid");
          after = unit.unit_key; metadataBytes += size(unit) + 1;
          if (metadataBytes > MAX_BYTES) return fail("capacity_exceeded");
          units.push(unit);
        }
        if (page.length < PAGE) break;
      }
      if (!source.evidence.descriptor || typeof source.evidence.descriptor !== "object" || Array.isArray(source.evidence.descriptor))
        return fail("evidence_invalid");
      const descriptor = { ...source.evidence.descriptor, units } as WorkspaceIncrementalEditorialEvidenceDescriptorV1;
      if (source.evidence.artifact_id !== lease.evidence_plan_artifact_id
        || descriptor.numeric_execution_id !== lease.numeric_execution_id || descriptor.numeric_checkpoint_digest !== lease.numeric_checkpoint_digest
        || descriptor.evidence_digest !== lease.evidence_digest || descriptor.target_unit_digest !== lease.target_unit_digest
        || descriptor.target_binding_digest !== lease.target_binding_digest || descriptor.stream.rows !== lease.target_units
        || source.evidence.stored.sha256 !== descriptor.stream.sha256 || source.evidence.stored.size_bytes !== descriptor.stream.bytes)
        return fail("evidence_invalid");
      const evidencePath = join(directory, "evidence.jsonl");
      await heartbeat();
      await storage.get({ workspace_id: lease.workspace_id, execution_id: lease.numeric_execution_id,
        stored: source.evidence.stored, destination: evidencePath });
      const path = join(directory, "requests-staged.jsonl"), file = await open(path, "wx", 0o600);
      let staged: WorkspaceIncrementalEditorialBatchPlanV1;
      try {
        staged = await stageWorkspaceIncrementalEditorialBatchesV1({ path: evidencePath, descriptor, context: source.context,
          write_batch: async row => { await heartbeat(); await file.writeFile(row.jsonl); } });
        await file.sync();
      } finally { await file.close(); }
      const stored = await putFile(path, "application/x-ndjson", staged.stream.sha256, staged.stream.bytes);
      await heartbeat();
      try { await store.persistPlan({ database, lease, plan: staged, stored }); }
      catch (error) {
        const recovered = await store.plan({ database, lease }).catch(() => null);
        if (!recovered || recovered.plan.plan_digest !== staged.plan_digest || !same(recovered.stored, stored)) throw error;
      }
      // Read back the committed plan. An unconfirmed persistence ACK exits
      // before any provider; the next claim restores this stream, never regroups.
      header = await store.plan({ database, lease });
      if (!header || header.plan.plan_digest !== staged.plan_digest) return fail("request_plan_invalid");
    }
    const requests: WorkspaceIncrementalEditorialBatchPlanV1["requests"] = [];
    let metadataBytes = size(header.plan), afterIndex = -1;
    for (;;) {
      await heartbeat();
      const page = await store.requests({ database, lease, after_index: afterIndex, limit: PAGE });
      if (page.length > PAGE) return fail("request_plan_invalid");
      for (const row of page) {
        if (row.request.index !== afterIndex + 1 || !same(row.stored, header.stored)) return fail("request_plan_invalid");
        afterIndex = row.request.index; metadataBytes += size(row.request) + 1;
        if (metadataBytes > MAX_BYTES) return fail("capacity_exceeded");
        requests.push(row.request);
      }
      if (page.length < PAGE) break;
    }
    const plan = { ...header.plan, requests };
    if (plan.evidence_digest !== lease.evidence_digest || plan.target_binding_digest !== lease.target_binding_digest
      || plan.target_unit_digest !== lease.target_unit_digest || plan.numeric_execution_id !== lease.numeric_execution_id
      || plan.units !== lease.target_units || header.stored.sha256 !== plan.stream.sha256 || header.stored.size_bytes !== plan.stream.bytes)
      return fail("request_plan_invalid");
    const requestPath = join(directory, "requests-restored.jsonl");
    await storage.get({ workspace_id: lease.workspace_id, execution_id: lease.execution_id, stored: header.stored, destination: requestPath });
    const reader = await prepareWorkspaceIncrementalEditorialBatchReaderV1({ path: requestPath, plan, context: source.context });
    const completed = await restoreCheckpoints();
    let index = 0;
    for (const original of reader.batches()) {
      if (completed.has(index++)) continue;
      await heartbeat();
      let batch = original, { call, response } = await execute(batch);
      if (response.outcome !== "validated" || !response.interpretations) {
        if (response.outcome !== "known_response_invalid" || response.error_code !== "workspace_engine_interpretation_output_invalid")
          throw new Error(response.error_code ?? "workspace_engine_interpretation_output_invalid");
        if (call.state !== "settled" || call.editorial_repair || !call.response?.complete
          || call.request_digest !== original.request_digest || call.response.sha256 !== response.receipt_sha256)
          throw new Error("workspace_engine_interpretation_repair_unavailable");
        batch = buildSignalWorkspaceInterpretationRepairBatchV1(original, { source_call_id: call.call_id,
          source_response_sha256: call.response.sha256, diagnostic: "output_invalid" });
        const stored = await putBody(`repair-${index}.json`, JSON.stringify(batch));
        await heartbeat();
        await store.repair({ database, lease, original, batch, stored });
        ({ call, response } = await execute(batch));
        if (response.outcome !== "validated" || !response.interpretations)
          throw new Error("workspace_engine_interpretation_repair_invalid");
      }
      if (call.state !== "settled" || !call.response?.complete || call.request_digest !== batch.request_digest
        || call.response.sha256 !== response.receipt_sha256) return fail("checkpoint_invalid");
      const interpretations = validateSignalWorkspaceInterpretationResultV1(batch, { interpretations: response.interpretations });
      const stored = await putBody(`result-${index}.json`, JSON.stringify(resultBody(batch, interpretations)));
      await heartbeat();
      try {
        await store.checkpoint({ database, lease, batch, interpretations, call_id: call.call_id,
          response_sha256: call.response.sha256, stored });
      } catch (error) {
        // Only an exact durable receipt closes a lost ACK. No second provider,
        // optimistic progress or changed request is allowed during recovery.
        const confirmed = await checkpointConfirmed(call.call_id, batch, call.response.sha256, stored).catch(() => false);
        if (!confirmed) throw error;
      }
    }
    await heartbeat();
    let finished;
    try { finished = await store.finish({ database, lease }); }
    catch (error) {
      // finish is idempotent and verifies the existing complete checkpoint set;
      // retrying this same closure never claims a new lease or sends anything.
      finished = await store.finish({ database, lease }).catch(() => { throw error; });
    }
    return { execution_id: finished.execution_id, completed: true, replayed: finished.replayed };

    async function execute(batch: SignalWorkspaceInterpretationBatchV1) {
      await heartbeat();
      try { return await executeWorkspaceInterpretationBatchV1({ database, execution: lease, actor_user_id: lease.actor_user_id,
        config: lease.config, batch, directory,
        storage: { ...storage, get: async request => {
          try { await storage.get(request); }
          catch (error) { receiptReadError = error; throw error; }
        } }, stores: args.batch_stores,
        send: async request => {
          // Reservation may have waited on a lock while the heartbeat failed.
          // Recheck before transport and again at its send-admission boundary.
          await heartbeat();
          return (args.send ?? sendWorkspaceInterpretationV1)({ ...request, authorize_send: async () => {
            await heartbeat(); return request.authorize_send();
          } });
        },
        api_key: args.api_key, provider_enabled: args.provider_enabled, authorization_expires_at: args.authorization_expires_at }); }
      catch (error) { batchError = error; throw error; }
    }
    async function putFile(path: string, media_type: string, expectedHash?: string, expectedBytes?: number) {
      await heartbeat();
      const info = await stat(path), sha256 = await hashWorkspaceEngineFileV1(path);
      if (expectedHash !== undefined && sha256 !== expectedHash || expectedBytes !== undefined && info.size !== expectedBytes)
        return fail("artifact_invalid");
      const stored = await storage.put({ workspace_id: lease.workspace_id, execution_id: lease.execution_id,
        file: path, sha256, size_bytes: info.size, media_type });
      if (stored.sha256 !== sha256 || stored.size_bytes !== info.size || stored.media_type !== media_type) return fail("artifact_invalid");
      return stored;
    }
    async function putBody(filename: string, body: string) {
      if (Buffer.byteLength(body) > MAX_BYTES) return fail("capacity_exceeded");
      const path = join(directory, filename); await writeFile(path, body, { flag: "wx", mode: 0o600 });
      return putFile(path, "application/json");
    }
    async function checkpointConfirmed(callId: string, batch: SignalWorkspaceInterpretationBatchV1,
      responseSha: string, stored: SignalWorkspaceIncrementalEditorialStoredV1) {
      let after: string | undefined, count = 0;
      for (;;) {
        const page = await store.checkpoints({ database, lease, after_artifact_id: after, limit: PAGE });
        if (page.length > PAGE || (count += page.length) > plan.batches) return false;
        for (const item of page) {
          if (after !== undefined && item.artifact_id <= after) return false;
          after = item.artifact_id;
          if (item.call_id === callId) return item.request_digest === batch.request_digest && item.response_sha256 === responseSha
            && same(item.unit_keys, batch.clusters.map(cluster => cluster.cluster_id)) && same(item.stored, stored);
        }
        if (page.length < PAGE) return false;
      }
    }
    async function restoreCheckpoints() {
      const rows = new Map<string, SignalWorkspaceIncrementalEditorialCheckpointV1>();
      const planned = new Map(requests.map(request => [request.unit_keys[0], request]));
      let after: string | undefined, bytes = 0;
      for (;;) {
        await heartbeat();
        const page = await store.checkpoints({ database, lease, after_artifact_id: after, limit: PAGE });
        if (page.length > PAGE) return fail("checkpoint_invalid");
        for (const item of page) {
          const request = planned.get(item.unit_keys[0]);
          if (!uuid.test(item.artifact_id) || after !== undefined && item.artifact_id <= after || !request
            || !same(item.unit_keys, request.unit_keys) || rows.has(item.unit_keys[0]!) || !hash.test(item.response_sha256))
            return fail("checkpoint_invalid");
          after = item.artifact_id; bytes += size(item);
          if (bytes > MAX_BYTES) return fail("capacity_exceeded");
          rows.set(item.unit_keys[0]!, item);
        }
        if (page.length < PAGE) break;
      }
      const completed = new Set<number>(); let batchIndex = 0;
      // Check EVERY checkpoint before any new reservation, including citations
      // and exact original clusters. Metadata alone never skips an editorial unit.
      for (const original of reader.batches()) {
        const currentIndex = batchIndex++, item = rows.get(original.clusters[0]!.cluster_id);
        if (!item) continue;
        await heartbeat();
        const path = join(directory, `checkpoint-${currentIndex}.json`);
        const stored: SignalWorkspaceIncrementalEditorialStoredV1 = item.stored;
        if (stored.media_type !== "application/json" || !Number.isSafeInteger(stored.size_bytes)
          || stored.size_bytes < 1 || stored.size_bytes > MAX_BYTES) return fail("checkpoint_invalid");
        await storage.get({ workspace_id: lease.workspace_id, execution_id: lease.execution_id, stored, destination: path });
        if ((await stat(path)).size !== stored.size_bytes) return fail("checkpoint_invalid");
        const content = await readFile(path);
        if (sha(content) !== stored.sha256) return fail("checkpoint_invalid");
        try {
          const packet = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content));
          if (packet.contract_version !== "workspace-incremental-editorial-result-v1"
            || !same(packet.context, original.context) || !same(packet.clusters, original.clusters)) return fail("checkpoint_invalid");
          let batch = original;
          if (packet.editorial_repair !== undefined)
            batch = buildSignalWorkspaceInterpretationRepairBatchV1(original, parseSignalWorkspaceInterpretationEditorialRepairV1(packet.editorial_repair));
          if (batch.request_digest !== item.request_digest) return fail("checkpoint_invalid");
          const interpretations = validateSignalWorkspaceInterpretationResultV1(batch, { interpretations: packet.interpretations });
          if (!content.equals(Buffer.from(JSON.stringify(resultBody(batch, interpretations))))) return fail("checkpoint_invalid");
        } catch { return fail("checkpoint_invalid"); }
        completed.add(currentIndex);
      }
      return completed;
    }
  } catch (error) {
    const code = safeError(error, error === batchError, error === receiptReadError);
    await store.fail({ database, lease, error_code: code }).catch(() => undefined);
    // BullMQ must receive only the fixed code, never a private PG/storage error.
    throw new Error(code);
  } finally {
    clearInterval(timer);
    if (heartbeatPromise) await heartbeatPromise.catch(() => undefined);
    if (attempt) await rm(attempt, { recursive: true, force: true });
  }
}

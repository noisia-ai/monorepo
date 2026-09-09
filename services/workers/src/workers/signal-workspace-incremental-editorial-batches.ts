import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { TextDecoder } from "node:util";
import { batchSignalWorkspaceInterpretationV1, parseSignalWorkspaceInterpretationClusterV1,
  buildSignalWorkspaceInterpretationBatchV1,
  SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1, signalWorkspaceEmbeddingDigestV1 as digest,
  signalWorkspaceInterpretationUniverseDigestV1,
  type SignalWorkspaceInterpretationBatchV1, type SignalWorkspaceInterpretationContextV1,
} from "@noisia/query-engine";
import { hashWorkspaceEngineFileV1 } from "./signal-workspace-engine-files";
import type { WorkspaceIncrementalEditorialEvidenceDescriptorV1 } from "./signal-workspace-incremental-editorial-evidence";

const MAX_BYTES = 8 * 1024 * 1024;
const fail = (code: string): never => { throw new Error(`workspace_incremental_editorial_batches_${code}`); };
const same = (a: unknown, b: unknown) => digest(a) === digest(b);

/** Bounded synchronous iterable for the existing synchronous batch algorithm.
 * Only one line plus a 64 KiB read buffer is resident; each completed batch is
 * awaited by the async caller. UTF8, EOF and line size are strict. */
function* lines(path: string): Generator<unknown> {
  const file = openSync(path, "r"), read = Buffer.allocUnsafe(64 * 1024);
  let pending = Buffer.alloc(0);
  try {
    for (;;) {
      const size = readSync(file, read, 0, read.length, null); if (!size) break;
      pending = Buffer.concat([pending, read.subarray(0, size)]); let end: number;
      while ((end = pending.indexOf(10)) !== -1) {
        if (end < 1 || end > MAX_BYTES) fail("line_invalid");
        const row = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(pending.subarray(0, end)));
        pending = pending.subarray(end + 1); yield row;
      }
      if (pending.length > MAX_BYTES) fail("line_capacity_exceeded");
    }
    if (pending.length) fail("incomplete");
  } finally { closeSync(file); }
}

export type WorkspaceIncrementalEditorialBatchPlanV1 = Awaited<ReturnType<typeof stageWorkspaceIncrementalEditorialBatchesV1>>;

/** Restore a complete, server-authorized plan without regrouping its units.
 * Preflight checks every exact byte range and rebuilds every request before the
 * first consumable batch. The iterator rechecks each range when consumed. The
 * caller still validates its lease/claims/grant before reserving or sending. */
export async function prepareWorkspaceIncrementalEditorialBatchReaderV1(args: {
  path: string; plan: WorkspaceIncrementalEditorialBatchPlanV1; context: SignalWorkspaceInterpretationContextV1;
}) {
  const invalid = (): never => fail("plan_invalid");
  const plan = structuredClone(args.plan), context = structuredClone(args.context), path = args.path;
  try {
  const { plan_digest, ...unsigned } = plan;
  if (plan.contract_version !== "workspace-incremental-editorial-batch-plan-v1" || digest(unsigned) !== plan_digest
    || Buffer.byteLength(JSON.stringify(plan)) > MAX_BYTES || plan.workspace_id !== context.workspace_id
    || plan.editorial_execution_id !== context.execution_id || plan.context_digest !== context.context_digest
    || plan.editorial_execution_id.toLowerCase() === plan.numeric_execution_id.toLowerCase()
    || plan.configuration_digest !== digest(SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1)
    || !Number.isSafeInteger(plan.batches) || plan.batches < 1 || plan.requests.length !== plan.batches
    || !Number.isSafeInteger(plan.units) || plan.units < 1) invalid();
  const checkFile = async () => {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== plan.stream.bytes
      || await hashWorkspaceEngineFileV1(path) !== plan.stream.sha256) fail("source_changed");
  };
  await checkFile();
  const unitKeys = plan.requests.flatMap(request => request.unit_keys);
  if (unitKeys.length !== plan.units || signalWorkspaceInterpretationUniverseDigestV1(unitKeys) !== plan.target_unit_digest) invalid();
  let offset = 0;
  for (const [index, request] of plan.requests.entries()) {
    if (request.index !== index || request.offset !== offset || !Number.isSafeInteger(request.size_bytes)
      || request.size_bytes < 1 || request.size_bytes > MAX_BYTES || !Number.isSafeInteger(offset + request.size_bytes)) invalid();
    offset += request.size_bytes;
  }
  if (offset !== plan.stream.bytes) invalid();
  function* batches() {
    const file = openSync(path, "r");
    try {
      for (const request of plan.requests) {
        const bytes = Buffer.allocUnsafe(request.size_bytes); let received = 0;
        while (received < bytes.length) {
          const read = readSync(file, bytes, received, bytes.length - received, request.offset + received);
          if (!read) invalid(); received += read;
        }
        if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== request.sha256
          || bytes.at(-1) !== 10 || bytes.indexOf(10) !== bytes.length - 1) invalid();
        const row = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        if (!row || !same(Object.keys(row).sort(), ["batch", "contract_version", "index"])
          || row.contract_version !== "workspace-incremental-editorial-batch-v1" || row.index !== request.index
          || !row.batch || !same(row.batch.context, context)) invalid();
        const batch = buildSignalWorkspaceInterpretationBatchV1(context, row.batch.clusters, SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1);
        if (!same(batch, row.batch) || batch.request_digest !== request.request_digest || batch.batch_key !== request.batch_key
          || batch.reserved_micro_usd !== request.reserved_micro_usd
          || !same(batch.clusters.map(cluster => cluster.cluster_id), request.unit_keys)) invalid();
        yield batch;
      }
    } catch (error) {
      if (error instanceof Error && /^workspace_incremental_editorial_batches_[a-z_]+$/u.test(error.message)) throw error;
      return invalid();
    } finally { closeSync(file); }
  }
  // All ranges, evidence and request seals pass before returning the iterator.
  for (const _batch of batches()) { /* consume the complete immutable plan */ }
  await checkFile();
  return { plan: structuredClone(plan), batches };
  } catch (error) {
    if (error instanceof Error && /^workspace_incremental_editorial_batches_[a-z_]+$/u.test(error.message)) throw error;
    return invalid();
  }
}

/** LOCAL preparation only: no lease, claims, reservation, provider or catalog.
 * The caller supplies a server-authorized evidence descriptor and NEW editorial
 * context. Every input line is checked before the first output callback. The
 * final plan exists only after the complete batch stream and a final SHA check.
 * Partial callback objects are orphans, never permission to send a first batch. */
export async function stageWorkspaceIncrementalEditorialBatchesV1(args: {
  path: string; descriptor: WorkspaceIncrementalEditorialEvidenceDescriptorV1;
  context: SignalWorkspaceInterpretationContextV1;
  write_batch: (row: { index: number; batch: SignalWorkspaceInterpretationBatchV1; jsonl: string }) => Promise<void>;
}) {
  try {
    const { evidence_digest, ...unsigned } = args.descriptor;
    if (args.descriptor.contract_version !== "workspace-incremental-editorial-evidence-stream-v1"
      || digest(unsigned) !== evidence_digest || args.context.execution_id.toLowerCase() === args.descriptor.numeric_execution_id.toLowerCase()
      || Buffer.byteLength(JSON.stringify(args.descriptor)) > MAX_BYTES) fail("descriptor_invalid");
    const targets = args.descriptor.units.filter(unit => unit.status === "evidence_ready");
    const targetKeys = targets.map(unit => unit.unit_key);
    if (!targets.length || args.descriptor.stream.rows !== targets.length
      || signalWorkspaceInterpretationUniverseDigestV1(targetKeys) !== args.descriptor.target_unit_digest
      || digest(targets.map(({ component_key, local_label, unit_key, birth_membership_digest, model_origin }) =>
        ({ component_key, unit: { local_label, unit_key, birth_membership_digest }, model_origin }))) !== args.descriptor.target_binding_digest)
      fail("universe_invalid");
    const checkFile = async () => {
      const info = await lstat(args.path);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== args.descriptor.stream.bytes
        || await hashWorkspaceEngineFileV1(args.path) !== args.descriptor.stream.sha256) fail("source_changed");
    };
    await checkFile();
    function* clusters() {
      let index = 0;
      for (const value of lines(args.path)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) fail("line_invalid");
        const row = value as Record<string, unknown>;
        if (!same(Object.keys(row).sort(), ["cluster", "contract_version", "unit"])
          || row.contract_version !== "workspace-incremental-editorial-evidence-unit-v1"
          || index >= targets.length || !same(row.unit, targets[index])) fail("binding_invalid");
        const cluster = parseSignalWorkspaceInterpretationClusterV1(row.cluster), unit = targets[index++]!;
        if (cluster.cluster_id !== unit.unit_key || cluster.cluster_digest !== unit.cluster_digest
          || cluster.lane !== unit.lane || cluster.root_count !== unit.root_count || cluster.chunk_count !== unit.chunk_count)
          fail("binding_invalid");
        yield cluster;
      }
      if (index !== targets.length) fail("incomplete");
    }
    // Run the exact production batch algorithm to EOF before publishing anything,
    // including context validation and individual packet capacity checks.
    let expectedBatches = 0;
    for (const _batch of batchSignalWorkspaceInterpretationV1(args.context, clusters(), SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1))
      expectedBatches++;
    await checkFile();
    const streamHash = createHash("sha256"); let streamBytes = 0, count = 0, units = 0;
    const requests: Array<{ index: number; batch_key: string; request_digest: string; unit_keys: string[];
      reserved_micro_usd: number; offset: number; size_bytes: number; sha256: string }> = [];
    for (const batch of batchSignalWorkspaceInterpretationV1(args.context, clusters(), SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1)) {
      const jsonl = JSON.stringify({ contract_version: "workspace-incremental-editorial-batch-v1", index: count, batch }) + "\n";
      const bytes = Buffer.byteLength(jsonl);
      if (bytes > MAX_BYTES || !Number.isSafeInteger(streamBytes + bytes)) fail("capacity_exceeded");
      // Seal metadata from the same bytes before passing a mutable batch to a
      // storage callback. Callback-side mutation must not change plan authority.
      const request = { index: count, batch_key: batch.batch_key, request_digest: batch.request_digest,
        unit_keys: batch.clusters.map(cluster => cluster.cluster_id), reserved_micro_usd: batch.reserved_micro_usd,
        offset: streamBytes, size_bytes: bytes, sha256: `sha256:${createHash("sha256").update(jsonl).digest("hex")}` };
      await args.write_batch({ index: count, batch, jsonl });
      requests.push(request);
      streamHash.update(jsonl); streamBytes += bytes; units += request.unit_keys.length; count++;
    }
    await checkFile();
    if (count !== expectedBatches || units !== targets.length) fail("incomplete");
    const plan = { contract_version: "workspace-incremental-editorial-batch-plan-v1" as const,
      workspace_id: args.context.workspace_id, editorial_execution_id: args.context.execution_id,
      numeric_execution_id: args.descriptor.numeric_execution_id, evidence_digest,
      target_unit_digest: args.descriptor.target_unit_digest, target_binding_digest: args.descriptor.target_binding_digest,
      context_digest: args.context.context_digest, configuration_digest: digest(SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1),
      units, batches: count, requests, stream: { bytes: streamBytes, sha256: `sha256:${streamHash.digest("hex")}` } };
    if (Buffer.byteLength(JSON.stringify(plan)) > MAX_BYTES) fail("capacity_exceeded");
    return { ...plan, plan_digest: digest(plan) };
  } catch (error) {
    if (error instanceof Error && /^workspace_incremental_editorial_batches_[a-z_]+$/u.test(error.message)) throw error;
    return fail("invalid");
  }
}

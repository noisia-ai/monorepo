import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSignalWorkspaceCapabilitiesStoreV1, loadSignalWorkspaceMassLabelingGlobalReplaySourceV2,
  recordSignalWorkspaceMassLabelingGlobalReceiptDecisionV1, retrySignalWorkspaceEngineV1,
  verifyMassLabelingSourceCheckpointsV1, SignalWorkspaceEngineError,
  type SignalWorkspaceEngineDatabaseV1 } from "@noisia/db";
import { buildMassLabelingConsolidationRequestV1, buildMassLabelingConsolidationRecoveryDecisionV2,
 } from "@noisia/query-engine";
import { createWorkspaceEngineStorageV1 } from "../../../../../services/workers/src/workers/signal-workspace-engine-storage";

type Access = { database: SignalWorkspaceEngineDatabaseV1; workspaceId: string; actorUserId: string; executionId: string };
type Stored = { storage_key: string; sha256: string; size_bytes: number; media_type: string };
export type PaidGlobalReplayReaderV2 = (args: { workspace_id: string; execution_id: string; stored: Stored }) => Promise<string>;
const fail = () => { throw new SignalWorkspaceEngineError("workspace_engine_global_receipt_decision_invalid"); };
const accessOf = (args: Access) => ({ database: args.database, workspace_id: args.workspaceId,
  actor_user_id: args.actorUserId, execution_id: args.executionId });
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const MAX_OBJECT_BYTES = 2 * 1024 * 1024, MAX_TOTAL_BYTES = 128 * 1024 * 1024;

/** Metadata only: no object storage, provider availability or monetary admission. */
export async function workspacePaidGlobalReplayAvailabilityV2(args: Access) {
  try {
    const source = await loadSignalWorkspaceMassLabelingGlobalReplaySourceV2(accessOf(args));
    return { execution_id: source.execution_id, call_id: source.call_id };
  } catch (error) {
    if (error instanceof Error && /^workspace_engine_global_receipt_(?:decision_invalid|forbidden)$/u.test(error.message)) return null;
    throw error;
  }
}

/** Resume one paid native receipt. Decisions and response bodies never come from
 * the browser. The immutable decision binding forbids all future reserve/send. */
export async function resumeWorkspacePaidGlobalConsolidationV2(args: Access & { idempotencyKey: string },
  dependencies: { readStored?: PaidGlobalReplayReaderV2 } = {}) {
  if (!/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotencyKey))
    throw new SignalWorkspaceEngineError("workspace_analysis_request_invalid", 422);
  const access = accessOf(args);
  const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: args.database,
    workspace_id: args.workspaceId, actor_user_id: args.actorUserId });
  if (!capabilities.can_request_processing || !capabilities.can_edit_topics)
    throw new SignalWorkspaceEngineError("workspace_engine_forbidden", 403);
  const native = (await args.database.query(`SELECT 1 FROM signal_topic_catalog_executions
    WHERE id=$1::uuid AND workspace_id=$2::uuid AND actor_user_id=$3::uuid
      AND signal_mass_labeling_product_engine_v2(workspace_id,input_contract,input_snapshot)`,
  [args.executionId, args.workspaceId, args.actorUserId])).rows.length === 1;
  if (!native) return fail();
  // Resolve a lost response before loading failed-only evidence. The existing
  // retry verifies alias actor/digest and cannot enqueue the same intent twice.
  const prior = (await args.database.query(`SELECT 1 FROM signal_topic_catalog_executions
    WHERE workspace_id=$1::uuid AND (idempotency_key=$2 OR engine_request_keys ? $2)`,
  [args.workspaceId, args.idempotencyKey])).rows.length > 0;
  if (prior) return retrySignalWorkspaceEngineV1({ ...access, idempotency_key: args.idempotencyKey });
  const source = await loadSignalWorkspaceMassLabelingGlobalReplaySourceV2(access);
  const objects = [source.response, ...source.source_checkpoints.map(item => item.content)];
  if (source.source_checkpoints.length > 200 || objects.some(item => !Number.isSafeInteger(item.size_bytes)
    || item.size_bytes <= 0 || item.size_bytes > MAX_OBJECT_BYTES)
    || objects.reduce((total, item) => total + item.size_bytes, 0) > MAX_TOTAL_BYTES) return fail();
  let directory: string | undefined;
  try {
    let readStored = dependencies.readStored;
    if (!readStored) {
      directory = await mkdtemp(join(tmpdir(), "noisia-paid-global-replay-"));
      const storage = createWorkspaceEngineStorageV1({ timeout_ms: 20_000 });
      let ordinal = 0;
      readStored = async input => {
        const destination = join(directory!, `${ordinal++}.json`);
        await storage.get({ ...input, destination });
        return readFile(destination, "utf8");
      };
    }
    const bodies = new Array<string>(objects.length);
    let cursor = 0;
    const reads = await Promise.allSettled(Array.from({ length: Math.min(4, objects.length) }, async () => {
      for (;;) {
        const index = cursor++; if (index >= objects.length) return;
        const stored = objects[index]!;
        const body = await readStored!({ workspace_id: args.workspaceId, execution_id: args.executionId, stored });
        if (Buffer.byteLength(body) !== stored.size_bytes || sha(body) !== stored.sha256) return fail();
        bodies[index] = body;
      }
    }));
    const failed = reads.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    const raw_response = bodies[0]!;
    const source_checkpoints = source.source_checkpoints.map((item, index) => ({ artifact_id: item.artifact_id, body: bodies[index + 1]! }));
    const expected_group_ids = source.source_checkpoints.flatMap(item => {
      const units = item.metadata.unit_keys;
      if (!Array.isArray(units) || !units.every(key => typeof key === "string")) return fail();
      return units as string[];
    });
    const verified = await verifyMassLabelingSourceCheckpointsV1({ ...access, source_engine_execution_id: args.executionId,
      source_checkpoints, expected_group_ids, failed_receipt_recovery: { call_id: source.call_id,
        request_digest: source.request_digest, response_sha256: source.response_sha256 } });
    const batch = buildMassLabelingConsolidationRequestV1({ workspace_id: args.workspaceId,
      source_engine_execution_id: args.executionId, source_groups: verified.source_groups,
      configuration: source.configuration, category_context: source.category_context });
    if (batch.request_digest !== source.request_digest || batch.source_groups_digest !== source.source_groups_digest) return fail();
    const decision = buildMassLabelingConsolidationRecoveryDecisionV2({ batch, raw_response, call_id: source.call_id });
    await recordSignalWorkspaceMassLabelingGlobalReceiptDecisionV1({ ...access, call_id: source.call_id,
      request_digest: source.request_digest, response_sha256: source.response_sha256,
      source_groups_digest: source.source_groups_digest, decision, batch, raw_response, source_checkpoints });
    // No processing capacity/new admission: a settled receipt remains paid across
    // midnight. The DB no-send trigger, not a budget-date renewal, bounds replay.
    return retrySignalWorkspaceEngineV1({ ...access, idempotency_key: args.idempotencyKey });
  } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
}

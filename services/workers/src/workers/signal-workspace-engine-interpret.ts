import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readSignalWorkspaceEngineInterpretationContextV1, checkpointSignalWorkspaceEngineFitV1,
  reserveSignalWorkspaceEngineInterpretationV1, markSignalWorkspaceEngineInterpretationSentV1,
  persistSignalWorkspaceEngineInterpretationResponseV1, settleSignalWorkspaceEngineInterpretationV1,
  failSignalWorkspaceEngineInterpretationV1, checkpointSignalWorkspaceEngineInterpretationV1,
  readSignalWorkspaceEngineInterpretationCheckpointsV1,
  materializeSignalWorkspaceEngineTopicsV1, persistSignalWorkspaceEngineArtifactV1, completeSignalWorkspaceEngineAnalysisV1,
  SignalWorkspaceEngineInterpretationError,
  type SignalWorkspaceEngineDatabaseV1, type SignalWorkspaceEngineLeaseV1, type SignalWorkspaceEngineFitArgsV1,
} from "@noisia/db";
import { batchSignalWorkspaceInterpretationV1, signalWorkspaceInterpretationUniverseDigestV1,
  signalWorkspaceEmbeddingDigestV1, buildSignalWorkspaceInterpretationRepairBatchV1, buildSignalWorkspaceInterpretationBatchV1,
  parseSignalWorkspaceInterpretationConfigurationV1,
  validateSignalWorkspaceInterpretationResultV1, parseSignalWorkspaceInterpretationEditorialRepairV1,
  type SignalWorkspaceInterpretationBatchV1, type SignalWorkspaceInterpretationClusterV1 } from "@noisia/query-engine";
import { sendWorkspaceInterpretationV1, validateWorkspaceInterpretationReceiptV1, WorkspaceInterpretationTransportErrorV1,
  type WorkspaceInterpretationResponseV1 } from "../providers/workspace-interpretation";
import type { WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";

const stores = {
  context: readSignalWorkspaceEngineInterpretationContextV1, fit: checkpointSignalWorkspaceEngineFitV1,
  reserve: reserveSignalWorkspaceEngineInterpretationV1, sent: markSignalWorkspaceEngineInterpretationSentV1,
  response: persistSignalWorkspaceEngineInterpretationResponseV1, settle: settleSignalWorkspaceEngineInterpretationV1,
  fail: failSignalWorkspaceEngineInterpretationV1, checkpoint: checkpointSignalWorkspaceEngineInterpretationV1,
  checkpoints: readSignalWorkspaceEngineInterpretationCheckpointsV1,
  materialize: materializeSignalWorkspaceEngineTopicsV1, persist: persistSignalWorkspaceEngineArtifactV1,
  complete: completeSignalWorkspaceEngineAnalysisV1,
};
const sha = (bytes: Uint8Array | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (code: string): never => { throw new Error(code); };

/** Continue the same leased execution. Durable responses are consumed again on
 * recovery. A successor requires the store's unsent or verified-terminal authority. */
export async function interpretWorkspaceEngineV1(args: {
  database: SignalWorkspaceEngineDatabaseV1; lease: SignalWorkspaceEngineLeaseV1;
  fit: Omit<SignalWorkspaceEngineFitArgsV1, "database" | "lease">;
  clusters: SignalWorkspaceInterpretationClusterV1[]; directory: string; storage: WorkspaceEngineStorageV1;
  heartbeat: (phase: "interpreting" | "materializing") => Promise<void>;
  stores?: typeof stores; send?: typeof sendWorkspaceInterpretationV1;
  api_key?: string; provider_enabled?: boolean; authorization_expires_at?: string;
}) {
  const store = args.stores ?? stores, { database, lease, storage } = args;
  const config = lease.effective_interpretation_config ?? lease.snapshot.interpretation_config
    ?? fail("workspace_engine_interpretation_not_requested");
  const configuration = parseSignalWorkspaceInterpretationConfigurationV1(config.call_configuration);
  const universe = signalWorkspaceInterpretationUniverseDigestV1(args.clusters.map(item => item.cluster_id));
  await store.fit({ database, lease, ...args.fit, interpretation_manifest: { unit_count: args.clusters.length, unit_digest: universe } });
  await args.heartbeat("interpreting");
  const context = await store.context({ database, lease });
  const proposals: Array<{ artifact_id: string; file: string }> = [];
  const completedUnits = await restoreCheckpoints();
  const remaining = args.clusters.filter(cluster => !completedUnits.has(cluster.cluster_id));
  for (const originalBatch of batchSignalWorkspaceInterpretationV1(context.context, remaining, configuration)) {
    await args.heartbeat("interpreting");
    if (signalWorkspaceEmbeddingDigestV1(originalBatch.configuration) !== signalWorkspaceEmbeddingDigestV1(config.call_configuration)) {
      return fail("workspace_engine_interpretation_config_mismatch");
    }
    let batch = originalBatch;
    let { call, response } = await executeBatch(batch);
    if (!response.interpretations || response.outcome !== "validated") {
      // One new editorial request may correct a complete, metered but invalid
      // result. It never replaces the original receipt, restarts numerical fit,
      // retries unknown transport, or recursively repairs a second bad answer.
      if (response.outcome !== "known_response_invalid" || response.error_code !== "workspace_engine_interpretation_output_invalid")
        return fail(response.error_code ?? "workspace_engine_interpretation_output_invalid");
      if (call.state !== "settled" || call.editorial_repair || !call.response?.complete
        || call.request_digest !== batch.request_digest || call.response.sha256 !== response.receipt_sha256)
        return fail("workspace_engine_interpretation_repair_unavailable");
      batch = buildSignalWorkspaceInterpretationRepairBatchV1(originalBatch, { source_call_id: call.call_id,
        source_response_sha256: call.response.sha256, diagnostic: "output_invalid" });
      await args.heartbeat("interpreting");
      ({ call, response } = await executeBatch(batch));
      if (!response.interpretations || response.outcome !== "validated")
        return fail("workspace_engine_interpretation_repair_invalid");
    }
    await args.heartbeat("interpreting");
    const filename = `interpretation-${call.call_id}.json`;
    const body = JSON.stringify({ contract_version: "workspace-engine-interpretation-result-v1", execution_id: lease.execution_id,
      context: batch.context, clusters: batch.clusters, interpretations: response.interpretations,
      ...(batch.editorial_repair ? { editorial_repair: batch.editorial_repair } : {}) });
    const stored = await put(filename, body);
    const checkpoint = await store.checkpoint({ database, lease, call_id: call.call_id,
      unit_keys: batch.clusters.map(item => item.cluster_id), artifact: { ...stored, artifact_key: filename,
        artifact_type: "engine_proposals", title: "Topic interpretations", metadata: {} } });
    proposals.push({ artifact_id: checkpoint.artifact_id, file: join(args.directory, filename) });
  }
  await args.heartbeat("materializing");
  const materialized = await store.materialize({ database, lease, proposals: (async function* () {
    for (const item of proposals) yield { artifact_id: item.artifact_id, body: await readFile(item.file, "utf8") };
  })() });
  // replayed is transport state, excluded from immutable artifact bytes.
  const { replayed: _replayed, mapping, ...metadata } = materialized;
  const stored = await put("materialization.json", JSON.stringify({ ...metadata, mapping }));
  const artifact = await store.persist({ database, lease, artifact: { ...stored, artifact_key: "materialization.json",
    artifact_type: "engine_proposals", title: "Editable topic catalog", metadata } });
  await args.heartbeat("materializing");
  return store.complete({ database, lease, materialization_artifact_id: artifact.artifact_id });

  async function executeBatch(batch: SignalWorkspaceInterpretationBatchV1) {
    const reservation = { database, workspace_id: lease.workspace_id, execution_id: lease.execution_id,
      actor_user_id: context.actor_user_id, execution_token: lease.execution_token,
      idempotency_key: batch.batch_key, request_digest: batch.request_digest, configuration: config.call_configuration,
      reserved_micro_usd: batch.reserved_micro_usd, budget_timezone: config.budget_timezone, daily_cap_micro_usd: config.daily_cap_micro_usd,
      ...(lease.interpretation_revision_digest ? { interpretation_revision_digest: lease.interpretation_revision_digest } : {}),
      ...(batch.editorial_repair ? { editorial_repair: batch.editorial_repair } : {}) };
    let call = await store.reserve(reservation);
    let transportAttempts = 0, confirmedTerminals = 0;
    while (call.state === "definitely_not_sent" || call.state === "terminal_confirmed") {
      if (++transportAttempts > 128) return fail("workspace_engine_interpretation_retry_unavailable");
      if (call.state === "terminal_confirmed" && ++confirmedTerminals > 1)
        return fail("workspace_engine_interpretation_transport_retry_exhausted");
      // This invocation is a newly claimed job, after the preceding one failed.
      // The DB verifies terminal evidence, the single-successor limit, current
      // authority and cumulative caps; neither state releases a terminal's cost.
      call = await store.reserve({ ...reservation, idempotency_key: `${batch.batch_key}:retry:${call.call_id}`,
        retry_of_call_id: call.call_id });
    }
    if (call.state === "outcome_unknown") return fail("workspace_engine_interpretation_outcome_unknown");
    const attempt = { database, call_id: call.call_id, attempt_token: call.attempt_token };
    let response: WorkspaceInterpretationResponseV1;
    if (call.response) {
      const path = join(args.directory, `response-${call.call_id}.json`);
      await storage.get({ workspace_id: lease.workspace_id, execution_id: lease.execution_id,
        stored: { ...call.response, media_type: "application/json" }, destination: path });
      response = validateWorkspaceInterpretationReceiptV1(batch, { bytes: await readFile(path), sha256: call.response.sha256,
        http_status: call.response.http_status, provider_request_id: call.response.provider_request_id, complete: call.response.complete });
    } else if (call.state === "reserved") {
      try {
        response = await (args.send ?? sendWorkspaceInterpretationV1)({ batch,
          api_key: args.api_key ?? process.env.ANTHROPIC_API_KEY ?? "",
          provider_enabled: args.provider_enabled ?? process.env.NOISIA_WORKSPACE_INTERPRETATION_ENABLED === "true",
          authorization_expires_at: args.authorization_expires_at ?? process.env.NOISIA_WORKSPACE_INTERPRETATION_AUTHORIZED_UNTIL,
          authorize_send: async () => {
            try { return (await store.sent({ ...attempt, execution_token: lease.execution_token })).send_authorized; }
            catch (error) {
              if (error instanceof SignalWorkspaceEngineInterpretationError && error.status === 409
                && error.code === "workspace_engine_interpretation_daily_authority_expired") return "daily_authority_expired";
              throw error;
            }
          },
          persist_receipt: async raw => {
            const stored = await put(`response-${call.call_id}.json`, raw.bytes);
            call = await store.response({ ...attempt, response: { ...stored, http_status: raw.http_status,
              provider_request_id: raw.provider_request_id, complete: raw.complete } });
          },
        });
      } catch (error) {
        const transport = error instanceof WorkspaceInterpretationTransportErrorV1 ? error : null;
        const reconciled = await store.fail({ ...attempt, outcome: transport?.outcome ?? "outcome_unknown",
          error_code: transport?.code ?? "workspace_engine_interpretation_outcome_unknown" }).catch(() => null);
        // A lost commit acknowledgement is recoverable when the DB confirms
        // that the complete raw receipt is already durable. This never sends.
        if (transport?.code === "workspace_engine_interpretation_receipt_persistence_unknown"
          && reconciled?.state === "response_persisted" && reconciled.response?.complete) {
          return fail("workspace_engine_interpretation_receipt_recovery_required");
        }
        throw error;
      }
    } else {
      // A committed send without a receipt is never silently retried.
      await store.fail({ ...attempt, outcome: "outcome_unknown", error_code: "workspace_engine_interpretation_outcome_unknown" });
      return fail("workspace_engine_interpretation_outcome_unknown");
    }
    if (response.usage && response.outcome !== "outcome_unknown") call = await store.settle({ ...attempt, usage: response.usage });
    else {
      await store.fail({ ...attempt, outcome: "outcome_unknown", error_code: response.error_code ?? "workspace_engine_interpretation_outcome_unknown" });
      return fail("workspace_engine_interpretation_outcome_unknown");
    }
    return { call, response };
  }

  async function restoreCheckpoints() {
    const completed = new Set<string>(), known = new Map(args.clusters.map(cluster => [cluster.cluster_id, cluster]));
    let after: string | null = null;
    for (;;) {
      await args.heartbeat("interpreting");
      const page = await store.checkpoints({ database, lease, after_artifact_id: after, limit: 32 });
      if (page.items.length > 32 || !page.done && (!page.items.length || page.next_artifact_id !== page.items.at(-1)?.artifact_id))
        return fail("workspace_engine_interpretation_checkpoint_invalid");
      for (const item of page.items) {
        if (after !== null && item.artifact_id <= after || !Number.isSafeInteger(item.size_bytes)
          || item.size_bytes <= 0 || item.size_bytes > 2 * 1024 * 1024 || item.media_type !== "application/json")
          return fail("workspace_engine_interpretation_checkpoint_invalid");
        after = item.artifact_id;
        const path = join(args.directory, `checkpoint-${proposals.length}.json`);
        await storage.get({ workspace_id: lease.workspace_id, execution_id: lease.execution_id, stored: item, destination: path });
        if ((await stat(path)).size !== item.size_bytes) return fail("workspace_engine_interpretation_checkpoint_invalid");
        const bytes = await readFile(path);
        if (sha(bytes) !== item.sha256) return fail("workspace_engine_interpretation_checkpoint_invalid");
        try {
          const packet = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
          if (!packet || typeof packet !== "object" || Array.isArray(packet)
            || Object.keys(packet).some(key => !["contract_version", "execution_id", "context", "clusters", "interpretations", "editorial_repair"].includes(key))
            || packet.contract_version !== "workspace-engine-interpretation-result-v1" || packet.execution_id !== lease.execution_id
            || signalWorkspaceEmbeddingDigestV1(packet.context) !== signalWorkspaceEmbeddingDigestV1(context.context)) throw new Error();
          const historicalConfiguration = parseSignalWorkspaceInterpretationConfigurationV1(item.call_configuration);
          const authorizedConfiguration = item.interpretation_revision_digest === null
            ? lease.snapshot.interpretation_config?.call_configuration
            : item.interpretation_revision_digest === lease.interpretation_revision_digest ? config.call_configuration : null;
          if (!authorizedConfiguration || signalWorkspaceEmbeddingDigestV1(historicalConfiguration)
            !== signalWorkspaceEmbeddingDigestV1(authorizedConfiguration)) throw new Error();
          let batch = buildSignalWorkspaceInterpretationBatchV1(packet.context, packet.clusters, historicalConfiguration);
          if (packet.editorial_repair !== undefined) {
            const repair = parseSignalWorkspaceInterpretationEditorialRepairV1(packet.editorial_repair);
            const rebuilt = buildSignalWorkspaceInterpretationRepairBatchV1(batch, repair);
            if (signalWorkspaceEmbeddingDigestV1(rebuilt.editorial_repair) !== signalWorkspaceEmbeddingDigestV1(repair)) throw new Error();
            batch = rebuilt;
          }
          const unitKeys = batch.clusters.map(cluster => cluster.cluster_id);
          if (JSON.stringify(unitKeys) !== JSON.stringify(item.unit_keys)) throw new Error();
          for (const cluster of batch.clusters) {
            if (completed.has(cluster.cluster_id) || !known.has(cluster.cluster_id)
              || signalWorkspaceEmbeddingDigestV1(cluster) !== signalWorkspaceEmbeddingDigestV1(known.get(cluster.cluster_id))) throw new Error();
          }
          // Stored proposals already contain canonical SHA citations. Provider
          // aliases never grant authority to a historical artifact or its text.
          validateSignalWorkspaceInterpretationResultV1(batch, { interpretations: packet.interpretations });
          for (const key of unitKeys) completed.add(key);
        } catch { return fail("workspace_engine_interpretation_checkpoint_invalid"); }
        proposals.push({ artifact_id: item.artifact_id, file: path });
      }
      if (page.done) return completed;
    }
  }

  async function put(filename: string, content: Uint8Array | string) {
    const path = join(args.directory, filename);
    await writeFile(path, content, { flag: "wx", mode: 0o600 });
    return storage.put({ workspace_id: lease.workspace_id, execution_id: lease.execution_id, file: path,
      sha256: sha(content), size_bytes: typeof content === "string" ? Buffer.byteLength(content) : content.byteLength,
      media_type: "application/json" });
  }
}

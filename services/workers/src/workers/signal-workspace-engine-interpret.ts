import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readSignalWorkspaceEngineInterpretationContextV1, checkpointSignalWorkspaceEngineFitV1,
  reserveSignalWorkspaceEngineInterpretationV1, markSignalWorkspaceEngineInterpretationSentV1,
  persistSignalWorkspaceEngineInterpretationResponseV1, settleSignalWorkspaceEngineInterpretationV1,
  failSignalWorkspaceEngineInterpretationV1, checkpointSignalWorkspaceEngineInterpretationV1,
  readSignalWorkspaceEngineInterpretationCheckpointsV1, readSignalWorkspaceEngineInterpretationRecoveryRequestDigestsV1,
  readSignalWorkspaceEngineInterpretationExceptionsV1, quarantineSignalWorkspaceEngineInterpretationBatchV1,
  materializeSignalWorkspaceEngineTopicsV1, persistSignalWorkspaceEngineArtifactV1, completeSignalWorkspaceEngineAnalysisV1,
  completeSignalWorkspaceEngineAnalysisWithExceptionsV1,
  type SignalWorkspaceEngineDatabaseV1, type SignalWorkspaceEngineLeaseV1, type SignalWorkspaceEngineFitArgsV1,
} from "@noisia/db";
import { batchSignalWorkspaceInterpretationV1, signalWorkspaceInterpretationUniverseDigestV1,
  signalWorkspaceEmbeddingDigestV1, buildSignalWorkspaceInterpretationRepairBatchV1, buildSignalWorkspaceInterpretationBatchV1,
  parseSignalWorkspaceInterpretationConfigurationV1,
  validateSignalWorkspaceInterpretationResultV1, parseSignalWorkspaceInterpretationEditorialRepairV1,
  SignalWorkspaceInterpretationErrorV1,
  type SignalWorkspaceInterpretationBatchV1, type SignalWorkspaceInterpretationClusterV1 } from "@noisia/query-engine";
import { sendWorkspaceInterpretationV1 } from "../providers/workspace-interpretation";
import { executeWorkspaceInterpretationBatchV1 } from "./signal-workspace-interpretation-batch";
import type { WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";

const stores = {
  context: readSignalWorkspaceEngineInterpretationContextV1, fit: checkpointSignalWorkspaceEngineFitV1,
  reserve: reserveSignalWorkspaceEngineInterpretationV1, sent: markSignalWorkspaceEngineInterpretationSentV1,
  response: persistSignalWorkspaceEngineInterpretationResponseV1, settle: settleSignalWorkspaceEngineInterpretationV1,
  fail: failSignalWorkspaceEngineInterpretationV1, checkpoint: checkpointSignalWorkspaceEngineInterpretationV1,
  checkpoints: readSignalWorkspaceEngineInterpretationCheckpointsV1,
  recoverable: readSignalWorkspaceEngineInterpretationRecoveryRequestDigestsV1,
  exceptions: readSignalWorkspaceEngineInterpretationExceptionsV1,
  quarantine: quarantineSignalWorkspaceEngineInterpretationBatchV1,
  materialize: materializeSignalWorkspaceEngineTopicsV1, persist: persistSignalWorkspaceEngineArtifactV1,
  complete: completeSignalWorkspaceEngineAnalysisV1, completePartial: completeSignalWorkspaceEngineAnalysisWithExceptionsV1,
};
const sha = (bytes: Uint8Array | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (code: string): never => { throw new Error(code); };
function* recoverableSignalWorkspaceInterpretationBatchesV1(
  context:Parameters<typeof batchSignalWorkspaceInterpretationV1>[0],values:Iterable<SignalWorkspaceInterpretationClusterV1>,
  configuration:Parameters<typeof batchSignalWorkspaceInterpretationV1>[2],
):Generator<SignalWorkspaceInterpretationBatchV1>{
  let pending:SignalWorkspaceInterpretationClusterV1[]=[];
  for(const value of values){
    if(pending.length){
      try{buildSignalWorkspaceInterpretationBatchV1(context,[...pending,value],configuration);}
      catch(error){
        if(!(error instanceof SignalWorkspaceInterpretationErrorV1)
          ||!['workspace_engine_interpretation_batch_capacity_exceeded','workspace_engine_interpretation_batch_invalid'].includes(error.code))throw error;
        yield buildSignalWorkspaceInterpretationBatchV1(context,pending,configuration);pending=[];
      }
    }
    if(!pending.length){
      try{buildSignalWorkspaceInterpretationBatchV1(context,[value],configuration);}
      catch(error){
        if(error instanceof SignalWorkspaceInterpretationErrorV1
          &&error.code==='workspace_engine_interpretation_batch_capacity_exceeded')continue;
        throw error;
      }
    }
    pending.push(value);
  }
  if(pending.length)yield buildSignalWorkspaceInterpretationBatchV1(context,pending,configuration);
}

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
  const executeBatch=(batch:SignalWorkspaceInterpretationBatchV1)=>executeWorkspaceInterpretationBatchV1({
    database,execution:lease,config,batch,actor_user_id:context.actor_user_id,directory:args.directory,storage,stores:store,
    send:args.send,api_key:args.api_key,provider_enabled:args.provider_enabled,authorization_expires_at:args.authorization_expires_at,
  });
  const proposals: Array<{ artifact_id: string; file: string }> = [];
  const completedUnits = await restoreCheckpoints();
  const isolatedUnits = new Set<string>();
  for(const exception of await store.exceptions({database,lease}))for(const key of exception.unit_keys){
    if(completedUnits.has(key)||isolatedUnits.has(key))return fail("workspace_engine_interpretation_exception_invalid");
    isolatedUnits.add(key);completedUnits.add(key);
  }
  const recoveryRequests=new Set(await store.recoverable({database,lease}));
  // Finish already-started logical requests before validating any unrelated
  // future send. This tolerant planner can cross an individually oversized
  // legacy group. It only enters batches whose digest is in the DB ledger;
  // their single protocol-bound editorial repair may be created here because
  // an invalid paid receipt cannot become a checkpoint or release the legacy
  // contract without it. The repair still requires the existing DB authority,
  // cap and source receipt. New corpus batches wait for the complete preflight.
  // The historical context contract stays fixed for this invocation; after
  // these receipts become checkpoints, a later retry may safely promote to
  // the bounded context without losing the original request digest.
  for(const batch of recoverableSignalWorkspaceInterpretationBatchesV1(context.context,
    args.clusters.filter(cluster=>!completedUnits.has(cluster.cluster_id)),configuration)){
    if(!recoveryRequests.has(batch.request_digest))continue;
    const recovered=await processBatch(batch);
    for(const key of recovered)completedUnits.add(key);
  }
  const remaining = args.clusters.filter(cluster => !completedUnits.has(cluster.cluster_id));
  // Validate the complete pending plan before reserving or sending its first
  // batch. A late oversized group must never leave an avoidable partially paid
  // execution merely because the generator had not reached it yet.
  let plannedBatches=0;
  for(const _batch of batchSignalWorkspaceInterpretationV1(context.context,remaining,configuration)){
    plannedBatches++;if(plannedBatches%32===0)await args.heartbeat("interpreting");
  }
  for (const originalBatch of batchSignalWorkspaceInterpretationV1(context.context, remaining, configuration)) {
    await processBatch(originalBatch);
  }
  if(isolatedUnits.size){await args.heartbeat("materializing");return store.completePartial({database,lease});}
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

  async function processBatch(originalBatch:SignalWorkspaceInterpretationBatchV1){
    await args.heartbeat("interpreting");
    if (signalWorkspaceEmbeddingDigestV1(originalBatch.configuration) !== signalWorkspaceEmbeddingDigestV1(config.call_configuration))
      return fail("workspace_engine_interpretation_config_mismatch");
    let batch = originalBatch;
    let { call, response } = await executeBatch(batch);
    const originalCall=call,originalResponse=response;
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
      if (!response.interpretations || response.outcome !== "validated") {
        if(response.outcome!=="known_response_invalid"||response.error_code!=="workspace_engine_interpretation_output_invalid"
          ||originalCall.state!=="settled"||call.state!=="settled"||!originalCall.response?.complete||!call.response?.complete
          ||originalCall.response.sha256!==originalResponse.receipt_sha256||call.response.sha256!==response.receipt_sha256)
          return fail("workspace_engine_interpretation_repair_invalid");
        const unitKeys=originalBatch.clusters.map(item=>item.cluster_id);
        await store.quarantine({database,lease,original_call_id:originalCall.call_id,repair_call_id:call.call_id,
          original_request_digest:originalCall.request_digest,repair_request_digest:call.request_digest,
          original_response_sha256:originalCall.response.sha256,repair_response_sha256:call.response.sha256,
          batch_digest:signalWorkspaceEmbeddingDigestV1(originalBatch),unit_keys:unitKeys,
          validator_version:"workspace-interpretation-validator-v1"});
        for(const key of unitKeys)isolatedUnits.add(key);
        return unitKeys;
      }
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
    return batch.clusters.map(item=>item.cluster_id);
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
            || !packet.context || typeof packet.context !== "object" || Array.isArray(packet.context)
            || packet.context.workspace_id !== context.context.workspace_id
            || packet.context.execution_id !== context.context.execution_id
            || packet.context.context_digest !== context.context.context_digest) throw new Error();
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
          // Historical packets keep their original context projection. Its
          // request digest remains sealed by the settled provider call while
          // the authority digest above must still match the current workspace.
          if (batch.request_digest !== item.request_digest) throw new Error();
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

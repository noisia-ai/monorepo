import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  verifyMassLabelingSourceCheckpointsV1,
  reserveSignalWorkspaceEngineInterpretationV1,
  markSignalWorkspaceEngineInterpretationSentV1,
  persistSignalWorkspaceEngineInterpretationResponseV1,
  settleSignalWorkspaceEngineInterpretationV1,
  failSignalWorkspaceEngineInterpretationV1,
  persistSignalWorkspaceEngineArtifactV1,
  type SignalWorkspaceEngineDatabaseV1,
  type SignalWorkspaceEngineLeaseV1,
  type SignalWorkspaceEngineInterpretationCallV1,
} from "@noisia/db";
import {
  buildMassLabelingConsolidationRequestV1,
  parseMassLabelingConsolidationResponseV1,
  massLabelingConsolidationUsageV1,
  signalWorkspaceEmbeddingDigestV1 as digest,
  type MassLabelingConsolidationOutputV1,
} from "@noisia/query-engine";
import { sendMassLabelingConsolidationV1 } from "../providers/mass-labeling-consolidation";
import { WorkspaceInterpretationTransportErrorV1 } from "../providers/workspace-interpretation";
import type { WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";

const stores = {
  verifySources: verifyMassLabelingSourceCheckpointsV1,
  reserve: reserveSignalWorkspaceEngineInterpretationV1,
  sent: markSignalWorkspaceEngineInterpretationSentV1,
  response: persistSignalWorkspaceEngineInterpretationResponseV1,
  settle: settleSignalWorkspaceEngineInterpretationV1,
  fail: failSignalWorkspaceEngineInterpretationV1,
  persist: persistSignalWorkspaceEngineArtifactV1,
};
const sha = (bytes: Uint8Array | string) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const invalid = (): never => {
  throw new Error("workspace_engine_mass_consolidation_invalid");
};

/** This stage shares the active engine lease and its budget, while its request
 * seal and raw receipt identify the global summary protocol independently. */
export async function consolidateMassLabelingGroupsV1(args: {
  database: SignalWorkspaceEngineDatabaseV1;
  lease: SignalWorkspaceEngineLeaseV1;
  actor_user_id: string;
  proposals: Array<{ artifact_id: string; file: string }>;
  expected_group_ids: string[];
  expected_cluster_digests: Record<string, string>;
  directory: string;
  storage: WorkspaceEngineStorageV1;
  stores?: typeof stores;
  send?: typeof sendMassLabelingConsolidationV1;
  recovery_only?: boolean;
  recovery_call?: SignalWorkspaceEngineInterpretationCallV1;
  api_key?: string;
  provider_enabled?: boolean;
}): Promise<{
  artifact_id: string;
  output: MassLabelingConsolidationOutputV1;
}> {
  const { database, lease, storage } = args,
    store = args.stores ?? stores;
  const config =
    lease.effective_interpretation_config ??
    lease.snapshot.interpretation_config;
  if (
    !config ||
    !("consolidation_contract_version" in config.call_configuration)
  )
    return invalid();
  const source_checkpoints = await Promise.all(
    args.proposals.map(async (proposal) => ({
      artifact_id: proposal.artifact_id,
      body: await readFile(proposal.file, "utf8"),
    })),
  );
  // Verify paid checkpoint bytes and the entire selected numerical lane before
  // reserving any global call. Only reconstructed summaries enter the request.
  const verified = await store.verifySources({
    database,
    workspace_id: lease.workspace_id,
    actor_user_id: args.actor_user_id,
    source_engine_execution_id: lease.execution_id,
    lease,
    source_checkpoints,
    expected_group_ids: args.expected_group_ids,
    expected_cluster_digests: args.expected_cluster_digests,
  });
  const batch = buildMassLabelingConsolidationRequestV1({
    workspace_id: lease.workspace_id,
    source_engine_execution_id: lease.execution_id,
    source_groups: verified.source_groups,
  });
  if (verified.source_groups_digest !== batch.source_groups_digest)
    return invalid();
  if (digest(batch.configuration) !== digest(config.call_configuration))
    return invalid();
  if (args.recovery_call && (!args.recovery_only || args.recovery_call.workspace_id !== lease.workspace_id
    || args.recovery_call.execution_id !== lease.execution_id || args.recovery_call.request_digest !== batch.request_digest
    || !args.recovery_call.response || args.recovery_call.editorial_repair)) return invalid();
  if (args.recovery_only && !args.recovery_call)
    throw new Error("workspace_engine_interpretation_receipt_recovery_required");
  await storage.assertReady?.();
  const reservation = {
    database,
    workspace_id: lease.workspace_id,
    actor_user_id: args.actor_user_id,
    execution_id: lease.execution_id,
    idempotency_key: `mass-map:${batch.request_digest.slice(7)}`,
    request_digest: batch.request_digest,
    configuration: batch.configuration,
    reserved_micro_usd: batch.reserved_micro_usd,
    budget_timezone: config.budget_timezone,
    daily_cap_micro_usd: config.daily_cap_micro_usd,
    execution_token: lease.execution_token,
    ...(lease.interpretation_revision_digest
      ? { interpretation_revision_digest: lease.interpretation_revision_digest }
      : {}),
    mass_labeling_stage: {
      stage: "global-consolidation-v1" as const,
      source_groups_digest: batch.source_groups_digest,
    },
  };
  let call = args.recovery_call ?? await store.reserve(reservation);
  if (!args.recovery_only && call.state === "terminal_confirmed" && !call.response) {
    if (call.retry_of_call_id || !Number.isSafeInteger(call.settled_micro_usd) || call.settled_micro_usd === null
      || call.settled_micro_usd < 0)
      throw new Error("workspace_engine_interpretation_retry_unavailable");
    call = await store.reserve({ ...reservation,
      idempotency_key: `${reservation.idempotency_key}:retry:${call.call_id}`, retry_of_call_id: call.call_id });
    if (call.state === "terminal_confirmed" || call.state === "definitely_not_sent")
      throw new Error("workspace_engine_interpretation_transport_retry_exhausted");
  }
  const attempt = {
    database,
    call_id: call.call_id,
    attempt_token: call.attempt_token,
  };
  const responsePath = join(
    args.directory,
    `mass-consolidation-response-${call.call_id}.json`,
  );
  let raw: string;
  if (call.response) {
    await storage.get({
      workspace_id: lease.workspace_id,
      execution_id: lease.execution_id,
      stored: { ...call.response, media_type: "application/json" },
      destination: responsePath,
    });
    const bytes = await readFile(responsePath);
    if (
      sha(bytes) !== call.response.sha256 ||
      !call.response.complete ||
      call.response.http_status !== 200
    )
      return invalid();
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } else if (call.state === "reserved") {
    try {
      const receipt = await (args.send ?? sendMassLabelingConsolidationV1)({
        batch,
        api_key: args.api_key ?? process.env.ANTHROPIC_API_KEY ?? "",
        enabled:
          args.provider_enabled ??
          process.env.NOISIA_WORKSPACE_INTERPRETATION_ENABLED === "true",
        authorize_send: async () =>
          (
            await store.sent({
              ...attempt,
              execution_token: lease.execution_token,
            })
          ).send_authorized,
        persist_receipt: async (receipt) => {
          await writeFile(responsePath, receipt.bytes, { mode: 0o600 });
          const stored = await storage.put({
            workspace_id: lease.workspace_id,
            execution_id: lease.execution_id,
            file: responsePath,
            sha256: receipt.sha256,
            size_bytes: receipt.bytes.length,
            media_type: "application/json",
          });
          await store.response({
            ...attempt,
            response: {
              ...stored,
              http_status: receipt.http_status,
              provider_request_id: receipt.provider_request_id,
              complete: receipt.complete,
            },
          });
        },
      });
      if (!receipt.complete || receipt.http_status !== 200) return invalid();
      raw = new TextDecoder("utf-8", { fatal: true }).decode(receipt.bytes);
    } catch (error) {
      // A failed send CAS belongs to another attempt. Preserve its exact state
      // and exposure, including a response that may have arrived meanwhile.
      if (
        error instanceof WorkspaceInterpretationTransportErrorV1 &&
        error.message ===
          "workspace_engine_mass_consolidation_send_not_authorized"
      )
        throw error;
      const outcome =
        error instanceof WorkspaceInterpretationTransportErrorV1
          ? error.outcome
          : "outcome_unknown";
      await store
        .fail({
          ...attempt,
          outcome,
          error_code: "workspace_engine_mass_consolidation_transport_failed",
        })
        .catch(() => undefined);
      throw error;
    }
  } else {
    throw new Error(
      "workspace_engine_interpretation_receipt_recovery_required",
    );
  }
  const usage = massLabelingConsolidationUsageV1(raw);
  if (!usage) {
    await store.fail({
      ...attempt,
      outcome: "outcome_unknown",
      error_code: "workspace_engine_mass_consolidation_invalid",
    });
    return invalid();
  }
  // Known usage is settled even if a later schema/coverage check rejects output.
  await store.settle({ ...attempt, usage });
  const { output } = parseMassLabelingConsolidationResponseV1(batch, raw);
  const content = JSON.stringify({
    contract_version: "workspace-mass-labeling-consolidation-v1",
    workspace_id: lease.workspace_id,
    source_engine_execution_id: lease.execution_id,
    source_groups: batch.source_groups,
    source_groups_digest: batch.source_groups_digest,
    raw_response: raw,
    output,
  });
  const file = join(args.directory, "mass-labeling-consolidation.json");
  await writeFile(file, content, { mode: 0o600 });
  const stored = await storage.put({
    workspace_id: lease.workspace_id,
    execution_id: lease.execution_id,
    file,
    sha256: sha(content),
    size_bytes: Buffer.byteLength(content),
    media_type: "application/json",
  });
  const artifact = await store.persist({
    database,
    lease,
    artifact: {
      ...stored,
      artifact_key: "mass-labeling-consolidation.json",
      artifact_type: "engine_proposals",
      title: "Consolidated pilot topic map",
      metadata: {
        contract_version: "workspace-mass-labeling-consolidation-v1",
        source_engine_execution_id: lease.execution_id,
        source_groups_digest: batch.source_groups_digest,
        call_id: call.call_id,
        request_digest: batch.request_digest,
        response_sha256: sha(raw),
        stage: "global-consolidation-v1",
      },
    },
  });
  return { artifact_id: artifact.artifact_id, output };
}

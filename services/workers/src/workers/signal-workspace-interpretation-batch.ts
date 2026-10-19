import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
 reserveSignalWorkspaceEngineInterpretationV1, markSignalWorkspaceEngineInterpretationSentV1,
 persistSignalWorkspaceEngineInterpretationResponseV1, settleSignalWorkspaceEngineInterpretationV1,
 failSignalWorkspaceEngineInterpretationV1, SignalWorkspaceEngineInterpretationError,
 type SignalWorkspaceEngineDatabaseV1, type SignalWorkspaceEngineLeaseV1,
} from "@noisia/db";
import { signalWorkspaceEmbeddingDigestV1, type SignalWorkspaceInterpretationBatchV1 } from "@noisia/query-engine";
import { sendWorkspaceInterpretationV1, validateWorkspaceInterpretationReceiptV1, WorkspaceInterpretationTransportErrorV1,
 type WorkspaceInterpretationResponseV1, type WorkspaceInterpretationSendDecisionV1 } from "../providers/workspace-interpretation";
import type { WorkspaceEngineStorageV1 } from "./signal-workspace-engine-storage";

const stores={ reserve:reserveSignalWorkspaceEngineInterpretationV1, sent:markSignalWorkspaceEngineInterpretationSentV1,
 response:persistSignalWorkspaceEngineInterpretationResponseV1, settle:settleSignalWorkspaceEngineInterpretationV1,
 fail:failSignalWorkspaceEngineInterpretationV1 };
const sha=(bytes:Uint8Array|string)=>`sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail=(code:string):never=>{throw new Error(code);};
export type WorkspaceInterpretationBatchExecutionV1={
 database:SignalWorkspaceEngineDatabaseV1;
 execution:Pick<SignalWorkspaceEngineLeaseV1,"execution_id"|"workspace_id"|"execution_token"|"interpretation_revision_digest"> & {interpretation_admission?:{operation_id:string}|null};
 actor_user_id:string;
 config:NonNullable<SignalWorkspaceEngineLeaseV1["snapshot"]["interpretation_config"]>;
 batch:SignalWorkspaceInterpretationBatchV1; directory:string; storage:WorkspaceEngineStorageV1;
 stores?:typeof stores; send?:typeof sendWorkspaceInterpretationV1;
 api_key?:string; provider_enabled?:boolean; authorization_expires_at?:string;
};

/** Execute one sealed editorial request with the existing cost/receipt protocol.
 * This helper has no fit, source discovery, claim, checkpoint or catalog action.
 * The DB stores remain the authority for the caller's execution and permission.
 * Callers own immutable batch planning and the single editorial repair limit. */
export async function executeWorkspaceInterpretationBatchV1(args:WorkspaceInterpretationBatchExecutionV1){
 const {database,execution:lease,config,batch,storage}=args,store=args.stores??stores;
 if(signalWorkspaceEmbeddingDigestV1(batch.configuration)!==signalWorkspaceEmbeddingDigestV1(config.call_configuration))
  return fail("workspace_engine_interpretation_config_mismatch");
  const reservation = { database, workspace_id: lease.workspace_id, execution_id: lease.execution_id,
    actor_user_id: args.actor_user_id, execution_token: lease.execution_token,
    idempotency_key: batch.batch_key, request_digest: batch.request_digest, configuration: config.call_configuration,
    reserved_micro_usd: batch.reserved_micro_usd, budget_timezone: config.budget_timezone, daily_cap_micro_usd: config.daily_cap_micro_usd,
    ...(lease.interpretation_revision_digest ? { interpretation_revision_digest: lease.interpretation_revision_digest } : {}),
    ...(lease.interpretation_admission ? { admission_operation_id: lease.interpretation_admission.operation_id } : {}),
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
        // A prior reservation keeps its own admission receipt. The current
        // lease authorizes new reservations, never changes an old call's date.
        authorization_expires_at: call.admission?.admission_not_after
          ?? args.authorization_expires_at ?? process.env.NOISIA_WORKSPACE_INTERPRETATION_AUTHORIZED_UNTIL,
        authorize_send: async (): Promise<WorkspaceInterpretationSendDecisionV1> => {
          try { return (await store.sent({ ...attempt, execution_token: lease.execution_token })).send_authorized; }
          catch (error) {
            if (error instanceof SignalWorkspaceEngineInterpretationError && error.status === 409) {
              if (error.code === "workspace_engine_interpretation_daily_authority_expired") return "daily_authority_expired";
              if (error.code === "workspace_engine_interpretation_admission_revoked") return "admission_revoked";
              if (error.code === "workspace_engine_interpretation_admission_changed") return "admission_changed";
            }
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

  async function put(filename: string, content: Uint8Array | string) {
    const path = join(args.directory, filename);
    await writeFile(path, content, { flag: "wx", mode: 0o600 });
    return storage.put({ workspace_id: lease.workspace_id, execution_id: lease.execution_id, file: path,
      sha256: sha(content), size_bytes: typeof content === "string" ? Buffer.byteLength(content) : content.byteLength,
      media_type: "application/json" });
  }
}

import { readFile } from "node:fs/promises";
import {
  beginSignalWorkspaceMassLabelingEngineV1,
  loadSignalWorkspaceEnginePreflightV1,
  loadSignalWorkspaceEngineStatusV1,
  initializeSignalWorkspaceTopicPrototypeCatalogV1,
  retrySignalWorkspaceEngineV1,
  assertSignalWorkspaceMassLabelingRecoveryReadyV1,
  loadSignalWorkspaceInterpretationAdmissionV1,
  authorizeSignalWorkspaceInterpretationAdmissionV1,
  recordSignalWorkspaceEngineInsufficiencyDecisionV1,
  recordSignalWorkspaceMassLabelingGlobalReceiptDecisionV1,
  readSignalWorkspaceMassLabelingGlobalReceiptDecisionV1,
} from "../../infrastructure/db/index";
import { assertMassLabelingEditorialAccessV1 } from "../../services/workers/src/providers/mass-labeling-consolidation";
import { SIGNAL_WORKSPACE_MASS_LABELING_MULTILINGUAL_CONFIGURATION_V1, parseMassLabelingConsolidationRecoveryDecisionV1, type SignalWorkspaceInterpretationBatchV1, type MassLabelingConsolidationBatchV1 } from "../../packages/query-engine/src/index";

/** Operator-only CLI. Supply private identity/receipt JSON on stdin and redirect
 * stdout to private storage. The existing guard accepts only the MFP target. */
async function main() {
  const action = process.argv[2];
  if (
    ![
      "initialize",
      "preflight",
      "fit",
      "editorial",
      "status",
      "admission",
      "authorize",
      "execute",
      "recover",
      "mark-insufficient",
      "decide-global-receipt",
    ].includes(action ?? "")
  )
    throw new Error("mass_engine_action_invalid");
  const encoded = await readFile("/dev/stdin", "utf8");
  const maximumInputBytes = action === "decide-global-receipt" ? 128 * 1024 * 1024
    : action === "mark-insufficient" ? 2 * 1024 * 1024 : 16384;
  if (Buffer.byteLength(encoded) > maximumInputBytes)
    throw new Error("mass_engine_input_invalid");
  const input: Record<string, unknown> = JSON.parse(encoded);
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
  const keys = [
    "workspace_id",
    "actor_user_id",
    "idempotency_key",
    "execution_id",
    "cap_micro_usd",
    "budget_timezone",
    "daily_cap_micro_usd",
    "admission_not_after",
    "expected_admission_operation_id",
    ...(action === "mark-insufficient" ? ["exception_id", "unit_key", "original_response_sha256", "repair_response_sha256",
      "reason", "batch", "original_response", "repair_response"] : []),
    ...(action === "decide-global-receipt" ? ["call_id", "request_digest", "response_sha256", "source_groups_digest",
      "decision", "batch", "raw_response", "source_checkpoints"] : []),
  ];
  if (
    !input ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !keys.includes(key)) ||
    !uuid.test(String(input.workspace_id)) ||
    !uuid.test(String(input.actor_user_id))
  )
    throw new Error("mass_engine_input_invalid");
  const { openDatabase } = await import(
    new URL("./guard.mjs", import.meta.url).href
  );
  const database = await openDatabase();
  try {
    const access = {
      database,
      workspace_id: String(input.workspace_id),
      actor_user_id: String(input.actor_user_id),
    };
    const key = String(input.idempotency_key ?? "");
    const scope = { ...access, execution_id: String(input.execution_id ?? "") };
    let result: unknown;
    if (action === "initialize")
      result = await initializeSignalWorkspaceTopicPrototypeCatalogV1(access);
    else if (action === "preflight")
      result = await loadSignalWorkspaceEnginePreflightV1(access);
    else if (action === "status")
      result = await loadSignalWorkspaceEngineStatusV1(access);
    else if (action === "admission")
      result = await loadSignalWorkspaceInterpretationAdmissionV1(scope);
    else if (action === "decide-global-receipt") {
      if (!uuid.test(scope.execution_id) || !uuid.test(String(input.call_id))
        || ![input.request_digest, input.response_sha256, input.source_groups_digest].every(value => /^sha256:[0-9a-f]{64}$/u.test(String(value)))
        || typeof input.raw_response !== "string" || !Array.isArray(input.source_checkpoints)
        || input.source_checkpoints.some(value => {
          if (!value || typeof value !== "object" || Array.isArray(value)) return true;
          const checkpoint = value as Record<string, unknown>;
          return !uuid.test(String(checkpoint.artifact_id)) || typeof checkpoint.body !== "string";
        }))
        throw new Error("mass_engine_input_invalid");
      result = await recordSignalWorkspaceMassLabelingGlobalReceiptDecisionV1({ ...scope,
        call_id: String(input.call_id), request_digest: String(input.request_digest), response_sha256: String(input.response_sha256),
        source_groups_digest: String(input.source_groups_digest), decision: parseMassLabelingConsolidationRecoveryDecisionV1(input.decision),
        batch: input.batch as MassLabelingConsolidationBatchV1, raw_response: input.raw_response,
        source_checkpoints: input.source_checkpoints as Array<{artifact_id: string; body: string}> });
    } else if (action === "mark-insufficient") {
      if (!uuid.test(scope.execution_id) || !uuid.test(String(input.exception_id))
        || input.reason !== "missing_general_citations" || typeof input.original_response !== "string"
        || typeof input.repair_response !== "string" || typeof input.unit_key !== "string"
        || !/^sha256:[0-9a-f]{64}$/u.test(String(input.original_response_sha256))
        || !/^sha256:[0-9a-f]{64}$/u.test(String(input.repair_response_sha256)))
        throw new Error("mass_engine_input_invalid");
      result = await recordSignalWorkspaceEngineInsufficiencyDecisionV1({ ...scope,
        exception_id: String(input.exception_id), unit_key: input.unit_key,
        original_response_sha256: String(input.original_response_sha256),
        repair_response_sha256: String(input.repair_response_sha256), reason: input.reason,
        batch: input.batch as SignalWorkspaceInterpretationBatchV1,
        original_response: input.original_response, repair_response: input.repair_response });
    } else if (action === "execute" || action === "recover") {
      const { signalWorkspaceEngineJobV1 } = await import(
        new URL(
          "../../services/workers/src/workers/signal-workspace-engine.ts",
          import.meta.url,
        ).href
      );
      const { interpretWorkspaceEngineV1 } = await import(
        new URL(
          "../../services/workers/src/workers/signal-workspace-engine-interpret.ts",
          import.meta.url,
        ).href
      );
      const loadOwner = async () =>
        (
          await database.query(
            `SELECT execution.id,execution.status,outbox.worker_job_id,
        execution.input_snapshot ? 'interpretation_config' paid FROM signal_topic_catalog_executions execution
        JOIN signal_topic_classification_outbox outbox ON outbox.execution_id=execution.id AND outbox.dispatch_kind='execution'
        WHERE execution.id=$1::uuid AND execution.workspace_id=$2::uuid AND execution.actor_user_id=$3::uuid`,
            [scope.execution_id, access.workspace_id, access.actor_user_id],
          )
        ).rows[0];
      let owner = await loadOwner();
      if (!owner) throw new Error("mass_engine_execution_unavailable");
      if (action === "recover") {
        const recovery=await assertSignalWorkspaceMassLabelingRecoveryReadyV1(scope);
        if (!recovery.pilot) throw new Error("workspace_engine_interpretation_fit_required");
      }
      if (action === "execute" && owner.paid && owner.status !== "ready")
        await assertMassLabelingEditorialAccessV1({
          api_key: process.env.ANTHROPIC_API_KEY ?? "",
          enabled:
            process.env.NOISIA_WORKSPACE_INTERPRETATION_ENABLED === "true",
        });
      if (owner.status === "failed") {
        await retrySignalWorkspaceEngineV1({ ...scope, idempotency_key: key });
        owner = await loadOwner();
      }
      if (action === "recover" && owner.status === "ready") {
        const decision = await readSignalWorkspaceMassLabelingGlobalReceiptDecisionV1(scope);
        result = { execution_id: scope.execution_id, status: "ready", replayed: true,
          ...(decision ? { global_receipt_decision_id: decision.decision_id,
            global_receipt_decision_digest: decision.decision_digest } : {}) };
      } else result = await signalWorkspaceEngineJobV1(
        {
          id: owner.worker_job_id,
          data: { execution_id: scope.execution_id },
          updateProgress: async () => {},
        },
        {
          database,
          mass_operator:{recovery_only:action==="recover",api_key:process.env.ANTHROPIC_API_KEY,
            enabled:process.env.NOISIA_WORKSPACE_INTERPRETATION_ENABLED==="true"},
          interpret: (args: Record<string, unknown>) =>
            interpretWorkspaceEngineV1({
              ...args,
              recovery_only: action === "recover",
              api_key: process.env.ANTHROPIC_API_KEY,
              provider_enabled:
                action === "execute" &&
                process.env.NOISIA_WORKSPACE_INTERPRETATION_ENABLED === "true",
            }),
        },
      );
    } else if (action === "authorize") {
      if (
        !uuid.test(scope.execution_id) ||
        !Number.isSafeInteger(input.cap_micro_usd) ||
        Number(input.cap_micro_usd) <= 0 ||
        !Object.hasOwn(input, "expected_admission_operation_id") ||
        (input.expected_admission_operation_id !== null &&
          !uuid.test(String(input.expected_admission_operation_id)))
      )
        throw new Error("mass_engine_input_invalid");
      result = await authorizeSignalWorkspaceInterpretationAdmissionV1({
        ...scope,
        idempotency_key: key,
        expected_admission_operation_id:
          input.expected_admission_operation_id as string | null,
        grant_cap_micro_usd: Number(input.cap_micro_usd),
        admission_not_after: String(input.admission_not_after),
      });
    } else if (action === "fit") {
      if (input.cap_micro_usd !== undefined)
        throw new Error("mass_engine_numeric_only");
      result = await beginSignalWorkspaceMassLabelingEngineV1({
        ...access,
        idempotency_key: key,
      });
    } else {
      await assertMassLabelingEditorialAccessV1({
        api_key: process.env.ANTHROPIC_API_KEY ?? "",
        enabled: process.env.NOISIA_WORKSPACE_INTERPRETATION_ENABLED === "true",
      });
      if (
        !Number.isSafeInteger(input.cap_micro_usd) ||
        Number(input.cap_micro_usd) <= 0 ||
        !Number.isSafeInteger(input.daily_cap_micro_usd) ||
        Number(input.daily_cap_micro_usd) <= 0
      )
        throw new Error("mass_engine_budget_invalid");
      result = await beginSignalWorkspaceMassLabelingEngineV1({
        ...access,
        idempotency_key: key,
        claude_cap_micro_usd: Number(input.cap_micro_usd),
        interpretation_config: {
          call_configuration:
            SIGNAL_WORKSPACE_MASS_LABELING_MULTILINGUAL_CONFIGURATION_V1,
          daily_cap_micro_usd: Number(input.daily_cap_micro_usd),
          budget_timezone: String(input.budget_timezone ?? "UTC"),
        },
      });
    }
    process.stdout.write(JSON.stringify(result) + "\n");
  } finally {
    await database.end();
  }
}
void main().catch((error) => {
  const code =
    error instanceof Error && /^[a-z_]{3,120}$/u.test(error.message)
      ? error.message
      : "mass_engine_operation_failed";
  process.stderr.write(JSON.stringify({ error: code }) + "\n");
  process.exitCode = 1;
});

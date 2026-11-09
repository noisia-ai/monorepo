import { assertAnthropicProviderAccessV1 } from "@noisia/query-engine";
import {
  assertSignalWorkspaceMassLabelingRecoveryReadyV1,
  type SignalWorkspaceEngineDatabaseV1,
} from "@noisia/db";

export type MassEngineOperatorV1 = {
  recovery_only: boolean;
  api_key?: string;
  enabled?: boolean;
  fetch_impl?: typeof fetch;
};
/** Historical paid pilots retain their private operator. The canonical product
 * uses its native admission and current sealed actor through the normal daemon. */
export async function authorizeMassEngineConsumerV1(args: {
  database: SignalWorkspaceEngineDatabaseV1;
  execution_id: string;
  operator?: MassEngineOperatorV1;
  recovery_preflight?: typeof assertSignalWorkspaceMassLabelingRecoveryReadyV1;
}) {
  if (args.operator?.recovery_only) {
    const recovery = await (
      args.recovery_preflight ??
      assertSignalWorkspaceMassLabelingRecoveryReadyV1
    )(args);
    if (!recovery.pilot)
      throw new Error("workspace_engine_interpretation_fit_required");
    return true;
  }
  const row = (
    await args.database.query<{ paid_pilot: boolean; status?: string; product: boolean; product_actor: boolean }>(
      `SELECT status,
    input_snapshot#>>'{engine_config,profile_version}' IN ('workspace-bertopic-mass-labeling-v1','workspace-bertopic-mass-labeling-v2','workspace-bertopic-mass-labeling-v3')
      AND input_snapshot ? 'interpretation_config' paid_pilot,
    signal_mass_labeling_product_engine_v2(execution.workspace_id,execution.input_contract,execution.input_snapshot) product,
    execution.processing_admission_id IS NOT NULL
      AND signal_workspace_engine_actor_v1(execution,execution.actor_user_id) product_actor
    FROM signal_topic_catalog_executions execution WHERE id=$1::uuid`,
      [args.execution_id],
    )
  ).rows[0];
  if (row?.product) return row.product_actor === true;
  if (!row?.paid_pilot || row.status === "ready") return true;
  if (!args.operator) return false;
  if (!args.operator.recovery_only)
    await assertAnthropicProviderAccessV1({
      api_key: args.operator.api_key ?? "",
      enabled: args.operator.enabled ?? false,
      fetch_impl: args.operator.fetch_impl,
    });
  return true;
}

export async function assertMassJevConsumerV1(args: {
  api_key: string;
  enabled: boolean;
  fetch_impl?: typeof fetch;
}) {
  if (!args.enabled || !args.api_key.trim())
    throw new Error("mass_labeling_provider_unavailable");
  const response = await (args.fetch_impl ?? fetch)(
    "https://api.typesafe.ai/v1/models",
    {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${args.api_key}` },
    },
  );
  await response.body?.cancel().catch(() => undefined);
  if (response.status !== 200)
    throw new Error("mass_labeling_provider_unavailable");
}

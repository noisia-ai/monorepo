import { assertAnthropicProviderAccessV1 } from "@noisia/query-engine";
import type { SignalWorkspaceEngineDatabaseV1 } from "@noisia/db";

export type MassEngineOperatorV1 = {
  recovery_only: boolean;
  api_key?: string;
  enabled?: boolean;
  fetch_impl?: typeof fetch;
};
/** Paid pilot executions belong to an explicit operator. The daemon leaves their
 * outbox pending and cannot consume their lease with a different credential. */
export async function authorizeMassEngineConsumerV1(args: {
  database: SignalWorkspaceEngineDatabaseV1;
  execution_id: string;
  operator?: MassEngineOperatorV1;
}) {
  const row = (
    await args.database.query<{ paid_pilot: boolean; status?: string }>(
      `SELECT status,
    input_snapshot#>>'{engine_config,profile_version}'='workspace-bertopic-mass-labeling-v1'
      AND input_snapshot ? 'interpretation_config' paid_pilot
    FROM signal_topic_catalog_executions WHERE id=$1::uuid`,
      [args.execution_id],
    )
  ).rows[0];
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

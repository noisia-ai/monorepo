import type { Pool } from "pg";
import { SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1 } from "@noisia/query-engine";

export type SignalDiscoveryPolicyV1 = {
  available: boolean; policy_id: string | null; maximum_cap_micro_usd: number | null;
  daily_cap_micro_usd: number | null; budget_timezone: string;
};
export function discoveryStrictCapV1(value: number | null | undefined, maximum: number | null): number | null {
  if (value != null && (!Number.isSafeInteger(value) || value <= 0)
    || maximum != null && (!Number.isSafeInteger(maximum) || maximum <= 0)
    || value != null && maximum != null && value > maximum)
    throw new Error("workspace_analysis_interpretation_cap_invalid");
  return value ?? maximum;
}
/** The active organization policy owns strict maxima; estimates and legacy env budgets do not. */
export async function loadSignalDiscoveryPolicyV1(queryable: Pick<Pool, "query">, workspaceId: string): Promise<SignalDiscoveryPolicyV1> {
  const row = (await queryable.query<{ id: string; cap: string | null; daily: string | null; budget_timezone: string }>(`
    SELECT policy.id,action.max_execution_micro_usd::text cap,policy.daily_cap_micro_usd::text daily,policy.budget_timezone
    FROM signal_workspaces workspace JOIN signal_processing_policy_versions policy ON policy.organization_id=workspace.organization_id
    JOIN signal_processing_policy_actions action ON action.policy_version_id=policy.id AND action.action='topic_interpretation'
    WHERE workspace.id=$1::uuid AND policy.status='active' AND policy.valid_from<=clock_timestamp() AND policy.valid_until>clock_timestamp()
      AND action.provider='anthropic' AND action.model=$2 AND action.configuration=$3::jsonb`,
  [workspaceId,SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1.model,JSON.stringify(SIGNAL_WORKSPACE_INTERPRETATION_CONFIGURATION_V1)])).rows[0];
  if (!row) return { available: false, policy_id: null, maximum_cap_micro_usd: null, daily_cap_micro_usd: null, budget_timezone: "UTC" };
  const cap = row.cap === null ? null : Number(row.cap), daily = row.daily === null ? null : Number(row.daily);
  discoveryStrictCapV1(cap, daily === null ? null : Number.MAX_SAFE_INTEGER);
  if (daily !== null && (!Number.isSafeInteger(daily) || daily <= 0)) throw new Error("workspace_analysis_interpretation_cap_invalid");
  return { available: true, policy_id: row.id, maximum_cap_micro_usd: cap, daily_cap_micro_usd: daily, budget_timezone: row.budget_timezone };
}

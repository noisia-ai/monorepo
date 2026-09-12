import type { Pool, PoolClient } from "pg";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";

export const SIGNAL_PROCESSING_ACTIONS_V1 = ["brand_context_proposal", "topic_prototype_embeddings", "corpus_preparation",
  "corpus_embeddings", "topic_fit", "topic_interpretation", "topic_fit_incremental", "topic_interpretation_incremental", "topic_consolidation", "topic_consolidation_numeric"] as const;
export type SignalProcessingActionV1 = typeof SIGNAL_PROCESSING_ACTIONS_V1[number];
export type SignalProcessingExposureV1 = { confirmed_micro_usd: string; reserved_micro_usd: string;
  ambiguous_micro_usd: string; total_micro_usd: string };
export type SignalProcessingPolicyStatusV1 = "ready" | "missing" | "expired" | "revoked" | "daily_cap_exhausted" | "provider_unavailable";
export type SignalProcessingPolicyActionV1 = { action: SignalProcessingActionV1; kind: "free" | "provider";
  provider: "anthropic" | "voyage" | null; model: string | null; configuration_digest: string;
  max_execution_micro_usd: string; automatic_allowed: boolean; available: boolean };
export type SignalProcessingPolicyViewV1 = {
  contract_version: "signal-processing-policy-view-v1"; workspace_id: string; can_request_processing: boolean;
  status: SignalProcessingPolicyStatusV1;
  policy: null | { id: string; version: string; digest: string; valid_from: string; valid_until: string;
    budget_timezone: string; daily_cap_micro_usd: string };
  budget_date: string | null; exposure: SignalProcessingExposureV1; remaining_micro_usd: string;
  actions: SignalProcessingPolicyActionV1[];
};
export class SignalProcessingPolicyError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = "SignalProcessingPolicyError"; }
}
type Queryable = { query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: Row[] }> };
export type SignalProcessingActionAvailabilityV1 = Partial<Record<SignalProcessingActionV1, boolean>>;
const zero = (): SignalProcessingExposureV1 => ({ confirmed_micro_usd: "0", reserved_micro_usd: "0",
  ambiguous_micro_usd: "0", total_micro_usd: "0" });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
function scope(workspace: string, actor: string) {
  if (!uuid.test(workspace) || !uuid.test(actor)) throw new SignalProcessingPolicyError("processing_scope_invalid", 400);
}

/** Read only. Availability can disable a provider; it never supplies money or authority. */
export async function readSignalProcessingPolicyWithQueryableV1(args: { queryable: Queryable; workspace_id: string;
  actor_user_id: string; action_availability?: SignalProcessingActionAvailabilityV1 }): Promise<SignalProcessingPolicyViewV1> {
  scope(args.workspace_id, args.actor_user_id);
  const capability = await loadSignalWorkspaceCapabilitiesStoreV1(args);
  if (!capability.can_view) throw new SignalProcessingPolicyError("processing_forbidden", 403);
  type Row = { id: string; version: string; status: "draft" | "active" | "revoked"; policy_digest: string;
    valid_from: string; valid_until: string; budget_timezone: string; daily_cap_micro_usd: string;
    budget_date: string; current: boolean; exposure: SignalProcessingExposureV1;
    actions: Omit<SignalProcessingPolicyActionV1, "available">[] };
  const row = (await args.queryable.query<Row>(`
    SELECT p.id,p.version::text,p.status,p.policy_digest,p.valid_from::text,p.valid_until::text,
      p.budget_timezone,p.daily_cap_micro_usd::text,
      (clock_timestamp() AT TIME ZONE p.budget_timezone)::date::text budget_date,
      (p.status='active' AND p.valid_from<=clock_timestamp() AND p.valid_until>clock_timestamp()) current,
      jsonb_build_object('confirmed_micro_usd',e.confirmed_micro_usd::text,'reserved_micro_usd',e.reserved_micro_usd::text,
        'ambiguous_micro_usd',e.ambiguous_micro_usd::text,'total_micro_usd',e.total_micro_usd::text) exposure,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('action',a.action,'kind',a.kind,'provider',a.provider,'model',a.model,
        'configuration_digest',a.configuration_digest,'max_execution_micro_usd',a.max_execution_micro_usd::text,
        'automatic_allowed',a.automatic_allowed) ORDER BY a.action)
        FROM signal_processing_policy_actions a WHERE a.policy_version_id=p.id),'[]'::jsonb) actions
    FROM signal_workspaces w JOIN LATERAL (
      SELECT policy.* FROM signal_processing_policy_versions policy WHERE policy.organization_id=w.organization_id
        AND policy.status<>'draft' ORDER BY (policy.status='active') DESC,policy.version DESC LIMIT 1
    ) p ON true CROSS JOIN LATERAL signal_processing_org_exposure_v1(w.organization_id,
      (clock_timestamp() AT TIME ZONE p.budget_timezone)::date,p.budget_timezone) e
    WHERE w.id=$1::uuid`, [args.workspace_id])).rows[0];
  if (!row) return { contract_version: "signal-processing-policy-view-v1", workspace_id: args.workspace_id,
    can_request_processing: capability.can_request_processing, status: "missing", policy: null, budget_date: null,
    exposure: zero(), remaining_micro_usd: "0", actions: [] };
  const remaining = BigInt(row.daily_cap_micro_usd) > BigInt(row.exposure.total_micro_usd)
    ? BigInt(row.daily_cap_micro_usd) - BigInt(row.exposure.total_micro_usd) : 0n;
  const availability = args.action_availability ?? {};
  const actions = row.actions.map(action => ({ ...action, available: capability.can_request_processing && row.current
    && (action.kind === "free" || availability[action.action] === true
      && (remaining > 0n || BigInt(action.max_execution_micro_usd) === 0n)) }));
  const providerActions = row.actions.filter(action => action.kind === "provider");
  const status: SignalProcessingPolicyStatusV1 = row.status === "revoked" ? "revoked" : !row.current ? "expired"
    : remaining === 0n && providerActions.some(action => BigInt(action.max_execution_micro_usd) > 0n) ? "daily_cap_exhausted"
    : providerActions.length > 0 && providerActions.every(action => availability[action.action] !== true) ? "provider_unavailable" : "ready";
  return { contract_version: "signal-processing-policy-view-v1", workspace_id: args.workspace_id,
    can_request_processing: capability.can_request_processing, status,
    policy: { id: row.id, version: row.version, digest: row.policy_digest, valid_from: row.valid_from, valid_until: row.valid_until,
      budget_timezone: row.budget_timezone, daily_cap_micro_usd: row.daily_cap_micro_usd }, budget_date: row.budget_date,
    exposure: row.exposure, remaining_micro_usd: remaining.toString(), actions };
}
export async function loadSignalProcessingPolicyV1(args: { database: Pick<Pool, "connect">; workspace_id: string;
  actor_user_id: string; action_availability?: SignalProcessingActionAvailabilityV1 }): Promise<SignalProcessingPolicyViewV1> {
  const client = await args.database.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await readSignalProcessingPolicyWithQueryableV1({ ...args, queryable: client });
    await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
export type SignalProcessingAdmissionV1 = {
  id: string; organization_id: string; workspace_id: string; brand_id: string; actor_user_id: string;
  policy_version_id: string; action: SignalProcessingActionV1; target_id: string; idempotency_key: string;
  request_digest: string; provider: string | null; model: string | null; configuration: Record<string, unknown>;
  configuration_digest: string; execution_cap_micro_usd: string; budget_date: string; budget_timezone: string;
  admission_not_after: string; automatic: boolean; receipt_digest: string; created_at: string;
};
export type SignalProcessingAdmitArgsV1 = { workspace_id: string; actor_user_id: string; action: SignalProcessingActionV1;
  target_id: string; idempotency_key: string; request_digest: string;
  /** Server quote only; never copy this field from an unverified request body. */
  execution_cap_micro_usd: string; automatic?: boolean };
export type SignalProcessingAdmitResultV1 = { replayed: boolean; receipt: SignalProcessingAdmissionV1 };

/** Caller owns BEGIN/COMMIT and creates the run/outbox in that SAME transaction.
 * Replays are read-only receipts and do not enqueue, renew, or create capacity. */
export async function admitSignalProcessingWithClientV1(client: Pick<PoolClient, "query">,
  args: SignalProcessingAdmitArgsV1): Promise<SignalProcessingAdmitResultV1> {
  scope(args.workspace_id, args.actor_user_id);
  if (!uuid.test(args.target_id) || !(SIGNAL_PROCESSING_ACTIONS_V1 as readonly string[]).includes(args.action)
    || !/^[A-Za-z0-9._:-]{8,200}$/u.test(args.idempotency_key) || !/^sha256:[0-9a-f]{64}$/u.test(args.request_digest)
    || !/^(0|[1-9][0-9]{0,14})$/u.test(args.execution_cap_micro_usd))
    throw new SignalProcessingPolicyError("processing_request_invalid", 400);
  try {
    const result = (await client.query<{ result: SignalProcessingAdmitResultV1 }>(
      "SELECT admit_signal_processing_v1($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7::bigint,$8::boolean) result",
      [args.workspace_id, args.actor_user_id, args.action, args.target_id, args.idempotency_key, args.request_digest,
        args.execution_cap_micro_usd, args.automatic ?? false])).rows[0]?.result;
    if (!result) throw new SignalProcessingPolicyError("processing_admission_missing");
    return { ...result, receipt: { ...result.receipt, execution_cap_micro_usd: String(result.receipt.execution_cap_micro_usd) } };
  } catch (error) {
    if (error && typeof error === "object" && "message" in error && typeof error.message === "string"
      && /^processing_[a-z_]+$/u.test(error.message))
      throw new SignalProcessingPolicyError(error.message, error.message === "processing_forbidden" ? 403 : 409);
    throw error;
  }
}

/** Browser contract: no plans, source text, configuration, ledger IDs or provider switches. */
export const editorialUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v);
export const editorialQuote = (v: unknown): v is string => typeof v === "string" && /^v1\.[0-9]{10}\.[a-f0-9]{64}$/u.test(v);
export const editorialMoney = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9]\d{0,15})$/u.test(v);
export const editorialCap = (v: unknown): v is string => editorialMoney(v) && BigInt(v) > 0n && BigInt(v) <= 30_000_000n;
export const editorialKey = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9._:-]{8,200}$/u.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, expected: string[]) => Object.keys(v).sort().join() === expected.sort().join();
export type WorkspaceTopicEditorialCommandV1 =
  | { action: "authorize_editorial"; numeric_execution_id: string; quote_reference: string; confirmed_maximum_micro_usd: string }
  | { action: "retry_editorial"; numeric_execution_id: string; execution_id: string }
  | { action: "complete_catalog"; numeric_execution_id: string; execution_id: string };
export function parseWorkspaceTopicEditorialCommandV1(v: unknown): WorkspaceTopicEditorialCommandV1 | null {
  if (!object(v) || !editorialUuid(v.numeric_execution_id)) return null;
  if (v.action === "authorize_editorial" && keys(v, ["action", "numeric_execution_id", "quote_reference", "confirmed_maximum_micro_usd"])
    && editorialQuote(v.quote_reference) && editorialCap(v.confirmed_maximum_micro_usd))
    return { action: v.action, numeric_execution_id: v.numeric_execution_id, quote_reference: v.quote_reference, confirmed_maximum_micro_usd: v.confirmed_maximum_micro_usd };
  if ((v.action === "retry_editorial" || v.action === "complete_catalog") && keys(v, ["action", "numeric_execution_id", "execution_id"]) && editorialUuid(v.execution_id))
    return { action: v.action, numeric_execution_id: v.numeric_execution_id, execution_id: v.execution_id };
  return null;
}
export const editorialStates = ["not_requested", "runtime_unavailable", "access_required", "source_required", "source_stale", "policy_required",
  "policy_action_required", "budget_unavailable", "quote_expired", "ready_to_authorize", "queued", "running", "failed", "review_ready", "completed"] as const;
export type WorkspaceTopicEditorialViewV1 = {
  contract_version: "workspace-topic-editorial-view-v1"; workspace_id: string; numeric_execution_id: string;
  status: typeof editorialStates[number]; can_quote: boolean; can_retry: boolean; can_complete: boolean; activation: "not_activated";
  quote: null | { reference: string; expires_at: string; maximum_micro_usd: string; group_count: number; screening_count: number; global_count: 1 };
  execution: null | { execution_id: string; status: "queued" | "running" | "failed" | "review_ready" | "completed";
    completed_screening_count: number; expected_screening_count: number; maximum_micro_usd: string;
    confirmed_micro_usd: string; reserved_micro_usd: string; ambiguous_micro_usd: string };
};
const natural = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
export function validWorkspaceTopicEditorialViewV1(v: unknown, workspace: string, numeric: string): v is WorkspaceTopicEditorialViewV1 {
  if (!object(v) || !keys(v, ["contract_version", "workspace_id", "numeric_execution_id", "status", "can_quote", "can_retry", "can_complete", "activation", "quote", "execution"])
    || v.contract_version !== "workspace-topic-editorial-view-v1" || v.workspace_id !== workspace || v.numeric_execution_id !== numeric
    || !editorialStates.includes(v.status as WorkspaceTopicEditorialViewV1["status"]) || v.activation !== "not_activated"
    || typeof v.can_quote !== "boolean" || typeof v.can_retry !== "boolean" || typeof v.can_complete !== "boolean") return false;
  if (v.quote !== null) {
    const q = v.quote;
    if (!object(q) || !keys(q, ["reference", "expires_at", "maximum_micro_usd", "group_count", "screening_count", "global_count"])
      || !editorialQuote(q.reference) || typeof q.expires_at !== "string" || !Number.isFinite(Date.parse(q.expires_at))
      || Math.floor(Date.parse(q.expires_at) / 1000) !== Number(q.reference.split(".")[1])
      || !editorialCap(q.maximum_micro_usd) || !natural(q.group_count) || q.group_count < 1 || q.group_count > 5000
      || !natural(q.screening_count) || q.screening_count !== Math.ceil(q.group_count / 40) || q.global_count !== 1
      || v.status !== "ready_to_authorize" || v.execution !== null || !v.can_quote) return false;
  } else if (v.status === "ready_to_authorize") return false;
  if (v.execution !== null) {
    const e = v.execution;
    if (!object(e) || !keys(e, ["execution_id", "status", "completed_screening_count", "expected_screening_count", "maximum_micro_usd", "confirmed_micro_usd", "reserved_micro_usd", "ambiguous_micro_usd"])
      || !editorialUuid(e.execution_id) || !["queued", "running", "failed", "review_ready", "completed"].includes(String(e.status))
      || e.status !== v.status || !natural(e.completed_screening_count) || !natural(e.expected_screening_count)
      || e.expected_screening_count > 125 || e.completed_screening_count > e.expected_screening_count
      || !editorialCap(e.maximum_micro_usd) || !editorialMoney(e.confirmed_micro_usd) || !editorialMoney(e.reserved_micro_usd)
      || !editorialMoney(e.ambiguous_micro_usd) || v.can_quote || v.quote !== null) return false;
  } else if (["queued", "running", "failed", "review_ready", "completed"].includes(String(v.status))) return false;
  if (v.can_quote && !["not_requested", "ready_to_authorize"].includes(String(v.status))) return false;
  if (v.can_complete && (v.status !== "review_ready" || v.execution === null)) return false;
  return !v.can_retry || v.status === "failed" && v.execution !== null && (v.execution as Record<string, unknown>).ambiguous_micro_usd === "0";
}
export type WorkspaceTopicEditorialIntentV1 = { workspace_id: string; key: string; body: WorkspaceTopicEditorialCommandV1 };
export type WorkspaceTopicEditorialReceiptV1 = { contract_version: "workspace-topic-editorial-receipt-v1"; workspace_id: string;
  action: WorkspaceTopicEditorialCommandV1["action"]; numeric_execution_id: string; execution_id: string; idempotency_key: string; replayed: boolean; activation: "not_activated" };
export function workspaceTopicEditorialIntentV1(workspace: string, body: WorkspaceTopicEditorialCommandV1, previous: WorkspaceTopicEditorialIntentV1 | null, createKey: () => string) {
  if (previous?.workspace_id === workspace && previous.body.action === body.action && previous.body.numeric_execution_id === body.numeric_execution_id
    && (body.action === "authorize_editorial" || previous.body.action !== "authorize_editorial" && previous.body.execution_id === body.execution_id)) return previous;
  return { workspace_id: workspace, body: { ...body }, key: createKey() };
}
export class WorkspaceTopicEditorialRequestError extends Error {
  constructor(readonly quoteRejected: boolean) { super("topic_editorial_request_failed"); }
}
export async function submitWorkspaceTopicEditorialIntentV1(intent: WorkspaceTopicEditorialIntentV1, fetcher: typeof fetch, signal?: AbortSignal): Promise<WorkspaceTopicEditorialReceiptV1> {
  const response = await fetcher(`/api/data-os/signal/${encodeURIComponent(intent.workspace_id)}/topics/consolidation/editorial`, {
    method: "POST", cache: "no-store", signal, headers: { "Content-Type": "application/json", "Idempotency-Key": intent.key }, body: JSON.stringify(intent.body)
  });
  const v: unknown = await response.json();
  if (!response.ok || !object(v) || !keys(v, ["contract_version", "workspace_id", "action", "numeric_execution_id", "execution_id", "idempotency_key", "replayed", "activation"])
    || v.contract_version !== "workspace-topic-editorial-receipt-v1" || v.workspace_id !== intent.workspace_id || v.action !== intent.body.action
    || v.numeric_execution_id !== intent.body.numeric_execution_id || v.idempotency_key !== intent.key || !editorialUuid(v.execution_id)
    || typeof v.replayed !== "boolean" || v.activation !== "not_activated"
    || intent.body.action !== "authorize_editorial" && v.execution_id !== intent.body.execution_id)
    throw new WorkspaceTopicEditorialRequestError(response.status === 409 && object(v) && ["topic_editorial_quote_expired", "topic_editorial_quote_stale", "topic_editorial_existing_execution"].includes(String(v.error)));
  return v as WorkspaceTopicEditorialReceiptV1;
}

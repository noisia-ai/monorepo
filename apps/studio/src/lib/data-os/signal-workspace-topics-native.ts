import { createHash } from "node:crypto";
import { loadSignalWorkspaceTopicsOverviewV1, loadSignalWorkspaceTopicEvidenceV1,
  loadSignalWorkspaceTopicSelectionV1, selectSignalWorkspaceTopicV1,
  loadSignalWorkspaceCapabilitiesStoreV1, type SignalWorkspaceTopicSelectionStatusV1,
  type SignalWorkspaceCapabilitiesV1 } from "@noisia/db";
import type { SignalWorkspaceTopicsOverviewV1 } from "@noisia/query-engine";
import type { TopicSignalSelectionV1 } from "./signal-topic-selection-ui";

type ActorScope = { workspace_id: string; actor_user_id: string };
export function nativeTopicsQueryV1(params: URLSearchParams) {
  const allowed = new Set(["view", "date_from", "date_to", "start", "end", "timezone", "granularity", "compare", "cursor", "scope_digest", "limit"]);
  if ([...params.keys()].some(key => !allowed.has(key)) || (params.has("timezone") && params.get("timezone") !== "UTC")
    || (params.has("granularity") && params.get("granularity") !== "day") || (params.has("compare") && params.get("compare") !== "none")) {
    throw Object.assign(new Error("Only dates in UTC are supported for computed Topics"), { code: "workspace_topic_filter_unsupported", status: 422 });
  }
  const date_from = params.get("date_from") ?? params.get("start") ?? undefined;
  const date_to = params.get("date_to") ?? params.get("end") ?? undefined;
  if ([...params.keys()].some(key => new Set(params.getAll(key)).size > 1)
    || params.has("date_from") && params.has("start") && params.get("date_from") !== params.get("start")
    || params.has("date_to") && params.has("end") && params.get("date_to") !== params.get("end")
    || date_from === "" || date_to === "") throw Object.assign(new Error("Ambiguous filter"), { code: "workspace_topic_filter_invalid", status: 422 });
  for (const value of [date_from, date_to]) {
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))
      || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)) {
      throw Object.assign(new Error("Invalid date"), { code: "workspace_topic_filter_invalid", status: 422 });
    }
  }
  if (date_from && date_to && date_from > date_to) throw Object.assign(new Error("Invalid date range"), { code: "workspace_topic_filter_invalid", status: 422 });
  return { ...(date_from ? { date_from } : {}), ...(date_to ? { date_to } : {}) };
}
export const nativeTopicsViewV1 = (params: URLSearchParams) => !params.has("view") || params.get("view") === "all_conversations";
export async function loadNativeSignalTopicsV1(scope: ActorScope, params = new URLSearchParams()) {
  if (!nativeTopicsViewV1(params)) return null;
  let filter: ReturnType<typeof nativeTopicsQueryV1> = {}, invalid: unknown = null;
  const { pool } = await import("@/lib/db");
  try { filter = nativeTopicsQueryV1(params); } catch (error) { invalid = error; }
  const native = await loadSignalWorkspaceTopicsOverviewV1({ database: pool, ...scope, ...filter });
  if (native && invalid) throw invalid;
  return native;
}
export async function loadNativeSignalTopicEvidenceV1(scope: ActorScope, term_key: string, params: URLSearchParams) {
  const limit = params.has("limit") ? Number(params.get("limit")) : 25;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw Object.assign(new Error("Invalid limit"), { code: "workspace_topic_filter_invalid", status: 422 });
  const { pool } = await import("@/lib/db");
  return loadSignalWorkspaceTopicEvidenceV1({ database: pool, ...scope, ...nativeTopicsQueryV1(params), term_key, limit,
    ...(params.get("cursor") ? { cursor: params.get("cursor")! } : {}),
    ...(params.get("scope_digest") ? { expected_scope_digest: params.get("scope_digest")! } : {}) });
}
export async function loadNativeTopicSelectionV1(scope: ActorScope, termKey: string, idempotencyKey?: string): Promise<TopicSignalSelectionV1> {
  const { pool } = await import("@/lib/db");
  const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: pool, ...scope });
  const [state, overview] = await Promise.all([
    loadSignalWorkspaceTopicSelectionV1({ database: pool, ...scope, ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}) }),
    capabilities.can_select_signal ? loadSignalWorkspaceTopicsOverviewV1({ database: pool, ...scope, include_unselected: true }) : null
  ]);
  return nativeTopicSelectionViewV1(scope, termKey, idempotencyKey, state, overview, capabilities);
}
export function nativeTopicSelectionViewV1(scope: ActorScope, termKey: string, idempotencyKey: string | undefined,
  state: SignalWorkspaceTopicSelectionStatusV1, overview: SignalWorkspaceTopicsOverviewV1 | null, capabilities: SignalWorkspaceCapabilitiesV1): TopicSignalSelectionV1 {
  if (state.workspace_id !== scope.workspace_id || overview && overview.workspace_id !== scope.workspace_id)
    throw Object.assign(new Error("Workspace mismatch"), { code: "workspace_topic_selection_forbidden", status: 403 });
  const term = overview?.terms.find(item => item.term_key === termKey), selected = state.items[termKey];
  if (overview && overview.selection_revision !== state.revision) throw Object.assign(new Error("Selection changed"), { code: "workspace_topic_selection_conflict", status: 409 });
  if (!term && !selected) throw Object.assign(new Error("Topic unavailable"), { code: "workspace_topic_not_found", status: 404 });
  const receipt = state.request_receipt?.term_key === termKey ? state.request_receipt : null;
  return { workspace_id: scope.workspace_id, term_key: termKey, request_scope: createHash("sha256").update(`${scope.actor_user_id}:${scope.workspace_id}`).digest("hex"),
    observed_at: state.observed_at, is_processing: overview?.is_processing ?? false, can_select: capabilities.can_select_signal, selection_revision: state.revision,
    selected: selected?.selected ?? false, definition_revision: term?.definition_revision ?? selected!.definition_revision,
    definition_digest: term?.definition_digest ?? selected!.definition_digest, generation_id: overview?.generation_id ?? selected?.generation_id ?? null,
    is_current: Boolean(overview?.is_current && term && overview.generation_id && (!selected?.selected
      || selected.definition_digest === term.definition_digest && selected.definition_revision === term.definition_revision)), mention_count: term?.mention_count ?? null,
    request_receipt: receipt && idempotencyKey ? { idempotency_key: idempotencyKey, selected: receipt.selection.selected } : null };
}
export async function selectNativeTopicSignalV1(scope: ActorScope, termKey: string, body: {
  selected: boolean; expected_selection_revision: number; expected_definition_revision: number;
  expected_definition_digest: string; generation_id: string | null; idempotency_key: string;
}) {
  const { pool } = await import("@/lib/db");
  await selectSignalWorkspaceTopicV1({ database: pool, ...scope, term_key: termKey, ...body });
  return loadNativeTopicSelectionV1(scope, termKey, body.idempotency_key);
}

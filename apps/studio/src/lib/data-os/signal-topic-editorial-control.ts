import type { Pool } from "pg";
import { loadSignalWorkspaceCapabilitiesStoreV1, loadSignalTopicConsolidationEditorialInputV1,
  quoteSignalTopicConsolidationEditorialV1, requestSignalTopicConsolidationEditorialV1,
  loadSignalTopicConsolidationEditorialStatusV1, retrySignalTopicEditorialExecutionV1,
  SignalTopicEditorialStoreError, materializeSignalTopicEditorialExecutionV1 } from "@noisia/db";
import type { SignalTopicEditorialScreeningPlanV1 } from "@noisia/query-engine";
import { editorialCap, editorialKey, editorialStates, editorialUuid, parseWorkspaceTopicEditorialCommandV1,
  validWorkspaceTopicEditorialViewV1, type WorkspaceTopicEditorialReceiptV1, type WorkspaceTopicEditorialViewV1 } from "./workspace-topic-editorial-contract";
import { editorialQuoteRuntimeAvailableV1, editorialRecoveryRuntimeAvailableV1,
  getEditorialQuoteCacheV1, type EditorialQuoteCache } from "./workspace-topic-editorial-cache";

type Access = { database?: Pick<Pool, "connect">; workspaceId: string; actorUserId: string; numericExecutionId: string };
type DbAccess = { database: Pick<Pool, "connect">; workspace_id: string; actor_user_id: string; numeric_execution_id: string };
type Inspection = { numeric_run_id: string | null; execution_id: string | null; can_request: boolean; retry_available: boolean; source_current: boolean;
  completion: null | { available: boolean; completed: boolean };
  replay: null | { plan: SignalTopicEditorialScreeningPlanV1; quote_reference: string; maximum_micro_usd: string } };
function fail(code: string, status = 409): never { throw new SignalTopicEditorialStoreError(code, status); }
/** Read-only scoped metadata. SQL mutators still revalidate live authority under their locks. */
async function inspect(args: DbAccess, requestKey?: string): Promise<Inspection> {
  const client = await args.database.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL search_path=public,extensions,pg_temp");
    const caps = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: client, workspace_id: args.workspace_id, actor_user_id: args.actor_user_id });
    if (!caps.can_view) fail("processing_forbidden", 403);
    const row = (await client.query<{ numeric_run_id: string; execution_id: string | null; source_current: boolean; retry_available: boolean;
      completion_owner: boolean; completion_available: boolean; completed: boolean;
      replay_plan: SignalTopicEditorialScreeningPlanV1 | null; quote_reference: string; maximum_micro_usd: string }>(`
      SELECT n.consolidation_run_id AS numeric_run_id,e.id AS execution_id,
        CASE WHEN e.id IS NULL THEN signal_topic_editorial_source_v1(n.consolidation_run_id) IS NOT NULL
          ELSE signal_topic_editorial_source_v1(n.consolidation_run_id) IS NOT DISTINCT FROM e.source_binding END AS source_current,
        COALESCE(e.actor_user_id=$2 AND e.status='failed' AND e.dispatch_generation<20
          AND NOT EXISTS(SELECT 1 FROM signal_topic_editorial_calls c WHERE c.execution_id=e.id AND c.status IN('in_flight','outcome_unknown')),false) AS retry_available,
        CASE WHEN k.execution_id IS NOT NULL THEN e.plan END AS replay_plan,
        e.quote_reference,e.hard_cap_micro_usd::text AS maximum_micro_usd,
        e.actor_user_id=$2 AND e.status IN('review_ready','completed') AS completion_owner,e.status='completed' AS completed,
        e.status='review_ready' AND clock_timestamp()>=COALESCE((SELECT max(c.settled_at) FROM signal_topic_editorial_calls c WHERE c.execution_id=e.id),e.created_at)+interval '60 seconds' AS completion_available
      FROM signal_topic_consolidation_executions n
      LEFT JOIN signal_topic_editorial_executions e ON e.numeric_run_id=n.consolidation_run_id AND e.workspace_id=n.workspace_id
      LEFT JOIN signal_topic_editorial_request_keys k ON k.workspace_id=e.workspace_id AND k.execution_id=e.id AND k.actor_user_id=$2 AND k.idempotency_key=$4
      WHERE n.workspace_id=$1 AND n.id=$3 AND n.status='ready'`,
    [args.workspace_id, args.actor_user_id, args.numeric_execution_id, requestKey ?? null])).rows[0];
    await client.query("COMMIT");
    return { numeric_run_id: row?.numeric_run_id ?? null, execution_id: row?.execution_id ?? null, can_request: caps.can_request_processing,
      retry_available: row?.retry_available === true, source_current: row?.source_current === true,
      completion: row?.completion_owner ? { available: row.completion_available === true, completed: row.completed === true } : null,
      replay: row?.replay_plan ? { plan: row.replay_plan, quote_reference: row.quote_reference, maximum_micro_usd: row.maximum_micro_usd } : null };
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
const defaultDependencies = {
  inspect, input: loadSignalTopicConsolidationEditorialInputV1, quote: quoteSignalTopicConsolidationEditorialV1,
  status: loadSignalTopicConsolidationEditorialStatusV1, request: requestSignalTopicConsolidationEditorialV1,
  retry: retrySignalTopicEditorialExecutionV1, complete: materializeSignalTopicEditorialExecutionV1, available: editorialQuoteRuntimeAvailableV1,
  recoverable: editorialRecoveryRuntimeAvailableV1,
  cache: getEditorialQuoteCacheV1 as () => EditorialQuoteCache, now: () => Date.now()
};
export type WorkspaceTopicEditorialDependenciesV1 = typeof defaultDependencies;
async function options(args: Access): Promise<DbAccess> {
  if (![args.workspaceId, args.actorUserId, args.numericExecutionId].every(editorialUuid)) fail("topic_editorial_request_invalid", 422);
  return { database: args.database ?? (await import("@/lib/db")).pool, workspace_id: args.workspaceId,
    actor_user_id: args.actorUserId, numeric_execution_id: args.numericExecutionId };
}
const clean = (value: WorkspaceTopicEditorialViewV1) => validWorkspaceTopicEditorialViewV1(value, value.workspace_id, value.numeric_execution_id)
  ? value : fail("topic_editorial_status_unavailable", 503);

export async function loadWorkspaceTopicEditorialForActorV1(args: Access & { withQuote?: boolean }, dependencies = defaultDependencies): Promise<WorkspaceTopicEditorialViewV1> {
  const access = await options(args), scope = await dependencies.inspect(access);
  const view: WorkspaceTopicEditorialViewV1 = { contract_version: "workspace-topic-editorial-view-v1", workspace_id: args.workspaceId,
    numeric_execution_id: args.numericExecutionId, status: "source_required", can_quote: false, can_retry: false, can_complete: false,
    activation: "not_activated", quote: null, execution: null };
  if (!scope.numeric_run_id) return clean(view);
  const status = await dependencies.status({ ...access, numeric_run_id: scope.numeric_run_id });
  if (status.workspace_id !== args.workspaceId) fail("topic_editorial_status_unavailable", 503);
  if (status.execution_id) {
    view.status = status.status as WorkspaceTopicEditorialViewV1["status"];
    view.execution = { execution_id: status.execution_id, status: status.status as NonNullable<WorkspaceTopicEditorialViewV1["execution"]>["status"],
      completed_screening_count: status.completed_screening_count, expected_screening_count: status.expected_screening_count,
      maximum_micro_usd: status.maximum_micro_usd ?? "0", confirmed_micro_usd: status.confirmed_micro_usd,
      reserved_micro_usd: status.reserved_micro_usd, ambiguous_micro_usd: status.ambiguous_micro_usd };
    view.can_complete = scope.can_request && scope.completion?.available === true && status.status === "review_ready";
    view.can_retry = scope.can_request && scope.retry_available && dependencies.recoverable()
      && status.status === "failed" && status.ambiguous_micro_usd === "0";
    return clean(view);
  }
  view.status = !scope.can_request ? "access_required" : !scope.source_current ? "source_stale"
    : !dependencies.available() ? "runtime_unavailable" : "not_requested";
  view.can_quote = view.status === "not_requested";
  if (!view.can_quote || !args.withQuote) return clean(view);
  try {
    const input = await dependencies.input({ ...access, numeric_run_id: scope.numeric_run_id });
    const quote = await dependencies.quote({ ...access, numeric_run_id: scope.numeric_run_id, plan: input.plan });
    if (quote.workspace_id !== args.workspaceId) fail("topic_editorial_status_unavailable", 503);
    if (quote.status !== "ready_to_authorize") {
      view.status = editorialStates.includes(quote.status as WorkspaceTopicEditorialViewV1["status"])
        ? quote.status as WorkspaceTopicEditorialViewV1["status"] : "source_stale";
      view.can_quote = false; return clean(view);
    }
    if (!quote.quote_reference || !quote.quote_expires_at || !editorialCap(quote.maximum_micro_usd)
      || Date.parse(quote.quote_expires_at) <= dependencies.now()) fail("topic_editorial_quote_expired");
    view.status = "ready_to_authorize";
    view.quote = { reference: quote.quote_reference, expires_at: quote.quote_expires_at, maximum_micro_usd: quote.maximum_micro_usd,
      group_count: quote.expected_group_count, screening_count: quote.screening_request_count, global_count: 1 };
    clean(view);
    await dependencies.cache().put({ workspace_id: access.workspace_id, actor_user_id: access.actor_user_id, numeric_execution_id: access.numeric_execution_id, numeric_run_id: scope.numeric_run_id, quote: view.quote, plan: input.plan });
    return view;
  } catch (error) {
    if (error instanceof SignalTopicEditorialStoreError && ["topic_editorial_source_stale", "brand_context_source_stale", "brand_context_semantic_context_required"].includes(error.code))
      return clean({ ...view, status: "source_stale", can_quote: false, quote: null });
    throw error;
  }
}

export async function requestWorkspaceTopicEditorialForActorV1(args: Omit<Access, "numericExecutionId"> & { body: unknown; idempotencyKey: string },
  dependencies = defaultDependencies): Promise<WorkspaceTopicEditorialReceiptV1> {
  const command = parseWorkspaceTopicEditorialCommandV1(args.body);
  if (!command || !editorialKey(args.idempotencyKey)) fail("topic_editorial_request_invalid", 422);
  const access = await options({ ...args, numericExecutionId: command.numeric_execution_id });
  const scope = await dependencies.inspect(access, args.idempotencyKey);
  if (!scope.can_request) fail("processing_forbidden", 403);
  if (!scope.numeric_run_id) fail("topic_editorial_source_stale");
  let result;
  if (command.action === "complete_catalog") {
    if (scope.execution_id !== command.execution_id || !scope.completion || !(scope.completion.available || scope.completion.completed))
      fail("topic_editorial_completion_unavailable");
    result = await dependencies.complete({ database: access.database, workspace_id: access.workspace_id, actor_user_id: access.actor_user_id, execution_id: command.execution_id });
  } else if (command.action === "retry_editorial") {
    if (scope.execution_id !== command.execution_id) fail("topic_editorial_request_invalid", 422);
    if (!scope.replay && (!scope.retry_available || !dependencies.recoverable())) fail("topic_editorial_retry_unavailable");
    // SQL owns exact replay/retry fences, including actor, owner and uncertain calls.
    result = await dependencies.retry({ ...access, execution_id: command.execution_id, idempotency_key: args.idempotencyKey });
  } else {
    let plan: SignalTopicEditorialScreeningPlanV1;
    if (scope.replay) {
      if (scope.replay.quote_reference !== command.quote_reference || scope.replay.maximum_micro_usd !== command.confirmed_maximum_micro_usd)
        fail("processing_idempotency_conflict");
      plan = scope.replay.plan;
    } else {
      if (scope.execution_id) fail("topic_editorial_existing_execution");
      if (!scope.source_current) fail("topic_editorial_source_stale");
      if (!dependencies.available()) fail("topic_editorial_runtime_unavailable");
      const snapshot = await dependencies.cache().get(access, command.quote_reference);
      if (!snapshot || snapshot.numeric_run_id !== scope.numeric_run_id || Date.parse(snapshot.quote.expires_at) <= dependencies.now())
        fail("topic_editorial_quote_expired");
      if (snapshot.quote.maximum_micro_usd !== command.confirmed_maximum_micro_usd) fail("topic_editorial_confirmation_invalid", 422);
      plan = snapshot.plan;
    }
    result = await dependencies.request({ ...access, numeric_run_id: scope.numeric_run_id, plan,
      idempotency_key: args.idempotencyKey, quote_reference: command.quote_reference });
  }
  // Nothing fallible follows the committed DB receipt. Status refresh is a separate GET.
  return { contract_version: "workspace-topic-editorial-receipt-v1", workspace_id: args.workspaceId,
    numeric_execution_id: command.numeric_execution_id, action: command.action, execution_id: result.execution_id,
    idempotency_key: args.idempotencyKey, replayed: result.replayed, activation: "not_activated" };
}

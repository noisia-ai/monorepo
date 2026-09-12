import type { WorkspaceTopicConsolidationCommandV1 } from "./signal-topic-consolidation-control";

export type WorkspaceTopicConsolidationIntentV1 = {
  workspace_id: string; key: string; body: WorkspaceTopicConsolidationCommandV1;
};
export type WorkspaceTopicConsolidationReceiptV1 = {
  contract_version: "signal-topic-consolidation-request-receipt-v1";
  workspace_id: string; action: WorkspaceTopicConsolidationCommandV1["action"];
  execution_id: string; idempotency_key: string; replayed: boolean;
};
const target = (body: WorkspaceTopicConsolidationCommandV1) => body.action === "retry_numeric"
  ? body.execution_id : body.source_execution_id;

/** Keep the sealed quote/key on an uncertain response, even if GET rotates the quote. */
export function workspaceTopicConsolidationIntentV1(args: {
  workspace_id: string; body: WorkspaceTopicConsolidationCommandV1;
  previous: WorkspaceTopicConsolidationIntentV1 | null; createKey: () => string;
}): WorkspaceTopicConsolidationIntentV1 {
  const previous = args.previous;
  if (previous?.workspace_id === args.workspace_id && previous.body.action === args.body.action
    && target(previous.body) === target(args.body)) return previous;
  return { workspace_id: args.workspace_id, key: args.createKey(), body: { ...args.body } };
}

export function validWorkspaceTopicConsolidationReceiptV1(value: unknown,
  intent: WorkspaceTopicConsolidationIntentV1): value is WorkspaceTopicConsolidationReceiptV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).sort().join(",") === "action,contract_version,execution_id,idempotency_key,replayed,workspace_id"
    && row.contract_version === "signal-topic-consolidation-request-receipt-v1"
    && row.workspace_id === intent.workspace_id && row.action === intent.body.action && row.idempotency_key === intent.key
    && typeof row.replayed === "boolean" && typeof row.execution_id === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(row.execution_id)
    && (intent.body.action !== "retry_numeric" || row.execution_id === intent.body.execution_id);
}

export class WorkspaceTopicConsolidationRequestError extends Error {
  constructor(readonly quoteRejected: boolean) { super("topic_consolidation_request_failed"); }
}
export async function submitWorkspaceTopicConsolidationIntentV1(args: {
  intent: WorkspaceTopicConsolidationIntentV1; fetcher: typeof fetch; signal?: AbortSignal;
}): Promise<WorkspaceTopicConsolidationReceiptV1> {
  const response = await args.fetcher(`/api/data-os/signal/${encodeURIComponent(args.intent.workspace_id)}/topics/consolidation`, {
    method: "POST", cache: "no-store", signal: args.signal,
    headers: { "Content-Type": "application/json", "Idempotency-Key": args.intent.key }, body: JSON.stringify(args.intent.body)
  });
  const body: unknown = await response.json();
  if (!response.ok || !validWorkspaceTopicConsolidationReceiptV1(body, args.intent)) {
    // A proven quote rejection did not commit a request. Network/5xx/invalid
    // responses retain the original intention for exact ledger replay.
    const rejected = response.status === 409 && body !== null && typeof body === "object"
      && "error" in body && body.error === "topic_consolidation_quote_stale";
    throw new WorkspaceTopicConsolidationRequestError(rejected);
  }
  return body;
}

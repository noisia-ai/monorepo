import {
  signalTopicConsolidationActivationStatusSchemaV1,
  signalTopicConsolidationMutationReceiptSchemaV1,
  signalTopicConsolidationSnapshotReceiptSchemaV1,
  type SignalTopicConsolidationActivationCommandV1,
  type SignalTopicConsolidationActivationStatusV1
} from "@noisia/query-engine/signal-topic-consolidation-activation-v1";

type ActivationCommand = Extract<SignalTopicConsolidationActivationCommandV1, { action: "activate" }>;
export type WorkspaceTopicConsolidationActivationBodyV1 = ActivationCommand | {
  action: "prepare";
  revision_id: string;
  revision_digest: string;
};
export type WorkspaceTopicConsolidationActivationIntentV1 = {
  workspace_id: string;
  idempotency_key: string;
  body: WorkspaceTopicConsolidationActivationBodyV1;
};

export function parseWorkspaceTopicConsolidationActivationStatusV1(value: unknown, workspaceId: string) {
  const parsed = signalTopicConsolidationActivationStatusSchemaV1.safeParse(value);
  return parsed.success && parsed.data.workspace_id === workspaceId ? parsed.data : null;
}

export function workspaceTopicConsolidationSelectedConceptKeysV1(
  status: WorkspaceTopicConsolidationActivationStatusV1,
  revision: WorkspaceTopicConsolidationActivationStatusV1["revisions"][number]
) {
  const catalog = revision.catalog ?? [];
  if (revision.snapshot_id === status.binding.snapshot_id)
    return catalog.filter(concept => status.binding.selection[concept.term_key]?.selected).map(concept => concept.concept_key);
  const priorByIdentity = new Map(Object.values(status.binding.selection)
    .filter(item => item.semantic_identity_digest)
    .map(item => [item.semantic_identity_digest!, item.selected]));
  return catalog.filter(concept => priorByIdentity.get(concept.semantic_identity_digest) ?? true).map(concept => concept.concept_key);
}

export function workspaceTopicConsolidationActivationIntentV1(args: {
  workspace_id: string;
  body: WorkspaceTopicConsolidationActivationBodyV1;
  previous: WorkspaceTopicConsolidationActivationIntentV1 | null;
  createKey: () => string;
}): WorkspaceTopicConsolidationActivationIntentV1 {
  if (args.previous?.workspace_id === args.workspace_id
    && JSON.stringify(args.previous.body) === JSON.stringify(args.body)) return args.previous;
  return { workspace_id: args.workspace_id, idempotency_key: args.createKey(), body: args.body };
}

export class WorkspaceTopicConsolidationActivationRequestError extends Error {
  constructor(readonly code: string, readonly ambiguous: boolean, readonly accessDenied: boolean, readonly stale: boolean) {
    super(code);
  }
}

export async function submitWorkspaceTopicConsolidationActivationIntentV1(
  intent: WorkspaceTopicConsolidationActivationIntentV1,
  fetcher: typeof fetch,
  signal?: AbortSignal
) {
  let response: Response;
  try {
    response = await fetcher(`/api/data-os/signal/${encodeURIComponent(intent.workspace_id)}/topics/consolidation/activation`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", "Idempotency-Key": intent.idempotency_key },
      body: JSON.stringify(intent.body),
      signal
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new WorkspaceTopicConsolidationActivationRequestError("topic_consolidation_activation_unconfirmed", true, false, false);
  }
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = value && typeof value === "object" && !Array.isArray(value) && typeof (value as { error?: unknown }).error === "string"
      ? String((value as { error: string }).error) : "topic_consolidation_activation_rejected";
    throw new WorkspaceTopicConsolidationActivationRequestError(code, response.status >= 500,
      [401, 403, 404].includes(response.status), response.status === 409 && /(?:stale|conflict|source)/u.test(code));
  }
  const parsed = intent.body.action === "prepare"
    ? signalTopicConsolidationSnapshotReceiptSchemaV1.safeParse(value)
    : signalTopicConsolidationMutationReceiptSchemaV1.safeParse(value);
  if (!parsed.success) throw new WorkspaceTopicConsolidationActivationRequestError(
    "topic_consolidation_activation_response_invalid", true, false, false);
  return parsed.data;
}

export type WorkspaceTopicConsolidationActivationStatusV1 = SignalTopicConsolidationActivationStatusV1;

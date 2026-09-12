import type {
  SignalBrandContextProcessingQuoteStatusV1,
  SignalBrandContextProcessingQuoteV1
} from "@noisia/db";

export type ClientBrandContextProcessingQuoteStatusV1 =
  | "quote_available"
  | "access_required"
  | "configuration_required"
  | "configuration_expired"
  | "processing_paused"
  | "daily_limit_reached"
  | "brand_context_required"
  | "brand_context_outdated"
  | "market_language_required"
  | "preparation_required"
  | "temporarily_unavailable";

export type ClientBrandContextProcessingQuoteViewV1 = {
  contract_version: "client-brand-context-processing-quote-view-v1";
  workspace_id: string;
  status: ClientBrandContextProcessingQuoteStatusV1;
  /** Informational until the joint admission transaction exists. */
  can_start: false;
  /** Policy ceiling, not an estimate or reservation. */
  maximum_micro_usd: string | null;
  available_today_micro_usd: string | null;
  observed_at: string;
  quote_expires_at: string | null;
  /** Opaque identity for the exact server-owned quote. It grants no authority. */
  quote_reference: string | null;
};

export type ClientBrandContextProcessingOperationStateV1 =
  | "queued"
  | "running"
  | "recovering"
  | "awaiting_authorization"
  | "completed"
  | "stale"
  | "failed";
export type ClientBrandContextProcessingPhaseV1 =
  | "waiting"
  | "preparing_context"
  | "preparing_interests"
  | "finalizing";
export type ClientBrandContextProcessingNextActionV1 = "retry_semantic" | "renew_semantic";
export type ClientBrandContextProcessingViewV1 = {
  contract_version: "client-brand-context-processing-view-v1";
  workspace_id: string;
  observed_at: string;
  /** Remains false until the server owns both composed stages. */
  can_start: boolean;
  status: ClientBrandContextProcessingQuoteStatusV1;
  quote: null | {
    reference: string | null;
    maximum_micro_usd: string;
    available_today_micro_usd: string;
    expires_at: string;
  };
  operation: null | {
    state: ClientBrandContextProcessingOperationStateV1;
    phase: ClientBrandContextProcessingPhaseV1 | null;
    request_observed: boolean;
    /** Server-owned recovery path; null never grants retry authority. */
    next_action: ClientBrandContextProcessingNextActionV1 | null;
  };
};

export type ClientBrandContextProcessingPendingRequestV1 = {
  workspaceId: string;
  key: string;
  confirmation: ClientBrandContextProcessingConfirmationKindV1;
  quoteObservedAt: string;
  quoteReference: string;
  maximumMicroUsd: string;
  availableTodayMicroUsd: string;
  expiresAt: string;
};

export type ClientBrandContextReconciliationCycleV1 = {
  workspaceId: string;
  idempotencyKey: string;
  attempts: number;
};

export type ClientBrandContextPollingCheckpointV1 = {
  contract_version: "client-brand-context-polling-checkpoint-v1";
  workspace_id: string;
  observed_at: string;
};

export type ClientBrandContextProcessingConfirmationKindV1 =
  | "prepare_brand_context_within_shown_cap"
  | "prepare_brand_context_prototypes_within_shown_cap"
  | "renew_brand_context_semantic_within_shown_cap";

export type ClientBrandContextProcessingConfirmationV1 = {
  contract_version: "client-brand-context-processing-request-v1";
  confirmation: ClientBrandContextProcessingConfirmationKindV1;
  expected_quote: {
    observed_at: string;
    reference: string;
    maximum_micro_usd: string;
    available_today_micro_usd: string;
    expires_at: string;
  };
};

const publicStatuses = new Set<ClientBrandContextProcessingQuoteStatusV1>([
  "quote_available", "access_required", "configuration_required", "configuration_expired",
  "processing_paused", "daily_limit_reached", "brand_context_required", "brand_context_outdated",
  "market_language_required", "preparation_required", "temporarily_unavailable"
]);
const publicKeys = ["available_today_micro_usd", "can_start", "contract_version", "maximum_micro_usd",
  "observed_at", "quote_expires_at", "quote_reference", "status", "workspace_id"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const money = (value: unknown) => typeof value === "string" && /^(0|[1-9][0-9]{0,17})$/u.test(value);
const timestamp = (value: unknown) => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value));
const quoteReference = (value: unknown) => typeof value === "string" && /^qv1_[0-9a-f]{64}$/u.test(value);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value
  && typeof value === "object" && !Array.isArray(value));
const operationStates = new Set<ClientBrandContextProcessingOperationStateV1>([
  "queued", "running", "recovering", "awaiting_authorization", "completed", "stale", "failed"
]);
const confirmationKinds = new Set<ClientBrandContextProcessingConfirmationKindV1>([
  "prepare_brand_context_within_shown_cap", "prepare_brand_context_prototypes_within_shown_cap",
  "renew_brand_context_semantic_within_shown_cap"
]);
const phases = new Set<ClientBrandContextProcessingPhaseV1>([
  "waiting", "preparing_context", "preparing_interests", "finalizing"
]);
const nextActions = new Set<ClientBrandContextProcessingNextActionV1>(["retry_semantic", "renew_semantic"]);
const viewKeys = ["can_start", "contract_version", "observed_at", "operation", "quote", "status", "workspace_id"];

export function validClientBrandContextProcessingQuoteViewV1(
  value: unknown
): value is ClientBrandContextProcessingQuoteViewV1 {
  if (!object(value) || Object.keys(value).sort().join(",") !== publicKeys.join(",")
    || value.contract_version !== "client-brand-context-processing-quote-view-v1"
    || typeof value.workspace_id !== "string" || !uuid.test(value.workspace_id)
    || typeof value.status !== "string" || !publicStatuses.has(value.status as ClientBrandContextProcessingQuoteStatusV1)
    || value.can_start !== false || !(value.maximum_micro_usd === null || money(value.maximum_micro_usd))
    || !(value.available_today_micro_usd === null || money(value.available_today_micro_usd))
    || !timestamp(value.observed_at) || !(value.quote_expires_at === null || timestamp(value.quote_expires_at))
    || !(value.quote_reference === null || quoteReference(value.quote_reference))) return false;
  return value.status === "quote_available"
    ? value.maximum_micro_usd !== null && value.available_today_micro_usd !== null
      && value.quote_expires_at !== null && value.quote_reference !== null
    : value.quote_expires_at === null && value.quote_reference === null;
}

export function clientBrandContextProcessingQuoteForWorkspaceV1(
  value: ClientBrandContextProcessingQuoteViewV1 | null,
  workspaceId: string
) {
  return value?.workspace_id === workspaceId && validClientBrandContextProcessingQuoteViewV1(value) ? value : null;
}

function validOperation(value: unknown): value is NonNullable<ClientBrandContextProcessingViewV1["operation"]> {
  if (!object(value) || Object.keys(value).sort().join(",") !== "next_action,phase,request_observed,state"
    || typeof value.state !== "string" || !operationStates.has(value.state as ClientBrandContextProcessingOperationStateV1)
    || typeof value.request_observed !== "boolean"
    || !(value.next_action === null || typeof value.next_action === "string"
      && nextActions.has(value.next_action as ClientBrandContextProcessingNextActionV1))
    || !(value.phase === null || typeof value.phase === "string" && phases.has(value.phase as ClientBrandContextProcessingPhaseV1))) return false;
  if (value.state !== "failed" && value.next_action !== null) return false;
  if (value.state === "queued") return value.phase === "waiting";
  if (value.state === "running") return value.phase !== null && value.phase !== "waiting";
  if (value.state === "recovering") return value.phase !== null;
  return value.phase === null;
}

export function validClientBrandContextProcessingViewV1(value: unknown): value is ClientBrandContextProcessingViewV1 {
  const operation = object(value) ? value.operation : undefined;
  if (!object(value) || Object.keys(value).sort().join(",") !== viewKeys.join(",")
    || value.contract_version !== "client-brand-context-processing-view-v1"
    || typeof value.workspace_id !== "string" || !uuid.test(value.workspace_id)
    || !timestamp(value.observed_at) || typeof value.can_start !== "boolean"
    || typeof value.status !== "string" || !publicStatuses.has(value.status as ClientBrandContextProcessingQuoteStatusV1)
    || !(operation === null || validOperation(operation))) return false;
  if (value.quote !== null && (!object(value.quote)
    || Object.keys(value.quote).sort().join(",") !== "available_today_micro_usd,expires_at,maximum_micro_usd,reference"
    || !money(value.quote.maximum_micro_usd) || !money(value.quote.available_today_micro_usd)
    || !timestamp(value.quote.expires_at)
    || !(value.quote.reference === null || quoteReference(value.quote.reference)))) return false;
  if (value.status === "quote_available" && value.quote === null) return false;
  if (operation?.state === "awaiting_authorization" && value.can_start !== true) return false;
  if (operation?.state === "failed" && Boolean(operation.next_action) !== value.can_start) return false;
  if (value.can_start && (value.status !== "quote_available" || value.quote === null
    || value.quote.reference === null
    || operation && !["awaiting_authorization", "stale", "failed"].includes(operation.state))) return false;
  return !operation || !["queued", "running", "recovering", "completed"].includes(operation.state)
    || value.can_start === false;
}

export function clientBrandContextProcessingViewFromQuoteV1(
  quote: ClientBrandContextProcessingQuoteViewV1
): ClientBrandContextProcessingViewV1 {
  return {
    contract_version: "client-brand-context-processing-view-v1",
    workspace_id: quote.workspace_id,
    observed_at: quote.observed_at,
    can_start: false,
    status: quote.status,
    quote: quote.status === "quote_available" && quote.maximum_micro_usd !== null
      && quote.available_today_micro_usd !== null && quote.quote_expires_at !== null ? {
      maximum_micro_usd: quote.maximum_micro_usd,
      available_today_micro_usd: quote.available_today_micro_usd,
      expires_at: quote.quote_expires_at,
      reference: quote.quote_reference
      } : null,
    operation: null
  };
}

export function clientBrandContextProcessingViewForWorkspaceV1(
  value: ClientBrandContextProcessingViewV1 | null,
  workspaceId: string
) {
  return value?.workspace_id === workspaceId && validClientBrandContextProcessingViewV1(value) ? value : null;
}

export function latestClientBrandContextProcessingViewV1(current: ClientBrandContextProcessingViewV1 | null,
  next: ClientBrandContextProcessingViewV1, workspaceId: string) {
  const previous = clientBrandContextProcessingViewForWorkspaceV1(current, workspaceId);
  if (!clientBrandContextProcessingViewForWorkspaceV1(next, workspaceId)) return previous;
  return previous && Date.parse(previous.observed_at) > Date.parse(next.observed_at) ? previous : next;
}

const processingPollDelays = [4_000, 8_000, 16_000, 30_000, 60_000] as const;

export function clientBrandContextProcessingPollDelayV1(view: ClientBrandContextProcessingViewV1 | null,
  attempts = 0) {
  return view?.operation && ["queued", "running", "recovering"].includes(view.operation.state)
    && Number.isInteger(attempts) && attempts >= 0
    ? processingPollDelays[Math.min(attempts, processingPollDelays.length - 1)]
    : null;
}

export function clientBrandContextProcessingPollingCheckpointV1(view: ClientBrandContextProcessingViewV1 | null) {
  return view?.operation && ["queued", "running", "recovering"].includes(view.operation.state) ? {
    contract_version: "client-brand-context-polling-checkpoint-v1" as const,
    workspace_id: view.workspace_id,
    observed_at: view.observed_at
  } : null;
}

export function validClientBrandContextProcessingPollingCheckpointV1(value: unknown, workspaceId: string,
  now = Date.now()) {
  if (!object(value) || Object.keys(value).sort().join(",") !== "contract_version,observed_at,workspace_id"
    || value.contract_version !== "client-brand-context-polling-checkpoint-v1"
    || value.workspace_id !== workspaceId || !timestamp(value.observed_at)) return false;
  const age = now - Date.parse(value.observed_at as string);
  return age >= -300_000 && age <= 86_400_000;
}

export function clientBrandContextProcessingNeedsExplicitRenewalV1(view: ClientBrandContextProcessingViewV1 | null) {
  return Boolean(view?.operation?.state === "failed" && view.operation.next_action === "renew_semantic" && view.can_start
    && view.status === "quote_available" && view.quote?.reference
    && Date.parse(view.quote.expires_at) > Date.now());
}

export function clientBrandContextProcessingCanRetrySemanticV1(view: ClientBrandContextProcessingViewV1 | null) {
  return Boolean(view?.operation?.state === "failed" && view.operation.next_action === "retry_semantic" && view.can_start
    && view.status === "quote_available" && view.quote?.reference
    && Date.parse(view.quote.expires_at) > Date.now());
}

const reconciliationRetryDelays = [0, 2_000, 8_000] as const;

export function clientBrandContextReconciliationCycleV1(current: ClientBrandContextReconciliationCycleV1 | null,
  workspaceId: string, createKey: () => string, renewIdentity = false): ClientBrandContextReconciliationCycleV1 {
  if (current?.workspaceId === workspaceId) return renewIdentity
    ? { ...current, idempotencyKey: createKey() }
    : current;
  return { workspaceId, idempotencyKey: createKey(), attempts: 0 };
}

export function clientBrandContextReconciliationRetryDelayV1(attempts: number) {
  return Number.isInteger(attempts) && attempts >= 0
    ? reconciliationRetryDelays[attempts] ?? null
    : null;
}

export function clientBrandContextReconciliationAwaitingSettlementV1(value: unknown) {
  if (!object(value)) return false;
  if (value.state === "awaiting_settlement"
    || value.error === "brand_context_reconciliation_awaiting_settlement"
    || value.error_code === "brand_context_reconciliation_awaiting_settlement") return true;
  return object(value.reconciliation) && value.reconciliation.state === "awaiting_settlement"
    || object(value.brand_context_preparation)
      && value.brand_context_preparation.error_code === "brand_context_reconciliation_awaiting_settlement";
}

export function clientBrandContextProcessingCanConfirmV1(view: ClientBrandContextProcessingViewV1 | null,
  submitting = false) {
  return Boolean(view?.can_start && view.status === "quote_available" && view.quote
    && Date.parse(view.quote.expires_at) > Date.now() && !submitting
    && (!view.operation || ["awaiting_authorization", "stale"].includes(view.operation.state)
      || clientBrandContextProcessingNeedsExplicitRenewalV1(view)
      || clientBrandContextProcessingCanRetrySemanticV1(view)));
}

export function clientBrandContextProcessingConfirmationKindV1(
  view: ClientBrandContextProcessingViewV1
): ClientBrandContextProcessingConfirmationKindV1 {
  if (view.operation?.state === "failed") {
    if (clientBrandContextProcessingCanRetrySemanticV1(view)) return "prepare_brand_context_within_shown_cap";
    if (!clientBrandContextProcessingNeedsExplicitRenewalV1(view))
      throw new Error("brand_context_semantic_renewal_required");
    return "renew_brand_context_semantic_within_shown_cap";
  }
  return view.operation?.state === "awaiting_authorization"
    ? "prepare_brand_context_prototypes_within_shown_cap"
    : "prepare_brand_context_within_shown_cap";
}

export function clientBrandContextProcessingRequestV1(current: ClientBrandContextProcessingPendingRequestV1 | null,
  view: ClientBrandContextProcessingViewV1, createKey: () => string): ClientBrandContextProcessingPendingRequestV1 {
  if (!view.quote || !view.quote.reference) throw new Error("brand_context_processing_quote_required");
  const confirmation = clientBrandContextProcessingConfirmationKindV1(view);
  if (current?.workspaceId === view.workspace_id && current.confirmation === confirmation
    && current.quoteReference === view.quote.reference) return current;
  return { workspaceId: view.workspace_id, key: createKey(), confirmation, quoteObservedAt: view.observed_at,
    quoteReference: view.quote.reference,
    maximumMicroUsd: view.quote.maximum_micro_usd, availableTodayMicroUsd: view.quote.available_today_micro_usd,
    expiresAt: view.quote.expires_at };
}

export function clientBrandContextProcessingConfirmationV1(
  request: ClientBrandContextProcessingPendingRequestV1
): ClientBrandContextProcessingConfirmationV1 {
  return { contract_version: "client-brand-context-processing-request-v1",
    confirmation: request.confirmation, expected_quote: {
      observed_at: request.quoteObservedAt, reference: request.quoteReference,
      maximum_micro_usd: request.maximumMicroUsd,
      available_today_micro_usd: request.availableTodayMicroUsd, expires_at: request.expiresAt
    } };
}

export function validClientBrandContextProcessingConfirmationV1(
  value: unknown
): value is ClientBrandContextProcessingConfirmationV1 {
  if (!object(value) || Object.keys(value).sort().join(",") !== "confirmation,contract_version,expected_quote"
    || value.contract_version !== "client-brand-context-processing-request-v1"
    || typeof value.confirmation !== "string"
    || !confirmationKinds.has(value.confirmation as ClientBrandContextProcessingConfirmationKindV1)
    || !object(value.expected_quote)
    || Object.keys(value.expected_quote).sort().join(",")
      !== "available_today_micro_usd,expires_at,maximum_micro_usd,observed_at,reference") return false;
  return money(value.expected_quote.maximum_micro_usd)
    && money(value.expected_quote.available_today_micro_usd)
    && timestamp(value.expected_quote.observed_at)
    && timestamp(value.expected_quote.expires_at)
    && quoteReference(value.expected_quote.reference);
}

export function clientBrandContextProcessingQuoteReferenceV1(value: string | null | undefined) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value)
    ? `qv1_${value.slice("sha256:".length)}` : null;
}

const publicStatus: Record<SignalBrandContextProcessingQuoteStatusV1,
  ClientBrandContextProcessingQuoteStatusV1> = {
  quoted: "quote_available",
  processing_forbidden: "access_required",
  policy_missing: "configuration_required",
  policy_expired: "configuration_expired",
  policy_revoked: "processing_paused",
  action_missing: "configuration_required",
  action_incompatible: "configuration_required",
  action_unavailable: "processing_paused",
  daily_cap_insufficient: "daily_limit_reached",
  budget_date_changed: "temporarily_unavailable",
  source_required: "brand_context_required",
  source_stale: "brand_context_outdated",
  locale_required: "market_language_required",
  cache_coverage_required: "preparation_required"
};

/** Deliberate allowlist: internal policy, provider, model, action, ledger, source and digest fields never cross this boundary. */
export function toClientBrandContextProcessingQuoteViewV1(
  quote: SignalBrandContextProcessingQuoteV1
): ClientBrandContextProcessingQuoteViewV1 {
  const monetaryStateCurrent = ![
    "processing_forbidden",
    "policy_missing",
    "policy_expired",
    "policy_revoked",
    "budget_date_changed"
  ].includes(quote.quote_status);
  return {
    contract_version: "client-brand-context-processing-quote-view-v1",
    workspace_id: quote.workspace_id,
    status: publicStatus[quote.quote_status],
    can_start: false,
    maximum_micro_usd: monetaryStateCurrent ? quote.maximum_total_micro_usd : null,
    available_today_micro_usd: monetaryStateCurrent && quote.policy ? quote.remaining_micro_usd : null,
    observed_at: quote.quoted_at,
    quote_expires_at: quote.quote_expires_at,
    quote_reference: monetaryStateCurrent && quote.quote_status === "quoted"
      ? clientBrandContextProcessingQuoteReferenceV1(quote.quote_digest) : null
  };
}

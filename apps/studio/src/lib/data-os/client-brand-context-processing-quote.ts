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
};

const publicStatuses = new Set<ClientBrandContextProcessingQuoteStatusV1>([
  "quote_available", "access_required", "configuration_required", "configuration_expired",
  "processing_paused", "daily_limit_reached", "brand_context_required", "brand_context_outdated",
  "market_language_required", "preparation_required", "temporarily_unavailable"
]);
const publicKeys = ["available_today_micro_usd", "can_start", "contract_version", "maximum_micro_usd",
  "observed_at", "quote_expires_at", "status", "workspace_id"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const money = (value: unknown) => typeof value === "string" && /^(0|[1-9][0-9]{0,17})$/u.test(value);
const timestamp = (value: unknown) => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value));
const object = (value: unknown): value is Record<string, unknown> => Boolean(value
  && typeof value === "object" && !Array.isArray(value));

export function validClientBrandContextProcessingQuoteViewV1(
  value: unknown
): value is ClientBrandContextProcessingQuoteViewV1 {
  if (!object(value) || Object.keys(value).sort().join(",") !== publicKeys.join(",")
    || value.contract_version !== "client-brand-context-processing-quote-view-v1"
    || typeof value.workspace_id !== "string" || !uuid.test(value.workspace_id)
    || typeof value.status !== "string" || !publicStatuses.has(value.status as ClientBrandContextProcessingQuoteStatusV1)
    || value.can_start !== false || !(value.maximum_micro_usd === null || money(value.maximum_micro_usd))
    || !(value.available_today_micro_usd === null || money(value.available_today_micro_usd))
    || !timestamp(value.observed_at) || !(value.quote_expires_at === null || timestamp(value.quote_expires_at))) return false;
  return value.status === "quote_available"
    ? value.maximum_micro_usd !== null && value.available_today_micro_usd !== null && value.quote_expires_at !== null
    : value.quote_expires_at === null;
}

export function clientBrandContextProcessingQuoteForWorkspaceV1(
  value: ClientBrandContextProcessingQuoteViewV1 | null,
  workspaceId: string
) {
  return value?.workspace_id === workspaceId && validClientBrandContextProcessingQuoteViewV1(value) ? value : null;
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
    quote_expires_at: quote.quote_expires_at
  };
}

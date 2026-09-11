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

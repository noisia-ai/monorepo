import type { SignalProcessingActionV1, SignalProcessingPolicyActionV1,
  SignalProcessingPolicyStatusV1, SignalProcessingPolicyViewV1 } from "@noisia/db";

export const CLIENT_PROCESSING_POLICY_STATUSES_V1 = [
  "ready", "missing", "expired", "revoked", "daily_cap_exhausted", "provider_unavailable"
] as const;
export type ClientProcessingPolicyStatusV1 = SignalProcessingPolicyStatusV1;

export const CLIENT_PROCESSING_ACTIONS_V1 = [
  "brand_context_proposal", "topic_prototype_embeddings", "corpus_preparation", "corpus_embeddings",
  "topic_fit", "topic_interpretation", "topic_fit_incremental", "topic_interpretation_incremental"
] as const;
export type ClientProcessingActionV1 = SignalProcessingActionV1;

export type ClientProcessingPolicyActionV1 = SignalProcessingPolicyActionV1;
export type ClientProcessingPolicyViewV1 = SignalProcessingPolicyViewV1;

export type ClientProcessingStageV1 = "prepare" | "vectors" | "analyze";
export type ClientProcessingStageStateV1 = "ready" | "blocked" | "unavailable";

const object = (value: unknown): value is Record<string, unknown> => Boolean(value
  && typeof value === "object" && !Array.isArray(value));
const micros = (value: unknown): value is string => typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value);
const digest = (value: unknown): value is string => typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const date = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value);

export function validClientProcessingPolicyViewV1(value: unknown): value is ClientProcessingPolicyViewV1 {
  if (!object(value) || value.contract_version !== "signal-processing-policy-view-v1"
    || typeof value.workspace_id !== "string" || value.workspace_id.length === 0
    || typeof value.can_request_processing !== "boolean"
    || !CLIENT_PROCESSING_POLICY_STATUSES_V1.includes(value.status as ClientProcessingPolicyStatusV1)
    || !(value.budget_date === null || date(value.budget_date)) || !object(value.exposure)
    || ![value.exposure.confirmed_micro_usd, value.exposure.reserved_micro_usd,
      value.exposure.ambiguous_micro_usd, value.exposure.total_micro_usd, value.remaining_micro_usd].every(micros)
    || !Array.isArray(value.actions)) return false;
  const exposure = BigInt(value.exposure.confirmed_micro_usd as string)
    + BigInt(value.exposure.reserved_micro_usd as string)
    + BigInt(value.exposure.ambiguous_micro_usd as string);
  if (exposure !== BigInt(value.exposure.total_micro_usd as string)) return false;
  if (value.policy !== null && (!object(value.policy) || typeof value.policy.id !== "string"
    || !micros(value.policy.version) || BigInt(value.policy.version as string) < 1n
    || !digest(value.policy.digest) || !timestamp(value.policy.valid_from)
    || !timestamp(value.policy.valid_until)
    || typeof value.policy.budget_timezone !== "string" || value.policy.budget_timezone.length === 0
    || !micros(value.policy.daily_cap_micro_usd))) return false;
  if ((value.policy === null) !== (value.status === "missing")) return false;
  if (value.policy === null && (value.budget_date !== null || value.actions.length !== 0
    || BigInt(value.exposure.total_micro_usd as string) !== 0n
    || BigInt(value.remaining_micro_usd as string) !== 0n)) return false;
  if (value.policy) {
    if (value.budget_date === null) return false;
    const cap = BigInt(value.policy.daily_cap_micro_usd as string);
    const expectedRemaining = cap > exposure ? cap - exposure : 0n;
    if (BigInt(value.remaining_micro_usd as string) !== expectedRemaining) return false;
  }
  const seen = new Set<string>();
  for (const entry of value.actions) {
    if (!object(entry) || !CLIENT_PROCESSING_ACTIONS_V1.includes(entry.action as ClientProcessingActionV1)
      || seen.has(String(entry.action)) || !["free", "provider"].includes(String(entry.kind))
      || !(entry.provider === null || entry.provider === "anthropic" || entry.provider === "voyage")
      || !(entry.model === null || typeof entry.model === "string") || !digest(entry.configuration_digest)
      || !micros(entry.max_execution_micro_usd) || typeof entry.automatic_allowed !== "boolean"
      || typeof entry.available !== "boolean") return false;
    if (entry.kind === "free" && (entry.provider !== null || entry.model !== null
      || BigInt(entry.max_execution_micro_usd as string) !== 0n)) return false;
    if (entry.kind === "provider" && (entry.provider === null || typeof entry.model !== "string"
      || entry.model.length === 0)) return false;
    seen.add(String(entry.action));
  }
  return true;
}

const stageActions: Record<ClientProcessingStageV1, ClientProcessingActionV1[]> = {
  prepare: ["corpus_preparation"],
  vectors: ["topic_prototype_embeddings", "corpus_embeddings"],
  analyze: ["topic_fit", "topic_interpretation"]
};

export function clientProcessingStageStateV1(view: ClientProcessingPolicyViewV1,
  stage: ClientProcessingStageV1): ClientProcessingStageStateV1 {
  if (!view.can_request_processing) return "unavailable";
  const required = stageActions[stage];
  const entries = required.map(action => view.actions.find(item => item.action === action));
  if (entries.some(entry => !entry)) return "unavailable";
  return entries.every(entry => entry?.available) ? "ready" : "blocked";
}

/** One product-level ceiling for the initial corpus-to-Topics route; incremental actions are separate. */
export function clientProcessingRouteMaximumMicroUsdV1(view: ClientProcessingPolicyViewV1) {
  const included = new Set<ClientProcessingActionV1>([
    "topic_prototype_embeddings", "corpus_embeddings", "topic_interpretation"
  ]);
  return view.actions.reduce((sum, entry) => included.has(entry.action)
    ? sum + BigInt(entry.max_execution_micro_usd) : sum, 0n).toString();
}

export function formatClientProcessingMicroUsdV1(value: string, locale: string) {
  const amount = BigInt(value);
  if (amount <= BigInt(Number.MAX_SAFE_INTEGER)) return new Intl.NumberFormat(locale, {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6
  }).format(Number(amount) / 1_000_000);
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
  return `USD ${whole.toString()}${fraction ? `.${fraction}` : ""}`;
}

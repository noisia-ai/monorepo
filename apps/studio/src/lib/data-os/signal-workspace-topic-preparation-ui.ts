import type { SignalWorkspaceTopicPrototypeRunV1, SignalWorkspaceTopicPrototypesQuoteV1,
  SignalWorkspaceTopicPrototypesStatusV1 } from "@noisia/db";
import { latestCorpusEmbeddingSnapshot, parseEmbeddingCapMicroUsd } from "./workspace-corpus-embeddings-ui";

type Access = { can_execute: boolean; provider_available: boolean; max_run_cost_micro_usd: number; request_scope: string };
export type TopicPreparationStatus = SignalWorkspaceTopicPrototypesStatusV1 & Access;
export type TopicPreparationQuote = SignalWorkspaceTopicPrototypesQuoteV1 & Access;
export type PendingTopicPreparation = { version: 1; workspace_id: string; request_scope: string; key: string;
  body: { plan_digest: string; quote_digest: string; hard_cap_micro_usd: number } };
const digest = /^sha256:[0-9a-f]{64}$/u;
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const validDigest = (value: unknown): value is string => typeof value === "string" && digest.test(value);
const nullableDigest = (value: unknown) => value === null || validDigest(value);
const blocker = (value: unknown) => value === null || value === "corpus" || value === "topic_prototypes";
const access = (value: Record<string, unknown>) => typeof value.can_execute === "boolean" && typeof value.provider_available === "boolean"
  && integer(value.max_run_cost_micro_usd) && typeof value.request_scope === "string" && value.request_scope.length > 0
  && typeof value.workspace_id === "string" && typeof value.observed_at === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(value.observed_at);

function validRun(value: unknown): value is SignalWorkspaceTopicPrototypeRunV1 | null {
  return value === null || object(value) && typeof value.id === "string" && validDigest(value.plan_digest)
    && ["queued", "running", "completed", "failed", "stale", "outcome_unknown", "canceled"].includes(String(value.status))
    && typeof value.retryable === "boolean" && (value.error_code === null || typeof value.error_code === "string")
    && object(value.counts) && ["total_topics", "completed_topics", "partial_topics", "pending_topics", "total_input_references",
      "processed_input_references", "total_unique_inputs", "processed_unique_inputs", "cache_hits", "embedded_unique_inputs"].every((key) => integer(value.counts && (value.counts as Record<string, unknown>)[key]))
    && ["hard_cap_micro_usd", "estimated_upper_micro_usd", "reserved_micro_usd", "settled_micro_usd", "unknown_reserved_micro_usd", "observed_exception_micro_usd"].every((key) => integer(value[key]));
}
export function validTopicPreparationStatus(value: unknown): value is TopicPreparationStatus {
  return object(value) && value.contract_version === "signal-workspace-topic-prototypes-v1" && access(value)
    && nullableDigest(value.current_plan_digest) && ["available", "no_topics"].includes(String(value.availability))
    && typeof value.is_current === "boolean" && blocker(value.blocking_run_kind)
    && ["active_run", "latest_run", "latest_completed", "request_run"].every((key) => validRun(value[key]))
    && (!value.active_run || ["queued", "running"].includes(String((value.active_run as SignalWorkspaceTopicPrototypeRunV1).status)))
    && (!value.latest_completed || (value.latest_completed as SignalWorkspaceTopicPrototypeRunV1).status === "completed");
}
export function validTopicPreparationQuote(value: unknown): value is TopicPreparationQuote {
  return object(value) && value.contract_version === "signal-workspace-topic-prototypes-quote-v1" && access(value)
    && validDigest(value.plan_digest) && validDigest(value.quote_digest) && blocker(value.blocking_run_kind)
    && typeof value.has_unknown_outcome === "boolean" && typeof value.requires_provider === "boolean"
    && (value.blocking_error_code === null || value.blocking_error_code === "workspace_embedding_outcome_unknown"
      || value.blocking_error_code === "workspace_embedding_prior_response_unusable" || value.blocking_error_code === "workspace_embedding_prior_run_unresolved")
    && ["total_topics", "total_input_references", "total_unique_inputs", "cached_unique_inputs", "missing_unique_inputs", "recoverable_receipt_inputs", "input_bytes", "tokens_upper", "estimated_upper_micro_usd"].every((key) => integer(value[key]))
    && (value.resume_run_id === null || typeof value.resume_run_id === "string" && value.resume_run_id.length > 0)
    && (value.required_cap_micro_usd === null || integer(value.required_cap_micro_usd))
    && (value.resume_run_id === null) === (value.required_cap_micro_usd === null);
}
export function latestTopicPreparation(current: TopicPreparationStatus | null, next: TopicPreparationStatus, workspaceId: string) {
  if (!validTopicPreparationStatus(next)) return current?.workspace_id === workspaceId ? current : null;
  return latestCorpusEmbeddingSnapshot(current?.request_scope === next.request_scope ? current : null, next, workspaceId);
}
export function topicPreparationStorageKey(workspaceId: string, scope: string) {
  return `noisia:topic-preparation:v1:${workspaceId}:${scope}`;
}
export function parsePendingTopicPreparation(value: unknown, workspaceId: string, scope: string): PendingTopicPreparation | null {
  if (!object(value) || Object.keys(value).sort().join(",") !== "body,key,request_scope,version,workspace_id"
    || value.version !== 1 || value.workspace_id !== workspaceId || value.request_scope !== scope
    || typeof value.key !== "string" || !/^[A-Za-z0-9._:-]{8,200}$/u.test(value.key) || !object(value.body)
    || Object.keys(value.body).sort().join(",") !== "hard_cap_micro_usd,plan_digest,quote_digest"
    || !validDigest(value.body.plan_digest) || !validDigest(value.body.quote_digest) || !integer(value.body.hard_cap_micro_usd)) return null;
  return value as PendingTopicPreparation;
}
export function topicPreparationUnknown(status: TopicPreparationStatus | null, quote: TopicPreparationQuote | null) {
  return Boolean(quote?.has_unknown_outcome || quote?.blocking_error_code === "workspace_embedding_outcome_unknown"
    || [status?.active_run, status?.latest_run, status?.request_run].some((run) => run && (run.status === "outcome_unknown" || run.unknown_reserved_micro_usd > 0)));
}
export function topicPreparationCanExecute(status: TopicPreparationStatus | null, quote: TopicPreparationQuote | null, capInput: string) {
  const cap = parseEmbeddingCapMicroUsd(capInput);
  if (!status || !quote || !validTopicPreparationQuote(quote) || !cap || !status.can_execute || !quote.can_execute
    || status.availability !== "available" || status.request_scope !== quote.request_scope || status.workspace_id !== quote.workspace_id
    || status.current_plan_digest !== quote.plan_digest || status.active_run || status.is_current
    || status.blocking_run_kind || quote.blocking_run_kind || quote.blocking_error_code || topicPreparationUnknown(status, quote)
    || (quote.requires_provider && (!status.provider_available || !quote.provider_available))) return false;
  const amount = BigInt(cap);
  const receiptRecovery = quote.resume_run_id !== null && !quote.requires_provider;
  return amount >= BigInt(quote.estimated_upper_micro_usd) && (receiptRecovery || amount <= BigInt(Math.min(status.max_run_cost_micro_usd, quote.max_run_cost_micro_usd)))
    && (quote.required_cap_micro_usd === null || amount === BigInt(quote.required_cap_micro_usd))
    && (quote.requires_provider || quote.required_cap_micro_usd !== null || amount === 0n);
}
export function topicPreparationCanReplay(status: TopicPreparationStatus | null, request: PendingTopicPreparation | null, quote: TopicPreparationQuote | null) {
  if (!status || !request || !status.can_execute || status.active_run || status.blocking_run_kind === "corpus"
    || quote?.blocking_error_code || topicPreparationUnknown(status, quote) || request.workspace_id !== status.workspace_id
    || request.request_scope !== status.request_scope || request.body.plan_digest !== status.current_plan_digest) return false;
  const run = status.request_run;
  const providerAllowed = status.provider_available || Boolean(quote && quote.plan_digest === request.body.plan_digest
    && quote.request_scope === request.request_scope && !quote.requires_provider);
  if (request.body.hard_cap_micro_usd > status.max_run_cost_micro_usd && (!quote || quote.requires_provider)) return false;
  // An acknowledged retry keeps the original execution, quote, cap and checkpoint.
  if (run) return run.status === "failed" && run.retryable && run.plan_digest === request.body.plan_digest && providerAllowed;
  return !status.blocking_run_kind && providerAllowed;
}

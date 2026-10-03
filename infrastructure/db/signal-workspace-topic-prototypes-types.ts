import type { SignalWorkspaceEmbeddingProfileV1 } from "@noisia/query-engine";

export type SignalWorkspaceTopicPrototypeCountsV1 = {
  total_topics: number; completed_topics: number; partial_topics: number; pending_topics: number;
  total_input_references: number; processed_input_references: number;
  total_unique_inputs: number; processed_unique_inputs: number; cache_hits: number; embedded_unique_inputs: number;
};
export type SignalWorkspaceTopicPrototypeRunV1 = {
  id: string; plan_digest: string; status: "queued" | "running" | "completed" | "failed" | "stale" | "outcome_unknown" | "canceled";
  counts: SignalWorkspaceTopicPrototypeCountsV1;
  hard_cap_micro_usd: number; estimated_upper_micro_usd: number; reserved_micro_usd: number;
  settled_micro_usd: number; unknown_reserved_micro_usd: number; observed_exception_micro_usd: number;
  error_code: string | null; retryable: boolean;
  created_at: string; updated_at: string; completed_at: string | null;
};
export type SignalWorkspaceTopicPrototypesStatusV1 = {
  contract_version: "signal-workspace-topic-prototypes-v1";
  workspace_id: string; observed_at: string; current_plan_digest: string | null;
  availability: "available" | "no_topics" | "context_required" | "context_stale";
  active_run: SignalWorkspaceTopicPrototypeRunV1 | null;
  latest_run: SignalWorkspaceTopicPrototypeRunV1 | null;
  latest_completed: SignalWorkspaceTopicPrototypeRunV1 | null;
  request_run: SignalWorkspaceTopicPrototypeRunV1 | null;
  is_current: boolean;
  blocking_run_kind: "corpus" | "topic_prototypes" | null;
};
export type SignalWorkspaceTopicPrototypesQuoteV1 = {
  contract_version: "signal-workspace-topic-prototypes-quote-v1";
  workspace_id: string; plan_digest: string; quote_digest: string; observed_at: string;
  profile: SignalWorkspaceEmbeddingProfileV1;
  total_topics: number; total_input_references: number; total_unique_inputs: number;
  cached_unique_inputs: number; missing_unique_inputs: number;
  recoverable_receipt_inputs: number; requires_provider: boolean;
  input_bytes: number; tokens_upper: number; estimated_upper_micro_usd: number;
  resume_run_id: string | null; required_cap_micro_usd: number | null;
  blocking_run_kind: "corpus" | "topic_prototypes" | null;
  has_unknown_outcome: boolean;
  blocking_error_code: "workspace_embedding_outcome_unknown" | "workspace_embedding_prior_response_unusable" | "workspace_embedding_prior_run_unresolved" | null;
};

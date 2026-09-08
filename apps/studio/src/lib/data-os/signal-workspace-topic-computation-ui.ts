import type { SignalWorkspaceTopicSearchEvidenceV1 } from "@noisia/query-engine";

export type WorkspaceTopicComputationRun = {
  id: string; status: "queued" | "running" | "ready" | "failed"; progress: number;
  denominator: number; processed_roots: number; expected_chunks: number; processed_chunks: number;
  evaluated_topic_pairs: number; retained_candidate_pairs: number; omitted_candidate_pairs: number;
  error_code: string | null; created_at: string; completed_at: string | null;
};
export type WorkspaceTopicComputationStatus = {
  contract_version: "signal-workspace-topic-search-v1"; mode: "workspace" | "legacy";
  workspace_id: string; can_execute: boolean; request_scope: string; observed_at: string;
  preflight: { state: "ready" | "missing_embeddings" | "missing_prototypes" | "needs_preparation" | "awaiting_import" | "awaiting_topics";
    embedding_run_id: string | null; missing_prototypes: number | null };
  active_run: WorkspaceTopicComputationRun | null; latest_run: WorkspaceTopicComputationRun | null;
  latest_ready: WorkspaceTopicComputationRun | null; request_run: WorkspaceTopicComputationRun | null; is_current: boolean;
};
export type WorkspaceTopicComputationResult = {
  root_id: string; text_excerpt: string; scope_status: "unknown" | "authorized";
  semantic_score: number; negative_semantic_score: number | null; ranking_score: number;
  evidence: SignalWorkspaceTopicSearchEvidenceV1;
};
export type WorkspaceTopicComputationResults = {
  execution_id: string; items: WorkspaceTopicComputationResult[]; next_cursor: string | null;
};
export type PendingWorkspaceTopicComputation = {
  workspace_id: string; request_scope: string; key: string; body: { embedding_run_id: string };
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const natural = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const runValid = (value: unknown) => value === null || object(value) && typeof value.id === "string"
  && ["queued", "running", "ready", "failed"].includes(String(value.status))
  && natural(value.progress) && value.progress <= 100 && ["denominator", "processed_roots", "expected_chunks", "processed_chunks",
    "evaluated_topic_pairs", "retained_candidate_pairs", "omitted_candidate_pairs"].every((key) => natural(value[key]))
  && (value.error_code === null || typeof value.error_code === "string") && typeof value.created_at === "string"
  && (value.completed_at === null || typeof value.completed_at === "string");

export function validWorkspaceTopicComputationStatus(value: unknown): value is WorkspaceTopicComputationStatus {
  return object(value) && value.contract_version === "signal-workspace-topic-search-v1"
    && ["workspace", "legacy"].includes(String(value.mode)) && typeof value.workspace_id === "string"
    && typeof value.request_scope === "string" && value.request_scope.length > 0 && typeof value.can_execute === "boolean"
    && typeof value.is_current === "boolean" && typeof value.observed_at === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(value.observed_at)
    && object(value.preflight) && ["ready", "missing_embeddings", "missing_prototypes", "needs_preparation", "awaiting_import", "awaiting_topics"].includes(String(value.preflight.state))
    && (value.preflight.embedding_run_id === null || typeof value.preflight.embedding_run_id === "string")
    && (value.preflight.missing_prototypes === null || natural(value.preflight.missing_prototypes))
    && [value.active_run, value.latest_run, value.latest_ready, value.request_run].every(runValid)
    && (value.latest_ready === null || object(value.latest_ready) && value.latest_ready.status === "ready")
    && (value.active_run === null || object(value.active_run) && ["queued", "running"].includes(String(value.active_run.status)));
}

export function latestWorkspaceTopicComputation(current: WorkspaceTopicComputationStatus | null,
  next: unknown, workspaceId: string): WorkspaceTopicComputationStatus | null {
  const previous = current?.workspace_id === workspaceId ? current : null;
  if (!validWorkspaceTopicComputationStatus(next) || next.workspace_id !== workspaceId) return previous;
  if (previous?.request_scope === next.request_scope && previous.observed_at > next.observed_at) return previous;
  return next;
}

export function workspaceTopicRequestStorageKey(workspaceId: string, requestScope: string) {
  return `noisia:workspace-topic-search:v1:${workspaceId}:${requestScope}`;
}
export function parsePendingWorkspaceTopicComputation(value: unknown, workspaceId: string, requestScope: string): PendingWorkspaceTopicComputation | null {
  if (!object(value) || Object.keys(value).sort().join(",") !== "body,key,request_scope,workspace_id"
    || value.workspace_id !== workspaceId || value.request_scope !== requestScope || typeof value.key !== "string"
    || !uuid.test(value.key) || !object(value.body) || Object.keys(value.body).join(",") !== "embedding_run_id"
    || typeof value.body.embedding_run_id !== "string" || !uuid.test(value.body.embedding_run_id)) return null;
  return value as PendingWorkspaceTopicComputation;
}
export function workspaceTopicSearchCanStart(data: WorkspaceTopicComputationStatus | null) {
  return Boolean(data?.mode === "workspace" && data.can_execute && !data.active_run
    && !["queued", "running"].includes(data.request_run?.status ?? "")
    && data.preflight.state === "ready" && data.preflight.embedding_run_id && uuid.test(data.preflight.embedding_run_id));
}
export function validWorkspaceTopicComputationResults(value: unknown, executionId: string): value is WorkspaceTopicComputationResults {
  return object(value) && value.execution_id === executionId && Array.isArray(value.items)
    && (value.next_cursor === null || typeof value.next_cursor === "string") && value.items.every((item: unknown) => object(item)
      && typeof item.root_id === "string" && typeof item.text_excerpt === "string" && ["unknown", "authorized"].includes(String(item.scope_status))
      && Number.isFinite(item.semantic_score) && Number.isFinite(item.ranking_score)
      && (item.negative_semantic_score === null || Number.isFinite(item.negative_semantic_score))
      && object(item.evidence) && item.evidence.quality === "uncalibrated" && item.evidence.approval_policy === "none"
      && natural(item.evidence.evaluated_chunk_count) && object(item.evidence.best_chunk)
      && natural(item.evidence.best_chunk.chunk_index));
}

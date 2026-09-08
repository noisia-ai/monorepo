import type { SignalWorkspaceEngineStatusV1 } from "@noisia/db";
import { embeddingCapUsdInput, latestCorpusEmbeddingSnapshot, parseEmbeddingCapMicroUsd } from "./workspace-corpus-embeddings-ui";

export type WorkspaceAnalysisRun = NonNullable<SignalWorkspaceEngineStatusV1["latest_run"]> & {
  retryable: boolean; outcome_unknown: boolean;
  claude_cost: { hard_cap_micro_usd: number; settled_micro_usd: number;
    reserved_micro_usd: number; unknown_reserved_micro_usd: number };
};
export type WorkspaceAnalysisStatus = Omit<SignalWorkspaceEngineStatusV1, "latest_run" | "latest_complete"> & {
  contract_version: "signal-workspace-analysis-v1";
  request_scope: string; can_execute: boolean;
  preflight: { state: "ready" | "awaiting_import" | "needs_preparation" | "missing_embeddings" | "missing_context";
    embedding_run_id: string | null; context_digest: string | null; catalog_digest: string | null;
    cost: { claude: { estimated_upper_micro_usd: number | null; maximum_cap_micro_usd: number; provider_available: boolean };
      voyage: { estimated_upper_micro_usd: number } } };
  active_run: WorkspaceAnalysisRun | null; latest_run: WorkspaceAnalysisRun | null;
  latest_complete: WorkspaceAnalysisRun | null; request_run: WorkspaceAnalysisRun | null;
};
export type WorkspaceAnalysisRequest = { action: "start"; embedding_run_id: string;
  expected_context_digest: string; expected_catalog_digest: string; claude_cap_micro_usd: number }
  | { action: "retry"; run_id: string };
export type PendingWorkspaceAnalysis = { version: 1; workspace_id: string; request_scope: string;
  key: string; body: WorkspaceAnalysisRequest };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value);
const digest = (value: unknown): value is string => typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
const nullable = (value: unknown, predicate: (item: unknown) => boolean) => value === null || predicate(value);

export function validWorkspaceAnalysisRun(value: unknown): value is WorkspaceAnalysisRun | null {
  return value === null || object(value) && uuid(value.execution_id)
    && ["queued", "running", "ready", "failed"].includes(String(value.status))
    && ["queued", "exporting", "fitting", "persisting", "interpreting", "materializing", "complete", "failed"].includes(String(value.phase))
    && integer(value.progress) && value.progress <= 100
    && ["expected_roots", "expected_chunks", "expected_guides", "processed_roots", "processed_chunks", "artifact_count",
      "expected_interpretation_units", "interpreted_units", "materialized_topics"].every((key) => integer(value[key]))
    && Number(value.processed_roots) <= Number(value.expected_roots) && Number(value.processed_chunks) <= Number(value.expected_chunks)
    && typeof value.fit_completed === "boolean" && Number(value.interpreted_units) <= Number(value.expected_interpretation_units)
    && typeof value.is_current === "boolean" && typeof value.retryable === "boolean" && typeof value.outcome_unknown === "boolean"
    && integer(value.claude_cap_micro_usd) && [null, "computational_grouping", "insufficient_population"].includes(value.result_kind as null | string)
    && nullable(value.error_code, (code) => typeof code === "string") && nullable(value.model_version_id, uuid)
    && object(value.claude_cost) && ["hard_cap_micro_usd", "settled_micro_usd", "reserved_micro_usd", "unknown_reserved_micro_usd"]
      .every((key) => integer((value.claude_cost as Record<string, unknown>)[key]));
}
export function workspaceAnalysisInterpretedComplete(run: WorkspaceAnalysisRun | null) {
  return Boolean(run?.status === "ready" && run.phase === "complete" && run.fit_completed
    && run.interpreted_units === run.expected_interpretation_units);
}
export function validWorkspaceAnalysisStatus(value: unknown): value is WorkspaceAnalysisStatus {
  if (!object(value) || value.contract_version !== "signal-workspace-analysis-v1" || typeof value.workspace_id !== "string"
    || typeof value.request_scope !== "string" || !value.request_scope || typeof value.can_execute !== "boolean"
    || typeof value.observed_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(value.observed_at)
    || !object(value.preflight) || !object(value.preflight.cost) || !object(value.preflight.cost.claude) || !object(value.preflight.cost.voyage)) return false;
  const preflight = value.preflight, claude = value.preflight.cost.claude, voyage = value.preflight.cost.voyage;
  return ["ready", "awaiting_import", "needs_preparation", "missing_embeddings", "missing_context"].includes(String(preflight.state))
    && nullable(preflight.embedding_run_id, uuid) && nullable(preflight.context_digest, digest) && nullable(preflight.catalog_digest, digest)
    && (preflight.state !== "ready" || uuid(preflight.embedding_run_id) && digest(preflight.context_digest) && digest(preflight.catalog_digest))
    && nullable(claude.estimated_upper_micro_usd, integer) && integer(claude.maximum_cap_micro_usd)
    && typeof claude.provider_available === "boolean" && integer(voyage.estimated_upper_micro_usd)
    && ["active_run", "latest_run", "latest_complete", "request_run"].every((key) => validWorkspaceAnalysisRun(value[key]))
    && (!value.active_run || ["queued", "running"].includes((value.active_run as WorkspaceAnalysisRun).status))
    && (!value.latest_complete || (value.latest_complete as WorkspaceAnalysisRun).status === "ready")
    && nullable(value.latest_complete_execution_id, uuid);
}
export function latestWorkspaceAnalysis(current: WorkspaceAnalysisStatus | null, next: WorkspaceAnalysisStatus, workspaceId: string) {
  if (!validWorkspaceAnalysisStatus(next)) return current?.workspace_id === workspaceId ? current : null;
  return latestCorpusEmbeddingSnapshot(current?.request_scope === next.request_scope ? current : null, next, workspaceId);
}
export function workspaceAnalysisStorageKey(workspaceId: string, scope: string) {
  return `noisia:workspace-analysis:v1:${workspaceId}:${scope}`;
}
export function parsePendingWorkspaceAnalysis(value: unknown, workspaceId: string, scope: string): PendingWorkspaceAnalysis | null {
  if (!object(value) || Object.keys(value).sort().join(",") !== "body,key,request_scope,version,workspace_id"
    || value.version !== 1 || value.workspace_id !== workspaceId || value.request_scope !== scope
    || typeof value.key !== "string" || !/^[A-Za-z0-9._:-]{8,200}$/u.test(value.key) || !object(value.body)) return null;
  const body = value.body;
  if (body.action === "start" ? Object.keys(body).sort().join(",") !== "action,claude_cap_micro_usd,embedding_run_id,expected_catalog_digest,expected_context_digest"
    || !uuid(body.embedding_run_id) || !digest(body.expected_catalog_digest) || !digest(body.expected_context_digest) || !integer(body.claude_cap_micro_usd)
    : body.action !== "retry" || Object.keys(body).sort().join(",") !== "action,run_id" || !uuid(body.run_id)) return null;
  return value as PendingWorkspaceAnalysis;
}
export function workspaceAnalysisUnknown(status: WorkspaceAnalysisStatus | null) {
  return [status?.active_run, status?.latest_run, status?.request_run].some((run) => run
    && (run.outcome_unknown || run.claude_cost.unknown_reserved_micro_usd > 0));
}
export function workspaceAnalysisDefaultCap(status: WorkspaceAnalysisStatus | null) {
  const cost = status?.preflight.cost.claude;
  return embeddingCapUsdInput(String(cost?.estimated_upper_micro_usd ?? cost?.maximum_cap_micro_usd ?? 0));
}
export function workspaceAnalysisCanStart(status: WorkspaceAnalysisStatus | null, capInput: string) {
  const cap = parseEmbeddingCapMicroUsd(capInput);
  if (!status || !cap || !status.can_execute || status.active_run || workspaceAnalysisUnknown(status)
    || status.preflight.state !== "ready") return false;
  const cost = status.preflight.cost.claude;
  return cost.provider_available && cost.maximum_cap_micro_usd > 0 && BigInt(cap) > 0n
    && (cost.estimated_upper_micro_usd === null || BigInt(cap) >= BigInt(cost.estimated_upper_micro_usd))
    && BigInt(cap) <= BigInt(cost.maximum_cap_micro_usd);
}
export function workspaceAnalysisCanRetry(status: WorkspaceAnalysisStatus | null, run: WorkspaceAnalysisRun | null) {
  return Boolean(status?.can_execute && !status.active_run && !workspaceAnalysisUnknown(status)
    && run?.status === "failed" && run.retryable && run.is_current && !run.outcome_unknown);
}
export function workspaceAnalysisCanReplay(status: WorkspaceAnalysisStatus, request: PendingWorkspaceAnalysis) {
  if (status.workspace_id !== request.workspace_id || status.request_scope !== request.request_scope
    || !status.can_execute || status.active_run || workspaceAnalysisUnknown(status) || status.request_run) return false;
  return request.body.action === "retry"
    ? status.latest_run?.execution_id === request.body.run_id && workspaceAnalysisCanRetry(status, status.latest_run)
    : status.preflight.embedding_run_id === request.body.embedding_run_id
      && status.preflight.context_digest === request.body.expected_context_digest && status.preflight.catalog_digest === request.body.expected_catalog_digest
      && workspaceAnalysisCanStart(status, embeddingCapUsdInput(String(request.body.claude_cap_micro_usd)));
}
export function workspaceAnalysisErrorKey(code: string) {
  if (["load", "request", "storage", "forbidden"].includes(code)) return code;
  if (/context|catalog|input|embedding.*changed|stale/u.test(code)) return "changed";
  return "failed";
}

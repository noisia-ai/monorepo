/** Read-only update descriptor. Editorial requests and their monetary receipts
 * remain in the original analysis contract, never inferred from this stage. */
import type { SignalWorkspaceAnalysisUpdateV1, SignalWorkspaceNumericReadinessV1 } from "@noisia/db";
export type WorkspaceAnalysisUpdate = SignalWorkspaceAnalysisUpdateV1;
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(v);
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const digest = (v: unknown) => typeof v === "string" && /^sha256:[0-9a-f]{64}$/u.test(v);
const revision = (v: unknown) => typeof v === "string" && /^(0|[1-9][0-9]*)$/u.test(v);
const error = (v: unknown) => v === null || typeof v === "string";
const progress = (v: unknown): v is Record<string, unknown> => object(v) && uuid(v.execution_id)
  && ["queued", "running", "ready", "failed"].includes(String(v.status)) && integer(v.expected_roots)
  && integer(v.processed_roots) && v.processed_roots <= v.expected_roots && typeof v.is_current === "boolean" && error(v.error_code);
export function validWorkspaceAnalysisUpdate(value: unknown): value is WorkspaceAnalysisUpdate | null | undefined {
  if (value === undefined || value === null) return true;
  if (!object(value) || !revision(value.desired_revision) || !revision(value.input_revision) || typeof value.has_pending_work !== "boolean"
    || !progress(value.numeric) || typeof value.numeric.phase !== "string" || !integer(value.numeric.progress) || value.numeric.progress > 100
    || !(value.projection === null || progress(value.projection) && uuid(value.projection.generation_id))
    || !(value.derivation === null || object(value.derivation) && typeof value.derivation.status === "string" && error(value.derivation.error_code))) return false;
  const serving = value.serving;
  if (serving === null) return true;
  if (!object(serving) || !uuid(serving.generation_id) || !revision(serving.input_revision) || typeof serving.is_current !== "boolean") return false;
  const coverage = serving.interpretation_coverage, discovery = serving.discovery_coverage;
  return (coverage === null || object(coverage) && integer(coverage.interpreted_unit_count) && integer(coverage.expected_unit_count)
    && coverage.interpreted_unit_count <= coverage.expected_unit_count && typeof coverage.complete === "boolean"
    && coverage.complete === (coverage.interpreted_unit_count === coverage.expected_unit_count)
    && digest(coverage.unit_digest) && digest(coverage.expected_unit_digest) && (!coverage.complete || coverage.unit_digest === coverage.expected_unit_digest))
    && (discovery === null || object(discovery) && ["complete", "pending_insufficient_population", "pending_cohort_close"].includes(String(discovery.state))
      && integer(discovery.pending_roots) && (discovery.state === "complete") === (discovery.pending_roots === 0));
}
export function workspaceAnalysisUpdateState(update: WorkspaceAnalysisUpdate) {
  if (update.numeric.status === "failed" || !update.has_pending_work && (update.projection?.status === "failed"
    || update.derivation?.error_code || ["failed", "dead_letter"].includes(update.derivation?.status ?? ""))) return "failed";
  if (!update.numeric.is_current) return "outdated";
  if (update.projection && ["queued", "running"].includes(update.projection.status)) return "projecting";
  if (["queued", "running"].includes(update.numeric.status)) return "numeric";
  if (update.has_pending_work) return "pending";
  if (update.serving?.is_current && update.serving.input_revision === update.input_revision) return "ready";
  return "outdated";
}
export function workspaceAnalysisAssociationReceipt(workspaceId: string, requestScope: string, update: WorkspaceAnalysisUpdate | null | undefined) {
  return update?.serving ? JSON.stringify([workspaceId, requestScope, update.serving.generation_id,
    update.serving.input_revision, update.serving.is_current, update.has_pending_work]) : null;
}

export type WorkspaceNumericReadiness = SignalWorkspaceNumericReadinessV1;
export function validWorkspaceNumericReadiness(value: unknown, workspaceId: string): value is WorkspaceNumericReadiness | null | undefined {
  return value === undefined || value === null || object(value) && value.contract_version === "workspace-numeric-readiness-v1"
    && value.workspace_id === workspaceId && (value.desired_revision === null || revision(value.desired_revision))
    && ["not_enabled", "waiting_preparation", "waiting_embeddings", "blocked", "ready_to_schedule", "already_handled"].includes(String(value.state))
    && error(value.reason_code) && typeof value.has_pending_work === "boolean"
    && (value.execution_id === null || uuid(value.execution_id)) && (value.embedding_run_id === null || uuid(value.embedding_run_id));
}
/** A readiness check never creates a run. Only existing queue work may poll
 * indefinitely; the pre-admission gap receives a bounded series of reads. */
export function workspaceNumericAdmissionPoll(value: WorkspaceNumericReadiness | null | undefined) {
  if (!value?.has_pending_work) return null;
  const kind = value.state === "ready_to_schedule" ? "bounded" : ["waiting_preparation", "waiting_embeddings"].includes(value.state) ? "durable" : null;
  return kind ? { kind, key: JSON.stringify([value.workspace_id, value.desired_revision, value.state, value.embedding_run_id]) } : null;
}
export function workspaceNumericReadinessMessage(value: WorkspaceNumericReadiness) {
  if (value.state === "not_enabled") return value.reason_code === "new_input_revision_required" ? "noNewData" : "firstAnalysis";
  if (value.state !== "blocked") return value.state;
  if (["corpus_preparation_required", "corpus_preparation_not_current"].includes(value.reason_code ?? "")) return "prepareText";
  if (["corpus_embeddings_required", "corpus_embeddings_not_current"].includes(value.reason_code ?? "")) return "prepareAnalysis";
  if (value.reason_code === "workspace_engine_guides_required") return "prepareContext";
  if (value.reason_code === "numeric_parent_context_changed") return "contextChanged";
  if (value.reason_code === "workspace_engine_incremental_parent_unavailable") return "noCompatibleResult";
  if (["numeric_actor_forbidden", "workspace_engine_forbidden"].includes(value.reason_code ?? "")) return "permission";
  return "blocked";
}

import type { AdminBrandWorkspaceRow } from "./admin-workspace";
import { workspaceAnalysisInterpretedComplete, type WorkspaceAnalysisStatus } from "../data-os/signal-workspace-analysis-ui";

export type AdminCorpusSummary = NonNullable<AdminBrandWorkspaceRow["corpus"]>;

/** SQL already localized these calendar dates to the workspace. UTC formatting
 * preserves the calendar day on server and browser without a second conversion. */
export function adminCorpusDateRange(corpus: AdminCorpusSummary | null, locale: string) {
  if (!corpus?.coverage.from || !corpus.coverage.through) return "—";
  const formatter = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${formatter.format(new Date(`${corpus.coverage.from}T12:00:00Z`))} – ${formatter.format(new Date(`${corpus.coverage.through}T12:00:00Z`))}`;
}
export function adminCorpusState(corpus: AdminCorpusSummary | null) {
  if (!corpus || corpus.measurement_state === "unavailable") return "unavailable";
  return corpus.state === "received" && corpus.measurement_state === "partial" ? "partial" : corpus.state;
}
export function adminCorpusTone(corpus: AdminCorpusSummary | null) {
  return corpus?.state === "received" && corpus.measurement_state === "complete" ? "good" : corpus && (corpus.state === "needs_attention" || corpus.measurement_state === "partial") ? "warning" : "not_available";
}
export function adminCorpusNeedsImport(corpus: AdminCorpusSummary | null) {
  return corpus?.received_unique_roots === 0 && corpus.measurement_state === "complete"
    && corpus.state === "awaiting_import" && corpus.accepted_files === 0 && corpus.reconciliation_errors.length === 0;
}
export function adminCorpusAnalysisStep(corpus: AdminCorpusSummary | null, analysis: WorkspaceAnalysisStatus | null) {
  if (!corpus || corpus.received_unique_roots === null) return "unavailable";
  if (corpus.received_unique_roots === 0) return adminCorpusNeedsImport(corpus) ? "awaiting_import" : "receipt_attention";
  if (!analysis) return "unavailable";
  const run = analysis.active_run ?? analysis.latest_run;
  if (run?.status === "queued" || run?.status === "running") return "running";
  if (run && !run.is_current) return "changed";
  if (run?.status === "failed") return run.error_code === "workspace_engine_interpretation_daily_authority_expired" ? "authorization_expired" : "interrupted";
  if (workspaceAnalysisInterpretedComplete(run)) return run!.expected_interpretation_units === 0 ? "no_groups" : "complete";
  if (run?.fit_completed) return "interpretation_pending";
  // A contradictory readiness payload must not send someone with received mentions back to import.
  return analysis.preflight.state === "awaiting_import" ? "unavailable" : analysis.preflight.state;
}

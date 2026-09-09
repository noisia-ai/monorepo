import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AdminSettingsRow, AdminStatus, AdminSummaryStrip, formatAdminNumber } from "./AdminWorkspacePrimitives";
import { adminCorpusAnalysisStep, adminCorpusDateRange, adminCorpusState, adminCorpusTone, type AdminCorpusSummary } from "@/lib/data/admin-corpus-presentation";
import type { WorkspaceAnalysisStatus } from "@/lib/data-os/signal-workspace-analysis-ui";

export function AdminCorpusReceipt({ corpus }: { corpus: AdminCorpusSummary | null }) {
  const t = useTranslations("AdminWorkspace.corpusSummary");
  const locale = useLocale();
  return <div className="admin-table__primary">
    <strong>{corpus?.received_unique_roots != null ? formatAdminNumber(corpus.received_unique_roots, locale) : "—"}</strong>
    <small>{corpus?.received_unique_roots != null ? t("files", { count: corpus.accepted_files }) : t("states.unavailable")}</small>
  </div>;
}
export function AdminCorpusCoverage({ corpus }: { corpus: AdminCorpusSummary | null }) {
  const t = useTranslations("AdminWorkspace.corpusSummary");
  const locale = useLocale();
  return <div className="admin-table__primary">
    <span>{adminCorpusDateRange(corpus, locale)}</span>
    <small>{t(`coverage.${corpus?.coverage.state ?? "unavailable"}`)}</small>
  </div>;
}
export function AdminCorpusStatus({ corpus }: { corpus: AdminCorpusSummary | null }) {
  const t = useTranslations("AdminWorkspace.corpusSummary");
  return <AdminStatus state={adminCorpusTone(corpus)}>{t(`states.${adminCorpusState(corpus)}`)}</AdminStatus>;
}
export function AdminCorpusSummaryStrip({ corpus }: { corpus: AdminCorpusSummary | null }) {
  const t = useTranslations("AdminWorkspace.corpusSummary");
  const locale = useLocale();
  return <AdminSummaryStrip items={[
    { label: t("received"), value: corpus?.received_unique_roots != null ? formatAdminNumber(corpus.received_unique_roots, locale) : "—", hint: t(corpus?.measurement_state === "partial" ? "receivedPartialHint" : "receivedHint") },
    { label: t("filesTitle"), value: corpus ? formatAdminNumber(corpus.accepted_files, locale) : "—", hint: corpus ? t("rows", { count: corpus.records_read }) : t("states.unavailable") },
    { label: t("dates"), value: adminCorpusDateRange(corpus, locale), hint: t(`coverage.${corpus?.coverage.state ?? "unavailable"}`) },
    { label: t("reception"), value: <AdminCorpusStatus corpus={corpus} />, hint: t("receptionHint") }
  ]} />;
}
export function AdminCorpusProgress({ corpus, analysis, brandId, workspaceSlug }: {
  corpus: AdminCorpusSummary | null; analysis: WorkspaceAnalysisStatus | null; brandId: string; workspaceSlug: string | null;
}) {
  const t = useTranslations("AdminWorkspace.corpusSummary");
  const run = analysis?.active_run ?? analysis?.latest_run;
  const step = adminCorpusAnalysisStep(corpus, analysis);
  const needsData = ["awaiting_import", "receipt_attention", "needs_preparation", "missing_embeddings"].includes(step);
  const href = `/studio/brands/${encodeURIComponent(brandId)}/${needsData ? "data#corpus-readiness" : "topics"}`;
  return <div className="admin-settings-list admin-corpus-progress">
    <AdminSettingsRow title={t("received")} description={t("receivedHint")} value={<AdminCorpusStatus corpus={corpus} />} />
    <AdminSettingsRow title={t("analysis")} description={<>
      {t(`steps.${step}`)}
      {run && run.expected_interpretation_units > 0 ? <> {t("interpreted", { done: run.interpreted_units, total: run.expected_interpretation_units })}</> : null}
      {run && !run.is_current ? <> {t("previousRun")}</> : null}
    </>} action={<Link className="admin-button admin-button--compact" href={href} prefetch={false}>{t(needsData ? "openData" : "openTopics")}</Link>} />
    <AdminSettingsRow title="Signal" description={t("signalHint")} action={workspaceSlug ? <Link className="admin-button admin-button--compact" href={`/signal/${encodeURIComponent(workspaceSlug)}/topics-narratives`} prefetch={false}>{t("openSignal")}</Link> : undefined} />
  </div>;
}

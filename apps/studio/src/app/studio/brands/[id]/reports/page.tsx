import Link from "next/link";
import { ArrowRight, FileText } from "@phosphor-icons/react/dist/ssr";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import {
  AdminResourceSection,
  AdminSettingsRow,
  AdminStatus,
  AdminWorkspaceHeader,
  formatAdminDate
} from "@/components/admin/AdminWorkspacePrimitives";
import { StrategicReportLauncher } from "@/components/admin/StrategicReportLauncher";
import { StrategicAuthorityManager } from "@/components/admin/StrategicAuthorityManager";
import { StrategicReleaseManager } from "@/components/admin/StrategicReleaseManager";
import { requireStudioUser } from "@/lib/auth/guards";
import { getAdminBrandWorkspace } from "@/lib/data/admin-workspace";
import { loadSignalStrategicProductStatusV1 } from "@/lib/data-os/signal-strategic-product";
import { loadSignalStrategicReleasesV1 } from "@/lib/data-os/signal-strategic-releases";
import { resolveSignalWorkspaceForUser } from "@/lib/data-os/signal-workspace";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function BrandReportsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, locale, session] = await Promise.all([
    getTranslations("AdminWorkspace"),
    getLocale(),
    requireStudioUser(`/studio/brands/${id}/reports`)
  ]);
  const workspace = await getAdminBrandWorkspace(session.appUser, id);
  if (!workspace) notFound();
  const { summary } = workspace;
  const report = workspace.reports.find((item) => item.reportKey === "triggers-barriers") ?? null;
  const resolvedWorkspace = summary.workspaceId && session.appUser.userType === "noisia_internal"
    ? await resolveSignalWorkspaceForUser(session.appUser, { workspaceId: summary.workspaceId })
    : null;
  const strategicAuthority = resolvedWorkspace
    ? await loadSignalStrategicProductStatusV1({ queryable: pool, workspace: resolvedWorkspace, actor: session.appUser })
    : null;
  const releases = resolvedWorkspace
    ? await loadSignalStrategicReleasesV1(resolvedWorkspace,session.appUser.userType === "noisia_internal")
    : null;
  const preflight = [
    { key: "sources", passed: summary.activeSources > 0 },
    { key: "coverage", passed: summary.governedMentions > 0 && summary.coverageState === "good" },
    { key: "quality", passed: summary.qualityState !== "danger" },
    { key: "population", passed: Boolean(summary.populationId && summary.populationVersion) },
    { key: "timezone", passed: Boolean(summary.timezone) }
  ];

  return (
    <div className="admin-workspace-page">
      <AdminWorkspaceHeader
        actions={summary.workspaceSlug && report?.currentRevision ? (
          <Link className="admin-button" href={`/signal/${summary.workspaceSlug}/reports/triggers-barriers`} prefetch={false}>
            {t("reports.actions.openCurrent")}<ArrowRight aria-hidden size={14} />
          </Link>
        ) : undefined}
        eyebrow={`${summary.brandName} · ${t("reports.eyebrow")}`}
        icon={<FileText aria-hidden size={21} weight="fill" />}
        subtitle={t("reports.subtitle")}
        title={t("reports.title")}
      />

      <dl className="admin-summary-strip">
        <div><dt>{t("reports.summary.current")}</dt><dd>{report?.currentRevision ? `r${report.currentRevision}` : "—"}</dd><small>{t(`reports.states.${summary.reportState}`)}</small></div>
        <div><dt>{t("reports.summary.review")}</dt><dd>{report?.runsNeedingReview ?? 0}</dd><small>{t("reports.summary.reviewHint")}</small></div>
        <div>
          <dt>{t("reports.summary.population")}</dt>
          <dd>{strategicAuthority?.population?.denominator_count ?? "—"}</dd>
          <small>triggers-barriers / strategic</small>
        </div>
        <div><dt>{t("reports.summary.lastRun")}</dt><dd><AdminStatus state={runTone(report?.latestRunStatus)}>{report?.latestRunStatus ? t(`reports.states.${report.latestRunStatus}`) : t("reports.states.not_available")}</AdminStatus></dd><small>{formatAdminDate(report?.latestRunAt, locale)}</small></div>
      </dl>

      <section className="admin-two-column">
        <AdminResourceSection
          actions={<StrategicReportLauncher authorityReady={strategicAuthority?.state === "current"} report={report} summary={summary} />}
          subtitle={t("reports.registry.subtitle")}
          title={t("reports.registry.title")}
        >
          <div className="admin-settings-list">
            <AdminSettingsRow title={t("reports.registry.identity")} value="triggers-barriers" />
            <AdminSettingsRow title={t("reports.registry.status")} value={<AdminStatus state={report?.status === "active" ? "good" : "warning"}>{report?.status ? t(`states.${report.status}`) : t("states.not_available")}</AdminStatus>} />
            <AdminSettingsRow title={t("reports.registry.current")} value={report?.currentRevision ? `r${report.currentRevision}` : t("reports.states.not_available")} />
            <AdminSettingsRow title={t("reports.registry.published")} value={formatAdminDate(report?.currentReleasePublishedAt, locale)} />
          </div>
        </AdminResourceSection>
        <AdminResourceSection subtitle={t("reports.preflight.subtitle")} title={t("reports.preflight.title")}>
          <div className="admin-settings-list">
            {preflight.map((item) => (
              <AdminSettingsRow
                key={item.key}
                title={t(`reports.preflight.items.${item.key}`)}
                value={<AdminStatus state={item.passed ? "good" : "danger"}>{t(item.passed ? "states.ready" : "states.blocked")}</AdminStatus>}
              />
            ))}
          </div>
        </AdminResourceSection>
      </section>

      {strategicAuthority && summary.workspaceId ? (
        <StrategicAuthorityManager initial={strategicAuthority} workspaceId={summary.workspaceId} />
      ) : null}

      {releases && summary.workspaceId && summary.workspaceSlug ? (
        <StrategicReleaseManager
          history={releases.history}
          workspaceId={summary.workspaceId}
          workspaceSlug={summary.workspaceSlug}
        />
      ) : null}

      {report?.latestRunStatus === "needs_review"
        && report.latestRunId
        && (report.latestRunContractVersion === "signal-tb-strategic-v2"
          || report.executionCorpusId) ? (
        <section className="admin-section">
          <header className="admin-section__head">
            <div><h2>{t("reports.review.title")}</h2><p>{t("reports.review.subtitle")}</p></div>
            <Link
              className="admin-button admin-button--primary"
              href={report.latestRunContractVersion === "signal-tb-strategic-v2"
                ? `/studio/brands/${id}/reports/runs/${report.latestRunId}`
                : `/studio/corpora/${report.executionCorpusId}/analysis/${report.latestRunId}`}
              prefetch={false}
            >
              {t("reports.review.open")}<ArrowRight aria-hidden size={14} />
            </Link>
          </header>
        </section>
      ) : null}
    </div>
  );
}

function runTone(state: string | null | undefined) {
  if (state === "approved_by_im" || state === "approved_by_kam" || state === "done"
    || state === "completed") return "good" as const;
  if (state === "failed" || state === "aborted_preflight") return "danger" as const;
  if (state) return "warning" as const;
  return "not_available" as const;
}

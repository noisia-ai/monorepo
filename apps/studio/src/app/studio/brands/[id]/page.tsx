import Link from "next/link";
import { ArrowRight, FileText, Gauge, Plus } from "@phosphor-icons/react/dist/ssr";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import {
  AdminResourceSection,
  AdminSettingsRow,
  AdminStatus,
  AdminWorkspaceHeader,
  formatAdminDate,
  formatAdminNumber
} from "@/components/admin/AdminWorkspacePrimitives";
import { requireStudioUser } from "@/lib/auth/guards";
import {
  getAdminBrandWorkspace,
  type AdminBrandWorkspace
} from "@/lib/data/admin-workspace";
import { getBrandDetailForUser } from "@/lib/data/brands";

export const dynamic = "force-dynamic";

export default async function BrandWorkspaceOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, locale, session] = await Promise.all([
    getTranslations("AdminWorkspace"),
    getLocale(),
    requireStudioUser(`/studio/brands/${id}`)
  ]);
  const [workspace, brand] = await Promise.all([
    getAdminBrandWorkspace(session.appUser, id),
    getBrandDetailForUser(session.appUser, id)
  ]);
  if (!workspace || !brand) notFound();
  const { summary } = workspace;
  const currentReport = workspace.reports.find((report) => report.reportKey === "triggers-barriers") ?? null;
  const issues = workspaceIssues(workspace);

  return (
    <div className="admin-workspace-page">
      <AdminWorkspaceHeader
        actions={(
          <>
            {summary.workspaceSlug ? (
              <Link className="admin-button" href={`/signal/${summary.workspaceSlug}`} prefetch={false}>
                <Gauge aria-hidden size={15} />{t("brand.actions.openSignal")}
              </Link>
            ) : null}
            <Link className="admin-button" href={`/studio/brands/${summary.brandId}/data?action=add-source`} prefetch={false}>
              <Plus aria-hidden size={15} weight="bold" />{t("brand.actions.addData")}
            </Link>
            <Link className="admin-button admin-button--primary" href={`/studio/brands/${summary.brandId}/reports`} prefetch={false}>
              <FileText aria-hidden size={15} />
              {currentReport?.currentRevision ? t("brand.actions.updateReport") : t("brand.actions.runAnalysis")}
            </Link>
          </>
        )}
        eyebrow={`${summary.organizationName} · ${t("brand.eyebrow")}`}
        icon={<Gauge aria-hidden size={21} weight="fill" />}
        status={<AdminStatus state={summary.workspaceStatus === "active" ? "good" : "warning"}>{summary.workspaceStatus ? t(`states.${summary.workspaceStatus}`) : t("states.not_available")}</AdminStatus>}
        subtitle={summary.industry ?? t("brand.noIndustry")}
        title={summary.brandName}
      />

      <dl className="admin-summary-strip">
        <div>
          <dt>{t("brand.summary.mentions")}</dt>
          <dd>{formatAdminNumber(summary.governedMentions, locale)}</dd>
          <small>{t("brand.summary.mentionsHint")}</small>
        </div>
        <div>
          <dt>{t("brand.summary.coverage")}</dt>
          <dd>{summary.coverageFrom && summary.coverageThrough
            ? `${formatAdminDate(summary.coverageFrom, locale, { month: "short", year: "numeric" })} – ${formatAdminDate(summary.coverageThrough, locale, { month: "short", year: "numeric" })}`
            : "—"}</dd>
          <small>{t(`coverage.${summary.coverageState}`)}</small>
        </div>
        <div>
          <dt>{t("brand.summary.sources")}</dt>
          <dd>{summary.activeSources}</dd>
          <small>{t("brand.summary.sourcesHint", { count: summary.staleSources + summary.failedSources })}</small>
        </div>
        <div>
          <dt>{t("brand.summary.report")}</dt>
          <dd>{currentReport?.currentRevision ? `r${currentReport.currentRevision}` : "—"}</dd>
          <small>{t(`reports.states.${summary.reportState}`)}</small>
        </div>
      </dl>

      <section className="admin-two-column">
        <AdminResourceSection subtitle={t("brand.health.subtitle")} title={t("brand.health.title")}>
          <div className="admin-settings-list">
            <AdminSettingsRow title={t("brand.health.coverage")} value={<AdminStatus state={summary.coverageState}>{t(`coverage.${summary.coverageState}`)}</AdminStatus>} />
            <AdminSettingsRow title={t("brand.health.freshness")} value={<AdminStatus state={summary.freshnessState}>{t(`states.${summary.freshnessLabel}`)}</AdminStatus>} />
            <AdminSettingsRow title={t("brand.health.quality")} value={<AdminStatus state={summary.qualityState}>{t(`quality.${summary.qualityState}`)}</AdminStatus>} />
            <AdminSettingsRow title={t("brand.health.population")} value={summary.populationVersion ? t("brand.health.populationVersion", { version: summary.populationVersion }) : t("states.not_available")} />
          </div>
        </AdminResourceSection>

        <AdminResourceSection subtitle={t("brand.issues.subtitle")} title={t("brand.issues.title")}>
          {issues.length === 0 ? (
            <div className="admin-empty admin-empty--compact"><strong>{t("brand.issues.emptyTitle")}</strong><p>{t("brand.issues.emptyBody")}</p></div>
          ) : (
            <ul className="admin-issue-list">
              {issues.map((issue) => (
                <li key={issue.code}>
                  <div><strong>{t(`brand.issues.items.${issue.code}`)}</strong><span>{t(`brand.issues.hints.${issue.code}`, { count: issue.count })}</span></div>
                  <Link aria-label={t(`brand.issues.items.${issue.code}`)} className="admin-button admin-button--icon" href={issue.href} prefetch={false}><ArrowRight aria-hidden size={14} /></Link>
                </li>
              ))}
            </ul>
          )}
        </AdminResourceSection>
      </section>

      <section className="admin-section">
        <header className="admin-section__head">
          <div><h2>{t("brand.sources.title")}</h2><p>{t("brand.sources.subtitle")}</p></div>
          <Link className="admin-button" href={`/studio/brands/${summary.brandId}/data`} prefetch={false}>{t("brand.sources.open")}<ArrowRight aria-hidden size={14} /></Link>
        </header>
        {workspace.sources.length === 0 ? (
          <div className="admin-empty"><strong>{t("brand.sources.emptyTitle")}</strong><p>{t("brand.sources.emptyBody")}</p></div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>{t("data.columns.source")}</th><th>{t("data.columns.scope")}</th><th>{t("data.columns.freshness")}</th><th>{t("data.columns.lastImport")}</th></tr></thead>
              <tbody>{workspace.sources.slice(0, 6).map((source) => (
                <tr key={source.id}>
                  <td><div className="admin-table__primary"><strong>{source.name}</strong><small>{source.provider} · {source.connectionMethod}</small></div></td>
                  <td><AdminStatus state={source.scopeReviewStatus === "approved" ? "good" : "warning"}>{source.scope ?? t("states.not_available")}</AdminStatus></td>
                  <td><AdminStatus state={freshnessTone(source.freshnessState)}>{t(`states.${source.freshnessState}`)}</AdminStatus></td>
                  <td className="admin-table__muted">{formatAdminDate(source.latestImport?.createdAt, locale)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <AdminResourceSection subtitle={t("brand.resources.subtitle")} title={t("brand.resources.title")}>
        <ul className="admin-resource-list">
          <li className="admin-resource-row">
            <div className="admin-resource-row__main">
              <strong>{t("brand.brandOs.title")}</strong>
              <span className="admin-resource-row__secondary">{t("brand.brandOs.summary", {
                aliases: brand.brandSeedHandles?.length ?? 0,
                competitors: brand.competitors.length,
                knowledge: brand.knowledgeSources.length
              })}</span>
            </div>
            <div className="admin-resource-row__actions">
              <span className="admin-resource-row__secondary">{t("brand.brandOs.profilesCount", { count: workspace.profiles.length })}</span>
              <Link className="admin-button" href={`/studio/brands/${summary.brandId}/brand-os`} prefetch={false}>{t("brand.brandOs.open")}<ArrowRight aria-hidden size={14} /></Link>
            </div>
          </li>
          <li className="admin-resource-row">
            <div className="admin-resource-row__main">
              <strong>{t("brand.reports.title")}</strong>
              <span className="admin-resource-row__secondary">{t("brand.reports.summary", {
                revision: currentReport?.currentRevision ? `r${currentReport.currentRevision}` : t("reports.states.not_available"),
                review: currentReport?.runsNeedingReview ?? 0,
                published: formatAdminDate(currentReport?.currentReleasePublishedAt, locale)
              })}</span>
            </div>
            <div className="admin-resource-row__actions">
              <AdminStatus state={runTone(currentReport?.latestRunStatus)}>{currentReport?.latestRunStatus ? t(`reports.states.${currentReport.latestRunStatus}`) : t("reports.states.not_available")}</AdminStatus>
              <Link className="admin-button" href={`/studio/brands/${summary.brandId}/reports`} prefetch={false}>{t("brand.reports.open")}<ArrowRight aria-hidden size={14} /></Link>
            </div>
          </li>
        </ul>
      </AdminResourceSection>
    </div>
  );
}

function workspaceIssues(workspace: AdminBrandWorkspace) {
  const summary = workspace.summary;
  const base = `/studio/brands/${summary.brandId}`;
  const issues: Array<{ code: string; count: number; href: string }> = [];
  if (!summary.workspaceId) issues.push({ code: "workspace", count: 1, href: `${base}/settings` });
  if (summary.activeSources === 0) issues.push({ code: "sources", count: 0, href: `${base}/data` });
  if (summary.staleSources + summary.failedSources > 0) issues.push({ code: "freshness", count: summary.staleSources + summary.failedSources, href: `${base}/data` });
  if (summary.pendingImports > 0) issues.push({ code: "imports", count: summary.pendingImports, href: `${base}/data` });
  if (summary.reportsNeedingReview > 0) issues.push({ code: "review", count: summary.reportsNeedingReview, href: `${base}/reports` });
  return issues;
}

function freshnessTone(state: string) {
  if (state === "fresh") return "good" as const;
  if (state === "failed") return "danger" as const;
  if (state === "stale" || state === "partial") return "warning" as const;
  return "not_available" as const;
}

function runTone(state: string | null | undefined) {
  if (state === "approved_by_im" || state === "approved_by_kam" || state === "done") return "good" as const;
  if (state === "failed" || state === "aborted_preflight") return "danger" as const;
  if (state) return "warning" as const;
  return "not_available" as const;
}

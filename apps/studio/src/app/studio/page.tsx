import Link from "next/link";
import { ArrowRight, Buildings, Database, Warning } from "@phosphor-icons/react/dist/ssr";
import { getLocale, getTranslations } from "next-intl/server";

import {
  AdminResourceSection,
  AdminStatus,
  AdminWorkspaceHeader,
  formatAdminDate,
  formatAdminNumber
} from "@/components/admin/AdminWorkspacePrimitives";
import { requireStudioUser } from "@/lib/auth/guards";
import { getAdminDashboard } from "@/lib/data/admin-workspace";

export const dynamic = "force-dynamic";

export default async function StudioHomePage() {
  const [t, locale, session] = await Promise.all([
    getTranslations("AdminWorkspace"),
    getLocale(),
    requireStudioUser("/studio")
  ]);
  const dashboard = await getAdminDashboard(session.appUser);
  const attentionBrands = dashboard.brands
    .filter((brand) => (
      brand.coverageState !== "good"
      || brand.freshnessState === "danger"
      || brand.freshnessState === "warning"
      || brand.qualityState === "danger"
      || brand.qualityState === "warning"
      || brand.reportsNeedingReview > 0
    ))
    .slice(0, 12);
  const workspaceOverview = [
    ...attentionBrands,
    ...dashboard.brands.filter((brand) => !attentionBrands.some((attention) => attention.brandId === brand.brandId))
  ].slice(0, 12);

  return (
    <div className="admin-workspace-page">
      <AdminWorkspaceHeader
        actions={(
          <>
            <Link className="admin-button" href="/studio/data" prefetch={false}>
              <Database aria-hidden size={15} />{t("dashboard.actions.data")}
            </Link>
            <Link className="admin-button admin-button--primary" href="/studio/brands/new" prefetch={false}>
              <Buildings aria-hidden size={15} />{t("dashboard.actions.createBrand")}
            </Link>
          </>
        )}
        eyebrow={t("dashboard.eyebrow")}
        icon={<Warning aria-hidden size={21} weight="fill" />}
        subtitle={t("dashboard.subtitle")}
        title={t("dashboard.title")}
      />

      <dl className="admin-summary-strip">
        <div>
          <dt>{t("dashboard.summary.brands")}</dt>
          <dd>{formatAdminNumber(dashboard.totals.brands, locale)}</dd>
          <small>{t("dashboard.summary.brandsHint")}</small>
        </div>
        <div>
          <dt>{t("dashboard.summary.mentions")}</dt>
          <dd>{formatAdminNumber(dashboard.totals.governedMentions, locale)}</dd>
          <small>{t("dashboard.summary.mentionsHint")}</small>
        </div>
        <div>
          <dt>{t("dashboard.summary.sources")}</dt>
          <dd>{formatAdminNumber(dashboard.totals.sourcesRequiringAttention, locale)}</dd>
          <small>{t("dashboard.summary.sourcesHint")}</small>
        </div>
        <div>
          <dt>{t("dashboard.summary.review")}</dt>
          <dd>{formatAdminNumber(dashboard.totals.reportsNeedingReview, locale)}</dd>
          <small>{t("dashboard.summary.reviewHint")}</small>
        </div>
      </dl>

      <div className="admin-dashboard-grid">
        <AdminResourceSection
          subtitle={t("dashboard.priorities.subtitle")}
          title={t("dashboard.priorities.title")}
        >
          {dashboard.priorities.length === 0 ? (
            <div className="admin-empty">
              <strong>{t("dashboard.priorities.emptyTitle")}</strong>
              <p>{t("dashboard.priorities.emptyBody")}</p>
            </div>
          ) : (
            <ol className="admin-priority-list">
              {dashboard.priorities.map((priority) => (
                <li key={`${priority.brandId}:${priority.code}`}>
                  <span aria-hidden className={`admin-priority-list__marker admin-priority-list__marker--${priority.state}`} />
                  <div>
                    <strong>{priority.brandName}</strong>
                    <span>{t(`dashboard.priority.${priority.code}`, { count: priority.count })}</span>
                  </div>
                  <Link className="admin-button" href={priority.href} prefetch={false}>
                    {t("dashboard.actions.review")}<ArrowRight aria-hidden size={14} />
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </AdminResourceSection>

        <AdminResourceSection
          subtitle={t("dashboard.queue.subtitle")}
          title={t("dashboard.queue.title")}
        >
          <dl className="admin-queue-list">
            <div><dt>{t("dashboard.queue.pendingImports")}</dt><dd>{dashboard.totals.pendingImports}</dd></div>
            <div><dt>{t("dashboard.queue.reportReview")}</dt><dd>{dashboard.totals.reportsNeedingReview}</dd></div>
            <div><dt>{t("dashboard.queue.sourceIssues")}</dt><dd>{dashboard.totals.sourcesRequiringAttention}</dd></div>
            <div><dt>{t("dashboard.queue.workspaceCount")}</dt><dd>{dashboard.brands.filter((brand) => brand.workspaceId).length}</dd></div>
          </dl>
        </AdminResourceSection>
      </div>

      <AdminResourceSection
        actions={(
          <Link className="admin-button" href="/studio/brands" prefetch={false}>
            {t("dashboard.actions.allBrands")}<ArrowRight aria-hidden size={14} />
          </Link>
        )}
        subtitle={t("dashboard.workspaces.subtitle")}
        title={t("dashboard.workspaces.title")}
      >
        {workspaceOverview.length === 0 ? (
          <div className="admin-empty">
            <strong>{t("dashboard.attention.emptyTitle")}</strong>
            <p>{t("dashboard.attention.emptyBody")}</p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr>
                <th>{t("brands.columns.brand")}</th>
                <th>{t("brands.columns.coverage")}</th>
                <th>{t("brands.columns.freshness")}</th>
                <th>{t("brands.columns.quality")}</th>
                <th>{t("brands.columns.report")}</th>
                <th>{t("brands.columns.activity")}</th>
              </tr></thead>
              <tbody>
                {workspaceOverview.map((brand) => (
                  <tr key={brand.brandId}>
                    <td>
                      <div className="admin-table__primary">
                        <Link href={`/studio/brands/${brand.brandId}`} prefetch={false}>{brand.brandName}</Link>
                        <small>{brand.organizationName}</small>
                      </div>
                    </td>
                    <td><AdminStatus state={brand.coverageState}>{brand.coverageState === "not_available"
                      ? t("coverage.notAvailable")
                      : brand.governedMentions === 0
                        ? t("coverage.noMentions")
                        : t("coverage.mentions", { count: brand.governedMentions })}</AdminStatus></td>
                    <td><AdminStatus state={brand.freshnessState}>{t(`states.${brand.freshnessLabel}`)}</AdminStatus></td>
                    <td><AdminStatus state={brand.qualityState}>{t(`quality.${brand.qualityState}`)}</AdminStatus></td>
                    <td><AdminStatus state={reportStateTone(brand.reportState)}>{t(`reports.states.${brand.reportState}`)}</AdminStatus></td>
                    <td className="admin-table__muted">{formatAdminDate(brand.latestActivityAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminResourceSection>
    </div>
  );
}

function reportStateTone(state: string) {
  if (state === "published") return "good" as const;
  if (state === "needs_review" || state === "running") return "warning" as const;
  return "not_available" as const;
}

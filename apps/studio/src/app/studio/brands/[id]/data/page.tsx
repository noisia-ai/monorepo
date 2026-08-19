import { ArrowRight, Database } from "@phosphor-icons/react/dist/ssr";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";

import "@/app/signal-v2/signal-v2.css";

import {
  AdminResourceSection,
  AdminSettingsRow,
  AdminStatus,
  AdminWorkspaceHeader,
  formatAdminDate,
  formatAdminNumber
} from "@/components/admin/AdminWorkspacePrimitives";
import { AcquisitionPlanManager } from "@/components/admin/AcquisitionPlanManager";
import { GovernancePreparationManager } from "@/components/admin/GovernancePreparationManager";
import { requireStudioUser } from "@/lib/auth/guards";
import { getAdminBrandWorkspace } from "@/lib/data/admin-workspace";
import { loadSignalGovernancePreparationV1 } from "@/lib/data-os/signal-governance-control-plane";
import { resolveSignalWorkspaceForUser } from "@/lib/data-os/signal-workspace";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function BrandDataPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, locale, session] = await Promise.all([
    getTranslations("AdminWorkspace"),
    getLocale(),
    requireStudioUser(`/studio/brands/${id}/data`)
  ]);
  const workspace = await getAdminBrandWorkspace(session.appUser, id);
  if (!workspace) notFound();
  const { summary } = workspace;
  const resolvedWorkspace = summary.workspaceId && session.appUser.userType === "noisia_internal"
    ? await resolveSignalWorkspaceForUser(session.appUser, { workspaceId: summary.workspaceId })
    : null;
  const governance = resolvedWorkspace
    ? await loadSignalGovernancePreparationV1({ queryable: pool, workspace: resolvedWorkspace })
    : null;

  return (
    <div className="admin-workspace-page">
      <AdminWorkspaceHeader
        actions={summary.workspaceSlug ? (
          <Link className="admin-button" href={`/studio/brands/${id}/data/mentions`} prefetch={false}>
            {t("data.actions.openMentions")}<ArrowRight aria-hidden size={14} />
          </Link>
        ) : undefined}
        eyebrow={`${summary.brandName} · ${t("data.eyebrow")}`}
        icon={<Database aria-hidden size={21} weight="fill" />}
        subtitle={t("data.subtitle")}
        title={t("data.title")}
      />

      <dl className="admin-summary-strip">
        <div><dt>{t("data.summary.sources")}</dt><dd>{summary.activeSources}</dd><small>{t("data.summary.sourcesHint")}</small></div>
        <div><dt>{t("data.summary.mentions")}</dt><dd>{formatAdminNumber(summary.governedMentions, locale)}</dd><small>{t("data.summary.mentionsHint")}</small></div>
        <div><dt>{t("data.summary.coverage")}</dt><dd>{summary.coverageFrom && summary.coverageThrough ? `${formatAdminDate(summary.coverageFrom, locale, { month: "short", year: "numeric" })} – ${formatAdminDate(summary.coverageThrough, locale, { month: "short", year: "numeric" })}` : "—"}</dd><small>{t(`coverage.${summary.coverageState}`)}</small></div>
        <div><dt>{t("data.summary.freshness")}</dt><dd><AdminStatus state={summary.freshnessState}>{t(`states.${summary.freshnessLabel}`)}</AdminStatus></dd><small>{t("data.summary.freshnessHint")}</small></div>
      </dl>

      {summary.workspaceId ? (
        <>
          <AcquisitionPlanManager
            timezone={summary.timezone ?? "America/Mexico_City"}
            workspaceId={summary.workspaceId}
          />
          {governance ? (
            <GovernancePreparationManager
              initial={governance}
              workspaceId={summary.workspaceId}
            />
          ) : null}
          <AdminResourceSection
            subtitle={t("data.destinations.subtitle")}
            title={t("data.destinations.title")}
          >
            <div className="admin-settings-list">
              <AdminSettingsRow
                action={(
                  <Link className="admin-button admin-button--compact" href={`/studio/brands/${id}/data/mentions`} prefetch={false}>
                    {t("data.destinations.open")}<ArrowRight aria-hidden size={14} />
                  </Link>
                )}
                description={t("data.destinations.mentionsDescription")}
                title={t("data.mentions.title")}
              />
              <AdminSettingsRow
                action={(
                  <Link className="admin-button admin-button--compact" href={`/studio/brands/${id}/data/review`} prefetch={false}>
                    {t("data.destinations.open")}<ArrowRight aria-hidden size={14} />
                  </Link>
                )}
                description={t("data.destinations.reviewDescription")}
                title={t("data.semanticReview.title")}
              />
              <AdminSettingsRow
                action={(
                  <Link className="admin-button admin-button--compact" href={`/studio/brands/${id}/data/governed-views`} prefetch={false}>
                    {t("data.destinations.open")}<ArrowRight aria-hidden size={14} />
                  </Link>
                )}
                description={t("data.destinations.governedViewsDescription")}
                title={t("data.governedViews.title")}
              />
            </div>
          </AdminResourceSection>
        </>
      ) : (
        <section className="admin-section">
          <div className="admin-empty"><strong>{t("data.workspaceMissing.title")}</strong><p>{t("data.workspaceMissing.body")}</p></div>
        </section>
      )}

      {!governance ? <AdminResourceSection subtitle={t("data.governance.subtitle")} title={t("data.governance.title")}>
        <div className="admin-settings-list">
          <AdminSettingsRow title={t("data.governance.population")} value={summary.populationVersion ? t("data.governance.populationVersion", { version: summary.populationVersion }) : t("states.not_available")} />
          <AdminSettingsRow title={t("data.governance.defaultScope")} value="primary_brand" />
          <AdminSettingsRow title={t("data.governance.pending")} value={<AdminStatus state={summary.pendingImports > 0 ? "warning" : "good"}>{summary.pendingImports}</AdminStatus>} />
          <AdminSettingsRow title={t("data.governance.failed")} value={<AdminStatus state={summary.importsFailed + summary.failedSources > 0 ? "danger" : "good"}>{summary.importsFailed + summary.failedSources}</AdminStatus>} />
        </div>
      </AdminResourceSection> : null}
    </div>
  );
}

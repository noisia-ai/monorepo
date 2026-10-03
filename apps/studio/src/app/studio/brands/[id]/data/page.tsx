import { ArrowRight, Database } from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";

import "@/app/signal-v2/signal-v2.css";

import {
  AdminResourceSection,
  AdminSettingsRow,
  AdminStatus,
  AdminWorkspaceHeader
} from "@/components/admin/AdminWorkspacePrimitives";
import { AdminCorpusSummaryStrip } from "@/components/admin/AdminCorpusSummary";
import { SelfServiceImportManager } from "@/components/admin/SelfServiceImportManager";
import { WorkspaceCorpusReadinessPanel } from "@/components/admin/WorkspaceCorpusReadinessPanel";
import { BrandMonitoringJourney } from "@/components/brands/BrandMonitoringJourney";
import { GovernancePreparationManager } from "@/components/admin/GovernancePreparationManager";
import { requireStudioUser } from "@/lib/auth/guards";
import { getAdminBrandWorkspaceSummary } from "@/lib/data/admin-workspace";
import { loadSignalGovernancePreparationV1 } from "@/lib/data-os/signal-governance-control-plane";
import { resolveSignalWorkspaceForUser } from "@/lib/data-os/signal-workspace";
import { loadWorkspaceCorpusReadinessForActorV1 } from "@/lib/data-os/workspace-corpus-readiness";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function BrandDataPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, session] = await Promise.all([
    getTranslations("AdminWorkspace"),
    requireStudioUser(`/studio/brands/${id}/data`)
  ]);
  const summary = await getAdminBrandWorkspaceSummary(session.appUser, id);
  if (!summary) notFound();
  const resolvedWorkspace = summary.workspaceId && session.appUser.userType === "noisia_internal"
    ? await resolveSignalWorkspaceForUser(session.appUser, { workspaceId: summary.workspaceId })
    : null;
  const governance = resolvedWorkspace
    ? await loadSignalGovernancePreparationV1({ queryable: pool, workspace: resolvedWorkspace })
    : null;
  const corpusReadiness = summary.workspaceId
    ? await loadWorkspaceCorpusReadinessForActorV1({
      queryable: pool, workspaceId: summary.workspaceId, actorUserId: session.appUser.id
    }).catch(() => null)
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
      <BrandMonitoringJourney brandId={id} current="data" />

      <AdminCorpusSummaryStrip corpus={summary.corpus} />

      {summary.workspaceId ? (
        <>
          <WorkspaceCorpusReadinessPanel initial={corpusReadiness} workspaceId={summary.workspaceId} />
          <SelfServiceImportManager
            brandId={id}
            timezone={summary.timezone ?? "America/Mexico_City"}
            workspaceId={summary.workspaceId}
          />
          {governance ? (
            <details className="admin-section" style={{ padding: 16 }}>
              <summary>{t("data.advancedPreparation.title")}</summary>
              <p className="admin-table__muted">{t("data.advancedPreparation.body")}</p>
              <GovernancePreparationManager
                initial={governance}
                workspaceId={summary.workspaceId}
              />
            </details>
          ) : null}
          <AdminResourceSection
            subtitle={t("data.destinations.subtitle")}
            title={t("data.destinations.title")}
          >
            <div className="admin-settings-list">
              <AdminSettingsRow
                action={(
                  <Link className="admin-button admin-button--compact" href={`/studio/brands/${id}/topics`} prefetch={false}>
                    {t("data.destinations.open")}<ArrowRight aria-hidden size={14} />
                  </Link>
                )}
                description={t("data.destinations.topicsDescription")}
                title={t("data.destinations.topicsTitle")}
              />
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

import { ArrowRight, Database } from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";

import "@/app/signal-v2/signal-v2.css";

import {
  AdminResourceSection,
  AdminSettingsRow,
  AdminWorkspaceHeader
} from "@/components/admin/AdminWorkspacePrimitives";
import { SelfServiceImportManager } from "@/components/admin/SelfServiceImportManager";
import { WorkspaceCorpusReadinessPanel } from "@/components/admin/WorkspaceCorpusReadinessPanel";
import { BrandMonitoringJourney } from "@/components/brands/BrandMonitoringJourney";
import { LazyGovernancePreparation } from "@/components/admin/LazyGovernancePreparation";
import { requireStudioUser } from "@/lib/auth/guards";
import { getAdminBrandWorkspaceIdentity } from "@/lib/data/admin-workspace";

export const dynamic = "force-dynamic";

export default async function BrandDataPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, session] = await Promise.all([
    getTranslations("AdminWorkspace"),
    requireStudioUser(`/studio/brands/${id}/data`)
  ]);
  const identity = await getAdminBrandWorkspaceIdentity(session.appUser, id);
  if (!identity) notFound();

  return (
    <div className="admin-workspace-page">
      <AdminWorkspaceHeader
        actions={identity.workspaceId ? (
          <Link className="admin-button" href={`/studio/brands/${id}/data/mentions`} prefetch={false}>
            {t("data.actions.openMentions")}<ArrowRight aria-hidden size={14} />
          </Link>
        ) : undefined}
        eyebrow={`${identity.brandName} · ${t("data.eyebrow")}`}
        icon={<Database aria-hidden size={21} weight="fill" />}
        subtitle={t("data.subtitle")}
        title={t("data.title")}
      />
      <BrandMonitoringJourney brandId={id} current="data" />

      {identity.workspaceId ? (
        <>
          <WorkspaceCorpusReadinessPanel initial={null} workspaceId={identity.workspaceId} />
          <SelfServiceImportManager
            brandId={id}
            timezone={identity.timezone ?? "America/Mexico_City"}
            workspaceId={identity.workspaceId}
          />
          <LazyGovernancePreparation key={identity.workspaceId} workspaceId={identity.workspaceId} />
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

    </div>
  );
}

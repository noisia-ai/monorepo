import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowRight, IdentificationCard } from "@phosphor-icons/react/dist/ssr";

import { AdminResourceSection, AdminWorkspaceHeader } from "@/components/admin/AdminWorkspacePrimitives";
import { BrandEditForm } from "@/components/brands/BrandEditForm";
import { ClientBrandContextProcessingQuote } from "@/components/brands/ClientBrandContextProcessingQuote";
import { BrandMonitoringJourney } from "@/components/brands/BrandMonitoringJourney";
import { CompetitorManager } from "@/components/brands/CompetitorManager";
import { KnowledgeBaseManager } from "@/components/brands/KnowledgeBaseManager";
import { requirePortalUser } from "@/lib/auth/guards";
import { loadClientBrandContextAccessV1 } from "@/lib/auth/client-brand-self-service-server";
import { getBrandDetailForUser } from "@/lib/data/brands";
import { loadClientBrandWorkspaceEntryV1 } from "@/lib/data-os/workspace-management-entry";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ClientBrandOsPage({ params }: { params: Promise<{ outputId: string }> }) {
  const { outputId } = await params;
  const session = await requirePortalUser(`/signal/${encodeURIComponent(outputId)}/manage/brand-os`);
  const entry = await loadClientBrandWorkspaceEntryV1(session.appUser, outputId);
  if (!entry || !entry.canManageBrandContext) notFound();
  const [authority, brand, t] = await Promise.all([
    loadClientBrandContextAccessV1(session.appUser, entry.brandId),
    getBrandDetailForUser(session.appUser, entry.brandId),
    getTranslations("AdminWorkspace")
  ]);
  if (!authority || !brand || authority.workspaceId !== entry.workspaceId) notFound();

  const destinations = {
    brandOs: entry.navigation.brandOsHref,
    topics: entry.navigation.topicsHref,
    data: entry.navigation.dataHref,
    signal: entry.navigation.signalHref
  };
  return <div className="admin-workspace-page">
    <AdminWorkspaceHeader
      actions={<Link className="admin-button" href={entry.navigation.signalHref} prefetch={false}>
        {t("brandOs.back")}<ArrowRight aria-hidden size={14} />
      </Link>}
      eyebrow={t("brandOs.eyebrow")}
      icon={<IdentificationCard aria-hidden size={21} weight="fill" />}
      subtitle={t("brandOs.subtitle")}
      title={t("brandOs.title", { brand: brand.displayName ?? brand.name })}
    />
    <BrandMonitoringJourney brandId={brand.id} current="brand-os" destinations={destinations} />
    <BrandEditForm
      brand={{ ...brand, timezone: entry.timezone }}
      organizations={[]}
      clientContext={{ workspaceSlug: entry.workspaceSlug, organizationName: brand.organizationName ?? brand.organizationSlug }}
    />
    <CompetitorManager brandId={brand.id} workspaceId={entry.workspaceId} competitors={brand.competitors} unfunded />
    <KnowledgeBaseManager brandId={brand.id} sources={brand.knowledgeSources} unfunded />
    <ClientBrandContextProcessingQuote workspaceId={entry.workspaceId} refreshSignal={new Date().toISOString()}
      authorizeFromEndpoint />
    <AdminResourceSection
      actions={<Link className="admin-button admin-button--primary" href={entry.navigation.topicsHref} prefetch={false}>
        {t("brandOs.topics.action")}<ArrowRight aria-hidden size={14} />
      </Link>}
      subtitle={t("brandOs.topics.subtitle")}
      title={t("brandOs.topics.title")}
    >
      <p className="admin-drawer-form__hint">{t("brandOs.topics.body")}</p>
    </AdminResourceSection>
  </div>;
}

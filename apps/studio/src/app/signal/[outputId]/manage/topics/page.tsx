import Link from "next/link";
import { ArrowRight, Pulse } from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { BrandMonitoringJourney } from "@/components/brands/BrandMonitoringJourney";
import { TopicsManager } from "@/components/brands/TopicsManager";
import { SignalV2ModuleHeader } from "@/components/signal-v2/SignalV2ModuleHeader";
import { requirePortalUser } from "@/lib/auth/guards";
import { loadClientBrandWorkspaceEntryV1 } from "@/lib/data-os/workspace-management-entry";
import { loadSignalTopicsManagementProductV1 } from "@/lib/data-os/signal-topics-management";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ClientBrandTopicsPage({ params }: { params: Promise<{ outputId: string }> }) {
  const { outputId } = await params;
  const [t, session] = await Promise.all([getTranslations("AdminWorkspace.topics"),
    requirePortalUser(`/signal/${encodeURIComponent(outputId)}/manage/topics`)]);
  const entry = await loadClientBrandWorkspaceEntryV1(session.appUser, outputId);
  if (!entry) notFound();
  const initial = await loadSignalTopicsManagementProductV1({ workspace: entry.workspace, actor: session.appUser });
  return <div className="topics-workspace-page">
    <SignalV2ModuleHeader title={t("title")} subtitle={t("subtitle")} icon={<Pulse aria-hidden size={21} weight="fill" />}
      aside={<Link className="admin-button" href={entry.navigation.dataHref} prefetch={false}>
        {t("back")}<ArrowRight aria-hidden size={14} /></Link>} />
    <BrandMonitoringJourney brandId={entry.brandId} current="topics" destinations={{
      topics: entry.navigation.topicsHref, data: entry.navigation.dataHref, signal: entry.navigation.signalHref, brandOs: null }} />
    <TopicsManager key={entry.requestScope} brandId={entry.brandId} workspaceId={entry.workspaceId} initial={initial}
      navigation={{ ...entry.navigation, brandOsHref: null }} requestScope={entry.requestScope} />
  </div>;
}

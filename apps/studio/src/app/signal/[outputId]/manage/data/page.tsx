import Link from "next/link";
import { ArrowRight, Database } from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { loadAdminWorkspaceCorpusSummariesV1 } from "@noisia/db";
import { BrandMonitoringJourney } from "@/components/brands/BrandMonitoringJourney";
import { ClientBrandWorkspaceData } from "@/components/brands/ClientBrandWorkspaceData";
import { SignalV2ModuleHeader } from "@/components/signal-v2/SignalV2ModuleHeader";
import { requirePortalUser } from "@/lib/auth/guards";
import { loadClientBrandWorkspaceEntryV1 } from "@/lib/data-os/workspace-management-entry";
import { loadWorkspaceCorpusReadinessForActorV1 } from "@/lib/data-os/workspace-corpus-readiness";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ClientBrandDataPage({ params }: { params: Promise<{ outputId: string }> }) {
  const { outputId } = await params;
  const [t, session] = await Promise.all([getTranslations("AdminWorkspace"),
    requirePortalUser(`/signal/${encodeURIComponent(outputId)}/manage/data`)]);
  const entry = await loadClientBrandWorkspaceEntryV1(session.appUser, outputId);
  if (!entry) notFound();
  const [summaries, readiness] = await Promise.all([
    loadAdminWorkspaceCorpusSummariesV1({ queryable: pool, workspace_ids: [entry.workspaceId], actor_user_id: session.appUser.id }),
    loadWorkspaceCorpusReadinessForActorV1({ queryable: pool, workspaceId: entry.workspaceId, actorUserId: session.appUser.id })
  ]);
  const corpus = summaries.get(entry.workspaceId);
  if (!corpus) notFound();
  return <div className="topics-workspace-page">
    <SignalV2ModuleHeader title={t("data.title")} subtitle={t("data.subtitle")} icon={<Database aria-hidden size={21} weight="fill" />}
      aside={<Link className="admin-button" href={`${entry.navigation.signalHref}/mentions`} prefetch={false}>
        {t("data.actions.openMentions")}<ArrowRight aria-hidden size={14} /></Link>} />
    <BrandMonitoringJourney brandId={entry.brandId} current="data" destinations={{
      topics: entry.navigation.topicsHref, data: entry.navigation.dataHref, signal: entry.navigation.signalHref, brandOs: null }} />
    <ClientBrandWorkspaceData key={entry.requestScope} entry={entry} initialReadiness={readiness} corpus={corpus} />
  </div>;
}

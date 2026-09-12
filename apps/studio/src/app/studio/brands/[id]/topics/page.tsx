import Link from "next/link";
import { BrandMonitoringJourney } from "@/components/brands/BrandMonitoringJourney";
import { ArrowRight, Pulse } from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { AdminWorkspaceHeader } from "@/components/admin/AdminWorkspacePrimitives";
import { TopicsManager } from "@/components/brands/TopicsManager";
import { requireStudioUser } from "@/lib/auth/guards";
import { getAdminBrandWorkspaceIdentity } from "@/lib/data/admin-workspace";
import { resolveSignalWorkspaceForUser } from "@/lib/data-os/signal-workspace";
import { loadSignalTopicsManagementProductV1 } from "@/lib/data-os/signal-topics-management";

export const dynamic = "force-dynamic";

export default async function BrandTopicsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, session] = await Promise.all([
    getTranslations("AdminWorkspace.topics"),
    requireStudioUser(`/studio/brands/${id}/topics`)
  ]);
  const identity = await getAdminBrandWorkspaceIdentity(session.appUser, id);
  if (!identity?.workspaceId) notFound();
  const workspace = await resolveSignalWorkspaceForUser(session.appUser,
    { workspaceId: identity.workspaceId });
  if (!workspace) notFound();
  const initial = await loadSignalTopicsManagementProductV1({ workspace, actor: session.appUser });
  return (
    <div className="admin-workspace-page topics-workspace-page">
      <AdminWorkspaceHeader
        actions={<Link className="admin-button" href={`/studio/brands/${id}/data`} prefetch={false}>
          {t("back")}<ArrowRight aria-hidden size={14} />
        </Link>}
        eyebrow={`${identity.brandName} · ${t("eyebrow")}`}
        icon={<Pulse aria-hidden size={21} weight="fill" />}
        subtitle={t("subtitle")}
        title={t("title")}
      />
      <BrandMonitoringJourney brandId={id} current="topics" />
      <TopicsManager brandId={id} initial={initial} workspaceId={workspace.id} />
    </div>
  );
}

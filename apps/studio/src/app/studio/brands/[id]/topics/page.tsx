import Link from "next/link";
import { ArrowRight, Pulse } from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { AdminWorkspaceHeader } from "@/components/admin/AdminWorkspacePrimitives";
import { TopicsManager } from "@/components/brands/TopicsManager";
import { requireStudioUser } from "@/lib/auth/guards";
import { getAdminBrandWorkspace } from "@/lib/data/admin-workspace";
import { resolveSignalWorkspaceForUser } from "@/lib/data-os/signal-workspace";
import { loadSignalTopicsManagementProductV1 } from "@/lib/data-os/signal-topics-management";

export const dynamic = "force-dynamic";

export default async function BrandTopicsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, session] = await Promise.all([
    getTranslations("AdminWorkspace.topics"),
    requireStudioUser(`/studio/brands/${id}/topics`)
  ]);
  const admin = await getAdminBrandWorkspace(session.appUser, id);
  if (!admin?.summary.workspaceId) notFound();
  const workspace = await resolveSignalWorkspaceForUser(session.appUser,
    { workspaceId: admin.summary.workspaceId });
  if (!workspace) notFound();
  const initial = await loadSignalTopicsManagementProductV1({ workspace, actor: session.appUser });
  return (
    <div className="admin-workspace-page topics-workspace-page">
      <AdminWorkspaceHeader
        actions={<Link className="admin-button" href={`/studio/brands/${id}/brand-os`} prefetch={false}>
          {t("back")}<ArrowRight aria-hidden size={14} />
        </Link>}
        eyebrow={`${admin.summary.brandName} · ${t("eyebrow")}`}
        icon={<Pulse aria-hidden size={21} weight="fill" />}
        subtitle={t("subtitle")}
        title={t("title")}
      />
      <TopicsManager initial={initial} workspaceId={workspace.id} />
    </div>
  );
}

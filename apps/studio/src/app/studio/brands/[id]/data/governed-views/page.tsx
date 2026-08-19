import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { GovernedViewsManager } from "@/components/admin/GovernedViewsManager";
import { AdminWorkspaceHeader } from "@/components/admin/AdminWorkspacePrimitives";
import { requireStudioUser } from "@/lib/auth/guards";
import { getAdminBrandWorkspace } from "@/lib/data/admin-workspace";
import { loadSignalGovernedViewsProductPreflightV1 } from "@/lib/data-os/signal-governed-view-orchestrator";
import { resolveSignalWorkspaceForUser } from "@/lib/data-os/signal-workspace";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function GovernedViewsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, session] = await Promise.all([
    getTranslations("AdminWorkspace.data.governedViews"),
    requireStudioUser(`/studio/brands/${id}/data/governed-views`)
  ]);
  if (session.appUser.userType !== "noisia_internal") notFound();
  const admin = await getAdminBrandWorkspace(session.appUser, id);
  if (!admin?.summary.workspaceId) notFound();
  const workspace = await resolveSignalWorkspaceForUser(session.appUser, { workspaceId: admin.summary.workspaceId });
  if (!workspace) notFound();
  const preflight = await loadSignalGovernedViewsProductPreflightV1({
    queryable: pool, workspace, actor: session.appUser
  });
  return <div className="admin-workspace-page">
    <AdminWorkspaceHeader eyebrow={t("eyebrow")} subtitle={t("pageSubtitle")} title={t("title")} />
    <GovernedViewsManager initial={preflight} workspaceId={workspace.id} />
  </div>;
}

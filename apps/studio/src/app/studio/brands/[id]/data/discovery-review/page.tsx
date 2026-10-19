import { Binoculars } from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import "@/app/signal-v2/signal-v2.css";
import "@/app/studio/topic-discovery-review.css";

import { TopicDiscoveryReviewWorkbench } from "@/components/admin/TopicDiscoveryReviewWorkbench";
import { AdminWorkspaceHeader } from "@/components/admin/AdminWorkspacePrimitives";
import { requireStudioUser } from "@/lib/auth/guards";
import { getAdminBrandWorkspace } from "@/lib/data/admin-workspace";

export const dynamic = "force-dynamic";

export default async function TopicDiscoveryReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, session] = await Promise.all([
    getTranslations("AdminWorkspace.data.discoveryReview"),
    requireStudioUser(`/studio/brands/${id}/data/discovery-review`)
  ]);
  if (session.appUser.userType !== "noisia_internal") notFound();
  const workspace = await getAdminBrandWorkspace(session.appUser, id);
  if (!workspace?.summary.workspaceId) notFound();

  return (
    <div className="admin-workspace-page">
      <AdminWorkspaceHeader
        eyebrow={`${workspace.summary.brandName} · ${t("eyebrow")}`}
        icon={<Binoculars aria-hidden size={21} weight="fill" />}
        subtitle={t("subtitle")}
        title={t("title")}
      />
      <TopicDiscoveryReviewWorkbench workspaceId={workspace.summary.workspaceId} />
    </div>
  );
}

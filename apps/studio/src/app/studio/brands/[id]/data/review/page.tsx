import { ArrowRight, Checks } from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";

import "@/app/signal-v2/signal-v2.css";

import { AdminSemanticReviewExperience } from "@/components/admin/AdminSemanticReviewExperience";
import { AdminWorkspaceHeader } from "@/components/admin/AdminWorkspacePrimitives";
import { requireStudioUser } from "@/lib/auth/guards";
import { getAdminBrandWorkspace } from "@/lib/data/admin-workspace";

export const dynamic = "force-dynamic";

export default async function BrandSemanticReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, session] = await Promise.all([
    getTranslations("AdminWorkspace"),
    requireStudioUser(`/studio/brands/${id}/data/review`)
  ]);
  const workspace = await getAdminBrandWorkspace(session.appUser, id);
  if (!workspace?.summary.workspaceId) notFound();

  return (
    <div className="admin-workspace-page">
      <AdminWorkspaceHeader
        actions={(
          <Link className="admin-button" href={`/studio/brands/${id}/data/mentions`} prefetch={false}>
            {t("data.actions.openMentions")}<ArrowRight aria-hidden size={14} />
          </Link>
        )}
        eyebrow={`${workspace.summary.brandName} · ${t("data.eyebrow")}`}
        icon={<Checks aria-hidden size={21} weight="fill" />}
        subtitle={t("data.semanticReview.subtitle")}
        title={t("data.semanticReview.title")}
      />

      <AdminSemanticReviewExperience
        sources={workspace.sources}
        workspaceId={workspace.summary.workspaceId}
      />
    </div>
  );
}

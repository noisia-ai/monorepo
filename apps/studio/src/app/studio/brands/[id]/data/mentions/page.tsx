import { ArrowRight, ChatText } from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";

import "@/app/signal-v2/signal-v2.css";

import { AdminBrandMentionsManager } from "@/components/admin/AdminBrandMentionsManager";
import { AdminWorkspaceHeader } from "@/components/admin/AdminWorkspacePrimitives";
import { requireStudioUser } from "@/lib/auth/guards";
import { getAdminBrandWorkspace } from "@/lib/data/admin-workspace";

export const dynamic = "force-dynamic";

export default async function BrandMentionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, session] = await Promise.all([
    getTranslations("AdminWorkspace"),
    requireStudioUser(`/studio/brands/${id}/data/mentions`)
  ]);
  const workspace = await getAdminBrandWorkspace(session.appUser, id);
  if (!workspace?.summary.workspaceId) notFound();

  return (
    <div className="admin-workspace-page">
      <AdminWorkspaceHeader
        actions={(
          <Link className="admin-button" href={`/studio/brands/${id}/data/review`} prefetch={false}>
            {t("data.actions.openReview")}<ArrowRight aria-hidden size={14} />
          </Link>
        )}
        eyebrow={`${workspace.summary.brandName} · ${t("data.eyebrow")}`}
        icon={<ChatText aria-hidden size={21} weight="fill" />}
        subtitle={t("data.mentions.subtitle")}
        title={t("data.mentions.title")}
      />

      <AdminBrandMentionsManager
        coverageFrom={workspace.summary.coverageFrom}
        coverageThrough={workspace.summary.coverageThrough}
        reviewHref={`/studio/brands/${id}/data/review`}
        workspaceId={workspace.summary.workspaceId}
      />
    </div>
  );
}

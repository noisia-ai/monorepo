import { ArrowLeft, MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import {
  AdminFeedbackState,
  AdminWorkspaceHeader
} from "@/components/admin/AdminWorkspacePrimitives";

export default async function StudioNotFound() {
  const t = await getTranslations("AdminWorkspace.feedback.notFound");

  return (
    <div className="admin-workspace-page">
      <AdminWorkspaceHeader
        eyebrow={t("eyebrow")}
        subtitle={t("subtitle")}
        title={t("title")}
      />
      <AdminFeedbackState
        actions={(
          <Link className="admin-button admin-button--primary" href="/studio" prefetch={false}>
            <ArrowLeft aria-hidden size={15} />
            {t("back")}
          </Link>
        )}
        body={t("body")}
        icon={<MagnifyingGlass size={22} weight="bold" />}
        title={t("stateTitle")}
      />
    </div>
  );
}

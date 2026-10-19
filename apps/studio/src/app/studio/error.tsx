"use client";

import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";

import {
  AdminFeedbackState,
  AdminWorkspaceHeader
} from "@/components/admin/AdminWorkspacePrimitives";

export default function StudioError({ error, reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("AdminWorkspace.feedback.error");

  return (
    <div className="admin-workspace-page">
      <AdminWorkspaceHeader
        eyebrow={t("eyebrow")}
        subtitle={t("subtitle")}
        title={t("title")}
      />
      <AdminFeedbackState
        actions={(
          <button className="admin-button admin-button--primary" onClick={reset} type="button">
            <ArrowClockwise aria-hidden size={15} />
            {t("retry")}
          </button>
        )}
        body={t("body")}
        detail={error.message ? <><strong>{t("detail")}</strong><span>{error.message}</span></> : undefined}
        icon={<WarningCircle size={22} weight="fill" />}
        title={t("stateTitle")}
        tone="danger"
      />
    </div>
  );
}

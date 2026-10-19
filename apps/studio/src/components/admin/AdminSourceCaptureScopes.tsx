import { useTranslations } from "next-intl";
import { ADMIN_SOURCE_CAPTURE_SCOPES, type AdminSourceImportCaptureScopes } from "@/lib/data/admin-source-capture-scopes";

/** An import summary stays separate from the connector's approval and scope. */
export function AdminSourceCaptureScopes({ summary }: { summary: AdminSourceImportCaptureScopes | null | undefined }) {
  const t = useTranslations("AdminWorkspace.brand.sources.captureScopes");
  if (!summary) return <span className="admin-table__muted">{t("unavailable")}</span>;
  if (!summary.accepted_files) return <span className="admin-table__muted">{t("empty")}</span>;
  return <div className="admin-table__primary">
    {ADMIN_SOURCE_CAPTURE_SCOPES.filter(scope => summary[scope] > 0).map(scope =>
      <span key={scope}>{t("item", { scope: t(scope), count: summary[scope] })}</span>)}
  </div>;
}

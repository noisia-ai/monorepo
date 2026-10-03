"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import type { SignalWorkspaceCorpusReadinessV1 } from "@noisia/db";
import type { ClientBrandWorkspaceEntryV1 } from "@/lib/data-os/workspace-management-entry";
import type { AdminCorpusSummary } from "@/lib/data/admin-corpus-presentation";
import { AdminCorpusSummaryStrip } from "@/components/admin/AdminCorpusSummary";
import { WorkspaceCorpusReadinessPanel } from "@/components/admin/WorkspaceCorpusReadinessPanel";
import { SelfServiceImportManager } from "@/components/admin/SelfServiceImportManager";
import { ClientProcessingJourney } from "@/components/brands/ClientProcessingJourney";

type Props = { entry: ClientBrandWorkspaceEntryV1; initialReadiness: SignalWorkspaceCorpusReadinessV1 | null; corpus: AdminCorpusSummary | null };
export function ClientBrandWorkspaceData(props: Props) {
  return <ScopedBrandData key={`${props.entry.workspaceId}:${props.entry.requestScope}`} {...props} />;
}
function ScopedBrandData({ entry, initialReadiness, corpus }: Props) {
  const t = useTranslations("ClientWorkspaceEntry");
  const [denied, setDenied] = useState(false);
  const revoke = useCallback(() => setDenied(true), []);
  if (denied || !entry.capabilities.can_view) return <p role="alert" className="workspace-form__error">{t("forbidden")}</p>;
  return <div className="admin-drawer-form">
    <AdminCorpusSummaryStrip corpus={corpus} />
    <WorkspaceCorpusReadinessPanel initial={initialReadiness} workspaceId={entry.workspaceId}
      canProcess={false} showProcessingControls={false} onAccessDenied={revoke} />
    {entry.capabilities.can_import_mentions ? <SelfServiceImportManager brandId={entry.brandId} workspaceId={entry.workspaceId}
      timezone={entry.timezone} requestScope={entry.requestScope} canImport canProcess={false}
      topicsHref={entry.navigation.topicsHref} onAccessDenied={revoke} />
      : <p role="status">{t("dataReadOnly")}</p>}
    <ClientProcessingJourney workspaceId={entry.workspaceId} onAccessDenied={revoke} />
  </div>;
}

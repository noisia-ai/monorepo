"use client";

import { ArrowSquareOut, CheckCircle, ClockCounterClockwise } from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  AdminResourceSection,
  AdminStatus,
  formatAdminDate
} from "@/components/admin/AdminWorkspacePrimitives";
import type { SignalStrategicReleaseSummary } from "@/lib/data-os/signal-strategic-releases";

export function StrategicReleaseManager({
  history,
  workspaceId,
  workspaceSlug
}: {
  history: SignalStrategicReleaseSummary[];
  workspaceId: string;
  workspaceSlug: string;
}) {
  const t = useTranslations("AdminWorkspace.reports.releases");
  const locale = useLocale();
  const router = useRouter();
  const [busy,setBusy] = useState<string|null>(null);
  const [error,setError] = useState<string|null>(null);
  const keys = useRef(new Map<string,string>());
  const promote = async (releaseId: string) => {
    const key = keys.current.get(releaseId) ?? crypto.randomUUID();
    keys.current.set(releaseId,key);setBusy(releaseId);setError(null);
    try {
      const response = await fetch(`/api/data-os/signal/${workspaceId}/releases`,{
        method: "POST",cache: "no-store",
        headers: { "Content-Type": "application/json","Idempotency-Key": key },
        body: JSON.stringify({ action: "promote",release_id: releaseId })
      });
      const payload = await response.json() as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? t("error"));
      keys.current.delete(releaseId);router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("error"));
    } finally { setBusy(null); }
  };
  return <AdminResourceSection
    actions={history.some((release) => release.is_current)
      ? <Link className="admin-button admin-button--compact" href={`/signal/${workspaceSlug}/reports/triggers-barriers`} prefetch={false}>{t("openCurrent")}<ArrowSquareOut aria-hidden size={14} /></Link>
      : undefined}
    subtitle={t("subtitle")}
    title={t("title")}
  >
    {error ? <p className="workspace-form__error" role="alert">{error}</p> : null}
    {history.length===0 ? <div className="admin-empty admin-empty--compact"><strong>{t("empty")}</strong></div> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>{t("revision")}</th><th>{t("period")}</th><th>{t("status")}</th><th>{t("review")}</th><th aria-label={t("actions")} /></tr></thead><tbody>
      {history.map((release) => <tr key={release.release_id}>
        <td><div className="admin-table__primary"><strong>r{release.report_revision} · {release.title}</strong><small>{release.artifact_count} {t("artifacts")}</small></div></td>
        <td>{release.period_start} – {release.period_end}</td>
        <td><AdminStatus state={release.is_current ? "good" : release.status==="draft" ? "warning" : "not_available"}>{release.is_current ? t("current") : release.status}</AdminStatus></td>
        <td>{formatAdminDate(release.approved_at,locale)}</td>
        <td>{release.status==="draft" ? <button className="admin-button admin-button--compact admin-button--primary" disabled={busy!==null} onClick={() => void promote(release.release_id)} type="button"><CheckCircle aria-hidden size={14} />{t("promote")}</button> : <ClockCounterClockwise aria-label={t("history")} size={17} />}</td>
      </tr>)}
    </tbody></table></div>}
  </AdminResourceSection>;
}

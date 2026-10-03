"use client";

import { ArrowsClockwise, CheckCircle, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { AdminResourceSection, AdminSettingsRow, AdminStatus } from "@/components/admin/AdminWorkspacePrimitives";
import type { SignalStrategicProductStatusV1 } from "@/lib/data-os/signal-strategic-product";

export function StrategicAuthorityManager({ initial, workspaceId }: {
  initial: SignalStrategicProductStatusV1;
  workspaceId: string;
}) {
  const t = useTranslations("AdminWorkspace.reports.authority");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keys = useRef(new Map<string,string>());
  const mutate = async (action: "reconcile" | "promote") => {
    const key = keys.current.get(action) ?? crypto.randomUUID();
    keys.current.set(action,key);
    setBusy(true);setError(null);
    try {
      const response = await fetch(`/api/data-os/signal/${workspaceId}/reports/triggers-barriers/authority`, {
        method: "POST",cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ action })
      });
      const payload = await response.json() as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? t("error"));
      keys.current.delete(action);router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("error"));
    } finally { setBusy(false); }
  };
  return <AdminResourceSection
    actions={<AdminStatus state={initial.state === "current" ? "good" : "warning"}>{t(`states.${initial.state}`)}</AdminStatus>}
    subtitle={t("subtitle")}
    title={t("title")}
  >
    <div className="admin-settings-list">
      <AdminSettingsRow icon={<ShieldCheck aria-hidden size={17} />} title={t("usages")} description={t("usagesHelp")} value={initial.required_usage_purposes.join(" · ")} />
      <AdminSettingsRow title={t("population")} value={initial.population ? `${initial.population.reference} · ${initial.population.denominator_count}` : "—"} />
      <AdminSettingsRow title={t("executionCorpus")} value={<AdminStatus state={initial.execution_corpus_ready ? "good" : "warning"}>{t(initial.execution_corpus_ready ? "ready" : "blocked")}</AdminStatus>} />
      <AdminSettingsRow title={t("binding")} value={<AdminStatus state={initial.binding_current ? "good" : "warning"}>{t(initial.binding_current ? "current" : "notCurrent")}</AdminStatus>} />
      {initial.blockers.length ? <AdminSettingsRow icon={<WarningCircle aria-hidden size={17} />} title={t("blockers")} description={<ul>{initial.blockers.map((blocker) => <li key={blocker}>{blocker.replaceAll("_"," ")}</li>)}</ul>} /> : null}
      <AdminSettingsRow
        title={t("actionsTitle")}
        description={t("actionsHelp")}
        action={<div className="admin-workspace-actions">
          <button className="admin-button admin-button--compact" disabled={busy} onClick={() => void mutate("reconcile")} type="button"><ArrowsClockwise aria-hidden size={14} />{t("reconcile")}</button>
          {initial.state === "ready" ? <button className="admin-button admin-button--compact admin-button--primary" disabled={busy} onClick={() => void mutate("promote")} type="button"><CheckCircle aria-hidden size={14} />{t("promote")}</button> : null}
        </div>}
      />
    </div>
    {error ? <p className="workspace-form__error" role="alert">{error}</p> : null}
  </AdminResourceSection>;
}

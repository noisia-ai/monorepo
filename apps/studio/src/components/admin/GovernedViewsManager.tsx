"use client";

import { ArrowCounterClockwise, ArrowsClockwise, CheckCircle, PauseCircle, WarningCircle } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { AdminResourceSection, AdminStatus } from "@/components/admin/AdminWorkspacePrimitives";
import type { SignalGovernedViewsProductPreflightV1 } from "@/lib/data-os/signal-governed-view-orchestrator";

export function GovernedViewsManager({ initial, workspaceId }: {
  initial: SignalGovernedViewsProductPreflightV1;
  workspaceId: string;
}) {
  const t = useTranslations("AdminWorkspace.data.governedViews");
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());
  const currentCount = useMemo(() => initial.views.filter((view) => view.state === "current").length, [initial]);

  const mutate = async (viewKey: string, action: "reconcile" | "promote" | "withdraw", digest: string | null) => {
    const identity = `${viewKey}:${action}:${digest ?? "draft"}`;
    const key = keys.current.get(identity) ?? crypto.randomUUID();
    keys.current.set(identity, key);
    setBusy(identity);
    setError(null);
    try {
      const endpoint = action === "reconcile"
        ? `/api/data-os/signal/${workspaceId}/governed-views`
        : `/api/data-os/signal/${workspaceId}/governed-views/${viewKey}/${action}`;
      const response = await fetch(endpoint, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(action === "reconcile"
          ? { action, view_key: viewKey }
          : { expected_set_digest: digest })
      });
      const payload = await response.json() as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? t("errors.operation"));
      keys.current.delete(identity);
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("errors.operation"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminResourceSection
      actions={<AdminStatus state={currentCount > 0 ? "good" : "warning"}>{t("currentCount", { count: currentCount })}</AdminStatus>}
      subtitle={t("subtitle")}
      title={t("title")}
    >
      {error ? <p className="workspace-form__error" role="alert">{error}</p> : null}
      <div className="admin-table-wrap">
        <table className="admin-table admin-table--data">
          <thead><tr><th>{t("columns.view")}</th><th>{t("columns.modules")}</th><th>{t("columns.denominator")}</th><th>{t("columns.coverage")}</th><th>{t("columns.status")}</th><th aria-label={t("columns.actions")} /></tr></thead>
          <tbody>{initial.views.map((view) => {
            const stateTone = view.state === "current" || view.state === "ready" ? "good"
              : view.state === "not_applicable" ? "not_available" : "warning";
            return <tr key={view.view_key}>
              <td><div className="admin-table__primary"><strong>{t(`views.${view.view_key}`)}</strong><small>{t("entities", { count: view.entity_count })}</small></div></td>
              <td>{view.modules.map((module) => <div className="admin-table__primary" key={module.module_key}><strong>{t(`modules.${module.module_key}`)}</strong><small>{t(`states.${module.state}`)}</small></div>)}</td>
              <td>{view.modules.map((module) => <div key={module.module_key}>{module.denominator_count ?? "—"}</div>)}</td>
              <td>{view.modules.map((module) => <div key={module.module_key}>{module.coverage_state === "partial" ? t("coverage.partial") : t("coverage.notAvailable")}</div>)}</td>
              <td><AdminStatus state={stateTone}>{t(`states.${view.state}`)}</AdminStatus>{view.blockers.length ? <details><summary>{t("blockers", { count: view.blockers.length })}</summary><ul>{view.blockers.map((blocker) => <li key={blocker}>{humanize(blocker)}</li>)}</ul></details> : null}</td>
              <td><div className="admin-workspace-actions">
                {!view.applicable ? <PauseCircle aria-label={t("states.not_applicable")} size={18} /> : null}
                {view.applicable && view.state !== "current" ? <button className="admin-button admin-button--compact" disabled={busy !== null} onClick={() => void mutate(view.view_key, "reconcile", view.set_digest)} type="button"><ArrowsClockwise aria-hidden size={14} />{t("actions.reconcile")}</button> : null}
                {view.state === "ready" && view.set_digest ? <button className="admin-button admin-button--compact admin-button--primary" disabled={busy !== null} onClick={() => void mutate(view.view_key, "promote", view.set_digest)} type="button"><CheckCircle aria-hidden size={14} />{t("actions.promote")}</button> : null}
                {view.state === "current" && view.set_digest ? <button className="admin-button admin-button--compact admin-button--danger" disabled={busy !== null} onClick={() => void mutate(view.view_key, "withdraw", view.set_digest)} type="button"><ArrowCounterClockwise aria-hidden size={14} />{t("actions.withdraw")}</button> : null}
                {view.applicable && view.state === "blocked" ? <WarningCircle aria-hidden size={18} /> : null}
              </div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <p className="admin-table__muted">{t("footnote")}</p>
    </AdminResourceSection>
  );
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replaceAll("-", " ");
}

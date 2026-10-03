"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { GovernancePreparationManager } from "./GovernancePreparationManager";
import type { SignalGovernancePreparationV1 } from "@/lib/data-os/signal-governance-control-plane";

/** This advanced operator view scans semantic assertions. Keep it out of the
 * critical path for opening the workspace import form. */
export function LazyGovernancePreparation({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("AdminWorkspace.data.advancedPreparation");
  const [data, setData] = useState<SignalGovernancePreparationV1 | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(`/api/data-os/signal/${workspaceId}/governance`, {
        cache: "no-store", signal: controller.signal
      });
      if (!response.ok) throw new Error("governance_unavailable");
      const next = await response.json() as SignalGovernancePreparationV1;
      if (next.contract_version !== "signal-governance-control-plane-v1") throw new Error("governance_invalid");
      if (!controller.signal.aborted) setData(next);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    setData(null);
    setError(false);
    setLoading(false);
    return () => { request.current?.abort(); request.current = null; };
  }, [workspaceId]);

  return <details className="admin-section" style={{ padding: 16 }} onToggle={(event) => {
    if (event.currentTarget.open && !data && !loading && !error) void refresh();
  }}>
    <summary>{t("title")}</summary>
    <p className="admin-table__muted">{t("body")}</p>
    {loading && !data ? <p role="status">{t("loading")}</p> : null}
    {error ? <p role="alert">{t("error")} <button className="admin-button admin-button--compact" onClick={() => void refresh()} type="button">{t("retry")}</button></p> : null}
    {data ? <GovernancePreparationManager initial={data} workspaceId={workspaceId} onChanged={refresh} /> : null}
  </details>;
}

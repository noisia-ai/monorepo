"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { WorkspaceManualImportSetupV1 } from "@/lib/data-os/workspace-manual-import-setup";

import { AcquisitionPlanManager } from "@/components/admin/AcquisitionPlanManager";
import { AdminResourceSection } from "@/components/admin/AdminWorkspacePrimitives";

type Setup = WorkspaceManualImportSetupV1;

type Props = { brandId: string; workspaceId: string; timezone: string; requestScope?: string;
  topicsHref?: string; canImport?: boolean; canProcess?: boolean; onAccessDenied?: () => void };
export function SelfServiceImportManager(props: Props) {
  return props.canImport === false ? null : <ScopedImportManager key={`${props.workspaceId}:${props.requestScope ?? "internal"}`} {...props} />;
}
function ScopedImportManager({ brandId, workspaceId, timezone, topicsHref, canProcess = true, onAccessDenied }: Props) {
  const t = useTranslations("AdminWorkspace.data.selfService");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingSource, setAddingSource] = useState(false);
  const [revision, setRevision] = useState(0);
  const [configurationRequest, setConfigurationRequest] = useState(0);
  const [category, setCategory] = useState("");
  const alive = useRef(true), epoch = useRef(0);
  const reader = useRef<AbortController | null>(null), writer = useRef<AbortController | null>(null);
  const accessCallback = useRef(onAccessDenied); accessCallback.current = onAccessDenied;
  const denied = useRef(false);
  const clearAccess = useCallback(() => {
    epoch.current++; denied.current = true; reader.current?.abort(); writer.current?.abort();
    setSetup(null); setAddingSource(false); setCategory(""); setBusy(false); setLoading(false);
    setError(t("errors.forbidden")); accessCallback.current?.();
  }, [t]);
  const configured = setup?.configured ?? false;
  const hasPreparedSource = Boolean(setup?.sources.length);
  const endpoint = `/api/data-os/signal/${workspaceId}/imports/setup`;

  const load = useCallback(async () => {
    reader.current?.abort(); const controller = new AbortController(); reader.current = controller;
    const ticket = epoch.current;
    setLoading(true); setError(null);
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
      if (!alive.current || controller.signal.aborted || ticket !== epoch.current) return;
      if ([401, 403, 404].includes(response.status)) { clearAccess(); return; }
      if (!response.ok) throw new Error();
      const next = await response.json() as Setup;
      if (!alive.current || controller.signal.aborted || ticket !== epoch.current) return;
      if (next.contract_version !== "signal-workspace-manual-import-setup-v1" || !Array.isArray(next.sources)
        || next.import_url !== `/api/data-os/signal/${workspaceId}/acquisition-plan/imports`) throw new Error();
      denied.current = false; setSetup(next);
      setCategory(next.category_name ?? next.category_name_suggested ?? "");
    } catch { if (alive.current && !controller.signal.aborted && ticket === epoch.current) setError(t("errors.load")); }
    finally { if (alive.current && !controller.signal.aborted && ticket === epoch.current) setLoading(false); }
  }, [clearAccess, endpoint, t, workspaceId]);
  useEffect(() => { const fence = epoch; alive.current = true; void load(); return () => {
    alive.current = false; fence.current++; reader.current?.abort(); writer.current?.abort();
  }; }, [load]);

  async function prepare(form: FormData) {
    if (busy || denied.current || !setup) return;
    const ticket = epoch.current, controller = new AbortController(); writer.current = controller;
    setBusy(true); setError(null);
    const retentionDate = String(form.get("retention_until") ?? "").trim();
    const body = JSON.stringify({
      contract_version: "signal-workspace-manual-import-setup-v1",
      provider: "sentione",
      source_name: String(form.get("source_name") ?? "").trim(),
      category_name: category.trim(),
      rights: {
        storage_and_analysis: form.get("storage_and_analysis") === "on",
        external_ai_processing: form.get("external_ai_processing") === "on",
        retention_until: retentionDate ? new Date(`${retentionDate}T23:59:59.999`).toISOString() : null
      }
    });
    try {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${workspaceId}:${body}`));
      const key = `manual-import-setup:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
      if (!alive.current || ticket !== epoch.current) return;
      const response = await fetch(endpoint, { method: "POST", body, signal: controller.signal, headers: {
        "Content-Type": "application/json", "Idempotency-Key": key
      } });
      if (!alive.current || ticket !== epoch.current || controller.signal.aborted) return;
      if ([401, 403, 404].includes(response.status)) { clearAccess(); return; }
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!alive.current || ticket !== epoch.current || controller.signal.aborted) return;
      if (!response.ok) throw new Error(payload.error ?? "unknown");
      // Re-read durable state, including after a retry of an acknowledged setup.
      await load(); if (!alive.current || ticket !== epoch.current) return; setAddingSource(false); setRevision((value) => value + 1);
    } catch (failure) {
      if (!alive.current || ticket !== epoch.current || controller.signal.aborted) return;
      const code = failure instanceof Error ? failure.message : "unknown";
      setError(t(code === "forbidden" || code.includes("forbidden") ? "errors.forbidden"
        : code.includes("rights") ? "errors.rights" : code.includes("category") ? "errors.category"
          : "errors.save"));
    } finally { if (alive.current && ticket === epoch.current) setBusy(false); }
  }

  return <>
    <AdminResourceSection title={t("title")} subtitle={t("body")}>
      {loading ? <p role="status">{t("loading")}</p> : null}
      {!loading && error ? <div role="alert"><p className="team-msg team-msg--error">{error}</p>
        {!setup ? <button className="admin-button" onClick={() => void load()} type="button">{t("retry")}</button> : null}</div> : null}
      {!loading && setup && (!hasPreparedSource || addingSource) ? <form className="admin-drawer-form" onSubmit={(event) => {
        event.preventDefault(); void prepare(new FormData(event.currentTarget));
      }}>
        <p className="admin-drawer-form__hint">{t("format")}</p>
        <fieldset disabled={busy} className="self-service-import-fields">
          <label className="workspace-field"><span>{t("source")}</span><input className="workspace-control" name="source_name" required minLength={2} maxLength={160} defaultValue={t("sourceDefault")} /><small>{t("sourceHelp")}</small></label>
          <label className="workspace-field"><span>{t("category")}</span><input className="workspace-control" name="category_name" required minLength={2} maxLength={160} value={category} onChange={(event) => setCategory(event.target.value)} /><small>{t("categoryHelp")}</small></label>
          <label className="semantic-resolution-flight__confirmation"><input type="checkbox" required name="storage_and_analysis" /><span>{t("storageRights")}</span></label>
          <label className="semantic-resolution-flight__confirmation"><input type="checkbox" name="external_ai_processing" /><span>{t("aiRights")}<small>{t("aiRightsHelp")}</small></span></label>
          <details><summary>{t("retention.title")}</summary><label className="workspace-field"><span>{t("retention.date")}</span><input type="date" className="workspace-control" name="retention_until" /><small>{t("retention.help")}</small></label></details>
        </fieldset>
        <div className="admin-workspace-actions"><button className="admin-button admin-button--primary" disabled={busy || !category.trim()} type="submit">{t(busy ? "saving" : "prepare")}</button>
          {addingSource ? <button className="admin-button" disabled={busy} onClick={() => setAddingSource(false)} type="button">{t("cancel")}</button> : null}</div>
      </form> : !loading && setup ? <div className="topics-manager__preparation">
        <div><strong>{t(setup.ready_for_import ? "ready" : !configured ? "contextChanged.title" : "storageBlocked.title")}</strong><p>{t(setup.ready_for_import ? "readyBody" : !configured ? "contextChanged.body" : "storageBlocked.body")}</p></div>
        {setup.needs_plan_update ? <button className="admin-button" onClick={() => { setConfigurationRequest((value) => value + 1); document.getElementById("brand-import-configuration")?.scrollIntoView({ block: "start" }); }} type="button">{t("contextChanged.action")}</button> : null}
        {!setup.ready_for_import ? <button className="admin-button" onClick={() => void load()} type="button">{t("retry")}</button> : null}
        <button className="admin-button" onClick={() => setAddingSource(true)} type="button">{t("addSource")}</button>
      </div> : null}
    </AdminResourceSection>
    {setup && hasPreparedSource ? <div id="brand-import-configuration"><AcquisitionPlanManager canProcess={canProcess} onAccessDenied={clearAccess} configurationRequest={configurationRequest} refreshRevision={revision} importsOnly preparedSourceKeys={setup.sources.map((source) => source.source_key)} timezone={setup.timezone || timezone} workspaceId={workspaceId} /></div> : null}
    <div className="topics-manager__preparation"><div><strong>{t("next.title")}</strong><p>{t("next.body")}</p></div>
      <Link className="admin-button" href={topicsHref ?? `/studio/brands/${encodeURIComponent(brandId)}/topics`} prefetch={false}>{t("next.action")}</Link></div>
  </>;
}

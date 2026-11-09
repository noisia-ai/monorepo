"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { formatEmbeddingMicroUsd, parseEmbeddingCapMicroUsd } from "@/lib/data-os/workspace-corpus-embeddings-ui";
import { useMfpMutation, useMfpResource } from "./useMfpResource";

type Status = {
  contract_version: "mass-labeling-product-status-v2"; workspace_id: string; enabled: boolean; can_request_processing: boolean;
  map: { id: string; root_count: number; topic_count: number } | null;
  run: { id: string; status: string; smoke_root_limit: number | null; smoke_metrics: { technical_failure: boolean } | null;
    counts: Record<string, number>; estimated_micro_usd: string; cap_micro_usd: string | null } | null;
  estimated_micro_usd: number | null; cap_micro_usd: number | null;
};

export function StudyLabelingControls({ workspaceId, signalHref, refreshSignal, onAccessDenied, disabled = false }: {
  workspaceId: string; signalHref: string; refreshSignal?: string; onAccessDenied?: () => void; disabled?: boolean;
}) {
  const t = useTranslations("StudyLabeling"), locale = useLocale();
  const endpoint = `/api/data-os/signal/${encodeURIComponent(workspaceId)}/labeling`;
  const resource = useMfpResource<Status>(endpoint, "mass-labeling-product-status-v2", onAccessDenied, true, refreshSignal);
  const mutation = useMfpMutation(endpoint, onAccessDenied);
  const [cap, setCap] = useState("");
  const data = resource.data?.workspace_id === workspaceId ? resource.data : null;
  const amount = parseEmbeddingCapMicroUsd(cap);
  const capNumber = amount && BigInt(amount) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
  const active = ["queued", "running"].includes(data?.run?.status ?? "");
  const smokeReady = data?.run?.status === "completed" && data.run.smoke_root_limit !== null;
  const ready = data?.run?.status === "completed" && data.run.smoke_root_limit === null;
  const blocked = disabled || !data?.enabled || !data.can_request_processing || mutation.busy || resource.loading || Boolean(resource.error);
  const send = async (body?: Record<string, unknown>) => { if (await mutation.send(body)) await resource.read(); };
  return <section className="admin-section" aria-label={t("title")} aria-busy={resource.loading || mutation.busy}>
    <header className="admin-section__head"><div><h2>{t("title")}</h2><p>{t("body")}</p></div>
      <button className="admin-button" type="button" disabled={resource.loading || mutation.busy}
        onClick={() => void resource.read()}>{t("refresh")}</button></header>
    <div className="admin-section__body admin-drawer-form">
      {!data && resource.loading ? <p role="status">{t("loading")}</p> : null}
      {data && !data.map ? <p>{t("prepareMap")}</p> : null}
      {data?.map ? <>
        <p>{t("population", { roots: data.map.root_count, topics: data.map.topic_count })}</p>
        {data.estimated_micro_usd !== null ? <p>{t("estimate", { amount: formatEmbeddingMicroUsd(String(data.estimated_micro_usd), locale) })}</p> : null}
        {!data.run ? <>
          <label>{t("cap")}<input inputMode="decimal" value={cap} disabled={blocked || mutation.pending}
            onChange={event => setCap(event.target.value)} /></label>
          <button className="admin-button admin-button--primary" type="button"
            disabled={blocked || mutation.pending || !capNumber || data.cap_micro_usd !== null && capNumber > data.cap_micro_usd}
            onClick={() => void send({ action: "start", map_id: data.map!.id, cap_micro_usd: capNumber })}>{t("start")}</button>
          <p className="admin-drawer-form__hint">{t("budgetHelp")}</p>
        </> : null}
        {active ? <p role="status">{t("running")}</p> : null}
        {smokeReady ? <>
          <p role="status">{t(data.run!.smoke_metrics?.technical_failure === false ? "smokeReady" : "smokeBlocked")}</p>
          <button className="admin-button admin-button--primary" type="button"
            disabled={blocked || mutation.pending || data.run!.smoke_metrics?.technical_failure !== false}
            onClick={() => void send({ action: "continue", run_id: data.run!.id })}>{t("continue")}</button>
        </> : null}
        {ready ? <p role="status">{t("completed")} <Link href={signalHref} prefetch={false}>{t("openSignal")}</Link></p> : null}
        {data.run?.status === "failed" ? <><p role="alert">{t("failed")}</p>
          <button className="admin-button" type="button" disabled={blocked || mutation.pending}
            onClick={() => void send({ action: "retry", run_id: data.run!.id })}>{t("resume")}</button></> : null}
      </> : null}
      {mutation.pending ? <><p role="status">{t("pending")}</p><button className="admin-button" type="button"
        disabled={mutation.busy} onClick={() => void send()}>{t("retry")}</button></> : null}
      {resource.error || mutation.error ? <p className="team-msg team-msg--error" role="alert">
        {t(mutation.error === "mass_labeling_receipt_recovery_required" ? "receiptRecovery" : "error")}</p> : null}
    </div>
  </section>;
}

"use client";

import { CircleNotch, Sparkle } from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import type { SignalTopicConsolidationStatusV1 } from "@noisia/db";
import { useCallback, useEffect, useRef, useState } from "react";

import { AdminStatus } from "@/components/admin/AdminWorkspacePrimitives";

export type WorkspaceTopicConsolidationView = SignalTopicConsolidationStatusV1;

export type WorkspaceTopicConsolidationAction = "prepare_numeric";

const states = new Set<WorkspaceTopicConsolidationView["status"]>([
  "access_required", "source_required", "source_stale", "policy_required", "policy_action_required",
  "policy_expired", "budget_unavailable", "ready_to_prepare", "queued", "running", "ready", "failed"
]);
const natural = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const microUsd = (value: unknown): value is string => typeof value === "string" && /^(?:0|[1-9]\d{0,15})$/u.test(value);
const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value);
const validExecution = (value: unknown) => value === null || Boolean(value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("\0") === ["execution_id", "status", "retry_available", "error_code"].sort().join("\0")
  && uuid((value as Record<string, unknown>).execution_id)
  && ["queued", "running", "ready", "failed"].includes(String((value as Record<string, unknown>).status))
  && typeof (value as Record<string, unknown>).retry_available === "boolean"
  && ((value as Record<string, unknown>).error_code === null || typeof (value as Record<string, unknown>).error_code === "string"));

/** Adapter boundary for the future server DTO. Invalid or cross-workspace data stays hidden. */
export function validWorkspaceTopicConsolidationView(value: unknown, workspaceId: string): value is WorkspaceTopicConsolidationView {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const keys = ["contract_version", "workspace_id", "status", "can_request", "provider_execution_enabled", "maximum_micro_usd",
    "confirmed_micro_usd", "reserved_micro_usd", "expected_group_count", "group_count", "source_execution_id",
    "quote_reference", "quote_expires_at", "execution"];
  return Object.keys(row).sort().join("\0") === [...keys].sort().join("\0")
    && row.contract_version === "signal-topic-consolidation-status-v1"
    && row.workspace_id === workspaceId && typeof row.status === "string" && states.has(row.status as WorkspaceTopicConsolidationView["status"])
    && (row.expected_group_count === null || natural(row.expected_group_count)) && natural(row.group_count)
    && (row.expected_group_count === null || row.group_count <= row.expected_group_count)
    && microUsd(row.maximum_micro_usd) && row.maximum_micro_usd === "0"
    && row.confirmed_micro_usd === "0" && row.reserved_micro_usd === "0"
    && row.provider_execution_enabled === false && typeof row.can_request === "boolean"
    && (row.source_execution_id === null || uuid(row.source_execution_id))
    && (row.quote_reference === null || typeof row.quote_reference === "string" && /^v1\.[0-9]{10}\.[0-9a-f]{64}$/u.test(row.quote_reference))
    && (row.quote_expires_at === null || typeof row.quote_expires_at === "string" && Number.isFinite(Date.parse(row.quote_expires_at)))
    && validExecution(row.execution);
}

export function WorkspaceTopicConsolidationCard({ value, disabled = false, onAction }: {
  value: WorkspaceTopicConsolidationView;
  disabled?: boolean;
  onAction?: (action: WorkspaceTopicConsolidationAction) => void;
}) {
  const t = useTranslations("AdminWorkspace.topics.consolidation");
  const locale = useLocale();
  const number = (value: number) => value.toLocaleString(locale);
  const expectedGroups = value.expected_group_count ?? value.group_count;
  const prepared = value.group_count;
  const progress = expectedGroups > 0 ? Math.min(100, Math.round(prepared / expectedGroups * 100)) : null;
  const pendingPreparation = Math.max(0, expectedGroups - prepared);
  const action: WorkspaceTopicConsolidationAction | null = value.status === "ready_to_prepare" && value.can_request
    ? "prepare_numeric" : value.status === "failed" && value.can_request && value.execution?.retry_available ? "prepare_numeric" : null;
  const active = value.status === "queued" || value.status === "running";
  const tone = value.status === "ready" ? "good" : value.status === "failed" || value.status.endsWith("required")
    || value.status === "source_stale" || value.status === "policy_expired" || value.status === "budget_unavailable"
    ? "warning" : value.status === "ready_to_prepare" ? "not_available" : "warning";

  return <section className="admin-section topics-manager__consolidation" data-provider-execution="disabled"
    data-topic-consolidation-state={value.status}>
    <div className="admin-section__head"><div><h3>{t("title")}</h3>
      <p>{t("body", { count: expectedGroups })}</p></div>
      <AdminStatus state={tone}>{t(`states.${value.status}`)}</AdminStatus>
    </div>
    <div className="admin-section__body admin-drawer-form">
      <dl className="admin-summary-strip admin-summary-strip--compact" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))" }}>
        <div><dt>{t("groups")}</dt><dd>{expectedGroups > 0 ? number(expectedGroups) : t("unavailable")}</dd></div>
        <div><dt>{t("numeric")}</dt><dd>{value.expected_group_count === null ? t("unavailable")
          : t("prepared", { done: prepared, total: expectedGroups })}</dd></div>
      </dl>
      {progress !== null && value.status !== "ready_to_prepare" && value.status !== "ready" ? <div className="topics-manager__progress" role="status">
        <span>{t("numericProgress", { done: prepared, total: expectedGroups })}</span>
        <progress aria-label={t("numeric")} max="100" value={progress} /><strong>{progress}%</strong>
      </div> : null}
      <p className="admin-drawer-form__hint">{t("automation")}</p>
      <p className="admin-drawer-form__hint">{t("numericFree")}</p>
      {value.expected_group_count !== null ? <p className="admin-drawer-form__hint">{t(value.status === "ready" ? "reviewGroups" : "preparationGroups", {
        count: value.status === "ready" ? expectedGroups : pendingPreparation
      })}</p> : null}
      {!action && !active && value.status !== "ready" ? <p role="status">{t(`stateBodies.${value.status}`)}</p> : null}
      <div className="admin-form-actions">
        {action ? <button className="admin-button admin-button--primary" disabled={disabled || active || !onAction}
          onClick={() => onAction?.(action)} type="button">
          {active ? <CircleNotch aria-hidden className="workspace-shell__nav-pending" size={15} /> : <Sparkle aria-hidden size={15} />}
          {t(value.status === "failed" ? "retry" : "prepare")}
        </button> : null}
      </div>
    </div>
  </section>;
}

export function WorkspaceTopicConsolidationControls({ workspaceId, disabled = false }: {
  workspaceId: string; disabled?: boolean;
}) {
  const t = useTranslations("AdminWorkspace.topics.consolidation");
  const [value, setValue] = useState<WorkspaceTopicConsolidationView | null>(null);
  const [reading, setReading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const read = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    try {
      const response = await fetch(`/api/data-os/signal/${encodeURIComponent(workspaceId)}/topics/consolidation`,
        { cache: "no-store", signal: controller.signal });
      const body = await response.json() as unknown;
      if (!response.ok || !validWorkspaceTopicConsolidationView(body, workspaceId)) throw new Error("load");
      if (mounted.current && !controller.signal.aborted) { setValue(body); setError(false); }
    } catch {
      if (mounted.current && !controller.signal.aborted) setError(true);
    } finally {
      if (mounted.current && request.current === controller) { request.current = null; setReading(false); }
    }
  }, [workspaceId]);
  useEffect(() => {
    mounted.current = true; void read();
    return () => { mounted.current = false; request.current?.abort(); };
  }, [read]);
  useEffect(() => {
    if (!value || !["queued", "running"].includes(value.status)) return;
    const timer = window.setInterval(() => void read(), 2_500);
    return () => window.clearInterval(timer);
  }, [read, value]);
  const prepare = async () => {
    if (!value || disabled || submitting) return;
    const body = value.status === "failed" && value.execution?.retry_available
      ? { action: "retry_numeric", execution_id: value.execution.execution_id }
      : value.status === "ready_to_prepare" && value.can_request && value.source_execution_id && value.quote_reference
        ? { action: "prepare_numeric", source_execution_id: value.source_execution_id, quote_reference: value.quote_reference }
        : null;
    if (!body) return;
    setSubmitting(true); setError(false);
    try {
      const response = await fetch(`/api/data-os/signal/${encodeURIComponent(workspaceId)}/topics/consolidation`, {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body)
      });
      const next = await response.json() as unknown;
      if (!response.ok || !validWorkspaceTopicConsolidationView(next, workspaceId)) throw new Error("request");
      if (mounted.current) setValue(next);
    } catch {
      if (mounted.current) { setError(true); await read(); }
    } finally { if (mounted.current) setSubmitting(false); }
  };
  if (reading && !value) return null;
  if (!value) return error ? <p className="team-msg team-msg--error" role="alert">{t("loadError")}</p> : null;
  return <>
    <WorkspaceTopicConsolidationCard disabled={disabled || submitting} onAction={() => void prepare()} value={value} />
    {error ? <p className="team-msg team-msg--error" role="alert">{t("requestError")}</p> : null}
  </>;
}

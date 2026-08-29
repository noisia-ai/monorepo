"use client";

import { ChartLineUp, CircleNotch, Play, Warning } from "@phosphor-icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  AdminFeedbackState,
  AdminResourceSection,
  AdminStatus,
  AdminSummaryStrip,
  formatAdminNumber
} from "@/components/admin/AdminWorkspacePrimitives";
import { WorkspaceDrawer } from "@/components/workspace/WorkspaceShell";
import {
  acquireSignalTopicEvaluationSubmissionLockV1,
  buildSignalTopicEvaluationLaunchRequestV1,
  canLaunchSignalTopicEvaluationV1,
  createSignalTopicEvaluationIdempotencyKeyV1,
  projectSignalTopicEvaluationFlightCardV1,
  readSignalTopicEvaluationRunStatusV1,
  type SignalTopicEvaluationFlightCardV1
} from "@/lib/data-os/signal-topic-evaluation-launch";

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = typeof payload?.message === "string"
      ? payload.message
      : typeof payload?.error === "string" ? payload.error : "request_failed";
    throw new Error(message);
  }
  return payload;
}

function microUsd(value: string | null, locale: string) {
  if (!value || !/^\d+$/u.test(value)) return "USD —";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    currencyDisplay: "code",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  }).format(Number(BigInt(value)) / 1_000_000);
}

type StoredAttempt = { idempotencyKey: string; status: "queued" | null };

function readStoredAttempt(value: string | null): StoredAttempt | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredAttempt>;
    if (typeof parsed.idempotencyKey !== "string"
      || !parsed.idempotencyKey.startsWith("topic-evaluation:start:")
      || (parsed.status !== null && parsed.status !== "queued")) return null;
    return { idempotencyKey: parsed.idempotencyKey, status: parsed.status };
  } catch { return null; }
}

export function TopicEvaluationManager({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("AdminWorkspace.brandOs.topicEvaluation");
  const locale = useLocale();
  const endpoint = `/api/data-os/signal/${workspaceId}/topic-evaluation`;
  const storageKey = `noisia:topic-evaluation-launch:${workspaceId}`;
  const [card, setCard] = useState<SignalTopicEvaluationFlightCardV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [attemptRecorded, setAttemptRecorded] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [runStatus, setRunStatus] = useState<"queued" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitLockRef = useRef(false);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const payload = await requestJson(endpoint);
      setCard(projectSignalTopicEvaluationFlightCardV1(payload));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("errors.load"));
    } finally { setLoading(false); }
  }, [endpoint, t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const stored = readStoredAttempt(window.sessionStorage.getItem(storageKey));
    setAttemptRecorded(stored !== null);
    setRunStatus(stored?.status ?? null);
    submitLockRef.current = stored !== null;
    setSessionChecked(true);
  }, [storageKey]);

  const ready = card ? canLaunchSignalTopicEvaluationV1(card) : false;
  const commandDisabled = !sessionChecked || !ready || !acknowledged
    || attemptRecorded || submitting;

  async function submit() {
    if (!card || commandDisabled
      || !acquireSignalTopicEvaluationSubmissionLockV1(submitLockRef)) return;
    const idempotencyKey = createSignalTopicEvaluationIdempotencyKeyV1();
    const command = buildSignalTopicEvaluationLaunchRequestV1({
      acknowledged,
      card,
      idempotencyKey
    });
    setSubmitting(true); setAttemptRecorded(true); setError(null);
    window.sessionStorage.setItem(storageKey, JSON.stringify({ idempotencyKey, status: null }));
    try {
      const payload = await requestJson(endpoint, {
        method: "POST",
        headers: command.headers,
        body: JSON.stringify(command.body)
      });
      const status = readSignalTopicEvaluationRunStatusV1(payload);
      setRunStatus(status);
      window.sessionStorage.setItem(storageKey, JSON.stringify({ idempotencyKey, status }));
      setDrawerOpen(false); setAcknowledged(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("errors.start"));
    } finally { setSubmitting(false); }
  }

  const actions = <>
    <button className="admin-button" disabled={loading || submitting} onClick={() => void load()} type="button">
      {loading ? <CircleNotch aria-hidden className="icon--spin" size={14}/> : null}
      {t("actions.refresh")}
    </button>
    <button className="admin-button admin-button--primary" disabled={!ready || attemptRecorded || loading}
      onClick={(event) => { openerRef.current = event.currentTarget; setAcknowledged(false); setDrawerOpen(true); }}
      type="button">
      <Play aria-hidden size={15}/>{t("actions.open")}
    </button>
  </>;

  return <>
    <AdminResourceSection actions={actions} className="topic-evaluation-manager"
      subtitle={t("subtitle")} title={t("title")}>
      {loading && !card ? <div aria-busy="true" aria-live="polite"
        className="semantic-context-pack__preflight-loading" role="status">
        <CircleNotch aria-hidden className="icon--spin" size={18}/><span>{t("loading")}</span>
      </div> : null}
      {error && !card ? <AdminFeedbackState actions={attemptRecorded ? undefined
        : <button className="admin-button" onClick={() => void load()} type="button">{t("actions.refresh")}</button>}
        body={error} icon={<Warning size={20}/>} title={t("errors.title")} tone="danger"/> : null}
      {card ? <>
        <AdminSummaryStrip density="compact" items={[
          { label: t("summary.proposals"), value: formatAdminNumber(card.proposalCount, locale), hint: t("summary.proposalsHint") },
          { label: t("summary.model"), value: card.model ?? "—", hint: card.pricingVersion ?? t("summary.unconfigured") },
          { label: t("summary.estimate"), value: microUsd(card.estimatedMaxCostMicroUsd, locale), hint: t("summary.oneCall") },
          { label: t("summary.hardCap"), value: microUsd(card.hardCapMicroUsd, locale), hint: t("summary.noRetry") }
        ]}/>
        <div className="semantic-context-pack__notice" data-tone={ready ? undefined : "warning"}>
          <ChartLineUp aria-hidden size={18}/>
          <div><strong>{ready ? t("boundary.title") : t("boundary.blockedTitle")}</strong>
            <p>{ready ? t("boundary.body", { minimum: card.successMinimumCandidates }) : t("boundary.blockedBody")}</p>
          </div>
          <AdminStatus state={ready ? "good" : "warning"}>{ready ? t("states.ready") : t("states.blocked")}</AdminStatus>
        </div>
        {runStatus ? <div className="semantic-context-pack__run" role="status">
          <div className="semantic-context-pack__run-copy"><span className="semantic-context-pack__run-icon">
            <CircleNotch aria-hidden className="icon--spin" size={16}/></span>
            <div><strong>{t("run.title")}</strong><p>{t(`run.${runStatus}`)}</p></div>
          </div><AdminStatus>{t(`run.${runStatus}`)}</AdminStatus>
        </div> : null}
        {attemptRecorded && !runStatus ? <div className="semantic-context-pack__notice" data-tone="warning" role="alert">
          <Warning aria-hidden size={18}/><div><strong>{t("attempt.title")}</strong><p>{t("attempt.body")}</p></div>
        </div> : null}
        {error && card ? <p className="workspace-form__error" role="alert">{error}</p> : null}
      </> : null}
    </AdminResourceSection>

    {drawerOpen && card ? <WorkspaceDrawer ariaLabel={t("drawer.title")}
      closeLabel={t("actions.close")} eyebrow={t("eyebrow")}
      onClose={() => { if (!submitting) { setDrawerOpen(false); setAcknowledged(false); } }}
      returnFocusRef={openerRef} title={t("drawer.title")}>
      <div className="admin-drawer-form">
        <p className="admin-drawer-form__intro">{t("drawer.body")}</p>
        <div className="semantic-context-pack__preflight">
          <FlightRow label={t("summary.proposals")} value={formatAdminNumber(card.proposalCount, locale)}/>
          <FlightRow label={t("summary.model")} value={card.model ?? "—"}/>
          <FlightRow label={t("summary.estimate")} value={microUsd(card.estimatedMaxCostMicroUsd, locale)}/>
          <FlightRow label={t("summary.hardCap")} value={microUsd(card.hardCapMicroUsd, locale)}/>
          <FlightRow label={t("drawer.calls")} value={String(card.oneCallMax)}/>
          <FlightRow label={t("drawer.output")} value={t("drawer.pendingCandidates")}/>
        </div>
        <p className="admin-drawer-form__hint">{t("drawer.boundary")}</p>
        <label className="semantic-context-pack__confirmation">
          <input checked={acknowledged} disabled={attemptRecorded || submitting}
            onChange={(event) => setAcknowledged(event.target.checked)} type="checkbox"/>
          <span>{t("drawer.acknowledgement", {
            estimate: microUsd(card.estimatedMaxCostMicroUsd, locale),
            hardCap: microUsd(card.hardCapMicroUsd, locale)
          })}</span>
        </label>
        {error ? <p className="workspace-form__error" role="alert">{error}</p> : null}
        <button className="admin-button admin-button--primary" disabled={commandDisabled}
          onClick={() => void submit()} type="button">
          {submitting ? <CircleNotch aria-hidden className="icon--spin" size={15}/> : <Play aria-hidden size={15}/>}
          {submitting ? t("actions.starting") : t("actions.start")}
        </button>
      </div>
    </WorkspaceDrawer> : null}
  </>;
}

function FlightRow({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

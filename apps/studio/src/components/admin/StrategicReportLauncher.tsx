"use client";

import { CheckCircle, FileText, Play, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { WorkspaceSelectField } from "@/components/admin/WorkspaceSelect";
import { WorkspaceDrawer } from "@/components/workspace/WorkspaceShell";
import type { AdminBrandWorkspaceRow, AdminWorkspaceReport } from "@/lib/data/admin-workspace";

export function StrategicReportLauncher({
  authorityReady = true,
  report,
  summary
}: {
  authorityReady?: boolean;
  report: AdminWorkspaceReport | null;
  summary: AdminBrandWorkspaceRow;
}) {
  const t = useTranslations("AdminWorkspace");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<StrategicRunState | null>(null);
  const [preflight, setPreflight] = useState<StrategicPreflight | null>(null);
  const [studySize, setStudySize] = useState("medium");
  const [budgetConfirmed, setBudgetConfirmed] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const idempotencyRef = useRef<string | null>(null);
  const ready = Boolean(
    authorityReady
    && summary.workspaceId
    && summary.coverageFrom
    && summary.coverageThrough
    && summary.timezone
  );

  useEffect(() => () => requestRef.current?.abort(), []);

  const refreshRun = useCallback(async (analysisId: string) => {
    if (!summary.workspaceId) return;
    const response = await fetch(
      `/api/data-os/signal/${summary.workspaceId}/reports/triggers-barriers/runs/${analysisId}`,
      { cache: "no-store" }
    );
    const payload = await response.json().catch(() => ({})) as StrategicRunStatus & {
      message?: string;
    };
    if (!response.ok) throw new Error(payload.message ?? t("reports.launch.errors.status"));
    setRun((current) => current && current.analysisId === analysisId
      ? { ...current, ...payload }
      : current);
    if (isStrategicRunTerminal(payload.status)) router.refresh();
  }, [router, summary.workspaceId, t]);

  useEffect(() => {
    if (!run?.analysisId || !isStrategicRunActive(run.status)) return;
    const analysisId = run.analysisId;
    const timer = window.setInterval(() => {
      void refreshRun(analysisId).catch((statusError) => {
        setError(statusError instanceof Error
          ? statusError.message
          : t("reports.launch.errors.status"));
      });
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [refreshRun, run?.analysisId, run?.status, t]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!summary.workspaceId || !summary.timezone || !ready) return;
    const form = new FormData(event.currentTarget);
    const budgetCap = Number(form.get("budget_cap_usd"));
    if (!Number.isFinite(budgetCap) || budgetCap <= 0) {
      setError(t("reports.launch.errors.budget"));
      return;
    }
    requestRef.current?.abort();
    requestRef.current = new AbortController();
    setBusy(true);
    setError(null);
    try {
      const input = strategicInput(form, summary.timezone, budgetCap);
      const preflightInput = strategicPreflightInput(input);
      if (
        !preflight
        || preflight.request_digest !== requestDigest(preflightInput)
        || !preflight.ready
        || !preflight.launch_authorized
      ) {
        const url = new URL(
          `/api/data-os/signal/${summary.workspaceId}/reports/triggers-barriers/runs`,
          window.location.origin
        );
        for (const [key, value] of Object.entries(preflightInput)) {
          if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
        }
        const response = await fetch(url, {
          cache: "no-store",
          method: "GET",
          signal: requestRef.current.signal
        });
        const payload = await response.json() as StrategicPreflight & { message?: string };
        if (!response.ok) throw new Error(payload.message ?? t("reports.launch.errors.preflight"));
        setPreflight({ ...payload, request_digest: requestDigest(preflightInput) });
        return;
      }
      if (!preflight.ready || !preflight.preflight_digest) {
        throw new Error(t("reports.launch.errors.blocked"));
      }
      if (!preflight.launch_authorized) {
        throw new Error(t("reports.launch.errors.notAuthorized"));
      }
      if (form.get("budget_confirmed") !== "yes") {
        throw new Error(t("reports.launch.errors.confirmBudget"));
      }
      idempotencyRef.current ??= globalThis.crypto.randomUUID();
      const response = await fetch(
        `/api/data-os/signal/${summary.workspaceId}/reports/triggers-barriers/runs`,
        {
          body: JSON.stringify({ ...input, preflight_digest: preflight.preflight_digest }),
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyRef.current
          },
          method: "POST",
          signal: requestRef.current.signal
        }
      );
      const payload = await response.json() as {
        analysis_id?: string;
        message?: string;
        status?: string;
        destinations?: StrategicRunStatus["destinations"];
      };
      if (!response.ok) throw new Error(payload.message ?? t("reports.launch.errors.create"));
      if (!payload.analysis_id) throw new Error(t("reports.launch.errors.create"));
      setRun({
        analysisId: payload.analysis_id,
        mentions: Number(preflight.population?.total_root_count ?? 0),
        status: payload.status ?? "queued",
        current_step: "queued",
        budget: null,
        steps: null,
        latest_step: null,
        review_ready: false,
        release_ready: false,
        destinations: payload.destinations ?? null
      });
      idempotencyRef.current = null;
      router.refresh();
    } catch (requestError) {
      if (!(requestError instanceof DOMException && requestError.name === "AbortError")) {
        setError(requestError instanceof Error ? requestError.message : t("reports.launch.errors.create"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="admin-button admin-button--primary" disabled={!ready} onClick={() => setOpen(true)} type="button">
        <Play aria-hidden size={15} weight="fill" />
        {report?.currentRevision ? t("reports.actions.update") : t("reports.actions.run")}
      </button>
      {open ? (
        <WorkspaceDrawer
          ariaLabel={report?.currentRevision ? t("reports.launch.updateTitle") : t("reports.launch.runTitle")}
          closeLabel={t("actions.close")}
          eyebrow={t("reports.eyebrow")}
          footer={run ? undefined : (
            <button
              className="admin-button admin-button--primary"
              disabled={busy || !ready || Boolean(preflight?.ready && preflight.launch_authorized && !budgetConfirmed)}
              form="strategic-report-run-form"
              type="submit"
            >
              <Play aria-hidden size={15} weight="fill" />{busy
                ? t("reports.launch.checking")
                : preflight?.ready && preflight.launch_authorized
                  ? t("reports.launch.start")
                  : t("reports.launch.check")}
            </button>
          )}
          onClose={() => {
            if (!busy) setOpen(false);
          }}
          title={report?.currentRevision ? t("reports.launch.updateTitle") : t("reports.launch.runTitle")}
        >
          {run ? (
            <StrategicRunProgress
              onCancel={async () => {
                if (!summary.workspaceId || !run.analysisId) return;
                setBusy(true);
                setError(null);
                try {
                  const response = await fetch(
                    `/api/data-os/signal/${summary.workspaceId}/reports/triggers-barriers/runs/${run.analysisId}`,
                    { cache: "no-store", method: "DELETE" }
                  );
                  const payload = await response.json().catch(() => ({})) as {
                    message?: string;
                    status?: string;
                  };
                  if (!response.ok) throw new Error(payload.message ?? t("reports.launch.errors.cancel"));
                  await refreshRun(run.analysisId);
                } catch (cancelError) {
                  setError(cancelError instanceof Error
                    ? cancelError.message
                    : t("reports.launch.errors.cancel"));
                } finally {
                  setBusy(false);
                }
              }}
              run={run}
            />
          ) : (
            <form
              className="admin-form"
              id="strategic-report-run-form"
              onChange={(event) => {
                const field = (event.target as HTMLInputElement).name;
                if (field !== "budget_confirmed") idempotencyRef.current = null;
                if (!new Set(["budget_confirmed", "business_question", "decision_to_inform"]).has(field)) {
                  setPreflight(null);
                  setBudgetConfirmed(false);
                }
              }}
              onSubmit={submit}
            >
              <p className="admin-table__muted">{t("reports.launch.subtitle")}</p>
              <div className="workspace-form__grid">
                <label className="workspace-field"><span>{t("reports.launch.periodStart")}</span><input className="workspace-control" defaultValue={summary.coverageFrom ?? ""} max={summary.coverageThrough ?? undefined} name="period_start" required type="date" /></label>
                <label className="workspace-field"><span>{t("reports.launch.periodEnd")}</span><input className="workspace-control" defaultValue={summary.coverageThrough ?? ""} min={summary.coverageFrom ?? undefined} name="period_end" required type="date" /></label>
                <label className="workspace-field"><span>{t("reports.launch.timezone")}</span><input className="workspace-control" disabled value={summary.timezone ?? "—"} /><small>{t("reports.launch.timezoneHelp")}</small></label>
                <WorkspaceSelectField
                  ariaLabel={t("reports.launch.size")}
                  label={t("reports.launch.size")}
                  name="study_size"
                  onChange={(value) => {
                    setStudySize(value);
                    setPreflight(null);
                  }}
                  options={[
                    { label: t("reports.launch.sizes.small"), value: "small" },
                    { label: t("reports.launch.sizes.medium"), value: "medium" },
                    { label: t("reports.launch.sizes.large"), value: "large" },
                    { label: t("reports.launch.sizes.full"), value: "full_power" }
                  ]}
                  value={studySize}
                />
              </div>
              <label className="workspace-field"><span>{t("reports.launch.businessQuestion")}</span><textarea className="workspace-control workspace-control--textarea" maxLength={2000} name="business_question" rows={3} /></label>
              <label className="workspace-field"><span>{t("reports.launch.decision")}</span><textarea className="workspace-control workspace-control--textarea" maxLength={2000} name="decision_to_inform" rows={3} /></label>
              <label className="workspace-field"><span>{t("reports.launch.budget")}</span><input className="workspace-control" inputMode="decimal" min="0.01" name="budget_cap_usd" required step="0.01" type="number" /><small>{t("reports.launch.budgetHelp")}</small></label>
              {preflight ? <StrategicPreflightCard preflight={preflight} /> : null}
              {preflight?.ready && preflight.launch_authorized ? (
                <label className="admin-report-launcher__confirmation"><input checked={budgetConfirmed} name="budget_confirmed" onChange={(event) => setBudgetConfirmed(event.currentTarget.checked)} type="checkbox" value="yes" /><span>{t("reports.launch.confirm")}</span></label>
              ) : null}
              {error ? <p className="workspace-form__error" role="alert">{error}</p> : null}
            </form>
          )}
        </WorkspaceDrawer>
      ) : null}
    </>
  );
}

function optionalString(value: FormDataEntryValue | null) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

type StrategicInput = {
  period_start: string;
  period_end: string;
  timezone: string;
  study_size: string;
  business_question: string | null;
  decision_to_inform: string | null;
  hard_cap_usd: number;
};

type StrategicPreflight = {
  ready: boolean;
  launch_authorized: boolean;
  blocking_reasons: string[];
  module_key: string;
  view_key: string;
  population: {
    version: number;
    total_root_count: number;
    membership_digest: string;
    definition_hash: string;
  } | null;
  sample: { count: number; digest: string } | null;
  provider: { provider: string; model: string; prompt_version: string } | null;
  budget: { currency: "USD"; estimated_cost_usd: number; hard_cap_usd: number } | null;
  coverage?: { state?: string; denominator_count?: number | null } | null;
  readiness?: {
    worker_alive?: boolean;
    queue_configured?: boolean;
    provider_key_configured?: boolean;
    recovery_ready?: boolean;
  } | null;
  destinations?: { cancel?: string; review?: string; release?: string } | null;
  preflight_digest: string | null;
  request_digest?: string;
};

type StrategicRunStatus = {
  status: string;
  current_step: string;
  budget: {
    currency: "USD";
    reserved_cost_usd: number;
    actual_cost_usd: number;
    hard_cap_usd: number;
  } | null;
  steps: { completed: number; pending: number; failed: number } | null;
  latest_step: { pipeline_step: string; status: string; error_code: string | null } | null;
  review_ready: boolean;
  release_ready: boolean;
  destinations: {
    status?: string;
    cancel?: string;
    review?: string;
    release?: string;
    report?: string;
  } | null;
};

type StrategicRunState = StrategicRunStatus & {
  analysisId: string;
  mentions: number;
};

function strategicInput(form: FormData, timezone: string, hardCapUsd: number): StrategicInput {
  return {
    period_start: String(form.get("period_start")),
    period_end: String(form.get("period_end")),
    timezone,
    study_size: String(form.get("study_size") ?? "medium"),
    business_question: optionalString(form.get("business_question")),
    decision_to_inform: optionalString(form.get("decision_to_inform")),
    hard_cap_usd: hardCapUsd
  };
}

function requestDigest(input: object) {
  return JSON.stringify(input);
}

function strategicPreflightInput(input: StrategicInput) {
  return {
    period_start: input.period_start,
    period_end: input.period_end,
    timezone: input.timezone,
    study_size: input.study_size,
    hard_cap_usd: input.hard_cap_usd
  };
}

function StrategicPreflightCard({ preflight }: { preflight: StrategicPreflight }) {
  const t = useTranslations("AdminWorkspace");
  const ready = preflight.ready;
  const readiness = preflight.readiness;
  return (
    <section className={`admin-report-preflight admin-report-preflight--${ready ? "ready" : "blocked"}`}>
      <header>
        {ready ? <CheckCircle aria-hidden size={20} weight="fill" /> : <WarningCircle aria-hidden size={20} weight="fill" />}
        <div><strong>{t(ready ? "reports.launch.preflight.ready" : "reports.launch.preflight.blocked")}</strong><small>{preflight.module_key} / {preflight.view_key}</small></div>
      </header>
      <dl>
        <div><dt>{t("reports.launch.preflight.denominator")}</dt><dd>{preflight.population?.total_root_count ?? "—"}</dd></div>
        <div><dt>{t("reports.launch.preflight.sample")}</dt><dd>{preflight.sample?.count ?? "—"}</dd></div>
        <div><dt>{t("reports.launch.preflight.model")}</dt><dd>{preflight.provider?.model ?? "—"}</dd></div>
        <div><dt>{t("reports.launch.preflight.estimate")}</dt><dd>{preflight.budget ? `${preflight.budget.currency} ${preflight.budget.estimated_cost_usd.toFixed(2)}` : "—"}</dd></div>
        <div><dt>{t("reports.launch.preflight.worker")}</dt><dd>{readiness?.worker_alive ? t("reports.launch.preflight.ready") : t("reports.launch.preflight.blocked")}</dd></div>
        <div><dt>{t("reports.launch.preflight.coverage")}</dt><dd>{preflight.coverage?.state ?? "—"}</dd></div>
      </dl>
      {!preflight.launch_authorized ? <p><ShieldCheck aria-hidden size={16} />{t("reports.launch.preflight.authorizationPending")}</p> : null}
      {preflight.blocking_reasons.length ? <ul>{preflight.blocking_reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
    </section>
  );
}

function StrategicRunProgress({
  onCancel,
  run
}: {
  onCancel: () => Promise<void>;
  run: StrategicRunState;
}) {
  const t = useTranslations("AdminWorkspace");
  const terminal = isStrategicRunTerminal(run.status);
  return (
    <section className="admin-report-run-progress" aria-live="polite">
      <FileText aria-hidden size={24} />
      <div>
        <strong>{t("reports.launch.queuedTitle")}</strong>
        <p>{t("reports.launch.queuedBody", {
          count: run.mentions,
          status: t.has(`reports.states.${run.status}`)
            ? t(`reports.states.${run.status}`)
            : run.status
        })}</p>
      </div>
      <dl>
        <div><dt>{t("reports.launch.progress.step")}</dt><dd>{run.current_step}</dd></div>
        <div><dt>{t("reports.launch.progress.completed")}</dt><dd>{run.steps?.completed ?? 0}</dd></div>
        <div><dt>{t("reports.launch.progress.pending")}</dt><dd>{run.steps?.pending ?? 0}</dd></div>
        <div><dt>{t("reports.launch.progress.spent")}</dt><dd>{run.budget ? `${run.budget.currency} ${run.budget.actual_cost_usd.toFixed(2)}` : "—"}</dd></div>
      </dl>
      {run.latest_step?.error_code ? (
        <p className="workspace-form__error" role="alert">{run.latest_step.error_code}</p>
      ) : null}
      {isStrategicRunActive(run.status) ? (
        <button className="admin-button admin-button--danger" onClick={() => void onCancel()} type="button">
          {t("reports.launch.progress.cancel")}
        </button>
      ) : null}
      {run.review_ready ? <p>{t("reports.launch.progress.reviewReady")}</p> : null}
      {run.release_ready ? <p>{t("reports.launch.progress.releaseReady")}</p> : null}
      {terminal ? <p>{t("reports.launch.progress.refreshHint")}</p> : null}
    </section>
  );
}

function isStrategicRunActive(status: string) {
  return ["queued", "pending", "running", "cancel_requested"].includes(status);
}

function isStrategicRunTerminal(status: string) {
  return [
    "needs_review",
    "completed",
    "cancelled",
    "failed",
    "dead_letter",
    "published"
  ].includes(status);
}

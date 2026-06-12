"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/ui/Icon";
import {
  buildEngineOutputManifestForMethodology,
  buildEngineMethodologyOptions,
  getDefaultEngineMethodologySlug,
  type EngineMethodologyOption
} from "@/lib/engine/methodology-options";

type EngineAnalysis = {
  id: string;
  methodologySlug: string;
  methodologyVersion: string;
  status: string;
  currentStep: string;
  limitations: unknown;
  metaJson: unknown;
  createdAt: string;
  updatedAt: string;
  failedAt: string | null;
  failureReason: string | null;
};

type EngineStep = {
  id: string;
  step: string;
  status: string;
  durationMs: number | null;
  errorMessage: string | null;
  resultSummary: unknown;
};

type EngineState = {
  ok: boolean;
  runtimeEnabled?: boolean;
  unavailable?: boolean;
  reason?: string;
  message?: string;
  latest: EngineAnalysis | null;
  analyses: EngineAnalysis[];
  steps: EngineStep[];
  costSummary: {
    events: number;
    totalTokens: number;
    estimatedCostUsd: number;
    providers: string[];
    operations: string[];
  } | null;
  methodologyOptions?: EngineMethodologyOption[];
};

type SelectedLensStatus = {
  methodology_slug: string;
  status: "ready" | "queued" | "running" | "needs_review" | "approved" | "failed" | "blocked" | "missing" | "not_started";
  engine_analysis_id: string | null;
  current_step: string | null;
  message: string | null;
  query_pack_validation?: {
    status?: "ready" | "directional" | "blocked";
    hardFailures?: string[];
    warnings?: string[];
    summary?: Record<string, unknown>;
  } | null;
};

type SelectedLensState = {
  ok: boolean;
  runtimeEnabled?: boolean;
  fixtureCodingEnabled?: boolean;
  llmEnabled?: boolean;
  unavailable?: boolean;
  message?: string;
  selected_lenses: string[];
  statuses: SelectedLensStatus[];
};

const SIGNAL_PULSE_OPTION: EngineMethodologyOption = {
  slug: "signal-pulse",
  label: "Signal Pulse",
  shortLabel: "Signal Pulse",
  priority: "SP",
  runtimeKind: "engine",
  seeded: true,
  status: "beta",
  version: "0.1",
  runnable: true
};

export function EngineMethodologyBetaPanel({
  corpusId,
  corpusName,
  primaryMethodologySlug
}: {
  corpusId: string;
  corpusName: string;
  primaryMethodologySlug?: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<EngineState | null>(null);
  const [selectedLensState, setSelectedLensState] = useState<SelectedLensState | null>(null);
  const fallbackOptions = useMemo(() => buildEngineMethodologyOptions(), []);
  const isSignalPulseCorpus = primaryMethodologySlug === "signal-pulse";
  const methodologyOptions = useMemo(() => {
    const base = state?.methodologyOptions?.length ? state.methodologyOptions : fallbackOptions;
    if (!isSignalPulseCorpus) return base;
    return [SIGNAL_PULSE_OPTION, ...base.filter((option) => option.slug !== "signal-pulse")];
  }, [fallbackOptions, isSignalPulseCorpus, state?.methodologyOptions]);
  const [methodologySlug, setMethodologySlug] = useState(isSignalPulseCorpus ? "signal-pulse" : getDefaultEngineMethodologySlug(fallbackOptions));
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isStartingSelected, setIsStartingSelected] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = state?.latest ?? null;
  const schemaUnavailable = state?.unavailable === true;
  const runtimeDisabled = state?.runtimeEnabled === false || selectedLensState?.runtimeEnabled === false;
  const selectedMethodology = methodologyOptions.find((option) => option.slug === methodologySlug);
  const methodologyNotRunnable = selectedMethodology ? !selectedMethodology.runnable : false;
  const selectedLensStatuses = selectedLensState?.statuses ?? [];
  const pendingSelectedLenses = selectedLensStatuses.filter((lens) => lens.status === "ready" || lens.status === "not_started" || lens.status === "failed");
  const runningSelectedLenses = selectedLensStatuses.filter((lens) => lens.status === "queued" || lens.status === "running");
  const blockedSelectedLenses = selectedLensStatuses.filter((lens) => lens.status === "blocked");
  const canStartSelected = !isLoading && !isStartingSelected && !schemaUnavailable && !runtimeDisabled && pendingSelectedLenses.length > 0;
  const canRerunSelected = !isLoading && !isStartingSelected && !schemaUnavailable && !runtimeDisabled && selectedLensStatuses.length > 0;
  const reviewable = latest?.status === "needs_review" || latest?.status === "approved";
  const defaultTitle = useMemo(() => {
    const label = methodologyOptions.find((option) => option.slug === latest?.methodologySlug)?.label ?? latest?.methodologySlug ?? "Engine Lens";
    return `${corpusName} · ${label.replace(/^#\\d+\\s*/, "")}`;
  }, [corpusName, latest?.methodologySlug, methodologyOptions]);
  const [title, setTitle] = useState(defaultTitle);
  const [headline, setHeadline] = useState("");
  const [summary, setSummary] = useState("");

  useEffect(() => {
    void loadState();
    const interval = window.setInterval(() => {
      if (latest && !["needs_review", "approved", "failed"].includes(latest.status)) {
        void loadState(false);
      }
    }, 3000);
    return () => window.clearInterval(interval);
    // latest status intentionally drives polling cadence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corpusId, latest?.status]);

  useEffect(() => {
    setTitle(defaultTitle);
  }, [defaultTitle]);

  useEffect(() => {
    if (!selectedMethodology || selectedMethodology.runnable) return;
    setMethodologySlug(getDefaultEngineMethodologySlug(methodologyOptions));
  }, [methodologyOptions, selectedMethodology]);

  useEffect(() => {
    if (isSignalPulseCorpus) setMethodologySlug("signal-pulse");
  }, [isSignalPulseCorpus]);

  async function loadState(showSpinner = true) {
    if (showSpinner) setIsLoading(true);
    try {
      const [response, selectedResponse] = await Promise.all([
        fetch(`/api/corpora/${corpusId}/engine-analysis`),
        fetch(`/api/corpora/${corpusId}/engine-analysis/selected`)
      ]);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "No se pudo cargar engine beta.");
      if (payload.unavailable) setError(payload.message ?? "Engine beta schema pendiente.");
      setState(payload as EngineState);
      const selectedPayload = await selectedResponse.json();
      if (!selectedResponse.ok) throw new Error(selectedPayload.message ?? "No se pudo cargar lentes seleccionados.");
      setSelectedLensState(selectedPayload as SelectedLensState);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar engine beta.");
    } finally {
      if (showSpinner) setIsLoading(false);
    }
  }

  async function startAnalysis() {
    setIsStarting(true);
    setError(null);
    try {
      const response = await fetch(`/api/corpora/${corpusId}/engine-analysis`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          methodology_slug: methodologySlug,
          params: { launch_surface: "studio_beta_panel" }
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "No se pudo iniciar engine beta.");
      await loadState(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar engine beta.");
    } finally {
      setIsStarting(false);
    }
  }

  async function startSelectedLenses(force = false) {
    setIsStartingSelected(true);
    setError(null);
    try {
      const response = await fetch(`/api/corpora/${corpusId}/engine-analysis/selected`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          force,
          params: {
            launch_surface: force ? "studio_selected_lenses_panel_force_rerun" : "studio_selected_lenses_panel"
          }
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "No se pudieron iniciar los lentes seleccionados.");
      await loadState(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron iniciar los lentes seleccionados.");
    } finally {
      setIsStartingSelected(false);
    }
  }

  async function saveOutput(action: "save_draft" | "publish") {
    if (!latest) return;
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/corpora/${corpusId}/engine-analysis/${latest.id}/signal-output`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          headline: headline || null,
          summary: summary || null,
          manifest: buildEngineOutputManifestForMethodology(latest.methodologySlug),
          action
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "No se pudo guardar el output engine.");
      await loadState(false);
      if (latest.methodologySlug === "signal-pulse" && payload.output?.id) {
        router.push(`/pulse/${payload.output.id}`);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el output engine.");
    } finally {
      setIsSaving(false);
    }
  }

  const progressLabel = schemaUnavailable
    ? "schema pendiente"
    : runtimeDisabled
      ? "runtime off"
      : latest
        ? `${latest.status} · ${latest.currentStep}`
        : "sin corrida";

  return (
    <section className="engine-beta-panel">
      <header>
        <div>
          <p className="eyebrow">Engine beta</p>
          <h2>{isSignalPulseCorpus ? "Signal Pulse runtime" : "Panel técnico de metodologías"}</h2>
          <p>
            {isSignalPulseCorpus
              ? "Corre el pipeline cluster-first, confirma costo contra budget cap y publica el reporte táctico mensual."
              : "T&B corre primero en el flujo normal. Al terminar, los lentes seleccionados en el wizard se lanzan sobre el corpus aprobado; este panel queda para monitorear, revisar y reintentar sin repetir SentiOne."}
          </p>
        </div>
        <span>{isLoading ? "cargando" : progressLabel}</span>
      </header>

      {!isSignalPulseCorpus && (
      <div className="engine-selected-lenses">
        <div className="engine-selected-lenses__head">
          <div>
            <span>Plan multimétodo del wizard</span>
            <strong>{selectedLensStatuses.length} lentes engine seleccionados</strong>
            <p>
              {selectedLensStatuses.length === 0
                ? "Este estudio sólo tiene T&B en su plan."
                : "Estos lentes se alimentan con sus query packs y se auto-lanzan después de T&B; también puedes reintentar pendientes desde aquí."}
            </p>
          </div>
          <button className="wizard-cta" disabled={!canStartSelected} onClick={() => startSelectedLenses(false)} type="button">
            {isStartingSelected ? <Icon name="spinner" size={16} /> : <Icon name="play" size={16} />}
            {runtimeDisabled ? "Runtime off" : pendingSelectedLenses.length ? `Correr ${pendingSelectedLenses.length} pendientes` : "Lentes ya lanzados"}
          </button>
          <button
            className="wizard-cta wizard-cta--ghost"
            disabled={!canRerunSelected}
            onClick={() => startSelectedLenses(true)}
            type="button"
          >
            {isStartingSelected ? <Icon name="spinner" size={16} /> : <Icon name="refresh" size={16} />}
            Re-correr seleccionados
          </button>
        </div>
        <div className="engine-selected-lenses__meta">
          <small>{selectedLensState?.fixtureCodingEnabled ? "fixture/no-cost" : selectedLensState?.llmEnabled ? "LLM enabled" : "LLM off"}</small>
          <small>{runningSelectedLenses.length} corriendo</small>
          <small>{selectedLensStatuses.filter((lens) => lens.status === "needs_review" || lens.status === "approved").length} listos</small>
          <small>{blockedSelectedLenses.length} bloqueados</small>
        </div>
        {selectedLensStatuses.length ? (
          <div className="engine-selected-lenses__grid">
            {selectedLensStatuses.map((lens) => (
              <article className={`engine-selected-lens engine-selected-lens--${lens.status}`} key={lens.methodology_slug}>
                <span>{labelForMethodology(lens.methodology_slug, methodologyOptions)}</span>
                <strong>{statusLabel(lens.status)}</strong>
                <small>{lens.current_step ?? lens.message ?? coverageSummary(lens) ?? "pendiente"}</small>
              </article>
            ))}
          </div>
        ) : null}
      </div>
      )}

      <div className="engine-beta-controls">
        <label>
          <span>Methodology</span>
          <select value={methodologySlug} onChange={(event) => setMethodologySlug(event.target.value)}>
            {methodologyOptions.map((option) => (
              <option disabled={!option.runnable} key={option.slug} value={option.slug}>
                {option.label} · {option.runtimeKind === "output_only" ? "output only" : option.status}
              </option>
            ))}
          </select>
        </label>
        <button className="wizard-cta" disabled={isLoading || isStarting || schemaUnavailable || runtimeDisabled || methodologyNotRunnable} onClick={startAnalysis} type="button">
          {isStarting ? <Icon name="spinner" size={16} /> : <Icon name="play" size={16} />}
          {runtimeDisabled ? "Runtime off" : methodologyNotRunnable ? "Not runnable" : isSignalPulseCorpus ? "Correr Signal Pulse" : "Run beta lens"}
        </button>
      </div>

      <div className="engine-beta-methodology-grid">
        {methodologyOptions.map((option) => (
          <button
            aria-pressed={option.slug === methodologySlug}
            className="engine-beta-methodology-chip"
            disabled={!option.runnable}
            key={option.slug}
            onClick={() => setMethodologySlug(option.slug)}
            type="button"
          >
            <span>{option.priority}</span>
            <strong>{option.shortLabel}</strong>
            <small>{option.runtimeKind === "output_only" ? "output only" : option.status}</small>
          </button>
        ))}
      </div>

      {latest ? (
        <div className="engine-beta-status">
          <article>
            <span>Latest</span>
            <strong>{methodologyOptions.find((option) => option.slug === latest.methodologySlug)?.label ?? latest.methodologySlug}</strong>
            <p>{latest.status} · {latest.currentStep}</p>
          </article>
          <article>
            <span>Cost ledger</span>
            <strong>${(state?.costSummary?.estimatedCostUsd ?? 0).toFixed(4)}</strong>
            <p>
              {state?.costSummary?.events ?? 0} events · {state?.costSummary?.totalTokens ?? 0} tokens
              {state?.costSummary?.providers?.length ? ` · ${state.costSummary.providers.join(", ")}` : ""}
            </p>
          </article>
          <ol>
            {state?.steps.map((step) => (
              <li key={step.id}>
                <span>{step.step}</span>
                <strong>{step.status}</strong>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {reviewable && latest ? (
        <div className="engine-beta-publish">
          <label>
            <span>Internal title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            <span>Headline</span>
            <input value={headline} onChange={(event) => setHeadline(event.target.value)} placeholder="Headline client-safe" />
          </label>
          <label>
            <span>Summary</span>
            <textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Qué contiene este output beta..." />
          </label>
          <div>
            <button className="wizard-cta wizard-cta--ghost" disabled={isSaving} onClick={() => saveOutput("save_draft")} type="button">
              Guardar draft
            </button>
            <button className="wizard-cta" disabled={isSaving} onClick={() => saveOutput("publish")} type="button">
              {isSaving ? <Icon name="spinner" size={16} /> : <Icon name="play" size={16} />}
              {latest.methodologySlug === "signal-pulse" ? "Publicar Pulse" : "Publicar beta Signal"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="error-copy">{error}</p> : null}
    </section>
  );
}

function labelForMethodology(slug: string, options: EngineMethodologyOption[]) {
  return options.find((option) => option.slug === slug)?.shortLabel ?? slug
    .split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function statusLabel(status: SelectedLensStatus["status"]) {
  if (status === "ready") return "listo para correr";
  if (status === "not_started") return "pendiente";
  if (status === "queued") return "en cola";
  if (status === "running") return "corriendo";
  if (status === "needs_review") return "listo";
  if (status === "approved") return "aprobado";
  if (status === "failed") return "falló";
  if (status === "blocked") return "bloqueado";
  if (status === "missing") return "sin seed";
  return "listo";
}

function coverageSummary(lens: SelectedLensStatus) {
  const validation = lens.query_pack_validation;
  if (!validation) return null;
  if (validation.hardFailures?.[0]) return validation.hardFailures[0];
  if (validation.warnings?.[0]) return validation.warnings[0];
  if (validation.status === "ready") return "coverage listo";
  if (validation.status === "directional") return "coverage direccional";
  return null;
}

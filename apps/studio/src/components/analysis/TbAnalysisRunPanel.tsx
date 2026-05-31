"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/ui/Icon";
import { StatusPill, SuccessPill } from "@/components/ui/StatusPill";

type StepStatus = "queued" | "running" | "completed" | "failed" | "skipped" | string;

type AnalysisStep = {
  id: string;
  step: string;
  status: StepStatus;
  durationMs: number | null;
  errorMessage: string | null;
};

type AnalysisState = {
  analysis: {
    id: string;
    status: string;
    currentStep: string;
    createdAt: string | Date;
    updatedAt: string | Date;
    failureReason: string | null;
  };
  steps: AnalysisStep[];
  recommendations: unknown[];
  findingSummary: {
    total: number;
    triggers: number;
    barriers: number;
    structural: number;
    movable: number;
  };
} | null;

type StartPayload = {
  ok?: boolean;
  tb_analysis_id?: string;
  bullmq_job_id?: string | number;
  status?: string;
  message?: string;
};

const PIPELINE_STEPS = [
  { id: "preflight", label: "Preparando corpus" },
  { id: "step1_open_pass", label: "Leyendo señales" },
  { id: "step2_coding", label: "Clasificando menciones" },
  { id: "step3_hierarchy", label: "Agrupando hallazgos" },
  { id: "step4_mobility", label: "Priorizando acción" },
  { id: "step5_comparative", label: "Saltando comparativo" },
  { id: "step6_synthesis", label: "Escribiendo síntesis" },
  { id: "quality_gates", label: "Preparando review" },
  { id: "review", label: "Listo para revisar" }
] as const;

// TODO mejora-futura: mover estas etapas al manifest de metodología para que
// cada metodología pueda definir su propio flujo visual sin tocar React.
const PROCESS_STAGES = [
  {
    id: "corpus",
    label: "Corpus listo",
    helper: "Menciones limpias, snapshot y base aprobada.",
    icon: "check",
    steps: [] as string[]
  },
  {
    id: "analysis",
    label: "Análisis cultural",
    helper: "Lee menciones, agrupa hallazgos y mide qué puede mover la marca.",
    icon: "layers",
    steps: ["preflight", "step1_open_pass", "step2_coding", "step3_hierarchy", "step4_mobility", "step5_comparative"]
  },
  {
    id: "synthesis",
    label: "Síntesis accionable",
    helper: "Convierte hallazgos en acciones, responsables y criterios de éxito.",
    icon: "sparkle",
    steps: ["step6_synthesis", "quality_gates"]
  },
  {
    id: "review",
    label: "Review",
    helper: "El analista valida, ajusta y aprueba antes de publicar.",
    icon: "message",
    steps: ["review"]
  }
] as const;

const TERMINAL_STATUSES = new Set(["needs_review", "approved_by_im", "approved_by_kam", "failed", "aborted_preflight"]);

export function TbAnalysisRunPanel({
  corpusId,
  corpusApproved,
  includedCount,
  latestState
}: {
  corpusId: string;
  corpusApproved: boolean;
  includedCount: number;
  latestState: AnalysisState;
}) {
  const router = useRouter();
  const [state, setState] = useState<AnalysisState>(latestState);
  const [jobId, setJobId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analysis = state?.analysis ?? null;
  const isRunning = analysis ? !TERMINAL_STATUSES.has(analysis.status) : false;
  const canStart = corpusApproved && includedCount > 0 && !isRunning && !isStarting;
  const progress = useMemo(() => computeProgress(state), [state]);

  const refreshState = useCallback(async (analysisId: string, forceRouterRefresh: boolean) => {
    setIsRefreshing(true);
    const response = await fetch(`/api/corpora/${corpusId}/tb-analysis?analysisId=${analysisId}`);
    const payload = await response.json() as { state?: AnalysisState };
    if (response.ok) {
      setState(payload.state ?? null);
      if (forceRouterRefresh) router.refresh();
    }
    setIsRefreshing(false);
  }, [corpusId, router]);

  useEffect(() => {
    if (!analysis?.id || !isRunning) return;

    const timer = window.setInterval(async () => {
      await refreshState(analysis.id, false);
    }, 3500);

    return () => window.clearInterval(timer);
  }, [analysis?.id, isRunning, refreshState]);

  useEffect(() => {
    if (!jobId) return;

    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/jobs/${jobId}?queue=tb-analysis`);
      if (!response.ok) return;
      const job = await response.json() as { status?: string };
      if (job.status === "completed" || job.status === "failed") {
        window.clearInterval(timer);
        setJobId(null);
        if (analysis?.id) await refreshState(analysis.id, true);
      }
    }, 2500);

    return () => window.clearInterval(timer);
  }, [analysis?.id, jobId, refreshState]);

  async function startAnalysis() {
    setIsStarting(true);
    setError(null);

    const response = await fetch(`/api/corpora/${corpusId}/tb-analysis`, { method: "POST" });
    const payload = await response.json() as StartPayload;

    if (!response.ok || !payload.tb_analysis_id) {
      setError(payload.message ?? "No se pudo iniciar el análisis T&B.");
      setIsStarting(false);
      return;
    }

    setJobId(payload.bullmq_job_id ? String(payload.bullmq_job_id) : null);
    await refreshState(payload.tb_analysis_id, true);
    setIsStarting(false);
  }

  return (
    <section className="analysis-run-card">
      <div className="analysis-run-head">
        <div>
          <p className="vitals-eyebrow">Siguiente paso</p>
          <h2>Del corpus limpio a una lectura accionable</h2>
          <p>
            Cuando el corpus ya está aprobado, Noisia congela una copia, analiza la señal
            y prepara una síntesis para que el analista la revise con calma.
          </p>
        </div>
        <div className="analysis-run-actions">
          {analysis?.status === "needs_review" || analysis?.status === "approved_by_im" || analysis?.status === "approved_by_kam" ? (
            <Link prefetch={false} className="wizard-cta" href={`/studio/corpora/${corpusId}/analysis/${analysis.id}`}>
              <Icon name="arrow-right" size={16} />
              Revisar síntesis
            </Link>
          ) : null}
          <button className="wizard-cta wizard-cta--secondary" disabled={!canStart} onClick={startAnalysis} type="button">
            {isStarting ? <Icon name="spinner" size={16} /> : <Icon name="play" size={16} />}
            {analysis ? "Correr otra lectura" : "Analizar corpus"}
          </button>
        </div>
      </div>

      {!corpusApproved ? (
        <div className="analysis-run-banner analysis-run-banner--warn">
          <Icon name="alert" size={16} />
          Primero aprueba el corpus. La síntesis debe correr sobre una base estable, no sobre menciones en limpieza.
        </div>
      ) : null}

      {error ? (
        <div className="analysis-run-banner analysis-run-banner--error">
          <Icon name="alert" size={16} />
          {error}
        </div>
      ) : null}

      <div className="analysis-progress-shell">
        <div className="analysis-progress-meta">
          <span>{analysis ? statusLabel(analysis.status, analysis.currentStep) : "Sin análisis todavía"}</span>
          <strong>{progress}%</strong>
        </div>
        <div className="analysis-progress-track" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="analysis-process-grid">
        {PROCESS_STAGES.map((item, index) => {
          const phaseStatus = stageStatus(item.id, item.steps, state, corpusApproved);
          const isCurrent = phaseStatus === "running" || phaseStatus === "current";
          return (
            <article className={`analysis-process-card ${statusClass(phaseStatus)}${isCurrent ? " is-current" : ""}`} key={item.id}>
              <div className="analysis-process-index">{index + 1}</div>
              <div className="analysis-process-icon">
                {phaseStatus === "completed" ? (
                  <Icon name="check" size={16} />
                ) : phaseStatus === "running" || phaseStatus === "current" ? (
                  <Icon name="spinner" size={16} />
                ) : phaseStatus === "failed" ? (
                  <Icon name="alert" size={16} />
                ) : (
                  <Icon name={item.icon} size={16} />
                )}
              </div>
              <div>
                <h3>{item.label}</h3>
                <p>{item.helper}</p>
              </div>
            </article>
          );
        })}
      </div>

      <div className="analysis-now-card">
        <div className="analysis-now-icon">
          <Icon name={isRunning ? "spinner" : analysis?.status === "failed" ? "alert" : "info"} size={16} />
        </div>
        <div>
          <span>{analysis ? "Estado actual" : "Cuando estés listo"}</span>
          <strong>{analysis ? currentActivityLabel(analysis.status, analysis.currentStep) : "Aprueba el corpus y corre la primera lectura."}</strong>
        </div>
      </div>

      <footer className="analysis-run-foot">
        <div>
        {analysis ? (
          <>
              {isRunning ? <StatusPill tone="running"><Icon name="spinner" size={12} /> Corriendo</StatusPill> : null}
              {analysis.status === "needs_review" ? <SuccessPill>Listo para review</SuccessPill> : null}
              {analysis.status === "failed" ? <StatusPill tone="error"><Icon name="alert" size={12} /> Falló</StatusPill> : null}
              {isRefreshing ? <span className="analysis-refresh-note">Actualizando estado...</span> : null}
          </>
        ) : (
          <span className="analysis-refresh-note">El primer análisis puede tardar varios minutos. El UI se queda monitoreando.</span>
        )}
        </div>
        {state?.findingSummary.total ? (
          <div className="analysis-mini-stats">
            <span>{state.findingSummary.total} hallazgos</span>
            <span>{state.findingSummary.barriers} barreras</span>
            <span>{state.findingSummary.triggers} señales positivas</span>
          </div>
        ) : null}
      </footer>
    </section>
  );
}

function computeProgress(state: AnalysisState) {
  if (!state) return 0;
  if (state.analysis.status === "needs_review" || state.analysis.status.startsWith("approved")) return 100;
  if (state.analysis.status === "failed" || state.analysis.status === "aborted_preflight") return 100;

  const completed = new Set(state.steps.filter((s) => s.status === "completed" || s.status === "skipped").map((s) => s.step));
  let count = 1; // corpus approved
  for (const step of PIPELINE_STEPS.slice(0, -1)) {
    if (completed.has(step.id)) count += 1;
  }
  return Math.max(8, Math.min(96, Math.round((count / PIPELINE_STEPS.length) * 100)));
}

function nextStepId(state: AnalysisState) {
  if (!state) return "preflight";
  const completed = new Set(state.steps.filter((s) => s.status === "completed" || s.status === "skipped").map((s) => s.step));
  return PIPELINE_STEPS.find((step) => !completed.has(step.id))?.id ?? "review";
}

function statusClass(status?: StepStatus) {
  if (status === "completed" || status === "skipped") return " is-done";
  if (status === "running" || status === "current") return " is-running";
  if (status === "failed") return " is-failed";
  return "";
}

function statusLabel(status: string, currentStep: string) {
  if (status === "needs_review") return "Síntesis lista para revisión";
  if (status === "approved_by_im") return "Aprobado por Noisia";
  if (status === "approved_by_kam") return "Aprobado para cliente";
  if (status === "failed") return "Análisis fallido";
  return labelForStep(currentStep);
}

function labelForStep(step: string) {
  return PIPELINE_STEPS.find((item) => item.id === step)?.label ?? step;
}

function currentActivityLabel(status: string, currentStep: string) {
  if (status === "needs_review") return "La síntesis está lista para que la revises.";
  if (status === "approved_by_im") return "Síntesis aprobada por Noisia.";
  if (status === "approved_by_kam") return "Síntesis aprobada para cliente.";
  if (status === "failed") return "La lectura se detuvo; revisa el error antes de reintentar.";
  return `${labelForStep(currentStep)}. Puedes dejar esta pantalla abierta; se actualizará sola.`;
}

function stageStatus(
  stageId: string,
  stepIds: readonly string[],
  state: AnalysisState,
  corpusApproved: boolean
): StepStatus | "current" | undefined {
  if (stageId === "corpus") return corpusApproved ? "completed" : "current";
  if (!state) return undefined;
  if (state.analysis.status === "failed") {
    const failedStep = state.steps.find((step) => step.status === "failed");
    return failedStep && stepIds.includes(failedStep.step) ? "failed" : undefined;
  }
  if (stageId === "review" && (state.analysis.status === "needs_review" || state.analysis.status.startsWith("approved"))) {
    return "completed";
  }
  if (stepIds.includes(state.analysis.currentStep)) return "running";

  const completed = new Set(state.steps.filter((step) => step.status === "completed" || step.status === "skipped").map((step) => step.step));
  if (stepIds.length > 0 && stepIds.every((id) => completed.has(id))) return "completed";

  const next = nextStepId(state);
  if (stepIds.includes(next)) return "current";
  return undefined;
}

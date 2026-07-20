"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  CorpusMaintenancePanel,
  type CleanupAction,
  type Snapshot,
} from "@/components/engine/CorpusMaintenancePanel";
import { CopyQueryButton } from "@/components/engine/CopyQueryButton";
import { DataOsReadinessPanel } from "@/components/engine/DataOsReadinessPanel";
import { Icon } from "@/components/ui/Icon";
import { StatusPill, SuccessPill } from "@/components/ui/StatusPill";
import type { DataOsCorpusReadiness } from "@/lib/data-os/readiness";
import { queryPackHasData, queryPackHasDirectCsv } from "@/lib/engine/query-pack-readiness";

/* ============================================================
   Types — kept minimal; the server passes only what the wizard needs.
   ============================================================ */

type Step = "compose" | "upload" | "evaluate" | "decide" | "approved";

type Iteration = {
  id: string;
  iterationNumber: number;
  queryText: string;
  competitorQueryText: string | null | undefined;
  industryQueryText: string | null | undefined;
  qualityScore: string | null;
  densityScore: string | null;
  noiseScore: string | null;
  aiEvaluationNotes: unknown;
  insightsManagerDecision: string | null;
  createdAt: Date | string;
};

type Batch = {
  id: string;
  queryIterationId: string | null;
  queryPackId: string | null;
  mentionType: string | null;
  competitorId: string | null;
  corpusEntityId: string | null;
  entityKind: string | null;
  entityLabel: string | null;
  recordCount: number | null;
  includedCount: number | null;
  excludedCount: number | null;
  sourceFileName: string | null;
  status: string;
  createdAt: Date | string;
};

type QueryPack = {
  id: string;
  queryIterationId: string | null;
  lensSlug: string;
  signalIntent: string;
  scope: string;
  objective: string | null;
  queryText: string | null;
  queryComponents: unknown;
  seeds: unknown;
  evaluation: unknown;
  status: string;
  mentionsReturned: number | null;
  qualityScore: string | null;
  densityScore: string | null;
  noiseScore: string | null;
  evaluatedAt: Date | string | null;
  linkedMentionCount?: number | null;
  createdAt: Date | string;
};

type CorpusCounts = {
  total: number;
  included: number;
  excluded: number;
  pending: number;
};

type QueryValidationAttempt = {
  id: string;
  queryPackId: string;
  attemptNumber: number;
  attemptKind: "imported_evidence" | string;
  queryText: string;
  sampleSize: number;
  uniqueSampleSize: number;
  status: string;
  metrics: unknown;
  notes: string | null;
  proposedAdjustments: unknown;
  evaluatedAt: Date | string;
};

type QueryValidation = {
  id: string;
  status: string;
  sourceSystem: string;
  sampleSizePerPack: number;
  maxAttempts: number;
  summary: unknown;
  pipelineVersion: string;
  startedAt: Date | string;
  completedAt: Date | string | null;
  approved: boolean;
  contractCurrent: boolean;
  evidenceSampleTarget: number;
  minimumEvidenceSample: number;
  attempts: QueryValidationAttempt[];
} | null;

type CompetitorOption = {
  id: string;
  canonicalName: string;
  vertical: string | null;
  subVertical: string | null;
};

type CorpusEntity = {
  id: string;
  competitorId: string | null;
  entityKind: string;
  name: string;
  aliases: string[] | null;
  handles: string[] | null;
  querySeeds: string[] | null;
  notes: string | null;
  isCategoryBaseline: boolean | null;
  priority: number | null;
  status: string;
  batchCount: number;
  includedCount: number;
};

type Assessment = {
  ready_for_study: boolean;
  confidence: number;
  verdict: "ready" | "needs_more_signal" | "needs_more_volume" | "corpus_too_noisy";
  coverage: {
    trigger_signal_pct: number;
    barrier_signal_pct: number;
    experience_signal_pct: number;
    noise_pct: number;
  };
  signals_well_covered: string[];
  signals_missing: string[];
  recommendation: string;
  sample_size?: number;
  population_size?: number;
  sample_strategy?: "full_population" | "deterministic_platform_stratified" | string;
  corpus_revision?: number;
  metrics?: {
    population_size: number;
    classified_size: number;
    relevant_count_estimate: number;
    weighted_signal_density_pct: number;
    full_population_classified: boolean;
  };
  model?: string;
};

type NoiseCleanupPreview = {
  assessment_id: string;
  corpus_revision: number;
  included_count: number;
  excluded_count: number;
  retained_count: number;
  noise_percentage: number;
};

type WizardProps = {
  corpusId: string;
  corpusName: string;
  subjectType: "brand" | "theme";
  methodologyName: string | null;
  corpus: CorpusCounts;
  iterations: Iteration[];
  batches: Batch[];
  queryPacks: QueryPack[];
  selectedLensCount: number;
  dataOsReadiness: DataOsCorpusReadiness;
  current: Iteration | null;
  activeStep: Step;
  isApproved: boolean;
  queryReady: boolean;
  queryValidation: QueryValidation;
  assessment: Assessment | null;
  assessedAt: Date | string | null;
  corpusRevision: number;
  latestAssessedRevision: number | null;
  assessmentCurrent: boolean;
  snapshots: Snapshot[];
  cleanups: CleanupAction[];
  competitors: CompetitorOption[];
  entities: CorpusEntity[];
};

type EvalNotes = {
  status?: string;
  notes?: string;
  proposed_adjustments?: string[];
  language_mx_pct?: number;
  geo_mx_pct?: number;
  pack_results?: Array<{
    pack_id: string;
    scope: string;
    signal_intent: string;
    status: string;
    metrics?: {
      quality_score: number;
      density_score: number;
      noise_score: number;
      sample_size: number;
    } | null;
    notes?: string;
    failure_reason?: string | null;
  }>;
} | null;

type JobState = {
  id: string;
  name?: string;
  status: string;
  progress: number;
  failed_reason?: string | null;
};

/* ============================================================
   Helpers
   ============================================================ */

function parseNotes(raw: unknown): EvalNotes {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as EvalNotes;
    } catch {
      return null;
    }
  }
  return raw as EvalNotes;
}

function fmtNumber(n: number): string {
  return new Intl.NumberFormat("es-MX").format(n);
}

function packEvaluationStatus(pack: QueryPack): string {
  if (!pack.evaluation || typeof pack.evaluation !== "object" || Array.isArray(pack.evaluation)) {
    return "pending";
  }
  const status = (pack.evaluation as Record<string, unknown>).status;
  return typeof status === "string" ? status : "pending";
}

function packEvaluationFailureReason(pack: QueryPack): string | null {
  if (!pack.evaluation || typeof pack.evaluation !== "object" || Array.isArray(pack.evaluation)) {
    return null;
  }
  const failureReason = (pack.evaluation as Record<string, unknown>).failure_reason;
  return typeof failureReason === "string" && failureReason.trim().length > 0
    ? failureReason.trim()
    : null;
}

function validationMetrics(attempt: QueryValidationAttempt | undefined) {
  if (!attempt?.metrics || typeof attempt.metrics !== "object" || Array.isArray(attempt.metrics)) return null;
  const value = attempt.metrics as Record<string, unknown>;
  const quality = Number(value.quality_score);
  const density = Number(value.density_score);
  const noise = Number(value.noise_score);
  const sampleSize = Number(value.sample_size ?? attempt.sampleSize);
  return Number.isFinite(quality) && Number.isFinite(density) && Number.isFinite(noise)
    ? { quality, density, noise, sampleSize: Number.isFinite(sampleSize) ? sampleSize : attempt.sampleSize }
    : null;
}

function aggregateValidationMetrics(attempts: QueryValidationAttempt[]) {
  const metrics = attempts.flatMap((attempt) => {
    const parsed = validationMetrics(attempt);
    return parsed ? [parsed] : [];
  });
  const sampleSize = metrics.reduce((total, item) => total + item.sampleSize, 0);
  if (metrics.length !== attempts.length || sampleSize === 0) return null;
  const weighted = (key: "quality" | "density" | "noise") => (
    metrics.reduce((total, item) => total + item[key] * item.sampleSize, 0) / sampleSize
  );
  return {
    quality: weighted("quality"),
    density: weighted("density"),
    noise: weighted("noise"),
    sampleSize
  };
}

function validationMetricsReady(metrics: ReturnType<typeof validationMetrics>): boolean {
  return Boolean(metrics && metrics.quality >= 7 && metrics.density >= 7 && metrics.noise <= 3);
}

function normalizedAdjustments(attempts: QueryValidationAttempt[]): string[] {
  return [...new Set(attempts.flatMap((attempt) => (
    Array.isArray(attempt.proposedAdjustments)
      ? attempt.proposedAdjustments.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : []
  )))];
}

/* ============================================================
   Main Wizard
   ============================================================ */

export function EngineWizard(props: WizardProps) {
  const router = useRouter();
  const {
    corpusId,
    corpusName,
    subjectType,
    methodologyName,
    corpus,
    iterations,
    batches,
    queryPacks,
    selectedLensCount,
    dataOsReadiness,
    current,
    activeStep: serverActiveStep,
    isApproved,
    queryReady,
    queryValidation,
    assessment,
    assessedAt,
    corpusRevision,
    latestAssessedRevision,
    assessmentCurrent,
    snapshots,
    cleanups,
    competitors,
    entities,
  } = props;

  // Active step — server's computation is the source of truth, but we may
  // optimistically advance locally while a job is in flight.
  const [activeStep, setActiveStep] = useState<Step>(serverActiveStep);
  useEffect(() => setActiveStep(serverActiveStep), [serverActiveStep]);

  const iterationNumber = current ? current.iterationNumber : (iterations[0]?.iterationNumber ?? 0) + 1;

  // History = everything except the current one
  const history = useMemo(() => {
    if (!current) return iterations;
    return iterations.filter((i) => i.id !== current.id);
  }, [iterations, current]);

  const currentBatches = useMemo(
    () => (current ? batches.filter((b) => b.queryIterationId === current.id) : []),
    [batches, current]
  );
  const currentQueryPacks = useMemo(
    () => (current ? queryPacks.filter((pack) => pack.queryIterationId === current.id) : []),
    [queryPacks, current]
  );
  const hasImportedCorpus = corpus.included > 0;
  const queryWorkflowSteps = [
    { id: "compose" as const, label: "Generar" },
    { id: "upload" as const, label: "Importar evidencia" },
    { id: "evaluate" as const, label: "Evaluar" },
    { id: "decide" as const, label: "Decidir" },
  ];

  return (
    <div className="wizard-shell">
      {/* Vital signs header */}
      <CorpusVitals
        name={corpusName}
        methodology={methodologyName}
        counts={corpus}
        iterationCount={iterations.length}
        queryValidation={queryValidation}
        queryReady={queryReady}
        isApproved={isApproved}
        corpusRevision={corpusRevision}
        assessmentCurrent={assessmentCurrent}
      />

      <DataOsReadinessPanel readiness={dataOsReadiness} />

      {/* Once mentions exist, corpus certification is the primary task. Query
          validation remains available for a future extraction iteration. */}
      {(hasImportedCorpus || assessment) && (
        <CorpusAssessmentPanel
          corpusId={corpusId}
          totalIncluded={corpus.included}
          assessment={assessment}
          assessedAt={assessedAt}
          corpusRevision={corpusRevision}
          latestAssessedRevision={latestAssessedRevision}
          assessmentCurrent={assessmentCurrent}
          isApproved={isApproved}
          iterationCount={iterations.length}
        />
      )}

      {/* Query preparation workflow */}
      <article className={`wizard-card${hasImportedCorpus ? " wizard-card--query-prep" : ""}`}>
        <header className="wizard-card-head">
          <div>
            <div className="wizard-card-eyebrow-row">
              <p className="wizard-iter-label">
                {activeStep === "approved"
                  ? "Iteración cerrada · corpus aprobado"
                  : hasImportedCorpus
                    ? `Queries para próxima extracción · iteración #${iterationNumber}`
                  : iterations.length === 0
                    ? "Primera iteración"
                    : `Iteración #${iterationNumber}`}
              </p>
              {isApproved && <SuccessPill>Corpus aprobado</SuccessPill>}
              {isApproved && activeStep !== "approved" && (
                <StatusPill tone="info"><Icon name="refresh" size={12} /> Enriqueciendo</StatusPill>
              )}
              {!isApproved && current && (
                activeStep === "evaluate" || activeStep === "compose" ? (
                  <StatusPill tone="idle"><Icon name="info" size={12} /> En curso</StatusPill>
                ) : activeStep === "decide" ? (
                  queryReady ? (
                    <SuccessPill>Queries aprobadas</SuccessPill>
                  ) : queryValidation?.contractCurrent && queryValidation.attempts.length > 0 ? (
                    <StatusPill tone="warn"><Icon name="alert" size={12} /> Requiere decisión</StatusPill>
                  ) : (
                    <StatusPill tone="idle"><Icon name="info" size={12} /> Sin probar</StatusPill>
                  )
                ) : (
                  <StatusPill tone="info"><Icon name="upload" size={12} /> Esperando evidencia por pack</StatusPill>
                )
              )}
            </div>
            <h2 className="wizard-iter-title">
              {activeStep === "approved"
                ? "Sigue iterando para subir la densidad"
                : isApproved
                  ? "Iteración post-aprobación · más menciones al corpus"
                  : activeStep === "upload"
                    ? "Importar la primera extracción por query pack"
                    : hasImportedCorpus
                      ? "Evaluar queries con evidencia importada"
                    : current?.qualityScore
                    ? "Evidencia evaluada · decide el siguiente paso"
                    : "Generar, observar y ajustar queries"}
            </h2>
          </div>
          {activeStep !== "approved" && (
            <StepIndicator
              steps={queryWorkflowSteps}
              activeStep={activeStep}
            />
          )}
        </header>

        <div className="wizard-card-body">
          {isApproved && activeStep === "approved" ? (
            <ApprovedImproveState
              corpusId={corpusId}
              onContinued={() => {
                router.refresh();
                setActiveStep("upload");
              }}
            />
          ) : activeStep === "compose" ? (
            <StepCompose
              corpusId={corpusId}
              hasHistory={iterations.length > 0}
              onComposed={() => {
                router.refresh();
                setActiveStep("upload");
              }}
            />
          ) : !current ? null : activeStep === "upload" ? (
            <StepUpload
              corpusId={corpusId}
              iteration={current}
              existingBatches={currentBatches}
              queryPacks={currentQueryPacks}
              selectedLensCount={selectedLensCount}
              competitors={competitors}
              entities={entities}
              subjectType={subjectType}
              onPacksMaterialized={() => router.refresh()}
            />
          ) : activeStep === "evaluate" ? (
            <StepEvaluate
              corpusId={corpusId}
              iteration={current}
              queryPacks={currentQueryPacks}
              onEvaluated={() => {
                router.refresh();
              }}
            />
          ) : (
            <StepDecide
              corpusId={corpusId}
              iteration={current}
              queryPacks={currentQueryPacks}
              queryValidation={queryValidation}
              hasImportedCorpus={hasImportedCorpus}
              onActioned={() => router.refresh()}
            />
          )}
        </div>
      </article>

      {corpus.included >= 100 && (
        <CorpusMaintenancePanel
          corpusId={corpusId}
          totalIncluded={corpus.included}
          snapshots={snapshots}
          cleanups={cleanups}
        />
      )}

      {/* History (collapsed) */}
      {history.length > 0 && <IterationHistory iterations={history} />}
    </div>
  );
}

/* ============================================================
   Header — corpus vital signs
   ============================================================ */

function CorpusVitals({
  name,
  methodology,
  counts,
  iterationCount,
  queryValidation,
  queryReady,
  isApproved,
  corpusRevision,
  assessmentCurrent,
}: {
  name: string;
  methodology: string | null;
  counts: CorpusCounts;
  iterationCount: number;
  queryValidation: QueryValidation;
  queryReady: boolean;
  isApproved: boolean;
  corpusRevision: number;
  assessmentCurrent: boolean;
}) {
  const banner: { text: string; icon: "check" | "star" | "wave" | "info"; tone: "neutral" | "warn" | "good" } = isApproved
    ? { text: "Corpus aprobado", icon: "check", tone: "good" }
    : queryReady
      ? { text: "Queries listas para extracción", icon: "star", tone: "good" }
      : iterationCount === 0
        ? { text: "Empieza generando la primera query", icon: "info", tone: "neutral" }
        : { text: "Evalúa las queries con evidencia importada", icon: "wave", tone: "warn" };

  return (
    <header className="vitals">
      <div className="vitals-main">
        <p className="vitals-eyebrow">{methodology ?? "Corpus"}</p>
        <h1 className="vitals-name">{name}</h1>
      </div>
      <div className="vitals-stats">
        <Stat label="Menciones" value={fmtNumber(counts.included)} sub={`${fmtNumber(counts.total)} totales`} highlight />
        <Stat label="Excluidas" value={fmtNumber(counts.excluded)} sub="filtradas" />
        <Stat
          label="Queries"
          value={queryReady ? "Cerradas" : queryValidation?.status === "ready" ? "Validadas" : queryValidation ? "Ajustar" : "Pendientes"}
          sub={queryValidation ? "evidencia por pack" : `${iterationCount} ${iterationCount === 1 ? "iteración" : "iteraciones"}`}
        />
        <Stat
          label={`Corpus r${corpusRevision}`}
          value={isApproved ? "Aprobado" : assessmentCurrent ? "Evaluado" : "Sin certificar"}
          sub={assessmentCurrent ? "revisión vigente" : "requiere evaluación"}
        />
      </div>
      <div className={`vitals-banner vitals-banner--${banner.tone}`}>
        <Icon name={banner.icon} size={14} /> {banner.text}
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`vital-stat${highlight ? " vital-stat--hi" : ""}`}>
      <span className="vital-stat-label">{label}</span>
      <span className="vital-stat-value">{value}</span>
      {sub && <span className="vital-stat-sub">{sub}</span>}
    </div>
  );
}

/* ============================================================
   Step indicator (pill train)
   ============================================================ */

function StepIndicator({
  steps,
  activeStep,
}: {
  steps: { id: Step; label: string }[];
  activeStep: Step;
}) {
  const activeIdx = steps.findIndex((s) => s.id === activeStep);
  return (
    <ol className="step-train">
      {steps.map((s, i) => {
        const state = i < activeIdx ? "done" : i === activeIdx ? "active" : "todo";
        return (
          <li key={s.id} className={`step-pip step-pip--${state}`}>
            <span className="step-pip-dot">{state === "done" ? "✓" : i + 1}</span>
            <span className="step-pip-label">{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/* ============================================================
   STEP 1 — Compose
   ============================================================ */

function StepCompose({
  corpusId,
  hasHistory,
  onComposed,
}: {
  corpusId: string;
  hasHistory: boolean;
  onComposed: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [autoStarted, setAutoStarted] = useState(false);

  // Auto-start when there is no history at all (very first iteration of a fresh corpus)
  useEffect(() => {
    if (!hasHistory && !autoStarted && !running) {
      setAutoStarted(true);
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHistory]);

  async function start() {
    setRunning(true);
    setError(null);
    setProgress(5);

    const res = await fetch(`/api/corpora/${corpusId}/run-engine`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ iteration_strategy: "auto", max_iterations: 5 }),
    });

    const payload = await res.json();
    if (!res.ok) {
      setError(payload.message ?? "No se pudo iniciar la generación.");
      setRunning(false);
      return;
    }

    const jobId = payload.job_id;
    let waitingWithoutWorkerChecks = 0;
    const poll = setInterval(async () => {
      const jr = await fetch(`/api/jobs/${jobId}`);
      const j = await jr.json().catch(() => ({}));
      if (!jr.ok) {
        clearInterval(poll);
        setError(j.message ?? "No se pudo leer el estado del job.");
        setRunning(false);
        return;
      }
      const nextProgress = typeof j.progress === "number" ? Math.round(j.progress) : 0;
      setProgress((current) => Math.max(current, nextProgress));
      const isWaiting = j.status === "waiting" || j.status === "delayed";
      if (isWaiting && j.worker_alive === false) {
        waitingWithoutWorkerChecks += 1;
        if (waitingWithoutWorkerChecks >= 4) {
          clearInterval(poll);
          setError("El worker local no está activo. Levanta pnpm --filter @noisia/workers dev y vuelve a generar.");
          setRunning(false);
          return;
        }
      } else {
        waitingWithoutWorkerChecks = 0;
      }
      if (j.status === "completed") {
        clearInterval(poll);
        setProgress(100);
        setTimeout(onComposed, 400);
      } else if (j.status === "failed") {
        clearInterval(poll);
        setError(j.failed_reason ?? "La generación falló.");
        setRunning(false);
      }
    }, 1500);
  }

  return (
    <div className="step-body">
      <p className="step-helper">
        El motor compone <strong>hipótesis booleanas portables por query pack</strong> usando
        Brand OS, brief y Data OS. No consulta ni certifica ningún proveedor en este paso.
        La calidad se mide después, sobre la primera extracción que importes para cada pack.
      </p>

      {!running && !autoStarted && (
        <button className="wizard-cta" onClick={start} type="button">
          <Icon name="sparkle" size={16} />
          {hasHistory ? "Generar nueva query desde cero" : "Generar primera query"}
        </button>
      )}

      {running && (
        <div className="wizard-progress">
          <div className="wizard-progress-bar">
            <span style={{ width: `${progress}%` }} />
          </div>
          <p className="wizard-progress-text">
            <Icon name="spinner" className="icon--spin" size={12} />
            Componiendo queries · {progress}%
          </p>
        </div>
      )}

      {error && (
        <p className="wizard-error">
          <Icon name="alert" size={14} /> {error}
        </p>
      )}
    </div>
  );
}

/* ============================================================
   STEP 2 — Import the first extraction produced by each query hypothesis
   ============================================================ */

function StepUpload({
  corpusId,
  iteration,
  existingBatches,
  queryPacks,
  selectedLensCount,
  competitors,
  entities,
  subjectType,
  onPacksMaterialized,
}: {
  corpusId: string;
  iteration: Iteration;
  existingBatches: Batch[];
  queryPacks: QueryPack[];
  selectedLensCount: number;
  competitors: CompetitorOption[];
  entities: CorpusEntity[];
  subjectType: "brand" | "theme";
  onPacksMaterialized: () => void;
}) {
  const [materializingPacks, setMaterializingPacks] = useState(false);
  const [materializeError, setMaterializeError] = useState<string | null>(null);
  const [autoMaterializeRequested, setAutoMaterializeRequested] = useState(false);
  const usableQueryPacks = queryPacks.filter((pack) => typeof pack.queryText === "string" && pack.queryText.length > 0);
  const packMode = usableQueryPacks.length > 0;
  const expectedPackMode = selectedLensCount > 1;
  const primaryMentionType = subjectType === "theme" ? "industry" : "brand";
  const primaryQueryText = subjectType === "theme"
    ? iteration.industryQueryText ?? iteration.queryText
    : iteration.queryText;
  const wantsIndustry = subjectType === "brand" && !!iteration.industryQueryText;
  const wantsCompetitor = !!iteration.competitorQueryText;
  const activeEntities = entities.filter((entity) => entity.status !== "archived");
  const entityMode = activeEntities.length > 0;
  const uploadedEntityIds = new Set(
    existingBatches
      .filter((batch) => batch.status === "completed" && batch.corpusEntityId)
      .map((batch) => batch.corpusEntityId as string)
  );
  const doneEntityCount = activeEntities.filter((entity) => uploadedEntityIds.has(entity.id)).length;
  const primaryDone = existingBatches.some(
    (b) => b.mentionType === primaryMentionType && b.status === "completed"
  );
  const competitorDone = existingBatches.some(
    (b) => b.mentionType === "competitor" && b.status === "completed"
  );
  const industryDone = existingBatches.some(
    (b) => b.mentionType === "industry" && b.status === "completed"
  );
  const legacyUploadsDone = primaryDone && (!wantsCompetitor || competitorDone) && (!wantsIndustry || industryDone);
  const packUploadsDone = packMode
    ? usableQueryPacks.every((pack) => queryPackHasDirectCsv(pack, existingBatches))
    : false;
  const allDone = expectedPackMode && !packMode
    ? false
    : packMode
      ? packUploadsDone
      : entityMode
        ? doneEntityCount === activeEntities.length
        : legacyUploadsDone;

  async function materializeQueryPacks() {
    setMaterializingPacks(true);
    setMaterializeError(null);
    try {
      const res = await fetch(`/api/corpora/${corpusId}/query-packs/materialize`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? "No se pudieron crear los query packs.");
      onPacksMaterialized();
    } catch (error) {
      setMaterializeError(error instanceof Error ? error.message : "No se pudieron crear los query packs.");
    } finally {
      setMaterializingPacks(false);
    }
  }

  useEffect(() => {
    if (!expectedPackMode || packMode || materializingPacks || autoMaterializeRequested) return;
    setAutoMaterializeRequested(true);
    void materializeQueryPacks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expectedPackMode, packMode, materializingPacks, autoMaterializeRequested]);

  return (
    <div className="step-body">
      <p className="step-helper">
        {packMode
          ? "Ejecuta cada hipótesis en la plataforma de escucha que uses, exporta una primera extracción y súbela en su pack. Cada CSV queda ligado a la query, scope e intención que lo produjeron; el evaluador se habilita cuando todos los packs tienen evidencia directa."
          : "Ejecuta cada hipótesis en tu plataforma de escucha, exporta los CSVs y súbelos aquí. Cada archivo suma menciones únicas al corpus y conserva su provenance; los duplicados se filtran automáticamente."}
      </p>

      {!packMode && expectedPackMode ? (
        <div className="peer-upload-requirement">
          <Icon name={materializingPacks ? "spinner" : "info"} size={14} />
          <span>
            Este estudio tiene {selectedLensCount} lentes seleccionados. Estamos preparando los módulos de query pack desde la query existente; no llama a Claude ni toca menciones.
          </span>
          <button className="wizard-cta wizard-cta--ghost" disabled={materializingPacks} onClick={materializeQueryPacks} type="button">
            <Icon name={materializingPacks ? "spinner" : "sparkle"} size={14} />
            {materializingPacks ? "Creando packs" : "Reintentar módulos"}
          </button>
        </div>
      ) : null}

      {materializeError ? (
        <p className="wizard-error">
          <Icon name="alert" size={14} /> {materializeError}
        </p>
      ) : null}

      {packMode ? (
        <QueryPackModules
          corpusId={corpusId}
          existingBatches={existingBatches}
          iterationId={iteration.id}
          packs={usableQueryPacks}
        />
      ) : (
        <div className="wizard-queries">
          <QueryBlock
            label={subjectType === "theme" ? "Query de categoría / peer set" : "Query de marca"}
            accent={primaryMentionType}
            text={primaryQueryText}
          />
          {iteration.competitorQueryText && (
            <QueryBlock
              label={subjectType === "theme" ? "Query de peers / competidores" : "Query de competencia"}
              accent="competitor"
              text={iteration.competitorQueryText}
            />
          )}
          {subjectType === "brand" && iteration.industryQueryText && (
            <QueryBlock
              label="Query de categoría / baseline"
              accent="industry"
              text={iteration.industryQueryText}
            />
          )}
        </div>
      )}

      {!packMode && (
        <PeerSetPanel
          corpusId={corpusId}
          entities={entities}
          existingBatches={existingBatches}
          iterationId={iteration.id}
        />
      )}

      {packMode ? (
        <div className="peer-upload-requirement">
          <Icon name={allDone ? "check" : "info"} size={14} />
          <span>
            CSVs directos: {usableQueryPacks.filter((pack) => queryPackHasDirectCsv(pack, existingBatches)).length} / {usableQueryPacks.length}.
          </span>
        </div>
      ) : entityMode ? (
        <div className="peer-upload-requirement">
          <Icon name={allDone ? "check" : "info"} size={14} />
          <span>
            CSVs por entidad activa: {doneEntityCount} / {activeEntities.length} listos.
          </span>
        </div>
      ) : (
        <div className={`upload-grid${wantsIndustry || wantsCompetitor ? "" : " upload-grid--single"}`}>
          <UploadSlot
            corpusId={corpusId}
            iterationId={iteration.id}
            mentionType={primaryMentionType}
            done={primaryDone}
          />
          {wantsCompetitor && (
            <UploadSlot
              corpusId={corpusId}
              iterationId={iteration.id}
              mentionType="competitor"
              competitors={competitors}
              done={competitorDone}
            />
          )}
          {wantsIndustry && (
            <UploadSlot
              corpusId={corpusId}
              iterationId={iteration.id}
              mentionType="industry"
              done={industryDone}
            />
          )}
        </div>
      )}

      {allDone && (
        <div className="wizard-success-actions">
          <p className="wizard-success-hint">
            <Icon name="check" size={14} /> Evidencia importada. Ya puedes evaluar la calidad de cada query pack.
          </p>
        </div>
      )}
    </div>
  );
}

function QueryPackModules({
  corpusId,
  iterationId,
  packs,
  existingBatches
}: {
  corpusId: string;
  iterationId: string;
  packs: QueryPack[];
  existingBatches: Batch[];
}) {
  const groups = groupQueryPacksByLens(packs, existingBatches);

  return (
    <div className="query-pack-modules">
      {groups.map((group) => (
        <section className="query-pack-module" key={group.lensSlug}>
          <header className="query-pack-module-head">
            <div>
              <p className="vitals-eyebrow">Módulo de corpus</p>
              <h3>{group.lensLabel}</h3>
              <p>{group.packs.length} packs para alimentar el estudio con provenance separada.</p>
            </div>
            <StatusPill tone={group.doneCount === group.packs.length ? "success" : "info"}>
              {group.doneCount}/{group.packs.length} CSVs
            </StatusPill>
          </header>
          <div className="query-pack-grid">
            {group.packs.map((pack) => {
              const mentionType = mentionTypeForScope(pack.scope);
              const seeds = normalizePackSeeds(pack.seeds);
              const done = queryPackHasDirectCsv(pack, existingBatches);
              const hasSharedData = !done && queryPackHasData(pack, existingBatches);
              return (
                <article className="query-pack-card" key={pack.id}>
                  <div className="query-pack-card-copy">
                    <p className={`upload-slot-tag upload-slot-tag--${mentionType}`}>{scopeLabel(pack.scope)}</p>
                    <h4>{seeds.signal_label ?? pack.signalIntent}</h4>
                    <p>{pack.objective ?? "Pack generado desde el plan del estudio."}</p>
                    {seeds.source_hints.length > 0 && (
                      <small>
                        También puede nutrirse con: {seeds.source_hints.slice(0, 4).map(providerNeutralSourceHint).join(", ")}.
                      </small>
                    )}
                  </div>
                  <QueryBlock
                    label="Query para este pack"
                    accent={mentionType}
                    text={pack.queryText ?? ""}
                  />
                  <UploadSlot
                    corpusId={corpusId}
                    iterationId={iterationId}
                    mentionType={mentionType}
                    queryPackId={pack.id}
                    lensSlug={pack.lensSlug}
                    signalIntent={pack.signalIntent}
                    scope={pack.scope}
                    done={done}
                    entityLabelDefault={seeds.signal_label ?? `${group.lensLabel} · ${scopeLabel(pack.scope)}`}
                  />
                  {hasSharedData ? (
                    <p className="query-pack-shared-note">
                      Este pack ya tiene menciones compartidas por provenance, pero falta su CSV directo para cerrar el módulo.
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function providerNeutralSourceHint(value: string) {
  return value
    .replace(/^SentiOne brand export$/i, "brand listening export")
    .replace(/^SentiOne competitor export$/i, "competitor listening export")
    .replace(/^SentiOne category export$/i, "category listening export")
    .replace(/\bSentiOne\b/gi, "listening provider")
    .trim();
}

function groupQueryPacksByLens(packs: QueryPack[], existingBatches: Batch[]) {
  const map = new Map<string, QueryPack[]>();
  for (const pack of packs) {
    const current = map.get(pack.lensSlug) ?? [];
    current.push(pack);
    map.set(pack.lensSlug, current);
  }
  return Array.from(map.entries()).map(([lensSlug, groupPacks]) => {
    const firstSeeds = normalizePackSeeds(groupPacks[0]?.seeds);
    return {
      lensSlug,
      lensLabel: firstSeeds.lens_label ?? labelFromSlug(lensSlug),
      packs: groupPacks.sort((a, b) => scopeOrder(a.scope) - scopeOrder(b.scope)),
      doneCount: groupPacks.filter((pack) => queryPackHasDirectCsv(pack, existingBatches)).length
    };
  });
}

function normalizePackSeeds(seeds: unknown) {
  const value = seeds && typeof seeds === "object" && !Array.isArray(seeds) ? seeds as Record<string, unknown> : {};
  return {
    lens_label: typeof value.lens_label === "string" ? value.lens_label : null,
    signal_label: typeof value.signal_label === "string" ? value.signal_label : null,
    source_hints: Array.isArray(value.source_hints)
      ? value.source_hints.filter((item): item is string => typeof item === "string")
      : []
  };
}

function mentionTypeForScope(scope: string): "brand" | "competitor" | "industry" {
  if (scope === "competitors") return "competitor";
  if (scope === "category" || scope === "baseline") return "industry";
  return "brand";
}

function scopeLabel(scope: string) {
  if (scope === "brand") return "Marca";
  if (scope === "competitors") return "Competidores";
  if (scope === "category") return "Categoría";
  if (scope === "baseline") return "Baseline";
  return scope;
}

function queryPackIntentLabel(scope: string, signalIntent: string) {
  if (scope === "brand") return "Señal de marca y decisión";
  if (scope === "competitors") return "Señal competitiva";
  if (scope === "category") return "Señal de categoría";
  return signalIntent.replaceAll("_", " ");
}

function queryPackEvidenceLabel(status: string) {
  if (status === "ready") return "Lista";
  if (status === "needs_adjustment") return "Requiere ajustes";
  if (status === "failed") return "Evaluación fallida";
  if (status === "insufficient_sample") return "Muestra insuficiente";
  return "Sin evaluar";
}

function scopeOrder(scope: string) {
  if (scope === "brand") return 1;
  if (scope === "competitors") return 2;
  if (scope === "category") return 3;
  if (scope === "baseline") return 4;
  return 9;
}

function labelFromSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function PeerSetPanel({
  corpusId,
  entities,
  existingBatches,
  iterationId,
}: {
  corpusId: string;
  entities: CorpusEntity[];
  existingBatches: Batch[];
  iterationId: string;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [entityKind, setEntityKind] = useState<"competitor" | "category" | "primary_brand">("competitor");
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [handles, setHandles] = useState("");
  const [querySeeds, setQuerySeeds] = useState("");
  const [notes, setNotes] = useState("");
  const [isCategoryBaseline, setIsCategoryBaseline] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeEntities = entities.filter((entity) => entity.status !== "archived");

  function resetForm() {
    setEditingId(null);
    setEntityKind("competitor");
    setName("");
    setAliases("");
    setHandles("");
    setQuerySeeds("");
    setNotes("");
    setIsCategoryBaseline(false);
    setError(null);
  }

  function edit(entity: CorpusEntity) {
    setEditingId(entity.id);
    setEntityKind(normalizeEntityKind(entity.entityKind));
    setName(entity.name);
    setAliases((entity.aliases ?? []).join("\n"));
    setHandles((entity.handles ?? []).join("\n"));
    setQuerySeeds((entity.querySeeds ?? []).join("\n"));
    setNotes(entity.notes ?? "");
    setIsCategoryBaseline(Boolean(entity.isCategoryBaseline));
    setError(null);
  }

  async function save() {
    if (name.trim().length < 2) {
      setError("Pon el nombre de la entidad.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        entity_kind: entityKind,
        name: name.trim(),
        aliases: splitEntityLines(aliases),
        handles: splitEntityLines(handles),
        query_seeds: splitEntityLines(querySeeds),
        notes,
        is_category_baseline: entityKind === "category" && isCategoryBaseline,
        status: "active"
      };
      const res = await fetch(
        editingId ? `/api/corpora/${corpusId}/entities/${editingId}` : `/api/corpora/${corpusId}/entities`,
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? "No se pudo guardar la entidad.");
      resetForm();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la entidad.");
    } finally {
      setIsSaving(false);
    }
  }

  async function archive(entity: CorpusEntity) {
    if (!window.confirm(`¿Archivar ${entity.name}? Sus batches históricos se conservan.`)) return;
    setError(null);
    const res = await fetch(`/api/corpora/${corpusId}/entities/${entity.id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json?.message ?? "No se pudo archivar la entidad.");
      return;
    }
    router.refresh();
  }

  return (
    <section className="peer-set-panel">
      <header className="peer-set-head">
        <div>
          <p className="vitals-eyebrow">Peer set reusable</p>
          <h3>Entidades del corpus</h3>
          <p>Define peers, marca principal o baseline de categoría con aliases, handles y query seeds.</p>
        </div>
        {editingId && (
          <button className="btn-micro" type="button" onClick={resetForm}>
            Cancelar edición
          </button>
        )}
      </header>

      <div className="peer-entity-form">
        <label>
          <span>Tipo</span>
          <select
            value={entityKind}
            onChange={(event) => {
              const next = normalizeEntityKind(event.target.value);
              setEntityKind(next);
              if (next !== "category") setIsCategoryBaseline(false);
            }}
          >
            <option value="competitor">Peer / competidor</option>
            <option value="category">Category baseline</option>
            <option value="primary_brand">Marca principal</option>
          </select>
        </label>
        <label>
          <span>Nombre</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Telcel, AT&T, Telefonía MX..." />
        </label>
        <label>
          <span>Aliases</span>
          <textarea value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="Uno por línea o separado por coma" />
        </label>
        <label>
          <span>Handles</span>
          <textarea value={handles} onChange={(event) => setHandles(event.target.value)} placeholder="@telcel\n@attmx" />
        </label>
        <label>
          <span>Query seeds</span>
          <textarea value={querySeeds} onChange={(event) => setQuerySeeds(event.target.value)} placeholder="términos que deben entrar a la query" />
        </label>
        <label>
          <span>Notas</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Scope, límites, marcas del grupo, etc." />
        </label>
        {entityKind === "category" && (
          <label className="peer-baseline-toggle">
            <input checked={isCategoryBaseline} onChange={(event) => setIsCategoryBaseline(event.target.checked)} type="checkbox" />
            <span>Usar como category baseline</span>
          </label>
        )}
        <button className="wizard-cta" type="button" onClick={save} disabled={isSaving}>
          <Icon name={isSaving ? "spinner" : "sparkle"} size={14} />
          {editingId ? "Guardar entidad" : "Crear entidad"}
        </button>
      </div>

      {error && (
        <p className="wizard-error">
          <Icon name="alert" size={14} /> {error}
        </p>
      )}

      <div className="peer-entity-list">
        {activeEntities.length === 0 ? (
          <p className="peer-empty">Aún no hay entidades. Crea peers para poder subir CSVs por jugador o baseline.</p>
        ) : (
          activeEntities.map((entity) => {
            const mentionType = mentionTypeForEntity(entity);
            const done = existingBatches.some((batch) => batch.corpusEntityId === entity.id && batch.status === "completed");
            return (
              <article className="peer-entity-card" key={entity.id}>
                <header>
                  <div>
                    <p className={`upload-slot-tag upload-slot-tag--${mentionType}`}>{entity.entityKind}</p>
                    <h4>{entity.name}</h4>
                    <small>{fmtNumber(entity.includedCount)} menciones · {entity.batchCount} batches</small>
                  </div>
                  <div className="peer-entity-actions">
                    <button className="btn-micro" type="button" onClick={() => edit(entity)}>Editar</button>
                    <button className="btn-micro" type="button" onClick={() => archive(entity)}>Archivar</button>
                  </div>
                </header>
                <PeerSeedLine label="Aliases" values={entity.aliases ?? []} />
                <PeerSeedLine label="Handles" values={entity.handles ?? []} />
                <PeerSeedLine label="Seeds" values={entity.querySeeds ?? []} />
                <UploadSlot
                  corpusId={corpusId}
                  entity={entity}
                  iterationId={iterationId}
                  mentionType={mentionType}
                  done={done}
                />
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

function PeerSeedLine({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <p className="peer-seed-line">
      <span>{label}</span>
      {values.slice(0, 8).join(", ")}
    </p>
  );
}

function mentionTypeForEntity(entity: Pick<CorpusEntity, "entityKind">): "brand" | "competitor" | "industry" {
  if (entity.entityKind === "primary_brand") return "brand";
  if (entity.entityKind === "category") return "industry";
  return "competitor";
}

function normalizeEntityKind(value: string): "competitor" | "category" | "primary_brand" {
  if (value === "category" || value === "primary_brand") return value;
  return "competitor";
}

function splitEntityLines(value: string) {
  return Array.from(
    new Set(
      value
        .split(/\n|,/)
        .map((item) => item.trim().replace(/\s+/g, " "))
        .filter(Boolean)
    )
  ).slice(0, 40);
}

function QueryBlock({
  label,
  accent,
  text,
}: {
  label: string;
  accent: "brand" | "competitor" | "industry";
  text: string;
}) {
  return (
    <section className={`wizard-query wizard-query--${accent}`}>
      <p className="wizard-query-label">{label}</p>
      <CopyQueryButton queryText={text} />
    </section>
  );
}

function UploadSlot({
  corpusId,
  iterationId,
  mentionType,
  entity,
  competitors = [],
  queryPackId,
  lensSlug,
  signalIntent,
  scope,
  entityLabelDefault,
  done,
}: {
  corpusId: string;
  iterationId: string;
  mentionType: "brand" | "competitor" | "industry";
  entity?: CorpusEntity;
  competitors?: CompetitorOption[];
  queryPackId?: string;
  lensSlug?: string;
  signalIntent?: string;
  scope?: string;
  entityLabelDefault?: string;
  done: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">(
    done ? "success" : "idle"
  );
  const [entityLabel, setEntityLabel] = useState(
    entity?.name ?? entityLabelDefault ?? (mentionType === "competitor" ? "Pool competitivo" : mentionType === "industry" ? "Baseline de categoría" : "Marca")
  );
  const [competitorId, setCompetitorId] = useState<string>(entity?.competitorId ?? "");
  const [stats, setStats] = useState<{ included: number; excluded: number; duplicates: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (done) setStatus("success");
  }, [done]);

  async function handleFile(file: File) {
    setStatus("uploading");
    setError(null);
    setProgress(15);

    // Metadata goes in the query string; the CSV is sent as the raw request
    // body so the browser streams it from disk and the server streams it back —
    // multipart FormData buffers the whole file in memory and OOMs on ~0.5GB CSVs.
    const params = new URLSearchParams();
    params.set("mention_type", mentionType);
    params.set("query_iteration_id", iterationId);
    if (queryPackId) params.set("query_pack_id", queryPackId);
    params.set("source_label", queryPackId ? `pack_${queryPackId}` : entity ? `entity_${entity.id}` : `iter_${mentionType}`);
    params.set("file_name", file.name);
    if (entity) {
      params.set("corpus_entity_id", entity.id);
    }
    if (mentionType === "competitor" && (entity?.competitorId || competitorId)) {
      params.set("competitor_id", entity?.competitorId ?? competitorId);
    }
    params.set("entity_label", entityLabel.trim());
    params.set(
      "entity_kind",
      entity?.entityKind ??
      (mentionType === "brand"
        ? "primary_brand"
        : mentionType === "industry"
          ? "category"
          : competitorId || (entityLabel.trim() && entityLabel.trim() !== "Pool competitivo")
            ? "competitor"
            : "competitor_pool")
    );
    if (lensSlug) params.set("lens_slug", lensSlug);
    if (signalIntent) params.set("signal_intent", signalIntent);
    if (scope) params.set("scope", scope);

    // Fake progressive feedback while server processes
    const tick = setInterval(() => {
      setProgress((p) => (p < 88 ? p + 4 : p));
    }, 400);

    try {
      const res = await fetch(`/api/corpora/${corpusId}/mentions/csv-upload?${params.toString()}`, {
        method: "POST",
        headers: { "content-type": "text/csv" },
        body: file,
      });
      clearInterval(tick);
      const json = await res.json();
      if (!res.ok) {
        const raw = json?.message ?? `Error ${res.status}`;
        // Truncate long SQL/stack traces so the UI doesn't blow up
        const short = typeof raw === "string" && raw.length > 220 ? raw.slice(0, 220) + "…" : raw;
        setError(short);
        setStatus("error");
        setProgress(0);
        return;
      }
      if (json.job_id) {
        const job = await waitForCsvIngestJob(String(json.job_id), setProgress);
        if (job.status !== "completed") {
          setError(job.failed_reason ?? "La ingesta quedó detenida en el worker.");
          setStatus("error");
          setProgress(0);
          return;
        }
        const resultStats = job.result?.stats;
        setProgress(100);
        setStats(resultStats ? {
          included: resultStats.included_count ?? 0,
          excluded: resultStats.excluded_count ?? 0,
          duplicates: resultStats.duplicate_count ?? 0,
        } : null);
        setStatus("success");
        router.refresh();
        return;
      }
      setProgress(100);
      setStats({
        included: json.stats?.included_count ?? 0,
        excluded: json.stats?.excluded_count ?? 0,
        duplicates: json.stats?.duplicate_count ?? 0,
      });
      setStatus("success");
      router.refresh();
    } catch {
      clearInterval(tick);
      setError("Conexión perdida.");
      setStatus("error");
      setProgress(0);
    }
  }

  const labelText =
    mentionType === "brand"
      ? "CSV de marca"
      : mentionType === "competitor"
        ? "CSV de competencia"
        : "CSV de industria";

  return (
    <div className={`upload-slot upload-slot--${status}`}>
      <div className="upload-slot-head">
        <span className={`upload-slot-tag upload-slot-tag--${mentionType}`}>{mentionType}</span>
        <span className="upload-slot-title">{labelText}</span>
      </div>

      {status === "success" ? (
        <div className="upload-slot-success">
          <div className="upload-slot-check"><Icon name="check" size={20} /></div>
          <p className="upload-slot-msg">
            {stats ? `+${fmtNumber(stats.included)} menciones · ${fmtNumber(stats.duplicates)} duplicadas` : "CSV cargado"}
          </p>
          <p className="upload-slot-entity">{entityLabel}</p>
          <button className="btn-micro" onClick={() => fileRef.current?.click()} type="button">
            Reemplazar CSV
          </button>
        </div>
      ) : status === "uploading" ? (
        <>
          <div className="wizard-progress-bar">
            <span style={{ width: `${progress}%` }} />
          </div>
          <p className="upload-slot-msg">
            <Icon name="spinner" className="icon--spin" size={12} /> Procesando · {progress}%
          </p>
        </>
      ) : (
        <>
          {!entity && mentionType !== "brand" && (
            <div className="upload-entity-stack">
              {mentionType === "competitor" && competitors.length > 0 ? (
                <label className="upload-entity-field">
                  <span>Entidad competitiva</span>
                  <select
                    onChange={(event) => {
                      const value = event.target.value;
                      setCompetitorId(value === "__pool" || value === "__custom" ? "" : value);
                      if (value === "__pool") setEntityLabel("Pool competitivo");
                      if (value === "__custom") setEntityLabel("");
                      const selected = competitors.find((competitor) => competitor.id === value);
                      if (selected) setEntityLabel(selected.canonicalName);
                    }}
                    value={competitorId || (entityLabel === "Pool competitivo" ? "__pool" : "__custom")}
                  >
                    <option value="__pool">Pool competitivo</option>
                    {competitors.map((competitor) => (
                      <option key={competitor.id} value={competitor.id}>
                        {competitor.canonicalName}
                      </option>
                    ))}
                    <option value="__custom">Otro / etiqueta libre</option>
                  </select>
                </label>
              ) : null}
              <label className="upload-entity-field">
                <span>{mentionType === "competitor" ? "Etiqueta de entidad" : "Baseline"}</span>
                <input
                  maxLength={140}
                  onChange={(event) => {
                    setEntityLabel(event.target.value);
                    if (mentionType === "competitor" && competitorId) setCompetitorId("");
                  }}
                  placeholder={mentionType === "competitor" ? "Ej. Sephora, Amazon, pool premium" : "Ej. categoría beauty MX"}
                  type="text"
                  value={entityLabel}
                />
              </label>
            </div>
          )}
          <button
            className="upload-slot-drop"
            onClick={() => fileRef.current?.click()}
            type="button"
          >
            <span className="upload-slot-arrow"><Icon name="upload" size={22} /></span>
            Arrastra o haz click para seleccionar CSV
          </button>
        </>
      )}

      <input
        accept=".csv,text/csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.currentTarget.value = "";
        }}
        ref={fileRef}
        type="file"
      />

      {error && (
        <p className="upload-slot-error">
          <Icon name="alert" size={12} /> {error}
        </p>
      )}
    </div>
  );
}

type CsvIngestJobPollResult = {
  status?: string;
  progress?: number;
  worker_alive?: boolean;
  failed_reason?: string | null;
  result?: {
    stats?: {
      included_count?: number;
      excluded_count?: number;
      duplicate_count?: number;
    };
  } | null;
};

async function waitForCsvIngestJob(
  jobId: string,
  setProgress: (next: number | ((previous: number) => number)) => void
): Promise<CsvIngestJobPollResult> {
  for (;;) {
    await sleep(2500);
    const response = await fetch(`/api/jobs/${jobId}`);
    const job = await response.json().catch(() => ({})) as CsvIngestJobPollResult;
    if (!response.ok) return { status: "failed", failed_reason: "No se pudo leer el estado del job." };
    if (job.worker_alive === false) {
      return { status: "failed", failed_reason: "El worker no está activo para procesar esta ingesta." };
    }
    if (typeof job.progress === "number") {
      setProgress(Math.min(98, Math.max(20, Math.round(job.progress))));
    }
    if (job.status === "completed" || job.status === "failed") return job;
  }
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => window.setTimeout(resolvePromise, ms));
}

const evaluationStages = [
  {
    number: 1,
    label: "Preparar evidencia",
    detail: "Carga la iteración, el brief, Data OS y la trazabilidad de las importaciones.",
    activeAt: 1,
    doneAt: 25
  },
  {
    number: 2,
    label: "Tomar muestra por pack",
    detail: "Selecciona hasta 100 menciones importadas y vinculadas a cada query pack.",
    activeAt: 25,
    doneAt: 45
  },
  {
    number: 3,
    label: "Clasificar señal",
    detail: "Clasifica relevancia y ruido; el código calcula las métricas deterministas.",
    activeAt: 45,
    doneAt: 85
  },
  {
    number: 4,
    label: "Guardar diagnóstico",
    detail: "Persiste query, IDs importados, clasificaciones, métricas, linaje y versión.",
    activeAt: 85,
    doneAt: 100
  }
];

function normalizeProgress(progress: unknown) {
  return typeof progress === "number" && Number.isFinite(progress)
    ? Math.max(0, Math.min(100, Math.round(progress)))
    : 0;
}

function evaluationStageLabel(progress: number, status: string | null, queuedSeconds = 0) {
  if (status === "queued" || status === "waiting" || status === "delayed") {
    return queuedSeconds >= 8 ? "Esperando worker" : "En cola";
  }
  if (progress >= 85) return "Guardando diagnóstico";
  if (progress >= 45) return "Clasificando evidencia importada";
  if (progress >= 25) return "Tomando muestra por query pack";
  return "Preparando evaluación";
}

/* ============================================================
   STEP 3 — Evaluate imported evidence linked to each query pack
   ============================================================ */

function StepEvaluate({
  corpusId,
  iteration,
  queryPacks,
  onEvaluated,
}: {
  corpusId: string;
  iteration: Iteration;
  queryPacks: QueryPack[];
  onEvaluated: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [queuedSeconds, setQueuedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stableJobId = `evaluate-${iteration.id}`;

  const evidenceSampleTarget = 100;
  const minimumEvidenceSample = 25;
  const maximumEvidenceRows = queryPacks.length * evidenceSampleTarget;

  useEffect(() => {
    let cancelled = false;

    async function recoverRunningJob() {
      if (iteration.qualityScore !== null) return;
      try {
        const res = await fetch(`/api/jobs/${stableJobId}`);
        if (!res.ok) return;
        const state = (await res.json()) as JobState;
        if (cancelled) return;
        if (["queued", "waiting", "delayed", "running", "active"].includes(state.status)) {
          setJobId(state.id);
          setRunning(true);
          setJobStatus(state.status);
          setProgress(normalizeProgress(state.progress));
        }
      } catch {
        // No recoverable job exists yet. The user can start one.
      }
    }

    recoverRunningJob();
    return () => {
      cancelled = true;
    };
  }, [iteration.qualityScore, stableJobId]);

  useEffect(() => {
    if (!jobId || !running) return;

    const poll = window.setInterval(async () => {
      try {
        const jr = await fetch(`/api/jobs/${jobId}`);
        const j = (await jr.json()) as JobState;
        if (!jr.ok) {
          setError(j.failed_reason ?? "No se pudo leer el estado del job.");
          setRunning(false);
          return;
        }
        setJobStatus(j.status);
        setProgress((current) => Math.max(current, normalizeProgress(j.progress)));

        if (j.status === "completed") {
          window.clearInterval(poll);
          setProgress(100);
          setJobStatus("completed");
          setRunning(false);
          setTimeout(onEvaluated, 500);
        } else if (j.status === "failed") {
          window.clearInterval(poll);
          setError(j.failed_reason ?? "La evaluación falló.");
          setRunning(false);
        }
      } catch {
        setError("Se perdió la conexión con el job. Refresca para recuperar el estado.");
      }
    }, 1200);

    return () => window.clearInterval(poll);
  }, [jobId, onEvaluated, running]);

  useEffect(() => {
    if (!running || !["queued", "waiting", "delayed"].includes(jobStatus ?? "")) {
      setQueuedSeconds(0);
      return;
    }

    const timer = window.setInterval(() => setQueuedSeconds((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [jobStatus, running]);

  const start = useCallback(async () => {
    setRunning(true);
    setError(null);
    setJobStatus("queued");
    setProgress(5);

    const res = await fetch(
      `/api/corpora/${corpusId}/query-iterations/${iteration.id}/evaluate`,
      { method: "POST" }
    );
    const payload = await res.json();
    if (!res.ok) {
      setError(payload.message ?? "No se pudo iniciar la evaluación.");
      setRunning(false);
      return;
    }

    setJobId(payload.job_id ?? stableJobId);
  }, [corpusId, iteration.id, stableJobId]);

  return (
    <div className="step-body">
      <p className="step-helper">
        Esta es una <strong>evaluación posterior a la primera extracción</strong>, no el diagnóstico
        del corpus completo. El motor toma hasta <strong>{evidenceSampleTarget} menciones importadas
        por query pack</strong>, usa el brief y Data OS para clasificar relevancia y ruido, y exige
        al menos <strong>{minimumEvidenceSample} menciones únicas por pack</strong> para habilitar una
        decisión. No consulta ningún proveedor. El límite visible de esta ejecución es
        <strong> {fmtNumber(maximumEvidenceRows)} clasificaciones</strong>; Claude clasifica y el
        código calcula los scores.
      </p>

      <div className="pack-validation-list">
        {queryPacks.map((pack) => (
          <div className="pack-validation-row" key={pack.id}>
            <div>
              <strong>{pack.scope === "competitors" ? "Competidores" : pack.scope === "category" ? "Categoría" : "Marca"}</strong>
              <span>{pack.objective} · {fmtNumber(pack.linkedMentionCount ?? 0)} menciones importadas</span>
            </div>
            <span className={`pack-validation-status pack-validation-status--${packEvaluationStatus(pack)}`}>
              {packEvaluationStatus(pack).replaceAll("_", " ")}
            </span>
          </div>
        ))}
      </div>

      {!running && (
        <button className="wizard-cta" onClick={start} type="button">
          <Icon name="play" size={14} /> Evaluar evidencia importada
        </button>
      )}

      {running && (
        <div className="wizard-progress wizard-progress--detailed">
          <div className="wizard-progress-bar">
            <span style={{ width: `${progress}%` }} />
          </div>
          <p className="wizard-progress-text">
            <Icon name="spinner" className="icon--spin" size={12} /> {evaluationStageLabel(progress, jobStatus, queuedSeconds)} · {progress}%
          </p>
          <ol className="engine-job-steps">
            {evaluationStages.map((stage) => (
              <li
                className={
                  progress >= stage.doneAt
                    ? "engine-job-step engine-job-step--done"
                    : progress >= stage.activeAt
                      ? "engine-job-step engine-job-step--active"
                      : "engine-job-step"
                }
                key={stage.label}
              >
                <span>{progress >= stage.doneAt ? <Icon name="check" size={11} /> : stage.number}</span>
                <div>
                  <strong>{stage.label}</strong>
                  <p>{stage.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          {queuedSeconds >= 8 && ["queued", "waiting", "delayed"].includes(jobStatus ?? "") && (
            <p className="engine-job-worker-note">
              El job está esperando que el worker de query-engine lo tome. Si esto pasa de 30 segundos, probablemente el worker local no está corriendo.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="wizard-error">
          <Icon name="alert" size={14} /> {error}
        </p>
      )}
    </div>
  );
}

/* ============================================================
   STEP 3 — Close or refine candidate queries
   ============================================================ */

function StepDecide({
  corpusId,
  iteration,
  queryPacks,
  queryValidation,
  hasImportedCorpus,
  onActioned,
}: {
  corpusId: string;
  iteration: Iteration;
  queryPacks: QueryPack[];
  queryValidation: QueryValidation;
  hasImportedCorpus: boolean;
  onActioned: () => void;
}) {
  const notes = parseNotes(queryValidation?.summary);
  const adjustments = queryValidation?.contractCurrent
    ? normalizedAdjustments(queryValidation.attempts)
    : [];
  const [applying, setApplying] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestAttemptForPack = (packId: string) => queryValidation?.attempts
    .filter((attempt) => attempt.queryPackId === packId)
    .at(-1);
  const latestAttempts = queryPacks.flatMap((pack) => {
    const attempt = latestAttemptForPack(pack.id);
    return attempt ? [attempt] : [];
  });
  const packsReady = Boolean(
    queryValidation?.contractCurrent
      && queryValidation.status === "ready"
      && queryPacks.every((pack) => {
        const attempt = latestAttemptForPack(pack.id);
        const metrics = validationMetrics(attempt);
        return Boolean(
          attempt
          && attempt.attemptKind === "imported_evidence"
          && attempt.status === "ready"
          && attempt.queryText.trim() === (pack.queryText ?? "").trim()
          && attempt.sampleSize >= queryValidation.minimumEvidenceSample
          && attempt.uniqueSampleSize === attempt.sampleSize
          && metrics?.sampleSize === attempt.sampleSize
          && validationMetricsReady(metrics)
        );
      })
  );
  const queryClosed = iteration.insightsManagerDecision === "query_approved"
    || iteration.insightsManagerDecision === "approved";
  const importedEvidenceRows = latestAttempts.reduce(
    (total, attempt) => total + attempt.uniqueSampleSize,
    0
  );
  const classifiedEvidenceRows = latestAttempts.reduce(
    (total, attempt) => total + (validationMetrics(attempt) ? attempt.uniqueSampleSize : 0),
    0
  );
  const aggregateMetrics = latestAttempts.length === queryPacks.length
    ? aggregateValidationMetrics(latestAttempts)
    : null;
  const hasAggregateScores = Boolean(queryValidation?.contractCurrent && aggregateMetrics);
  const q = aggregateMetrics?.quality ?? 0;
  const d = aggregateMetrics?.density ?? 0;
  const n = aggregateMetrics?.noise ?? 0;
  const maximumValidationRows = queryPacks.length * (queryValidation?.evidenceSampleTarget ?? 100);
  const evidenceState = packsReady
    ? "Lista"
    : classifiedEvidenceRows > 0
      ? "Evaluada"
      : importedEvidenceRows > 0
        ? "Muestra insuficiente"
        : "Sin evaluar";

  async function apply() {
    setApplying(true);
    setError(null);
    const res = await fetch(
      `/api/corpora/${corpusId}/query-iterations/${iteration.id}/apply-adjustments`,
      { method: "POST" }
    );
    const payload = await res.json();
    if (!res.ok) {
      setError(payload.message ?? "No se pudo aplicar ajustes.");
      setApplying(false);
      return;
    }
    // Poll
    const jobId = payload.job_id;
    const poll = setInterval(async () => {
      const jr = await fetch(`/api/jobs/${jobId}`);
      const j = await jr.json();
      if (j.status === "completed") {
        clearInterval(poll);
        setApplying(false);
        onActioned();
      } else if (j.status === "failed") {
        clearInterval(poll);
        setError(j.failed_reason ?? "Falló la nueva iteración.");
        setApplying(false);
      }
    }, 1500);
  }

  async function revalidate() {
    setApplying(true);
    setError(null);
    const res = await fetch(
      `/api/corpora/${corpusId}/query-iterations/${iteration.id}/evaluate`,
      { method: "POST" }
    );
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(payload.message ?? "No se pudo evaluar la evidencia importada.");
      setApplying(false);
      return;
    }
    const poll = window.setInterval(async () => {
      const jr = await fetch(`/api/jobs/${payload.job_id}`);
      const job = await jr.json();
      if (job.status === "completed") {
        window.clearInterval(poll);
        setApplying(false);
        onActioned();
      } else if (job.status === "failed") {
        window.clearInterval(poll);
        setError(job.failed_reason ?? "Falló la evaluación de evidencia importada.");
        setApplying(false);
      }
    }, 1500);
  }

  async function closeQueries() {
    setClosing(true);
    setError(null);
    const res = await fetch(
      `/api/corpora/${corpusId}/query-iterations/${iteration.id}/approve`,
      { method: "POST" }
    );
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(payload.message ?? "No se pudieron conservar las queries evaluadas.");
      setClosing(false);
      return;
    }
    onActioned();
  }

  return (
    <div className="step-body">
      <div className="query-secondary-callout">
        <div>
          <p className="vitals-eyebrow">Validación posterior a extracción</p>
          <strong>La query se evalúa con lo que realmente recuperó</strong>
          <p>
            Noisia no consulta un proveedor ni adivina el potencial antes de ver evidencia. Cada
            score usa menciones importadas y vinculadas al query pack exacto; el diagnóstico del
            corpus completo permanece separado.
          </p>
        </div>
        <ol className="query-validation-sequence">
          <li><span>1</span><div><strong>Generar</strong><p>Crear una hipótesis booleana portable.</p></div></li>
          <li><span>2</span><div><strong>Importar</strong><p>Cargar una primera extracción por pack.</p></div></li>
          <li><span>3</span><div><strong>Evaluar</strong><p>Clasificar señal y calcular métricas reproducibles.</p></div></li>
          <li><span>4</span><div><strong>Decidir</strong><p>Conservar o crear una iteración ajustada.</p></div></li>
        </ol>
        <span className="query-validation-cap">Hasta {fmtNumber(maximumValidationRows)} menciones clasificadas en esta evaluación</span>
      </div>

      <details className="query-evidence-details" open>
        <summary>
          <div>
            <strong>Contrato y evidencia por pack</strong>
            <span>
              {importedEvidenceRows > 0
                ? `${fmtNumber(importedEvidenceRows)} importadas · ${fmtNumber(classifiedEvidenceRows)} clasificadas`
                : "Aún sin evidencia evaluada"}
            </span>
          </div>
          <span>{evidenceState}</span>
        </summary>

        <div className="query-evidence-content">
          <div className="query-evidence-summary">
        <div>
          <p className="vitals-eyebrow">Contrato de evidencia importada</p>
          <strong>¿La extracción de cada query contiene señal útil?</strong>
          <p>
            Cada pack conserva la query exacta, el batch de importación y los IDs de las menciones
            clasificadas. Una query queda lista con al menos {queryValidation?.minimumEvidenceSample ?? 25}
            menciones únicas y métricas aprobatorias. La decisión final sigue siendo del analista.
          </p>
        </div>
        <dl>
          <div><dt>Packs con evidencia</dt><dd>{latestAttempts.length}/{queryPacks.length}</dd></div>
          <div><dt>Importadas</dt><dd>{importedEvidenceRows}</dd></div>
          <div><dt>Evidencia clasificada</dt><dd>{classifiedEvidenceRows}</dd></div>
          <div><dt>Muestra objetivo</dt><dd>{queryValidation?.evidenceSampleTarget ?? 100} por pack</dd></div>
          <div><dt>Estado</dt><dd>{queryValidation?.approved ? "Aprobadas" : packsReady ? "Listas" : queryValidation?.contractCurrent ? "Requiere decisión" : "Reevaluar"}</dd></div>
        </dl>
          </div>

      {hasAggregateScores ? (
        <div className="query-potential-scoreboard">
          <div className="diag-scores">
            <ScoreOrb label="Calidad" value={q} good={q >= 7} bad={q <= 3} />
            <ScoreOrb label="Densidad" value={d} good={d >= 7} bad={d <= 3} />
            <ScoreOrb label="Ruido" value={n} good={n <= 3} bad={n >= 7} invert />
          </div>
          <p>
            Indicadores calculados sobre las muestras importadas de cada pack. Sirven para ajustar
            queries; no reemplazan la certificación revisionada del corpus completo.
          </p>
        </div>
      ) : (
        <div className="diag-technical-failure">
          <Icon name="alert" size={16} />
          <div>
            <strong>No hay un score global válido</strong>
            <p>Uno o más packs no tienen evidencia importada suficiente o una clasificación vigente. Noisia no sustituyó el resultado con valores ficticios.</p>
          </div>
        </div>
      )}

      <div className="pack-diagnostic-grid">
        {queryPacks.map((pack) => {
          const attempt = latestAttemptForPack(pack.id);
          const failureReason = packEvaluationFailureReason(pack);
          const metrics = validationMetrics(attempt);
          const minimumEvidence = queryValidation?.minimumEvidenceSample ?? 25;
          const evidenceTarget = queryValidation?.evidenceSampleTarget ?? 100;
          const importedCount = Number(pack.linkedMentionCount ?? 0);
          const queryIsCurrent = Boolean(
            attempt && attempt.queryText.trim() === (pack.queryText ?? "").trim()
          );
          const status = failureReason || attempt?.status === "failed"
            ? "failed"
            : attempt && attempt.uniqueSampleSize < minimumEvidence
              ? "insufficient_sample"
            : attempt?.status === "ready" && queryIsCurrent && validationMetricsReady(metrics)
            ? "ready"
            : metrics
              ? "needs_adjustment"
              : "pending";
          return (
            <article className={`pack-diagnostic pack-diagnostic--${status}`} key={pack.id}>
              <header>
                <div>
                  <span>{pack.scope === "competitors" ? "Competidores" : pack.scope === "category" ? "Categoría" : "Marca"}</span>
                  <strong>{queryPackIntentLabel(pack.scope, pack.signalIntent)}</strong>
                </div>
                <span className="pack-diagnostic-state">{queryPackEvidenceLabel(status)}</span>
              </header>
              {metrics ? (
                <dl>
                  <div><dt>Calidad</dt><dd>{metrics.quality.toFixed(1)}</dd></div>
                  <div><dt>Densidad</dt><dd>{metrics.density.toFixed(1)}</dd></div>
                  <div><dt>Ruido</dt><dd>{metrics.noise.toFixed(1)}</dd></div>
                  <div><dt>Población importada</dt><dd>{fmtNumber(importedCount)}</dd></div>
                  <div><dt>Muestra clasificada</dt><dd>{attempt?.uniqueSampleSize ?? 0}/{evidenceTarget}</dd></div>
                  <div><dt>Query vigente</dt><dd>{queryIsCurrent ? "Sí" : "No"}</dd></div>
                  <div className="pack-diagnostic-wide"><dt>Uso</dt><dd>Evalúa esta extracción; no certifica el corpus completo.</dd></div>
                </dl>
              ) : (
                <dl>
                  <div><dt>Importadas</dt><dd>{fmtNumber(importedCount)}</dd></div>
                  <div><dt>Mínimo requerido</dt><dd>{minimumEvidence}</dd></div>
                  <div className="pack-diagnostic-wide">
                    <dt>Resultado</dt>
                    <dd>{failureReason
                      ? failureReason
                      : importedCount < minimumEvidence
                        ? "Importa más evidencia para este pack antes de decidir. No hay score ni aprobación automática."
                        : "La evidencia aún no tiene una evaluación válida para la query vigente."}</dd>
                  </div>
                </dl>
              )}
            </article>
          );
        })}
      </div>

      {queryValidation?.contractCurrent && notes?.notes && (
        <div className="diag-notes">
          <p className="diag-notes-label">Diagnóstico sobre evidencia importada</p>
          <p className="diag-notes-text">{notes.notes}</p>
          {(notes.language_mx_pct !== undefined || notes.geo_mx_pct !== undefined) && (
            <p className="diag-notes-meta">
              Español MX: {notes.language_mx_pct ?? "—"}% · Geo MX: {notes.geo_mx_pct ?? "—"}%
            </p>
          )}
        </div>
      )}

      {adjustments.length > 0 && (
        <div className="diag-adjustments">
          <p className="diag-adj-label">Ajustes propuestos ({adjustments.length})</p>
          <ul className="diag-adj-list">
            {adjustments.slice(0, 5).map((a, i) => (
              <li key={i}>{a}</li>
            ))}
            {adjustments.length > 5 && (
              <li className="diag-adj-more">y {adjustments.length - 5} ajustes más…</li>
            )}
          </ul>
        </div>
      )}

      <div className="decide-actions">
        {packsReady && !queryClosed && (
          <button
            className="wizard-cta"
            disabled={closing || applying}
            onClick={closeQueries}
            type="button"
          >
            {closing ? (
              <><Icon name="spinner" className="icon--spin" size={14} /> Cerrando queries…</>
            ) : (
              <><Icon name="check" size={14} /> Conservar queries evaluadas</>
            )}
          </button>
        )}
        {adjustments.length > 0 && (
          <button
            className="wizard-cta"
            disabled={applying}
            onClick={apply}
            type="button"
          >
            {applying ? (
              <><Icon name="spinner" className="icon--spin" size={14} /> Generando iteración…</>
            ) : (
              <>
                <Icon name="refresh" size={14} />
                Crear iteración ajustada
              </>
            )}
          </button>
        )}
        {!packsReady && adjustments.length === 0 && (
          <button
            className="wizard-cta"
            disabled={applying}
            onClick={revalidate}
            type="button"
          >
            {applying ? (
              <><Icon name="spinner" className="icon--spin" size={14} /> Evaluando evidencia…</>
            ) : (
              <><Icon name="refresh" size={14} /> Reevaluar evidencia importada</>
            )}
          </button>
        )}
        {queryClosed && (
          <StatusPill tone="success"><Icon name="check" size={12} /> Queries evaluadas y conservadas</StatusPill>
        )}
        <p className="decide-hint">
          <Icon name="info" size={13} /> Una nueva iteración crea nuevos query packs y exige una
          extracción nueva; la evidencia no se hereda. {hasImportedCorpus
            ? "La extracción actual permanece ligada a esta iteración para conservar trazabilidad. "
            : ""}
          El diagnóstico del corpus de arriba evalúa por separado la revisión completa de menciones.
        </p>
      </div>

          <CommentReroll
            corpusId={corpusId}
            iterationId={iteration.id}
            onSent={onActioned}
          />

          {error && (
            <p className="wizard-error">
              <Icon name="alert" size={14} /> {error}
            </p>
          )}
        </div>
      </details>
    </div>
  );
}

/* ============================================================
   Comment + Reroll — analyst writes free-form instructions and
   re-issues apply-adjustments with `userComments` injected into the prompt.
   ============================================================ */

function CommentReroll({
  corpusId,
  iterationId,
  onSent,
}: {
  corpusId: string;
  iterationId: string;
  onSent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (text.trim().length === 0) return;
    setSending(true);
    setError(null);
    const res = await fetch(
      `/api/corpora/${corpusId}/query-iterations/${iterationId}/apply-adjustments`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_comments: text.trim() }),
      }
    );
    const payload = await res.json();
    if (!res.ok) {
      setError(payload.message ?? "No se pudo enviar.");
      setSending(false);
      return;
    }
    const jobId = payload.job_id;
    const poll = setInterval(async () => {
      const jr = await fetch(`/api/jobs/${jobId}`);
      const j = await jr.json();
      if (j.status === "completed") {
        clearInterval(poll);
        setText("");
        setOpen(false);
        setSending(false);
        onSent();
      } else if (j.status === "failed") {
        clearInterval(poll);
        setError(j.failed_reason ?? "El motor falló.");
        setSending(false);
      }
    }, 1500);
  }

  if (!open) {
    return (
      <button
        className="comment-toggle"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Icon name="pencil" size={13} /> Comentar las queries y regenerar
      </button>
    );
  }

  return (
    <div className="comment-reroll">
      <label className="comment-label">
        Instrucciones para el motor
        <textarea
          className="comment-textarea"
          placeholder="Ej: agrega frases como 'me cobraron de más' y excluye coincidencias de nombre sin relación con la marca."
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={sending}
        />
      </label>
      <p className="comment-helper">
        El motor prioriza estas instrucciones y crea una hipótesis booleana nueva. La evidencia
        de la iteración actual no se hereda a los nuevos query packs.
      </p>
      <div className="comment-actions">
        <button
          className="wizard-cta"
          disabled={sending || text.trim().length === 0}
          onClick={send}
          type="button"
        >
          {sending ? (
            <><Icon name="spinner" className="icon--spin" size={14} /> Aplicando comentarios…</>
          ) : (
            <><Icon name="refresh" size={14} /> Regenerar con comentarios</>
          )}
        </button>
        <button
          className="wizard-cta wizard-cta--ghost"
          disabled={sending}
          onClick={() => { setOpen(false); setText(""); }}
          type="button"
        >
          <Icon name="x" size={13} /> Cancelar
        </button>
      </div>
      {error && (
        <p className="wizard-error">
          <Icon name="alert" size={14} /> {error}
        </p>
      )}
    </div>
  );
}

function ScoreOrb({
  label,
  value,
  good,
  bad,
  invert,
}: {
  label: string;
  value: number;
  good: boolean;
  bad: boolean;
  invert?: boolean;
}) {
  const tone = good ? "good" : bad ? "bad" : "mid";
  return (
    <div className={`score-orb score-orb--${tone}`}>
      <span className="score-orb-value">{value.toFixed(1)}</span>
      <span className="score-orb-label">{label}{invert ? " ↓" : ""}</span>
    </div>
  );
}

/* ============================================================
   Approved state
   ============================================================ */

function ApprovedImproveState({
  corpusId,
  onContinued,
}: {
  corpusId: string;
  onContinued: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function startNewIteration() {
    setRunning(true);
    setError(null);
    setProgress(5);

    const res = await fetch(`/api/corpora/${corpusId}/run-engine`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ iteration_strategy: "auto", max_iterations: 5 }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setError(payload.message ?? "No se pudo iniciar la nueva iteración.");
      setRunning(false);
      return;
    }

    const jobId = payload.job_id;
    const poll = setInterval(async () => {
      const jr = await fetch(`/api/jobs/${jobId}`);
      const j = await jr.json();
      setProgress((p) => Math.max(p, j.progress ?? 0));
      if (j.status === "completed") {
        clearInterval(poll);
        setProgress(100);
        setTimeout(onContinued, 400);
      } else if (j.status === "failed") {
        clearInterval(poll);
        setError(j.failed_reason ?? "La generación falló.");
        setRunning(false);
      }
    }, 1500);
  }

  return (
    <div className="step-body approved-state">
      <div className="approved-mark"><Icon name="check" size={28} /></div>
      <h3>Corpus aprobado · puedes seguir enriqueciéndolo</h3>
      <p>
        El snapshot del estado aprobado quedó guardado — puedes restaurarlo cuando
        quieras desde Snapshots. Si quieres meter más menciones para subir la
        densidad de señal, abre una nueva ronda. El generador usará el Brand OS, el brief,
        las fuentes de Data OS y el historial de queries; cada candidato volverá a probarse
        con la fuente de listening antes de quedar listo para extracción.
      </p>

      {!running && (
        <button className="wizard-cta" onClick={startNewIteration} type="button">
          <Icon name="sparkle" size={14} /> Continuar iterando · nueva query
        </button>
      )}

      {running && (
        <div className="wizard-progress">
          <div className="wizard-progress-bar"><span style={{ width: `${progress}%` }} /></div>
          <p className="wizard-progress-text">
            <Icon name="spinner" className="icon--spin" size={12} /> Generando nueva iteración · {progress}%
          </p>
        </div>
      )}

      {error && (
        <p className="wizard-error">
          <Icon name="alert" size={14} /> {error}
        </p>
      )}
    </div>
  );
}

/* ============================================================
   History (collapsed)
   ============================================================ */

function IterationHistory({ iterations }: { iterations: Iteration[] }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="history" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="history-summary">
        <span>Historial · {iterations.length} {iterations.length === 1 ? "iteración" : "iteraciones"}</span>
        <span className={`history-chev${open ? " history-chev--open" : ""}`}>
          <Icon name="chevron-down" size={16} />
        </span>
      </summary>
      <div className="history-list">
        {iterations.map((iter) => {
          const evaluated = iter.qualityScore !== null;
          const decision = iter.insightsManagerDecision;
          return (
            <div className="history-item" key={iter.id}>
              <span className="history-num">#{iter.iterationNumber}</span>
              <div className="history-meta">
                {evaluated ? (
                  <>
                    <span className="history-score">Q {Number(iter.qualityScore).toFixed(1)}</span>
                    <span className="history-score">D {Number(iter.densityScore).toFixed(1)}</span>
                    <span className="history-score">N {Number(iter.noiseScore).toFixed(1)}</span>
                  </>
                ) : (
                  <span className="history-pending">sin evaluar</span>
                )}
                {decision === "approved" && <span className="history-tag history-tag--good">aprobada</span>}
              </div>
              <div className="history-query" title={iter.queryText}>
                {iter.queryText.slice(0, 70)}…
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}

/* ============================================================
   Corpus-level readiness — meta-evaluator over the full corpus.
   ============================================================ */

const VERDICT_TONE: Record<
  Assessment["verdict"],
  { label: string; tone: "success" | "warn" | "error" }
> = {
  ready: { label: "Listo para estudio", tone: "success" },
  needs_more_signal: { label: "Falta señal", tone: "warn" },
  needs_more_volume: { label: "Falta volumen", tone: "warn" },
  corpus_too_noisy: { label: "Demasiado ruido", tone: "error" },
};

function fmtAssessedAt(date: Date | string): string {
  const d = new Date(date);
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

function CorpusAssessmentPanel({
  corpusId,
  totalIncluded,
  assessment,
  assessedAt,
  corpusRevision,
  latestAssessedRevision,
  assessmentCurrent,
  isApproved,
  iterationCount,
}: {
  corpusId: string;
  totalIncluded: number;
  assessment: Assessment | null;
  assessedAt: Date | string | null;
  corpusRevision: number;
  latestAssessedRevision: number | null;
  assessmentCurrent: boolean;
  isApproved: boolean;
  iterationCount: number;
}) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [noisePreview, setNoisePreview] = useState<NoiseCleanupPreview | null>(null);
  const [noiseBusy, setNoiseBusy] = useState<"preview" | "apply" | null>(null);
  const router = useRouter();

  async function previewNoiseCleanup() {
    setNoiseBusy("preview");
    setError(null);
    try {
      const res = await fetch(`/api/corpora/${corpusId}/assessment-noise`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "preview", expected_revision: corpusRevision }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.message ?? "No se pudo preparar la exclusión del ruido.");
        return;
      }
      setNoisePreview(json.impact as NoiseCleanupPreview);
    } catch {
      setError("No se pudo preparar la exclusión del ruido.");
    } finally {
      setNoiseBusy(null);
    }
  }

  async function applyNoiseCleanup() {
    if (!noisePreview) return;
    setNoiseBusy("apply");
    setError(null);
    try {
      const res = await fetch(`/api/corpora/${corpusId}/assessment-noise`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "apply", expected_revision: noisePreview.corpus_revision }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.message ?? "No se pudo excluir el ruido diagnosticado.");
        return;
      }
      setNoisePreview(null);
      router.refresh();
    } catch {
      setError("No se pudo excluir el ruido diagnosticado.");
    } finally {
      setNoiseBusy(null);
    }
  }

  async function approve() {
    setApproving(true);
    setError(null);
    const res = await fetch(`/api/corpora/${corpusId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        override: assessment?.ready_for_study !== true,
        override_reason: assessment?.ready_for_study === true ? undefined : overrideReason.trim(),
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json?.message ?? "No se pudo aprobar el corpus.");
      setApproving(false);
      return;
    }
    setApproving(false);
    router.refresh();
  }

  async function run() {
    setRunning(true);
    setError(null);
    setNoisePreview(null);
    setProgress(5);
    const res = await fetch(`/api/corpora/${corpusId}/assess`, { method: "POST" });
    const payload = await res.json();
    if (!res.ok) {
      setError(payload.message ?? "No se pudo iniciar el diagnóstico.");
      setRunning(false);
      return;
    }
    const jobId = payload.job_id;
    const poll = setInterval(async () => {
      const jr = await fetch(`/api/jobs/${jobId}`);
      const j = await jr.json();
      setProgress(Math.max(progress, j.progress ?? 0));
      if (j.status === "completed") {
        clearInterval(poll);
        setProgress(100);
        setTimeout(() => {
          setRunning(false);
          router.refresh();
        }, 400);
      } else if (j.status === "failed") {
        clearInterval(poll);
        setError(j.failed_reason ?? "El diagnóstico falló.");
        setRunning(false);
      }
    }, 1500);
  }

  const v = assessment ? VERDICT_TONE[assessment.verdict] : null;
  const assessmentStale = Boolean(assessment && !assessmentCurrent);
  const canApprove = !isApproved && assessmentCurrent && Boolean(assessment);
  const approveIsPrimary = assessmentCurrent && assessment?.ready_for_study === true;
  const overrideRequired = canApprove && !approveIsPrimary;
  const classifiedSize = assessment?.metrics?.classified_size ?? assessment?.sample_size ?? 0;
  const populationSize = assessment?.metrics?.population_size
    ?? assessment?.population_size
    ?? totalIncluded;
  const classifiedAll = assessment?.metrics?.full_population_classified
    ?? assessment?.sample_strategy === "full_population";
  const canOfferNoiseCleanup = Boolean(
    !isApproved
    && assessmentCurrent
    && assessment
    && classifiedAll
    && assessment.coverage.noise_pct > 0
  );

  return (
    <section className="corpus-assess">
      <header className="corpus-assess-head">
        <div>
          <div className="wizard-card-eyebrow-row">
            <p className="corpus-assess-eyebrow">
              {isApproved ? "Corpus aprobado" : "Diagnóstico del corpus"}
            </p>
            {isApproved && <SuccessPill>Aprobado</SuccessPill>}
            {!isApproved && assessmentStale && (
              <StatusPill tone="warn">
                <Icon name="refresh" size={12} /> Revisión anterior
              </StatusPill>
            )}
            {!isApproved && assessmentCurrent && v && (
              <StatusPill tone={v.tone}>
                <Icon name={v.tone === "success" ? "check" : v.tone === "error" ? "x" : "alert"} size={12} />
                {v.label}
              </StatusPill>
            )}
            {!isApproved && !assessmentCurrent && !assessmentStale && totalIncluded > 0 && (
              <StatusPill tone="idle">
                <Icon name="info" size={12} /> Sin evaluar r{corpusRevision}
              </StatusPill>
            )}
          </div>
          <h3 className="corpus-assess-title">
            {isApproved
              ? "Listo para análisis cultural"
              : assessmentStale
                ? "El corpus cambió: vuelve a diagnosticar"
                : assessmentCurrent
                  ? v?.label
                  : `Certificar revisión r${corpusRevision} sobre ${fmtNumber(totalIncluded)} menciones`}
          </h3>
          {assessment && assessedAt && (
            <p className="corpus-assess-meta">
              Revisión r{latestAssessedRevision ?? assessment.corpus_revision ?? "—"} ·{" "}
              {fmtNumber(classifiedSize)} de {fmtNumber(populationSize)} clasificadas ·{" "}
              {classifiedAll ? "población completa" : "muestra estratificada determinista"} ·{" "}
              cobertura del diagnóstico {assessment.confidence}% · {fmtAssessedAt(assessedAt)}
            </p>
          )}
        </div>
        <div className="corpus-assess-actions">
          <button
            className="wizard-cta wizard-cta--secondary"
            disabled={running || approving || noiseBusy !== null}
            onClick={run}
            type="button"
          >
            {running ? (
              <><Icon name="spinner" className="icon--spin" size={14} /> Diagnosticando · {progress}%</>
            ) : assessmentCurrent ? (
              <><Icon name="refresh" size={14} /> Re-diagnosticar r{corpusRevision}</>
            ) : (
              <><Icon name="sparkle" size={14} /> Diagnosticar revisión r{corpusRevision}</>
            )}
          </button>
          {canApprove && (
            <button
              className={`wizard-cta${approveIsPrimary ? "" : " wizard-cta--secondary"}`}
              disabled={approving || running || noiseBusy !== null}
              onClick={() => {
                if (overrideRequired && !overrideOpen) {
                  setOverrideOpen(true);
                  return;
                }
                void approve();
              }}
              type="button"
              title={
                approveIsPrimary
                  ? "El motor recomienda aprobar"
                  : "Aprobar aún sabiendo que el corpus tiene huecos. El Insights Manager decide."
              }
            >
              {approving ? (
                <><Icon name="spinner" className="icon--spin" size={14} /> Aprobando…</>
              ) : approveIsPrimary ? (
                <><Icon name="star" size={14} /> Aprobar corpus</>
              ) : (
                <><Icon name="alert" size={14} /> Solicitar excepción</>
              )}
            </button>
          )}
        </div>
      </header>

      {overrideOpen && overrideRequired && (
        <div className="corpus-override-form">
          <div>
            <strong>Aprobación con excepción</strong>
            <p>Este corpus no cumple el gate vigente. La razón quedará guardada en el snapshot de aprobación.</p>
          </div>
          <label htmlFor={`override-reason-${corpusId}`}>Razón de la excepción</label>
          <textarea
            id={`override-reason-${corpusId}`}
            maxLength={1_000}
            onChange={(event) => setOverrideReason(event.target.value)}
            placeholder="Describe qué limitación aceptas, por qué el estudio puede continuar y cómo deberá leerse el resultado."
            rows={3}
            value={overrideReason}
          />
          <div className="corpus-override-actions">
            <button
              className="wizard-cta wizard-cta--secondary"
              onClick={() => {
                setOverrideOpen(false);
                setOverrideReason("");
              }}
              type="button"
            >
              Cancelar
            </button>
            <button
              className="wizard-cta"
              disabled={approving || overrideReason.trim().length < 20}
              onClick={() => void approve()}
              type="button"
            >
              {approving ? (
                <><Icon name="spinner" className="icon--spin" size={14} /> Aprobando…</>
              ) : (
                <><Icon name="check" size={14} /> Aprobar con excepción</>
              )}
            </button>
          </div>
        </div>
      )}

      {running && (
        <div className="wizard-progress-bar">
          <span style={{ width: `${progress}%` }} />
        </div>
      )}

      {!assessmentCurrent && !assessmentStale && !running && (
        <p className="corpus-assess-helper">
          {totalIncluded <= 5_000
            ? `El motor clasifica las ${fmtNumber(totalIncluded)} menciones incluidas de esta revisión. Ese es el límite operativo de esta corrida.`
            : "El motor toma una muestra estratificada determinista de hasta 2,000 menciones, preservando plataforma, mes y query pack. Ese es el límite operativo de esta corrida."}{" "}
          Esta certificación es independiente de la evaluación por query pack y representa la
          revisión actual del corpus completo.
        </p>
      )}

      {assessmentStale && !running && (
        <p className="approved-caveat">
          <Icon name="alert" size={13} /> El diagnóstico disponible corresponde a la revisión r
          {latestAssessedRevision ?? assessment?.corpus_revision ?? "—"}. La revisión actual es r
          {corpusRevision}; debe evaluarse nuevamente antes de aprobar.
        </p>
      )}

      {assessment && assessmentCurrent && (
        <>
          <div className="coverage-bars">
            <CoverageBar label="Triggers" pct={assessment.coverage.trigger_signal_pct} tone="good" />
            <CoverageBar label="Barriers" pct={assessment.coverage.barrier_signal_pct} tone="good" />
            <CoverageBar label="Experiencia" pct={assessment.coverage.experience_signal_pct} tone="good" />
            <CoverageBar label="Ruido" pct={assessment.coverage.noise_pct} tone="bad" />
          </div>

          {canOfferNoiseCleanup && (
            <div className={`corpus-noise-cleanup${noisePreview ? " corpus-noise-cleanup--confirm" : ""}`}>
              {!noisePreview ? (
                <>
                  <div className="corpus-noise-cleanup-copy">
                    <strong>Excluir las menciones clasificadas como ruido</strong>
                    <p>
                      Usa exactamente la clasificación de la revisión r{corpusRevision}. No borra
                      registros: los excluye del corpus activo con trazabilidad y reversa desde Historial.
                    </p>
                  </div>
                  <button
                    className="wizard-cta wizard-cta--secondary"
                    disabled={noiseBusy !== null || running || approving}
                    onClick={() => void previewNoiseCleanup()}
                    type="button"
                  >
                    {noiseBusy === "preview" ? (
                      <><Icon name="spinner" className="icon--spin" size={14} /> Calculando impacto…</>
                    ) : (
                      <><Icon name="trash" size={14} /> Revisar exclusión</>
                    )}
                  </button>
                </>
              ) : (
                <>
                  <div className="corpus-noise-cleanup-copy">
                    <strong>Confirma la limpieza de la revisión r{noisePreview.corpus_revision}</strong>
                    <p>
                      La cobertura es completa, pero no implica que la clasificación sea infalible.
                      Los registros crudos permanecerán intactos y esta acción podrá revertirse.
                    </p>
                  </div>
                  <dl className="corpus-noise-impact">
                    <div>
                      <dt>Se excluirán</dt>
                      <dd>{fmtNumber(noisePreview.excluded_count)}</dd>
                    </div>
                    <div>
                      <dt>Quedarán activas</dt>
                      <dd>{fmtNumber(noisePreview.retained_count)}</dd>
                    </div>
                    <div>
                      <dt>Ruido diagnosticado</dt>
                      <dd>{noisePreview.noise_percentage}%</dd>
                    </div>
                  </dl>
                  <p className="corpus-noise-revision-note">
                    Al aplicar se creará la revisión r{noisePreview.corpus_revision + 1} y será
                    necesario volver a diagnosticarla antes de aprobar.
                  </p>
                  <div className="corpus-noise-cleanup-actions">
                    <button
                      className="wizard-cta wizard-cta--secondary"
                      disabled={noiseBusy !== null}
                      onClick={() => setNoisePreview(null)}
                      type="button"
                    >
                      Cancelar
                    </button>
                    <button
                      className="wizard-cta wizard-cta--danger"
                      disabled={noiseBusy !== null}
                      onClick={() => void applyNoiseCleanup()}
                      type="button"
                    >
                      {noiseBusy === "apply" ? (
                        <><Icon name="spinner" className="icon--spin" size={14} /> Excluyendo…</>
                      ) : (
                        <><Icon name="trash" size={14} /> Excluir {fmtNumber(noisePreview.excluded_count)} como ruido</>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {assessment.recommendation && (
            <p className="corpus-assess-reco">{assessment.recommendation}</p>
          )}

          {(assessment.signals_well_covered.length > 0 || assessment.signals_missing.length > 0) && (
            <div className="signals-grid">
              {assessment.signals_well_covered.length > 0 && (
                <div>
                  <p className="signals-label signals-label--good">
                    <Icon name="check" size={12} /> Bien cubiertos
                  </p>
                  <ul className="signals-list">
                    {assessment.signals_well_covered.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {assessment.signals_missing.length > 0 && (
                <div>
                  <p className="signals-label signals-label--bad">
                    <Icon name="x" size={12} /> Faltantes
                  </p>
                  <ul className="signals-list">
                    {assessment.signals_missing.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

        </>
      )}

      {/* When approved, render a concise reality-based summary instead of a
          generic "everything is perfect" celebration. */}
      {isApproved && (
        <div className="approved-summary">
          <p className="approved-summary-lede">
            El Insights Manager aprobó este corpus para análisis cultural.{" "}
            {iterationCount > 0 && (
              <>
                Tomó <strong>{iterationCount}</strong>{" "}
                {iterationCount === 1 ? "iteración" : "iteraciones"}.
              </>
            )}
          </p>
          <dl className="approved-stats">
            <div>
              <dt>Revisión aprobada</dt>
              <dd>r{latestAssessedRevision ?? corpusRevision}</dd>
            </div>
            <div>
              <dt>Menciones clasificadas</dt>
              <dd>{fmtNumber(classifiedSize)} / {fmtNumber(populationSize)}</dd>
            </div>
            {assessment && assessmentCurrent && (
              <>
                <div>
                  <dt>Veredicto del motor</dt>
                  <dd>{VERDICT_TONE[assessment.verdict].label}</dd>
                </div>
                <div>
                  <dt>Cobertura del diagnóstico</dt>
                  <dd>{assessment.confidence}%</dd>
                </div>
              </>
            )}
          </dl>
          {assessment && assessmentCurrent && assessment.signals_missing.length > 0 && (
            <p className="approved-caveat">
              <Icon name="info" size={13} /> El motor identificó {assessment.signals_missing.length}{" "}
              {assessment.signals_missing.length === 1 ? "señal" : "señales"} sin cubrir al cierre.
              El análisis tomará en cuenta esa limitación.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="wizard-error">
          <Icon name="alert" size={14} /> {error}
        </p>
      )}
    </section>
  );
}

function CoverageBar({
  label,
  pct,
  tone,
}: {
  label: string;
  pct: number;
  tone: "good" | "bad";
}) {
  const safe = Math.max(0, Math.min(100, pct));
  return (
    <div className="coverage-bar">
      <div className="coverage-bar-head">
        <span className="coverage-bar-label">{label}</span>
        <span className="coverage-bar-value">{safe}%</span>
      </div>
      <div className="coverage-bar-track">
        <span className={`coverage-bar-fill coverage-bar-fill--${tone}`} style={{ width: `${safe}%` }} />
      </div>
    </div>
  );
}

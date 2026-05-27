"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  CorpusMaintenancePanel,
  type CleanupAction,
  type Snapshot,
} from "@/components/engine/CorpusMaintenancePanel";
import { CopyQueryButton } from "@/components/engine/CopyQueryButton";
import { Icon } from "@/components/ui/Icon";
import { StatusPill, SuccessPill } from "@/components/ui/StatusPill";

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
  mentionType: string | null;
  recordCount: number | null;
  includedCount: number | null;
  excludedCount: number | null;
  sourceFileName: string | null;
  status: string;
  createdAt: Date | string;
};

type CorpusCounts = {
  total: number;
  included: number;
  excluded: number;
  pending: number;
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
  model?: string;
};

type WizardProps = {
  corpusId: string;
  corpusName: string;
  methodologyName: string | null;
  corpus: CorpusCounts;
  iterations: Iteration[];
  batches: Batch[];
  current: Iteration | null;
  activeStep: Step;
  isApproved: boolean;
  readyToApprove: boolean;
  assessment: Assessment | null;
  assessedAt: Date | string | null;
  snapshots: Snapshot[];
  cleanups: CleanupAction[];
};

type EvalNotes = {
  notes?: string;
  proposed_adjustments?: string[];
  language_mx_pct?: number;
  geo_mx_pct?: number;
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

/* ============================================================
   Main Wizard
   ============================================================ */

export function EngineWizard(props: WizardProps) {
  const router = useRouter();
  const {
    corpusId,
    corpusName,
    methodologyName,
    corpus,
    iterations,
    batches,
    current,
    activeStep: serverActiveStep,
    isApproved,
    readyToApprove,
    assessment,
    assessedAt,
    snapshots,
    cleanups,
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

  return (
    <div className="wizard-shell">
      {/* Vital signs header */}
      <CorpusVitals
        name={corpusName}
        methodology={methodologyName}
        counts={corpus}
        iterationCount={iterations.length}
        latestQuality={current?.qualityScore ? Number(current.qualityScore) : null}
        readyToApprove={readyToApprove || (assessment?.ready_for_study ?? false)}
        isApproved={isApproved}
      />

      {/* Corpus-level readiness — independent of per-iteration eval.
          Stays visible after approval too so the IM can see the snapshot. */}
      {(corpus.included >= 1000 || assessment) && (
        <CorpusAssessmentPanel
          corpusId={corpusId}
          totalIncluded={corpus.included}
          assessment={assessment}
          assessedAt={assessedAt}
          isApproved={isApproved}
          latestQuality={current?.qualityScore ? Number(current.qualityScore) : null}
          iterationCount={iterations.length}
        />
      )}

      {/* Maintenance — only visible once there's something to maintain */}
      {corpus.included >= 100 && (
        <CorpusMaintenancePanel
          corpusId={corpusId}
          totalIncluded={corpus.included}
          snapshots={snapshots}
          cleanups={cleanups}
        />
      )}

      {/* Main card */}
      <article className="wizard-card">
        <header className="wizard-card-head">
          <div>
            <div className="wizard-card-eyebrow-row">
              <p className="wizard-iter-label">
                {activeStep === "approved"
                  ? "Iteración cerrada · corpus aprobado"
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
                  current.qualityScore && Number(current.qualityScore) >= 7 ? (
                    <SuccessPill>Alta calidad</SuccessPill>
                  ) : (
                    <StatusPill tone="warn"><Icon name="alert" size={12} /> Requiere ajustes</StatusPill>
                  )
                ) : (
                  <StatusPill tone="info"><Icon name="upload" size={12} /> Esperando CSVs</StatusPill>
                )
              )}
            </div>
            <h2 className="wizard-iter-title">
              {activeStep === "approved"
                ? "Sigue iterando para subir la densidad"
                : isApproved
                  ? "Iteración post-aprobación · más menciones al corpus"
                  : current?.qualityScore
                    ? "Diagnóstico listo · decide el siguiente paso"
                    : "Generar, ingerir y evaluar"}
            </h2>
          </div>
          {activeStep !== "approved" && (
            <StepIndicator
              steps={[
                { id: "compose", label: "Generar" },
                { id: "upload", label: "Ingerir" },
                { id: "evaluate", label: "Evaluar" },
                { id: "decide", label: "Decidir" },
              ]}
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
              onComplete={() => {
                router.refresh();
                setActiveStep("evaluate");
              }}
            />
          ) : activeStep === "evaluate" ? (
            <StepEvaluate
              corpusId={corpusId}
              iteration={current}
              corpusTotal={corpus.included}
              onEvaluated={() => {
                router.refresh();
                setActiveStep("decide");
              }}
            />
          ) : (
            <StepDecide
              corpusId={corpusId}
              iteration={current}
              readyToApprove={readyToApprove}
              onActioned={() => router.refresh()}
            />
          )}
        </div>
      </article>

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
  latestQuality,
  readyToApprove,
  isApproved,
}: {
  name: string;
  methodology: string | null;
  counts: CorpusCounts;
  iterationCount: number;
  latestQuality: number | null;
  readyToApprove: boolean;
  isApproved: boolean;
}) {
  const banner: { text: string; icon: "check" | "star" | "wave" | "info"; tone: "neutral" | "warn" | "good" } = isApproved
    ? { text: "Corpus aprobado", icon: "check", tone: "good" }
    : readyToApprove
      ? { text: "Listo para aprobar", icon: "star", tone: "good" }
      : iterationCount === 0
        ? { text: "Empieza generando la primera query", icon: "info", tone: "neutral" }
        : { text: "Sigue iterando para subir calidad", icon: "wave", tone: "warn" };

  return (
    <header className="vitals">
      <div className="vitals-main">
        <p className="vitals-eyebrow">{methodology ?? "Corpus"}</p>
        <h1 className="vitals-name">{name}</h1>
      </div>
      <div className="vitals-stats">
        <Stat label="Menciones" value={fmtNumber(counts.included)} sub={`${fmtNumber(counts.total)} totales`} highlight />
        <Stat label="Excluidas" value={fmtNumber(counts.excluded)} sub="filtradas" />
        <Stat label="Iteraciones" value={String(iterationCount)} sub={iterationCount === 1 ? "ronda" : "rondas"} />
        <Stat
          label="Calidad"
          value={latestQuality !== null ? `${latestQuality.toFixed(1)}` : "—"}
          sub="última"
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
    const poll = setInterval(async () => {
      const jr = await fetch(`/api/jobs/${jobId}`);
      const j = await jr.json();
      setProgress(Math.max(progress, j.progress ?? 0));
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
        El motor compone <strong>dos queries booleanas</strong> a partir de los seeds de
        marca, competidores y el manifest de metodología. Las dos queries miden lo mismo
        desde ángulos opuestos — la de marca da precisión, la de industria da cobertura.
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
   STEP 2 — Upload (dual CSV)
   ============================================================ */

function StepUpload({
  corpusId,
  iteration,
  existingBatches,
  onComplete,
}: {
  corpusId: string;
  iteration: Iteration;
  existingBatches: Batch[];
  onComplete: () => void;
}) {
  const wantsIndustry = !!iteration.industryQueryText;
  const wantsCompetitor = !!iteration.competitorQueryText;
  const brandDone = existingBatches.some(
    (b) => b.mentionType === "brand" && b.status === "completed"
  );
  const competitorDone = existingBatches.some(
    (b) => b.mentionType === "competitor" && b.status === "completed"
  );
  const industryDone = existingBatches.some(
    (b) => b.mentionType === "industry" && b.status === "completed"
  );
  const allDone = brandDone && (!wantsCompetitor || competitorDone) && (!wantsIndustry || industryDone);

  // The button only appears once both required CSVs have been uploaded
  useEffect(() => {
    if (allDone) {
      // tiny delay to let the success animation breathe
      const t = setTimeout(onComplete, 600);
      return () => clearTimeout(t);
    }
  }, [allDone, onComplete]);

  return (
    <div className="step-body">
      <p className="step-helper">
        Copia cada query en SentiOne, exporta los CSVs y súbelos aquí. Cada archivo
        suma menciones únicas al corpus (los duplicados se filtran automáticamente).
      </p>

      <div className="wizard-queries">
        <QueryBlock
          label="Query de marca"
          accent="brand"
          text={iteration.queryText}
        />
        {iteration.competitorQueryText && (
          <QueryBlock
            label="Query de competencia"
            accent="competitor"
            text={iteration.competitorQueryText}
          />
        )}
        {iteration.industryQueryText && (
          <QueryBlock
            label="Query de industria"
            accent="industry"
            text={iteration.industryQueryText}
          />
        )}
      </div>

      <div className={`upload-grid${wantsIndustry || wantsCompetitor ? "" : " upload-grid--single"}`}>
        <UploadSlot
          corpusId={corpusId}
          iterationId={iteration.id}
          mentionType="brand"
          done={brandDone}
        />
        {wantsCompetitor && (
          <UploadSlot
            corpusId={corpusId}
            iterationId={iteration.id}
            mentionType="competitor"
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

      {allDone && (
        <p className="wizard-success-hint">
          <Icon name="check" size={14} /> CSVs listos · pasando a evaluación…
        </p>
      )}
    </div>
  );
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
  done,
}: {
  corpusId: string;
  iterationId: string;
  mentionType: "brand" | "competitor" | "industry";
  done: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">(
    done ? "success" : "idle"
  );
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

    const fd = new FormData();
    fd.append("file", file);
    fd.append("mention_type", mentionType);
    fd.append("query_iteration_id", iterationId);
    fd.append("source_label", `iter_${mentionType}`);

    // Fake progressive feedback while server processes
    const tick = setInterval(() => {
      setProgress((p) => (p < 88 ? p + 4 : p));
    }, 400);

    try {
      const res = await fetch(`/api/corpora/${corpusId}/mentions/csv-upload`, {
        method: "POST",
        body: fd,
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

const evaluationStages = [
  {
    number: 1,
    label: "Preparar contexto",
    detail: "Carga iteración, brief, metodología y configuración del corpus.",
    activeAt: 1,
    doneAt: 25
  },
  {
    number: 2,
    label: "Tomar muestra",
    detail: "Selecciona menciones incluidas del corpus completo.",
    activeAt: 25,
    doneAt: 45
  },
  {
    number: 3,
    label: "Leer señal",
    detail: "Claude evalúa calidad, densidad, ruido y cobertura.",
    activeAt: 45,
    doneAt: 85
  },
  {
    number: 4,
    label: "Guardar diagnóstico",
    detail: "Persiste scores, notas y ajustes propuestos.",
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
  if (progress >= 45) return "Analizando señal con Claude";
  if (progress >= 25) return "Tomando muestra";
  return "Preparando evaluación";
}

/* ============================================================
   STEP 3 — Evaluate
   ============================================================ */

function StepEvaluate({
  corpusId,
  iteration,
  corpusTotal,
  onEvaluated,
}: {
  corpusId: string;
  iteration: Iteration;
  corpusTotal: number;
  onEvaluated: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [queuedSeconds, setQueuedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stableJobId = `evaluate-${iteration.id}`;

  // Estimated sample size for the UI
  const sampleSize = iteration.iterationNumber >= 7 ? 500 : iteration.iterationNumber >= 4 ? 250 : 100;
  const samplePct = corpusTotal > 0 ? Math.min(100, Math.round((sampleSize / corpusTotal) * 100)) : 0;

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

  async function start() {
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
  }

  return (
    <div className="step-body">
      <p className="step-helper">
        El motor leerá una muestra aleatoria de <strong>{fmtNumber(sampleSize)} menciones</strong>{" "}
        del corpus completo {corpusTotal > 0 && <>(~{samplePct}% de las {fmtNumber(corpusTotal)} válidas)</>}{" "}
        y diagnosticará calidad, densidad de señal y nivel de ruido. Te dará ajustes
        concretos al query.
      </p>

      {!running && (
        <button className="wizard-cta" onClick={start} type="button">
          <Icon name="play" size={14} /> Evaluar muestra
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
   STEP 4 — Decide
   ============================================================ */

function StepDecide({
  corpusId,
  iteration,
  onActioned,
}: {
  corpusId: string;
  iteration: Iteration;
  readyToApprove: boolean;
  onActioned: () => void;
}) {
  const notes = parseNotes(iteration.aiEvaluationNotes);
  const adjustments = notes?.proposed_adjustments ?? [];
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = Number(iteration.qualityScore ?? 0);
  const d = Number(iteration.densityScore ?? 0);
  const n = Number(iteration.noiseScore ?? 0);

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
        onActioned();
      } else if (j.status === "failed") {
        clearInterval(poll);
        setError(j.failed_reason ?? "Falló la nueva iteración.");
        setApplying(false);
      }
    }, 1500);
  }

  return (
    <div className="step-body">
      <div className="diag-scores">
        <ScoreOrb label="Calidad" value={q} good={q >= 7} bad={q <= 3} />
        <ScoreOrb label="Densidad" value={d} good={d >= 7} bad={d <= 3} />
        <ScoreOrb label="Ruido" value={n} good={n <= 3} bad={n >= 7} invert />
      </div>

      {notes?.notes && (
        <div className="diag-notes">
          <p className="diag-notes-label">Diagnóstico</p>
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
              <><Icon name="refresh" size={14} /> Aplicar ajustes y reiterar</>
            )}
          </button>
        )}
        <p className="decide-hint">
          <Icon name="info" size={13} /> La aprobación del corpus vive en el diagnóstico
          arriba — esta sección solo refina queries.
        </p>
      </div>

      <CommentReroll
        corpusId={corpusId}
        iterationId={iteration.id}
        onSent={onActioned}
      />

      {error && <p className="wizard-error">⚠ {error}</p>}
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
          placeholder="Ej: quita 'AND (country:MX)' porque SentiOne no acepta operadores de campo. Agrega frases con 'me cobraron de más'."
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={sending}
        />
      </label>
      <p className="comment-helper">
        El motor leerá tus instrucciones como prioridad máxima sobre el diagnóstico
        automático. Útil para corregir errores de sintaxis o forzar términos.
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
        densidad de señal, genera una nueva query con las{" "}
        <strong>Instrucciones para la próxima query</strong> del diagnóstico arriba.
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
  isApproved,
  latestQuality,
  iterationCount,
}: {
  corpusId: string;
  totalIncluded: number;
  assessment: Assessment | null;
  assessedAt: Date | string | null;
  isApproved: boolean;
  latestQuality: number | null;
  iterationCount: number;
}) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [copiedFindings, setCopiedFindings] = useState(false);
  const router = useRouter();

  async function approve() {
    setApproving(true);
    setError(null);
    const res = await fetch(`/api/corpora/${corpusId}/approve`, { method: "POST" });
    const json = await res.json();
    if (!res.ok) {
      setError(json?.message ?? "No se pudo aprobar el corpus.");
      setApproving(false);
      return;
    }
    setApproving(false);
    router.refresh();
  }

  // Compile findings into prose ready to paste into the query generator
  // comment field. Includes verdict, signals_missing, recommendation.
  function buildFindingsText(): string {
    if (!assessment) return "";
    const parts: string[] = [];
    parts.push(`Diagnóstico del corpus (${assessment.confidence}% confianza, muestra ${assessment.sample_size ?? 600}):`);
    parts.push("");
    if (assessment.recommendation) {
      parts.push(`Recomendación general: ${assessment.recommendation}`);
      parts.push("");
    }
    if (assessment.signals_missing.length > 0) {
      parts.push("Señales que faltan capturar en el corpus:");
      assessment.signals_missing.forEach((s, i) => parts.push(`${i + 1}. ${s}`));
      parts.push("");
    }
    if (assessment.signals_well_covered.length > 0) {
      parts.push("Señales ya bien cubiertas (no duplicar):");
      assessment.signals_well_covered.forEach((s, i) => parts.push(`${i + 1}. ${s}`));
      parts.push("");
    }
    parts.push(
      `Métricas: triggers ${assessment.coverage.trigger_signal_pct}% · barriers ${assessment.coverage.barrier_signal_pct}% · experiencia ${assessment.coverage.experience_signal_pct}% · ruido ${assessment.coverage.noise_pct}%.`
    );
    parts.push("");
    parts.push(
      "Genera la próxima query priorizando capturar las señales faltantes arriba sin reintroducir términos que generan ruido."
    );
    return parts.join("\n");
  }

  async function copyFindings() {
    const text = buildFindingsText();
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopiedFindings(true);
    setTimeout(() => setCopiedFindings(false), 2200);
  }

  async function run() {
    setRunning(true);
    setError(null);
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
  const canApprove = !isApproved;
  const approveIsPrimary = assessment?.ready_for_study === true;

  return (
    <section className="corpus-assess">
      <header className="corpus-assess-head">
        <div>
          <div className="wizard-card-eyebrow-row">
            <p className="corpus-assess-eyebrow">
              {isApproved ? "Corpus aprobado" : "Diagnóstico del corpus"}
            </p>
            {isApproved && <SuccessPill>Aprobado</SuccessPill>}
            {!isApproved && v && (
              <StatusPill tone={v.tone}>
                <Icon name={v.tone === "success" ? "check" : v.tone === "error" ? "x" : "alert"} size={12} />
                {v.label}
              </StatusPill>
            )}
            {!isApproved && !assessment && totalIncluded > 0 && (
              <StatusPill tone="idle"><Icon name="info" size={12} /> Sin evaluar</StatusPill>
            )}
          </div>
          <h3 className="corpus-assess-title">
            {isApproved
              ? "Listo para análisis cultural"
              : assessment
                ? v?.label
                : `Evaluar viabilidad sobre las ${fmtNumber(totalIncluded)} menciones`}
          </h3>
          {assessment && assessedAt && (
            <p className="corpus-assess-meta">
              Diagnóstico actualizado {fmtAssessedAt(assessedAt)} · muestra{" "}
              {assessment.sample_size ?? 600} · confianza {assessment.confidence}%
            </p>
          )}
        </div>
        <div className="corpus-assess-actions">
          <button
            className="wizard-cta wizard-cta--secondary"
            disabled={running || approving}
            onClick={run}
            type="button"
          >
            {running ? (
              <><Icon name="spinner" className="icon--spin" size={14} /> Diagnosticando · {progress}%</>
            ) : assessment ? (
              <><Icon name="refresh" size={14} /> Re-diagnosticar</>
            ) : (
              <><Icon name="sparkle" size={14} /> Diagnosticar corpus</>
            )}
          </button>
          {canApprove && (
            <button
              className={`wizard-cta${approveIsPrimary ? "" : " wizard-cta--secondary"}`}
              disabled={approving || running}
              onClick={approve}
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
                <><Icon name="check" size={14} /> Aprobar de todas formas</>
              )}
            </button>
          )}
        </div>
      </header>

      {running && (
        <div className="wizard-progress-bar">
          <span style={{ width: `${progress}%` }} />
        </div>
      )}

      {!assessment && !running && (
        <p className="corpus-assess-helper">
          El motor toma una muestra aleatoria de 600 menciones del corpus completo (no de una
          sola query) y decide si ya tienes señal suficiente para correr el estudio T&amp;B, o
          qué tipo de señal hace falta. Esto es independiente de la evaluación por iteración.
        </p>
      )}

      {assessment && (
        <>
          <div className="coverage-bars">
            <CoverageBar label="Triggers" pct={assessment.coverage.trigger_signal_pct} tone="good" />
            <CoverageBar label="Barriers" pct={assessment.coverage.barrier_signal_pct} tone="good" />
            <CoverageBar label="Experiencia" pct={assessment.coverage.experience_signal_pct} tone="good" />
            <CoverageBar label="Ruido" pct={assessment.coverage.noise_pct} tone="bad" />
          </div>

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

          {/* Copyable findings block — feeds directly into the query generator
              comment field so the IM doesn't retype the diagnostic. */}
          <div className="findings-block">
            <div className="findings-head">
              <div>
                <p className="findings-label">
                  <Icon name="copy" size={12} /> Instrucciones para la próxima query
                </p>
                <p className="findings-sub">
                  Copia este texto y pégalo en <strong>Comentar las queries y regenerar</strong>{" "}
                  en el panel de iteración. El motor lo aplicará como prioridad máxima.
                </p>
              </div>
              <button
                className={`btn-micro${copiedFindings ? " btn-copied" : ""}`}
                onClick={copyFindings}
                type="button"
              >
                {copiedFindings ? <Icon name="check" size={12} /> : <Icon name="copy" size={12} />}
                {copiedFindings ? "Copiado" : "Copiar"}
              </button>
            </div>
            <pre className="findings-text">{buildFindingsText()}</pre>
          </div>
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
              <dt>Menciones válidas</dt>
              <dd>{fmtNumber(totalIncluded)}</dd>
            </div>
            <div>
              <dt>Calidad última iteración</dt>
              <dd>{latestQuality !== null ? latestQuality.toFixed(1) : "—"}</dd>
            </div>
            {assessment && (
              <>
                <div>
                  <dt>Veredicto del motor</dt>
                  <dd>{VERDICT_TONE[assessment.verdict].label}</dd>
                </div>
                <div>
                  <dt>Confianza del diagnóstico</dt>
                  <dd>{assessment.confidence}%</dd>
                </div>
              </>
            )}
          </dl>
          {assessment && assessment.signals_missing.length > 0 && (
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

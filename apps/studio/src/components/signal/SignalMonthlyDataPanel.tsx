"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useSignalDateRange, useSignalUiLanguage } from "@/components/signal/SignalReportShell";
import { Icon } from "@/components/ui/Icon";

type UploadTarget = "study" | "baseline";

type MonthlyDataPanelProps = {
  baseCorpusId: string | null;
  brandLabel: string;
  outputId: string;
  studyCorpusId: string;
  subjectType: "brand" | "theme";
};

type UploadStats = {
  duplicate_count?: number;
  excluded_count?: number;
  included_count?: number;
  record_count?: number;
};

type MonthlyAnalysisGroup = {
  key: string;
  methodologySlug: string;
  signalType: string;
  canonicalTitle: string;
  frequency: number;
  sharePct: number;
  deltaVsPrevious: number;
  matchedTerms: string[];
};

type MonthlyAnalysisResult = {
  totalMentions: number;
  matchedMentions: number;
  signalsCreatedOrUpdated: number;
  observationsCreatedOrUpdated: number;
  evidenceLinksCreated: number;
  groups: MonthlyAnalysisGroup[];
};

type JobPollResult = {
  failed_reason?: string | null;
  progress?: number;
  result?: { stats?: UploadStats } | null;
  status?: string;
  worker_alive?: boolean;
};

const copy = {
  en: {
    eyebrow: "Admin only",
    title: "Add monthly data",
    body: "Upload a social-listening CSV into the live corpus. Corpus Explorer updates immediately; signals, history and composer update after the next analysis/backfill labels the new mentions.",
    period: "Month",
    target: "Where should this CSV live?",
    studyTarget: "Brand / study corpus",
    baselineTarget: "Industry baseline",
    label: "Entity label",
    labelPlaceholder: "Ex. June operator mentions",
    file: "CSV file",
    upload: "Upload cut",
    uploading: "Uploading",
    success: "Monthly cut loaded",
    analyze: "Analyze cut",
    analyzing: "Analyzing",
    analysisSuccess: "Live signals updated",
    analysisTitle: "What people said this month",
    analysisBody: "Light backfill: labels the new mentions into persistent signals for History and Composer. No Claude call in this step.",
    analysisEmpty: "No signal pack matched this cut yet. The mentions still live in Corpus Explorer.",
    signals: "signals",
    observations: "observations",
    evidenceLinks: "evidence links",
    matchedMentions: "matched mentions",
    included: "included",
    duplicates: "duplicates",
    excluded: "excluded",
    chooseFile: "Choose a CSV file.",
    noWorker: "The worker is not available for this async ingest.",
    readJobFailed: "Could not read ingest job status.",
    updatesRange: "After upload, the global date range jumps to this month for QA.",
    output: "Current output",
  },
  es: {
    eyebrow: "Sólo admin",
    title: "Agregar data mensual",
    body: "Sube un CSV de listening al corpus vivo. Corpus Explorer se actualiza de inmediato; signals, history y composer se actualizan cuando el siguiente análisis/backfill etiquete esas menciones.",
    period: "Mes",
    target: "¿Dónde vive este CSV?",
    studyTarget: "Corpus de marca / estudio",
    baselineTarget: "Baseline de industria",
    label: "Etiqueta de entidad",
    labelPlaceholder: "Ej. menciones operador junio",
    file: "Archivo CSV",
    upload: "Subir corte",
    uploading: "Subiendo",
    success: "Corte mensual cargado",
    analyze: "Analizar corte",
    analyzing: "Analizando",
    analysisSuccess: "Señales vivas actualizadas",
    analysisTitle: "Qué dijo la gente este mes",
    analysisBody: "Backfill ligero: etiqueta las nuevas menciones como señales persistentes para History y Composer. Este paso no llama Claude.",
    analysisEmpty: "Ningún pack de señal encontró suficiente match en este corte. Las menciones siguen vivas en Corpus Explorer.",
    signals: "señales",
    observations: "observaciones",
    evidenceLinks: "evidencias",
    matchedMentions: "menciones matcheadas",
    included: "incluidas",
    duplicates: "duplicadas",
    excluded: "excluidas",
    chooseFile: "Selecciona un archivo CSV.",
    noWorker: "El worker no está activo para esta ingesta async.",
    readJobFailed: "No se pudo leer el estado del job de ingesta.",
    updatesRange: "Después de subirlo, el rango global salta a ese mes para QA.",
    output: "Output actual",
  }
};

export function SignalMonthlyDataPanel({
  baseCorpusId,
  brandLabel,
  outputId,
  studyCorpusId,
  subjectType,
}: MonthlyDataPanelProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { setDateRange } = useSignalDateRange();
  const { uiLanguage } = useSignalUiLanguage();
  const t = copy[uiLanguage];
  const [month, setMonth] = useState(defaultMonth());
  const [target, setTarget] = useState<UploadTarget>("study");
  const [entityLabel, setEntityLabel] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [analysisStatus, setAnalysisStatus] = useState<"idle" | "running" | "success" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<UploadStats | null>(null);
  const [analysisResult, setAnalysisResult] = useState<MonthlyAnalysisResult | null>(null);
  const [importBatchId, setImportBatchId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const targetCorpusId = target === "baseline" && baseCorpusId ? baseCorpusId : studyCorpusId;
  const mentionType = target === "baseline" || subjectType === "theme" ? "industry" : "brand";
  const entityKind = mentionType === "brand" ? "primary_brand" : "category";
  const resolvedEntityLabel = entityLabel.trim() || (target === "baseline" ? "Industry baseline" : brandLabel);
  const monthRange = useMemo(() => monthToRange(month), [month]);

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError(t.chooseFile);
      setStatus("error");
      return;
    }
    setError(null);
    setStats(null);
    setAnalysisError(null);
    setAnalysisResult(null);
    setImportBatchId(null);
    setAnalysisStatus("idle");
    setProgress(12);
    setStatus("uploading");

    const params = new URLSearchParams();
    params.set("mention_type", mentionType);
    params.set("entity_kind", entityKind);
    params.set("entity_label", resolvedEntityLabel);
    params.set("source_label", `monthly_cut_${month}_${target}`);
    params.set("file_name", file.name);

    const tick = window.setInterval(() => {
      setProgress((current) => current < 88 ? current + 4 : current);
    }, 450);

    try {
      const response = await fetch(`/api/corpora/${targetCorpusId}/mentions/csv-upload?${params.toString()}`, {
        body: file,
        headers: { "content-type": "text/csv" },
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message ?? `Error ${response.status}`);
      }
      setImportBatchId(typeof payload.import_batch_id === "string" ? payload.import_batch_id : null);

      if (payload.job_id) {
        const job = await waitForIngestJob(String(payload.job_id), setProgress, t);
        if (job.status !== "completed") {
          throw new Error(job.failed_reason ?? t.readJobFailed);
        }
        setStats(job.result?.stats ?? null);
      } else {
        setStats(payload.stats ?? null);
      }

      setProgress(100);
      setStatus("success");
      setDateRange(monthRange.start, monthRange.end);
      router.refresh();
    } catch (err) {
      setStatus("error");
      setProgress(0);
      setError(err instanceof Error ? truncate(err.message, 220) : "Upload failed.");
    } finally {
      window.clearInterval(tick);
    }
  }

  async function handleAnalyzeCut() {
    setAnalysisError(null);
    setAnalysisResult(null);
    setAnalysisStatus("running");
    try {
      const response = await fetch(`/api/signal/${outputId}/monthly-analysis`, {
        body: JSON.stringify({
          dateFrom: monthRange.start,
          dateTo: monthRange.end,
          importBatchId,
          targetCorpusId
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message ?? `Error ${response.status}`);
      }
      setAnalysisResult(payload.result ?? null);
      setAnalysisStatus("success");
      setDateRange(monthRange.start, monthRange.end);
      router.refresh();
    } catch (err) {
      setAnalysisStatus("error");
      setAnalysisError(err instanceof Error ? truncate(err.message, 220) : "Monthly analysis failed.");
    }
  }

  return (
    <section className="signal-monthly-data-panel">
      <header>
        <div>
          <p className="signal-eyebrow">{t.eyebrow}</p>
          <h3>{t.title}</h3>
          <span>{t.body}</span>
        </div>
        <small>{t.output}: {outputId.slice(0, 8)}</small>
      </header>

      <div className="signal-monthly-data-grid">
        <label>
          <span>{t.period}</span>
          <input onChange={(event) => setMonth(event.target.value)} type="month" value={month} />
          <small>{monthRange.start} → {monthRange.end}</small>
        </label>
        <label>
          <span>{t.target}</span>
          <select onChange={(event) => setTarget(event.target.value as UploadTarget)} value={target}>
            <option value="study">{t.studyTarget}</option>
            {baseCorpusId ? <option value="baseline">{t.baselineTarget}</option> : null}
          </select>
          <small>{targetCorpusId.slice(0, 8)} · {mentionType}</small>
        </label>
        <label>
          <span>{t.label}</span>
          <input
            maxLength={140}
            onChange={(event) => setEntityLabel(event.target.value)}
            placeholder={t.labelPlaceholder}
            type="text"
            value={entityLabel}
          />
          <small>{resolvedEntityLabel}</small>
        </label>
        <label>
          <span>{t.file}</span>
          <input accept=".csv,text/csv" ref={fileRef} type="file" />
          <small>{t.updatesRange}</small>
        </label>
      </div>

      {status === "uploading" ? (
        <div className="signal-monthly-progress">
          <span style={{ width: `${progress}%` }} />
          <small><Icon name="spinner" size={12} /> {t.uploading} · {progress}%</small>
        </div>
      ) : null}

      <footer>
        <button disabled={status === "uploading"} onClick={handleUpload} type="button">
          <Icon name={status === "uploading" ? "spinner" : "upload"} size={15} />
          {status === "uploading" ? t.uploading : t.upload}
        </button>
        {status === "success" ? (
          <button
            className="is-secondary"
            disabled={analysisStatus === "running"}
            onClick={handleAnalyzeCut}
            type="button"
          >
            <Icon name={analysisStatus === "running" ? "spinner" : "sparkle"} size={15} />
            {analysisStatus === "running" ? t.analyzing : t.analyze}
          </button>
        ) : null}
        {status === "success" ? (
          <p className="signal-monthly-success">
            <Icon name="check" size={14} />
            <strong>{t.success}</strong>
            {stats ? (
              <span>
                {Number(stats.included_count ?? 0)} {t.included} · {Number(stats.duplicate_count ?? 0)} {t.duplicates} · {Number(stats.excluded_count ?? 0)} {t.excluded}
              </span>
            ) : null}
          </p>
        ) : null}
        {analysisStatus === "success" && analysisResult ? (
          <p className="signal-monthly-success">
            <Icon name="check" size={14} />
            <strong>{t.analysisSuccess}</strong>
            <span>
              {analysisResult.signalsCreatedOrUpdated} {t.signals} · {analysisResult.observationsCreatedOrUpdated} {t.observations} · {analysisResult.evidenceLinksCreated} {t.evidenceLinks}
            </span>
          </p>
        ) : null}
        {status === "error" && error ? (
          <p className="signal-monthly-error"><Icon name="alert" size={14} /> {error}</p>
        ) : null}
        {analysisStatus === "error" && analysisError ? (
          <p className="signal-monthly-error"><Icon name="alert" size={14} /> {analysisError}</p>
        ) : null}
      </footer>

      {analysisStatus === "success" && analysisResult ? (
        <section className="signal-monthly-analysis-summary">
          <header>
            <div>
              <p className="signal-eyebrow">{t.analysisTitle}</p>
              <span>{t.analysisBody}</span>
            </div>
            <small>{analysisResult.matchedMentions} / {analysisResult.totalMentions} {t.matchedMentions}</small>
          </header>
          {analysisResult.groups.length > 0 ? (
            <div>
              {analysisResult.groups.slice(0, 6).map((group) => (
                <article key={group.key}>
                  <small>{prettifyKey(group.methodologySlug)} · {prettifyKey(group.signalType)}</small>
                  <strong>{group.canonicalTitle}</strong>
                  <span>{group.frequency} mentions · {formatPercent(group.sharePct)} · delta {formatDelta(group.deltaVsPrevious)}</span>
                  <em>{group.matchedTerms.slice(0, 5).join(", ")}</em>
                </article>
              ))}
            </div>
          ) : (
            <p>{t.analysisEmpty}</p>
          )}
        </section>
      ) : null}
    </section>
  );
}

async function waitForIngestJob(
  jobId: string,
  setProgress: (next: number | ((previous: number) => number)) => void,
  t: typeof copy.en
): Promise<JobPollResult> {
  for (;;) {
    await sleep(2500);
    const response = await fetch(`/api/jobs/${jobId}`);
    const job = await response.json().catch(() => ({})) as JobPollResult;
    if (!response.ok) return { status: "failed", failed_reason: t.readJobFailed };
    if (job.worker_alive === false) return { status: "failed", failed_reason: t.noWorker };
    if (typeof job.progress === "number") setProgress(Math.min(98, Math.max(20, Math.round(job.progress))));
    if (job.status === "completed" || job.status === "failed") return job;
  }
}

function defaultMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthToRange(month: string) {
  const normalized = /^\d{4}-\d{2}$/.test(month) ? month : defaultMonth();
  const [yearRaw, monthRaw] = normalized.split("-");
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10)
  };
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => window.setTimeout(resolvePromise, ms));
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max).replace(/\s+\S*$/, "")}...`;
}

function prettifyKey(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function formatDelta(value: number) {
  if (value === 0) return "0";
  return value > 0 ? `+${value}` : String(value);
}

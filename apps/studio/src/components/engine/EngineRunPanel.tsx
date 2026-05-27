"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type JobState = {
  id: string;
  status: string;
  progress: number;
  result?: {
    query_iteration_id?: string;
    query_text?: string;
  } | null;
  failed_reason?: string | null;
};

export function EngineRunPanel({ corpusId, hasEvaluatedIterations }: { corpusId: string; hasEvaluatedIterations?: boolean }) {
  const router = useRouter();
  const [job, setJob] = useState<JobState | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<number | null>(null);

  useEffect(() => {
    if (!job?.id || job.status === "completed" || job.status === "failed") {
      if (job?.status === "completed") {
        router.refresh();
      }
      return;
    }

    pollingRef.current = window.setInterval(async () => {
      const response = await fetch(`/api/jobs/${job.id}`);
      const next = (await response.json()) as JobState;
      setJob(next);
    }, 2000);

    return () => {
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
      }
    };
  }, [job?.id, job?.status, router]);

  async function startEngine() {
    setIsStarting(true);
    setError(null);

    const response = await fetch(`/api/corpora/${corpusId}/run-engine`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ iteration_strategy: "auto", max_iterations: 5 })
    });
    const payload = await response.json();

    if (!response.ok) {
      setError(payload.message ?? "No se pudo iniciar el Engine.");
      setIsStarting(false);
      return;
    }

    setJob({
      id: payload.job_id,
      status: payload.status,
      progress: 0
    });
    setIsStarting(false);
  }

  const progress = job?.status === "completed" ? 100 : Math.max(0, Math.min(100, job?.progress ?? 0));

  return (
    <section className="engine-panel">
      <div>
        <p className="eyebrow">Engine</p>
        <h2>Query inicial T&B</h2>
        <p>Compone la primera query con brand seeds, competidores, signal phrases y memoria.</p>
      </div>
      <button disabled={isStarting || (job !== null && !["completed", "failed"].includes(job.status))} onClick={startEngine} type="button">
        {isStarting ? "Iniciando..." : hasEvaluatedIterations ? "Nueva query desde cero" : "Generar query"}
      </button>
      {hasEvaluatedIterations && !job && (
        <p className="engine-hint">
          Usa <strong>✏ Aplicar ajustes</strong> en la iteracion evaluada para refinar la query actual.
          Este boton genera una query inicial nueva sin considerar el diagnostico anterior.
        </p>
      )}
      {job ? (
        <div className="progress-block">
          <div className="progress-meta">
            <span>{job.status}</span>
            <span>{progress}%</span>
          </div>
          <div className="progress-track">
            <span style={{ width: `${progress}%` }} />
          </div>
          {job.result?.query_text ? <code>{job.result.query_text}</code> : null}
          {job.failed_reason ? <p className="error-copy">{job.failed_reason}</p> : null}
        </div>
      ) : null}
      {error ? <p className="error-copy">{error}</p> : null}
    </section>
  );
}

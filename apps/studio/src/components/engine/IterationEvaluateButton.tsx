"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type JobState = {
  id: string;
  status: string;
  progress: number;
  result?: {
    quality_score?: number;
    density_score?: number;
    noise_score?: number;
    notes?: string;
    proposed_adjustments?: string[];
    sample_size?: number;
  } | null;
  failed_reason?: string | null;
};

export function IterationEvaluateButton({
  corpusId,
  iterationId,
  alreadyEvaluated,
}: {
  corpusId: string;
  iterationId: string;
  alreadyEvaluated: boolean;
}) {
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
      const res = await fetch(`/api/jobs/${job.id}`);
      const next = (await res.json()) as JobState;
      setJob(next);
    }, 2000);

    return () => {
      if (pollingRef.current) window.clearInterval(pollingRef.current);
    };
  }, [job?.id, job?.status, router]);

  async function evaluate() {
    setIsStarting(true);
    setError(null);

    const res = await fetch(
      `/api/corpora/${corpusId}/query-iterations/${iterationId}/evaluate`,
      { method: "POST" }
    );
    const payload = await res.json();

    if (!res.ok) {
      setError(payload.message ?? "No se pudo iniciar la evaluacion.");
      setIsStarting(false);
      return;
    }

    setJob({ id: payload.job_id, status: payload.status, progress: 0 });
    setIsStarting(false);
  }

  const isRunning = job !== null && !["completed", "failed"].includes(job.status);
  const done = job?.status === "completed";

  return (
    <span className="eval-cell">
      {done && job.result ? (
        <span className="eval-scores">
          Q{job.result.quality_score?.toFixed(1)} D{job.result.density_score?.toFixed(1)} N{job.result.noise_score?.toFixed(1)}
        </span>
      ) : isRunning ? (
        <span className="eval-running">evaluando…</span>
      ) : (
        <button
          className="btn-micro"
          disabled={isStarting}
          onClick={evaluate}
          type="button"
        >
          {alreadyEvaluated ? "re-evaluar" : "evaluar"}
        </button>
      )}
      {error && <span className="eval-error">{error}</span>}
    </span>
  );
}

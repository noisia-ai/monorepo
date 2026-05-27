"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  corpusId: string;
  iterationId: string;
  hasAdjustments: boolean;
  decision: string | null;
};

export function IterationActionButtons({ corpusId, iterationId, hasAdjustments, decision }: Props) {
  const router = useRouter();
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function applyAdjustments() {
    setApplying(true);
    setError(null);

    const res = await fetch(
      `/api/corpora/${corpusId}/query-iterations/${iterationId}/apply-adjustments`,
      { method: "POST" }
    );
    const payload = await res.json();

    if (!res.ok) {
      setError(payload.message ?? "No se pudo generar la siguiente iteracion.");
      setApplying(false);
      return;
    }

    // Poll until the job finishes
    const jobId = payload.job_id;
    const poll = setInterval(async () => {
      const jr = await fetch(`/api/jobs/${jobId}`);
      const jdata = await jr.json();
      if (jdata.status === "completed") {
        clearInterval(poll);
        setDone(true);
        setApplying(false);
        router.refresh();
      } else if (jdata.status === "failed") {
        clearInterval(poll);
        setError(jdata.failed_reason ?? "Error al generar la iteracion.");
        setApplying(false);
      }
    }, 2000);
  }

  if (done) {
    return <span className="action-done">✓ Nueva iteracion generada</span>;
  }

  if (decision === "approved") {
    return <span className="action-approved">✓ Aprobada</span>;
  }

  return (
    <span className="iteration-actions">
      {hasAdjustments && (
        <button
          className="btn-micro btn-primary"
          disabled={applying}
          onClick={applyAdjustments}
          type="button"
          title="Generar siguiente iteracion aplicando los ajustes propuestos por el evaluador"
        >
          {applying ? "generando…" : "✏ Aplicar ajustes"}
        </button>
      )}
      {error && <span className="eval-error">{error}</span>}
    </span>
  );
}

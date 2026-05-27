"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/ui/Icon";

export function ApproveAnalysisButton({
  corpusId,
  analysisId,
  disabled,
  failedGates = []
}: {
  corpusId: string;
  analysisId: string;
  disabled?: boolean;
  failedGates?: Array<{
    gateName: string;
    notes: string | null;
  }>;
}) {
  const router = useRouter();
  const [isApproving, setIsApproving] = useState(false);
  const [isConfirmingOverride, setIsConfirmingOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasWarnings = failedGates.length > 0;

  async function approve(approveWithWarnings = false) {
    if (hasWarnings && !approveWithWarnings) {
      setIsConfirmingOverride(true);
      setError(null);
      return;
    }

    setIsApproving(true);
    setError(null);

    const response = await fetch(`/api/corpora/${corpusId}/tb-analysis/${analysisId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approve_with_warnings: approveWithWarnings })
    });
    const payload = await response.json() as { message?: string };

    if (!response.ok) {
      setError(payload.message ?? "No se pudo aprobar el análisis.");
      setIsApproving(false);
      return;
    }

    setIsApproving(false);
    setIsConfirmingOverride(false);
    router.refresh();
  }

  return (
    <div className="analysis-approve-action">
      <button className="wizard-cta" disabled={disabled || isApproving} onClick={() => approve(false)} type="button">
        {isApproving ? <Icon name="spinner" size={16} /> : <Icon name="check" size={16} />}
        {hasWarnings ? `Aprobar con ${failedGates.length} advertencia${failedGates.length === 1 ? "" : "s"}` : "Aprobar síntesis"}
      </button>
      {hasWarnings && !isConfirmingOverride ? (
        <p className="analysis-action-note">
          Hay chequeos con observación. Puedes aprobar si representan una limitación conocida del corpus.
        </p>
      ) : null}
      {isConfirmingOverride ? (
        <div className="analysis-override-card" role="alert">
          <strong>¿Aprobar de todas formas?</strong>
          <p>
            Esto avanzará al composer y guardará las advertencias como limitación auditada del análisis.
          </p>
          <ul>
            {failedGates.slice(0, 3).map((gate) => (
              <li key={gate.gateName}>{gate.notes ?? gate.gateName}</li>
            ))}
          </ul>
          <div className="analysis-override-actions">
            <button className="wizard-cta wizard-cta--ghost" disabled={isApproving} onClick={() => setIsConfirmingOverride(false)} type="button">
              Cancelar
            </button>
            <button className="wizard-cta" disabled={isApproving} onClick={() => approve(true)} type="button">
              {isApproving ? <Icon name="spinner" size={16} /> : <Icon name="check" size={16} />}
              Aprobar y continuar
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className="analysis-action-error">{error}</p> : null}
    </div>
  );
}

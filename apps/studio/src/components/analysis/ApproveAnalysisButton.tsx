"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/ui/Icon";

type SelectedLensLaunchPayload = {
  created?: Array<unknown>;
  skipped?: Array<unknown>;
  blocked?: Array<{ methodology_slug?: string; reason?: string; message?: string }>;
  message?: string;
};

export function ApproveAnalysisButton({
  corpusId,
  analysisId,
  workspaceId,
  disabled,
  failedGates = []
}: {
  corpusId: string;
  analysisId: string;
  workspaceId?: string;
  disabled?: boolean;
  failedGates?: Array<{
    gateName: string;
    notes: string | null;
  }>;
}) {
  const router = useRouter();
  const [isApproving, setIsApproving] = useState(false);
  const [isLaunchingLenses, setIsLaunchingLenses] = useState(false);
  const [isConfirmingOverride, setIsConfirmingOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lensLaunchNote, setLensLaunchNote] = useState<string | null>(null);
  const workspaceReviewKey = useRef(crypto.randomUUID());

  const hasWarnings = failedGates.length > 0;

  async function approve(approveWithWarnings = false) {
    if (hasWarnings && !approveWithWarnings) {
      setIsConfirmingOverride(true);
      setError(null);
      return;
    }

    setIsApproving(true);
    setError(null);
    setLensLaunchNote(null);

    try {
      const response = await fetch(workspaceId
        ? `/api/data-os/signal/${workspaceId}/reports/triggers-barriers/runs/${analysisId}/review`
        : `/api/corpora/${corpusId}/tb-analysis/${analysisId}/approve`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(workspaceId ? { "Idempotency-Key": workspaceReviewKey.current } : {})
        },
        body: JSON.stringify(workspaceId ? {
          reusable_assertions: [],
          limitations: approveWithWarnings ? { quality_gate_override: true } : undefined
        } : { approve_with_warnings: approveWithWarnings })
      });
      const payload = await response.json().catch(() => ({})) as { message?: string };

      if (!response.ok) {
        setError(payload.message ?? "No se pudo aprobar el análisis.");
        return;
      }

      if (!workspaceId) {
        setIsLaunchingLenses(true);
        const lensLaunch = await launchSelectedLenses(corpusId);
        if (lensLaunch) setLensLaunchNote(lensLaunch);
      }

      setIsConfirmingOverride(false);
      router.refresh();
    } catch (err) {
      console.error("Failed to approve T&B analysis", err);
      setError("No pudimos aprobar el análisis. Revisa la conexión e intenta otra vez.");
    } finally {
      setIsApproving(false);
      setIsLaunchingLenses(false);
    }
  }

  return (
    <div className="analysis-approve-action">
      <button className="admin-button admin-button--primary" disabled={disabled || isApproving || isLaunchingLenses} onClick={() => approve(false)} type="button">
        {isApproving || isLaunchingLenses ? <Icon name="spinner" size={16} /> : <Icon name="check" size={16} />}
        {isLaunchingLenses
          ? "Lanzando lentes"
          : hasWarnings
            ? `Aprobar con ${failedGates.length} advertencia${failedGates.length === 1 ? "" : "s"}`
            : "Aprobar síntesis"}
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
            <button className="admin-button" disabled={isApproving} onClick={() => setIsConfirmingOverride(false)} type="button">
              Cancelar
            </button>
            <button className="admin-button admin-button--primary" disabled={isApproving || isLaunchingLenses} onClick={() => approve(true)} type="button">
              {isApproving || isLaunchingLenses ? <Icon name="spinner" size={16} /> : <Icon name="check" size={16} />}
              {isLaunchingLenses ? "Lanzando lentes" : "Aprobar y continuar"}
            </button>
          </div>
        </div>
      ) : null}
      {lensLaunchNote ? <p className="analysis-action-note">{lensLaunchNote}</p> : null}
      {error ? <p className="analysis-action-error">{error}</p> : null}
    </div>
  );
}

async function launchSelectedLenses(corpusId: string): Promise<string | null> {
  const response = await fetch(`/api/corpora/${corpusId}/engine-analysis/selected`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      params: {
        launch_surface: "tb_approval_auto_selected_lenses"
      }
    })
  });
  const payload = await response.json().catch(() => ({})) as SelectedLensLaunchPayload;
  if (!response.ok) {
    return payload.message
      ? `T&B quedó aprobado, pero no se pudieron lanzar los lentes seleccionados: ${payload.message}`
      : "T&B quedó aprobado, pero no se pudieron lanzar los lentes seleccionados.";
  }

  const created = payload.created?.length ?? 0;
  const skipped = payload.skipped?.length ?? 0;
  const blocked = payload.blocked?.length ?? 0;
  if (created > 0) return `T&B aprobado. Lanzamos ${created} lente${created === 1 ? "" : "s"} seleccionado${created === 1 ? "" : "s"} para análisis real.`;
  if (blocked > 0) {
    const firstBlocked = payload.blocked?.[0];
    return `T&B aprobado. ${blocked} lente${blocked === 1 ? "" : "s"} quedó${blocked === 1 ? "" : "aron"} bloqueado${blocked === 1 ? "" : "s"} por coverage: ${firstBlocked?.message ?? firstBlocked?.reason ?? "revisa el panel técnico"}.`;
  }
  if (skipped > 0) return `T&B aprobado. Los ${skipped} lente${skipped === 1 ? "" : "s"} seleccionado${skipped === 1 ? "" : "s"} ya estaban en curso o listos con Claude real.`;
  return null;
}

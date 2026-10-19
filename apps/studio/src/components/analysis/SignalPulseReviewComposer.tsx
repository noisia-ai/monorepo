"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/ui/Icon";

type SignalPulseDraft = {
  id: string;
  title: string;
  headline: string | null;
  summary: string | null;
  status: string;
} | null;

export function SignalPulseReviewComposer({
  corpusId,
  analysisId,
  defaultTitle,
  defaultHeadline,
  defaultSummary,
  draft,
  publishBlocked
}: {
  corpusId: string;
  analysisId: string;
  defaultTitle: string;
  defaultHeadline: string;
  defaultSummary: string;
  draft: SignalPulseDraft;
  publishBlocked: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState(draft?.title ?? defaultTitle);
  const [headline, setHeadline] = useState(draft?.headline ?? defaultHeadline);
  const [summary, setSummary] = useState(draft?.summary ?? defaultSummary);
  const [feedback, setFeedback] = useState<string | null>(draft ? `Draft ${draft.status}.` : null);
  const [error, setError] = useState<string | null>(null);

  function submit(action: "save_draft" | "publish") {
    setFeedback(null);
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/corpora/${corpusId}/engine-analysis/${analysisId}/signal-output`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          headline,
          summary,
          manifest: {
            visibility_config: {
              paid_data: "internal_only",
              performance_data: "internal_only",
              corpus_view: "client_safe",
              evidence_quotes: "client_safe"
            }
          },
          action
        })
      });
      const payload = await response.json().catch(() => ({})) as {
        output?: { id: string; status: string };
        message?: string;
      };
      if (!response.ok || !payload.output) {
        setError(payload.message ?? "No se pudo guardar Signal Pulse.");
        return;
      }
      if (action === "publish") {
        router.push(`/pulse/${payload.output.id}`);
        return;
      }
      setFeedback("Draft de Signal Pulse guardado para revisión.");
      router.refresh();
    });
  }

  return (
    <section className="signal-pulse-review-composer">
      <div className="analysis-section-head">
        <div>
          <p className="vitals-eyebrow">Publish control</p>
          <h2>Lectura editorial antes de publicar</h2>
        </div>
        <span>{publishBlocked ? "bloqueado" : "listo para draft"}</span>
      </div>

      <div className="signal-composer-form">
        <label>
          <span>Nombre del reporte</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          <span>Lectura principal</span>
          <input value={headline} onChange={(event) => setHeadline(event.target.value)} />
        </label>
        <label className="signal-composer-summary">
          <span>Resumen para lectura</span>
          <textarea rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} />
        </label>
      </div>

      <footer className="signal-composer-actions">
        <div>
          {feedback ? <p className="analysis-action-success">{feedback}</p> : null}
          {error ? <p className="analysis-action-error">{error}</p> : null}
          {publishBlocked ? (
            <p className="analysis-action-note">
              Aún hay señales o gates que requieren revisión humana. Puedes guardar draft, pero no abrirlo a cliente.
            </p>
          ) : null}
        </div>
        <div className="signal-composer-buttons">
          <button className="wizard-cta wizard-cta--secondary" disabled={isPending} onClick={() => submit("save_draft")} type="button">
            Guardar draft
          </button>
          <button className="wizard-cta" disabled={isPending || publishBlocked} onClick={() => submit("publish")} type="button">
            {isPending ? <Icon name="spinner" size={16} /> : <Icon name="play" size={16} />}
            Publicar Signal Pulse
          </button>
        </div>
      </footer>
    </section>
  );
}

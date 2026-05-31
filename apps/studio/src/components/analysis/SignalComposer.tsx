"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/ui/Icon";
import {
  defaultSignalManifest,
  signalModuleMeta,
  type SignalModuleKey
} from "@/lib/signal/manifest";

type DraftOutput = {
  id: string;
  title: string;
  headline: string | null;
  summary: string | null;
  status: string;
  manifest: unknown;
  publishedAt: Date | string | null;
} | null;

export function SignalComposer({
  corpusId,
  analysisId,
  brandName,
  draft
}: {
  corpusId: string;
  analysisId: string;
  brandName: string;
  draft: DraftOutput;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const initialManifest = useMemo(() => normalizeManifest(draft?.manifest), [draft?.manifest]);
  const [title, setTitle] = useState(draft?.title ?? `${brandName} · Triggers & Barriers`);
  const [headline, setHeadline] = useState(draft?.headline ?? `Qué mueve y qué frena la decisión sobre ${brandName}`);
  const [summary, setSummary] = useState(
    draft?.summary ??
      "Lectura client-safe del corpus aprobado: T&B Decision Field, patrones emergentes, inteligencia competitiva, acciones por equipo, evidencia y límites del análisis."
  );
  const [manifest, setManifest] = useState(initialManifest);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outputId, setOutputId] = useState(draft?.id ?? null);
  const [status, setStatus] = useState(draft?.status ?? "sin preparar");

  const selectedCount = signalModuleMeta.filter((module) => manifest[module.key]).length;

  function toggleModule(key: SignalModuleKey) {
    setManifest((current) => ({ ...current, [key]: !current[key] }));
  }

  function submit(action: "save_draft" | "publish") {
    setError(null);
    setFeedback(null);

    startTransition(async () => {
      const response = await fetch(`/api/corpora/${corpusId}/tb-analysis/${analysisId}/signal-output`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, headline, summary, manifest, action })
      });
      const payload = await response.json() as {
        output?: { id: string; status: string; title: string };
        message?: string;
      };

      if (!response.ok || !payload.output) {
        setError(payload.message ?? "No se pudo preparar Signal.");
        return;
      }

      setOutputId(payload.output.id);
      setStatus(payload.output.status);
      setFeedback(action === "publish" ? "Signal publicado para cliente." : "Borrador guardado.");
      router.refresh();
    });
  }

  return (
    <section className="signal-composer-card">
      <div className="signal-composer-head">
        <div>
          <p className="vitals-eyebrow">Siguiente paso</p>
          <h2>Preparar Noisia Signal</h2>
          <p>
            Elige qué secciones entran al cockpit cliente. El output queda congelado
            como snapshot publicado con hallazgos, evidencia, límites y corpus view.
          </p>
        </div>
        <div className="signal-composer-status">
          <span>{status}</span>
          <strong>{selectedCount} módulos</strong>
        </div>
      </div>

      <div className="signal-composer-form">
        <label>
          <span>Título interno</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          <span>Headline editorial</span>
          <input value={headline} onChange={(event) => setHeadline(event.target.value)} />
        </label>
        <label className="signal-composer-summary">
          <span>Resumen para cliente</span>
          <textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={4} />
        </label>
      </div>

      <div className="signal-module-grid">
        {signalModuleMeta.map((module) => {
          const active = manifest[module.key];
          return (
            <button
              className={`signal-module-card${active ? " signal-module-card--active" : ""}`}
              key={module.key}
              onClick={() => toggleModule(module.key)}
              type="button"
            >
              <span className={`signal-module-status signal-module-status--${module.status}`}>
                {module.status === "ready" ? "Listo" : module.status === "partial" ? "Beta" : "Hold"}
              </span>
              <strong>{module.label}</strong>
              <p>{module.description}</p>
              <span className="signal-module-check">
                {active ? <Icon name="check" size={15} /> : <Icon name="x" size={15} />}
              </span>
            </button>
          );
        })}
      </div>

      <footer className="signal-composer-actions">
        <div>
          {feedback ? <p className="analysis-action-success">{feedback}</p> : null}
          {error ? <p className="analysis-action-error">{error}</p> : null}
        </div>
        <div className="signal-composer-buttons">
          {outputId ? (
            <Link prefetch={false} className="wizard-cta wizard-cta--secondary" href={`/signal/${outputId}`}>
              <Icon name="external" size={15} /> Abrir Signal
            </Link>
          ) : null}
          <button className="wizard-cta wizard-cta--secondary" disabled={isPending} onClick={() => submit("save_draft")} type="button">
            {isPending ? <Icon name="spinner" size={15} /> : <Icon name="pencil" size={15} />}
            Guardar borrador
          </button>
          <button className="wizard-cta" disabled={isPending} onClick={() => submit("publish")} type="button">
            {isPending ? <Icon name="spinner" size={15} /> : <Icon name="play" size={15} />}
            Publicar
          </button>
        </div>
      </footer>
    </section>
  );
}

function normalizeManifest(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultSignalManifest;
  }
  const input = value as Partial<Record<SignalModuleKey, boolean>> & Record<string, unknown>;
  return {
    ...defaultSignalManifest,
    ...legacyManifestToV2(input),
    ...input
  };
}

function legacyManifestToV2(input: Record<string, unknown>): Partial<Record<SignalModuleKey, boolean>> {
  const hasV2 = signalModuleMeta.some((module) => Object.prototype.hasOwnProperty.call(input, module.key));
  if (hasV2) return {};

  return {
    overview: booleanOrDefault(input.overview, defaultSignalManifest.overview),
    tb_decision_field: booleanOrDefault(input.tension_map, defaultSignalManifest.tb_decision_field),
    opportunities: booleanOrDefault(input.overview, defaultSignalManifest.opportunities),
    competitive_intelligence: booleanOrDefault(input.compare, defaultSignalManifest.competitive_intelligence),
    action_studio: booleanOrDefault(input.actions, defaultSignalManifest.action_studio),
    evidence: booleanOrDefault(input.verbatims, defaultSignalManifest.evidence),
    quality_boundaries: true,
    emerging_patterns: true,
    corpus_view: booleanOrDefault(input.verbatims, defaultSignalManifest.corpus_view)
  };
}

function booleanOrDefault(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

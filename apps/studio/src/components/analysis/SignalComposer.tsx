"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/ui/Icon";
import { composerModulesForLenses, labelForLens, normalizeStudyAnalysisPlan } from "@/lib/multimethod/analysis-plan";
import {
  defaultSignalDemoBlurredSections,
  defaultSignalManifest,
  normalizeSignalDemoMode,
  normalizeSignalOutputManifest,
  serializeSignalDemoMode,
  signalModuleMeta,
  type SignalOutputManifest,
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

type PublishFailure = {
  methodology_slug: string;
  module_key: string;
  error: string;
  message: string;
  failed_checks: Array<{ id: string; detail: string }>;
};

export function SignalComposer({
  corpusId,
  analysisId,
  brandName,
  analysisPlan,
  draft
}: {
  corpusId: string;
  analysisId: string;
  brandName: string;
  analysisPlan: unknown;
  draft: DraftOutput;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const studyPlan = useMemo(() => normalizeStudyAnalysisPlan(analysisPlan), [analysisPlan]);
  const plannedModuleKeys = useMemo(
    () => composerModulesForLenses(studyPlan.selected_lenses).filter(isSignalModuleKey),
    [studyPlan.selected_lenses]
  );
  const initialManifest = useMemo(
    () => normalizeManifest(draft?.manifest, plannedModuleKeys),
    [draft?.manifest, plannedModuleKeys]
  );
  const [title, setTitle] = useState(draft?.title ?? `${brandName} · Triggers & Barriers`);
  const [headline, setHeadline] = useState(draft?.headline ?? `Qué mueve y qué frena la decisión sobre ${brandName}`);
  const [summary, setSummary] = useState(
    draft?.summary ??
      "Lectura client-safe del corpus aprobado: T&B Decision Field, patrones emergentes, inteligencia competitiva, acciones por equipo, evidencia y límites del análisis."
  );
  const [manifest, setManifest] = useState(initialManifest);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishFailures, setPublishFailures] = useState<PublishFailure[]>([]);
  const [outputId, setOutputId] = useState(draft?.id ?? null);
  const [status, setStatus] = useState(draft?.status ?? "sin preparar");

  const selectedCount = signalModuleMeta.filter((module) => manifest[module.key]).length;
  const demoMode = useMemo(() => normalizeSignalDemoMode(manifest.demo_mode), [manifest.demo_mode]);
  const demoBlurredCount = signalModuleMeta.filter(
    (module) => manifest[module.key] && demoMode.blurredSections.includes(module.key)
  ).length;

  function toggleModule(key: SignalModuleKey) {
    setManifest((current) => ({ ...current, [key]: !current[key] }));
  }

  function toggleDemoMode() {
    setManifest((current) => {
      const currentDemo = normalizeSignalDemoMode(current.demo_mode);
      return {
        ...current,
        demo_mode: serializeSignalDemoMode({
          enabled: !currentDemo.enabled,
          blurredSections: currentDemo.blurredSections.length > 0
            ? currentDemo.blurredSections
            : defaultSignalDemoBlurredSections
        })
      };
    });
  }

  function toggleDemoBlur(key: SignalModuleKey) {
    setManifest((current) => {
      const currentDemo = normalizeSignalDemoMode(current.demo_mode);
      const blurredSections = currentDemo.blurredSections.includes(key)
        ? currentDemo.blurredSections.filter((section) => section !== key)
        : [...currentDemo.blurredSections, key];
      return {
        ...current,
        demo_mode: serializeSignalDemoMode({
          ...currentDemo,
          blurredSections
        })
      };
    });
  }

  function submit(action: "save_draft" | "publish") {
    setError(null);
    setFeedback(null);
    setPublishFailures([]);

    startTransition(async () => {
      const response = await fetch(`/api/corpora/${corpusId}/tb-analysis/${analysisId}/signal-output`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, headline, summary, manifest, action })
      });
      const payload = await response.json() as {
        output?: { id: string; status: string; title: string };
        message?: string;
        failed_lenses?: PublishFailure[];
      };

      if (!response.ok || !payload.output) {
        setError(payload.message ?? "No se pudo preparar Signal.");
        setPublishFailures(Array.isArray(payload.failed_lenses) ? payload.failed_lenses : []);
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
            Elige qué módulos vivos entran al cockpit cliente. El reporte queda publicado
            con lectura editorial, pero consulta corpus, historia y lentes desde DB.
          </p>
        </div>
        <div className="signal-composer-status">
          <span>{status}</span>
          <strong>{selectedCount} módulos</strong>
          {demoMode.enabled ? <small>{demoBlurredCount} blurred</small> : null}
        </div>
      </div>

      <div className="signal-composer-plan">
        <span>Plan del estudio</span>
        {studyPlan.selected_lenses.map((slug) => (
          <small key={slug}>{labelForLens(slug)}</small>
        ))}
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

      <div className={`signal-demo-panel${demoMode.enabled ? " signal-demo-panel--active" : ""}`}>
        <label className="signal-demo-switch">
          <input checked={demoMode.enabled} onChange={toggleDemoMode} type="checkbox" />
          <span className="signal-demo-switch-copy">
            <strong>Demo mode</strong>
            <small>
              Publica una vista de prueba: las secciones marcadas se ven blurred en Signal. El deck de prensa no cambia.
            </small>
          </span>
        </label>
        {demoMode.enabled ? (
          <p>
            Marca “Blur demo” en los módulos premium. Los módulos apagados no se publican.
          </p>
        ) : null}
      </div>

      <div className="signal-module-grid">
        {signalModuleMeta.map((module) => {
          const active = manifest[module.key];
          const demoLocked = demoMode.enabled && demoMode.blurredSections.includes(module.key);
          return (
            <article
              className={`signal-module-card${active ? " signal-module-card--active" : ""}${demoLocked ? " signal-module-card--demo-locked" : ""}`}
              key={module.key}
            >
              <button className="signal-module-card-main" onClick={() => toggleModule(module.key)} type="button">
                <span className={`signal-module-status signal-module-status--${module.status}`}>
                  {module.status === "ready" ? "Listo" : module.status === "partial" ? "Beta" : "Hold"}
                </span>
                <strong>{module.label}</strong>
                <p>{module.description}</p>
                <span className="signal-module-check">
                  {active ? <Icon name="check" size={15} /> : <Icon name="x" size={15} />}
                </span>
              </button>
              {demoMode.enabled ? (
                <label className="signal-module-demo-toggle">
                  <input
                    checked={demoLocked}
                    disabled={!active}
                    onChange={() => toggleDemoBlur(module.key)}
                    type="checkbox"
                  />
                  <span>Blur demo</span>
                </label>
              ) : null}
            </article>
          );
        })}
      </div>

      <footer className="signal-composer-actions">
        <div>
          {feedback ? <p className="analysis-action-success">{feedback}</p> : null}
          {error ? <p className="analysis-action-error">{error}</p> : null}
          {publishFailures.length > 0 ? (
            <div className="signal-publish-failures">
              {publishFailures.map((failure) => (
                <article key={`${failure.methodology_slug}-${failure.error}`}>
                  <strong>{labelForLens(failure.methodology_slug)}</strong>
                  <span>{failure.message}</span>
                  {failure.failed_checks.length > 0 ? (
                    <small>{failure.failed_checks.map((check) => check.detail).join(" · ")}</small>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
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

function normalizeManifest(value: unknown, plannedModuleKeys: SignalModuleKey[]): SignalOutputManifest {
  const recommended = {
    ...defaultSignalManifest,
    ...Object.fromEntries(plannedModuleKeys.map((key) => [key, true]))
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return normalizeSignalOutputManifest(recommended);
  }
  const input = value as Partial<Record<SignalModuleKey, boolean>> & Record<string, unknown>;
  return normalizeSignalOutputManifest({
    ...recommended,
    ...legacyManifestToV2(input),
    ...input
  });
}

function legacyManifestToV2(input: Record<string, unknown>): Partial<Record<SignalModuleKey, boolean>> {
  const hasV2 = signalModuleMeta.some((module) => Object.prototype.hasOwnProperty.call(input, module.key));
  if (hasV2) return {};

  return {
    overview: booleanOrDefault(input.overview, defaultSignalManifest.overview),
    live_composer: booleanOrDefault(input.overview, defaultSignalManifest.live_composer),
    engine_methodology: booleanOrDefault(input.engine_methodology, defaultSignalManifest.engine_methodology),
    tb_decision_field: booleanOrDefault(input.tension_map, defaultSignalManifest.tb_decision_field),
    opportunities: booleanOrDefault(input.overview, defaultSignalManifest.opportunities),
    competitive_intelligence: booleanOrDefault(input.compare, defaultSignalManifest.competitive_intelligence),
    tb_comparative_dashboard: booleanOrDefault(input.compare, defaultSignalManifest.tb_comparative_dashboard),
    competitive_tb_matrix: booleanOrDefault(input.compare, defaultSignalManifest.competitive_tb_matrix),
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

function isSignalModuleKey(value: string): value is SignalModuleKey {
  return signalModuleMeta.some((module) => module.key === value);
}

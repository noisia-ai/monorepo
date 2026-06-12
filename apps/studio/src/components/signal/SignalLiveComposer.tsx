"use client";

import { useEffect, useMemo, useState } from "react";

import { useSignalDateRange, useSignalUiLanguage, type SignalUiLanguage } from "@/components/signal/SignalReportShell";
import { Icon } from "@/components/ui/Icon";
import { buildComposerEditorialDraft, composerChartKey, composerChartKeysForModule } from "@/lib/live-intelligence/composer";
import { labelForLens } from "@/lib/multimethod/analysis-plan";

type ComposerSignal = {
  canonical_signal_id: string;
  methodology_slug: string;
  signal_type: string;
  title: string;
  status: string;
  frequency: number;
  share_pct: number | null;
  intensity: number | null;
  sentiment: number | null;
  composite_score: number | null;
  confidence: string | null;
  delta_vs_previous: number | null;
  evidence_count: number;
  supporting_methodologies: string[];
  supporting_signal_count: number;
  supporting_evidence_count: number;
  evidence_examples: ComposerEvidenceExample[];
};

type ComposerEvidenceExample = {
  observation_id: string | null;
  mention_id: string | null;
  source_id: string | null;
  quote: string;
  platform: string | null;
  published_at: string | null;
  evidence_role: string | null;
  is_protagonist: boolean;
};

type ComposerModule = {
  methodology_slug: string;
  total_signals: number;
  total_frequency: number;
  evidence_count: number;
  signal_types: Record<string, number>;
  top_signals: ComposerSignal[];
};

type ComposerDraftPayload = {
  kind: string;
  version: number;
  selection: {
    methodologies: string[];
    signalTypes: string[];
    statuses: string[];
    chartKeys: string[];
  };
  module_slugs: string[];
  module_chart_keys: Record<string, string[]>;
  selected_chart_keys: string[];
  selected_canonical_signal_ids: string[];
  supporting_signal_ids: string[];
  supporting_observation_ids: string[];
  opportunity_signal_ids: string[];
  risk_signal_ids: string[];
  evidence_mention_ids: string[];
  lens_statuses: ComposerLensStatus[];
  lens_status_summary: {
    total: number;
    active: number;
    ready: number;
    running: number;
    blocked: number;
    no_signals: number;
  };
  totals: {
    raw_signals: number;
    deduped_signals: number;
    modules: number;
    charts: number;
    opportunities: number;
    risks: number;
    evidence_examples: number;
    available_modules?: number;
    selected_modules?: number;
    available_charts?: number;
    selected_charts?: number;
    available_signals?: number;
    selected_signals?: number;
  };
};

type ComposerEditorialSelection = {
  methodologies: string[];
  signalTypes: string[];
  statuses: string[];
  modules: string[];
  chartKeys: string[];
  canonicalSignalIds: string[];
  opportunitySignalIds: string[];
  riskSignalIds: string[];
};

type ComposerPayload = {
  ok: boolean;
  analysis_plan: {
    selected_lenses: string[];
    composer_modules: string[];
  } | null;
  scope: {
    brand_id: string | null;
    theme_id: string | null;
    study_corpus_id: string | null;
    base_corpus_id: string | null;
  };
  available: {
    methodologies: string[];
    signal_types: string[];
    statuses: string[];
  };
  selection: {
    methodologies: string[];
    signalTypes: string[];
    statuses: string[];
    chartKeys: string[];
  };
  draft: ComposerDraftPayload | null;
  editorial: {
    id: string | null;
    status: string;
    selection: ComposerEditorialSelection;
    draft: ComposerDraftPayload | null;
    updated_at: string | null;
    notes: string | null;
  } | null;
  modules: ComposerModule[];
  opportunities: ComposerSignal[];
  risks: ComposerSignal[];
  editorial_applied: boolean;
  lens_statuses: ComposerLensStatus[];
  candidates?: {
    draft: ComposerDraftPayload | null;
    modules: ComposerModule[];
    opportunities: ComposerSignal[];
    risks: ComposerSignal[];
  };
};

type ComposerLensStatus = {
  methodology_slug: string;
  status: "active" | "ready" | "queued" | "running" | "needs_review" | "approved" | "failed" | "blocked" | "no_signals" | "not_started";
  engine_analysis_id: string | null;
  current_step: string | null;
  signals_in_range: number;
  evidence_in_range: number;
  message: string | null;
  readiness: ComposerLensReadiness | null;
  quality_gates_failed: Array<{ id: string; detail: string }>;
};

type ComposerLensReadiness = {
  status: "ready" | "directional" | "blocked";
  hard_failures: string[];
  warnings: string[];
  summary: {
    requiredScopes: string[];
    importedScopes: string[];
    missingScopes: string[];
    scopeCoverage: Array<{
      scope: string;
      mentionCount: number;
      status: string;
    }>;
  };
};

type ComposerSignalSource = {
  modules: ComposerModule[];
  opportunities: ComposerSignal[];
  risks: ComposerSignal[];
} | null;

const copy = {
  en: {
    eyebrow: "Report Composer",
    title: "Multi-method intelligence layer",
    body: "Signals are deduped across methods and turned into opportunities and risks from the live intelligence store.",
    modules: "modules",
    modulesHelp: "Modules group live signals by lens/method. Use them to decide which methods feed the final report.",
    allMethods: "All methods",
    allSignalTypes: "All signals",
    allStatuses: "All statuses",
    selectedMethods: "selected methods",
    selectedSignalTypes: "selected signal types",
    selectedStatuses: "selected statuses",
    opportunities: "opportunities",
    opportunitiesHelp: "Opportunities are positive, valuable or movable signals inside the active date range.",
    risks: "risks",
    risksHelp: "Risks are barriers, frictions or negative signals inside the active date range.",
    loading: "Loading composer...",
    empty: "No live signals available yet.",
    emptySelection: "No live signals match this method selection.",
    evidence: "evidence",
    range: "Active range",
    plannedLenses: "Study plan",
    lensHealth: "Lens health",
    methods: "methods",
    mentions: "mentions",
    signalMentions: "signal mentions",
    editorTitle: "Editorial selection",
    editorBody: "Choose which lenses and signals make it into the composed report draft. Filters change the candidate set; this editor saves the actual editorial cut.",
    selectedModules: "selected modules",
    selectedCharts: "selected charts",
    selectedSignals: "selected signals",
    selectedEvidence: "evidence examples",
    selectAll: "Select all",
    clearSelection: "Clear selection",
    included: "Included",
    omitted: "Omitted",
    include: "Include",
    omit: "Omit",
    saveDraft: "Save editorial draft",
    savingDraft: "Saving",
    savedDraft: "Saved",
    saveError: "Could not save",
    savedAt: "Saved at",
    narrativeBeta: "Narrative Ownership beta",
    narrativeBetaHelp: "Open the controlled beta lens. It uses the live corpus and stays technical until QA approves it.",
    lensStatus: {
      active: "active",
      ready: "ready",
      queued: "queued",
      running: "running",
      needs_review: "needs review",
      approved: "approved",
      failed: "failed",
      blocked: "blocked",
      no_signals: "no signals",
      not_started: "not started"
    }
  },
  es: {
    eyebrow: "Report Composer",
    title: "Capa de inteligencia multimétodo",
    body: "Las señales se deduplican entre métodos y se convierten en oportunidades y riesgos desde el intelligence store vivo.",
    modules: "módulos",
    modulesHelp: "Los módulos agrupan señales vivas por lente o método. Úsalos para decidir qué métodos alimentan el reporte final.",
    allMethods: "Todos los métodos",
    allSignalTypes: "Todas las señales",
    allStatuses: "Todos los estados",
    selectedMethods: "métodos seleccionados",
    selectedSignalTypes: "tipos de señal seleccionados",
    selectedStatuses: "estados seleccionados",
    opportunities: "oportunidades",
    opportunitiesHelp: "Las oportunidades son señales positivas, de valor o movibles dentro del rango activo.",
    risks: "riesgos",
    risksHelp: "Los riesgos son barreras, fricciones o señales negativas dentro del rango activo.",
    loading: "Cargando composer...",
    empty: "Aún no hay señales vivas disponibles.",
    emptySelection: "No hay señales vivas para esta selección de métodos.",
    evidence: "evidencia",
    range: "Rango activo",
    plannedLenses: "Plan del estudio",
    lensHealth: "Estado de lentes",
    methods: "métodos",
    mentions: "menciones",
    signalMentions: "menciones de señal",
    editorTitle: "Selección editorial",
    editorBody: "Elige qué lentes y señales entran al draft compuesto. Los filtros cambian los candidatos; este editor guarda el corte editorial real.",
    selectedModules: "módulos elegidos",
    selectedCharts: "charts elegidos",
    selectedSignals: "señales elegidas",
    selectedEvidence: "evidencias",
    selectAll: "Seleccionar todo",
    clearSelection: "Limpiar selección",
    included: "Incluido",
    omitted: "Omitido",
    include: "Incluir",
    omit: "Omitir",
    saveDraft: "Guardar draft editorial",
    savingDraft: "Guardando",
    savedDraft: "Guardado",
    saveError: "No se pudo guardar",
    savedAt: "Guardado",
    narrativeBeta: "Narrative Ownership beta",
    narrativeBetaHelp: "Abre el lente beta controlado. Usa el corpus vivo y se mantiene técnico hasta pasar QA.",
    lensStatus: {
      active: "activo",
      ready: "listo",
      queued: "en cola",
      running: "corriendo",
      needs_review: "requiere review",
      approved: "aprobado",
      failed: "falló",
      blocked: "bloqueado",
      no_signals: "sin señales",
      not_started: "no iniciado"
    }
  }
};

const signalPulseComposerCopy = {
  en: {
    eyebrow: "Pulse Composer",
    title: "Monthly editorial cut",
    body: "Approve which signals, moves and evidence belong in the tactical marketing read.",
    modules: "pulse modules",
    modulesHelp: "Signal Pulse groups live signals into one tactical module. Use it to keep or remove the signals that should appear in the monthly read.",
    allMethods: "All Pulse signals",
    selectedMethods: "selected Pulse modules",
    plannedLenses: "Pulse plan",
    lensHealth: "Pulse health",
    narrativeBeta: "Open Signal Pulse run",
    narrativeBetaHelp: "Open the internal Signal Pulse runtime for this corpus.",
    editorTitle: "Pulse selection",
    editorBody: "Choose the signals and evidence that should remain in the published monthly cut. This is the editorial approval layer, not a new analysis run.",
    saveDraft: "Save Pulse draft"
  },
  es: {
    eyebrow: "Pulse Composer",
    title: "Corte editorial mensual",
    body: "Aprueba qué señales, moves y evidencia quedan dentro de la lectura táctica de marketing.",
    modules: "módulos Pulse",
    modulesHelp: "Signal Pulse agrupa señales vivas en un módulo táctico. Úsalo para conservar o quitar las señales que entran al corte mensual.",
    allMethods: "Todas las señales Pulse",
    selectedMethods: "módulos Pulse seleccionados",
    plannedLenses: "Plan Pulse",
    lensHealth: "Salud del Pulse",
    narrativeBeta: "Abrir corrida Signal Pulse",
    narrativeBetaHelp: "Abre el runtime interno de Signal Pulse para este corpus.",
    editorTitle: "Selección Pulse",
    editorBody: "Elige las señales y evidencia que deben permanecer en el corte mensual publicado. Es aprobación editorial, no una corrida nueva.",
    saveDraft: "Guardar draft Pulse"
  }
} satisfies Record<SignalUiLanguage, Partial<typeof copy.en>>;

export function SignalLiveComposer({
  outputId,
  variant = "signal"
}: {
  outputId: string;
  variant?: "signal" | "signal_pulse";
}) {
  const { uiLanguage } = useSignalUiLanguage();
  const { dateFrom, dateTo, queryString } = useSignalDateRange();
  const t = variant === "signal_pulse"
    ? { ...copy[uiLanguage], ...signalPulseComposerCopy[uiLanguage] }
    : copy[uiLanguage];
  const [payload, setPayload] = useState<ComposerPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [selectedMethodologies, setSelectedMethodologies] = useState<string[]>([]);
  const [selectedSignalTypes, setSelectedSignalTypes] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedModuleSlugs, setSelectedModuleSlugs] = useState<string[]>([]);
  const [selectedChartKeys, setSelectedChartKeys] = useState<string[]>([]);
  const [selectedSignalIds, setSelectedSignalIds] = useState<string[]>([]);
  const [editorSeedKey, setEditorSeedKey] = useState("");
  const editorPayload = payload?.candidates ?? payload;
  const editorDraft = editorPayload?.draft ?? null;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(queryString);
    if (selectedMethodologies.length > 0) {
      params.set("methodologies", selectedMethodologies.join(","));
    }
    if (selectedSignalTypes.length > 0) {
      params.set("signalTypes", selectedSignalTypes.join(","));
    }
    if (selectedStatuses.length > 0) {
      params.set("statuses", selectedStatuses.join(","));
    }
    const query = params.toString();
    setIsLoading(true);
    fetch(`/api/signal/${outputId}/composer${query ? `?${query}` : ""}`, { cache: "no-store", signal: controller.signal })
      .then((res) => res.ok ? res.json() : Promise.reject(new Error(`Composer request failed: ${res.status}`)))
      .then((data) => setPayload(normalizePayload(data)))
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setPayload(emptyPayload());
      })
      .finally(() => setIsLoading(false));
    return () => controller.abort();
  }, [outputId, queryString, selectedMethodologies, selectedSignalTypes, selectedStatuses]);

  useEffect(() => {
    const baseDraft = payload?.candidates?.draft ?? payload?.draft;
    if (!payload || !baseDraft) return;
    const seedKey = [
      outputId,
      dateFrom,
      dateTo,
      payload.editorial?.updated_at ?? "unsaved",
      baseDraft.selected_canonical_signal_ids.join("|")
    ].join(":");
    if (seedKey === editorSeedKey) return;
    const savedDraft = payload.editorial?.draft;
    const sourceDraft = savedDraft ?? baseDraft;
    setSelectedModuleSlugs(sourceDraft.module_slugs.length ? sourceDraft.module_slugs : baseDraft.module_slugs);
    setSelectedChartKeys(sourceDraft.selected_chart_keys.length ? sourceDraft.selected_chart_keys : baseDraft.selected_chart_keys);
    setSelectedSignalIds(sourceDraft.selected_canonical_signal_ids);
    setEditorSeedKey(seedKey);
    setSaveStatus("idle");
  }, [dateFrom, dateTo, editorSeedKey, outputId, payload]);

  const metrics = useMemo(() => {
    const signalMentions = (payload?.modules ?? []).reduce((sum, module) => sum + module.total_frequency, 0);
    return {
      modules: payload?.modules.length ?? 0,
      opportunities: payload?.opportunities.length ?? 0,
      risks: payload?.risks.length ?? 0,
      signalMentions
    };
  }, [payload]);
  const availableMethodologies = payload?.available.methodologies ?? [];
  const plannedLenses = payload?.analysis_plan?.selected_lenses ?? [];
  const lensStatuses = useMemo(() => payload?.lens_statuses ?? [], [payload?.lens_statuses]);
  const availableSignalTypes = payload?.available.signal_types ?? [];
  const availableStatuses = payload?.available.statuses ?? [];
  const hasSelection = selectedMethodologies.length > 0 || selectedSignalTypes.length > 0 || selectedStatuses.length > 0;
  const editorialDraft = useMemo(() => editorPayload?.draft ? buildComposerEditorialDraft({
    baseDraft: editorPayload.draft,
    modules: editorPayload.modules,
    opportunities: editorPayload.opportunities,
    risks: editorPayload.risks,
    selectedModuleSlugs,
    selectedChartKeys,
    selectedCanonicalSignalIds: selectedSignalIds,
    selection: {
      methodologies: selectedMethodologies,
      signalTypes: selectedSignalTypes,
      statuses: selectedStatuses,
      chartKeys: selectedChartKeys
    },
    lensStatuses
  }) : null, [editorPayload, lensStatuses, selectedChartKeys, selectedMethodologies, selectedModuleSlugs, selectedSignalIds, selectedSignalTypes, selectedStatuses]);
  const selectedSignalSet = useMemo(() => new Set(selectedSignalIds), [selectedSignalIds]);
  const selectedModuleSet = useMemo(() => new Set(selectedModuleSlugs), [selectedModuleSlugs]);
  const selectedChartSet = useMemo(() => new Set(selectedChartKeys), [selectedChartKeys]);

  function toggleSelection(value: string, setter: (updater: (current: string[]) => string[]) => void) {
    setter((current) => current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value].sort());
  }

  function markEditorDirty() {
    if (saveStatus === "saved") setSaveStatus("idle");
  }

  function toggleModule(moduleSlug: string) {
    markEditorDirty();
    setSelectedModuleSlugs((current) => {
      const removing = current.includes(moduleSlug);
      const next = removing ? current.filter((item) => item !== moduleSlug) : [...current, moduleSlug].sort();
      const moduleSignals = signalsForModule(moduleSlug, editorPayload).map((signal) => signal.canonical_signal_id);
      const moduleChartKeys = composerChartKeysForModule(moduleSlug).map((chartSlug) => composerChartKey(moduleSlug, chartSlug));
      setSelectedChartKeys((chartKeys) => removing
        ? chartKeys.filter((chartKey) => !moduleChartKeys.includes(chartKey))
        : Array.from(new Set([...chartKeys, ...moduleChartKeys])).sort());
      setSelectedSignalIds((signalIds) => removing
        ? signalIds.filter((id) => !moduleSignals.includes(id))
        : Array.from(new Set([...signalIds, ...moduleSignals])).sort());
      return next;
    });
  }

  function toggleChart(moduleSlug: string, chartSlug: string) {
    markEditorDirty();
    const chartKey = composerChartKey(moduleSlug, chartSlug);
    setSelectedChartKeys((current) => current.includes(chartKey)
      ? current.filter((item) => item !== chartKey)
      : [...current, chartKey].sort());
  }

  function toggleSignal(signalId: string) {
    markEditorDirty();
    setSelectedSignalIds((current) => current.includes(signalId)
      ? current.filter((item) => item !== signalId)
      : [...current, signalId].sort());
  }

  function selectAllEditorial() {
    if (!editorDraft) return;
    markEditorDirty();
    setSelectedModuleSlugs(editorDraft.module_slugs);
    setSelectedChartKeys(editorDraft.selected_chart_keys);
    setSelectedSignalIds(editorDraft.selected_canonical_signal_ids);
  }

  function clearEditorialSelection() {
    markEditorDirty();
    setSelectedModuleSlugs([]);
    setSelectedChartKeys([]);
    setSelectedSignalIds([]);
  }

  async function handleSaveComposerDraft() {
    if (!editorDraft || !editorialDraft) return;
    setSaveStatus("saving");
    try {
      const response = await fetch(`/api/signal/${outputId}/composer`, {
        body: JSON.stringify({
          dateFrom,
          dateTo,
          selection: {
            methodologies: selectedMethodologies,
            signalTypes: selectedSignalTypes,
            statuses: selectedStatuses,
            modules: selectedModuleSlugs,
            chartKeys: editorialDraft.selected_chart_keys,
            canonicalSignalIds: editorialDraft.selected_canonical_signal_ids,
            opportunitySignalIds: editorialDraft.opportunity_signal_ids,
            riskSignalIds: editorialDraft.risk_signal_ids
          },
          draft: editorialDraft
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const next = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(next?.message ?? `Composer save failed: ${response.status}`);
      setPayload((current) => current ? normalizePayload({ ...current, editorial: next.editorial ?? current.editorial }) : current);
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  }

  return (
    <section className="signal-live-composer">
      <header>
        <div>
          <p className="signal-eyebrow">{t.eyebrow}</p>
          <h3>{t.title}</h3>
          <span>{t.body}</span>
          <small className="signal-live-composer-range">
            {t.range}: {formatRange(dateFrom, dateTo)} · {metrics.signalMentions} {t.signalMentions}
          </small>
          {plannedLenses.length > 0 ? (
            <LensStatusRail
              copy={t}
              lensStatuses={lensStatuses}
              plannedLenses={plannedLenses}
            />
          ) : null}
        </div>
        <dl>
          <div><dt>{t.modules}</dt><dd>{metrics.modules}</dd></div>
          <div><dt>{t.opportunities}</dt><dd>{metrics.opportunities}</dd></div>
          <div><dt>{t.risks}</dt><dd>{metrics.risks}</dd></div>
        </dl>
      </header>

      <div className="signal-live-composer-actions">
        <button
          disabled={isLoading || !editorialDraft || saveStatus === "saving"}
          onClick={handleSaveComposerDraft}
          type="button"
        >
          <Icon name={saveStatus === "saving" ? "spinner" : "pencil"} size={15} />
          {saveStatus === "saving" ? t.savingDraft : saveStatus === "saved" ? t.savedDraft : t.saveDraft}
        </button>
        {saveStatus === "error" ? <small className="is-error">{t.saveError}</small> : null}
        {payload?.editorial?.updated_at ? (
          <small>{t.savedAt}: {formatSavedAt(payload.editorial.updated_at)}</small>
        ) : null}
        {payload?.scope.study_corpus_id && variant !== "signal_pulse" ? (
          <a
            href={`/studio/corpora/${payload.scope.study_corpus_id}/engine?engineBeta=1&methodology=narrative-ownership`}
            title={t.narrativeBetaHelp}
          >
            <Icon name="sparkle" size={15} />
            {t.narrativeBeta}
          </a>
        ) : null}
      </div>

      {editorDraft ? (
        <section className="signal-live-composer-editor">
          <header>
            <div>
              <h4>{t.editorTitle}</h4>
              <p>{t.editorBody}</p>
            </div>
            <div className="signal-live-composer-editor-actions">
              <button onClick={selectAllEditorial} type="button">{t.selectAll}</button>
              <button onClick={clearEditorialSelection} type="button">{t.clearSelection}</button>
            </div>
          </header>
          <dl>
            <div><dt>{t.selectedModules}</dt><dd>{editorialDraft?.totals.selected_modules ?? 0}</dd></div>
            <div><dt>{t.selectedCharts}</dt><dd>{editorialDraft?.totals.selected_charts ?? 0}</dd></div>
            <div><dt>{t.selectedSignals}</dt><dd>{editorialDraft?.totals.selected_signals ?? 0}</dd></div>
          </dl>
        </section>
      ) : null}

      {availableMethodologies.length > 1 ? (
        <div className="signal-live-composer-filters" aria-label={t.selectedMethods}>
          <button
            className={!hasSelection ? "is-active" : ""}
            onClick={() => setSelectedMethodologies([])}
            type="button"
          >
            {t.allMethods}
          </button>
          {availableMethodologies.map((methodology) => (
              <button
                className={selectedMethodologies.includes(methodology) ? "is-active" : ""}
                key={methodology}
              onClick={() => toggleSelection(methodology, setSelectedMethodologies)}
                type="button"
              >
                {prettifyKey(methodology)}
              </button>
            ))}
        </div>
      ) : null}

      {availableSignalTypes.length > 1 ? (
        <div className="signal-live-composer-filters" aria-label={t.selectedSignalTypes}>
          <button
            className={selectedSignalTypes.length === 0 ? "is-active" : ""}
            onClick={() => setSelectedSignalTypes([])}
            type="button"
          >
            {t.allSignalTypes}
          </button>
          {availableSignalTypes.map((signalType) => (
            <button
              className={selectedSignalTypes.includes(signalType) ? "is-active" : ""}
              key={signalType}
              onClick={() => toggleSelection(signalType, setSelectedSignalTypes)}
              type="button"
            >
              {prettifyKey(signalType)}
            </button>
          ))}
        </div>
      ) : null}

      {availableStatuses.length > 1 ? (
        <div className="signal-live-composer-filters" aria-label={t.selectedStatuses}>
          <button
            className={selectedStatuses.length === 0 ? "is-active" : ""}
            onClick={() => setSelectedStatuses([])}
            type="button"
          >
            {t.allStatuses}
          </button>
          {availableStatuses.map((status) => (
            <button
              className={selectedStatuses.includes(status) ? "is-active" : ""}
              key={status}
              onClick={() => toggleSelection(status, setSelectedStatuses)}
              type="button"
            >
              {prettifyKey(status)}
            </button>
          ))}
        </div>
      ) : null}

      {isLoading ? (
        <div className="signal-live-composer-empty"><Icon name="refresh" size={16} /> {t.loading}</div>
      ) : (editorPayload?.modules.length ?? 0) === 0 ? (
        <div className="signal-live-composer-empty"><Icon name="info" size={16} /> {hasSelection ? t.emptySelection : t.empty}</div>
      ) : (
        <div className="signal-live-composer-grid">
          <section>
            <SectionTitle label={t.modules} help={t.modulesHelp} />
            {(editorPayload?.modules ?? []).slice(0, 6).map((module) => (
              <article className={selectedModuleSet.has(module.methodology_slug) ? "is-selected" : "is-muted"} key={module.methodology_slug}>
                <header>
                  <strong>{prettifyKey(module.methodology_slug)}</strong>
                  <button
                    aria-pressed={selectedModuleSet.has(module.methodology_slug)}
                    className="signal-live-composer-toggle"
                    onClick={() => toggleModule(module.methodology_slug)}
                    type="button"
                  >
                    <Icon name={selectedModuleSet.has(module.methodology_slug) ? "check" : "x"} size={13} />
                    {selectedModuleSet.has(module.methodology_slug) ? t.included : t.omitted}
                  </button>
                </header>
                <p>{module.total_frequency} {t.mentions} · {module.evidence_count} {t.evidence}</p>
                <div>
                  {Object.entries(module.signal_types).slice(0, 4).map(([key, count]) => (
                    <small key={key}>{prettifyKey(key)} {count}</small>
                  ))}
                </div>
                <div className="signal-live-composer-charts">
                  {composerChartKeysForModule(module.methodology_slug).map((chartSlug) => {
                    const chartKey = composerChartKey(module.methodology_slug, chartSlug);
                    return (
                      <button
                        aria-pressed={selectedChartSet.has(chartKey)}
                        disabled={!selectedModuleSet.has(module.methodology_slug)}
                        key={chartKey}
                        onClick={() => toggleChart(module.methodology_slug, chartSlug)}
                        type="button"
                      >
                        {prettifyKey(chartSlug)}
                      </button>
                    );
                  })}
                </div>
              </article>
            ))}
          </section>

          <ComposerSignalList
            copy={t}
            help={t.opportunitiesHelp}
            onToggle={toggleSignal}
            selectedSignalSet={selectedSignalSet}
            title={t.opportunities}
            signals={editorPayload?.opportunities ?? []}
          />
          <ComposerSignalList
            copy={t}
            help={t.risksHelp}
            onToggle={toggleSignal}
            selectedSignalSet={selectedSignalSet}
            title={t.risks}
            signals={editorPayload?.risks ?? []}
          />
        </div>
      )}
    </section>
  );
}

function SectionTitle({ help, label }: { help: string; label: string }) {
  return (
    <h4 className="signal-live-composer-section-title">
      {label}
      <span aria-label={help} role="img" tabIndex={0} title={help}>i</span>
    </h4>
  );
}

function ComposerSignalList({
  copy: t,
  help,
  onToggle,
  selectedSignalSet,
  signals,
  title
}: {
  copy: typeof copy.en;
  help: string;
  onToggle: (signalId: string) => void;
  selectedSignalSet: Set<string>;
  signals: ComposerSignal[];
  title: string;
}) {
  return (
    <section>
      <SectionTitle label={title} help={help} />
      {signals.slice(0, 6).map((signal) => (
        <article className={selectedSignalSet.has(signal.canonical_signal_id) ? "is-selected" : "is-muted"} key={signal.canonical_signal_id}>
          <header>
            <strong>{signal.title}</strong>
            <button
              aria-pressed={selectedSignalSet.has(signal.canonical_signal_id)}
              className="signal-live-composer-toggle"
              onClick={() => onToggle(signal.canonical_signal_id)}
              type="button"
            >
              <Icon name={selectedSignalSet.has(signal.canonical_signal_id) ? "check" : "x"} size={13} />
              {selectedSignalSet.has(signal.canonical_signal_id) ? t.include : t.omit}
            </button>
          </header>
          <p>{prettifyKey(signal.signal_type)} · {signal.frequency} {t.mentions} · {signal.confidence ?? "directional"}</p>
          <div>
            <small>delta {formatDelta(signal.delta_vs_previous)}</small>
            <small>{Math.max(signal.evidence_count, signal.supporting_evidence_count)} {t.evidence}</small>
            {signal.supporting_signal_count > 1 ? <small>{signal.supporting_methodologies.length} {t.methods}</small> : null}
          </div>
          {signal.evidence_examples[0]?.quote ? (
            <blockquote>
              “{signal.evidence_examples[0].quote}”
            </blockquote>
          ) : null}
        </article>
      ))}
    </section>
  );
}

function signalsForModule(moduleSlug: string, payload: ComposerSignalSource) {
  if (!payload) return [];
  return uniqueSignals([
    ...payload.modules.flatMap((module) => module.methodology_slug === moduleSlug ? module.top_signals : []),
    ...payload.opportunities,
    ...payload.risks
  ]).filter((signal) => signal.methodology_slug === moduleSlug || signal.supporting_methodologies.includes(moduleSlug));
}

function uniqueSignals(signals: ComposerSignal[]) {
  const seen = new Set<string>();
  const output: ComposerSignal[] = [];
  for (const signal of signals) {
    if (!signal.canonical_signal_id || seen.has(signal.canonical_signal_id)) continue;
    seen.add(signal.canonical_signal_id);
    output.push(signal);
  }
  return output;
}

function normalizePayload(input: unknown): ComposerPayload {
  const value = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  return {
    ok: value.ok === true,
    analysis_plan: normalizeAnalysisPlan(value.analysis_plan),
    scope: normalizeScope(value.scope),
    available: normalizeAvailable(value.available),
    selection: normalizeSelection(value.selection),
    modules: arrayValue(value.modules).map(normalizeModule),
    opportunities: arrayValue(value.opportunities).map(normalizeSignal),
    risks: arrayValue(value.risks).map(normalizeSignal),
    draft: normalizeDraft(value.draft),
    editorial: normalizeEditorial(value.editorial),
    editorial_applied: value.editorial_applied === true,
    lens_statuses: arrayValue(value.lens_statuses).map(normalizeLensStatus),
    candidates: normalizeCandidates(value.candidates)
  };
}

function emptyPayload(): ComposerPayload {
  return {
    ok: false,
    analysis_plan: null,
    scope: { brand_id: null, theme_id: null, study_corpus_id: null, base_corpus_id: null },
    available: { methodologies: [], signal_types: [], statuses: [] },
    selection: { methodologies: [], signalTypes: [], statuses: [], chartKeys: [] },
    draft: null,
    editorial: null,
    modules: [],
    opportunities: [],
    risks: [],
    editorial_applied: false,
    lens_statuses: []
  };
}

function LensStatusRail({
  copy: t,
  lensStatuses,
  plannedLenses
}: {
  copy: typeof copy.en;
  lensStatuses: ComposerLensStatus[];
  plannedLenses: string[];
}) {
  const statusesBySlug = new Map(lensStatuses.map((status) => [status.methodology_slug, status]));
  return (
    <div className="signal-live-composer-plan" aria-label={t.plannedLenses}>
      <span>{t.lensHealth}</span>
      {plannedLenses.map((lens) => {
        const status = statusesBySlug.get(lens);
        const state = status?.status ?? "not_started";
        const detail = lensStatusDetail(status, lens, t);
        const shortReadiness = lensReadinessBadge(status);
        return (
          <small
            className={`is-${state.replace(/_/g, "-")}`}
            key={lens}
            title={detail}
          >
            {labelForLens(lens)}
            <b>{t.lensStatus[state] ?? state}</b>
            {status?.signals_in_range ? <em>{status.signals_in_range}</em> : shortReadiness ? <em>{shortReadiness}</em> : null}
          </small>
        );
      })}
    </div>
  );
}

function lensStatusDetail(status: ComposerLensStatus | undefined, lens: string, t: typeof copy.en) {
  if (!status) return `${labelForLens(lens)} · ${t.lensStatus.not_started}`;
  const readiness = status.readiness;
  const parts = [
    status.message,
    status.quality_gates_failed[0]?.detail,
    readiness?.hard_failures[0],
    readiness?.warnings[0],
    readiness?.summary.scopeCoverage.length
      ? readiness.summary.scopeCoverage
          .map((scope) => `${scope.scope}: ${scope.mentionCount} (${scope.status})`)
          .join(" · ")
      : null
  ].filter(Boolean);
  return parts.join(" · ") || `${labelForLens(lens)} · ${t.lensStatus[status.status] ?? status.status}`;
}

function lensReadinessBadge(status: ComposerLensStatus | undefined) {
  const readiness = status?.readiness;
  if (!readiness) return null;
  if (readiness.status === "blocked") return "!";
  if (readiness.status === "directional") return "~";
  return null;
}

function normalizeCandidates(value: unknown): ComposerPayload["candidates"] {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!input) return undefined;
  return {
    modules: arrayValue(input.modules).map(normalizeModule),
    opportunities: arrayValue(input.opportunities).map(normalizeSignal),
    risks: arrayValue(input.risks).map(normalizeSignal),
    draft: normalizeDraft(input.draft)
  };
}

function normalizeLensStatus(input: Record<string, unknown>): ComposerLensStatus {
  const status = stringValue(input.status);
  return {
    methodology_slug: stringValue(input.methodology_slug),
    status: isComposerLensStatus(status) ? status : "not_started",
    engine_analysis_id: stringValue(input.engine_analysis_id) || null,
    current_step: stringValue(input.current_step) || null,
    signals_in_range: numberValue(input.signals_in_range),
    evidence_in_range: numberValue(input.evidence_in_range),
    message: stringValue(input.message) || null,
    readiness: normalizeLensReadiness(input.readiness),
    quality_gates_failed: arrayValue(input.quality_gates_failed).map((gate) => ({
      id: stringValue(gate.id),
      detail: stringValue(gate.detail)
    })).filter((gate) => gate.id)
  };
}

function normalizeLensReadiness(value: unknown): ComposerLensReadiness | null {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!input) return null;
  const status = stringValue(input.status);
  const summary = input.summary && typeof input.summary === "object" && !Array.isArray(input.summary)
    ? input.summary as Record<string, unknown>
    : {};
  return {
    status: status === "ready" || status === "directional" || status === "blocked" ? status : "blocked",
    hard_failures: arrayOfStrings(input.hard_failures),
    warnings: arrayOfStrings(input.warnings),
    summary: {
      requiredScopes: arrayOfStrings(summary.requiredScopes),
      importedScopes: arrayOfStrings(summary.importedScopes),
      missingScopes: arrayOfStrings(summary.missingScopes),
      scopeCoverage: arrayValue(summary.scopeCoverage).map((scope) => ({
        scope: stringValue(scope.scope),
        mentionCount: numberValue(scope.mentionCount),
        status: stringValue(scope.status)
      }))
    }
  };
}

function isComposerLensStatus(value: string): value is ComposerLensStatus["status"] {
  return value === "active"
    || value === "ready"
    || value === "queued"
    || value === "running"
    || value === "needs_review"
    || value === "approved"
    || value === "failed"
    || value === "blocked"
    || value === "no_signals"
    || value === "not_started";
}

function normalizeAnalysisPlan(value: unknown): ComposerPayload["analysis_plan"] {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!input) return null;
  return {
    selected_lenses: arrayOfStrings(input.selected_lenses),
    composer_modules: arrayOfStrings(input.composer_modules)
  };
}

function normalizeScope(value: unknown): ComposerPayload["scope"] {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    brand_id: stringValue(input.brand_id) || null,
    theme_id: stringValue(input.theme_id) || null,
    study_corpus_id: stringValue(input.study_corpus_id) || null,
    base_corpus_id: stringValue(input.base_corpus_id) || null
  };
}

function normalizeAvailable(value: unknown): ComposerPayload["available"] {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    methodologies: arrayOfStrings(input.methodologies),
    signal_types: arrayOfStrings(input.signal_types),
    statuses: arrayOfStrings(input.statuses)
  };
}

function normalizeSelection(value: unknown): ComposerPayload["selection"] {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    methodologies: arrayOfStrings(input.methodologies),
    signalTypes: arrayOfStrings(input.signalTypes),
    statuses: arrayOfStrings(input.statuses),
    chartKeys: arrayOfStrings(input.chartKeys)
  };
}

function normalizeModule(input: Record<string, unknown>): ComposerModule {
  return {
    methodology_slug: stringValue(input.methodology_slug),
    total_signals: numberValue(input.total_signals),
    total_frequency: numberValue(input.total_frequency),
    evidence_count: numberValue(input.evidence_count),
    signal_types: recordValue(input.signal_types),
    top_signals: arrayValue(input.top_signals).map(normalizeSignal)
  };
}

function normalizeModuleChartKeys(value: unknown): Record<string, string[]> {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(input).map(([key, chartKeys]) => [
    key,
    arrayOfStrings(chartKeys)
  ]));
}

function normalizeSignal(input: Record<string, unknown>): ComposerSignal {
  return {
    canonical_signal_id: stringValue(input.canonical_signal_id),
    methodology_slug: stringValue(input.methodology_slug),
    signal_type: stringValue(input.signal_type),
    title: stringValue(input.title),
    status: stringValue(input.status),
    frequency: numberValue(input.frequency),
    share_pct: nullableNumber(input.share_pct),
    intensity: nullableNumber(input.intensity),
    sentiment: nullableNumber(input.sentiment),
    composite_score: nullableNumber(input.composite_score),
    confidence: stringValue(input.confidence) || null,
    delta_vs_previous: nullableNumber(input.delta_vs_previous),
    evidence_count: numberValue(input.evidence_count),
    supporting_methodologies: arrayOfStrings(input.supporting_methodologies),
    supporting_signal_count: numberValue(input.supporting_signal_count) || 1,
    supporting_evidence_count: numberValue(input.supporting_evidence_count),
    evidence_examples: arrayValue(input.evidence_examples).map(normalizeEvidenceExample)
  };
}

function normalizeDraft(value: unknown): ComposerPayload["draft"] {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!input) return null;
  const totals = input.totals && typeof input.totals === "object" && !Array.isArray(input.totals) ? input.totals as Record<string, unknown> : {};
  return {
    kind: stringValue(input.kind),
    version: numberValue(input.version),
    selection: normalizeSelection(input.selection),
    module_slugs: arrayOfStrings(input.module_slugs),
    module_chart_keys: normalizeModuleChartKeys(input.module_chart_keys),
    selected_chart_keys: arrayOfStrings(input.selected_chart_keys),
    selected_canonical_signal_ids: arrayOfStrings(input.selected_canonical_signal_ids),
    supporting_signal_ids: arrayOfStrings(input.supporting_signal_ids),
    supporting_observation_ids: arrayOfStrings(input.supporting_observation_ids),
    opportunity_signal_ids: arrayOfStrings(input.opportunity_signal_ids),
    risk_signal_ids: arrayOfStrings(input.risk_signal_ids),
    evidence_mention_ids: arrayOfStrings(input.evidence_mention_ids),
    lens_statuses: arrayValue(input.lens_statuses).map(normalizeLensStatus),
    lens_status_summary: normalizeLensStatusSummary(input.lens_status_summary),
    totals: {
      raw_signals: numberValue(totals.raw_signals),
      deduped_signals: numberValue(totals.deduped_signals),
      modules: numberValue(totals.modules),
      charts: numberValue(totals.charts),
      opportunities: numberValue(totals.opportunities),
      risks: numberValue(totals.risks),
      evidence_examples: numberValue(totals.evidence_examples),
      available_modules: optionalNumber(totals.available_modules),
      selected_modules: optionalNumber(totals.selected_modules),
      available_charts: optionalNumber(totals.available_charts),
      selected_charts: optionalNumber(totals.selected_charts),
      available_signals: optionalNumber(totals.available_signals),
      selected_signals: optionalNumber(totals.selected_signals)
    }
  };
}

function normalizeLensStatusSummary(value: unknown): ComposerDraftPayload["lens_status_summary"] {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    total: numberValue(input.total),
    active: numberValue(input.active),
    ready: numberValue(input.ready),
    running: numberValue(input.running),
    blocked: numberValue(input.blocked),
    no_signals: numberValue(input.no_signals)
  };
}

function normalizeEditorial(value: unknown): ComposerPayload["editorial"] {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!input) return null;
  return {
    id: stringValue(input.id) || null,
    status: stringValue(input.status) || "draft",
    selection: normalizeEditorialSelection(input.selection),
    draft: normalizeDraft(input.draft),
    updated_at: stringValue(input.updated_at) || null,
    notes: stringValue(input.notes) || null
  };
}

function normalizeEditorialSelection(value: unknown): ComposerEditorialSelection {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    methodologies: arrayOfStrings(input.methodologies),
    signalTypes: arrayOfStrings(input.signalTypes),
    statuses: arrayOfStrings(input.statuses),
    modules: arrayOfStrings(input.modules),
    chartKeys: arrayOfStrings(input.chartKeys),
    canonicalSignalIds: arrayOfStrings(input.canonicalSignalIds),
    opportunitySignalIds: arrayOfStrings(input.opportunitySignalIds),
    riskSignalIds: arrayOfStrings(input.riskSignalIds)
  };
}

function normalizeEvidenceExample(input: Record<string, unknown>): ComposerEvidenceExample {
  return {
    observation_id: stringValue(input.observation_id) || null,
    mention_id: stringValue(input.mention_id) || null,
    source_id: stringValue(input.source_id) || null,
    quote: stringValue(input.quote),
    platform: stringValue(input.platform) || null,
    published_at: stringValue(input.published_at) || null,
    evidence_role: stringValue(input.evidence_role) || null,
    is_protagonist: input.is_protagonist === true
  };
}

function arrayValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function recordValue(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, count]) => [key, numberValue(count)]));
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

function numberValue(value: unknown) {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function prettifyKey(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDelta(value: number | null) {
  if (value === null || value === 0) return "0";
  return value > 0 ? `+${value}` : String(value);
}

function formatRange(dateFrom: string, dateTo: string) {
  return [dateFrom || "…", dateTo || "…"].join(" → ");
}

function formatSavedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

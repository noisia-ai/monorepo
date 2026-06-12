import type { EngineMethodologyOption } from "@/lib/engine/methodology-options";

export const SIGNAL_PULSE_SLUG = "signal-pulse";

export const SIGNAL_PULSE_RUNTIME_OPTION: EngineMethodologyOption = {
  slug: SIGNAL_PULSE_SLUG,
  label: "Signal Pulse",
  shortLabel: "Signal Pulse",
  priority: "SP",
  runtimeKind: "engine",
  seeded: true,
  status: "beta",
  version: "0.1",
  runnable: true
};

export function isSignalPulseMethodology(slug?: string | null) {
  return slug === SIGNAL_PULSE_SLUG;
}

export function shouldLoadSelectedLensState(primaryMethodologySlug?: string | null) {
  return !isSignalPulseMethodology(primaryMethodologySlug);
}

export function buildRuntimeMethodologyOptions({
  primaryMethodologySlug,
  baseOptions
}: {
  primaryMethodologySlug?: string | null;
  baseOptions: EngineMethodologyOption[];
}) {
  if (isSignalPulseMethodology(primaryMethodologySlug)) return [SIGNAL_PULSE_RUNTIME_OPTION];
  return baseOptions;
}

export function enginePublishedOutputTypeForMethodology(slug: string) {
  return isSignalPulseMethodology(slug) ? "signal_pulse_dashboard" : "narrative_dashboard";
}

export type SignalPulseLaunchCoverage = {
  conversationMentions?: unknown;
  signalPulseMentions?: unknown;
  performanceRecords?: unknown;
  queryPacks?: unknown;
};

export type SignalPulseLaunchPlan = {
  budgetCapUsd: number;
  estimatedCostUsd: number;
  windowMonths: number;
  clusterFirst: true;
  status: "ready" | "blocked";
  coverage: {
    conversationMentions: number;
    signalPulseMentions: number;
    performanceRecords: number;
    queryPacks: number;
  };
  warnings: string[];
};

export type SignalPulseLaunchChecklistItem = {
  id: "conversation" | "query_pack" | "performance" | "budget";
  label: string;
  value: string;
  passed: boolean;
  detail: string;
};

export type SignalPulseStoredVisibilityConfig = {
  client_default: boolean;
  paid_data: boolean;
  competitive: boolean;
  evidence: boolean;
  corpus_view: "hidden" | "limited" | "full";
  sources: boolean;
  composer: boolean;
  quality: boolean;
  raw_metadata: boolean;
};

export type SignalPulseResolvedVisibility = {
  showPaidOrganic: boolean;
  showCompetitive: boolean;
  showEvidence: boolean;
  showComposer: boolean;
  showCorpus: boolean;
  showSources: boolean;
  showQuality: boolean;
  showRawMetadata: boolean;
};

export function buildSignalPulseStoredVisibilityConfig(input?: unknown): SignalPulseStoredVisibilityConfig {
  const config = asRecord(input);
  return {
    client_default: booleanValue(config.client_default, true),
    paid_data: booleanValue(config.paid_data ?? config.paidData, false),
    competitive: booleanValue(config.competitive, true),
    evidence: booleanValue(config.evidence, true),
    corpus_view: corpusViewValue(config.corpus_view ?? config.corpusView, "limited"),
    sources: booleanValue(config.sources, false),
    composer: booleanValue(config.composer, false),
    quality: booleanValue(config.quality ?? config.internal_quality, false),
    raw_metadata: booleanValue(config.raw_metadata ?? config.rawMetadata, false)
  };
}

export function resolveSignalPulseVisibility(args: {
  config?: unknown;
  isInternalUser: boolean;
}): SignalPulseResolvedVisibility {
  if (args.isInternalUser) {
    return {
      showPaidOrganic: true,
      showCompetitive: true,
      showEvidence: true,
      showComposer: true,
      showCorpus: true,
      showSources: true,
      showQuality: true,
      showRawMetadata: true
    };
  }

  const config = buildSignalPulseStoredVisibilityConfig(args.config);
  return {
    showPaidOrganic: config.paid_data,
    showCompetitive: config.competitive,
    showEvidence: config.evidence,
    showComposer: config.composer,
    showCorpus: config.corpus_view === "full",
    showSources: config.sources,
    showQuality: config.quality,
    showRawMetadata: config.raw_metadata
  };
}

export function buildSignalPulseLaunchPlan(args: {
  analysisPlan?: unknown;
  targetWindowMonths?: unknown;
  coverage?: SignalPulseLaunchCoverage | null;
}): SignalPulseLaunchPlan {
  const analysisPlan = asRecord(args.analysisPlan);
  const coverage = args.coverage ?? {};
  const budgetCapUsd = positiveNumber(analysisPlan.budget_cap_usd, 5);
  const windowMonths = positiveInteger(args.targetWindowMonths, 12);
  const normalizedCoverage = {
    conversationMentions: wholeNumber(coverage.conversationMentions),
    signalPulseMentions: wholeNumber(coverage.signalPulseMentions),
    performanceRecords: wholeNumber(coverage.performanceRecords),
    queryPacks: wholeNumber(coverage.queryPacks)
  };
  const warnings: string[] = [];
  if (normalizedCoverage.conversationMentions === 0) warnings.push("No hay menciones incluidas para clusterizar.");
  if (normalizedCoverage.signalPulseMentions === 0) warnings.push("Falta cobertura atribuida al query pack de Signal Pulse.");
  if (normalizedCoverage.performanceRecords === 0) warnings.push("Sube performance estructurada de 12 meses antes de leer paid/organic.");
  if (normalizedCoverage.queryPacks === 0) warnings.push("Materializa el query pack Signal Pulse antes de correr.");

  return {
    budgetCapUsd,
    estimatedCostUsd: 0,
    windowMonths,
    clusterFirst: true,
    status: warnings.length === 0 ? "ready" : "blocked",
    coverage: normalizedCoverage,
    warnings
  };
}

export function buildSignalPulseLaunchChecklist(plan: SignalPulseLaunchPlan): SignalPulseLaunchChecklistItem[] {
  return [
    {
      id: "conversation",
      label: "Conversación para clusterizar",
      value: `${formatWhole(plan.coverage.conversationMentions)} menciones`,
      passed: plan.coverage.conversationMentions > 0,
      detail: plan.coverage.conversationMentions > 0
        ? "Lista para detectar señales por embeddings y clustering."
        : "Carga o aprueba menciones del corpus antes de correr."
    },
    {
      id: "query_pack",
      label: "Query pack Signal Pulse",
      value: `${formatWhole(plan.coverage.signalPulseMentions)} menciones SP`,
      passed: plan.coverage.signalPulseMentions > 0 && plan.coverage.queryPacks > 0,
      detail: plan.coverage.signalPulseMentions > 0 && plan.coverage.queryPacks > 0
        ? `${formatWhole(plan.coverage.queryPacks)} consultas materializadas para el corte.`
        : "Materializa el query pack Signal Pulse para atribuir la cobertura."
    },
    {
      id: "performance",
      label: "Performance estructurada",
      value: `${formatWhole(plan.coverage.performanceRecords)} registros`,
      passed: plan.coverage.performanceRecords > 0,
      detail: plan.coverage.performanceRecords > 0
        ? `Paid y orgánico tendrán base de ${plan.windowMonths} meses para comparar.`
        : "Sube el export de Meta/TikTok como performance_records, no como texto."
    },
    {
      id: "budget",
      label: "Costo antes de correr",
      value: `USD ${formatMoney(plan.estimatedCostUsd)} / ${formatMoney(plan.budgetCapUsd)}`,
      passed: plan.budgetCapUsd > 0 && plan.estimatedCostUsd <= plan.budgetCapUsd,
      detail: plan.clusterFirst
        ? "Cluster-first mantiene Claude para nombrar e interpretar señales."
        : "Revisar configuración: Signal Pulse debe correr cluster-first."
    }
  ];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function positiveNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function positiveInteger(value: unknown, fallback: number) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function wholeNumber(value: unknown) {
  const number = Math.trunc(Number(value ?? 0));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function booleanValue(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "si", "sí"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }
  return fallback;
}

function corpusViewValue(value: unknown, fallback: SignalPulseStoredVisibilityConfig["corpus_view"]) {
  return value === "hidden" || value === "limited" || value === "full" ? value : fallback;
}

function formatWhole(value: number) {
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(value);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value > 0 && value < 1 ? 4 : 2,
    minimumFractionDigits: value > 0 && value < 1 ? 4 : 2
  }).format(value);
}

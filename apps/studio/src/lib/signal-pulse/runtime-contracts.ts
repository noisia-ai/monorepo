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
    status: normalizedCoverage.conversationMentions > 0 ? "ready" : "blocked",
    coverage: normalizedCoverage,
    warnings
  };
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

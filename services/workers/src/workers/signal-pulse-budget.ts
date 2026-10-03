const DEFAULT_MAX_SIGNAL_CLUSTERS = 24;
const SIGNAL_PULSE_NAMING_COST_PER_CLUSTER_USD = 0.022;

export const SIGNAL_PULSE_INTERPRETATION_COST_USD = 0.15;
export const SIGNAL_PULSE_RAG_CONTEXT_COST_USD = 0.02;

export function estimateSignalPulseNamingCostUsd(clusterCount: number, maxClusters = DEFAULT_MAX_SIGNAL_CLUSTERS) {
  const boundedClusters = Math.max(1, Math.min(maxClusters, Math.ceil(clusterCount)));
  return roundUsd(boundedClusters * SIGNAL_PULSE_NAMING_COST_PER_CLUSTER_USD);
}

export function estimateSignalPulseRunCostUsd(signalPulseMentions: number, maxClusters = DEFAULT_MAX_SIGNAL_CLUSTERS) {
  const estimatedClusters = Math.max(1, Math.min(maxClusters, Math.ceil(signalPulseMentions / 80)));
  return roundUsd(SIGNAL_PULSE_RAG_CONTEXT_COST_USD + SIGNAL_PULSE_INTERPRETATION_COST_USD + estimateSignalPulseNamingCostUsd(estimatedClusters, maxClusters));
}

export function shouldSkipSignalPulseLlmForBudget(args: {
  currentCostUsd: number;
  budgetCapUsd: number;
  estimatedNextCostUsd: number;
}) {
  const current = finiteMoney(args.currentCostUsd);
  const cap = finiteMoney(args.budgetCapUsd);
  const next = finiteMoney(args.estimatedNextCostUsd);
  if (current >= cap) {
    return { skip: true as const, reason: `budget_exhausted:${roundUsd(current)}/${cap}` };
  }
  if (current + next > cap) {
    return { skip: true as const, reason: `budget_would_exceed:${roundUsd(current)}+${roundUsd(next)}/${cap}` };
  }
  return { skip: false as const, reason: null };
}

function finiteMoney(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function roundUsd(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

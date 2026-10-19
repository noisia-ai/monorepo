export type EngineCostUsage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
};

export function estimateModelCostUsd(args: {
  provider: string;
  model?: string | null;
  inputTokens: number;
  outputTokens: number;
}) {
  const pricing = modelPricing(args.provider, args.model);
  if (!pricing) return null;
  return roundUsd((args.inputTokens / 1_000_000) * pricing.inputPerMillion + (args.outputTokens / 1_000_000) * pricing.outputPerMillion);
}

export function positiveTokenInteger(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.floor(number);
}

function modelPricing(provider: string, model?: string | null) {
  if (provider !== "anthropic" || !model) return null;
  const normalized = model.toLowerCase();
  if (normalized.includes("opus")) return { inputPerMillion: 15, outputPerMillion: 75 };
  if (normalized.includes("sonnet")) return { inputPerMillion: 3, outputPerMillion: 15 };
  if (normalized.includes("haiku")) return { inputPerMillion: 0.8, outputPerMillion: 4 };
  return null;
}

function roundUsd(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

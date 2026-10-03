export const ENGINE_QUEUE_NAME = "noisia-engine-analysis";
export const ENGINE_PIPELINE_VERSION = "engine-2026.06.01";
export const ENGINE_RUNTIME_FLAG = "NOISIA_ENGINE_RUNTIME_ENABLED";
export const ENGINE_LLM_FLAG = "NOISIA_ENGINE_LLM_ENABLED";
export const ENGINE_ALLOW_OPUS_FLAG = "NOISIA_ENGINE_ALLOW_OPUS";
export const ENGINE_FIXTURE_CODING_FLAG = "NOISIA_ENGINE_FIXTURE_CODING_ENABLED";

export const ENGINE_METHODOLOGY_SLUGS = [
  "competitive-wave",
  "value-perception-matrix",
  "journey-friction-mapping",
  "cultural-codes-decoding",
  "influence-architecture",
  "decision-velocity",
  "sentiment-advocacy-proxy",
  "brand-positioning-map",
  "category-opportunity-map",
  "competitive-tb-matrix",
  "narrative-ownership",
  "white-space-analysis",
  "audience-segment-lens",
  "trust-risk-benchmark",
  "evidence-confidence-layer"
] as const;

export type EngineMethodologySlug = (typeof ENGINE_METHODOLOGY_SLUGS)[number];

export const ENGINE_READ_ONLY_OUTPUT_SLUGS = ["competitive-tb-matrix"] as const satisfies readonly EngineMethodologySlug[];
export type EngineReadOnlyOutputSlug = (typeof ENGINE_READ_ONLY_OUTPUT_SLUGS)[number];
export type EngineRunnableMethodologySlug = Exclude<EngineMethodologySlug, EngineReadOnlyOutputSlug>;

export type EngineStepName =
  | "preflight"
  | "retrieve"
  | "code"
  | "score"
  | "synthesize"
  | "quality_gates"
  | "sp_readiness"
  | "sp_periods"
  | "sp_cluster"
  | "sp_name_signals"
  | "sp_metrics"
  | "sp_interpret"
  | "sp_moves"
  | "sp_charts"
  | "sp_gates";

export const ENGINE_STEP_ORDER: EngineStepName[] = [
  "preflight",
  "retrieve",
  "code",
  "score",
  "synthesize",
  "quality_gates"
];

export const ENGINE_STEP_JOB_NAME: Record<EngineStepName, string> = {
  preflight: "engine_step_preflight",
  retrieve: "engine_step_retrieve",
  code: "engine_step_code",
  score: "engine_step_score",
  synthesize: "engine_step_synthesize",
  quality_gates: "engine_quality_gates",
  sp_readiness: "engine_sp_readiness",
  sp_periods: "engine_sp_periods",
  sp_cluster: "engine_sp_cluster",
  sp_name_signals: "engine_sp_name_signals",
  sp_metrics: "engine_sp_metrics",
  sp_interpret: "engine_sp_interpret",
  sp_moves: "engine_sp_moves",
  sp_charts: "engine_sp_charts",
  sp_gates: "engine_sp_gates"
};

export function engineNextStep(current: EngineStepName): EngineStepName | null {
  const index = ENGINE_STEP_ORDER.indexOf(current);
  if (index === -1 || index === ENGINE_STEP_ORDER.length - 1) return null;
  return ENGINE_STEP_ORDER[index + 1] ?? null;
}

export function isEngineMethodologySlug(value: unknown): value is EngineMethodologySlug {
  return typeof value === "string" && ENGINE_METHODOLOGY_SLUGS.includes(value as EngineMethodologySlug);
}

export function isEngineReadOnlyOutputSlug(value: unknown): value is EngineReadOnlyOutputSlug {
  return typeof value === "string" && ENGINE_READ_ONLY_OUTPUT_SLUGS.includes(value as EngineReadOnlyOutputSlug);
}

export function isEngineRunnableMethodologySlug(value: unknown): value is EngineRunnableMethodologySlug {
  return isEngineMethodologySlug(value) && !isEngineReadOnlyOutputSlug(value);
}

type EngineEnv = Record<string, string | undefined>;

export function isEngineRuntimeEnabled(env: EngineEnv = process.env): boolean {
  return env[ENGINE_RUNTIME_FLAG] === "true";
}

export function isEngineLlmEnabled(env: EngineEnv = process.env): boolean {
  return isEngineRuntimeEnabled(env) && env[ENGINE_LLM_FLAG] === "true" && env.ENGINE_DISABLE_LLM_CODING !== "true";
}

export function isEngineFixtureCodingEnabled(env: EngineEnv = process.env): boolean {
  return isEngineRuntimeEnabled(env) && env[ENGINE_FIXTURE_CODING_FLAG] === "true";
}

export function isEngineModelAllowed(model: string, env: EngineEnv = process.env): boolean {
  const normalized = model.toLowerCase();
  if (!normalized.includes("opus")) return true;
  return env[ENGINE_ALLOW_OPUS_FLAG] === "true";
}

export function engineRuntimeDisabledMessage() {
  return `Engine beta runtime is disabled. Set ${ENGINE_RUNTIME_FLAG}=true only after migrations, seeds and QA pass.`;
}

export type Confidence = "alta" | "media" | "baja_direccional";

export type Ownership =
  | "brand_owned"
  | "competitor_owned"
  | "category_wide"
  | "shared"
  | "insufficient_evidence";

export type EngineCodingLabel = {
  external_ref: string;
  finding_key: string;
  dimensions: Record<string, string | number | boolean>;
  intensity: number;
  span: string;
  ambiguous?: boolean;
};

export type EngineCodingPromptInput = {
  brandName: string;
  businessQuestion: string | null;
  params: Record<string, unknown> | null;
  ragContext?: unknown;
  units: Array<{
    external_ref: string;
    entity_hint: string | null;
    text: string;
    platform: string | null;
    published_at: string | null;
  }>;
};

export type EngineDimensionSpec =
  | { type: "enum"; values: readonly string[] }
  | { type: "number"; values?: never }
  | { type: "text"; values?: never };

export type EngineMethodologySpec = {
  slug: EngineMethodologySlug;
  unitKind: string;
  requiresCompetitors: boolean;
  requiresAuthorsMetadata?: boolean;
  minMentionsPerEntity: number;
  dimensionSchema: Record<string, EngineDimensionSpec>;
  buildCodingPrompt(input: EngineCodingPromptInput): string;
  charts: string[];
  qualityGates: string[];
};

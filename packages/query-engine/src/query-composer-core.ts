import { createHash } from "node:crypto";

import type {
  QueryCompetitorEntity,
  QueryConstructionMode
} from "./query-construction";

export const QUERY_COMPOSER_CORE_CONTRACT_VERSION = "query-composer-core-v1" as const;
export const QUERY_COMPOSER_BRIEF_CONTRACT_VERSION = "signal-acquisition-brief-v1" as const;
export const QUERY_COMPOSER_GENERATION_LINEAGE_CONTRACT_VERSION =
  "signal-query-composer-lineage-v1" as const;

export type QueryStrategyBrief = {
  summary: string;
  priority_topics: string[];
  audience_clues: string[];
  competitor_hypotheses: string[];
  query_language: string[];
  exclusions_or_noise: string[];
  brand_query_role: string;
  competitor_query_role: string;
  industry_query_role: string;
  must_answer: string[];
  limitations: string[];
};

export type MethodologyManifest = {
  query_mode?: QueryConstructionMode;
  signal_phrases?: {
    triggers_generic?: string[];
    barriers_generic?: string[];
  };
  global_exclusions?: string[];
  engine_validation_prompt?: string;
  inputs?: {
    corpus?: {
      minimum_viable?: number;
      ideal?: number;
      maximum_useful?: number;
    };
  };
};

export type MemoryRecord = {
  type: string;
  content: unknown;
};

export type QueryComposerAcquisitionBriefV1 = {
  contract_version: typeof QUERY_COMPOSER_BRIEF_CONTRACT_VERSION;
  objective: string;
  purpose: string;
  market: string | null;
  countries: string[];
  languages: string[];
  timezone: string;
  default_capture_period: { start: string; end: string } | null;
  target_window_months: number | null;
  construction_mode: QueryConstructionMode;
  brand_os_profile_version: number;
  brand_os_digest: string;
  identity_catalog_digest: string;
  knowledge_context_digest: string;
  knowledge_context_refs: string[];
  provider_key: string;
  provider_syntax_version: string;
  provider_schema_version: string;
  optional_study_context: {
    reference_hash: string;
    digest: string;
  } | null;
};

export type QueryComposerGenerationLineageV1 = {
  contract_version: typeof QUERY_COMPOSER_GENERATION_LINEAGE_CONTRACT_VERSION;
  model: string;
  pipeline_version: string;
  prompt_template_digest: string;
  context_digest: string;
  construction_plan_digest: string;
  validation_report_digest: string;
  fallback_used: boolean;
  fallback_reason: string | null;
  optional_study_context: {
    reference_hash: string;
    digest: string;
  } | null;
  generated_at: string;
};

export type SignalAcquisitionQueryDraftStateV1 =
  | "not_generated"
  | "generated"
  | "generated_with_fallback"
  | "validation_failed";

export type SignalAcquisitionQueryGenerationPreflightV1 = {
  contract_version: "signal-acquisition-query-generation-preflight-v1";
  readiness: "ready" | "blocked";
  blockers: string[];
  plan_version: number | null;
  plan_digest: string | null;
  context_digest: string | null;
  required_slots: Array<{
    slot_key: string;
    scope: "primary_brand" | "competitor" | "category";
    label: string;
    state: SignalAcquisitionQueryDraftStateV1;
  }>;
  slot_count: number;
  maximum_provider_calls: number;
  provider: {
    key: string;
    model: string;
    pricing_version: string;
  };
  budget: {
    estimated_max_cost_usd: string;
    hard_cap_usd: string;
    within_hard_cap: boolean;
  };
  writes_performed: false;
  provider_calls: 0;
};

export type QueryComposerCoreInput = {
  contractVersion: typeof QUERY_COMPOSER_CORE_CONTRACT_VERSION;
  brief: QueryComposerAcquisitionBriefV1;
  subject: {
    type: "brand" | "theme";
    name: string;
    slug: string;
    industry: string | null;
    industrySub: string | null;
    categoryAliases?: string[];
    countries: string[];
    brandSeedHandles: string[];
    description: string | null;
  };
  methodology: {
    slug: string;
    name: string;
    version: string;
    manifest: MethodologyManifest;
  };
  competitors: string[];
  competitorEntities?: QueryCompetitorEntity[];
  brandSeeds: string[];
  knowledgeSources: MemoryRecord[];
  memoryIndustry: MemoryRecord[];
  memoryBrand: MemoryRecord[];
  queryStrategyBrief?: QueryStrategyBrief;
};

/**
 * Compatibility input owned by Study OS. It is intentionally not the input of the
 * canonical composer. The adapter below removes the corpus identity before the pure
 * core sees the request.
 */
export type QueryComposerInput = {
  corpus: {
    id: string;
    name: string | null;
    businessQuestion: string | null;
    decisionToInform: string | null;
    audienceSegment: string | null;
    geoFocus: string[];
    targetWindowMonths: number | null;
    contextForm: unknown;
  };
  subject: QueryComposerCoreInput["subject"];
  methodology: QueryComposerCoreInput["methodology"];
  competitors: string[];
  competitorEntities?: QueryCompetitorEntity[];
  brandSeeds: string[];
  knowledgeSources: MemoryRecord[];
  memoryIndustry: MemoryRecord[];
  memoryBrand: MemoryRecord[];
  queryStrategyBrief?: QueryStrategyBrief;
};

export function adaptStudyQueryComposerInputV1(input: QueryComposerInput): QueryComposerCoreInput {
  const contextDigest = queryComposerDigestV1({
    corpus: {
      name: input.corpus.name,
      business_question: input.corpus.businessQuestion,
      decision_to_inform: input.corpus.decisionToInform,
      audience_segment: input.corpus.audienceSegment,
      geo_focus: input.corpus.geoFocus,
      target_window_months: input.corpus.targetWindowMonths,
      context_form: input.corpus.contextForm
    },
    subject: input.subject,
    methodology: input.methodology,
    knowledge_sources: input.knowledgeSources
  });
  return {
    contractVersion: QUERY_COMPOSER_CORE_CONTRACT_VERSION,
    brief: {
      contract_version: QUERY_COMPOSER_BRIEF_CONTRACT_VERSION,
      objective: cleanText(input.corpus.businessQuestion)
        || cleanText(input.corpus.name)
        || `Acquire governed listening data for ${input.subject.name}`,
      purpose: cleanText(input.corpus.decisionToInform) || input.methodology.name,
      market: input.corpus.geoFocus[0] ?? input.subject.countries[0] ?? null,
      countries: uniqueStrings(input.subject.countries),
      languages: [],
      timezone: "UTC",
      default_capture_period: null,
      target_window_months: input.corpus.targetWindowMonths,
      construction_mode: input.methodology.manifest.query_mode ?? "exploratory",
      brand_os_profile_version: 0,
      brand_os_digest: queryComposerDigestV1({ subject: input.subject }),
      identity_catalog_digest: queryComposerDigestV1({
        competitors: input.competitorEntities ?? input.competitors
      }),
      knowledge_context_digest: queryComposerDigestV1(input.knowledgeSources),
      knowledge_context_refs: uniqueStrings(input.knowledgeSources.map((source) => source.type)),
      provider_key: "portable-listening",
      provider_syntax_version: "portable-listen-query-v2",
      provider_schema_version: "study-os-compatibility-v1",
      optional_study_context: {
        reference_hash: queryComposerDigestV1({ study_corpus_reference: input.corpus.id }),
        digest: contextDigest
      }
    },
    subject: input.subject,
    methodology: input.methodology,
    competitors: input.competitors,
    competitorEntities: input.competitorEntities,
    brandSeeds: input.brandSeeds,
    knowledgeSources: input.knowledgeSources,
    memoryIndustry: input.memoryIndustry,
    memoryBrand: input.memoryBrand,
    queryStrategyBrief: input.queryStrategyBrief
  };
}

export function queryComposerCoreInputDigestV1(input: QueryComposerCoreInput) {
  return queryComposerDigestV1(input);
}

export function queryComposerAcquisitionBriefDigestV1(input: QueryComposerAcquisitionBriefV1) {
  return queryComposerDigestV1(validateQueryComposerAcquisitionBriefV1(input));
}

export function validateQueryComposerAcquisitionBriefV1(
  value: unknown
): QueryComposerAcquisitionBriefV1 {
  const input = strictObject(value, [
    "contract_version", "objective", "purpose", "market", "countries", "languages",
    "timezone", "default_capture_period", "target_window_months", "construction_mode",
    "brand_os_profile_version", "brand_os_digest", "identity_catalog_digest",
    "knowledge_context_digest", "knowledge_context_refs", "provider_key",
    "provider_syntax_version", "provider_schema_version", "optional_study_context"
  ], "Acquisition brief");
  const brief: QueryComposerAcquisitionBriefV1 = {
    contract_version: input.contract_version as typeof QUERY_COMPOSER_BRIEF_CONTRACT_VERSION,
    objective: requiredText(input.objective, "objective", 1, 1_000),
    purpose: requiredText(input.purpose, "purpose", 1, 500),
    market: input.market === null ? null : requiredText(input.market, "market", 1, 160),
    countries: canonicalStringArray(input.countries, "countries", 100),
    languages: canonicalStringArray(input.languages, "languages", 100),
    timezone: requiredText(input.timezone, "timezone", 1, 100),
    default_capture_period: validateCapturePeriod(input.default_capture_period),
    target_window_months: input.target_window_months === null
      ? null : safeInteger(input.target_window_months, "target_window_months", 1, 120),
    construction_mode: input.construction_mode as QueryConstructionMode,
    brand_os_profile_version: safeInteger(
      input.brand_os_profile_version, "brand_os_profile_version", 1, Number.MAX_SAFE_INTEGER
    ),
    brand_os_digest: requiredText(input.brand_os_digest, "brand_os_digest"),
    identity_catalog_digest: requiredText(input.identity_catalog_digest, "identity_catalog_digest"),
    knowledge_context_digest: requiredText(input.knowledge_context_digest, "knowledge_context_digest"),
    knowledge_context_refs: canonicalStringArray(input.knowledge_context_refs, "knowledge_context_refs", 1_000),
    provider_key: requiredText(input.provider_key, "provider_key", 1, 80),
    provider_syntax_version: requiredText(input.provider_syntax_version, "provider_syntax_version", 1, 100),
    provider_schema_version: requiredText(input.provider_schema_version, "provider_schema_version", 1, 100),
    optional_study_context: validateOptionalStudyContext(input.optional_study_context)
  };
  validateBrief(brief);
  return brief;
}

export function validateQueryComposerGenerationLineageV1(
  value: unknown
): QueryComposerGenerationLineageV1 {
  const input = strictObject(value, [
    "contract_version", "model", "pipeline_version", "prompt_template_digest",
    "context_digest", "construction_plan_digest", "validation_report_digest",
    "fallback_used", "fallback_reason", "optional_study_context", "generated_at"
  ], "Query Composer lineage");
  if (input.contract_version !== QUERY_COMPOSER_GENERATION_LINEAGE_CONTRACT_VERSION) {
    throw new Error("Query Composer lineage contract is unsupported.");
  }
  if (typeof input.fallback_used !== "boolean") {
    throw new Error("Query Composer lineage fallback_used is invalid.");
  }
  const fallbackReason = input.fallback_reason === null
    ? null : requiredText(input.fallback_reason, "fallback_reason", 1, 500);
  if (input.fallback_used !== (fallbackReason !== null)) {
    throw new Error("Query Composer fallback lineage is inconsistent.");
  }
  const generatedAt = requiredText(input.generated_at, "generated_at", 1, 100);
  if (Number.isNaN(Date.parse(generatedAt))) {
    throw new Error("Query Composer generated_at is invalid.");
  }
  const lineage: QueryComposerGenerationLineageV1 = {
    contract_version: QUERY_COMPOSER_GENERATION_LINEAGE_CONTRACT_VERSION,
    model: requiredText(input.model, "model", 1, 200),
    pipeline_version: requiredText(input.pipeline_version, "pipeline_version", 1, 200),
    prompt_template_digest: requiredHash(input.prompt_template_digest, "prompt_template_digest"),
    context_digest: requiredHash(input.context_digest, "context_digest"),
    construction_plan_digest: requiredHash(input.construction_plan_digest, "construction_plan_digest"),
    validation_report_digest: requiredHash(input.validation_report_digest, "validation_report_digest"),
    fallback_used: input.fallback_used,
    fallback_reason: fallbackReason,
    optional_study_context: validateOptionalStudyContext(input.optional_study_context),
    generated_at: new Date(generatedAt).toISOString()
  };
  return lineage;
}

export function queryComposerGenerationLineageDigestV1(value: QueryComposerGenerationLineageV1) {
  return queryComposerDigestV1(validateQueryComposerGenerationLineageV1(value));
}

export function queryComposerDigestV1(value: unknown) {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}

function validateBrief(input: QueryComposerAcquisitionBriefV1) {
  if (input.contract_version !== QUERY_COMPOSER_BRIEF_CONTRACT_VERSION
      || !input.objective.trim() || !input.purpose.trim()
      || !isIanaTimezone(input.timezone)
      || !Number.isInteger(input.brand_os_profile_version) || input.brand_os_profile_version < 1
      || !isHash(input.brand_os_digest) || !isHash(input.identity_catalog_digest)
      || !isHash(input.knowledge_context_digest)
      || !input.knowledge_context_refs.every(isHash)
      || !["exploratory", "detection"].includes(input.construction_mode)
      || !input.provider_key.trim() || !input.provider_syntax_version.trim()
      || !input.provider_schema_version.trim()) {
    throw new Error("Acquisition brief is invalid.");
  }
  if (input.default_capture_period
      && (!/^\d{4}-\d{2}-\d{2}$/u.test(input.default_capture_period.start)
        || !/^\d{4}-\d{2}-\d{2}$/u.test(input.default_capture_period.end)
        || input.default_capture_period.start > input.default_capture_period.end)) {
    throw new Error("Acquisition brief capture period is invalid.");
  }
  if (input.optional_study_context
      && (!isHash(input.optional_study_context.reference_hash)
        || !isHash(input.optional_study_context.digest))) {
    throw new Error("Acquisition brief Study OS reference is invalid.");
  }
}

function validateCapturePeriod(value: unknown) {
  if (value === null) return null;
  const input = strictObject(value, ["start", "end"], "capture period");
  const start = requiredText(input.start, "capture period start");
  const end = requiredText(input.end, "capture period end");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(start) || !/^\d{4}-\d{2}-\d{2}$/u.test(end) || start > end) {
    throw new Error("Acquisition brief capture period is invalid.");
  }
  return { start, end };
}

function validateOptionalStudyContext(value: unknown) {
  if (value === null) return null;
  const input = strictObject(value, ["reference_hash", "digest"], "optional Study OS context");
  return {
    reference_hash: requiredHash(input.reference_hash, "Study OS reference_hash"),
    digest: requiredHash(input.digest, "Study OS digest")
  };
}

function strictObject(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set(keys);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  const missing = keys.filter((key) => !(key in input));
  if (unknown.length || missing.length) {
    throw new Error(`${label} shape is invalid.`);
  }
  return input;
}

function requiredText(value: unknown, label: string, minimum = 1, maximum = 10_000) {
  if (typeof value !== "string") throw new Error(`${label} is invalid.`);
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length < minimum || normalized.length > maximum) throw new Error(`${label} is invalid.`);
  return normalized;
}

function requiredHash(value: unknown, label: string) {
  const normalized = requiredText(value, label, 71, 71);
  if (!isHash(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function safeInteger(value: unknown, label: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value as number;
}

function canonicalStringArray(value: unknown, label: string, maximumLength: number) {
  if (!Array.isArray(value) || value.length > maximumLength) throw new Error(`${label} is invalid.`);
  return [...new Set(value.map((entry) => requiredText(entry, label, 1, 500)))].sort();
}

function isHash(value: string) {
  return /^sha256:[0-9a-f]{64}$/u.test(value);
}

function isIanaTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return value.includes("/") || value === "UTC";
  } catch {
    return false;
  }
}

function cleanText(value: string | null) {
  return value?.trim() ?? "";
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

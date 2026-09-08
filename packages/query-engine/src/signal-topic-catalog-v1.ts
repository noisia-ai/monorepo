import { createHash } from "node:crypto";

import { z } from "zod";

export const SIGNAL_TOPIC_CATALOG_CONTRACT_V1 = "signal-topic-catalog-v1" as const;
export const SIGNAL_TOPIC_CLASSIFIER_CONTRACT_V1 = "signal-topic-hybrid-classifier-v1" as const;
export const SIGNAL_TOPIC_CLASSIFICATION_JOB_NAME = "signal-topic-classification-v1" as const;
export const SIGNAL_TOPIC_EMBEDDING_PRICING_VERSION_V1 =
  "voyage-4-large-usd-0.12-per-million-2026-09-07" as const;

export type SignalTopicClassificationJobDataV1 = {
  execution_id: string;
};

export const signalTopicScopeSchemaV1 = z.enum(["primary_brand", "competitor", "category"]);
export const signalTopicLifecycleSchemaV1 = z.enum(["draft", "archived"]);
// "discovered" is accepted only to read pre-compass definitions without rewriting their digest.
export const signalTopicOriginSchemaV1 = z.enum(["manual", "historical_taxonomy", "corpus_discovery", "evidence_candidate", "discovered"]);
export type SignalTopicPublicOriginV1 = "manual" | "historical_taxonomy" | "corpus_discovery" | "evidence_candidate";

export function signalTopicPublicOriginV1(origin: z.infer<typeof signalTopicOriginSchemaV1>,
  source: { run_key: string } | null): SignalTopicPublicOriginV1 {
  if (origin !== "discovered") return origin;
  return source?.run_key.startsWith("taxonomy-profile:") ? "historical_taxonomy" : "evidence_candidate";
}

export type SignalTopicReadinessV1 = {
  state: "awaiting_import" | "awaiting_topics" | "needs_preparation" | "ready";
  canonical_mentions: number;
  operational_corpus_id: string | null;
  next_action: "import_mentions" | "define_topics" | "prepare_mentions" | "search_topics";
  reason_code: string | null;
};

const line = z.string().trim().min(1).max(240);
const termKey = z.string().regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u);

export const signalTopicDefinitionSchemaV1 = z.object({
  term_key: termKey,
  label: z.string().trim().min(1).max(160),
  definition: z.string().trim().min(1).max(1500),
  scope: signalTopicScopeSchemaV1,
  inclusion: z.array(line).max(16).default([]),
  exclusion: z.array(line).max(16).default([]),
  positive_examples: z.array(line).max(16).default([]),
  negative_examples: z.array(line).max(16).default([]),
  lifecycle: signalTopicLifecycleSchemaV1,
  origin: signalTopicOriginSchemaV1,
  source: z.object({
    run_key: z.string().min(1).max(200),
    candidate_key: z.string().min(1).max(200),
    candidate_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/u).nullable().default(null)
  }).strict().nullable().default(null),
  definition_revision: z.number().int().positive(),
  definition_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
}).strict();

export type SignalTopicScopeV1 = z.infer<typeof signalTopicScopeSchemaV1>;
export type SignalTopicDefinitionV1 = z.infer<typeof signalTopicDefinitionSchemaV1>;

export type SignalTopicEverydayStatusV1 =
  | "draft"
  | "searching"
  | "ready"
  | "updating"
  | "in_signal"
  | "archived"
  | "failed";

export const createSignalTopicInputSchemaV1 = z.object({
  label: z.string().trim().min(1).max(160),
  definition: z.string().trim().min(1).max(1500),
  scope: signalTopicScopeSchemaV1.default("primary_brand"),
  inclusion: z.array(line).max(16).default([]),
  exclusion: z.array(line).max(16).default([]),
  positive_examples: z.array(line).max(16).default([]),
  negative_examples: z.array(line).max(16).default([])
}).strict();

export const updateSignalTopicInputSchemaV1 = createSignalTopicInputSchemaV1.partial().extend({
  expected_definition_revision: z.number().int().positive()
}).strict();

export const adoptSignalTopicCandidateInputSchemaV1 = z.object({
  run_key: z.string().trim().min(1).max(200),
  candidate_key: z.string().trim().min(1).max(200),
  scope: signalTopicScopeSchemaV1.optional()
}).strict();

export const signalTopicCommandSchemaV1 = z.object({
  action: z.enum(["search", "follow", "archive", "restore", "retry"]),
  idempotency_key: z.string().trim().min(8).max(200),
  embedding_cost_cap_micro_usd: z.number().int().positive().max(1_000_000).optional()
}).strict();

export const signalTopicCorrectionSchemaV1 = z.object({
  disposition: z.enum(["belongs", "excluded"]),
  expected_definition_revision: z.number().int().positive()
}).strict();

export type CreateSignalTopicInputV1 = z.infer<typeof createSignalTopicInputSchemaV1>;
export type UpdateSignalTopicInputV1 = z.infer<typeof updateSignalTopicInputSchemaV1>;
export type AdoptSignalTopicCandidateInputV1 = z.infer<typeof adoptSignalTopicCandidateInputSchemaV1>;

export type SignalTopicCalibrationLabelV1 = {
  mention_id: string;
  score: number;
  disposition: "belongs" | "excluded";
};

export type SignalTopicCalibrationV1 = {
  available: boolean;
  threshold: number | null;
  calibration: { positives: number; negatives: number };
  validation: {
    positives: number;
    negatives: number;
    precision: number | null;
    recall: number | null;
    false_positives: number;
    false_negatives: number;
  };
  reason: "ready" | "insufficient_calibration" | "insufficient_validation" | "validation_failed";
};

/**
 * Human corrections are split by a stable mention identity, so examples used to choose a
 * threshold are never reused to claim validation quality. The split is intentionally hidden
 * from the operator: correcting membership is the product task, not filling out a rubric.
 */
export function calibrateSignalTopicThresholdV1(
  labels: SignalTopicCalibrationLabelV1[],
  options: { minimumPrecision?: number; minimumRecall?: number } = {}
): SignalTopicCalibrationV1 {
  const minimumPrecision = options.minimumPrecision ?? 0.8;
  const minimumRecall = options.minimumRecall ?? 0.5;
  const normalized = labels
    .filter((item) => Number.isFinite(item.score))
    .map((item) => ({ ...item, score: clampScore(item.score) }));
  let calibration = normalized.filter((item) => stableBucket(item.mention_id) < 70);
  let validation = normalized.filter((item) => stableBucket(item.mention_id) >= 70);

  // A tiny set can land in one side by chance. Preserve separation while making the split usable.
  if (validation.length === 0 && calibration.length > 1) {
    const ordered = [...calibration].sort((left, right) => left.mention_id.localeCompare(right.mention_id));
    validation = [ordered.at(-1)!];
    calibration = ordered.slice(0, -1);
  }

  const calibrationCounts = countLabels(calibration);
  const validationCounts = countLabels(validation);
  if (calibrationCounts.positives < 2 || calibrationCounts.negatives < 2) {
    return unavailable("insufficient_calibration", calibrationCounts, validationCounts);
  }
  // A single positive and negative can report perfect validation by chance and authorize a
  // broad automatic threshold. Require at least two unseen examples of each class before a
  // labeling function may publish without an operator decision.
  if (validationCounts.positives < 2 || validationCounts.negatives < 2) {
    return unavailable("insufficient_validation", calibrationCounts, validationCounts);
  }

  const candidates = Array.from(new Set(calibration.map((item) => item.score)))
    .sort((left, right) => right - left);
  let selected: number | null = null;
  let selectedF1 = -1;
  for (const threshold of candidates) {
    const metrics = classificationMetrics(calibration, threshold);
    if (metrics.precision < minimumPrecision) continue;
    const f1 = metrics.precision + metrics.recall === 0
      ? 0
      : 2 * metrics.precision * metrics.recall / (metrics.precision + metrics.recall);
    if (f1 > selectedF1 || (f1 === selectedF1 && (selected === null || threshold > selected))) {
      selected = threshold;
      selectedF1 = f1;
    }
  }
  if (selected === null) return unavailable("validation_failed", calibrationCounts, validationCounts);

  const metrics = classificationMetrics(validation, selected);
  const available = metrics.precision >= minimumPrecision && metrics.recall >= minimumRecall;
  return {
    available,
    threshold: available ? selected : null,
    calibration: calibrationCounts,
    validation: {
      ...validationCounts,
      precision: metrics.precision,
      recall: metrics.recall,
      false_positives: metrics.falsePositives,
      false_negatives: metrics.falseNegatives
    },
    reason: available ? "ready" : "validation_failed"
  };
}

export type SignalTopicCandidateDecisionV1 =
  | { disposition: "approved"; method: "human" | "labeling_function"; score: number | null }
  | { disposition: "pending"; method: "model"; score: number }
  | { disposition: "none"; method: null; score: number | null };

export function decideSignalTopicCandidateV1(args: {
  score: number | null;
  lexical_match: boolean;
  excluded_by_rule: boolean;
  correction?: "belongs" | "excluded" | null;
  calibration?: SignalTopicCalibrationV1 | null;
  retrieval_floor?: number;
}): SignalTopicCandidateDecisionV1 {
  if (args.correction === "belongs") return { disposition: "approved", method: "human", score: args.score };
  if (args.correction === "excluded" || args.excluded_by_rule) {
    return { disposition: "none", method: null, score: args.score };
  }
  const score = args.score === null || !Number.isFinite(args.score) ? null : clampScore(args.score);
  if (score !== null && args.calibration?.available && args.calibration.threshold !== null
      && score >= args.calibration.threshold) {
    return { disposition: "approved", method: "labeling_function", score };
  }
  const retrievalFloor = args.retrieval_floor ?? 0.45;
  if (args.lexical_match || (score !== null && score >= retrievalFloor)) {
    return { disposition: "pending", method: "model", score: score ?? 0 };
  }
  return { disposition: "none", method: null, score };
}

export function signalTopicItemStateV1(decisions: SignalTopicCandidateDecisionV1[]) {
  if (decisions.some((decision) => decision.disposition === "pending")) return "pending" as const;
  if (decisions.some((decision) => decision.disposition === "approved")) return "approved" as const;
  return "abstained" as const;
}

export function signalTopicDefinitionDigestV1(input: Omit<SignalTopicDefinitionV1,
  "definition_digest" | "definition_revision" | "created_at" | "updated_at">) {
  return sha256(stableJson({
    contract_version: SIGNAL_TOPIC_CATALOG_CONTRACT_V1,
    term_key: input.term_key,
    definition: input.definition.trim(),
    scope: input.scope,
    inclusion: normalizedLines(input.inclusion),
    exclusion: normalizedLines(input.exclusion),
    positive_examples: normalizedLines(input.positive_examples),
    negative_examples: normalizedLines(input.negative_examples),
    lifecycle: input.lifecycle,
    origin: input.origin,
    source: input.source
  }));
}

export function signalTopicTermKeyV1(label: string) {
  const normalized = label.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "");
  return (/^[a-z]/u.test(normalized) ? normalized : `topic_${normalized || "untitled"}`)
    .slice(0, 80).replace(/_+$/gu, "");
}

export function signalTopicLexicalMatchV1(text: string, include: string[], exclude: string[]) {
  const haystack = normalizeLexical(text);
  const excluded = normalizedLines(exclude).some((phrase) => haystack.includes(normalizeLexical(phrase)));
  const matched = normalizedLines(include).some((phrase) => haystack.includes(normalizeLexical(phrase)));
  return { matched, excluded };
}

export function buildSignalTopicEmbeddingTextV1(topic: SignalTopicDefinitionV1, inheritedContext = "") {
  return [
    topic.definition,
    topic.inclusion.length ? `Include: ${topic.inclusion.join("; ")}` : "",
    topic.positive_examples.length ? `Positive examples: ${topic.positive_examples.join("; ")}` : "",
    inheritedContext.trim() ? `Brand context: ${inheritedContext.trim()}` : ""
  ].filter(Boolean).join("\n").slice(0, 6_000);
}

export function buildSignalTopicNegativeEmbeddingTextV1(topic: SignalTopicDefinitionV1) {
  return [
    topic.exclusion.length ? `Excluded meanings: ${topic.exclusion.join("; ")}` : "",
    topic.negative_examples.length ? `Negative examples: ${topic.negative_examples.join("; ")}` : ""
  ].filter(Boolean).join("\n").slice(0, 3_000);
}

export function buildSignalTopicEmbeddingInputsV1(topic: SignalTopicDefinitionV1, context: {
  context_digest: string;
  positive_text: string;
  negative_text: string;
}) {
  const positiveText = buildSignalTopicEmbeddingTextV1(topic, context.positive_text);
  const negativeText = [buildSignalTopicNegativeEmbeddingTextV1(topic), context.negative_text]
    .filter((value) => value.trim().length > 0).join("\n").slice(0, 4_000);
  return {
    positive: {
      digest: signalTopicEmbeddingCacheDigestV1({
        definition_digest: topic.definition_digest,
        context_digest: context.context_digest,
        role: "positive"
      }),
      text: positiveText
    },
    negative: negativeText ? {
      digest: signalTopicEmbeddingCacheDigestV1({
        definition_digest: topic.definition_digest,
        context_digest: context.context_digest,
        role: "negative"
      }),
      text: negativeText
    } : null
  };
}

export function signalTopicEmbeddingCacheDigestV1(args: {
  definition_digest: string;
  context_digest: string;
  role: "positive" | "negative";
}) {
  return sha256(stableJson({
    contract_version: SIGNAL_TOPIC_CLASSIFIER_CONTRACT_V1,
    definition_digest: args.definition_digest,
    context_digest: args.context_digest,
    role: args.role
  }));
}

/**
 * Voyage bills voyage-4-large at USD 0.12 per million input tokens. UTF-8 bytes are a
 * conservative token ceiling for these bounded text inputs, and free quota is deliberately ignored.
 */
export function estimateSignalTopicEmbeddingCostMicroUsdV1(args: {
  provider: string;
  model: string;
  texts: string[];
}) {
  if (args.provider !== "voyage" || args.model !== "voyage-4-large") {
    throw new Error("topic_embedding_pricing_unsupported");
  }
  const inputBytes = args.texts.reduce((sum, value) => sum + new TextEncoder().encode(value).byteLength, 0);
  return {
    pricing_version: SIGNAL_TOPIC_EMBEDDING_PRICING_VERSION_V1,
    input_bytes: inputBytes,
    estimated_micro_usd: inputBytes === 0 ? 0 : Math.max(1, Math.ceil(inputBytes * 12 / 100))
  };
}

export function signalTopicContrastScoreV1(positiveScore: number, negativeScore: number | null) {
  const positive = clampScore(positiveScore);
  if (negativeScore === null || !Number.isFinite(negativeScore)) {
    return { score: positive, excluded_by_negative: false };
  }
  const negative = clampScore(negativeScore);
  const excludedByNegative = negative >= 0.55 && negative >= positive;
  return {
    score: clampScore(positive - Math.max(0, negative) * 0.25),
    excluded_by_negative: excludedByNegative
  };
}

function classificationMetrics(labels: SignalTopicCalibrationLabelV1[], threshold: number) {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  for (const item of labels) {
    const predicted = item.score >= threshold;
    if (predicted && item.disposition === "belongs") truePositives += 1;
    if (predicted && item.disposition === "excluded") falsePositives += 1;
    if (!predicted && item.disposition === "belongs") falseNegatives += 1;
  }
  return {
    precision: truePositives + falsePositives === 0 ? 0 : truePositives / (truePositives + falsePositives),
    recall: truePositives + falseNegatives === 0 ? 0 : truePositives / (truePositives + falseNegatives),
    falsePositives,
    falseNegatives
  };
}

function countLabels(labels: SignalTopicCalibrationLabelV1[]) {
  return {
    positives: labels.filter((item) => item.disposition === "belongs").length,
    negatives: labels.filter((item) => item.disposition === "excluded").length
  };
}

function unavailable(
  reason: Exclude<SignalTopicCalibrationV1["reason"], "ready">,
  calibration: { positives: number; negatives: number },
  validation: { positives: number; negatives: number }
): SignalTopicCalibrationV1 {
  return {
    available: false,
    threshold: null,
    calibration,
    validation: { ...validation, precision: null, recall: null, false_positives: 0, false_negatives: 0 },
    reason
  };
}

function stableBucket(value: string) {
  return Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0, 8), 16) % 100;
}

function normalizedLines(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeLexical(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

function clampScore(value: number) {
  return Math.min(1, Math.max(-1, value));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

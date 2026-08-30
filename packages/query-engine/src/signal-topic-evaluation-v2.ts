import { createHash } from "node:crypto";

import { z } from "zod";

export const SIGNAL_TOPIC_EVALUATION_V2_CONTRACT = "signal-topic-evaluation-full-evidence-v2" as const;
export const SIGNAL_TOPIC_EVALUATION_V2_OUTPUT = "signal-topic-evaluation-full-evidence-output-v2" as const;
export const SIGNAL_TOPIC_EVALUATION_V2_CONFIRMATION = "RUN_BOUNDED_FULL_EVIDENCE_TOPIC_EVALUATION" as const;

export const SIGNAL_TOPIC_EVALUATION_V2_LIMITS = Object.freeze({
  max_model_turns: 12,
  max_tool_calls: 24,
  max_tool_result_bytes: 32_768,
  max_total_tool_result_bytes: 262_144,
  max_total_input_tokens: 450_000,
  max_total_output_tokens: 50_000,
  hard_cap_micro_usd: 20_000_000,
  catalog_limit: 116,
  representative_limit: 24,
  search_page_limit: 20,
  compare_cluster_limit: 5,
  context_limit: 40,
  top_view_limit: 10
} as const);

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const key = z.string().min(1).max(180).regex(/^[a-z0-9][a-z0-9._:-]*$/u);
const shortText = z.string().min(1).max(240);
const evidenceRef = digest;

export const signalTopicEvidenceClusterProfileSchemaV2 = z.object({
  label: z.string().min(1).max(240),
  terms: z.array(z.string().min(1).max(120)).max(24),
  phrases: z.array(z.string().min(1).max(240)).max(16),
  limitations: z.array(z.string().min(1).max(400)).max(12),
  distributions: z.object({
    language: z.record(z.string().regex(/^[a-z]{2}$/u), z.number().int().nonnegative()),
    market: z.record(z.string().regex(/^[A-Z]{2}$/u), z.number().int().nonnegative()),
    scope: z.record(z.string().max(40), z.number().int().nonnegative()),
    month: z.record(z.string().regex(/^\d{4}-\d{2}$/u), z.number().int().nonnegative())
  }).strict(),
  centrality_available: z.boolean()
}).strict();

const boundedFilters = z.object({
  language: z.string().regex(/^[a-z]{2}$/u).optional(),
  market: z.string().regex(/^[A-Z]{2}$/u).optional(),
  scope: z.enum(["primary_brand", "same_entity", "competitor", "category", "other"]).optional(),
  month_from: z.string().regex(/^\d{4}-\d{2}$/u).optional(),
  month_to: z.string().regex(/^\d{4}-\d{2}$/u).optional(),
  query: z.string().min(2).max(80).regex(/^[\p{L}\p{N}\s'’._-]+$/u).optional()
}).strict();

export const signalTopicEvidenceNavigationRequestV2 = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("cluster_catalog"), limit: z.number().int().min(1)
    .max(SIGNAL_TOPIC_EVALUATION_V2_LIMITS.catalog_limit), cursor: z.string().min(16).max(512).nullable() }).strict(),
  z.object({ operation: z.literal("cluster_profile"), cluster_key: key }).strict(),
  z.object({ operation: z.literal("representative_mentions"), cluster_key: key,
    limit: z.number().int().min(3).max(SIGNAL_TOPIC_EVALUATION_V2_LIMITS.representative_limit),
    filters: boundedFilters }).strict(),
  z.object({ operation: z.literal("search_cluster"), cluster_key: key,
    limit: z.number().int().min(1).max(SIGNAL_TOPIC_EVALUATION_V2_LIMITS.search_page_limit),
    cursor: z.string().min(16).max(512).nullable(), filters: boundedFilters }).strict(),
  z.object({ operation: z.literal("compare_clusters"), cluster_keys: z.array(key).min(2)
    .max(SIGNAL_TOPIC_EVALUATION_V2_LIMITS.compare_cluster_limit) }).strict(),
  z.object({ operation: z.literal("brand_os_context"), element_keys: z.array(key).min(1)
    .max(SIGNAL_TOPIC_EVALUATION_V2_LIMITS.context_limit) }).strict()
]);

export type SignalTopicEvidenceNavigationRequestV2 = z.infer<typeof signalTopicEvidenceNavigationRequestV2>;

export const signalTopicEvidenceMentionV2 = z.object({
  evidence_ref: evidenceRef,
  excerpt: z.string().min(1).max(600),
  language: z.string().regex(/^[a-z]{2}$/u).nullable(),
  market: z.string().regex(/^[A-Z]{2}$/u).nullable(),
  scope: z.string().min(1).max(40).nullable(),
  month: z.string().regex(/^\d{4}-\d{2}$/u),
  stratum: z.enum(["central", "edge", "minority"]),
  source_digest: digest
}).strict();

const clusterSummary = z.object({
  cluster_key: key, proposal_key: key.nullable(), member_count: z.number().int().positive(), profile_digest: digest
}).strict();
const cluster = clusterSummary.extend({ profile: signalTopicEvidenceClusterProfileSchemaV2 }).strict();
const contextElement = z.object({
  element_key: key, element_kind: key, display_text: z.string().min(1).max(600),
  scope: z.string().min(1).max(40), locale: z.string().min(1).max(35).nullable(),
  source_refs_digest: digest, evidence_count: z.number().int().nonnegative()
}).strict();
const mentionData = z.object({ cluster_key: key, mentions: z.array(signalTopicEvidenceMentionV2),
  sampling_limit: z.string().min(1).max(600) }).strict();

export const signalTopicEvidenceNavigationDataSchemasV2 = {
  cluster_catalog: z.object({ clusters: z.array(clusterSummary).max(SIGNAL_TOPIC_EVALUATION_V2_LIMITS.catalog_limit),
    total_clusters: z.literal(116) }).strict(),
  cluster_profile: cluster,
  representative_mentions: mentionData.extend({
    mentions: z.array(signalTopicEvidenceMentionV2).max(SIGNAL_TOPIC_EVALUATION_V2_LIMITS.representative_limit),
    sampling_guarantee: z.literal("deterministic_round_robin_across_observed_strata") }).strict(),
  search_cluster: mentionData.extend({
    mentions: z.array(signalTopicEvidenceMentionV2).max(SIGNAL_TOPIC_EVALUATION_V2_LIMITS.search_page_limit),
    sampling_guarantee: z.literal("stable_cluster_rank") }).strict(),
  compare_clusters: z.object({ clusters: z.array(cluster).min(2)
    .max(SIGNAL_TOPIC_EVALUATION_V2_LIMITS.compare_cluster_limit) }).strict(),
  brand_os_context: z.object({ elements: z.array(contextElement).min(1)
    .max(SIGNAL_TOPIC_EVALUATION_V2_LIMITS.context_limit) }).strict()
};

const navigationResultBase = z.object({
  contract_version: z.literal(SIGNAL_TOPIC_EVALUATION_V2_CONTRACT),
  snapshot_digest: digest,
  result_digest: digest,
  evidence_refs: z.array(evidenceRef).max(200).refine((refs) => new Set(refs).size === refs.length),
  next_cursor: z.string().min(16).max(512).nullable()
}).strict();

export const signalTopicEvidenceNavigationResultV2 = z.discriminatedUnion("operation", [
  navigationResultBase.extend({ operation: z.literal("cluster_catalog"),
    data: signalTopicEvidenceNavigationDataSchemasV2.cluster_catalog }).strict(),
  navigationResultBase.extend({ operation: z.literal("cluster_profile"), next_cursor: z.null(),
    data: signalTopicEvidenceNavigationDataSchemasV2.cluster_profile }).strict(),
  navigationResultBase.extend({ operation: z.literal("representative_mentions"), next_cursor: z.null(),
    data: signalTopicEvidenceNavigationDataSchemasV2.representative_mentions }).strict(),
  navigationResultBase.extend({ operation: z.literal("search_cluster"),
    data: signalTopicEvidenceNavigationDataSchemasV2.search_cluster }).strict(),
  navigationResultBase.extend({ operation: z.literal("compare_clusters"), next_cursor: z.null(),
    data: signalTopicEvidenceNavigationDataSchemasV2.compare_clusters }).strict(),
  navigationResultBase.extend({ operation: z.literal("brand_os_context"), next_cursor: z.null(),
    data: signalTopicEvidenceNavigationDataSchemasV2.brand_os_context }).strict()
]).superRefine((result, context) => {
  if (Buffer.byteLength(stableJson(result), "utf8") > SIGNAL_TOPIC_EVALUATION_V2_LIMITS.max_tool_result_bytes) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "topic_evaluation_v2_tool_result_too_large" });
  }
});

export type SignalTopicEvidenceNavigationResultV2 = z.infer<typeof signalTopicEvidenceNavigationResultV2>;

const candidate = z.object({
  candidate_key: key,
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(1_500),
  inclusion: z.array(shortText).min(1).max(16),
  exclusion: z.array(shortText).max(16),
  explanation: z.string().min(1).max(2_000),
  source_cluster_keys: z.array(key).min(1).max(12),
  evidence_refs: z.array(evidenceRef).min(1).max(48),
  status: z.literal("pending")
}).strict();

export const signalTopicEvaluationOutputSchemaV2 = z.object({
  contract_version: z.literal(SIGNAL_TOPIC_EVALUATION_V2_OUTPUT),
  candidates: z.array(candidate).min(1).max(200),
  ranking: z.array(z.object({ rank: z.number().int().min(1).max(10), candidate_key: key,
    ranking_reason: z.string().min(1).max(600) }).strict()).min(1).max(10)
}).strict();

export type SignalTopicEvaluationOutputV2 = z.infer<typeof signalTopicEvaluationOutputSchemaV2>;

export type SignalTopicEvaluationFlightCardV2 = {
  contract_version: typeof SIGNAL_TOPIC_EVALUATION_V2_CONTRACT;
  execution_enabled: false;
  provider_calls_allowed: 0;
  no_retry: true;
  action_time_confirmation_required: true;
  max_model_turns: number;
  max_tool_calls: number;
  max_tool_result_bytes: number;
  max_total_tool_result_bytes: number;
  max_total_input_tokens: number;
  max_total_output_tokens: number;
  hard_cap_micro_usd: number;
  preserve_complete_candidate_pool: true;
  top_view_limit: 10;
};

export function signalTopicEvaluationFlightCardV2(): SignalTopicEvaluationFlightCardV2 {
  return { contract_version: SIGNAL_TOPIC_EVALUATION_V2_CONTRACT, execution_enabled: false,
    provider_calls_allowed: 0, no_retry: true, action_time_confirmation_required: true,
    max_model_turns: SIGNAL_TOPIC_EVALUATION_V2_LIMITS.max_model_turns,
    max_tool_calls: SIGNAL_TOPIC_EVALUATION_V2_LIMITS.max_tool_calls,
    max_tool_result_bytes: SIGNAL_TOPIC_EVALUATION_V2_LIMITS.max_tool_result_bytes,
    max_total_tool_result_bytes: SIGNAL_TOPIC_EVALUATION_V2_LIMITS.max_total_tool_result_bytes,
    max_total_input_tokens: SIGNAL_TOPIC_EVALUATION_V2_LIMITS.max_total_input_tokens,
    max_total_output_tokens: SIGNAL_TOPIC_EVALUATION_V2_LIMITS.max_total_output_tokens,
    hard_cap_micro_usd: SIGNAL_TOPIC_EVALUATION_V2_LIMITS.hard_cap_micro_usd,
    preserve_complete_candidate_pool: true, top_view_limit: 10 };
}

export function parseSignalTopicEvidenceNavigationRequestV2(value: unknown) {
  const parsed = signalTopicEvidenceNavigationRequestV2.parse(value);
  if ("cluster_keys" in parsed && new Set(parsed.cluster_keys).size !== parsed.cluster_keys.length) {
    throw new Error("topic_evaluation_v2_duplicate_cluster_key");
  }
  if ("element_keys" in parsed && new Set(parsed.element_keys).size !== parsed.element_keys.length) {
    throw new Error("topic_evaluation_v2_duplicate_context_key");
  }
  if ("filters" in parsed && parsed.filters.month_from && parsed.filters.month_to
      && parsed.filters.month_from > parsed.filters.month_to) {
    throw new Error("topic_evaluation_v2_filter_range_invalid");
  }
  return parsed;
}

export function parseSignalTopicEvaluationOutputV2(raw: string, allowedEvidenceRefs: ReadonlySet<string>,
  allowedClusterKeys: ReadonlySet<string>): SignalTopicEvaluationOutputV2 {
  let decoded: unknown;
  try { decoded = JSON.parse(raw); } catch { throw new Error("topic_evaluation_v2_json_invalid"); }
  const output = signalTopicEvaluationOutputSchemaV2.parse(decoded);
  if (new Set(output.candidates.map((item) => item.candidate_key)).size !== output.candidates.length) {
    throw new Error("topic_evaluation_v2_duplicate_candidate_key");
  }
  for (const item of output.candidates) {
    if (new Set(item.evidence_refs).size !== item.evidence_refs.length
        || item.evidence_refs.some((ref) => !allowedEvidenceRefs.has(ref))) {
      throw new Error("topic_evaluation_v2_candidate_evidence_invalid");
    }
    if (new Set(item.source_cluster_keys).size !== item.source_cluster_keys.length
        || item.source_cluster_keys.some((clusterKey) => !allowedClusterKeys.has(clusterKey))) {
      throw new Error("topic_evaluation_v2_candidate_cluster_invalid");
    }
  }
  const candidateKeys = new Set(output.candidates.map((item) => item.candidate_key));
  const ranks = output.ranking.map((item) => item.rank).sort((left, right) => left - right);
  if (new Set(output.ranking.map((item) => item.candidate_key)).size !== output.ranking.length
      || output.ranking.some((item) => !candidateKeys.has(item.candidate_key))
      || ranks.some((rank, index) => rank !== index + 1)) {
    throw new Error("topic_evaluation_v2_ranking_invalid");
  }
  return output;
}

export function sanitizeSignalTopicEvidenceExcerptV2(value: string): string {
  return value.normalize("NFC").replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[email]")
    .replace(/https?:\/\/\S+/giu, "[url]")
    .replace(/(?<!\w)@[\p{L}\p{N}_.-]{2,}/gu, "[handle]")
    .replace(/\b(?:sk|key|token|secret)[-_][A-Za-z0-9_-]{8,}\b/giu, "[redacted]")
    .replace(/\s+/gu, " ").trim().slice(0, 600);
}

export function signalTopicEvaluationDigestV2(value: unknown) {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}

export type SignalTopicEvaluationTraceV2 = {
  turns: Array<{ turn_index: number; kind: "tool" | "final"; input_digest: string;
    output_digest: string; tool_operation: string | null; result_bytes: number;
    input_tokens: number; output_tokens: number; cost_micro_usd: number }>;
  retrievals: Array<{ retrieval_index: number; tool_input_digest: string; result_digest: string;
    evidence_refs: string[]; result_bytes: number }>;
  output: SignalTopicEvaluationOutputV2;
  total_tool_result_bytes: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_micro_usd: number;
  provider_calls: 0;
};

type OfflineUsageV2 = { input_tokens: number; output_tokens: number; cost_micro_usd: number };
type OfflineDecisionV2 = ({ kind: "tool"; request: unknown } | { kind: "final"; json: string }) &
  { usage?: OfflineUsageV2 };

export async function runOfflineSignalTopicEvaluationV2(args: {
  snapshot_digest: string;
  model: { next(input: { turn_index: number; prior_result_digests: string[] }): Promise<OfflineDecisionV2> };
  navigate: (request: SignalTopicEvidenceNavigationRequestV2) => Promise<SignalTopicEvidenceNavigationResultV2>;
}): Promise<SignalTopicEvaluationTraceV2> {
  digest.parse(args.snapshot_digest);
  const turns: SignalTopicEvaluationTraceV2["turns"] = [];
  const retrievals: SignalTopicEvaluationTraceV2["retrievals"] = [];
  const evidence = new Set<string>(); const clusters = new Set<string>();
  let totalBytes = 0; let totalInputTokens = 0; let totalOutputTokens = 0; let totalCostMicroUsd = 0;
  for (let turn = 0; turn < SIGNAL_TOPIC_EVALUATION_V2_LIMITS.max_model_turns; turn += 1) {
    const decision = await args.model.next({ turn_index: turn,
      prior_result_digests: retrievals.map((item) => item.result_digest) });
    const usage = decision.usage ?? { input_tokens: 0, output_tokens: 0, cost_micro_usd: 0 };
    if (![usage.input_tokens, usage.output_tokens, usage.cost_micro_usd].every((value) =>
      Number.isSafeInteger(value) && value >= 0)) throw new Error("topic_evaluation_v2_usage_invalid");
    totalInputTokens += usage.input_tokens; totalOutputTokens += usage.output_tokens;
    totalCostMicroUsd += usage.cost_micro_usd;
    if (totalInputTokens > SIGNAL_TOPIC_EVALUATION_V2_LIMITS.max_total_input_tokens
        || totalOutputTokens > SIGNAL_TOPIC_EVALUATION_V2_LIMITS.max_total_output_tokens) {
      throw new Error("topic_evaluation_v2_token_limit_exceeded");
    }
    if (totalCostMicroUsd > SIGNAL_TOPIC_EVALUATION_V2_LIMITS.hard_cap_micro_usd) {
      throw new Error("topic_evaluation_v2_cost_limit_exceeded");
    }
    if (decision.kind === "tool") {
      if (retrievals.length >= SIGNAL_TOPIC_EVALUATION_V2_LIMITS.max_tool_calls) {
        throw new Error("topic_evaluation_v2_tool_call_limit_exceeded");
      }
      const request = parseSignalTopicEvidenceNavigationRequestV2(decision.request);
      if ("cluster_key" in request) clusters.add(request.cluster_key);
      if ("cluster_keys" in request) request.cluster_keys.forEach((item) => clusters.add(item));
      const result = signalTopicEvidenceNavigationResultV2.parse(await args.navigate(request));
      if (result.snapshot_digest !== args.snapshot_digest || result.operation !== request.operation) {
        throw new Error("topic_evaluation_v2_tool_result_authority_mismatch");
      }
      const bytes = Buffer.byteLength(stableJson(result), "utf8");
      if (bytes > SIGNAL_TOPIC_EVALUATION_V2_LIMITS.max_tool_result_bytes) {
        throw new Error("topic_evaluation_v2_tool_result_too_large");
      }
      totalBytes += bytes;
      if (totalBytes > SIGNAL_TOPIC_EVALUATION_V2_LIMITS.max_total_tool_result_bytes) {
        throw new Error("topic_evaluation_v2_total_tool_result_limit_exceeded");
      }
      result.evidence_refs.forEach((item) => evidence.add(item));
      const inputDigest = signalTopicEvaluationDigestV2(request);
      retrievals.push({ retrieval_index: retrievals.length, tool_input_digest: inputDigest,
        result_digest: result.result_digest, evidence_refs: [...result.evidence_refs], result_bytes: bytes });
      turns.push({ turn_index: turn, kind: "tool", input_digest: inputDigest,
        output_digest: result.result_digest, tool_operation: request.operation, result_bytes: bytes,
        ...usage });
      continue;
    }
    const output = parseSignalTopicEvaluationOutputV2(decision.json, evidence, clusters);
    turns.push({ turn_index: turn, kind: "final", input_digest: signalTopicEvaluationDigestV2({
      prior_result_digests: retrievals.map((item) => item.result_digest) }),
    output_digest: signalTopicEvaluationDigestV2(output), tool_operation: null,
    result_bytes: Buffer.byteLength(decision.json, "utf8"), ...usage });
    return { turns, retrievals, output, total_tool_result_bytes: totalBytes,
      total_input_tokens: totalInputTokens, total_output_tokens: totalOutputTokens,
      total_cost_micro_usd: totalCostMicroUsd, provider_calls: 0 };
  }
  throw new Error("topic_evaluation_v2_model_turn_limit_exceeded");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort(utf8Compare).map((property) =>
    `${JSON.stringify(property)}:${stableJson(record[property])}`).join(",")}}`;
}

function utf8Compare(left: string, right: string) {
  return Buffer.from(left).compare(Buffer.from(right));
}

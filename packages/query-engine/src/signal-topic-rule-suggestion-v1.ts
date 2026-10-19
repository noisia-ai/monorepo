import { z } from "zod";
import {
  sanitizeSignalTopicEvidenceExcerptV2, signalTopicEvaluationDigestV2,
  signalTopicEvidenceMentionV2, signalTopicEvidenceNavigationDataSchemasV2
} from "./signal-topic-evaluation-v2";
import {
  parseSignalTopicRuleSpecV1, signalTopicRuleSpecDigestV1, signalTopicRuleSpecSchemaV1
} from "./signal-topic-rule-spec-v1";

export const SIGNAL_TOPIC_RULE_SUGGESTION_V1 = "signal-topic-rule-suggestion-v1" as const;
export const SIGNAL_TOPIC_RULE_SUGGESTION_LIMITS_V1 = Object.freeze({
  context_bytes: 18 * 1024, bootstrap_navigation_calls: 2, maximum_navigation_calls: 12,
  maximum_mention_traces: 10, maximum_citations: 12, explanation_characters: 600
} as const);

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const key = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,179}$/u);
const runKey = z.string().regex(/^[a-z0-9][a-z0-9._:-]{7,199}$/u);
const text = (maximum: number) => z.string().min(1).max(maximum)
  .refine((value) => !/[\u0000-\u0008\u000e-\u001f\u007f]/u.test(value))
  .refine((value) => value.trim().length > 0);
const unique = <T>(items: T[]) => new Set(items).size === items.length;
const refs = (maximum: number) => z.array(digest).max(maximum)
  .refine(unique, "topic_rule_suggestion_duplicate_citation").transform((items) => items.sort());
const explanation = text(SIGNAL_TOPIC_RULE_SUGGESTION_LIMITS_V1.explanation_characters);

export const signalTopicRuleSuggestionSchemaV1 = z.discriminatedUnion("status", [
  z.object({contract_version: z.literal(SIGNAL_TOPIC_RULE_SUGGESTION_V1), status: z.literal("suggested"),
    lexical: signalTopicRuleSpecSchemaV1.shape.lexical, filters: signalTopicRuleSpecSchemaV1.shape.filters,
    evidence_refs: refs(12).refine((items) => items.length > 0), explanation}).strict(),
  z.object({contract_version: z.literal(SIGNAL_TOPIC_RULE_SUGGESTION_V1),
    status: z.literal("insufficient_evidence"), explanation}).strict()
]);
export type SignalTopicRuleSuggestionV1 = z.infer<typeof signalTopicRuleSuggestionSchemaV1>;

const sourceSchema = z.object({workspace_id: z.string().uuid(), run_key: runKey, candidate_key: key,
  snapshot_digest: digest, session_key: runKey, candidate_revision: z.number().int().positive(),
  candidate_state_token: digest, candidate_version_digest: digest}).strict();
const candidateSchema = z.object({label: signalTopicRuleSpecSchemaV1.shape.label,
  definition: signalTopicRuleSpecSchemaV1.shape.definition,
  inclusion: z.array(text(240)).max(16), exclusion: z.array(text(240)).max(16),
  source_cluster_keys: z.array(key).min(1).max(12).refine(unique).transform((items) => items.sort()),
  historical_evidence_refs: refs(48)}).strict();
const draftSchema = z.object({revision: z.number().int().nonnegative(), digest: digest.nullable()})
  .strict().refine((value) => (value.revision === 0) === (value.digest === null),
    "topic_rule_suggestion_draft_binding_invalid");
const brandElementSchema = signalTopicEvidenceNavigationDataSchemasV2.brand_os_context.shape.elements.element;
const brandSchema = z.object({source: sourceSchema, status: z.enum(["available", "empty", "unavailable"]),
  authority_digest: digest.nullable(), elements: z.array(brandElementSchema).max(40)
    .refine((items) => unique(items.map((item) => item.element_key)))
    .transform((items) => items.sort((a, b) => compare(a.element_key, b.element_key)))
}).strict().refine((value) => value.status === "available"
  ? value.authority_digest !== null && value.elements.length > 0 : value.elements.length === 0,
"topic_rule_suggestion_brand_context_invalid");
const mentionSchema = z.discriminatedUnion("status", [
  signalTopicEvidenceMentionV2.extend({status: z.literal("available"),
    excerpt: text(600).transform(sanitizeSignalTopicEvidenceExcerptV2).pipe(z.string().min(1))}).strict(),
  z.object({evidence_ref: digest, status: z.literal("unavailable"),
    reason: z.enum(["rights_changed", "source_changed", "reference_unavailable"])}).strict()
]);
const traceSchema = z.object({source: sourceSchema, trace_index: z.number().int().min(3).max(12),
  operation: z.enum(["representative_mentions", "search_cluster"]), cluster_key: key,
  result_digest: digest, mentions: z.array(mentionSchema).max(20)
    .refine((items) => unique(items.map((item) => item.evidence_ref)))
    .transform((items) => items.sort((a, b) => compare(a.evidence_ref, b.evidence_ref)))
}).strict().refine((value) => value.operation !== "representative_mentions" || value.mentions.length <= 12,
  "topic_rule_suggestion_representative_limit");
const contextSchema = z.object({source: sourceSchema, candidate: candidateSchema,
  draft: draftSchema, brand_os: brandSchema, traces: z.array(traceSchema).max(10)
    .refine((items) => unique(items.map((item) => item.trace_index)))
    .transform((items) => items.sort((a, b) => a.trace_index - b.trace_index))}).strict();
export type SignalTopicRuleSuggestionContextV1 = z.infer<typeof contextSchema>;
type Trace = SignalTopicRuleSuggestionContextV1["traces"][number];

export function parseSignalTopicRuleSuggestionV1(value: unknown): SignalTopicRuleSuggestionV1 {
  return signalTopicRuleSuggestionSchemaV1.parse(value);
}

/** Server-side pure boundary, NOT authentication or proof of current rights. The future
 * caller must load these bindings and navigation results through the real core. Neither
 * a browser/model-supplied context nor a verified boolean grants authority. Historical
 * candidate citations are context only until read again in this exact session.
 */
function parseContext(value: unknown): SignalTopicRuleSuggestionContextV1 {
  const context = contextSchema.parse(value);
  const sourceDigest = signalTopicEvaluationDigestV2(context.source);
  if (signalTopicEvaluationDigestV2(context.brand_os.source) !== sourceDigest
    || context.traces.some((trace) => signalTopicEvaluationDigestV2(trace.source) !== sourceDigest
      || !context.candidate.source_cluster_keys.includes(trace.cluster_key))) {
    throw new Error("topic_rule_suggestion_context_mismatch");
  }
  const sources = new Map<string, string>();
  for (const trace of context.traces) for (const mention of trace.mentions) {
    if (mention.status !== "available") continue;
    const previous = sources.get(mention.evidence_ref);
    if (previous !== undefined && previous !== mention.source_digest) {
      throw new Error("topic_rule_suggestion_source_mismatch");
    }
    sources.set(mention.evidence_ref, mention.source_digest);
  }
  return context;
}

/** Deterministic model-facing projection only. Candidate identity and available Brand OS
 * stay pinned. Shorten prose first, then drop optional history while retaining at least
 * one recent citable mention when any exists. Mandatory metadata is never truncated.
 * Compaction is explicit, preserves opaque keys/digests, and never makes a removed or
 * historical reference newly citable. The full validated input is separately digested.
 */
export function prepareSignalTopicRuleSuggestionContextV1(value: unknown) {
  const context = parseContext(value);
  const citations = classifyCitations(context.traces);
  const history = context.traces.map(({trace_index, operation, cluster_key, result_digest, mentions}) =>
    ({trace_index, operation, cluster_key, result_digest,
      mentions: mentions.map((mention): Trace["mentions"][number] => {
        const citation = citations.get(mention.evidence_ref)!;
        return citation.status === "unavailable"
          ? {evidence_ref: mention.evidence_ref, status: "unavailable", reason: citation.reason} : mention;
      })}));
  const totalMentions = history.reduce((total, trace) => total + trace.mentions.length, 0);
  const projection = (textLimit: number, visible: typeof history) => ({
    contract_version: "signal-topic-rule-suggestion-context-v1" as const,
    context_digest: signalTopicEvaluationDigestV2(context),
    bootstrap: {
      candidate: {candidate_key: context.source.candidate_key, label: context.candidate.label,
        definition: context.candidate.definition,
        inclusion: context.candidate.inclusion.map((item) => shorten(item, textLimit)),
        exclusion: context.candidate.exclusion.map((item) => shorten(item, textLimit)),
        source_cluster_keys: context.candidate.source_cluster_keys},
      brand_os: {status: context.brand_os.status, authority_digest: context.brand_os.authority_digest,
        elements: context.brand_os.elements.map((element) => ({...element,
          display_text: shorten(sanitizeSignalTopicEvidenceExcerptV2(element.display_text), textLimit)}))}
    },
    history: visible.map((trace) => ({...trace, mentions: trace.mentions.map((mention) =>
      mention.status === "available" ? {...mention, excerpt: shorten(mention.excerpt, textLimit)} : mention)})),
    omitted_trace_count: history.length - visible.length,
    omitted_mention_count: totalMentions - visible.reduce((total, trace) => total + trace.mentions.length, 0),
    history_compacted: visible.some((trace) => trace.mentions.some((mention) =>
      mention.status === "available" && mention.excerpt.length > textLimit)),
    bootstrap_compacted: context.candidate.inclusion.some((item) => item.length > textLimit)
      || context.candidate.exclusion.some((item) => item.length > textLimit)
      || context.brand_os.elements.some((item) => item.display_text.length > textLimit)
  });
  const visible = history.map((trace) => ({...trace, mentions: [...trace.mentions]}));
  const latestAvailable = [...history].reverse().find((trace) =>
    trace.mentions.some((mention) => mention.status === "available"));
  let textLimit = 600, result = projection(textLimit, visible);
  for (const limit of [240, 120, 60]) {
    if (bytes(result) <= SIGNAL_TOPIC_RULE_SUGGESTION_LIMITS_V1.context_bytes) break;
    textLimit = limit;
    result = projection(textLimit, visible);
  }
  while (bytes(result) > SIGNAL_TOPIC_RULE_SUGGESTION_LIMITS_V1.context_bytes
    && visible.length > (latestAvailable ? 1 : 0)) {
    const optional = visible.findIndex((trace) => trace.trace_index !== latestAvailable?.trace_index);
    visible.splice(optional, 1);
    result = projection(textLimit, visible);
  }
  const remaining = visible[0];
  const pinnedRef = remaining && [...remaining.mentions].reverse()
    .find((mention) => mention.status === "available")?.evidence_ref;
  while (bytes(result) > SIGNAL_TOPIC_RULE_SUGGESTION_LIMITS_V1.context_bytes
    && remaining && remaining.mentions.length > 1) {
    remaining.mentions.splice(remaining.mentions.findIndex((mention) => mention.evidence_ref !== pinnedRef), 1);
    result = projection(textLimit, visible);
  }
  if (bytes(result) > SIGNAL_TOPIC_RULE_SUGGESTION_LIMITS_V1.context_bytes) {
    throw new Error("topic_rule_suggestion_bootstrap_too_large");
  }
  return result;
}

/** Produce data for the existing ordinary draft writer, never call it. Lexically matched
 * is not assigned/gold. The future save wrapper must recheck source/draft CAS and rights;
 * this result is not a permission token or a provider/claim/activation operation.
 */
export function adaptSignalTopicRuleSuggestionToDraftV1(value: {suggestion: unknown; context: unknown}) {
  const args = z.object({suggestion: z.unknown(), context: z.unknown()}).strict().parse(value);
  const context = parseContext(args.context), suggestion = parseSignalTopicRuleSuggestionV1(args.suggestion);
  const citations = classifyCitations(context.traces);
  const evidence = suggestion.status === "suggested" ? suggestion.evidence_refs.map((ref) => {
    const citation = citations.get(ref);
    if (!citation) throw new Error("topic_rule_suggestion_citation_not_read");
    if (citation.status === "unavailable") {
      throw new Error("topic_rule_suggestion_citation_unavailable");
    }
    return {evidence_ref: ref, source_digest: citation.source_digest, traces: citation.traces};
  }) : [];
  const context_digest = signalTopicEvaluationDigestV2(context);
  const provenance = {source: context.source, context_digest,
    brand_os_status: context.brand_os.status, brand_os_authority_digest: context.brand_os.authority_digest,
    evidence};
  const common = {contract_version: "signal-topic-rule-suggestion-draft-v1" as const,
    suggestion_digest: signalTopicEvaluationDigestV2({suggestion, provenance}), suggestion, provenance,
    run_key: context.source.run_key, candidate_key: context.source.candidate_key,
    expected_candidate_revision: context.source.candidate_revision,
    expected_candidate_state_token: context.source.candidate_state_token,
    expected_draft_revision: context.draft.revision, expected_draft_digest: context.draft.digest};
  if (suggestion.status === "insufficient_evidence") {
    return {...common, status: "insufficient_evidence" as const, rule_spec: null, spec_digest: null};
  }
  const rule_spec = parseSignalTopicRuleSpecV1({contract_version: "signal-topic-rule-spec-v1", kind: "topic",
    label: context.candidate.label, definition: context.candidate.definition,
    lexical: suggestion.lexical, filters: suggestion.filters});
  return {...common, status: "suggested" as const, rule_spec, spec_digest: signalTopicRuleSpecDigestV1(rule_spec)};
}
export type SignalTopicRuleSuggestionDraftV1 = ReturnType<typeof adaptSignalTopicRuleSuggestionToDraftV1>;

function traceBinding(trace: Trace) {
  return {trace_index: trace.trace_index, operation: trace.operation, cluster_key: trace.cluster_key,
    result_digest: trace.result_digest};
}
/** One conservative policy for both presentation and acceptance: any supplied unavailability
 * vetoes the ref, including an earlier available excerpt. This does not recheck DB rights.
 */
function classifyCitations(traces: Trace[]) {
  type Citation = {status: "available"; source_digest: string; traces: ReturnType<typeof traceBinding>[]}
    | {status: "unavailable"; reason: Extract<Trace["mentions"][number], {status: "unavailable"}>["reason"]};
  const citations = new Map<string, Citation>();
  for (const trace of traces) for (const mention of trace.mentions) {
    const previous = citations.get(mention.evidence_ref);
    if (previous?.status === "unavailable") continue;
    if (mention.status === "unavailable") {
      citations.set(mention.evidence_ref, {status: "unavailable", reason: mention.reason});
    } else if (previous) {
      previous.traces.push(traceBinding(trace));
    } else {
      citations.set(mention.evidence_ref, {status: "available", source_digest: mention.source_digest,
        traces: [traceBinding(trace)]});
    }
  }
  return citations;
}
function compare(a: string, b: string) {return a < b ? -1 : a > b ? 1 : 0;}
function bytes(value: unknown) {return Buffer.byteLength(JSON.stringify(value), "utf8");}
function shorten(value: string, limit: number) {return Array.from(value).slice(0, limit).join("");}

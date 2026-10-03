import { createHash } from "node:crypto";

import { z } from "zod";

export const SIGNAL_TOPIC_EVALUATION_CONTRACT_VERSION = "signal-topic-evaluation-v1" as const;
export const SIGNAL_TOPIC_EVALUATION_OUTPUT_CONTRACT_VERSION =
  "signal-topic-evaluation-output-v1" as const;
export const SIGNAL_TOPIC_EVALUATION_JOB_NAME = "signal-topic-evaluation-v1" as const;
export const SIGNAL_TOPIC_EVALUATION_PROVIDER_KEY_ENV = "ANTHROPIC_API_KEY" as const;
export const SIGNAL_TOPIC_EVALUATION_ENABLE_ENV = "NOISIA_TOPIC_EVALUATION_ENABLED" as const;
export const SIGNAL_TOPIC_EVALUATION_CONFIRMATION = "RUN_ONE_TOPIC_EVALUATION" as const;
export const SIGNAL_TOPIC_EVALUATION_SUCCESSOR_CONFIRMATION =
  "AUTHORIZE_ONE_TOPIC_EVALUATION_SUCCESSOR" as const;
export const SIGNAL_TOPIC_EVALUATION_SUCCESS_MINIMUM = 10 as const;

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const key = z.string().min(1).max(180).regex(/^[a-z0-9][a-z0-9._:-]*$/u);

export const signalTopicEvaluationEvidenceRefSchemaV1 = z.object({
  evidence_ref_digest: digest,
  mention_ref_digest: digest,
  relation: z.enum(["supports", "limits", "contradicts"])
}).strict();

export const signalTopicEvaluationProposalRefSchemaV1 = z.object({
  proposal_key: key,
  title: z.string().min(1).max(240),
  content_digest: digest,
  signals: z.object({
    cluster_member_count: z.number().int().nonnegative(),
    coverage: z.number().min(0).max(1),
    local_terms: z.array(z.string().min(1).max(160)).max(40),
    local_phrases: z.array(z.string().min(1).max(240)).max(24),
    scope_labels: z.array(z.string().min(1).max(80)).max(12),
    limitations: z.array(z.string().min(1).max(400)).max(12)
  }).strict(),
  evidence: z.array(signalTopicEvaluationEvidenceRefSchemaV1).min(1).max(24)
}).strict();

const contextElement = z.object({
  element_key: key,
  element_kind: z.string().min(1).max(80),
  display_text: z.string().min(1).max(4_000),
  scope: z.string().min(1).max(80),
  locale: z.string().min(1).max(35).nullable(),
  relation_kind: z.string().min(1).max(80).nullable(),
  relation_target_key: key.nullable(),
  source_refs_digest: digest,
  evidence_count: z.number().int().nonnegative()
}).strict();

export const signalTopicEvaluationEnvelopeSchemaV1 = z.object({
  contract_version: z.literal(SIGNAL_TOPIC_EVALUATION_CONTRACT_VERSION),
  corpus: z.object({
    identity: z.string().min(1).max(240),
    discovery_run_digest: digest,
    source_manifest_digest: digest,
    rights_digest: digest,
    modeling_count: z.number().int().positive()
  }).strict(),
  semantic_context: z.object({
    generation_key: key,
    generation_authority_digest: digest,
    brand_os_digest: digest,
    knowledge_digest: digest,
    locale_context_digest: digest,
    candidate_pack_digest: digest,
    approved_count: z.number().int().positive(),
    context_elements: z.array(contextElement).min(1).max(250)
  }).strict(),
  diagnostic_packet: z.object({
    packet_digest: digest,
    proposal_count: z.literal(115),
    evidence_count: z.number().int().min(115),
    proposals: z.array(signalTopicEvaluationProposalRefSchemaV1).length(115)
  }).strict()
}).strict();

const topicCandidateSchema = z.object({
  candidate_key: key,
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(1200),
  inclusion: z.array(z.string().min(1).max(240)).min(1).max(12),
  exclusion: z.array(z.string().min(1).max(240)).max(12),
  evidence_refs: z.array(digest).min(1).max(32),
  source_proposal_keys: z.array(key).min(1).max(24)
}).strict();

export const signalTopicEvaluationOutputSchemaV1 = z.object({
  contract_version: z.literal(SIGNAL_TOPIC_EVALUATION_OUTPUT_CONTRACT_VERSION),
  candidates: z.array(topicCandidateSchema).min(1).max(80)
}).strict();

/** Provider-facing schema intentionally uses only Anthropic-supported structural keywords.
 * Independent runtime parsing above owns lengths, cardinality and relational integrity. */
export const signalTopicEvaluationProviderOutputSchemaV1 = z.object({
  contract_version: z.literal(SIGNAL_TOPIC_EVALUATION_OUTPUT_CONTRACT_VERSION),
  candidates: z.array(z.object({
    candidate_key: z.string(),
    title: z.string(),
    description: z.string(),
    inclusion: z.array(z.string()),
    exclusion: z.array(z.string()),
    evidence_refs: z.array(z.string()),
    source_proposal_keys: z.array(z.string())
  }).strict())
}).strict();

export type SignalTopicEvaluationEnvelopeV1 = z.infer<typeof signalTopicEvaluationEnvelopeSchemaV1>;
export type SignalTopicEvaluationOutputV1 = z.infer<typeof signalTopicEvaluationOutputSchemaV1>;
export type SignalTopicEvaluationProviderBoundaryClassV1 =
  "definitely_not_sent" | "ambiguous_after_send";

/** Only explicit pre-transport failures may use definitely_not_sent. Unknown errors are
 * conservatively ambiguous because the provider may have accepted the request. */
export class SignalTopicEvaluationProviderBoundaryErrorV1 extends Error {
  constructor(public readonly outcome_class:SignalTopicEvaluationProviderBoundaryClassV1,
    public readonly safe_code:string){super(safe_code);this.name="SignalTopicEvaluationProviderBoundaryErrorV1";}
}

export function classifySignalTopicEvaluationProviderBoundaryV1(error:unknown):{
  outcome_class:SignalTopicEvaluationProviderBoundaryClassV1;error_code:
    "topic_evaluation_provider_definitely_not_sent"|"topic_evaluation_provider_ambiguous_after_send"}{
  const outcome=error instanceof SignalTopicEvaluationProviderBoundaryErrorV1
    ?error.outcome_class:"ambiguous_after_send";
  return outcome==="definitely_not_sent"
    ?{outcome_class:outcome,error_code:"topic_evaluation_provider_definitely_not_sent"}
    :{outcome_class:"ambiguous_after_send",error_code:"topic_evaluation_provider_ambiguous_after_send"};
}

export type SignalTopicEvaluationProviderV1 = { generate(request: {
  model: string;
  prompt: string;
  max_output_tokens: number;
  request_identity: string;
}): Promise<{ text: string; provider_request_id: string | null;
  usage: { input_tokens: number; output_tokens: number } }> };

export function buildSignalTopicEvaluationEnvelopeV1(
  input: SignalTopicEvaluationEnvelopeV1
): SignalTopicEvaluationEnvelopeV1 {
  const parsed = signalTopicEvaluationEnvelopeSchemaV1.parse(input);
  const proposals = [...parsed.diagnostic_packet.proposals]
    .sort((left, right) => utf8Compare(left.proposal_key, right.proposal_key))
    .map((proposal) => ({ ...proposal, evidence: [...proposal.evidence]
      .sort((left, right) => utf8Compare(
        `${left.evidence_ref_digest}|${left.relation}|${left.mention_ref_digest}`,
        `${right.evidence_ref_digest}|${right.relation}|${right.mention_ref_digest}`
      )) }));
  if (new Set(proposals.map((proposal) => proposal.proposal_key)).size !== proposals.length) {
    throw new Error("topic_evaluation_duplicate_proposal_key");
  }
  const contextElements=[...parsed.semantic_context.context_elements]
    .sort((left,right)=>utf8Compare(left.element_key,right.element_key));
  if(new Set(contextElements.map((element)=>element.element_key)).size!==contextElements.length){
    throw new Error("topic_evaluation_duplicate_context_element_key");
  }
  return { ...parsed,semantic_context:{...parsed.semantic_context,context_elements:contextElements},
    diagnostic_packet: { ...parsed.diagnostic_packet, proposals } };
}

export function parseSignalTopicEvaluationOutputV1(
  raw: string,
  envelope: SignalTopicEvaluationEnvelopeV1
): SignalTopicEvaluationOutputV1 {
  let decoded: unknown;
  try { decoded = JSON.parse(raw); }
  catch { throw new Error("topic_evaluation_provider_json_invalid"); }
  const output = signalTopicEvaluationOutputSchemaV1.parse(decoded);
  const proposalKeys = new Set(envelope.diagnostic_packet.proposals.map((item) => item.proposal_key));
  const evidenceRefs = new Set(envelope.diagnostic_packet.proposals.flatMap((item) =>
    item.evidence.map((evidence) => evidence.evidence_ref_digest)));
  if (new Set(output.candidates.map((candidate) => candidate.candidate_key)).size
      !== output.candidates.length) {
    throw new Error("topic_evaluation_duplicate_candidate_key");
  }
  for (const candidate of output.candidates) {
    if(new Set(candidate.evidence_refs).size!==candidate.evidence_refs.length){
      throw new Error("topic_evaluation_duplicate_candidate_evidence_ref");
    }
    if(new Set(candidate.source_proposal_keys).size!==candidate.source_proposal_keys.length){
      throw new Error("topic_evaluation_duplicate_candidate_source_proposal_key");
    }
    if (candidate.source_proposal_keys.some((value) => !proposalKeys.has(value))) {
      throw new Error("topic_evaluation_source_proposal_unknown");
    }
    if (candidate.evidence_refs.some((value) => !evidenceRefs.has(value))) {
      throw new Error("topic_evaluation_evidence_ref_unknown");
    }
  }
  return output;
}

export function signalTopicEvaluationDigestV1(value: unknown) {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}

export function signalTopicEvaluationJobDataV1(value: unknown) {
  return z.object({
    contract_version: z.literal(SIGNAL_TOPIC_EVALUATION_CONTRACT_VERSION),
    run_id: z.string().uuid()
  }).strict().parse(value);
}

export function signalTopicEvaluationSucceededV1(output: SignalTopicEvaluationOutputV1) {
  return output.candidates.length >= SIGNAL_TOPIC_EVALUATION_SUCCESS_MINIMUM;
}

export function stableSignalTopicEvaluationJsonV1(value: unknown): string {
  return stableJson(value);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort(utf8Compare)
    .map((property) => `${JSON.stringify(property)}:${stableJson(record[property])}`).join(",")}}`;
}

function utf8Compare(left: string, right: string) {
  return Buffer.from(left).compare(Buffer.from(right));
}

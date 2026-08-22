import { createHash } from "node:crypto";

import { z } from "zod";

export const SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_JOB_NAME =
  "signal.semantic-context-proposal.v1" as const;
export const SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_INPUT_CONTRACT_VERSION =
  "signal-semantic-context-proposal-input-v1" as const;
export const SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION =
  "signal-semantic-context-proposal-output-v1" as const;
export const SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_RUN_CONTRACT_VERSION =
  "signal-semantic-context-proposal-run-v1" as const;
export const SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_CONFIRMATION =
  "GENERATE_PENDING_SEMANTIC_CONTEXT_PROPOSALS" as const;

export const SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_ELEMENT_KINDS = [
  "identity_term", "alias", "product", "feature", "surface", "category", "need",
  "benefit", "friction", "usage_occasion", "competitor_term", "locale_variant",
  "exclusion", "homonym", "ambiguous_term", "abstention_rule", "positive_anchor",
  "negative_anchor", "boundary_anchor", "typed_relation"
] as const;
export const SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_RELATION_KINDS = [
  "is_a", "part_of", "surface_of", "competes_with", "associated_with"
] as const;
export const SIGNAL_SEMANTIC_CONTEXT_EVIDENCE_RELATIONS = [
  "supports", "limits", "contradicts"
] as const;

const keySchema = z.string().regex(/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u).max(160);
const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const localeSchema = z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/u);
const textSchema = z.string().trim().min(1).max(4_000);

const sourceBlockSchema = z.object({
  source_alias: keySchema,
  source_kind: z.enum([
    "brand_os_profile", "brand_os_product", "brand_os_competitor", "brand_os_seed_term",
    "knowledge_source", "knowledge_chunk", "knowledge_assertion"
  ]),
  content_kind: keySchema,
  title: z.string().trim().min(1).max(300),
  text: textSchema
}).strict();

const namedTermSchema = z.object({
  key: keySchema,
  display_text: z.string().trim().min(1).max(500),
  source_aliases: z.array(keySchema).min(1).max(20)
}).strict();

const entitySchema = z.object({
  entity_ref: keySchema,
  entity_type: z.enum(["brand", "competitor", "product", "category"]),
  display_name: z.string().trim().min(1).max(300),
  aliases: z.array(z.string().trim().min(1).max(300)).max(80),
  source_aliases: z.array(keySchema).min(1).max(20)
}).strict();

export const signalSemanticContextProposalInputSchemaV1 = z.object({
  contract_version: z.literal(SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_INPUT_CONTRACT_VERSION),
  generation_key: keySchema,
  authority: z.object({
    brand_os_digest: digestSchema,
    knowledge_digest: digestSchema,
    locale_context_digest: digestSchema
  }).strict(),
  locale_context: z.object({
    primary_locale: localeSchema,
    locale_variants: z.array(localeSchema).min(1).max(40),
    markets: z.array(z.string().regex(/^[A-Z]{2}$/u)).min(1).max(40),
    timezone: z.string().trim().min(1).max(100),
    code_switching: z.array(z.string().trim().min(1).max(100)).max(40)
  }).strict(),
  identity: z.object({
    primary: entitySchema,
    aliases: z.array(namedTermSchema).max(100)
  }).strict(),
  products: z.array(entitySchema).max(100),
  competitors: z.array(entitySchema).max(100),
  category: z.object({
    industry: z.string().trim().max(300).nullable(),
    subindustry: z.string().trim().max(300).nullable(),
    source_aliases: z.array(keySchema).min(1).max(20)
  }).strict(),
  structured_context: z.object({
    features: z.array(namedTermSchema).max(150),
    surfaces: z.array(namedTermSchema).max(150),
    needs: z.array(namedTermSchema).max(150),
    benefits: z.array(namedTermSchema).max(150),
    frictions: z.array(namedTermSchema).max(150),
    usage_occasions: z.array(namedTermSchema).max(150),
    inclusions: z.array(namedTermSchema).max(150),
    exclusions: z.array(namedTermSchema).max(150),
    homonyms: z.array(namedTermSchema).max(150),
    ambiguities: z.array(namedTermSchema).max(150),
    strategic_questions: z.array(namedTermSchema).max(100),
    limitations: z.array(namedTermSchema).max(100)
  }).strict(),
  knowledge_blocks: z.array(sourceBlockSchema).max(240),
  limits: z.object({
    maximum_proposals: z.literal(250),
    abstention_required_when_evidence_is_insufficient: z.literal(true),
    mentions_included: z.literal(false)
  }).strict()
}).strict();

export type SignalSemanticContextProposalInputV1 = z.infer<
  typeof signalSemanticContextProposalInputSchemaV1
>;

const evidenceAliasSchema = z.object({
  source_alias: keySchema,
  relation_type: z.enum(SIGNAL_SEMANTIC_CONTEXT_EVIDENCE_RELATIONS)
}).strict();

const providerProposalSchema = z.object({
  element_key: keySchema,
  element_kind: z.enum(SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_ELEMENT_KINDS),
  canonical_key: keySchema,
  display_text: z.string().trim().min(1).max(500),
  scope: z.enum(["primary_brand", "category", "competitor", "reference"]).nullable(),
  entity_type: z.enum(["brand", "competitor", "product", "category"]).nullable(),
  entity_ref: keySchema.nullable(),
  locale: localeSchema.nullable(),
  relation_kind: z.enum(SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_RELATION_KINDS).nullable(),
  relation_target_key: keySchema.nullable(),
  confidence: z.number().finite().min(0).max(1).nullable(),
  evidence: z.array(evidenceAliasSchema).min(1).max(50)
}).strict().superRefine((proposal, context) => {
  if ((proposal.entity_type === null) !== (proposal.entity_ref === null)) {
    context.addIssue({ code: "custom", message: "entity_type and entity_ref must be paired" });
  }
  const relation = proposal.element_kind === "typed_relation";
  if (relation !== Boolean(proposal.relation_kind && proposal.relation_target_key)) {
    context.addIssue({ code: "custom", message: "typed relations require a closed relation and target" });
  }
});

const providerOutputSchema = z.object({
  contract_version: z.literal(SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION),
  proposals: z.array(providerProposalSchema).min(1).max(250)
}).strict();

export type SignalSemanticContextProviderProposalV1 = z.infer<typeof providerProposalSchema>;
export type SignalSemanticContextProviderOutputV1 = z.infer<typeof providerOutputSchema>;

export type SignalSemanticContextProposalJobDataV1 = {
  contract_version: typeof SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_RUN_CONTRACT_VERSION;
  run_id: string;
};

export type SignalSemanticContextProposalProviderV1 = {
  generate(request: {
    model: string;
    prompt: string;
    max_output_tokens: number;
    temperature: 0;
    request_identity: string;
  }): Promise<{
    text: string;
    provider_request_id: string | null;
    usage: { input_tokens: number; output_tokens: number };
  }>;
};

const PROMPT_POLICY = {
  contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION,
  purpose: "Propose a compact structured Semantic Context Pack from governed Brand OS and Knowledge evidence.",
  authority: [
    "Every proposal is pending and non-authoritative.",
    "Do not approve, reject, publish, classify mentions, create Topic Contracts, or infer serving state.",
    "Use only source_alias and entity_ref values present in the supplied context.",
    "Do not return SQL, executable expressions, arbitrary IDs, prose outside JSON, or unknown fields.",
    "Abstain by omitting an element when the supplied evidence is insufficient.",
    "Do not manufacture every element kind; return only evidence-backed proposals.",
    "A confidence value is informational and never changes pending disposition."
  ],
  output: {
    contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION,
    proposals: "1..250 closed proposal objects"
  }
} as const;

export const SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V1 =
  signalSemanticContextProposalDigestV1(PROMPT_POLICY);

export function buildSignalSemanticContextProposalPromptV1(
  input: SignalSemanticContextProposalInputV1
) {
  const validated = signalSemanticContextProposalInputSchemaV1.parse(input);
  return [
    "You are producing governed acquisition-context proposals for human review.",
    "Return exactly one JSON object and no markdown or surrounding prose.",
    stableJson(PROMPT_POLICY),
    "GOVERNED_CONTEXT:",
    stableJson(validated)
  ].join("\n");
}

export function parseSignalSemanticContextProposalResponseV1(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error("semantic_context_provider_response_not_closed_json");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("semantic_context_provider_response_invalid_json");
  }
  const output = providerOutputSchema.parse(parsed);
  const elementKeys = new Set<string>();
  const semanticKeys = new Set<string>();
  for (const proposal of output.proposals) {
    if (elementKeys.has(proposal.element_key)) {
      throw new Error("semantic_context_provider_duplicate_element_key");
    }
    elementKeys.add(proposal.element_key);
    const semanticKey = [proposal.element_kind, proposal.canonical_key, proposal.locale ?? ""].join(":");
    if (semanticKeys.has(semanticKey)) {
      throw new Error("semantic_context_provider_duplicate_semantic_key");
    }
    semanticKeys.add(semanticKey);
    const evidence = new Set(proposal.evidence.map((item) =>
      `${item.source_alias}:${item.relation_type}`));
    if (evidence.size !== proposal.evidence.length) {
      throw new Error("semantic_context_provider_duplicate_evidence_alias");
    }
  }
  return output;
}

export function validateSignalSemanticContextProposalJobDataV1(value: unknown) {
  return z.object({
    contract_version: z.literal(SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_RUN_CONTRACT_VERSION),
    run_id: z.string().uuid()
  }).strict().parse(value);
}

export function signalSemanticContextProposalCostMicroUsdV1(args: {
  input_tokens: number;
  output_tokens: number;
  input_usd_per_million_tokens: number | string;
  output_usd_per_million_tokens: number | string;
}) {
  const inputRate = decimalRate(args.input_usd_per_million_tokens);
  const outputRate = decimalRate(args.output_usd_per_million_tokens);
  if (!Number.isSafeInteger(args.input_tokens) || args.input_tokens < 0
    || !Number.isSafeInteger(args.output_tokens) || args.output_tokens < 0) {
    throw new Error("semantic_context_provider_token_count_invalid");
  }
  const scale = 1_000_000n;
  return ceilDivide(BigInt(args.input_tokens) * inputRate
    + BigInt(args.output_tokens) * outputRate, scale);
}

export function signalSemanticContextProposalDigestV1(value: unknown) {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}

export function stableSignalSemanticContextJsonV1(value: unknown) {
  return stableJson(value);
}

function decimalRate(value: number | string) {
  const normalized = String(value).trim();
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/u.exec(normalized);
  if (!match) throw new Error("semantic_context_provider_pricing_invalid");
  return BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
}

function ceilDivide(numerator: bigint, denominator: bigint) {
  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

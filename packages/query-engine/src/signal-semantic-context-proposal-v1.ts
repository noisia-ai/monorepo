import { createHash } from "node:crypto";

import { z } from "zod";

export const SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_JOB_NAME =
  "signal.semantic-context-proposal.v1" as const;
export const SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_INPUT_CONTRACT_VERSION =
  "signal-semantic-context-proposal-input-v2" as const;
export const SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION =
  "signal-semantic-context-proposal-output-v1" as const;
export const SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V2 =
  "signal-semantic-context-proposal-output-v2" as const;
export const SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_V1_TO_V2_ADAPTER_VERSION =
  "signal-semantic-context-proposal-v1-to-v2-adapter-v1" as const;
export const SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_NORMALIZATION_VERSION =
  "signal-semantic-context-proposal-normalization-v1" as const;
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
export const SIGNAL_SEMANTIC_CONTEXT_CAPACITY_POLICY_VERSION =
  "signal-semantic-context-capacity-policy-v1" as const;
export const SIGNAL_SEMANTIC_CONTEXT_OUTPUT_TOKENS_PER_PROPOSAL_V1 = 256;
export const SIGNAL_SEMANTIC_CONTEXT_OUTPUT_ENVELOPE_TOKENS_V1 = 512;

export type SignalSemanticContextCapacityCountsV1 = {
  aliases: number;
  products: number;
  competitors: number;
  locale_variants: number;
  markets: number;
  code_switching: number;
  category_fields: number;
  structured_terms: number;
  knowledge_blocks: number;
  evidence_source_kinds: number;
};

export type SignalSemanticContextCapacityPlanV1 = {
  policy_version: typeof SIGNAL_SEMANTIC_CONTEXT_CAPACITY_POLICY_VERSION;
  policy_digest: string;
  capacity_digest: string;
  counts: SignalSemanticContextCapacityCountsV1;
  minimum_useful_proposals: number;
  target_proposals: number;
  maximum_proposals: number;
  output_token_budget: number;
  contract_capacity_saturated: boolean;
  explanation: Array<{ factor: string; units: number }>;
};

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
    capacity_policy_version: z.literal(SIGNAL_SEMANTIC_CONTEXT_CAPACITY_POLICY_VERSION),
    capacity_digest: digestSchema,
    minimum_useful_proposals: z.number().int().min(1).max(250),
    target_proposals: z.number().int().min(1).max(250),
    maximum_proposals: z.number().int().min(1).max(250),
    output_token_budget: z.number().int().min(1).max(64_000),
    abstention_required_when_evidence_is_insufficient: z.literal(true),
    mentions_included: z.literal(false)
  }).strict().superRefine((limits, context) => {
    if (limits.minimum_useful_proposals > limits.target_proposals
        || limits.target_proposals > limits.maximum_proposals) {
      context.addIssue({ code: "custom", message: "capacity proposal bounds must be ordered" });
    }
    const required = SIGNAL_SEMANTIC_CONTEXT_OUTPUT_ENVELOPE_TOKENS_V1
      + limits.maximum_proposals * SIGNAL_SEMANTIC_CONTEXT_OUTPUT_TOKENS_PER_PROPOSAL_V1;
    if (limits.output_token_budget !== required) {
      context.addIssue({ code: "custom", message: "output budget must match the sealed capacity" });
    }
  })
}).strict();

export type SignalSemanticContextProposalInputV1 = z.infer<
  typeof signalSemanticContextProposalInputSchemaV1
>;

const evidenceAliasSchema = z.object({
  source_alias: keySchema,
  relation_type: z.enum(SIGNAL_SEMANTIC_CONTEXT_EVIDENCE_RELATIONS)
}).strict();

export const signalSemanticContextProviderProposalSchemaV1 = z.object({
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

export function buildSignalSemanticContextProviderOutputSchemaV1(maximumProposals = 250) {
  if (!Number.isSafeInteger(maximumProposals) || maximumProposals < 1 || maximumProposals > 250) {
    throw new SignalSemanticContextProposalValidationError(
      "semantic_context_provider_proposal_limit_invalid"
    );
  }
  return z.object({
    contract_version: z.literal(SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION),
    proposals: z.array(signalSemanticContextProviderProposalSchemaV1).min(1).max(maximumProposals)
  }).strict();
}

export const signalSemanticContextProviderOutputSchemaV1 =
  buildSignalSemanticContextProviderOutputSchemaV1();

export type SignalSemanticContextProviderProposalV1 = z.infer<
  typeof signalSemanticContextProviderProposalSchemaV1
>;
export type SignalSemanticContextProviderOutputV1 = z.infer<
  typeof signalSemanticContextProviderOutputSchemaV1
>;

export const signalSemanticContextProviderProposalSchemaV2 = z.object({
  element_key: keySchema,
  element_kind: z.enum(SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_ELEMENT_KINDS),
  canonical_key: keySchema,
  display_text: z.string().trim().min(1).max(500),
  scope: z.enum(["primary_brand", "category", "competitor", "reference"]).nullable(),
  entity_ref: keySchema.nullable(),
  locale: localeSchema.nullable(),
  relation_kind: z.enum(SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_RELATION_KINDS).nullable(),
  relation_target_key: keySchema.nullable(),
  confidence: z.number().finite().min(0).max(1).nullable(),
  evidence: z.array(evidenceAliasSchema).min(1).max(50)
}).strict().superRefine((proposal, context) => {
  const relation = proposal.element_kind === "typed_relation";
  if (relation !== Boolean(proposal.relation_kind && proposal.relation_target_key)) {
    context.addIssue({ code: "custom", message: "typed relations require a closed relation and target" });
  }
});

export function buildSignalSemanticContextProviderOutputSchemaV2(maximumProposals = 250) {
  if (!Number.isSafeInteger(maximumProposals) || maximumProposals < 1 || maximumProposals > 250) {
    throw new SignalSemanticContextProposalValidationError(
      "semantic_context_provider_proposal_limit_invalid"
    );
  }
  return z.object({
    contract_version: z.literal(SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V2),
    proposals: z.array(signalSemanticContextProviderProposalSchemaV2).min(1).max(maximumProposals)
  }).strict();
}

export const signalSemanticContextProviderOutputSchemaV2 =
  buildSignalSemanticContextProviderOutputSchemaV2();

export type SignalSemanticContextProviderProposalV2 = z.infer<
  typeof signalSemanticContextProviderProposalSchemaV2
>;
export type SignalSemanticContextProviderOutputV2 = z.infer<
  typeof signalSemanticContextProviderOutputSchemaV2
>;
export type SignalSemanticContextProposalNormalizationV1 = {
  contract_version: typeof SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_NORMALIZATION_VERSION;
  input_contract_version: string;
  output_contract_version: typeof SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V2;
  proposal_count_before: number;
  proposal_count_after: number;
  duplicate_groups: Array<{
    semantic_key_digest: string;
    original_element_keys: string[];
    retained_element_key: string;
    evidence_count_before: number;
    evidence_count_after: number;
    confidence_policy: "maximum_non_authoritative_confidence";
  }>;
  transformation_digest: string;
};

export type SignalSemanticContextProposalValidationDiagnosticV1 = {
  issue_count: number;
  issues: Array<{ code: string; logical_path: string; count: number }>;
};

export class SignalSemanticContextProposalValidationError extends Error {
  override readonly name = "SignalSemanticContextProposalValidationError";
  constructor(public readonly code: string,
    public readonly diagnostic: SignalSemanticContextProposalValidationDiagnosticV1 = {
      issue_count: 0, issues: []
    }) {
    super(code);
  }
}

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
    maximum_proposals: number;
  }): Promise<{
    text: string;
    provider_request_id: string | null;
    usage: { input_tokens: number; output_tokens: number };
  }>;
};

const PROMPT_POLICY = {
  contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION,
  capacity_policy_version: SIGNAL_SEMANTIC_CONTEXT_CAPACITY_POLICY_VERSION,
  purpose: "Propose a compact structured Semantic Context Pack from governed Brand OS and Knowledge evidence.",
  authority: [
    "Every proposal is pending and non-authoritative.",
    "Do not approve, reject, publish, classify mentions, create Topic Contracts, or infer serving state.",
    "Use only source_alias and entity_ref values present in the supplied context.",
    "Do not return SQL, executable expressions, arbitrary IDs, prose outside JSON, or unknown fields.",
    "Abstain by omitting an element when the supplied evidence is insufficient.",
    "Do not manufacture every element kind; return only evidence-backed proposals.",
    "Treat target_proposals as a capacity target, not a quota; fewer proposals are correct when evidence is insufficient.",
    "A confidence value is informational and never changes pending disposition."
  ],
  output: {
    contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION,
    proposals: "1..sealed maximum_proposals closed proposal objects",
    proposal_shape: {
      element_key: "stable operator-safe key",
      element_kind: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_ELEMENT_KINDS,
      canonical_key: "normalized semantic key",
      display_text: "operator-safe text",
      scope: ["primary_brand", "category", "competitor", "reference", null],
      entity_type: ["brand", "competitor", "product", "category", null],
      entity_ref: "an opaque entity_ref from GOVERNED_CONTEXT or null",
      locale: "a governed locale from GOVERNED_CONTEXT or null",
      relation_kind: [...SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_RELATION_KINDS, null],
      relation_target_key: "another proposed element_key or null",
      confidence: "informational number from 0 through 1",
      evidence: {
        minimum: 1,
        source_alias: "an opaque source_alias from GOVERNED_CONTEXT",
        relation_type: ["supports", "limits", "contradicts"]
      }
    }
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

const PROMPT_POLICY_V2 = {
  ...PROMPT_POLICY,
  contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V2,
  authority: [
    ...PROMPT_POLICY.authority,
    "element_kind describes the proposed knowledge; entity_ref only contextualizes it under an existing governed entity.",
    "Never return entity_type. The server derives entity type from a supplied entity_ref.",
    "A proposed product or category may have entity_ref null when no governed entity exists for it."
  ],
  output: {
    ...PROMPT_POLICY.output,
    contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V2,
    proposal_shape: {
      element_key: PROMPT_POLICY.output.proposal_shape.element_key,
      element_kind: PROMPT_POLICY.output.proposal_shape.element_kind,
      canonical_key: PROMPT_POLICY.output.proposal_shape.canonical_key,
      display_text: PROMPT_POLICY.output.proposal_shape.display_text,
      scope: PROMPT_POLICY.output.proposal_shape.scope,
      entity_ref: "an opaque entity_ref from GOVERNED_CONTEXT or null; never invent a ref",
      locale: PROMPT_POLICY.output.proposal_shape.locale,
      relation_kind: PROMPT_POLICY.output.proposal_shape.relation_kind,
      relation_target_key: PROMPT_POLICY.output.proposal_shape.relation_target_key,
      confidence: PROMPT_POLICY.output.proposal_shape.confidence,
      evidence: PROMPT_POLICY.output.proposal_shape.evidence
    }
  }
} as const;

export const SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V2 =
  signalSemanticContextProposalDigestV1(PROMPT_POLICY_V2);

export function buildSignalSemanticContextProposalPromptV2(
  input: SignalSemanticContextProposalInputV1
) {
  const validated = signalSemanticContextProposalInputSchemaV1.parse(input);
  return [
    "You are producing governed acquisition-context proposals for human review.",
    "Return exactly one JSON object and no markdown or surrounding prose.",
    stableJson(PROMPT_POLICY_V2),
    "GOVERNED_CONTEXT:",
    stableJson(validated)
  ].join("\n");
}

export function parseSignalSemanticContextProposalResponseV1(text: string) {
  const trimmed = normalizeProviderJsonEnvelope(text);
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new SignalSemanticContextProposalValidationError(
      "semantic_context_provider_response_not_closed_json"
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new SignalSemanticContextProposalValidationError(
      "semantic_context_provider_response_invalid_json"
    );
  }
  const parsedOutput = signalSemanticContextProviderOutputSchemaV1.safeParse(parsed);
  if (!parsedOutput.success) throw validationErrorForIssues(parsedOutput.error.issues);
  const output = parsedOutput.data;
  const elementKeys = new Set<string>();
  const semanticKeys = new Set<string>();
  for (const proposal of output.proposals) {
    if (elementKeys.has(proposal.element_key)) {
      throw new SignalSemanticContextProposalValidationError(
        "semantic_context_provider_duplicate_element_key"
      );
    }
    elementKeys.add(proposal.element_key);
    const semanticKey = [proposal.element_kind, proposal.canonical_key, proposal.locale ?? ""].join(":");
    if (semanticKeys.has(semanticKey)) {
      throw new SignalSemanticContextProposalValidationError(
        "semantic_context_provider_duplicate_semantic_key"
      );
    }
    semanticKeys.add(semanticKey);
    const evidence = new Set(proposal.evidence.map((item) =>
      `${item.source_alias}:${item.relation_type}`));
    if (evidence.size !== proposal.evidence.length) {
      throw new SignalSemanticContextProposalValidationError(
        "semantic_context_provider_duplicate_evidence_alias"
      );
    }
  }
  return output;
}

const legacyProviderProposalForV2AdapterSchema = z.object({
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
  const relation = proposal.element_kind === "typed_relation";
  if (relation !== Boolean(proposal.relation_kind && proposal.relation_target_key)) {
    context.addIssue({ code: "custom", message: "typed relations require a closed relation and target" });
  }
});

const legacyProviderOutputForV2AdapterSchema = z.object({
  contract_version: z.literal(SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION),
  proposals: z.array(legacyProviderProposalForV2AdapterSchema).min(1).max(250)
}).strict();

export function parseSignalSemanticContextProposalResponseV2(
  text: string, maximumProposals = 250
) {
  const parsed = parseProviderResponseJson(text);
  const output = buildSignalSemanticContextProviderOutputSchemaV2(maximumProposals).safeParse(parsed);
  if (!output.success) throw validationErrorForIssues(output.error.issues);
  return normalizeSignalSemanticContextProviderOutputV2(output.data, {
    input_contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V2
  });
}

export function adaptSignalSemanticContextProposalResponseV1ToV2(
  text: string, maximumProposals = 250
) {
  const parsed = parseProviderResponseJson(text);
  const output = legacyProviderOutputForV2AdapterSchema.safeParse(parsed);
  if (!output.success) throw validationErrorForIssues(output.error.issues);
  if (output.data.proposals.length > maximumProposals) {
    throw new SignalSemanticContextProposalValidationError(
      "semantic_context_provider_proposal_limit_exceeded"
    );
  }
  const adapted: SignalSemanticContextProviderOutputV2 = {
    contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V2,
    proposals: output.data.proposals.map(({ entity_type: _providerControlledType, ...proposal }) => proposal)
  };
  return normalizeSignalSemanticContextProviderOutputV2(adapted, {
    input_contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION
  });
}

export function normalizeSignalSemanticContextProviderOutputV2(
  output: SignalSemanticContextProviderOutputV2,
  args: { input_contract_version: string }
): { output: SignalSemanticContextProviderOutputV2;
  normalization: SignalSemanticContextProposalNormalizationV1 } {
  const elementKeys = new Set<string>();
  for (const proposal of output.proposals) {
    if (elementKeys.has(proposal.element_key)) {
      throw new SignalSemanticContextProposalValidationError(
        "semantic_context_provider_duplicate_element_key"
      );
    }
    elementKeys.add(proposal.element_key);
  }
  for (const proposal of output.proposals) {
    if (proposal.relation_target_key && !elementKeys.has(proposal.relation_target_key)) {
      throw new SignalSemanticContextProposalValidationError(
        "semantic_context_provider_relation_target_unknown"
      );
    }
  }
  const groups = new Map<string, SignalSemanticContextProviderProposalV2[]>();
  for (const proposal of output.proposals) {
    const semanticKey = stableJson([proposal.element_kind, proposal.canonical_key, proposal.locale]);
    groups.set(semanticKey, [...groups.get(semanticKey) ?? [], proposal]);
  }
  const conflictIssues = [...groups.values()].flatMap((group) => {
    if (group.length < 2) return [];
    const first = normalizedProposalDefinition(group[0]!);
    const definitions = group.map(normalizedProposalDefinition);
    return (Object.keys(first) as Array<keyof typeof first>).flatMap((field) =>
      definitions.every((definition) => stableJson(definition[field]) === stableJson(first[field]))
        ? [] : [{ code: "conflict", logical_path: `proposals.*.${field}`, count: group.length }]);
  });
  if (conflictIssues.length) {
    throw new SignalSemanticContextProposalValidationError(
      "semantic_context_provider_duplicate_semantic_key_conflict",
      { issue_count: conflictIssues.reduce((total, issue) => total + issue.count, 0),
        issues: conflictIssues.sort((left, right) => left.logical_path.localeCompare(right.logical_path)) }
    );
  }
  const retainedByOriginal = new Map<string, string>();
  const duplicateGroups: SignalSemanticContextProposalNormalizationV1["duplicate_groups"] = [];
  const normalized = [...groups.entries()].map(([semanticKey, group]) => {
    const ordered = [...group].sort((left, right) => left.element_key.localeCompare(right.element_key));
    const retained = ordered[0]!;
    const definition = normalizedProposalDefinition(retained);
    if (!ordered.every((proposal) => stableJson(normalizedProposalDefinition(proposal))
        === stableJson(definition))) throw new Error("unreachable semantic duplicate conflict");
    for (const proposal of ordered) retainedByOriginal.set(proposal.element_key, retained.element_key);
    const evidenceBefore = ordered.reduce((total, proposal) => total + proposal.evidence.length, 0);
    const evidence = [...new Map(ordered.flatMap((proposal) => proposal.evidence)
      .map((item) => [`${item.source_alias}\u001f${item.relation_type}`, item])).values()]
      .sort((left, right) => left.source_alias.localeCompare(right.source_alias)
        || left.relation_type.localeCompare(right.relation_type));
    const confidenceValues = ordered.flatMap((proposal) => proposal.confidence === null
      ? [] : [proposal.confidence]);
    if (ordered.length > 1) duplicateGroups.push({
      semantic_key_digest: signalSemanticContextProposalDigestV1(semanticKey),
      original_element_keys: ordered.map((proposal) => proposal.element_key),
      retained_element_key: retained.element_key,
      evidence_count_before: evidenceBefore,
      evidence_count_after: evidence.length,
      confidence_policy: "maximum_non_authoritative_confidence"
    });
    return { ...retained, display_text: normalizeDisplayText(retained.display_text),
      confidence: confidenceValues.length ? Math.max(...confidenceValues) : null, evidence };
  }).map((proposal) => ({ ...proposal,
    relation_target_key: proposal.relation_target_key
      ? retainedByOriginal.get(proposal.relation_target_key) ?? proposal.relation_target_key : null
  })).sort((left, right) => left.element_key.localeCompare(right.element_key));
  const withoutDigest = {
    contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_NORMALIZATION_VERSION,
    input_contract_version: args.input_contract_version,
    output_contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V2,
    proposal_count_before: output.proposals.length,
    proposal_count_after: normalized.length,
    duplicate_groups: duplicateGroups.sort((left, right) =>
      left.semantic_key_digest.localeCompare(right.semantic_key_digest))
  } as const;
  return { output: { contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V2,
    proposals: normalized }, normalization: { ...withoutDigest,
    transformation_digest: signalSemanticContextProposalDigestV1(withoutDigest) } };
}

export function planSignalSemanticContextCapacityV1(args: {
  authority: {
    brand_os_digest: string;
    knowledge_digest: string;
    locale_context_digest: string;
  };
  counts: SignalSemanticContextCapacityCountsV1;
}): SignalSemanticContextCapacityPlanV1 {
  const counts = capacityCountsSchema.parse(args.counts);
  const authority = z.object({
    brand_os_digest: digestSchema,
    knowledge_digest: digestSchema,
    locale_context_digest: digestSchema
  }).strict().parse(args.authority);
  const factors = [
    { factor: "identity_category_guardrails", units: 8 },
    { factor: "aliases", units: counts.aliases },
    { factor: "products", units: counts.products * 2 },
    { factor: "competitors", units: counts.competitors * 3 },
    { factor: "locale_variants", units: counts.locale_variants * 2 },
    { factor: "markets", units: counts.markets },
    { factor: "code_switching", units: counts.code_switching },
    { factor: "category_fields", units: counts.category_fields * 2 },
    { factor: "structured_terms", units: counts.structured_terms },
    { factor: "knowledge_blocks", units: counts.knowledge_blocks },
    { factor: "evidence_source_kinds", units: counts.evidence_source_kinds * 2 }
  ];
  const rawTarget = factors.reduce((total, factor) => total + factor.units, 0);
  // 198 keeps the 25% exploration margin within the closed 250-proposal contract.
  // Saturation is explicit so callers can fail closed rather than silently lose coverage.
  const targetProposals = Math.max(12, Math.min(198, rawTarget));
  const maximumProposals = Math.min(250, Math.ceil(targetProposals * 1.25));
  const minimumUsefulProposals = Math.max(8, Math.ceil(targetProposals * 0.65));
  const outputTokenBudget = SIGNAL_SEMANTIC_CONTEXT_OUTPUT_ENVELOPE_TOKENS_V1
    + maximumProposals * SIGNAL_SEMANTIC_CONTEXT_OUTPUT_TOKENS_PER_PROPOSAL_V1;
  const policyDigest = signalSemanticContextProposalDigestV1({
    policy_version: SIGNAL_SEMANTIC_CONTEXT_CAPACITY_POLICY_VERSION,
    formula: {
      identity_category_guardrails: 8,
      aliases: 1,
      products: 2,
      competitors: 3,
      locale_variants: 2,
      markets: 1,
      code_switching: 1,
      category_fields: 2,
      structured_terms: 1,
      knowledge_blocks: 1,
      evidence_source_kinds: 2,
      minimum_ratio: "0.65",
      maximum_ratio: "1.25",
      maximum_target: 198,
      maximum_contract_proposals: 250,
      output_envelope_tokens: SIGNAL_SEMANTIC_CONTEXT_OUTPUT_ENVELOPE_TOKENS_V1,
      output_tokens_per_proposal: SIGNAL_SEMANTIC_CONTEXT_OUTPUT_TOKENS_PER_PROPOSAL_V1
    }
  });
  const planWithoutDigest = {
    policy_version: SIGNAL_SEMANTIC_CONTEXT_CAPACITY_POLICY_VERSION,
    policy_digest: policyDigest,
    authority,
    counts,
    minimum_useful_proposals: minimumUsefulProposals,
    target_proposals: targetProposals,
    maximum_proposals: maximumProposals,
    output_token_budget: outputTokenBudget,
    contract_capacity_saturated: rawTarget > 198,
    explanation: factors
  };
  return {
    ...planWithoutDigest,
    capacity_digest: signalSemanticContextProposalDigestV1(planWithoutDigest)
  };
}

const capacityCountsSchema = z.object({
  aliases: z.number().int().min(0).max(100),
  products: z.number().int().min(0).max(100),
  competitors: z.number().int().min(0).max(100),
  locale_variants: z.number().int().min(1).max(40),
  markets: z.number().int().min(1).max(40),
  code_switching: z.number().int().min(0).max(40),
  category_fields: z.number().int().min(0).max(2),
  structured_terms: z.number().int().min(0).max(1_700),
  knowledge_blocks: z.number().int().min(1).max(240),
  evidence_source_kinds: z.number().int().min(1).max(7)
}).strict();

export function signalSemanticContextMaximumProposalsForOutputTokensV1(maxOutputTokens: number) {
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new SignalSemanticContextProposalValidationError(
      "semantic_context_provider_output_token_budget_invalid"
    );
  }
  return Math.max(1, Math.min(250,
    Math.floor(maxOutputTokens / SIGNAL_SEMANTIC_CONTEXT_OUTPUT_TOKENS_PER_PROPOSAL_V1)));
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

function normalizeProviderJsonEnvelope(value: string) {
  const trimmed = value.trim();
  const fenced = /^```json\s*\n([\s\S]*)\n```$/u.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
}

function parseProviderResponseJson(text: string) {
  const trimmed = normalizeProviderJsonEnvelope(text);
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new SignalSemanticContextProposalValidationError(
      "semantic_context_provider_response_not_closed_json"
    );
  }
  try { return JSON.parse(trimmed) as unknown; }
  catch {
    throw new SignalSemanticContextProposalValidationError(
      "semantic_context_provider_response_invalid_json"
    );
  }
}

function normalizeDisplayText(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function normalizedProposalDefinition(proposal: SignalSemanticContextProviderProposalV2) {
  return {
    element_kind: proposal.element_kind,
    canonical_key: proposal.canonical_key,
    locale: proposal.locale,
    display_text: normalizeDisplayText(proposal.display_text),
    scope: proposal.scope,
    entity_ref: proposal.entity_ref,
    relation_kind: proposal.relation_kind,
    relation_target_key: proposal.relation_target_key
  };
}

function validationErrorForIssues(issues: z.ZodIssue[]) {
  const grouped = new Map<string, { code: string; logical_path: string; count: number }>();
  for (const issue of issues) {
    const logicalPath = issue.path.map((part) => typeof part === "number" ? "*" : part).join(".") || "$";
    const key = `${issue.code}:${logicalPath}`;
    const entry = grouped.get(key) ?? { code: issue.code, logical_path: logicalPath, count: 0 };
    entry.count += 1;
    grouped.set(key, entry);
  }
  const diagnostic = {
    issue_count: issues.length,
    issues: [...grouped.values()].sort((left, right) => left.logical_path.localeCompare(right.logical_path)
      || left.code.localeCompare(right.code))
  };
  const invalidAt = (path: string) => diagnostic.issues.some((issue) =>
    issue.logical_path === path && issue.code !== "invalid_type");
  const code = invalidAt("proposals.*.element_kind")
    ? "semantic_context_provider_element_kind_invalid"
    : invalidAt("proposals.*.relation_kind")
      ? "semantic_context_provider_relation_kind_invalid"
      : invalidAt("proposals.*.evidence.*.relation_type")
        ? "semantic_context_provider_evidence_relation_invalid"
        : invalidAt("proposals.*.locale")
          ? "semantic_context_provider_locale_invalid"
          : invalidAt("proposals.*.scope")
            ? "semantic_context_provider_scope_invalid"
            : invalidAt("proposals.*.confidence")
              ? "semantic_context_provider_confidence_invalid"
              : diagnostic.issues.some((issue) => issue.code === "invalid_type")
                ? "semantic_context_provider_required_field_invalid"
                : diagnostic.issues.some((issue) => issue.code === "unrecognized_keys")
                  ? "semantic_context_provider_unknown_field"
                  : "semantic_context_provider_response_schema_invalid";
  return new SignalSemanticContextProposalValidationError(code, diagnostic);
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

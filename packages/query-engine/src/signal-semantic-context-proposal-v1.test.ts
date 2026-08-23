import assert from "node:assert/strict";
import test from "node:test";

import {
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_INPUT_CONTRACT_VERSION,
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION,
  SignalSemanticContextProposalValidationError,
  buildSignalSemanticContextProviderOutputSchemaV1,
  buildSignalSemanticContextProposalPromptV1,
  parseSignalSemanticContextProposalResponseV1,
  planSignalSemanticContextCapacityV1,
  signalSemanticContextProposalCostMicroUsdV1,
  signalSemanticContextProposalDigestV1,
  signalSemanticContextProposalInputSchemaV1,
  signalSemanticContextMaximumProposalsForOutputTokensV1
} from "./signal-semantic-context-proposal-v1";

const digest = (value: string) => `sha256:${value.repeat(64)}`;
const fixtureCapacity = planSignalSemanticContextCapacityV1({
  authority: {
    brand_os_digest: digest("1"), knowledge_digest: digest("2"),
    locale_context_digest: digest("3")
  },
  counts: { aliases: 1, products: 0, competitors: 0, locale_variants: 2,
    markets: 2, code_switching: 1, category_fields: 1, structured_terms: 0,
    knowledge_blocks: 1, evidence_source_kinds: 1 }
});
const input = {
  contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_INPUT_CONTRACT_VERSION,
  generation_key: "semantic-context-v1",
  authority: {
    brand_os_digest: digest("1"), knowledge_digest: digest("2"),
    locale_context_digest: digest("3")
  },
  locale_context: {
    primary_locale: "es-MX", locale_variants: ["es-MX", "en-US"],
    markets: ["MX", "US"], timezone: "America/Mexico_City", code_switching: ["es-en"]
  },
  identity: {
    primary: { entity_ref: "brand.primary", entity_type: "brand" as const,
      display_name: "Marca ejemplo", aliases: ["Ejemplo"], source_aliases: ["src.001"] },
    aliases: [{ key: "alias.ejemplo", display_text: "Ejemplo", source_aliases: ["src.001"] }]
  },
  products: [], competitors: [],
  category: { industry: "Tecnología", subindustry: null, source_aliases: ["src.001"] },
  structured_context: { features: [], surfaces: [], needs: [], benefits: [], frictions: [],
    usage_occasions: [], inclusions: [], exclusions: [], homonyms: [], ambiguities: [],
    strategic_questions: [], limitations: [] },
  knowledge_blocks: [{ source_alias: "src.001", source_kind: "brand_os_profile" as const,
    content_kind: "identity", title: "Identidad", text: "Marca ejemplo de tecnología." }],
  limits: { capacity_policy_version: fixtureCapacity.policy_version,
    capacity_digest: fixtureCapacity.capacity_digest,
    minimum_useful_proposals: fixtureCapacity.minimum_useful_proposals,
    target_proposals: fixtureCapacity.target_proposals,
    maximum_proposals: fixtureCapacity.maximum_proposals,
    output_token_budget: fixtureCapacity.output_token_budget,
    abstention_required_when_evidence_is_insufficient: true as const,
    mentions_included: false as const }
};

const validOutput = {
  contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION,
  proposals: [{ element_key: "identity.example", element_kind: "identity_term",
    canonical_key: "example", display_text: "Marca ejemplo", scope: "primary_brand",
    entity_type: "brand", entity_ref: "brand.primary", locale: "es-MX",
    relation_kind: null, relation_target_key: null, confidence: 1,
    evidence: [{ source_alias: "src.001", relation_type: "supports" }] }]
};

test("semantic context proposal prompt is deterministic and contains no mention input", () => {
  const parsed = signalSemanticContextProposalInputSchemaV1.parse(input);
  const left = buildSignalSemanticContextProposalPromptV1(parsed);
  const right = buildSignalSemanticContextProposalPromptV1(parsed);
  assert.equal(left, right);
  assert.equal(signalSemanticContextProposalDigestV1(left), signalSemanticContextProposalDigestV1(right));
  assert.match(left, /"mentions_included":false/u);
  assert.doesNotMatch(left, /study_corpus_id|workspace_id|prompt_override/iu);
});

test("closed parser accepts confidence 1.0 without granting disposition", () => {
  const output = parseSignalSemanticContextProposalResponseV1(JSON.stringify(validOutput));
  assert.equal(output.proposals[0]?.confidence, 1);
  assert.equal("disposition" in output.proposals[0]!, false);
});

test("closed parser accepts only an exact JSON fence as bounded schema-preserving normalization", () => {
  const output = parseSignalSemanticContextProposalResponseV1(
    `\`\`\`json\n${JSON.stringify(validOutput)}\n\`\`\``
  );
  assert.equal(output.proposals.length, 1);
  assert.throws(() => parseSignalSemanticContextProposalResponseV1(
    `Result:\n\`\`\`json\n${JSON.stringify(validOutput)}\n\`\`\``
  ), (error: unknown) => error instanceof SignalSemanticContextProposalValidationError
    && error.code === "semantic_context_provider_response_not_closed_json");
});

test("sanitized incident shape remains atomic and reports the exact truncated JSON code", () => {
  const truncated = `\`\`\`json\n{"contract_version":"signal-semantic-context-proposal-output-v1",`;
  assert.throws(() => parseSignalSemanticContextProposalResponseV1(truncated),
    (error: unknown) => error instanceof SignalSemanticContextProposalValidationError
      && error.code === "semantic_context_provider_response_not_closed_json");
});

test("schema errors retain a stable operator-safe code and private logical paths", () => {
  const invalid = { ...validOutput, proposals: [{ ...validOutput.proposals[0], element_kind: "open_kind" }] };
  assert.throws(() => parseSignalSemanticContextProposalResponseV1(JSON.stringify(invalid)),
    (error: unknown) => error instanceof SignalSemanticContextProposalValidationError
      && error.code === "semantic_context_provider_element_kind_invalid"
      && error.diagnostic.issue_count === 1
      && error.diagnostic.issues[0]?.logical_path === "proposals.*.element_kind");
});

test("structured output schema and proposal bound derive from the sealed output budget", () => {
  assert.equal(signalSemanticContextMaximumProposalsForOutputTokensV1(5_000), 19);
  assert.equal(signalSemanticContextMaximumProposalsForOutputTokensV1(64_000), 250);
  const bounded = buildSignalSemanticContextProviderOutputSchemaV1(1);
  assert.equal(bounded.safeParse(validOutput).success, true);
  assert.equal(bounded.safeParse({ ...validOutput,
    proposals: [validOutput.proposals[0], { ...validOutput.proposals[0], element_key: "identity.second" }]
  }).success, false);
});

test("capacity planner is deterministic and does not over-reserve a small Brand OS", () => {
  const left = planSignalSemanticContextCapacityV1({ authority: input.authority,
    counts: { aliases: 1, products: 0, competitors: 0, locale_variants: 1,
      markets: 1, code_switching: 0, category_fields: 1, structured_terms: 0,
      knowledge_blocks: 1, evidence_source_kinds: 1 } });
  const right = planSignalSemanticContextCapacityV1({ authority: input.authority,
    counts: { ...left.counts } });
  assert.deepEqual(left, right);
  assert.equal(left.target_proposals, 17);
  assert.equal(left.maximum_proposals, 22);
  assert.equal(left.output_token_budget, 6_144);
  assert.equal(left.contract_capacity_saturated, false);
});

test("capacity planner reserves enough space for a multi-market multi-competitor context", () => {
  const plan = planSignalSemanticContextCapacityV1({ authority: input.authority,
    counts: { aliases: 3, products: 0, competitors: 6, locale_variants: 2,
      markets: 2, code_switching: 0, category_fields: 2, structured_terms: 0,
      knowledge_blocks: 19, evidence_source_kinds: 4 } });
  assert.deepEqual({ minimum: plan.minimum_useful_proposals, target: plan.target_proposals,
    maximum: plan.maximum_proposals, output: plan.output_token_budget },
  { minimum: 43, target: 66, maximum: 83, output: 21_760 });
  assert.equal(plan.contract_capacity_saturated, false);
  assert.ok(plan.explanation.some((factor) => factor.factor === "competitors" && factor.units === 18));
});

test("input contract rejects output capacity that does not match its proposal maximum", () => {
  assert.equal(signalSemanticContextProposalInputSchemaV1.safeParse({ ...input,
    limits: { ...input.limits, output_token_budget: input.limits.output_token_budget - 1 }
  }).success, false);
});

test("closed parser rejects prose, unknown fields and partial invalid responses", () => {
  assert.throws(() => parseSignalSemanticContextProposalResponseV1(`Result: ${JSON.stringify(validOutput)}`));
  assert.throws(() => parseSignalSemanticContextProposalResponseV1(JSON.stringify({
    ...validOutput, approved: true
  })));
  assert.throws(() => parseSignalSemanticContextProposalResponseV1(JSON.stringify({
    ...validOutput,
    proposals: [...validOutput.proposals, { ...validOutput.proposals[0], element_key: "bad",
      evidence: [{ source_alias: "src.missing", relation_type: "unknown" }] }]
  })));
});

test("closed parser rejects duplicate keys, semantic identities and evidence aliases", () => {
  const proposal = validOutput.proposals[0]!;
  assert.throws(() => parseSignalSemanticContextProposalResponseV1(JSON.stringify({
    ...validOutput, proposals: [proposal, proposal]
  })), /duplicate_element_key/u);
  assert.throws(() => parseSignalSemanticContextProposalResponseV1(JSON.stringify({
    ...validOutput, proposals: [proposal, { ...proposal, element_key: "identity.second" }]
  })), /duplicate_semantic_key/u);
  assert.throws(() => parseSignalSemanticContextProposalResponseV1(JSON.stringify({
    ...validOutput, proposals: [{ ...proposal, evidence: [proposal.evidence[0], proposal.evidence[0]] }]
  })), /duplicate_evidence_alias/u);
});

test("micro-USD accounting is exact and rounded upward", () => {
  assert.equal(signalSemanticContextProposalCostMicroUsdV1({ input_tokens: 1_000,
    output_tokens: 500, input_usd_per_million_tokens: "3", output_usd_per_million_tokens: "15" }),
  10_500n);
  assert.equal(signalSemanticContextProposalCostMicroUsdV1({ input_tokens: 1,
    output_tokens: 0, input_usd_per_million_tokens: "0.1", output_usd_per_million_tokens: "0" }), 1n);
});

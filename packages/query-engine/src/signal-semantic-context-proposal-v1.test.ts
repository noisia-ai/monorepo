import assert from "node:assert/strict";
import test from "node:test";

import {
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_INPUT_CONTRACT_VERSION,
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION,
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V2,
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V3,
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V1,
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V2,
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V3,
  SignalSemanticContextProposalValidationError,
  adaptSignalSemanticContextProposalResponseV1ToV2,
  buildSignalSemanticContextProviderOutputSchemaV1,
  buildSignalSemanticContextProviderOutputSchemaV2,
  buildSignalSemanticContextProviderOutputSchemaV3,
  buildSignalSemanticContextProposalPromptV1,
  buildSignalSemanticContextProposalPromptV2,
  buildSignalSemanticContextProposalPromptV3,
  parseSignalSemanticContextProposalResponseV1,
  parseSignalSemanticContextProposalResponseV2,
  parseSignalSemanticContextProposalResponseV3,
  planSignalSemanticContextCapacityV1,
  signalSemanticContextProposalCostMicroUsdV1,
  signalSemanticContextProposalDigestV1,
  signalSemanticContextProposalInputSchemaV1,
  isSignalSemanticContextProviderRelationInvariantV3,
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
const validOutputV2 = {
  contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V2,
  proposals: [{ element_key: "identity.example", element_kind: "identity_term",
    canonical_key: "example", display_text: "Marca ejemplo", scope: "primary_brand",
    entity_ref: "brand.primary", locale: "es-MX",
    relation_kind: null, relation_target_key: null, confidence: 1,
    evidence: [{ source_alias: "src.001", relation_type: "supports" }] }]
};
const validOutputV3 = {
  contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V3,
  proposals: [{ element_key: "identity.example", element_kind: "identity_term",
    canonical_key: "example", display_text: "Marca ejemplo", scope: "primary_brand",
    entity_ref: "brand.primary", locale: "es-MX",
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

test("V2 prompt removes provider-controlled entity type while retaining governed refs", () => {
  const prompt = buildSignalSemanticContextProposalPromptV2(
    signalSemanticContextProposalInputSchemaV1.parse(input)
  );
  assert.match(prompt, /signal-semantic-context-proposal-output-v2/u);
  assert.match(prompt, /"entity_ref"/u);
  assert.doesNotMatch(prompt, /"proposal_shape":\{[^\n]*"entity_type"/u);
});

test("V3 prompt states both relation branches and advances deterministic lineage", () => {
  const parsed = signalSemanticContextProposalInputSchemaV1.parse(input);
  const left = buildSignalSemanticContextProposalPromptV3(parsed);
  const right = buildSignalSemanticContextProposalPromptV3(parsed);
  assert.equal(left, right);
  assert.match(left, /When element_kind is typed_relation, relation_kind and relation_target_key are both required and non-null/u);
  assert.match(left, /For every element_kind other than typed_relation, relation_kind and relation_target_key must both be null/u);
  assert.match(left, /signal-semantic-context-proposal-output-v3/u);
  assert.notEqual(SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V3,
    SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V2);
  assert.equal(SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V3,
    "sha256:26aabf3ba52bdb4d07821d93275f280a9a18963edce3502167f4be41db22d918");
  assert.equal(SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V3,
    signalSemanticContextProposalDigestV1(JSON.parse(left.split("\n")[2]!)));
});

test("V1 and V2 historical prompt and parser snapshots remain unchanged", () => {
  assert.equal(SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V1,
    "sha256:6b538ab62bc912ef4f5656fe240c45f63ecfff7763e6514595d1dd02038bd818");
  assert.equal(SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_PROMPT_DIGEST_V2,
    "sha256:660d10054b8e6b042e002189132e4c3fa4ead98d11d3d4cd31cf8878276d7a1e");
  assert.equal(signalSemanticContextProposalDigestV1(
    parseSignalSemanticContextProposalResponseV1(JSON.stringify(validOutput))),
  "sha256:a5074b6fe216359820349215dd8d3fff87030698a654ec9738007e7c1f2375c7");
  assert.equal(signalSemanticContextProposalDigestV1(
    parseSignalSemanticContextProposalResponseV2(JSON.stringify(validOutputV2))),
  "sha256:fc4496a94080e2dd1d0d538a8a62bc6a4a01e4d9d68b62509405ff24c16672e1");
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

test("V2 provider schema accepts an unbound category and rejects provider entity_type", () => {
  const category = { ...validOutputV2, proposals: [{ ...validOutputV2.proposals[0],
    element_key: "category.voice", element_kind: "category", canonical_key: "voice-assistants",
    display_text: "Asistentes de voz", scope: "category", entity_ref: null }] };
  assert.equal(buildSignalSemanticContextProviderOutputSchemaV2(1).safeParse(category).success, true);
  assert.equal(buildSignalSemanticContextProviderOutputSchemaV2(1).safeParse({ ...category,
    proposals: [{ ...category.proposals[0], entity_type: "category" }]
  }).success, false);
});

test("V3 closed union rejects the sanitized non-relation mismatch", () => {
  const proposal = validOutputV3.proposals[0]!;
  const invalid = { ...validOutputV3, proposals: [{ ...proposal,
    relation_kind: "associated_with", relation_target_key: "identity.neighbor" }] };
  assert.equal(buildSignalSemanticContextProviderOutputSchemaV3(1).safeParse(invalid).success, false);
  assert.equal(isSignalSemanticContextProviderRelationInvariantV3(invalid.proposals[0]!), false);
  assert.throws(() => parseSignalSemanticContextProposalResponseV3(JSON.stringify(invalid)),
    (error: unknown) => error instanceof SignalSemanticContextProposalValidationError
      && error.code === "semantic_context_provider_response_schema_invalid");
});

test("V3 accepts null-only non-relations and complete typed relations", () => {
  const identity = validOutputV3.proposals[0]!;
  const relation = { ...identity, element_key: "relation.example-category",
    element_kind: "typed_relation", canonical_key: "example-category",
    relation_kind: "is_a", relation_target_key: identity.element_key };
  const output = { ...validOutputV3, proposals: [identity, relation] };
  assert.equal(buildSignalSemanticContextProviderOutputSchemaV3(2).safeParse(output).success, true);
  assert.equal(isSignalSemanticContextProviderRelationInvariantV3(identity), true);
  assert.equal(isSignalSemanticContextProviderRelationInvariantV3(relation), true);
  const parsed = parseSignalSemanticContextProposalResponseV3(JSON.stringify(output));
  assert.equal(parsed.output.proposals.length, 2);
  assert.ok(parsed.output.proposals.every((proposal) => !("disposition" in proposal)));
});

test("V3 rejects typed relations with either relation field null or absent", () => {
  const identity = validOutputV3.proposals[0]!;
  const relation = { ...identity, element_key: "relation.example",
    element_kind: "typed_relation", relation_kind: "associated_with",
    relation_target_key: identity.element_key };
  const { relation_kind: _kind, ...missingKind } = relation;
  const { relation_target_key: _target, ...missingTarget } = relation;
  for (const candidate of [{ ...relation, relation_kind: null },
    { ...relation, relation_target_key: null }, missingKind, missingTarget]) {
    assert.equal(buildSignalSemanticContextProviderOutputSchemaV3(1).safeParse({
      contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V3,
      proposals: [candidate]
    }).success, false);
  }
});

test("V3 retains closed enums, evidence, strict objects, and proposal capacity", () => {
  const proposal = validOutputV3.proposals[0]!;
  const schema = buildSignalSemanticContextProviderOutputSchemaV3(1);
  assert.equal(schema.safeParse({ ...validOutputV3, proposals: [{ ...proposal,
    open_field: true }] }).success, false);
  assert.equal(schema.safeParse({ ...validOutputV3, proposals: [{ ...proposal,
    element_kind: "open_kind" }] }).success, false);
  assert.equal(schema.safeParse({ ...validOutputV3, proposals: [{ ...proposal,
    evidence: [] }] }).success, false);
  assert.equal(schema.safeParse({ ...validOutputV3, proposals: [{ ...proposal,
    evidence: [{ source_alias: "src.001", relation_type: "open_relation" }] }] }).success, false);
  assert.equal(schema.safeParse({ ...validOutputV3,
    proposals: [proposal, { ...proposal, element_key: "identity.second",
      canonical_key: "second" }] }).success, false);
});

test("V2 safely collapses only equivalent semantic duplicates", () => {
  const proposal = validOutputV2.proposals[0]!;
  const parsed = parseSignalSemanticContextProposalResponseV2(JSON.stringify({ ...validOutputV2,
    proposals: [proposal, { ...proposal, element_key: "identity.second", confidence: 0.5,
      evidence: [{ source_alias: "src.002", relation_type: "limits" }] }]
  }));
  assert.equal(parsed.output.proposals.length, 1);
  assert.equal(parsed.output.proposals[0]?.element_key, "identity.example");
  assert.equal(parsed.output.proposals[0]?.confidence, 1);
  assert.deepEqual(parsed.output.proposals[0]?.evidence, [
    { source_alias: "src.001", relation_type: "supports" },
    { source_alias: "src.002", relation_type: "limits" }
  ]);
  assert.deepEqual(parsed.normalization.duplicate_groups[0]?.original_element_keys,
    ["identity.example", "identity.second"]);
  assert.throws(() => parseSignalSemanticContextProposalResponseV2(JSON.stringify({ ...validOutputV2,
    proposals: [proposal, { ...proposal, element_key: "identity.second", display_text: "Otra marca" }]
  })), /duplicate_semantic_key_conflict/u);
});

test("V1 paid-response adapter drops provider entity type and preserves explicit lineage", () => {
  const legacy = { ...validOutput, proposals: [{ ...validOutput.proposals[0],
    element_kind: "product", entity_type: "product", entity_ref: "brand.primary" } ] };
  const adapted = adaptSignalSemanticContextProposalResponseV1ToV2(JSON.stringify(legacy));
  assert.equal(adapted.output.proposals[0]?.element_kind, "product");
  assert.equal(adapted.output.proposals[0]?.entity_ref, "brand.primary");
  assert.equal("entity_type" in adapted.output.proposals[0]!, false);
  assert.equal(adapted.normalization.input_contract_version,
    SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION);
  assert.match(adapted.normalization.transformation_digest, /^sha256:[0-9a-f]{64}$/u);
});

test("V1 adapter fails closed for unknown relation targets and duplicate element keys", () => {
  const proposal = validOutput.proposals[0]!;
  assert.throws(() => adaptSignalSemanticContextProposalResponseV1ToV2(JSON.stringify({ ...validOutput,
    proposals: [{ ...proposal, element_key: "relation.one", element_kind: "typed_relation",
      relation_kind: "associated_with", relation_target_key: "missing.target" }]
  })), /relation_target_unknown/u);
  assert.throws(() => adaptSignalSemanticContextProposalResponseV1ToV2(JSON.stringify({ ...validOutput,
    proposals: [proposal, proposal]
  })), /duplicate_element_key/u);
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

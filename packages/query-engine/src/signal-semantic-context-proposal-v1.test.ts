import assert from "node:assert/strict";
import test from "node:test";

import {
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_INPUT_CONTRACT_VERSION,
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION,
  buildSignalSemanticContextProposalPromptV1,
  parseSignalSemanticContextProposalResponseV1,
  signalSemanticContextProposalCostMicroUsdV1,
  signalSemanticContextProposalDigestV1,
  signalSemanticContextProposalInputSchemaV1
} from "./signal-semantic-context-proposal-v1";

const digest = (value: string) => `sha256:${value.repeat(64)}`;
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
  limits: { maximum_proposals: 250 as const,
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

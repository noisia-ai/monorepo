import assert from "node:assert/strict";
import test from "node:test";

import { SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION } from "@noisia/query-engine";
import { createAnthropicSemanticContextProposalProviderV1 } from "../providers/anthropic-bounded-text";

test("semantic context reuses the bounded Anthropic transport with a closed dynamic schema", async () => {
  let observedMaximum = 0;
  const provider = createAnthropicSemanticContextProposalProviderV1(async (request) => {
    assert.ok(request.structured_output);
    const proposal = { element_key: "identity.fixture", element_kind: "identity_term",
      canonical_key: "fixture", display_text: "Fixture", scope: "primary_brand",
      entity_type: "brand", entity_ref: "entity.primary", locale: "es-MX",
      relation_kind: null, relation_target_key: null, confidence: 1,
      evidence: [{ source_alias: "src.0001", relation_type: "supports" }] };
    observedMaximum = request.structured_output.schema.safeParse({
      contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION,
      proposals: [proposal, { ...proposal, element_key: "identity.second" }]
    }).success ? 2 : 1;
    return { text: JSON.stringify({
      contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION,
      proposals: [proposal]
    }), provider_request_id: null, usage: { input_tokens: 10, output_tokens: 20 } };
  });
  const result = await provider.generate({ model: "fixture", prompt: "fixture", max_output_tokens: 512,
    temperature: 0, request_identity: "sha256:fixture", maximum_proposals: 1 });
  assert.equal(observedMaximum, 1);
  assert.equal(result.usage.output_tokens, 20);
});

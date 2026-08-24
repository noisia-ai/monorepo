import assert from "node:assert/strict";
import test from "node:test";

import { zodSchema } from "ai";

import { parseSignalSemanticContextProposalResponseV3,
  SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V3 } from "@noisia/query-engine";
import { createAnthropicSemanticContextProposalProviderV1 } from "../providers/anthropic-bounded-text";

test("semantic context reuses the bounded Anthropic transport with a closed dynamic schema", async () => {
  let observedMaximum = 0;
  let calls = 0;
  const provider = createAnthropicSemanticContextProposalProviderV1(async (request) => {
    calls += 1;
    assert.ok(request.structured_output);
    const proposal = { element_key: "identity.fixture", element_kind: "identity_term",
      canonical_key: "fixture", display_text: "Fixture", scope: "primary_brand",
      entity_ref: "entity.primary", locale: "es-MX",
      relation_kind: null, relation_target_key: null, confidence: 1,
      evidence: [{ source_alias: "src.0001", relation_type: "supports" }] };
    observedMaximum = request.structured_output.schema.safeParse({
      contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V3,
      proposals: [proposal, { ...proposal, element_key: "identity.second" }]
    }).success ? 2 : 1;
    return { text: JSON.stringify({
      contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V3,
      proposals: [proposal]
    }), provider_request_id: null, usage: { input_tokens: 10, output_tokens: 20 } };
  });
  const result = await provider.generate({ model: "fixture", prompt: "fixture", max_output_tokens: 512,
    temperature: 0, request_identity: "sha256:fixture", maximum_proposals: 1 });
  assert.equal(observedMaximum, 1);
  assert.equal(calls, 1);
  assert.equal(result.usage.output_tokens, 20);
  assert.equal(parseSignalSemanticContextProposalResponseV3(result.text).output.proposals.length, 1);
});

test("serialized provider schema closes the sanitized relation mismatch before transport", async () => {
  let branchFacts: ReturnType<typeof inspectRelationBranches> | null = null;
  const provider = createAnthropicSemanticContextProposalProviderV1(async (request) => {
    assert.ok(request.structured_output);
    const serialized = await zodSchema(request.structured_output.schema).jsonSchema;
    branchFacts = inspectRelationBranches(serialized as Record<string, unknown>);
    return { text: JSON.stringify({
      contract_version: SIGNAL_SEMANTIC_CONTEXT_PROPOSAL_OUTPUT_CONTRACT_VERSION_V3,
      proposals: [proposal("identity_term", null, null)]
    }), provider_request_id: null, usage: { input_tokens: 10, output_tokens: 20 } };
  });
  await provider.generate({ model: "fixture", prompt: "fixture", max_output_tokens: 512,
    temperature: 0, request_identity: "sha256:fixture", maximum_proposals: 3 });
  assert.deepEqual(branchFacts, {
    branch_count: 2,
    typed_relation: { element_kind: "typed_relation", relation_kind: "closed_enum",
      relation_target_key: "non_null_key" },
    non_relation: { excludes_typed_relation: true, relation_kind: "null_only",
      relation_target_key: "null_only" },
    non_relation_shape_matches: true,
    typed_relation_shape_matches: true,
    typed_relation_missing_field_matches: false,
    sanitized_invalid_shape_matches_any_branch: false
  });
});

function proposal(elementKind: string, relationKind: string | null,
  relationTargetKey: string | null) {
  return { element_key: "identity.fixture", element_kind: elementKind,
    canonical_key: "fixture", display_text: "Fixture", scope: "primary_brand",
    entity_ref: "entity.primary", locale: "es-MX", relation_kind: relationKind,
    relation_target_key: relationTargetKey, confidence: 1,
    evidence: [{ source_alias: "src.0001", relation_type: "supports" }] };
}

function inspectRelationBranches(schema: Record<string, unknown>) {
  const proposals = object(object(schema.properties).proposals);
  const items = object(proposals.items);
  const branches = Array.isArray(items.anyOf)
    ? items.anyOf.filter((entry): entry is Record<string, unknown> => isObject(entry)) : [];
  const typed = branches.find((branch) =>
    object(object(branch.properties).element_kind).const === "typed_relation");
  const nonRelation = branches.find((branch) => {
    const kinds = object(object(branch.properties).element_kind).enum;
    return Array.isArray(kinds) && kinds.includes("identity_term");
  });
  const invalid = proposal("identity_term", "associated_with", "identity.neighbor");
  const validNonRelation = proposal("identity_term", null, null);
  const validTypedRelation = proposal("typed_relation", "associated_with", "identity.neighbor");
  const { relation_target_key: _missing, ...typedMissingField } = validTypedRelation;
  return {
    branch_count: branches.length,
    typed_relation: typed ? {
      element_kind: object(object(typed.properties).element_kind).const,
      relation_kind: Array.isArray(object(object(typed.properties).relation_kind).enum)
        ? "closed_enum" : "not_closed",
      relation_target_key: object(object(typed.properties).relation_target_key).type === "string"
        ? "non_null_key" : "not_non_null"
    } : null,
    non_relation: nonRelation ? {
      excludes_typed_relation: !(object(object(nonRelation.properties).element_kind).enum as unknown[])
        .includes("typed_relation"),
      relation_kind: object(object(nonRelation.properties).relation_kind).type === "null"
        ? "null_only" : "not_null_only",
      relation_target_key: object(object(nonRelation.properties).relation_target_key).type === "null"
        ? "null_only" : "not_null_only"
    } : null,
    non_relation_shape_matches: Boolean(nonRelation
      && relationShapeMatches(nonRelation, validNonRelation)),
    typed_relation_shape_matches: Boolean(typed
      && relationShapeMatches(typed, validTypedRelation)),
    typed_relation_missing_field_matches: Boolean(typed
      && relationShapeMatches(typed, typedMissingField)),
    sanitized_invalid_shape_matches_any_branch: branches.some((branch) =>
      relationShapeMatches(branch, invalid))
  };
}

function relationShapeMatches(branch: Record<string, unknown>, candidate: Record<string, unknown>) {
  const properties = object(branch.properties);
  const required = Array.isArray(branch.required) ? branch.required : [];
  if (required.some((field) => typeof field === "string" && !Object.hasOwn(candidate, field))) {
    return false;
  }
  return ["element_kind", "relation_kind", "relation_target_key"].every((field) => {
    const rule = object(properties[field]);
    const value = candidate[field];
    if (Object.hasOwn(rule, "const")) return value === rule.const;
    if (Array.isArray(rule.enum)) return rule.enum.includes(value);
    return rule.type === "null" ? value === null : rule.type === typeof value;
  });
}

function object(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

import assert from "node:assert/strict";
import test from "node:test";

import {
  SIGNAL_SEMANTIC_CONTEXT_AUTOMATIC_POLICY_VERSION,
  evaluateSignalSemanticContextAutomaticPolicyV1
} from "./signal-semantic-context-automatic-policy";

const support = (source_id = "00000000-0000-4000-8000-000000000001") => ({
  source_type: "knowledge_chunk",
  source_id,
  relation_type: "supports"
});

const ordinary = (overrides: Record<string, unknown> = {}) => ({
  element_key: "benefit.task-execution",
  element_kind: "benefit",
  canonical_key: "task-execution",
  display_text: "Task execution",
  scope: "primary_brand",
  entity_type: null,
  entity_id: null,
  locale: null,
  relation_kind: null,
  relation_target_key: null,
  confidence: 1,
  origin_kind: "provider_proposal" as const,
  source_refs: [support()],
  ...overrides
});

const context = (proposals: ReturnType<typeof ordinary>[]) => ({
  generation_key: "semantic-context-fixture-v1",
  parent_authority: {
    valid: true,
    parent_authority_digest: `sha256:${"1".repeat(64)}`,
    locales: ["en-US", "es-MX"],
    markets: ["MX", "US"]
  },
  proposals,
  current_leaves: []
});

test("automatic policy makes ordinary supported output ready without copying primary locale", () => {
  const result = evaluateSignalSemanticContextAutomaticPolicyV1(context([ordinary()]));
  assert.equal(result.contract_version, SIGNAL_SEMANTIC_CONTEXT_AUTOMATIC_POLICY_VERSION);
  assert.equal(result.ready_count, 1);
  assert.equal(result.exception_count, 0);
  assert.deepEqual(result.decisions[0]?.applicability, {
    state: "workspace_inherited",
    locale: null,
    locales: ["en-US", "es-MX"],
    markets: ["MX", "US"]
  });
});

test("automatic policy accepts only a supported sealed locale variant as explicit locale", () => {
  const result = evaluateSignalSemanticContextAutomaticPolicyV1(context([ordinary({
    element_key: "locale.alexa-mx",
    element_kind: "locale_variant",
    canonical_key: "alexa-mx",
    display_text: "Alexa México",
    locale: "es-MX"
  })]));
  assert.equal(result.ready_count, 1);
  assert.deepEqual(result.decisions[0]?.applicability, {
    state: "explicit_locale",
    locale: "es-MX",
    locales: ["es-MX"],
    markets: ["MX", "US"]
  });
});

test("automatic policy keeps only genuine validation exceptions pending", () => {
  const proposals = [
    ordinary({ element_key: "missing", canonical_key: "missing", source_refs: [] }),
    ordinary({ element_key: "contradicted", canonical_key: "contradicted", source_refs: [support(), {
      ...support("00000000-0000-4000-8000-000000000002"), relation_type: "contradicts"
    }] }),
    ordinary({ element_key: "duplicate-a", canonical_key: "duplicate" }),
    ordinary({ element_key: "duplicate-b", canonical_key: "duplicate" }),
    ordinary({ element_key: "broken-relation", canonical_key: "broken-relation",
      element_kind: "typed_relation", relation_kind: "associated_with",
      relation_target_key: "unknown.target" }),
    ordinary({ element_key: "unsupported-locale", canonical_key: "unsupported-locale",
      element_kind: "locale_variant", locale: "fr-FR" })
  ];
  const result = evaluateSignalSemanticContextAutomaticPolicyV1(context(proposals));
  assert.equal(result.ready_count, 0);
  assert.equal(result.exception_count, proposals.length);
  assert.deepEqual(result.decisions.map((decision) => [decision.element_key, decision.reasons]), [
    ["broken-relation", ["relation_target_unresolved"]],
    ["contradicted", ["evidence_contradictory"]],
    ["duplicate-a", ["semantic_collision"]],
    ["duplicate-b", ["semantic_collision"]],
    ["missing", ["evidence_missing"]],
    ["unsupported-locale", ["locale_not_in_parent_envelope"]]
  ]);
});

test("automatic policy rejects invalid schema before any cohort can be persisted", () => {
  assert.throws(() => evaluateSignalSemanticContextAutomaticPolicyV1(context([ordinary({
    element_key: "invalid-schema", canonical_key: "invalid-schema", element_kind: "open_kind"
  })])), /semantic_context_proposal_schema_invalid/u);
});

test("automatic policy fails closed before persistence when parent authority is stale", () => {
  const input = context([ordinary(), ordinary({ element_key: "feature.voice", element_kind: "feature",
    canonical_key: "voice", display_text: "Voice" })]);
  input.parent_authority.valid = false;
  assert.throws(() => evaluateSignalSemanticContextAutomaticPolicyV1(input),
    /semantic_context_parent_authority_invalid/u);
});

test("relation readiness reaches a fixed point and rejects self, cycles, and invalid chains", () => {
  const relation = (element_key: string, relation_target_key: string) => ordinary({
    element_key, canonical_key: element_key, element_kind: "typed_relation",
    relation_kind: "associated_with", relation_target_key
  });
  const result = evaluateSignalSemanticContextAutomaticPolicyV1(context([
    ordinary({ element_key: "valid-target", canonical_key: "valid-target" }),
    relation("valid-hop-2", "valid-target"), relation("valid-hop-1", "valid-hop-2"),
    relation("self", "self"), relation("cycle-a", "cycle-b"), relation("cycle-b", "cycle-a"),
    relation("invalid-hop", "missing")
  ]));
  assert.equal(result.ready_count, 3);
  assert.deepEqual(result.decisions.filter((decision) => decision.outcome === "exception")
    .map((decision) => [decision.element_key, decision.reasons]), [
    ["cycle-a", ["relation_target_unresolved"]],
    ["cycle-b", ["relation_target_unresolved"]],
    ["invalid-hop", ["relation_target_unresolved"]],
    ["self", ["relation_target_unresolved"]]
  ]);
});

test("mixed collision and unresolved relation reasons use distinct UTF-8 ordering",()=>{
  const relation=(element_key:string)=>ordinary({element_key,canonical_key:"shared-relation",
    element_kind:"typed_relation",relation_kind:"associated_with",relation_target_key:"missing"});
  const result=evaluateSignalSemanticContextAutomaticPolicyV1(context([
    relation("mixed-relation-a"),relation("mixed-relation-b")
  ]));
  assert.equal(result.ready_count,0);assert.equal(result.exception_count,2);
  for(const decision of result.decisions){
    assert.deepEqual(decision.reasons,["relation_target_unresolved","semantic_collision"]);
  }
});

test("provider prose and confidence never substitute for evidence", () => {
  const result = evaluateSignalSemanticContextAutomaticPolicyV1(context([ordinary({
    source_refs: [], confidence: 1, provider_explanation: "The provider says this is certain."
  })]));
  assert.equal(result.ready_count, 0);
  assert.deepEqual(result.decisions[0]?.reasons, ["evidence_missing"]);
});

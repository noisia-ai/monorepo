import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveSignalSemanticCandidatesV1,
  SIGNAL_SEMANTIC_CANDIDATE_POLICY_KEY,
  signalSemanticCandidateSetDigestV1,
  type SignalSemanticCandidateInputV1,
  type SignalSemanticGovernedIdentityV1
} from "./signal-semantic-review-v1";

const ids = {
  workspace: "70000000-0000-4000-8000-000000000001",
  brand: "70000000-0000-4000-8000-000000000002",
  competitor: "70000000-0000-4000-8000-000000000003",
  category: "70000000-0000-4000-8000-000000000004",
  mention: "70000000-0000-4000-8000-000000000005"
};

const identities: SignalSemanticGovernedIdentityV1[] = [{
  scope: "primary_brand",
  entity_type: "brand",
  entity_id: ids.brand,
  entity_label: "Laika Mascotas",
  terms: [
    { value: "Laika Mascotas", kind: "canonical_name" },
    { value: "@laikamascotas", kind: "handle" }
  ]
}, {
  scope: "competitor",
  entity_type: "competitor",
  entity_id: ids.competitor,
  entity_label: "Pet House",
  terms: [{ value: "Pet House", kind: "canonical_name" }]
}, {
  scope: "category",
  entity_type: "category",
  entity_id: ids.category,
  entity_label: "Bienestar de mascotas",
  terms: [{ value: "bienestar de mascotas", kind: "canonical_name" }]
}];

function input(text: string, overrides: Partial<SignalSemanticCandidateInputV1> = {}): SignalSemanticCandidateInputV1 {
  return {
    workspace_id: ids.workspace,
    mention_id: ids.mention,
    brand_id: ids.brand,
    identities,
    surfaces: [{ kind: "text", value: text }],
    ...overrides
  };
}

test("candidate policy resolves primary semantics independently of competitor source intent", () => {
  const result = resolveSignalSemanticCandidatesV1(input("Laika Mascotas resolvió el pedido hoy."));
  assert.equal(result.state, "candidate");
  assert.deepEqual(result.candidates.map((candidate) => candidate.scope), ["primary_brand"]);
  assert.equal(result.candidates[0]?.entity_id, ids.brand);
  assert.equal(result.candidates[0]?.policy_key, SIGNAL_SEMANTIC_CANDIDATE_POLICY_KEY);
  assert.equal(result.candidates[0]?.confidence_band, "high");
});

test("competitor candidates require a stable governed competitor id", () => {
  const valid = resolveSignalSemanticCandidatesV1(input("Pet House publicó una nueva promoción."));
  const invalid = resolveSignalSemanticCandidatesV1(input("Pet House publicó una nueva promoción.", {
    identities: [{ ...identities[1]!, entity_id: null }]
  }));
  assert.deepEqual(valid.candidates.map((candidate) => candidate.entity_id), [ids.competitor]);
  assert.equal(invalid.state, "unresolved");
  assert.equal(invalid.candidates.length, 0);
});

test("category candidates require an active governed entity supplied by the server catalog", () => {
  const result = resolveSignalSemanticCandidatesV1(input("Hablemos del bienestar de mascotas."));
  assert.deepEqual(result.candidates.map((candidate) => candidate.scope), ["category"]);
  assert.equal(result.candidates[0]?.entity_id, ids.category);
});

test("multi-entity semantics produce separate stable assertions", () => {
  const result = resolveSignalSemanticCandidatesV1(input("Laika Mascotas y Pet House compararon servicios."));
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates.map((candidate) => candidate.scope), ["competitor", "primary_brand"]);
  assert.ok(result.candidates.every((candidate) => candidate.evidence_kind === "multi_entity"));
  assert.equal(new Set(result.candidates.map((candidate) => candidate.idempotency_key)).size, 2);
});

test("source intent alone and insufficient content remain fail-closed", () => {
  const sourceIntentOnly = resolveSignalSemanticCandidatesV1(input("Una publicación sin identidad gobernada."));
  const noContext = resolveSignalSemanticCandidatesV1(input("", { surfaces: [] }));
  assert.equal(sourceIntentOnly.state, "unresolved");
  assert.equal(sourceIntentOnly.candidates.length, 0);
  assert.equal(noContext.state, "needs_context");
});

test("candidate generation is deterministic and content-addressed", () => {
  const first = resolveSignalSemanticCandidatesV1(input("Laika Mascotas y Pet House compararon servicios."));
  const second = resolveSignalSemanticCandidatesV1(input("Laika Mascotas y Pet House compararon servicios."));
  assert.deepEqual(second, first);
  assert.equal(signalSemanticCandidateSetDigestV1([first]), signalSemanticCandidateSetDigestV1([second]));
});

test("ambiguous aliases shared by governed entities do not become semantic truth", () => {
  const result = resolveSignalSemanticCandidatesV1(input("Mascotas publicó hoy.", {
    identities: [{
      ...identities[0]!,
      terms: [{ value: "Mascotas", kind: "alias" }]
    }, {
      ...identities[1]!,
      terms: [{ value: "Mascotas", kind: "alias" }]
    }]
  }));
  assert.equal(result.state, "unresolved");
  assert.equal(result.candidates.length, 0);
});

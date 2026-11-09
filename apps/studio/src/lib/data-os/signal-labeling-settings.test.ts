import assert from "node:assert/strict";
import test from "node:test";
import { labelingStudySettingsInputSchemaV1, labelingStudySettingsInputV1, type LabelingStudySettingsV1 } from "./signal-labeling-settings";

const state: LabelingStudySettingsV1 = {
  contract_version: "mass-labeling-study-policy-v1", workspace_id: "workspace-a", revision: 4, can_edit: true,
  category: "Coffee", lexicon_terms: ["coffee"], candidate_language: "original", interest_threshold: 0.85,
  lexicon_provenance: "analyst", interests: []
};

test("settings save preserves the measured topic language and deduplicates literal terms", () => {
  const result = labelingStudySettingsInputV1(state, { category: " Coffee ", terms: "coffee\r\nespresso\ncoffee\n", threshold: "0.85", interests: [] });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.data.lexicon_terms, ["coffee", "espresso"]);
  assert.equal(result.data.expected_revision, 4);
  assert.equal(result.data.candidate_language, "original");
});

test("settings reject authority injection and invalid probability thresholds", () => {
  const input = { expected_revision: 4, category: "Coffee", lexicon_terms: ["coffee"], candidate_language: "en", interest_threshold: 0.85, interests: [] };
  for (const key of ["workspace_id", "actor_user_id", "can_edit", "lexicon_provenance", "revision"]) {
    assert.equal(labelingStudySettingsInputSchemaV1.safeParse({ ...input, [key]: "injected" }).success, false);
  }
  for (const interest_threshold of [-1, 1.1, NaN, Infinity]) {
    assert.equal(labelingStudySettingsInputSchemaV1.safeParse({ ...input, interest_threshold }).success, false);
  }
  assert.equal(labelingStudySettingsInputSchemaV1.safeParse({ ...input, lexicon_terms: [] }).success, true);
  assert.equal(labelingStudySettingsInputSchemaV1.safeParse({ ...input, interests: [{ key: "../other", name: "Test", definition: "Test", active: true }] }).success, false);
  assert.equal(labelingStudySettingsInputV1(state, { category: "Coffee", terms: "coffee", threshold: "", interests: [] }).success, false);
});

test("a new brand can save its category before the editorial lexicon is proposed", () => {
  const newStudy = { ...state, revision: 0, category: "", lexicon_terms: [], lexicon_provenance: "brand_os" as const };
  const result = labelingStudySettingsInputV1(newStudy, { category: "Coffee", terms: "", threshold: "0.85", interests: [] });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.category, "Coffee");
  assert.deepEqual(result.data.lexicon_terms, []);
});

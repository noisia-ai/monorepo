import assert from "node:assert/strict";
import test from "node:test";
import { labelingStudySettingsInputSchemaV1, labelingStudySettingsInputV1, setLabelingTopicDisplayNameV1, type LabelingStudySettingsV1 } from "./signal-labeling-settings";

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

const topic = { topic_key: "topic_a", en: "Coffee occasions", es: "Ocasiones de café" };
test("restoring a canonical display-name pair removes its override from the draft and PUT payload", () => {
  const other = { en: "Other edited topic", es: "Otro tópico editado" };
  const original = { topic_a: { en: "Edited coffee occasions", es: topic.es }, topic_b: other };
  const names = setLabelingTopicDisplayNameV1(original, topic, "en", topic.en);
  assert.deepEqual(names, { topic_b: other });
  assert.equal(names.topic_b, other);
  assert.equal(original.topic_a.en, "Edited coffee occasions");
  const result = labelingStudySettingsInputV1({ ...state, display_names: original }, {
    category: state.category, terms: state.lexicon_terms.join("\n"), threshold: "0.85", interests: [], names
  });
  assert.equal(result.success, true);
  if (result.success) assert.deepEqual(result.data.display_names, { topic_b: other });
});

test("single-language edits preserve the other language and restoring only one edited language keeps the pair", () => {
  assert.deepEqual(setLabelingTopicDisplayNameV1({}, topic, "es", "Café de la mañana").topic_a,
    { en: topic.en, es: "Café de la mañana" });
  const english = setLabelingTopicDisplayNameV1({}, topic, "en", "Morning coffee");
  assert.deepEqual(english.topic_a, { en: "Morning coffee", es: topic.es });
  const both = setLabelingTopicDisplayNameV1(english, topic, "es", "Café de la mañana");
  assert.deepEqual(both.topic_a, { en: "Morning coffee", es: "Café de la mañana" });
  const restoredEnglish = setLabelingTopicDisplayNameV1(both, topic, "en", topic.en);
  assert.deepEqual(restoredEnglish.topic_a, { en: topic.en, es: "Café de la mañana" });
  const names = setLabelingTopicDisplayNameV1(restoredEnglish, topic, "es", topic.es);
  assert.deepEqual(names, {});
  const result = labelingStudySettingsInputV1({ ...state, display_names: both }, {
    category: state.category, terms: state.lexicon_terms.join("\n"), threshold: "0.85", interests: [], names
  });
  assert.equal(result.success, true);
  if (result.success) assert.deepEqual(result.data.display_names, {});
});

test("restoring canonical names uses the same trimming as saved display names", () => {
  const names = { topic_a: { en: "Edited topic", es: topic.es } };
  assert.deepEqual(setLabelingTopicDisplayNameV1(names, topic, "en", ` ${topic.en} `), {});
});

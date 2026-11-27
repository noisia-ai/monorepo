import test from "node:test";
import assert from "node:assert/strict";
import { mfpIntent } from "./mfp-ui-state";
import { isSignalListeningEnabled, listeningKeyFromLabelV1, listeningMapEditSchemaV1, listeningRunInputSchemaV1, listeningSaveInputSchemaV1 } from "./signal-listening-api";
import { studyCreateInputSchemaV1, studyNamesFromTextV1, studyPromotionInputSchemaV1 } from "./signal-study-api";

test("keys come from the text, stay ASCII and never collide", () => {
  assert.equal(listeningKeyFromLabelV1("¿Qué tipo de comentario es?", new Set()), "que_tipo_de_comentario_es");
  assert.equal(listeningKeyFromLabelV1("Queja", new Set(["queja"])), "queja_2");
  assert.equal(listeningKeyFromLabelV1("2 por 1", new Set()), "q_2_por_1");
  assert.equal(listeningKeyFromLabelV1("¡¡!!", new Set()), "question");
  assert.match(listeningKeyFromLabelV1("x".repeat(200), new Set()), /^[a-z][a-z0-9_]{0,63}$/u);
});

test("a saved question needs text, a scope and at least two defined options", () => {
  const question = { key: "comment_type", text: "What kind of comment is this?", scope: "consumer_category", active: true,
    options: [{ key: "praise", definition: "Praises." }, { key: "complaint", definition: "Complains." }] };
  assert.equal(listeningSaveInputSchemaV1.safeParse({ expected_revision: 0, questions: [question] }).success, true);
  assert.equal(listeningSaveInputSchemaV1.safeParse({ expected_revision: 0, questions: [{ ...question, options: question.options.slice(0, 1) }] }).success, false);
  assert.equal(listeningSaveInputSchemaV1.safeParse({ expected_revision: 0, questions: [{ ...question, scope: "everyone" }] }).success, false);
  assert.equal(listeningSaveInputSchemaV1.safeParse({ expected_revision: 0, questions: [{ ...question, wire: {} }] }).success, false);
  assert.equal(listeningSaveInputSchemaV1.safeParse({ expected_revision: -1, questions: [] }).success, false);
});

test("a run always carries a bounded spending cap and the feature is off by default", () => {
  const idempotency_key = "00000000-0000-4000-8000-000000000001";
  assert.equal(listeningRunInputSchemaV1.safeParse({ cap_micro_usd: 500_000, idempotency_key }).success, true);
  assert.equal(listeningRunInputSchemaV1.safeParse({ cap_micro_usd: 500_000 }).success, false, "a run without a request key could be queued twice");
  assert.equal(listeningRunInputSchemaV1.safeParse({ idempotency_key }).success, false);
  assert.equal(listeningRunInputSchemaV1.safeParse({ cap_micro_usd: 1, idempotency_key }).success, false);
  assert.equal(listeningRunInputSchemaV1.safeParse({ cap_micro_usd: 900_000_000, idempotency_key }).success, false);
  // The same body the Studio mutation hook sends.
  assert.equal(listeningRunInputSchemaV1.safeParse(mfpIntent({ cap_micro_usd: 500_000 }, "POST", idempotency_key).body).success, true);
  assert.equal(isSignalListeningEnabled({}), false);
  assert.equal(isSignalListeningEnabled({ NOISIA_SIGNAL_LISTENING_ENABLED: "true" }), true);
});

test("a correction of the map is one of three operations, with or without the retry key of the mutation hook", () => {
  const root_id = "00000000-0000-4000-8000-000000000002", key = "00000000-0000-4000-8000-000000000001";
  assert.equal(listeningMapEditSchemaV1.safeParse(mfpIntent({ operation: "remove_label", topic_key: "price", root_id }, "POST", key).body).success, true);
  assert.equal(listeningMapEditSchemaV1.safeParse({ operation: "move_label", root_id, from_topic_key: "price", to_topic_key: "taste" }).success, true);
  assert.equal(listeningMapEditSchemaV1.safeParse({ operation: "merge_topics", source_topic_key: "price", target_topic_key: "taste" }).success, true);
  assert.equal(listeningMapEditSchemaV1.safeParse({ operation: "merge_topics", source_topic_key: "Price", target_topic_key: "taste" }).success, false);
  assert.equal(listeningMapEditSchemaV1.safeParse({ operation: "remove_label", topic_key: "price", root_id: "not-a-uuid" }).success, false);
  assert.equal(listeningMapEditSchemaV1.safeParse({ operation: "rename_topic", topic_key: "price" }).success, false, "renaming keeps its own door");
  assert.equal(listeningMapEditSchemaV1.safeParse({ operation: "remove_label", topic_key: "price", root_id, extra: 1 }).success, false);
});

test("a study is created with its subject and a cap that can pay for all its steps", () => {
  const subject = { kind: "category", name: "sparkling water", category: "sparkling water", own_brand: "Brand One", competitors: ["Brand Two"], alternatives: [] };
  const key = "00000000-0000-4000-8000-000000000001";
  assert.equal(studyCreateInputSchemaV1.safeParse(mfpIntent({ name: "T&B", subject, cap_micro_usd: 6_000_000 }, "POST", key).body).success, true);
  assert.equal(studyCreateInputSchemaV1.safeParse({ name: "T&B", subject, cap_micro_usd: 6_000_000 }).success, false, "a study without a request key could be created twice");
  assert.equal(studyCreateInputSchemaV1.safeParse({ name: "T&B", subject, cap_micro_usd: 5_999_999, idempotency_key: key }).success, false);
  assert.equal(studyCreateInputSchemaV1.safeParse({ name: "T&B", subject: { ...subject, kind: "other" }, cap_micro_usd: 6_000_000, idempotency_key: key }).success, false);
  assert.deepEqual(studyNamesFromTextV1(" Brand Two\nBrand Three, Brand Two;\n\n"), ["Brand Two", "Brand Three"]);
  assert.equal(studyPromotionInputSchemaV1.safeParse(mfpIntent({ motive_keys: ["price"] }, "POST", key).body).success, true);
  assert.equal(studyPromotionInputSchemaV1.safeParse({ motive_keys: [] }).success, false);
});

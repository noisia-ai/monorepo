import test from "node:test";
import assert from "node:assert/strict";
import { describeSignalListeningRequestV1, mapSignalListeningAnswersV1, signalListeningCostMicroUsdV1,
  signalListeningQuestionIdentityV1, type SignalListeningItemV1 } from "./signal-listening-questions-v1";
import type { JevQuestionV1, JevRequestV1 } from "./signal-mention-facets-jev-v1";

const topic = (name: string): JevQuestionV1 => ({ type: "noul", instructions: "Classify.",
  criteria: { true: { question: "Does the text address this topic?", name, definition: `About ${name}.` }, false: "Unrelated." } });
const voice: JevQuestionV1 = { type: "choice", instructions: "Who speaks?", criteria: { individual: "A person", media: "An outlet" } };

test("a question keeps its identity across requests, keys and key order", () => {
  const a = signalListeningQuestionIdentityV1("jev-1.13.0", topic("price"));
  const reordered: JevQuestionV1 = { criteria: { false: "Unrelated.", true: { definition: "About price.", name: "price",
    question: "Does the text address this topic?" } }, instructions: "Classify.", type: "noul" };
  assert.equal(signalListeningQuestionIdentityV1("jev-1.13.0", reordered), a);
  assert.notEqual(signalListeningQuestionIdentityV1("jev-1.13.0", topic("flavor")), a);
  assert.notEqual(signalListeningQuestionIdentityV1("jev-2.0.0", topic("price")), a);
  assert.throws(() => signalListeningQuestionIdentityV1("", topic("price")), /listening_question_invalid/);
});

test("the same topic asked under different request keys is one cached question", () => {
  const first: JevRequestV1 = { model: "jev-1.13.0", state: "a", questions: { topic_0: topic("price"), topic_1: topic("flavor"), voice } };
  const second: JevRequestV1 = { model: "jev-1.13.0", state: "b", questions: { topic_0: topic("flavor"), topic_3: topic("price") } };
  const one = describeSignalListeningRequestV1(first), two = describeSignalListeningRequestV1(second);
  assert.equal(one.find(q => q.request_key === "topic_0")!.question_digest, two.find(q => q.request_key === "topic_3")!.question_digest);
  assert.equal(one.find(q => q.request_key === "topic_1")!.question_digest, two.find(q => q.request_key === "topic_0")!.question_digest);
  assert.deepEqual(one.map(q => q.kind).sort(), ["choice", "noul", "noul"]);
});

test("answers are mapped by question identity and reject a mismatched response", () => {
  const request: JevRequestV1 = { model: "jev-1.13.0", state: "text", questions: { topic_0: topic("price"), voice } };
  const item: SignalListeningItemV1 = { root_id: "00000000-0000-4000-8000-000000000001", input_digest: `sha256:${"a".repeat(64)}`,
    request, questions: describeSignalListeningRequestV1(request, key => key === "topic_0" ? "topic:price" : key) };
  const rows = mapSignalListeningAnswersV1(item, { model: "jev-1.13.0", usage: { input_tokens: 10, output_tokens: 0 },
    answers: { topic_0: { type: "noul", noul: 0.91 }, voice: { type: "choice", choice: "individual", confidence: 0.8,
      probabilities: { individual: 0.8, media: 0.2 } } } });
  assert.deepEqual(rows.map(row => [row.probability, row.choice]), [[0.91, null], [0.8, "individual"]]);
  assert.equal(item.questions[0]!.label, "topic:price");
  assert.throws(() => mapSignalListeningAnswersV1(item, { model: "jev-1.13.0", usage: { input_tokens: 1, output_tokens: 0 },
    answers: { topic_0: { type: "noul", noul: 0.5 } } }), /listening_response_invalid/);
});

test("cost is input tokens times the plan price, in micro USD", () => {
  assert.equal(signalListeningCostMicroUsdV1(1632), 69);
  assert.equal(signalListeningCostMicroUsdV1(137_026_416), 5_755_110);
  assert.throws(() => signalListeningCostMicroUsdV1(-1), /listening_cost_invalid/);
});

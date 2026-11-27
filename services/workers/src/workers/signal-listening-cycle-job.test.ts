import test from "node:test";
import assert from "node:assert/strict";
import { createSonnetListeningReviewerV1 } from "./signal-listening-cycle-job";

type Sent = { model: string; max_tokens: number; system: string; thinking: unknown; output_config: { format: { type: string; schema: unknown } };
  messages: Array<{ role: string; content: string }> };
function fakeClient(message: { stop_reason: string; content: Array<{ type: string; text?: string }>; usage?: unknown; model?: string }) {
  const sent: Sent[] = [];
  const client = { messages: { stream(body: Sent) { sent.push(body); return { finalMessage: async () => ({ usage: { input_tokens: 10, output_tokens: 5 },
    model: "claude-sonnet-4-6", ...message }) }; } } };
  return { sent, reviewer: createSonnetListeningReviewerV1({ apiKey: "synthetic-test-key", client: client as never }) };
}

test("the review is one streamed Sonnet 4.6 request constrained to the review schema", async () => {
  const { sent, reviewer } = fakeClient({ stop_reason: "end_turn", content: [{ type: "thinking" }, { type: "text", text: '{"themes":[],' }, { type: "text", text: '"topics":[]}' }] });
  const answer = await reviewer({ system: "rules", payload: '{"topics":[]}' });
  assert.deepEqual(answer.output, { themes: [], topics: [] });
  assert.deepEqual(answer.usage, { input_tokens: 10, output_tokens: 5 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.model, "claude-sonnet-4-6", "product calls use Sonnet 4.6");
  assert.equal(sent[0]!.system, "rules");
  assert.deepEqual(sent[0]!.messages, [{ role: "user", content: '{"topics":[]}' }]);
  assert.equal(sent[0]!.output_config.format.type, "json_schema");
  assert.deepEqual(sent[0]!.thinking, { type: "adaptive" });
});

test("a refusal, a truncated answer or broken JSON is an error, never a partial map", async () => {
  await assert.rejects(fakeClient({ stop_reason: "refusal", content: [] }).reviewer({ system: "", payload: "{}" }), /listening_review_refused/);
  await assert.rejects(fakeClient({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"themes":[' }] }).reviewer({ system: "", payload: "{}" }), /listening_review_truncated/);
  await assert.rejects(fakeClient({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }).reviewer({ system: "", payload: "{}" }), /listening_review_output_invalid/);
});

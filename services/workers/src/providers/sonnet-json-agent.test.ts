import test from "node:test";
import assert from "node:assert/strict";
import { createSonnetJsonAgentV1, SonnetJsonAgentErrorV1, sonnetJsonCostMicroUsdV1 } from "./sonnet-json-agent";

type Sent = { model: string; max_tokens: number; system: string; thinking: unknown; output_config: { effort?: string; format: { type: string; schema: unknown } };
  messages: Array<{ role: string; content: string }> };
function fake(message: { stop_reason: string; content: Array<{ type: string; text?: string }> }) {
  const sent: Sent[] = [];
  const client = { messages: { stream(body: Sent) { sent.push(body); return { finalMessage: async () => ({ usage: { input_tokens: 1000, output_tokens: 200 },
    model: "claude-sonnet-4-6", ...message }) }; } } };
  return { sent, agent: createSonnetJsonAgentV1({ apiKey: "synthetic-test-key", client: client as never }) };
}

test("a judgment is one streamed Sonnet 4.6 request constrained to its schema, without a scratchpad", async () => {
  const schema = { type: "object", additionalProperties: false, required: ["motives"], properties: { motives: { type: "array", items: { type: "string" } } } };
  const { sent, agent } = fake({ stop_reason: "end_turn", content: [{ type: "text", text: '{"motives":' }, { type: "text", text: '["price"]}' }] });
  const answer = await agent({ system: "rules", payload: '{"groups":[]}', schema });
  assert.deepEqual(answer.output, { motives: ["price"] });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.model, "claude-sonnet-4-6", "product calls use Sonnet 4.6");
  assert.deepEqual(sent[0]!.thinking, { type: "disabled" });
  assert.deepEqual(sent[0]!.output_config, { format: { type: "json_schema", schema } });
  assert.deepEqual(sent[0]!.messages, [{ role: "user", content: '{"groups":[]}' }]);
  assert.equal(sonnetJsonCostMicroUsdV1(answer.usage), 6000, "1,000 tokens in and 200 out at USD 3 and 15 per million");
});

test("a refusal, a truncated answer or broken JSON is an error that keeps its usage, so it can still be charged", async () => {
  const cases: Array<[Parameters<typeof fake>[0], string]> = [[{ stop_reason: "refusal", content: [] }, "agent_refused"],
    [{ stop_reason: "max_tokens", content: [{ type: "text", text: '{"motives":[' }] }, "agent_answer_truncated"],
    [{ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }, "agent_answer_invalid"]];
  for (const [message, code] of cases) {
    await assert.rejects(fake(message).agent({ system: "", payload: "{}", schema: {} }),
      (error: unknown) => error instanceof SonnetJsonAgentErrorV1 && error.code === code && error.usage?.output_tokens === 200, code);
  }
});

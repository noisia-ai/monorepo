import assert from "node:assert/strict";
import test from "node:test";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { generateAnthropicBoundedTextV1 } from "../providers/anthropic-bounded-text";

for (const [stop, failure] of [["max_tokens", "output_limit"], ["refusal", "missing_output"]] as const) {
  test(`metered ${failure} preserves request ID and usage before SDK output getter`, async () => {
    let calls = 0;
    const fixture = createAnthropic({ apiKey: "fixture-not-secret", fetch: async () => {
      calls++;
      return new Response(JSON.stringify({ id: `fixture_${failure}`, type: "message", role: "assistant",
        model: "claude-haiku-4-5-20251001", content: [{ type: "text", text: "" }],
        stop_reason: stop, stop_sequence: null, usage: { input_tokens: 321, output_tokens: 25 } }),
      { status: 200, headers: { "content-type": "application/json" } });
    } });
    const result = await generateAnthropicBoundedTextV1({ model: "claude-haiku-4-5-20251001",
      prompt: "Synthetic local test", max_output_tokens: 1000,
      structured_output: { schema: z.object({ value: z.string() }).strict(), name: "fixture", description: "fixture" } }, fixture);
    assert.equal(calls, 1); assert.equal(result.text, "");
    assert.equal(result.provider_request_id, `fixture_${failure}`);
    assert.deepEqual(result.usage, { input_tokens: 321, output_tokens: 25 });
    assert.equal(result.structured_output_failure, failure);
  });
}

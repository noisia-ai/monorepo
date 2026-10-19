import assert from "node:assert/strict";
import test from "node:test";

import { estimateModelCostUsd } from "./engine-cost";

test("engine cost estimator returns bounded Anthropic USD estimates", () => {
  assert.equal(estimateModelCostUsd({
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    inputTokens: 1000,
    outputTokens: 500
  }), 0.0105);

  assert.equal(estimateModelCostUsd({
    provider: "anthropic",
    model: "claude-opus-4-1",
    inputTokens: 1000,
    outputTokens: 500
  }), 0.0525);
});

test("engine cost estimator stays null for unknown providers or models", () => {
  assert.equal(estimateModelCostUsd({
    provider: "openai",
    model: "gpt-5",
    inputTokens: 1000,
    outputTokens: 500
  }), null);
  assert.equal(estimateModelCostUsd({
    provider: "anthropic",
    model: null,
    inputTokens: 1000,
    outputTokens: 500
  }), null);
});

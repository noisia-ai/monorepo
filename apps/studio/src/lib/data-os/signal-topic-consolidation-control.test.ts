import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkspaceTopicConsolidationCommandV1 } from "./signal-topic-consolidation-control";

const id = "00000000-0000-4000-8000-000000000001";
const quote = `v1.1789236000.${"a".repeat(64)}`;

test("accepts only the two provider-free consolidation commands", () => {
  assert.deepEqual(parseWorkspaceTopicConsolidationCommandV1({ action: "prepare_numeric",
    source_execution_id: id, quote_reference: quote }), { action: "prepare_numeric", source_execution_id: id, quote_reference: quote });
  assert.deepEqual(parseWorkspaceTopicConsolidationCommandV1({ action: "retry_numeric", execution_id: id }),
    { action: "retry_numeric", execution_id: id });
  assert.equal(parseWorkspaceTopicConsolidationCommandV1({ action: "review_with_claude", maximum_micro_usd: "20000000" }), null);
  assert.equal(parseWorkspaceTopicConsolidationCommandV1({ action: "prepare_numeric", source_execution_id: id,
    quote_reference: quote, provider_execution_enabled: true }), null);
});

import assert from "node:assert/strict";
import test from "node:test";

import { parseSignalSemanticContextProposalRetryRequestV1,
  parseSignalSemanticContextProposalStartRequestV1 } from "./signal-semantic-context-proposal-api";

const valid = { generation_key: "semantic-context-v1", preflight_digest: `sha256:${"1".repeat(64)}`,
  confirmation: "GENERATE_PENDING_SEMANTIC_CONTEXT_PROPOSALS", hard_cap_micro_usd: "42000" };

test("proposal start accepts only operator confirmation, generation key, preflight and hard cap", () => {
  assert.equal(parseSignalSemanticContextProposalStartRequestV1(valid).hard_cap_micro_usd, 42_000n);
  for (const hostile of [{ ...valid, workspace_id: crypto.randomUUID() }, { ...valid, model: "other" },
    { ...valid, pricing: 0 }, { ...valid, prompt: "override" }, { ...valid, disposition: "approved" },
    { ...valid, evidence_ids: [crypto.randomUUID()] }, { ...valid, hard_cap_micro_usd: "0" },
    { ...valid, confirmation: "yes" }]) {
    assert.throws(() => parseSignalSemanticContextProposalStartRequestV1(hostile));
  }
});

test("retry accepts no browser authority overrides", () => {
  assert.deepEqual(parseSignalSemanticContextProposalRetryRequestV1({}), {});
  assert.throws(() => parseSignalSemanticContextProposalRetryRequestV1({ model: "override" }));
});

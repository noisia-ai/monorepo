import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapSignalInterestDecisionModelAuthorityV1 } from "./signal-interest-decision-model-authority";
import { bootstrapSignalInterestDecisionModelAuthorityV2 } from "./signal-interest-decision-model-authority-v2";

const workspace = "979b8f96-3366-463d-8ee8-8c0cce460a71";
const actor = "123e4567-e89b-42d3-a456-426614174000";
const sentinel = new Error("connected");

for (const [version, bootstrap] of [["V1", bootstrapSignalInterestDecisionModelAuthorityV1],
  ["V2", bootstrapSignalInterestDecisionModelAuthorityV2]] as const) {
  test(`${version} accepts a normal five-part UUID before opening the database`, async () => {
    let connected = false;
    const database = { connect: async () => { connected = true; throw sentinel; } } as never;
    await assert.rejects(bootstrap({ workspace_id: workspace, actor_user_id: actor,
      interest_term_key: "alexa_consent", idempotency_key: "request-123", database }),
    (error: unknown) => error === sentinel);
    assert.equal(connected, true);
  });
  test(`${version} rejects a malformed workspace before opening the database`, async () => {
    let connected = false;
    const database = { connect: async () => { connected = true; throw sentinel; } } as never;
    await assert.rejects(bootstrap({ workspace_id: "invalid", actor_user_id: actor,
      interest_term_key: "alexa_consent", idempotency_key: "request-123", database }),
    /interest_decision_model_authority_(request|workspace)_invalid/u);
    assert.equal(connected, false);
  });
}

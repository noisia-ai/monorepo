import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  acquireSignalTopicEvaluationSubmissionLockV1,
  buildSignalTopicEvaluationLaunchRequestV1,
  canLaunchSignalTopicEvaluationV1,
  createSignalTopicEvaluationIdempotencyKeyV1,
  projectSignalTopicEvaluationFlightCardV1,
  readSignalTopicEvaluationRunStatusV1
} from "./signal-topic-evaluation-launch";

function preflight() {
  return {
    contract_version: "signal-topic-evaluation-preflight-v1",
    execution_enabled: true,
    execution_configuration_complete: true,
    credential_configured: true,
    product_provider_key_name: "ANTHROPIC_API_KEY",
    provider: "anthropic",
    model: "claude-sonnet-5",
    pricing_version: "anthropic-claude-sonnet-5-2026-08-29",
    envelope_digest: `sha256:${"1".repeat(64)}`,
    proposal_count: 115,
    historical_bertopic_proposals: 115,
    one_call_max: 1,
    retry_allowed: false,
    hard_cap_micro_usd: "380000",
    estimated_max_cost_micro_usd: "330000",
    success_minimum_candidates: 10,
    topic_adoption: false,
    publication: false,
    serving: false,
    input_authority: { corpus: { private: "ignored" } },
    envelope: { private: "never_projected" },
    raw_prompt: "never_projected",
    credential_value: "never_projected"
  };
}

test("Topic Evaluation projects only the sanitized flight card", () => {
  const card = projectSignalTopicEvaluationFlightCardV1(preflight());
  assert.equal(card.proposalCount, 115);
  assert.equal(card.model, "claude-sonnet-5");
  assert.equal(card.estimatedMaxCostMicroUsd, "330000");
  assert.equal(card.hardCapMicroUsd, "380000");
  assert.equal(canLaunchSignalTopicEvaluationV1(card), true);
  assert.doesNotMatch(JSON.stringify(card), /private|raw_prompt|credential_value/u);
});

test("Topic Evaluation requires the explicit acknowledgement before building a command", () => {
  const card = projectSignalTopicEvaluationFlightCardV1(preflight());
  assert.throws(() => buildSignalTopicEvaluationLaunchRequestV1({
    acknowledged: false,
    card,
    idempotencyKey: "topic-evaluation:start:one"
  }), /topic_evaluation_cost_acknowledgement_required/u);
});

test("Topic Evaluation builds the unchanged closed POST contract", () => {
  const card = projectSignalTopicEvaluationFlightCardV1(preflight());
  const command = buildSignalTopicEvaluationLaunchRequestV1({
    acknowledged: true,
    card,
    idempotencyKey: "topic-evaluation:start:one"
  });
  assert.deepEqual(command, {
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "topic-evaluation:start:one"
    },
    body: {
      expected_envelope_digest: `sha256:${"1".repeat(64)}`,
      confirmation: "RUN_ONE_TOPIC_EVALUATION",
      hard_cap_micro_usd: "380000"
    }
  });
  assert.deepEqual(Object.keys(command.body).sort(), [
    "confirmation", "expected_envelope_digest", "hard_cap_micro_usd"
  ]);
});

test("Topic Evaluation creates one fresh idempotency key and rejects a second local submit", () => {
  let sequence = 0;
  const first = createSignalTopicEvaluationIdempotencyKeyV1(() => `uuid-${++sequence}`);
  const second = createSignalTopicEvaluationIdempotencyKeyV1(() => `uuid-${++sequence}`);
  assert.equal(first, "topic-evaluation:start:uuid-1");
  assert.equal(second, "topic-evaluation:start:uuid-2");
  assert.notEqual(first, second);
  const lock = { current: false };
  assert.equal(acquireSignalTopicEvaluationSubmissionLockV1(lock), true);
  assert.equal(acquireSignalTopicEvaluationSubmissionLockV1(lock), false);
});

test("Topic Evaluation displays only the returned run status", () => {
  assert.equal(readSignalTopicEvaluationRunStatusV1({
    run_id: "private",
    run_key: "topic-evaluation-private",
    status: "queued",
    envelope_digest: `sha256:${"2".repeat(64)}`,
    provider_call_count: 0
  }), "queued");
  assert.throws(() => readSignalTopicEvaluationRunStatusV1({ status: "completed" }),
    /topic_evaluation_run_status_invalid/u);
});

test("Brand OS mounts the normal launch surface without touching Discovery Review", async () => {
  const [component, page, es, en, openapi] = await Promise.all([
    readFile(new URL("../../components/brands/TopicEvaluationManager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/studio/brands/[id]/brand-os/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../messages/es-MX.json", import.meta.url), "utf8"),
    readFile(new URL("../../../messages/en-US.json", import.meta.url), "utf8"),
    readFile(new URL("../../../../../docs/api/openapi.yaml", import.meta.url), "utf8")
  ]);
  assert.match(component, /AdminResourceSection/u);
  assert.match(component, /AdminSummaryStrip/u);
  assert.match(component, /WorkspaceDrawer/u);
  assert.match(component, /requestJson\(endpoint\)/u);
  assert.match(component, /method: "POST"/u);
  assert.match(component, /sessionStorage\.setItem/u);
  assert.match(component, /acquireSignalTopicEvaluationSubmissionLockV1/u);
  assert.doesNotMatch(component, /actions\.(retry|fallback)|retryAction|fallbackAction/u);
  assert.ok(page.indexOf("<TopicEvaluationManager") > page.indexOf("<SemanticContextPackManager"));
  assert.doesNotMatch(page, /TopicDiscoveryReviewWorkbench/u);
  assert.ok(JSON.parse(es).AdminWorkspace.brandOs.topicEvaluation);
  assert.ok(JSON.parse(en).AdminWorkspace.brandOs.topicEvaluation);
  assert.match(openapi, /confirmation: \{ const: RUN_ONE_TOPIC_EVALUATION \}/u);
  assert.match(openapi, /IdempotencyKey/u);
});

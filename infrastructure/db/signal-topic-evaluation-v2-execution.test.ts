import assert from "node:assert/strict";
import test from "node:test";

import { buildSignalTopicEvaluationExecutionFlightCardV2,
  SIGNAL_TOPIC_EVALUATION_V2_EXECUTION_CONFIRMATION,
  signalTopicEvaluationDigestV2 } from "@noisia/query-engine";

import { createSignalTopicEvaluationV2ExecutionAuthority,
  SignalTopicEvaluationV2Error } from "./signal-topic-evaluation-v2";

const configuration = () => ({ enabled: true, runtime_profile: "uat" as const,
  credential_configured: true, provider: "anthropic" as const, model: "claude-sonnet-5",
  pricing_version: "anthropic-2026-08-29", input_micro_usd_per_token: 3,
  output_micro_usd_per_token: 15, flight_card: buildSignalTopicEvaluationExecutionFlightCardV2({
    provider_calls_allowed: 12, max_model_turns: 12, max_tool_calls: 24,
    max_tool_result_bytes: 32_768, max_total_tool_result_bytes: 262_144,
    max_total_input_tokens: 450_000, max_total_output_tokens: 50_000,
    hard_cap_micro_usd: 18_147_816 }) });

const mustNotConnect = { connect: async () => { throw new Error("database should not be touched"); } };
const base = { pool: mustNotConnect, workspace_id: "00000000-0000-4000-8000-000000000001",
  actor: { id: "00000000-0000-4000-8000-000000000002", user_type: "noisia_internal" as const },
  idempotency_key: "r29-execution-test", expected_snapshot_digest: signalTopicEvaluationDigestV2("snapshot"),
  confirmation: "RUN_BOUNDED_FULL_EVIDENCE_TOPIC_EVALUATION" };

test("execution authority fails closed before any database edge without exact confirmation", async () => {
  await assert.rejects(createSignalTopicEvaluationV2ExecutionAuthority({ ...base,
    configuration: configuration() }), (error) => error instanceof SignalTopicEvaluationV2Error
      && error.code === "topic_evaluation_v2_confirmation_required");
});

test("execution authority rejects disabled or credential-less configuration before any database edge", async () => {
  const disabled = configuration(); disabled.enabled = false;
  await assert.rejects(createSignalTopicEvaluationV2ExecutionAuthority({ ...base,
    confirmation: SIGNAL_TOPIC_EVALUATION_V2_EXECUTION_CONFIRMATION, configuration: disabled }),
  (error) => error instanceof SignalTopicEvaluationV2Error && error.code === "topic_evaluation_v2_disabled");
  const noCredential = configuration(); noCredential.credential_configured = false;
  await assert.rejects(createSignalTopicEvaluationV2ExecutionAuthority({ ...base,
    confirmation: SIGNAL_TOPIC_EVALUATION_V2_EXECUTION_CONFIRMATION, configuration: noCredential }),
  (error) => error instanceof SignalTopicEvaluationV2Error
    && error.code === "topic_evaluation_v2_product_provider_unavailable");
});

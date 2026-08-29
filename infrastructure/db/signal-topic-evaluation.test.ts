import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createSignalTopicEvaluationRunV1,
  signalTopicEvaluationConfigurationFromEnvV1 } from "./signal-topic-evaluation";

const actor={id:"00000000-0000-4000-8000-000000000001",user_type:"noisia_internal" as const};
const pool={connect:async()=>{throw new Error("database_must_not_be_touched");}};
const explicitEnv={NOISIA_TOPIC_EVALUATION_ENABLED:"true",ANTHROPIC_API_KEY:"synthetic-not-forwarded",
  NOISIA_TOPIC_EVALUATION_MODEL:"fixture-model",NOISIA_TOPIC_EVALUATION_PRICING_VERSION:"fixture-pricing-v1",
  NOISIA_TOPIC_EVALUATION_MAX_INPUT_TOKENS:"1000",NOISIA_TOPIC_EVALUATION_MAX_OUTPUT_TOKENS:"100",
  NOISIA_TOPIC_EVALUATION_INPUT_USD_PER_MILLION:"3.000000",
  NOISIA_TOPIC_EVALUATION_OUTPUT_USD_PER_MILLION:"15.000000",
  NOISIA_TOPIC_EVALUATION_HARD_CAP_MICRO_USD:"1000000",
  NOISIA_TOPIC_EVALUATION_ESTIMATED_INPUT_TOKENS:"100"};

test("execution is disabled by default before DB or provider work",async()=>{
  const config=signalTopicEvaluationConfigurationFromEnvV1({});
  assert.equal(config.enabled,false);assert.equal(config.credential_configured,false);
  assert.equal(config.execution_configuration_complete,false);
  await assert.rejects(createSignalTopicEvaluationRunV1({pool:pool as never,
    workspace_id:"00000000-0000-4000-8000-000000000002",actor,idempotency_key:"fixture",
    expected_envelope_digest:`sha256:${"1".repeat(64)}`,confirmation:"RUN_ONE_TOPIC_EVALUATION",
    hard_cap_micro_usd:1_000_000n,configuration:config}),/topic_evaluation_disabled/u);
});

test("enabled execution fails closed without the product credential lane",async()=>{
  const{ANTHROPIC_API_KEY:_omitted,...withoutCredential}=explicitEnv;
  const config=signalTopicEvaluationConfigurationFromEnvV1(withoutCredential);
  await assert.rejects(createSignalTopicEvaluationRunV1({pool:pool as never,
    workspace_id:"00000000-0000-4000-8000-000000000002",actor,idempotency_key:"fixture",
    expected_envelope_digest:`sha256:${"1".repeat(64)}`,confirmation:"RUN_ONE_TOPIC_EVALUATION",
    hard_cap_micro_usd:1_000_000n,configuration:config}),/topic_evaluation_product_provider_unavailable/u);
});

test("enabled execution rejects omitted or invalid sealed pricing before DB",async()=>{
  const command=(configuration:ReturnType<typeof signalTopicEvaluationConfigurationFromEnvV1>)=>({
    pool:pool as never,workspace_id:"00000000-0000-4000-8000-000000000002",actor,
    idempotency_key:"fixture",expected_envelope_digest:`sha256:${"1".repeat(64)}`,
    confirmation:"RUN_ONE_TOPIC_EVALUATION",hard_cap_micro_usd:1_000_000n,configuration});
  const omitted=signalTopicEvaluationConfigurationFromEnvV1({
    NOISIA_TOPIC_EVALUATION_ENABLED:"true",ANTHROPIC_API_KEY:"synthetic-not-forwarded"});
  assert.equal(omitted.pricing_configured,false);assert.equal(omitted.execution_configuration_complete,false);
  await assert.rejects(createSignalTopicEvaluationRunV1(command(omitted)),
    /topic_evaluation_pricing_unconfigured/u);
  const invalid=signalTopicEvaluationConfigurationFromEnvV1({...explicitEnv,
    NOISIA_TOPIC_EVALUATION_INPUT_USD_PER_MILLION:"3 dollars"});
  await assert.rejects(createSignalTopicEvaluationRunV1(command(invalid)),
    /topic_evaluation_pricing_unconfigured/u);
  const incomplete=signalTopicEvaluationConfigurationFromEnvV1({...explicitEnv,
    NOISIA_TOPIC_EVALUATION_MODEL:""});
  assert.equal(incomplete.pricing_configured,true);
  await assert.rejects(createSignalTopicEvaluationRunV1(command(incomplete)),
    /topic_evaluation_execution_configuration_incomplete/u);
});

test("valid explicit flight card reaches DB only after all local guards",async()=>{
  const config=signalTopicEvaluationConfigurationFromEnvV1(explicitEnv);
  assert.equal(config.pricing_configured,true);assert.equal(config.execution_configuration_complete,true);
  assert.equal(config.model,"fixture-model");assert.equal(config.hard_cap_micro_usd,1_000_000n);
  await assert.rejects(createSignalTopicEvaluationRunV1({pool:pool as never,
    workspace_id:"00000000-0000-4000-8000-000000000002",actor,idempotency_key:"fixture",
    expected_envelope_digest:`sha256:${"1".repeat(64)}`,confirmation:"RUN_ONE_TOPIC_EVALUATION",
    hard_cap_micro_usd:1_000_000n,configuration:config}),/database_must_not_be_touched/u);
});

test("authZ, token ceilings and hard caps fail before any write",async()=>{
  const configured=signalTopicEvaluationConfigurationFromEnvV1({
    ...explicitEnv,
    NOISIA_TOPIC_EVALUATION_MAX_INPUT_TOKENS:"100",
    NOISIA_TOPIC_EVALUATION_ESTIMATED_INPUT_TOKENS:"101"
  });
  const command={pool:pool as never,workspace_id:"00000000-0000-4000-8000-000000000002",
    actor,idempotency_key:"fixture",expected_envelope_digest:`sha256:${"1".repeat(64)}`,
    confirmation:"RUN_ONE_TOPIC_EVALUATION",hard_cap_micro_usd:1_000_000n,configuration:configured};
  await assert.rejects(createSignalTopicEvaluationRunV1(command),/topic_evaluation_input_token_ceiling_exceeded/u);
  await assert.rejects(createSignalTopicEvaluationRunV1({...command,
    actor:{...actor,user_type:"external" as never}}),/topic_evaluation_forbidden/u);
  const bounded={...configured,max_input_tokens:10_000,estimated_input_tokens:1_000};
  await assert.rejects(createSignalTopicEvaluationRunV1({...command,configuration:bounded,
    hard_cap_micro_usd:1n}),/topic_evaluation_hard_cap_insufficient/u);
});

test("0107 seals a one-call non-serving relational control plane",async()=>{
  const sql=await readFile(new URL("./migrations/0107_signal_topic_evaluation_control_plane.sql",import.meta.url),"utf8");
  assert.match(sql,/provider_call_count BETWEEN 0 AND 1/u);
  assert.match(sql,/dispatch_count BETWEEN 0 AND 1/u);
  assert.match(sql,/FOREIGN KEY\(\s*candidate_id,run_id,workspace_id/u);
  assert.match(sql,/REFERENCES signal_topic_evaluation_input_evidence/u);
  assert.match(sql,/review_state='pending'/u);
  assert.match(sql,/outcome_unknown/u);
  assert.doesNotMatch(sql,/retry_signal_topic|recovery_queued/u);
  assert.doesNotMatch(sql,/topic_contracts|signal_serving|pointer|binding/u);
});

test("0109 admits only the proven definitely-not-sent zero-cost terminal transition",async()=>{
  const sql=await readFile(new URL("./migrations/0109_signal_topic_evaluation_provider_boundary_outcomes.sql",
    import.meta.url),"utf8");
  assert.match(sql,/WHEN 'in_flight' THEN NEW\.status IN\('in_flight','response_persisted','outcome_unknown'\) OR/u);
  assert.match(sql,/NEW\.error_code='topic_evaluation_provider_definitely_not_sent'/u);
  assert.match(sql,/NEW\.provider_call_state='settled'/u);
  assert.match(sql,/NEW\.input_tokens=0 AND NEW\.output_tokens=0 AND NEW\.settled_micro_usd=0/u);
  assert.match(sql,/NEW\.provider_response_private IS NULL/u);
  assert.doesNotMatch(sql,/WHEN 'in_flight' THEN NEW\.status IN\([^)]*'failed'/u);
});

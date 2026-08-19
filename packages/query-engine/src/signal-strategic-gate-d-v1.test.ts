import assert from "node:assert/strict";
import test from "node:test";

import {
  signalStrategicCostUpperBoundMicroUsdV1,
  signalStrategicDeterministicSampleV1,
  signalStrategicPreflightDigestV1,
  signalStrategicProviderBudgetPlanV1
} from "./signal-strategic-gate-d-v1";

const hash = `sha256:${"a".repeat(64)}`;

test("strategic sample is canonical-root deduped, deterministic and order-independent", () => {
  const first = signalStrategicDeterministicSampleV1(["B", "a", "A", "c"], "seed", 2);
  const second = signalStrategicDeterministicSampleV1(["c", "A", "b"], "seed", 2);
  assert.deepEqual(first, second);
  assert.equal(new Set(first.mention_ids).size, 2);
});

test("strategic preflight digest seals authority, provider and hard cap", () => {
  const base = {
    workspace_id: "workspace",
    period_start: "2026-01-01",
    period_end: "2026-01-31",
    timezone: "America/Mexico_City",
    study_size: "medium" as const,
    execution: {
      study_corpus_id: "execution-corpus",
      corpus_revision: 3,
      pipeline_version: "pipeline-v1",
      methodology_version: "method-v1"
    },
    denominator: {
      key: "snapshot-canonical-roots" as const,
      count: 2,
      canonical_ids_digest: hash,
      alias_membership_count: 0 as const
    },
    coverage: {
      state: "partial" as const,
      captured: { availability: "available" as const, count: 2 },
      quality_eligible: { availability: "available" as const, count: 2 },
      reviewed: { availability: "available" as const, count: 2 },
      resolved_attributed: { availability: "available" as const, count: 2 },
      used_by_view: { availability: "available" as const, count: 2 },
      unreviewed: { availability: "available" as const, count: 0 },
      unattributed: { availability: "available" as const, count: 0 },
      abstained: { availability: "not_available" as const, count: null }
    },
    sample_count: 2,
    sample_digest: hash,
    sample_seed: hash,
    authority: {
      binding_id: "binding",
      policy_bundle_id: "bundle",
      policy_compilation_id: "compilation",
      governance_evaluation_id: "evaluation",
      population_id: "population",
      population_version: 1,
      population_definition_hash: hash,
      policy_definition_hash: hash,
      compiled_plan_hash: hash,
      membership_digest: hash,
      governance_digest: hash,
      provenance_digest: hash,
      watermark_hash: hash,
      governance_unknown_count: 0 as const,
      next_policy_transition_at: null
    },
    provider: {
      provider: "anthropic" as const,
      model: "pinned-model",
      prompt_version: "prompt-v1",
      pricing_version: "pricing-v1",
      input_usd_per_million_tokens: 10,
      output_usd_per_million_tokens: 50,
      config_digest: hash
    },
    budget: {
      currency: "USD" as const,
      estimated_cost_usd: 1,
      hard_cap_usd: 2,
      planned_provider_calls: 8,
      reserved_input_tokens: 800_000,
      reserved_output_tokens: 102_000
    },
    readiness: {
      queue_configured: true as const,
      worker_alive: true as const,
      provider_key_configured: true as const,
      recovery_ready: true as const
    },
    destinations: {
      status: "/runs/:analysisId",
      cancel: "/runs/:analysisId",
      review: "/runs/:analysisId/review",
      release: "/releases",
      report: "/reports/triggers-barriers",
      retry_policy: "durable-step-outbox-bounded-v1" as const
    }
  };
  const digest = signalStrategicPreflightDigestV1(base);
  assert.match(digest, /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(digest, signalStrategicPreflightDigestV1({
    ...base,
    budget: { ...base.budget, hard_cap_usd: 3 }
  }));
  assert.throws(() => signalStrategicPreflightDigestV1({
    ...base,
    authority: { ...base.authority, governance_unknown_count: 1 as 0 }
  }));
  assert.throws(() => signalStrategicPreflightDigestV1({
    ...base,
    budget: { ...base.budget, hard_cap_usd: 0.5 }
  }));
  assert.throws(() => signalStrategicPreflightDigestV1({
    ...base,
    readiness: { ...base.readiness, recovery_ready: false as true }
  }));
  assert.throws(() => signalStrategicPreflightDigestV1({
    ...base,
    coverage: {
      ...base.coverage,
      abstained: { availability: "available", count: 0 }
    }
  }));
});

test("strategic provider plan is a deterministic worst-case aggregate reservation", () => {
  const plan = signalStrategicProviderBudgetPlanV1({
    sample_count: 31,
    max_input_tokens_per_call: 100_000,
    input_usd_per_million_tokens: 10,
    output_usd_per_million_tokens: 50
  });
  assert.equal(plan.planned_provider_calls, 9);
  assert.equal(plan.reserved_input_tokens, 900_000);
  assert.equal(plan.reserved_output_tokens, 106_000);
  assert.equal(plan.reservation_upper_bound_micro_usd, "14300000");
  assert.equal(plan.reservation_upper_bound_usd, 14.3);
  assert.deepEqual(plan.calls.find((call) => call.operation === "step1-open-pass"), {
    operation: "step1-open-pass",
    count: 2,
    max_output_tokens: 4_000
  });
});

test("strategic provider cost uses exact integer micro-USD at decimal boundaries", () => {
  assert.equal(signalStrategicCostUpperBoundMicroUsdV1({
    input_tokens: 301,
    output_tokens: 301,
    input_usd_per_million_tokens: "0.001",
    output_usd_per_million_tokens: "0.999"
  }), 301n);
  assert.equal(signalStrategicCostUpperBoundMicroUsdV1({
    input_tokens: 1,
    output_tokens: 0,
    input_usd_per_million_tokens: "0.000001",
    output_usd_per_million_tokens: "15"
  }), 1n);
  assert.equal(signalStrategicCostUpperBoundMicroUsdV1({
    input_tokens: 200_000,
    output_tokens: 120,
    input_usd_per_million_tokens: "3",
    output_usd_per_million_tokens: "15"
  }), 601_800n);
  assert.throws(() => signalStrategicCostUpperBoundMicroUsdV1({
    input_tokens: 1,
    output_tokens: 1,
    input_usd_per_million_tokens: "0.0000001",
    output_usd_per_million_tokens: "1"
  }), /at most 6 decimals/u);
});

test("strategic exact cost is deterministic across a fuzz matrix", () => {
  let state = 0x5eed1234;
  const next = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
  for (let index = 0; index < 2_000; index += 1) {
    const inputTokens = next() % 2_000_000;
    const outputTokens = next() % 200_000;
    const inputMillionths = 1 + next() % 25_000_000;
    const outputMillionths = 1 + next() % 75_000_000;
    const inputRate = decimalFromMillionths(inputMillionths);
    const outputRate = decimalFromMillionths(outputMillionths);
    const expected = ceilDivideOracle(
      BigInt(inputTokens) * BigInt(inputMillionths)
        + BigInt(outputTokens) * BigInt(outputMillionths),
      1_000_000n
    );
    assert.equal(signalStrategicCostUpperBoundMicroUsdV1({
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      input_usd_per_million_tokens: inputRate,
      output_usd_per_million_tokens: outputRate
    }), expected);
  }
});

function decimalFromMillionths(value: number) {
  const whole = Math.floor(value / 1_000_000);
  const fraction = String(value % 1_000_000).padStart(6, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function ceilDivideOracle(numerator: bigint, denominator: bigint) {
  return (numerator + denominator - 1n) / denominator;
}

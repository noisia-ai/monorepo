import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  assertSignalTbStrategicLaunchRequest,
  launchSignalTbStrategicRunV2,
  prepareSignalTbStrategicRun,
  type SignalTbStrategicPreparedLaunch,
  type SignalTbStrategicPreflight
} from "./signal-strategic-consumption";

const digest = `sha256:${"a".repeat(64)}`;

function readyPreflight(): SignalTbStrategicPreflight {
  return {
    contract_version: "signal-tb-strategic-preflight-v1",
    read_only: true,
    writes_performed: false,
    jobs_enqueued: 0,
    provider_calls: 0,
    ready: true,
    launch_authorized: true,
    blocking_reasons: [],
    module_key: "triggers-barriers",
    view_key: "strategic",
    population: {
      version: 1,
      total_root_count: 10,
      membership_digest: digest,
      definition_hash: digest
    },
    authority: {
      policy_definition_hash: digest,
      compiled_plan_hash: digest,
      governance_digest: digest,
      provenance_digest: digest,
      watermark_hash: digest,
      governance_unknown_count: 0,
      next_policy_transition_at: null,
      usage_purposes: ["llm-processing", "strategic-analysis"]
    },
    sample: { algorithm: "canonical-root-sha256-rank-v1", count: 10, digest, seed: digest },
    denominator: {
      key: "snapshot-canonical-roots",
      count: 10,
      canonical_ids_digest: digest,
      alias_membership_count: 0
    },
    coverage: {
      state: "partial",
      captured: { availability: "available", count: 10 },
      quality_eligible: { availability: "available", count: 10 },
      reviewed: { availability: "available", count: 10 },
      resolved_attributed: { availability: "available", count: 10 },
      used_by_view: { availability: "available", count: 10 },
      unreviewed: { availability: "available", count: 0 },
      unattributed: { availability: "available", count: 0 },
      abstained: { availability: "not_available", count: null }
    },
    provider: {
      provider: "anthropic",
      model: "pinned-model",
      prompt_version: "prompt-v1",
      pricing_version: "pricing-v1",
      input_usd_per_million_tokens: 10,
      output_usd_per_million_tokens: 50,
      max_input_tokens_per_call: 100_000,
      config_digest: digest
    },
    budget: {
      currency: "USD",
      estimated_cost_usd: 1,
      hard_cap_usd: 2,
      server_max_cap_usd: 5,
      planned_provider_calls: 8,
      reserved_input_tokens: 800_000,
      reserved_output_tokens: 102_000
    },
    execution_plan: {
      contract_version: "signal-strategic-provider-budget-plan-v1",
      calls: [
        { operation: "preflight", count: 1, max_output_tokens: 8_000 },
        { operation: "step1-open-pass", count: 1, max_output_tokens: 4_000 },
        { operation: "step2-coding", count: 1, max_output_tokens: 8_000 },
        { operation: "step3-hierarchy", count: 1, max_output_tokens: 8_000 },
        { operation: "step4-mobility", count: 1, max_output_tokens: 8_000 },
        { operation: "step6-synthesis", count: 2, max_output_tokens: 20_000 },
        { operation: "step6-humanizer", count: 1, max_output_tokens: 26_000 }
      ],
      planned_provider_calls: 8,
      max_input_tokens_per_call: 100_000,
      reserved_input_tokens: 800_000,
      reserved_output_tokens: 102_000,
      reservation_upper_bound_micro_usd: "1000000",
      reservation_upper_bound_usd: 1
    },
    readiness: {
      queue_configured: true,
      worker_alive: true,
      provider_key_configured: true,
      recovery_ready: true
    },
    destinations: {
      status: "/runs/:analysisId",
      cancel: "/runs/:analysisId",
      review: "/runs/:analysisId/review",
      release: "/releases",
      report: "/reports/triggers-barriers",
      retry_policy: "durable-step-outbox-bounded-v1"
    },
    preflight_digest: digest
  };
}

test("strategic launch requires the exact sealed preflight and hard cap", () => {
  const preflight = readyPreflight();
  assert.doesNotThrow(() => assertSignalTbStrategicLaunchRequest({
    preflight,
    submittedPreflightDigest: digest,
    submittedHardCapUsd: 2
  }));
  assert.throws(() => assertSignalTbStrategicLaunchRequest({
    preflight,
    submittedPreflightDigest: `sha256:${"b".repeat(64)}`,
    submittedHardCapUsd: 2
  }), /preflight/iu);
  assert.throws(() => assertSignalTbStrategicLaunchRequest({
    preflight,
    submittedPreflightDigest: digest,
    submittedHardCapUsd: 3
  }), /hard cap/iu);
});

test("blocked free preflight can never launch", () => {
  const preflight = { ...readyPreflight(), ready: false, blocking_reasons: ["unknown"] };
  assert.throws(() => assertSignalTbStrategicLaunchRequest({
    preflight,
    submittedPreflightDigest: digest,
    submittedHardCapUsd: 2
  }));
});

const providerEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  NOISIA_SIGNAL_TB_MODEL: "pinned-model",
  NOISIA_SIGNAL_TB_PRICING_VERSION: "pricing-v1",
  NOISIA_SIGNAL_TB_INPUT_USD_PER_MTOK: "1",
  NOISIA_SIGNAL_TB_OUTPUT_USD_PER_MTOK: "1",
  NOISIA_SIGNAL_TB_MAX_INPUT_TOKENS_PER_CALL: "1000",
  NOISIA_SIGNAL_TB_MAX_BUDGET_USD: "10",
  ANTHROPIC_API_KEY: "configured-for-test"
};

const authorityRow = {
  workspace_slug: "workspace-safe",
  workspace_timezone: "America/Mexico_City",
  binding_id: "10000000-0000-4000-8000-000000000001",
  policy_bundle_id: "10000000-0000-4000-8000-000000000002",
  policy_compilation_id: "10000000-0000-4000-8000-000000000003",
  governance_evaluation_id: "10000000-0000-4000-8000-000000000004",
  population_id: "10000000-0000-4000-8000-000000000005",
  population_version: 3,
  population_definition_hash: digest,
  membership_digest: digest,
  computed_membership_digest: digest,
  population_root_count: 2,
  alias_membership_count: 0,
  policy_definition_hash: digest,
  compiled_plan_hash: digest,
  governance_digest: digest,
  source_watermark_hash: digest,
  governance_unknown_count: 0,
  next_policy_transition_at: null,
  usage_purposes: ["llm-processing", "strategic-analysis"],
  invalidation_count: 0,
  study_corpus_id: "10000000-0000-4000-8000-000000000006",
  corpus_revision: 7,
  execution_corpus_count: 1,
  min_quality_score: null,
  required_quality_flags: [],
  forbidden_quality_flags: []
};

const rootRows = [
  {
    mention_id: "20000000-0000-4000-8000-000000000001",
    governance_path_hash: digest
  },
  {
    mention_id: "20000000-0000-4000-8000-000000000002",
    governance_path_hash: `sha256:${"b".repeat(64)}`
  }
];

const coverageRow = {
  captured: 2,
  quality_eligible: 2,
  reviewed: 2,
  resolved_attributed: 2,
  unattributed: 0,
  used_by_view: 2
};

function exactPreflightClient(options: {
  authorityRows?: unknown[];
  roots?: unknown[];
  coverageRows?: unknown[];
  throwOnRoots?: boolean;
} = {}) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  let select = 0;
  const client = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql.startsWith("BEGIN") || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [] };
      }
      select += 1;
      if (select === 1) return { rows: options.authorityRows ?? [authorityRow] };
      if (options.throwOnRoots) throw new Error("roots_failed");
      if (select === 2) return { rows: options.roots ?? rootRows };
      return { rows: options.coverageRows ?? [coverageRow] };
    },
    release() {}
  };
  return { client, calls };
}

const readyRuntime = async () => ({
  queue_configured: true,
  worker_alive: true,
  provider_key_configured: true,
  recovery_ready: true
});

test("free preflight pins authority and roots in one repeatable-read read-only transaction", async () => {
  const fake = exactPreflightClient();
  const prepared = await prepareSignalTbStrategicRun({
    workspaceId: "30000000-0000-4000-8000-000000000001",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    timezone: "America/Mexico_City",
    studySize: "small",
    hardCapUsd: 5
  }, {
    connect: async () => fake.client as never,
    loadRuntimeReadiness: readyRuntime,
    env: providerEnv
  });

  assert.equal(fake.calls[0]?.sql, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(fake.calls.at(-1)?.sql, "COMMIT");
  assert.equal(fake.calls.filter((call) => call.sql.startsWith("BEGIN")).length, 1);
  assert.match(fake.calls[1]!.sql, /signal_workspace_reports report/u);
  assert.match(fake.calls[1]!.sql, /population\.purpose='analysis' AND population\.status='draft'/u);
  assert.match(fake.calls[1]!.sql, /signal_quality_policies quality/u);
  assert.match(fake.calls[2]!.sql, /AT TIME ZONE \$6::text/u);
  assert.deepEqual(fake.calls[2]!.values, [
    "30000000-0000-4000-8000-000000000001",
    authorityRow.population_id,
    authorityRow.governance_evaluation_id,
    "2026-07-01",
    "2026-07-31",
    "America/Mexico_City"
  ]);
  assert.equal(prepared.public.ready, true);
  assert.equal(prepared.public.launch_authorized, false);
  assert.equal(prepared.public.denominator?.count, 2);
  assert.equal(prepared.public.denominator?.alias_membership_count, 0);
  assert.deepEqual(prepared.public.coverage?.abstained, {
    availability: "not_available",
    count: null
  });
  assert.deepEqual(prepared.public.coverage?.used_by_view, {
    availability: "available",
    count: 2
  });
  assert.ok(prepared.launch);
  assert.equal(prepared.launch?.authority.binding_id, authorityRow.binding_id);
  assert.equal("binding_id" in (prepared.public.authority ?? {}), false);
  assert.match(prepared.public.destinations!.status,
    /\/api\/data-os\/signal\/30000000-0000-4000-8000-000000000001\/reports/u);
  assert.doesNotMatch(prepared.public.destinations!.status, /workspace-safe/u);
  assert.equal(prepared.public.budget?.estimated_cost_usd,
    prepared.public.execution_plan?.reservation_upper_bound_usd);
  assert.ok((prepared.public.budget?.estimated_cost_usd ?? Infinity) <= 5);
});

test("preflight blocks incomplete provenance and denominator drift", async () => {
  const incomplete = exactPreflightClient({
    roots: [{ ...rootRows[0], governance_path_hash: null }, rootRows[1]],
    coverageRows: [{ ...coverageRow, used_by_view: 1 }]
  });
  const prepared = await prepareSignalTbStrategicRun({
    workspaceId: "30000000-0000-4000-8000-000000000001",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    timezone: "America/Mexico_City",
    hardCapUsd: 5
  }, {
    connect: async () => incomplete.client as never,
    loadRuntimeReadiness: readyRuntime,
    env: providerEnv
  });
  assert.equal(prepared.public.ready, false);
  assert.equal(prepared.launch, null);
  assert.ok(prepared.public.blocking_reasons.includes(
    "strategic_governance_provenance_incomplete"
  ));
  assert.ok(prepared.public.blocking_reasons.includes(
    "strategic_coverage_denominator_mismatch"
  ));
});

test("preflight hard cap covers the deterministic aggregate provider plan", async () => {
  const fake = exactPreflightClient();
  const prepared = await prepareSignalTbStrategicRun({
    workspaceId: "30000000-0000-4000-8000-000000000001",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    timezone: "America/Mexico_City",
    hardCapUsd: 0.001
  }, {
    connect: async () => fake.client as never,
    loadRuntimeReadiness: readyRuntime,
    env: providerEnv
  });
  assert.equal(prepared.public.ready, false);
  assert.ok(prepared.public.blocking_reasons.includes("strategic_hard_cap_below_estimate"));
  assert.equal(prepared.public.budget?.estimated_cost_usd,
    prepared.public.execution_plan?.reservation_upper_bound_usd);
  assert.ok((prepared.public.budget?.estimated_cost_usd ?? 0) > 0.001);
});

test("preflight rolls back if exact-root loading fails", async () => {
  const fake = exactPreflightClient({ throwOnRoots: true });
  await assert.rejects(() => prepareSignalTbStrategicRun({
    workspaceId: "30000000-0000-4000-8000-000000000001",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    timezone: "America/Mexico_City",
    hardCapUsd: 5
  }, {
    connect: async () => fake.client as never,
    loadRuntimeReadiness: readyRuntime,
    env: providerEnv
  }), /roots_failed/u);
  assert.equal(fake.calls.at(-1)?.sql, "ROLLBACK");
});

test("missing or cross-workspace authority fails closed without a roots query", async () => {
  const fake = exactPreflightClient({ authorityRows: [] });
  const prepared = await prepareSignalTbStrategicRun({
    workspaceId: "30000000-0000-4000-8000-000000000099",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    timezone: "America/Mexico_City",
    hardCapUsd: 5
  }, {
    connect: async () => fake.client as never,
    loadRuntimeReadiness: readyRuntime,
    env: providerEnv
  });
  assert.equal(prepared.public.ready, false);
  assert.ok(prepared.public.blocking_reasons.includes("strategic_governed_binding_unavailable"));
  assert.equal(prepared.public.blocking_reasons.includes(
    "strategic_execution_corpus_ambiguous"
  ), false);
  assert.equal(prepared.public.blocking_reasons.includes(
    "strategic_alias_membership_detected"
  ), false);
  assert.equal(prepared.launch, null);
  assert.equal(fake.calls.length, 3);
});

test("runtime readiness is independent from launch approval and fails closed", async () => {
  const fake = exactPreflightClient();
  const prepared = await prepareSignalTbStrategicRun({
    workspaceId: "30000000-0000-4000-8000-000000000001",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    timezone: "America/Mexico_City",
    hardCapUsd: 5
  }, {
    connect: async () => fake.client as never,
    loadRuntimeReadiness: async () => ({
      queue_configured: true,
      worker_alive: false,
      provider_key_configured: true,
      recovery_ready: false
    }),
    env: { ...providerEnv, NOISIA_SIGNAL_TB_PAID_RUN_APPROVED: "true" }
  });
  assert.equal(prepared.public.launch_authorized, true);
  assert.equal(prepared.public.ready, false);
  assert.ok(prepared.public.blocking_reasons.includes("strategic_worker_not_alive"));
  assert.ok(prepared.public.blocking_reasons.includes("strategic_recovery_not_ready"));
  assert.equal(prepared.launch, null);
});

test("v2 launch calls one atomic function with server-owned authority", async () => {
  const priorApproval = process.env.NOISIA_SIGNAL_TB_PAID_RUN_APPROVED;
  process.env.NOISIA_SIGNAL_TB_PAID_RUN_APPROVED = "true";
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  try {
    const prepared = {
      authority: {
        binding_id: authorityRow.binding_id,
        policy_bundle_id: authorityRow.policy_bundle_id,
        policy_compilation_id: authorityRow.policy_compilation_id,
        governance_evaluation_id: authorityRow.governance_evaluation_id,
        population_id: authorityRow.population_id,
        population_version: 3,
        population_definition_hash: digest,
        membership_digest: digest,
        policy_definition_hash: digest,
        compiled_plan_hash: digest,
        governance_digest: digest,
        provenance_digest: digest,
        watermark_hash: digest,
        next_policy_transition_at: null,
        usage_purposes: ["llm-processing", "strategic-analysis"]
      },
      execution: {
        study_corpus_id: authorityRow.study_corpus_id,
        corpus_revision: 7,
        pipeline_version: "pipeline-v1",
        methodology_version: "method-v1",
        prompt_version: "prompt-v1"
      },
      sample: {
        algorithm: "canonical-root-sha256-rank-v1",
        seed: digest,
        count: 2,
        digest
      },
      provider: readyPreflight().provider!,
      budget: readyPreflight().budget!,
      execution_plan: readyPreflight().execution_plan!,
      destinations: readyPreflight().destinations!,
      preflight_digest: digest
    } satisfies SignalTbStrategicPreparedLaunch;
    const result = await launchSignalTbStrategicRunV2({
      workspaceId: "30000000-0000-4000-8000-000000000001",
      actorUserId: "30000000-0000-4000-8000-000000000002",
      idempotencyKey: "browser-key",
      prepared,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      timezone: "America/Mexico_City",
      businessQuestion: "private question",
      queryable: {
        async query(sql: string, values?: unknown[]) {
          calls.push({ sql, values: values ?? [] });
          return { rows: [{
            run_control_id: "control",
            tb_analysis_id: "analysis",
            snapshot_id: "snapshot",
            run_outbox_id: "run-outbox",
            step_outbox_id: "step-outbox",
            created: true
          }] } as never;
        }
      } as never
    });
    assert.match(calls[0]!.sql, /launch_signal_tb_strategic_run_v2/u);
    assert.match(calls[0]!.sql, /signal_strategic_launch_request_digest_v1/u);
    assert.match(calls[0]!.sql, /signal_strategic_execution_plan_digest_v1/u);
    const targetRequest = JSON.parse(String(calls[0]!.values[4])) as Record<string, unknown>;
    assert.deepEqual((targetRequest.authority as { usage_purposes: string[] }).usage_purposes,
      ["llm-processing", "strategic-analysis"]);
    assert.equal((targetRequest.authority as { population_id: string }).population_id,
      authorityRow.population_id);
    assert.equal(targetRequest.request_digest, undefined);
    assert.equal((targetRequest.execution_plan as { digest?: string }).digest, undefined);
    assert.equal(result.analysis_id, "analysis");
    assert.equal(result.destinations.status, "/runs/analysis");
  } finally {
    if (priorApproval === undefined) delete process.env.NOISIA_SIGNAL_TB_PAID_RUN_APPROVED;
    else process.env.NOISIA_SIGNAL_TB_PAID_RUN_APPROVED = priorApproval;
  }
});

test("canonical route never accepts browser authority IDs or sensitive GET query fields", async () => {
  const route = await readFile(resolve(
    process.cwd(),
    "src/app/api/data-os/signal/[workspaceId]/reports/triggers-barriers/runs/route.ts"
  ), "utf8");
  const querySchemaSource = route.slice(route.indexOf("const querySchema"), route.indexOf("export async function GET"));
  assert.doesNotMatch(querySchemaSource, /business_question|decision_to_inform/u);
  assert.doesNotMatch(route, /population_id:\s*z\.|policy_bundle_id:\s*z\.|binding_id:\s*z\./u);
  assert.match(route, /prepareSignalTbStrategicRun/u);
  assert.match(route, /launchSignalTbStrategicRunV2/u);
});

test("status and client evidence contracts stay workspace-scoped and capability-safe", async () => {
  const strategic = await readFile(resolve(
    process.cwd(), "src/lib/data-os/signal-strategic-consumption.ts"
  ), "utf8");
  assert.match(strategic, /control\.workspace_id=\$1::uuid AND control\.tb_analysis_id=\$2::uuid/u);
  assert.match(strategic, /analysis\.strategic_contract_version=\$3::text/u);
  assert.match(strategic, /latest\.last_error->>'code'/u);
  assert.match(strategic, /strategicDestinations\(args\.workspaceId, row\.workspace_slug\)/u);

  const evidence = await readFile(resolve(
    process.cwd(), "src/lib/data-os/signal-triggers-barriers-serving.ts"
  ), "utf8");
  assert.match(evidence, /usage_purpose='client-mention-list'/u);
  assert.match(evidence, /usage_purpose='client-text-or-excerpt'/u);
  assert.match(evidence, /retention\.retention_state='allowed'/u);
  assert.match(evidence, /retention\.retain_until IS NULL OR retention\.retain_until>now\(\)/u);
  assert.match(evidence, /CASE WHEN authority\.evidence_allowed THEN text END/u);
  assert.match(evidence, /state: evidenceAllowed \? "available" : "withheld"/u);
});

test("canonical Admin launcher preflights, polls and cancels without browser authority IDs", async () => {
  const launcher = await readFile(resolve(
    process.cwd(), "src/components/admin/StrategicReportLauncher.tsx"
  ), "utf8");
  assert.match(launcher, /method: "GET"/u);
  assert.match(launcher, /setInterval/u);
  assert.match(launcher, /method: "DELETE"/u);
  assert.match(launcher, /Idempotency-Key/u);
  assert.match(launcher, /preflight_digest/u);
  assert.doesNotMatch(launcher, /population_id|policy_bundle_id|binding_id/u);

  const adminWorkspace = await readFile(resolve(
    process.cwd(), "src/lib/data/admin-workspace.ts"
  ), "utf8");
  assert.match(adminWorkspace, /signal-tb-strategic-v2/u);
  assert.match(adminWorkspace, /signal_strategic_run_controls control/u);
  assert.match(adminWorkspace, /COALESCE\(control\.status, analysis\.status\)/u);
});

test("Review and release routes use atomic, durable idempotent v2 writers", async () => {
  const review = await readFile(resolve(
    process.cwd(),
    "src/app/api/data-os/signal/[workspaceId]/reports/triggers-barriers/runs/[analysisId]/review/route.ts"
  ), "utf8");
  assert.match(review, /reviewAndPrepareSignalStrategicReleaseV2/u);
  assert.doesNotMatch(review, /approveTbAnalysisWithArtifacts|createSignalStrategicReleaseDraft/u);
  assert.match(review, /Idempotency-Key/u);

  const releases = await readFile(resolve(
    process.cwd(), "src/app/api/data-os/signal/[workspaceId]/releases/route.ts"
  ), "utf8");
  assert.match(releases, /Idempotency-Key/u);
  const service = await readFile(resolve(
    process.cwd(), "src/lib/data-os/signal-strategic-releases.ts"
  ), "utf8");
  assert.match(service, /review_and_prepare_signal_tb_strategic_v2/u);
  assert.match(service, /promote_signal_workspace_report_release_v2/u);
});

import "../src/env/load";

import type { Job } from "bullmq";

import {
  SIGNAL_INTERPRETATION_CONTRACT_VERSION,
  SIGNAL_INTERPRETATION_PROMPT_VERSION,
  SIGNAL_METRIC_CATALOG_V1,
  signalDefaultWorkspaceHomeFilterV1,
  signalFiltersHashV1,
  signalInterpretationIdempotencyKeyV1,
  type SignalInterpretationJobDataV1
} from "@noisia/query-engine";

import { requireSafeDatabaseWriteTarget } from "../../../infrastructure/db/seeds/connection";
import { pool } from "../src/db/client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_OPERATOR_BUDGET_USD = 100;

type ScopeRow = {
  workspace_id: string;
  study_corpus_id: string;
  timezone: string;
  date_from: string | null;
  date_through: string | null;
};

type MaterializationScopeRow = {
  metric_group_key: string;
  data_watermark_hash: string;
  rows: number;
};

type RunSummaryRow = {
  metric_group_key: string;
  status: string;
  actual_cost_usd: number;
  budget_cap_usd: number;
  generated_by: string | null;
  review_status: string | null;
};

async function main() {
  const apply = process.argv.includes("--apply");
  const databaseUrl = required("DATABASE_URL");
  const workspaceId = requiredUuid("NOISIA_SIGNAL_WORKSPACE_ID");
  const totalBudgetUsd = requiredBudget("NOISIA_SIGNAL_INTERPRETATION_TOTAL_BUDGET_USD");
  const modelVersion =
    process.env.NOISIA_SIGNAL_INTERPRETATION_MODEL?.trim() || "claude-sonnet-4-5";

  requireSafeDatabaseWriteTarget(databaseUrl, {
    operation: "signal:v2:interpret-home",
    allowRemoteEnv: "NOISIA_SIGNAL_INTERPRETATION_ALLOW_REMOTE"
  });
  if (apply && process.env.NOISIA_SIGNAL_INTERPRETATION_RUN_APPROVED !== "true") {
    throw new Error(
      "NOISIA_SIGNAL_INTERPRETATION_RUN_APPROVED=true is required for an applied Claude run."
    );
  }
  if (apply && !process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error("ANTHROPIC_API_KEY is required for an applied Claude run.");
  }

  const scope = await resolveOperationalScope(workspaceId);
  const filter = signalDefaultWorkspaceHomeFilterV1(
    scope.date_from,
    scope.date_through,
    scope.timezone
  );
  if (!filter) throw new Error("The operational corpus has no included mention window.");
  const filtersHash = signalFiltersHashV1(filter);
  const materializations = await loadMaterializationScopes(
    scope.workspace_id,
    scope.study_corpus_id,
    filtersHash
  );
  const expectedGroups = SIGNAL_METRIC_CATALOG_V1.map((group) => group.key).sort();
  const actualGroups = materializations.map((row) => row.metric_group_key).sort();
  if (JSON.stringify(actualGroups) !== JSON.stringify(expectedGroups)) {
    throw new Error(
      `The default Signal home requires ${expectedGroups.length} canonical metric groups; found ${actualGroups.length}.`
    );
  }
  const watermarks = new Set(materializations.map((row) => row.data_watermark_hash));
  if (watermarks.size !== 1) {
    throw new Error("The default Signal home metric groups do not share one data watermark.");
  }
  const dataWatermarkHash = materializations[0]!.data_watermark_hash;
  const perGroupBudgetUsd = roundUsd(totalBudgetUsd / expectedGroups.length);
  const reservedBudgetUsd = roundUsd(perGroupBudgetUsd * expectedGroups.length);
  if (reservedBudgetUsd > totalBudgetUsd) {
    throw new Error("Per-group budget rounding exceeded the authorized total budget.");
  }

  const jobs = materializations.map((row): SignalInterpretationJobDataV1 => ({
    contract_version: SIGNAL_INTERPRETATION_CONTRACT_VERSION,
    workspace_id: scope.workspace_id,
    study_corpus_id: scope.study_corpus_id,
    metric_group_key: row.metric_group_key,
    metric_group_version: 1,
    filter,
    filters_hash: filtersHash,
    data_watermark_hash: dataWatermarkHash,
    prompt_version: SIGNAL_INTERPRETATION_PROMPT_VERSION,
    model_version: modelVersion,
    budget_cap_usd: perGroupBudgetUsd,
    idempotency_key: signalInterpretationIdempotencyKeyV1({
      workspace_id: scope.workspace_id,
      metric_group_key: row.metric_group_key,
      metric_group_version: 1,
      filters_hash: filtersHash,
      data_watermark_hash: dataWatermarkHash,
      prompt_version: SIGNAL_INTERPRETATION_PROMPT_VERSION,
      model_version: modelVersion
    })
  }));

  if (!apply) {
    printSummary({
      mode: "dry_run",
      metricGroups: materializations,
      totalBudgetUsd,
      reservedBudgetUsd,
      results: []
    });
    return;
  }

  process.env.NOISIA_SIGNAL_INTERPRETATIONS_ENABLED = "true";
  process.env.NOISIA_SIGNAL_INTERPRETATIONS_LLM_ENABLED = "true";
  const { signalInterpretationJob } = await import("../src/workers/signal-interpretation");
  for (const data of jobs) {
    await signalInterpretationJob({
      data,
      attemptsMade: 0
    } as Job<SignalInterpretationJobDataV1>);
  }

  const results = await loadRunSummaries(jobs.map((job) => job.idempotency_key));
  const actualCostUsd = roundUsd(
    results.reduce((sum, result) => sum + Number(result.actual_cost_usd), 0)
  );
  const persistedBudgetUsd = roundUsd(
    results.reduce((sum, result) => sum + Number(result.budget_cap_usd), 0)
  );
  if (actualCostUsd > totalBudgetUsd || persistedBudgetUsd > totalBudgetUsd) {
    throw new Error("Persisted interpretation cost or budget exceeded the authorized total.");
  }
  if (results.length !== expectedGroups.length) {
    throw new Error("Not all Signal home interpretation runs were persisted.");
  }

  printSummary({
    mode: "apply",
    metricGroups: materializations,
    totalBudgetUsd,
    reservedBudgetUsd,
    actualCostUsd,
    results
  });
}

async function resolveOperationalScope(workspaceId: string) {
  const result = await pool.query<ScopeRow>(`
    SELECT workspace.id::text AS workspace_id,
      membership.study_corpus_id::text,
      workspace.timezone,
      MIN((mention.published_at AT TIME ZONE workspace.timezone)::date)::text AS date_from,
      MAX((mention.published_at AT TIME ZONE workspace.timezone)::date)::text AS date_through
    FROM signal_workspaces workspace
    JOIN signal_workspace_corpora membership
      ON membership.workspace_id = workspace.id
     AND membership.role = 'operational'
     AND membership.valid_to IS NULL
    LEFT JOIN mentions mention
      ON mention.study_corpus_id = membership.study_corpus_id
     AND mention.inclusion_status = 'included'
    WHERE workspace.id = $1::uuid
      AND workspace.status = 'active'
    GROUP BY workspace.id, membership.study_corpus_id, workspace.timezone
  `, [workspaceId]);
  if (result.rows.length !== 1) {
    throw new Error("Signal workspace must have exactly one active operational corpus.");
  }
  return result.rows[0]!;
}

async function loadMaterializationScopes(
  workspaceId: string,
  corpusId: string,
  filtersHash: string
) {
  const result = await pool.query<MaterializationScopeRow>(`
    SELECT metric_group_key, data_watermark_hash, COUNT(*)::integer AS rows
    FROM metric_materializations
    WHERE workspace_id = $1::uuid
      AND study_corpus_id = $2::uuid
      AND filters_hash = $3
      AND cache_scope = 'default'
    GROUP BY metric_group_key, data_watermark_hash
    ORDER BY metric_group_key, data_watermark_hash
  `, [workspaceId, corpusId, filtersHash]);
  return result.rows;
}

async function loadRunSummaries(idempotencyKeys: string[]) {
  const result = await pool.query<RunSummaryRow>(`
    SELECT run.metric_group_key, run.status,
      run.actual_cost_usd::float8, run.budget_cap_usd::float8,
      interpretation.generated_by, interpretation.review_status
    FROM metric_interpretation_runs run
    LEFT JOIN metric_interpretations interpretation ON interpretation.run_id = run.id
    WHERE run.idempotency_key = ANY($1::text[])
    ORDER BY run.metric_group_key
  `, [idempotencyKeys]);
  return result.rows;
}

function printSummary(input: {
  mode: "apply" | "dry_run";
  metricGroups: MaterializationScopeRow[];
  totalBudgetUsd: number;
  reservedBudgetUsd: number;
  actualCostUsd?: number;
  results: RunSummaryRow[];
}) {
  console.log(JSON.stringify({
    ok: true,
    mode: input.mode,
    identifiers_redacted: true,
    metric_groups: input.metricGroups.map((group) => ({
      key: group.metric_group_key,
      materialization_rows: Number(group.rows)
    })),
    runs: input.results.map((result) => ({
      metric_group_key: result.metric_group_key,
      status: result.status,
      generated_by: result.generated_by,
      review_status: result.review_status,
      actual_cost_usd: Number(result.actual_cost_usd)
    })),
    llm_authorized_budget_usd: input.totalBudgetUsd,
    llm_reserved_budget_usd: input.reservedBudgetUsd,
    llm_spend_usd: input.actualCostUsd ?? 0,
    client_activation: false
  }, null, 2));
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requiredUuid(name: string) {
  const value = required(name).toLowerCase();
  if (!UUID.test(value)) throw new Error(`${name} must be a UUID.`);
  return value;
}

function requiredBudget(name: string) {
  const value = Number(required(name));
  if (!Number.isFinite(value) || value <= 0 || value > MAX_OPERATOR_BUDGET_USD) {
    throw new Error(`${name} must be greater than zero and no more than ${MAX_OPERATOR_BUDGET_USD}.`);
  }
  return roundUsd(value);
}

function roundUsd(value: number) {
  return Number(value.toFixed(6));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

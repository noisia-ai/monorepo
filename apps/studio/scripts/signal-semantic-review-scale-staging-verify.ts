import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadSignalSemanticReviewQueueV1 } from "@noisia/db";
import type { QueryResult, QueryResultRow } from "pg";

import { pool } from "../src/lib/db";
import { loadWorkspaceSemanticResolutionPreflight } from
  "../src/lib/data-os/signal-semantic-resolution";

const EXPECTED_DIRECT =
  "sha256:594e5c421bfb5300626b76ff71137c4fc3a5e7462a6e525f445c6f344abe2a19";
const EXPECTED_POOLER =
  "sha256:0630a1bc2a84b4aa0864bb67312bf20238e778c03a566eae9bdd808661901815";
const OUTPUT_DIRECTORY = resolve(
  process.cwd(), "../../.data/signal-semantic-review-100k/backend-p0"
);

if (
  process.env.NOISIA_REMOTE_DATABASE_TARGET !== "noisia-staging"
  || process.env.NOISIA_SIGNAL_SEMANTIC_SCALE_VERIFY_APPROVED !== "true"
) {
  throw new Error("Semantic Review scale verification is staging-only and requires approval.");
}
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl || ![EXPECTED_DIRECT, EXPECTED_POOLER].includes(fingerprint(databaseUrl))) {
  throw new Error("Semantic Review scale verification target does not match noisia-staging.");
}
const workspaceName = process.env.NOISIA_SIGNAL_SEMANTIC_VERIFY_WORKSPACE_NAME?.trim();
if (!workspaceName) throw new Error("A staging canary workspace name is required.");
const hardCapUsd = process.env.NOISIA_SIGNAL_SEMANTIC_VERIFY_HARD_CAP_USD?.trim();
if (!hardCapUsd || !/^\d+(?:\.\d{1,6})?$/u.test(hardCapUsd)) {
  throw new Error("A read-only operator hard cap is required.");
}

const workspace = await pool.query<{ workspace_id: string }>(`
  SELECT workspace.id::text AS workspace_id
  FROM signal_workspaces workspace
  JOIN brands brand ON brand.id=workspace.brand_id
  WHERE workspace.status='active' AND lower(brand.name)=lower($1)
`, [workspaceName]);
if (workspace.rowCount !== 1 || !workspace.rows[0]) {
  throw new Error("The staging canary workspace is not uniquely resolvable.");
}
const workspaceId = workspace.rows[0].workspace_id;
const before = await runtimeCounts(workspaceId);

let capturedPageQuery: { text: string; values: unknown[] } | null = null;
let queryCount = 0;
const instrumented = {
  query: async <Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = []
  ): Promise<QueryResult<Row>> => {
    queryCount += 1;
    if (
      !capturedPageQuery
      && text.includes("FROM signal_semantic_review_projection_items item")
      && text.includes("ORDER BY item.published_at")
    ) capturedPageQuery = { text, values };
    return pool.query<Row>(text, values);
  }
};

const cold = await measured(() => loadSignalSemanticReviewQueueV1(instrumented, {
  workspace_id: workspaceId, filters: {}, cursor: null, limit: 50
}));
const perRequestQueryCount = queryCount;
if (perRequestQueryCount > 5) throw new Error("Semantic Review page exceeded its query budget.");
const firstPageTimes: number[] = [];
const cursorTimes: number[] = [];
const filterTimes: number[] = [];
for (let index = 0; index < 12; index += 1) {
  firstPageTimes.push((await measured(() => loadSignalSemanticReviewQueueV1(pool, {
    workspace_id: workspaceId, filters: {}, cursor: null, limit: 50
  }))).ms);
  if (cold.value.page.next_cursor) {
    cursorTimes.push((await measured(() => loadSignalSemanticReviewQueueV1(pool, {
      workspace_id: workspaceId, filters: {}, cursor: cold.value.page.next_cursor, limit: 50
    }))).ms);
  }
  filterTimes.push((await measured(() => loadSignalSemanticReviewQueueV1(pool, {
    workspace_id: workspaceId, filters: { state: "candidate_pending" }, cursor: null, limit: 50
  }))).ms);
}
if (!capturedPageQuery) throw new Error("Semantic Review page query was not observed.");
const observedPageQuery = capturedPageQuery as { text: string; values: unknown[] };
const explain = await pool.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${observedPageQuery.text}`,
  observedPageQuery.values);
const plan = explain.rows[0]?.["QUERY PLAN"]?.[0];
const planSummary = sanitizePlan(plan);

const preflight = await measured(() => loadWorkspaceSemanticResolutionPreflight({
  workspaceId, hardCapUsd
}));
const after = await runtimeCounts(workspaceId);
const evidence = {
  contract_version: "signal-semantic-review-100k-staging-verification-v1",
  target: "noisia-staging",
  workspace_ref: hash(`workspace:${workspaceId}`),
  database_fingerprint: fingerprint(databaseUrl),
  queue: {
    cold_ms: cold.ms,
    warm_first_page_p95_ms: percentile(firstPageTimes, 0.95),
    warm_cursor_p95_ms: percentile(cursorTimes, 0.95),
    warm_filter_p95_ms: percentile(filterTimes, 0.95),
    query_count: perRequestQueryCount,
    returned: cold.value.page.returned,
    total_filtered: cold.value.page.total_filtered,
    has_next_page: Boolean(cold.value.page.next_cursor),
    snapshot_digest: cold.value.snapshot.snapshot_digest,
    population_digest: cold.value.snapshot.population_digest,
    generation: cold.value.snapshot.generation,
    aggregate_total: cold.value.reconciliation.included_root_count
  },
  explain: planSummary,
  preflight: {
    elapsed_ms: preflight.ms,
    read_only: preflight.value.read_only,
    writes_performed: preflight.value.writes_performed,
    jobs_enqueued: preflight.value.jobs_enqueued,
    provider_calls: preflight.value.provider_calls,
    spend_usd: preflight.value.spend_usd,
    ready: preflight.value.ready,
    blocking_reasons: preflight.value.blocking_reasons,
    counts: preflight.value.counts,
    population: preflight.value.population,
    selection: preflight.value.selection,
    provider: preflight.value.provider,
    estimate: preflight.value.estimate,
    runtime: {
      queue_configured: preflight.value.runtime.queue_configured,
      queue_paused: preflight.value.runtime.queue_paused,
      worker_alive: preflight.value.runtime.worker_alive,
      recovery_alive: preflight.value.runtime.recovery_alive,
      recovery_ready: preflight.value.runtime.recovery_ready,
      active_outbox_count: preflight.value.runtime.active_outbox_count,
      dead_letter_count: preflight.value.runtime.dead_letter_count
    },
    confirmation: preflight.value.confirmation,
    preflight_digest: preflight.value.preflight_digest
  },
  zero_side_effects: {
    resolution_runs_before: before.resolution_runs,
    resolution_runs_after: after.resolution_runs,
    child_batches_before: before.child_batches,
    child_batches_after: after.child_batches,
    active_outbox_before: before.active_outbox,
    active_outbox_after: after.active_outbox,
    writes_performed: false,
    jobs_enqueued: 0,
    provider_calls: 0,
    spend_usd: "0.000000"
  }
};
const contractChecks = {
  first_page_within_budget: evidence.queue.warm_first_page_p95_ms <= 1_500,
  cursor_within_budget: evidence.queue.warm_cursor_p95_ms <= 1_000,
  filter_within_budget: evidence.queue.warm_filter_p95_ms <= 1_000,
  preflight_within_budget: evidence.preflight.elapsed_ms <= 5_000,
  resolution_runs_unchanged:
    evidence.zero_side_effects.resolution_runs_before
      === evidence.zero_side_effects.resolution_runs_after,
  child_batches_unchanged:
    evidence.zero_side_effects.child_batches_before
      === evidence.zero_side_effects.child_batches_after,
  active_outbox_unchanged:
    evidence.zero_side_effects.active_outbox_before
      === evidence.zero_side_effects.active_outbox_after
};
if (Object.values(contractChecks).some((passed) => !passed)) {
  throw new Error(`Semantic Review staging verification did not meet its contract: ${JSON.stringify({
    checks: contractChecks,
    queue_ms: {
      first_page_p95: evidence.queue.warm_first_page_p95_ms,
      cursor_p95: evidence.queue.warm_cursor_p95_ms,
      filter_p95: evidence.queue.warm_filter_p95_ms
    },
    preflight_ms: evidence.preflight.elapsed_ms,
    zero_side_effects: evidence.zero_side_effects
  })}`);
}

await mkdir(OUTPUT_DIRECTORY, { recursive: true, mode: 0o700 });
const evidencePath = resolve(OUTPUT_DIRECTORY, "staging-runtime.sanitized.json");
const body = `${JSON.stringify(evidence, null, 2)}\n`;
await writeFile(evidencePath, body, { mode: 0o600 });
await chmod(evidencePath, 0o600);
process.stdout.write(`${JSON.stringify({
  ok: true,
  evidence_sha256: hash(body),
  queue: evidence.queue,
  preflight: evidence.preflight,
  zero_side_effects: evidence.zero_side_effects
})}\n`);
await globalThis.noisiaSemanticResolutionQueue?.close();
await globalThis.noisiaDataOsRedis?.quit();
await pool.end();

async function runtimeCounts(targetWorkspaceId: string) {
  const result = await pool.query<{
    resolution_runs: number;child_batches:number;active_outbox:number
  }>(`
    SELECT
      (SELECT count(*)::int FROM signal_semantic_resolution_runs WHERE workspace_id=$1::uuid)
        AS resolution_runs,
      (SELECT count(*)::int FROM signal_semantic_resolution_child_batches WHERE workspace_id=$1::uuid)
        AS child_batches,
      (SELECT count(*)::int FROM signal_semantic_resolution_child_outbox
        WHERE workspace_id=$1::uuid AND status IN ('pending','dispatching','dispatched','failed'))
        AS active_outbox
  `, [targetWorkspaceId]);
  return result.rows[0] ?? { resolution_runs: -1, child_batches: -1, active_outbox: -1 };
}

async function measured<Value>(operation: () => Promise<Value>) {
  const start = performance.now();
  const value = await operation();
  return { value, ms: round(performance.now() - start) };
}

function percentile(values: number[], target: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * target) - 1)] ?? 0;
}

function sanitizePlan(plan: Record<string, unknown> | undefined) {
  if (!plan) return { execution_time_ms: null, nodes: [] as unknown[] };
  const nodes: Array<Record<string, unknown>> = [];
  const visit = (node: Record<string, unknown>) => {
    nodes.push({
      node_type: node["Node Type"] ?? null,
      relation: node["Relation Name"] ?? null,
      index: node["Index Name"] ?? null,
      actual_rows: node["Actual Rows"] ?? null,
      actual_loops: node["Actual Loops"] ?? null,
      shared_hit_blocks: node["Shared Hit Blocks"] ?? 0,
      shared_read_blocks: node["Shared Read Blocks"] ?? 0,
      temp_read_blocks: node["Temp Read Blocks"] ?? 0,
      temp_written_blocks: node["Temp Written Blocks"] ?? 0
    });
    for (const child of (node.Plans as Array<Record<string, unknown>> | undefined) ?? []) visit(child);
  };
  const root = plan.Plan as Record<string, unknown> | undefined;
  if (root) visit(root);
  return {
    planning_time_ms: plan["Planning Time"] ?? null,
    execution_time_ms: plan["Execution Time"] ?? null,
    nodes
  };
}

function fingerprint(value: string) {
  const parsed = new URL(value);
  return hash([
    parsed.protocol, parsed.hostname.toLowerCase(), parsed.port || "5432",
    parsed.pathname.replace(/^\//u, ""), parsed.username
  ].join("|"));
}

function hash(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function round(value: number) { return Math.round(value * 10) / 10; }

import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import { loadSignalWorkspaceCorpusReadinessStoreV1 } from "../signal-workspace-corpus-readiness";

type PlanNode = {
  "Node Type": string;
  "Actual Rows": number;
  "Actual Loops": number;
  "Rows Removed by Filter"?: number;
  Plans?: PlanNode[];
};

test("representative corpus readiness does not repeatedly scan the full materialized path set", {
  skip: process.env.NOISIA_CORPUS_READINESS_PERFORMANCE_TEST_APPROVED !== "true", timeout: 120_000
}, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.ok(url.pathname.startsWith("/noisia_national_import_test_"));
  const workspaceId = process.env.NOISIA_CORPUS_READINESS_PERF_WORKSPACE_ID!;
  assert.match(workspaceId, /^[a-f0-9-]{36}$/u);
  const client = new pg.Client({ connectionString: url.href, ssl: false });
  await client.connect();
  let plan: PlanNode | undefined;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='90s'");
    const result = await loadSignalWorkspaceCorpusReadinessStoreV1({ workspace_id: workspaceId,
      queryable: { query: async <Row extends Record<string, unknown>>(sql: string, values?: unknown[]) => {
        const explained = await client.query("EXPLAIN (ANALYZE,FORMAT JSON) " + sql, values);
        plan = explained.rows[0]["QUERY PLAN"][0].Plan as PlanNode;
        return client.query<Row>(sql, values);
      } }
    });
    assert.ok(result.accepted_files >= 16, "performance fixture requires at least sixteen accepted files");
    assert.ok(result.projection.linked_roots >= 10_000, "performance fixture requires at least ten thousand roots");
    assert.equal(result.state, "received");
    assert.deepEqual(result.reconciliation_errors, []);
    assert.ok(plan);
    const repeatedCteRows: number[] = [];
    const inspect = (node: PlanNode) => {
      if (node["Node Type"] === "CTE Scan") repeatedCteRows.push(
        (node["Actual Rows"] + (node["Rows Removed by Filter"] ?? 0)) * node["Actual Loops"]
      );
      for (const child of node.Plans ?? []) inspect(child);
    };
    inspect(plan);
    // Sixteen import-authority rows may be scanned per root. A 32x linear budget
    // permits that existing plan while rejecting the former ~N²/2 path scan.
    const workBudget = Math.max(result.projection.linked_roots, result.projection.observations) * 32;
    assert.ok(Math.max(0, ...repeatedCteRows) <= workBudget,
      "a materialized corpus relation was rescanned quadratically");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
});

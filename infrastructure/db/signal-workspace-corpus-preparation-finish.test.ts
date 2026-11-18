import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import {
  finishSignalWorkspaceCorpusPreparationV1,
  SignalWorkspaceCorpusPreparationError,
  type SignalWorkspaceCorpusPreparationDatabaseV1,
} from "./signal-workspace-corpus-preparation";

const runId = "00000000-0000-4000-8000-000000000001";
const workspaceId = "00000000-0000-4000-8000-000000000002";
const executionToken = "00000000-0000-4000-8000-000000000003";
const actorId = "00000000-0000-4000-8000-000000000004";

type Scenario = {
  status?: string;
  phase?: string;
  inputRevision?: string | null;
  currentRevision?: string;
  policyLive?: boolean;
  processedRoots?: number;
  totalRoots?: number;
  pending?: boolean;
  completedRows?: Array<{ id: string; status: string }>;
  failAnalyzeAt?: number;
};

function completionHarness(scenario: Scenario = {}) {
  const statements: string[] = [];
  let analyzeCount = 0;
  const client = {
    async query(sql: string) {
      statements.push(sql);
      if (/^\s*SELECT workspace_id FROM signal_corpus_preparation_runs/u.test(sql)) {
        return { rows: [{ workspace_id: workspaceId }] };
      }
      if (/^\s*SELECT workspace_id FROM signal_corpus_preparation_input_state/u.test(sql)) {
        return { rows: [] };
      }
      if (/^\s*SELECT run\./u.test(sql)) {
        return { rows: [{
          id: runId,
          workspace_id: workspaceId,
          actor_user_id: actorId,
          status: scenario.status ?? "running",
          phase: scenario.phase ?? "chunking",
          worker_job_id: "corpus-preparation-job",
          execution_token: executionToken,
          execution_live: true,
          current_revision: scenario.currentRevision ?? "7",
          input_revision: scenario.inputRevision === undefined ? "7" : scenario.inputRevision,
          policy_live: scenario.policyLive ?? true,
          cursor_root_id: null,
          counts: {
            total_roots: scenario.totalRoots ?? 2,
            processed_roots: scenario.processedRoots ?? 2,
            eligible_roots: 2,
            excluded_roots: 0,
            rights_blocked_roots: 0,
            inclusion_pending_roots: 0,
            missing_text_roots: 0,
            reused_roots: 0,
            new_roots: 2,
            changed_roots: 0,
            removed_roots: 0,
            chunk_count: 2,
          },
        }] };
      }
      if (/SELECT workspace\.status workspace_status/u.test(sql)) {
        return { rows: [{
          workspace_status: "active",
          brand_status: "active",
          organization_status: "active",
          brand_same_organization: true,
          actor_status: "active",
          user_type: "noisia_internal",
          primary_role: "analyst",
          same_organization: true,
          brand_access_level: null,
        }] };
      }
      if (/SELECT EXISTS\(SELECT 1 FROM signal_corpus_preparation_items/u.test(sql)) {
        return { rows: [{ pending: scenario.pending ?? false }] };
      }
      if (/UPDATE signal_corpus_preparation_runs SET status='completed'/u.test(sql)) {
        return { rows: scenario.completedRows ?? [{ id: runId, status: "completed" }] };
      }
      if (/^\s*ANALYZE /u.test(sql)) {
        analyzeCount += 1;
        if (scenario.failAnalyzeAt === analyzeCount) throw new Error("synthetic statistics maintenance failure");
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const database = {
    async connect() { return client; },
    async query() { return { rows: [] }; },
  } as unknown as SignalWorkspaceCorpusPreparationDatabaseV1;
  return { database, statements };
}

const lease = {
  run_id: runId,
  workspace_id: workspaceId,
  execution_token: executionToken,
  phase: "chunking" as const,
  cursor: null,
};

test("successful finish verifies completion, refreshes both scalar statistics, then commits", async () => {
  const { database, statements } = completionHarness();
  assert.deepEqual(await finishSignalWorkspaceCorpusPreparationV1({ database, lease }), { status: "completed" });
  const relevant = statements.map((sql) => sql.trim()).filter((sql) =>
    ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) || /^ANALYZE /u.test(sql));
  assert.deepEqual(relevant, [
    "BEGIN",
    "ANALYZE signal_corpus_preparation_input_state (workspace_id,input_revision)",
    "ANALYZE signal_corpus_preparation_runs (workspace_id,input_revision,status,policy_valid_until,completed_at,id)",
    "COMMIT",
  ]);
});

test("missing or mismatched completion acknowledgement never analyzes and rolls back", async (t) => {
  const cases: Array<{ name: string; completedRows: Array<{ id: string; status: string }> }> = [
    { name: "no updated row", completedRows: [] },
    { name: "wrong run identity", completedRows: [{ id: workspaceId, status: "completed" }] },
    { name: "wrong terminal status", completedRows: [{ id: runId, status: "running" }] },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const { database, statements } = completionHarness({ completedRows: item.completedRows });
      await assert.rejects(finishSignalWorkspaceCorpusPreparationV1({ database, lease }),
        (error: unknown) => error instanceof SignalWorkspaceCorpusPreparationError
          && error.code === "corpus_preparation_checkpoint_conflict");
      assert.equal(statements.filter((sql) => /^\s*ANALYZE /u.test(sql)).length, 0);
      assert.equal(statements.at(-1)?.trim(), "ROLLBACK");
      assert.equal(statements.includes("COMMIT"), false);
    });
  }
});

test("statistics maintenance failure rolls back instead of acknowledging completion", async () => {
  const { database, statements } = completionHarness({ failAnalyzeAt: 2 });
  await assert.rejects(finishSignalWorkspaceCorpusPreparationV1({ database, lease }), /synthetic statistics maintenance failure/u);
  assert.equal(statements.filter((sql) => /^\s*ANALYZE /u.test(sql)).length, 2);
  assert.equal(statements.includes("COMMIT"), false);
  assert.equal(statements.at(-1)?.trim(), "ROLLBACK");
});

test("superseded, incomplete, pending, and replayed runs do not refresh statistics", async (t) => {
  const cases: Array<{ name: string; scenario: Scenario; code: string; result?: "superseded" }> = [
    { name: "superseded input revision", scenario: { currentRevision: "8" }, code: "", result: "superseded" },
    { name: "incomplete phase", scenario: { phase: "snapshotting" }, code: "corpus_preparation_page_incomplete" },
    { name: "unprocessed roots", scenario: { processedRoots: 1 }, code: "corpus_preparation_page_incomplete" },
    { name: "pending items", scenario: { pending: true }, code: "corpus_preparation_page_incomplete" },
    { name: "replayed completion", scenario: { status: "completed" }, code: "corpus_preparation_lease_lost" },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const { database, statements } = completionHarness(item.scenario);
      if (item.result) {
        assert.deepEqual(await finishSignalWorkspaceCorpusPreparationV1({ database, lease }), { status: item.result });
      } else {
        await assert.rejects(finishSignalWorkspaceCorpusPreparationV1({ database, lease }),
          (error: unknown) => error instanceof SignalWorkspaceCorpusPreparationError && error.code === item.code);
      }
      assert.equal(statements.filter((sql) => /^\s*ANALYZE /u.test(sql)).length, 0);
      assert.equal(statements.includes("COMMIT"), item.result === "superseded");
    });
  }
});

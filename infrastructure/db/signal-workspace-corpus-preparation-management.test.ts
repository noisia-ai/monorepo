import assert from "node:assert/strict";
import test from "node:test";
import { loadSignalWorkspaceCorpusPreparationStoreV1, isSignalCorpusPreparationRetryableV1 } from "./signal-workspace-corpus-preparation-management";

const instant = "2026-09-08T12:00:00.000123Z";
const completed = { id: "run-id", status: "completed", phase: "complete", input_revision: 4,
  counts: { total_roots: 10, processed_roots: 10, eligible_roots: 7, excluded_roots: 1,
    rights_blocked_roots: 1, missing_text_roots: 1, inclusion_pending_roots: 0, reused_roots: 3, new_roots: 6,
    changed_roots: 1, removed_roots: 2, chunk_count: 97 }, error_code: null,
  created_at: instant, updated_at: instant, completed_at: instant,
  request_keys: { private_request: "private-actor" }, actor_user_id: "private-actor", full_text: "private-text" };

async function read(run: unknown, patch: Record<string, unknown> = {}) {
  let queries = 0;
  const row = { observed_at: instant, input_revision: "4", active_run: null,
    latest_run: run, latest_completed: run, is_current: true, ...patch };
  const result = await loadSignalWorkspaceCorpusPreparationStoreV1({ workspace_id: "scoped-workspace",
    queryable: { async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      queries++;
      assert.deepEqual(values, ["scoped-workspace", "corpus-text-chunks-v1"]);
      assert.doesNotMatch(sql, /FROM mentions|full_text|request_keys/u);
      return { rows: [row] as unknown as Row[] };
    } } });
  assert.equal(queries, 1);
  return result;
}

test("preparation summary keeps exact snapshot time and separates stale completion from active work", async () => {
  const result = await read(completed, { input_revision: "5", is_current: false,
    active_run: { ...completed, id: "next-run", status: "running", phase: "chunking", completed_at: null,
      input_revision: 5, counts: { ...completed.counts, processed_roots: 3 } } });
  assert.equal(result.observed_at, instant);
  assert.equal(result.is_current, false); assert.equal(result.needs_preparation, true);
  assert.equal(result.active_run?.counts.processed_roots, 3);
  assert.equal(result.latest_completed?.counts.processed_roots, 10);
  assert.doesNotMatch(JSON.stringify(result), /private-|request_keys|full_text/u);
});

test("corrupt counters cannot become a completed zero-count preparation", async () => {
  for (const counts of [{}, null, [], { ...completed.counts, total_roots: null },
    { ...completed.counts, processed_roots: 9 }, { ...completed.counts, eligible_roots: 11 },
    { ...completed.counts, chunk_count: "9007199254740992" }, { ...completed.counts, reused_roots: -1 }]) {
    await assert.rejects(read({ ...completed, counts }), /corpus_preparation_count_invalid/u);
  }
});

test("queued intent has no manufactured denominator before snapshotting", async () => {
  const result = await read(null, { is_current: false, input_revision: "1",
    active_run: { ...completed, status: "queued", phase: "queued", input_revision: null,
      counts: {}, completed_at: null } });
  assert.equal(result.active_run?.input_revision, null);
  assert.equal(result.active_run?.counts.total_roots, 0);
  assert.equal(result.latest_completed, null);
});

test("only transient worker or queue failures offer retry; integrity and authorization do not", () => {
  for (const code of ["corpus_preparation_worker_failed", "corpus_preparation_queue_unavailable"]) {
    assert.equal(isSignalCorpusPreparationRetryableV1("failed", code), true);
    assert.equal(isSignalCorpusPreparationRetryableV1("completed", code), false);
  }
  for (const code of [null, "corpus_preparation_forbidden", "corpus_preparation_asset_hash_mismatch",
    "corpus_preparation_checkpoint_invalid", "free-form-sensitive-error"]) {
    assert.equal(isSignalCorpusPreparationRetryableV1("failed", code), false);
  }
});

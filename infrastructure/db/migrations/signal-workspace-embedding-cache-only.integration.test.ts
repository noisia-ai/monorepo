import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg, { type Pool, type PoolClient } from "pg";
import { SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 as profile } from "@noisia/query-engine";
import { quoteSignalWorkspaceEmbeddingsStoreV1 as quote, requestSignalWorkspaceEmbeddingsStoreV1 as request } from "../signal-workspace-embeddings-management";
import type { SignalWorkspaceEmbeddingsDatabaseV1 } from "../signal-workspace-embeddings";
import { signalWorkspaceEmbeddingsJobV1 } from "../../../services/workers/src/workers/signal-workspace-embeddings";
import { createWorkspaceVoyageEmbeddingProviderV1 } from "../../../services/workers/src/workers/signal-workspace-embeddings-provider";

const enabled = process.env.NOISIA_WORKSPACE_EMBEDDING_CACHE_ONLY_TEST_APPROVED === "true";

/** Reuse a fully cached local fixture. All admissions, checkpoints and synthetic
 * unresolved balances below disappear in the outer rollback. No imports, fitting,
 * response generation, network transport or trigger bypass is involved. */
test("cache-only admission and the real Worker preserve coverage and money with transport disabled", { skip: !enabled, timeout: 60_000 }, async (t) => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.match(url.pathname, /^\/noisia_national_import_test_\d+$/u);
  const pool = new pg.Pool({ connectionString: url.href, ssl: false, max: 1 });
  const client = await pool.connect();
  await client.query("BEGIN");
  const stack: string[] = []; let serial = 0;
  const query = async (sql: string, params?: unknown[]) => {
    if (sql === "BEGIN") {
      const key = `cache_only_${++serial}`; stack.push(key);
      return client.query(`SAVEPOINT ${key}`);
    }
    if (sql === "COMMIT") return client.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
    if (sql === "ROLLBACK") {
      const key = stack.pop()!; await client.query(`ROLLBACK TO SAVEPOINT ${key}`);
      return client.query(`RELEASE SAVEPOINT ${key}`);
    }
    return client.query(sql, params);
  };
  const scoped = Object.create(client) as PoolClient;
  scoped.query = query as PoolClient["query"]; scoped.release = () => {};
  const database: SignalWorkspaceEmbeddingsDatabaseV1 = { query: query as Pool["query"], connect: async () => scoped };
  const workspace_id = process.env.NOISIA_WORKSPACE_EMBEDDINGS_TEST_WORKSPACE_ID!;
  const actor_user_id = process.env.NOISIA_WORKSPACE_EMBEDDINGS_TEST_ACTOR_ID!;
  const scope = { database, workspace_id, actor_user_id, profile };
  const countRuns = async () => Number((await query("SELECT count(*) n FROM signal_workspace_embedding_runs WHERE workspace_id=$1::uuid", [workspace_id])).rows[0]!.n);
  const prior = (await query("SELECT id FROM signal_workspace_embedding_runs WHERE workspace_id=$1::uuid", [workspace_id])).rows.map(row => row.id);
  const historicalSeal = async () => (await query(`SELECT
    (SELECT md5(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY id)::text,'[]')) FROM signal_workspace_embedding_runs r WHERE id=ANY($1::uuid[])) runs,
    (SELECT md5(COALESCE(jsonb_agg(to_jsonb(c) ORDER BY id)::text,'[]')) FROM signal_workspace_embedding_calls c WHERE run_id=ANY($1::uuid[])) calls,
    (SELECT md5(COALESCE(jsonb_agg(to_jsonb(e) ORDER BY config_digest,chunk_sha256)::text,'[]')) FROM signal_workspace_chunk_embeddings e WHERE workspace_id=$2::uuid) cache`, [prior, workspace_id])).rows[0];
  const saved = await historicalSeal();
  const inSavepoint = async (fn: () => Promise<void>) => {
    await query("BEGIN"); try { await fn(); } finally { await query("ROLLBACK"); }
  };
  try {
    await t.test("zero cap completes every existing chunk without calls and exact replay preserves the intent", () => inSavepoint(async () => {
      const quoted = await quote(scope);
      assert.ok(quoted.eligible_roots > 0 && quoted.total_chunk_references > 128);
      assert.equal(quoted.missing_asset_chunks, 0); assert.equal(quoted.cached_asset_chunks, quoted.total_asset_chunks);
      assert.equal(quoted.full_text_bytes, 0); assert.equal(quoted.tokens_upper, 0); assert.equal(quoted.estimated_upper_micro_usd, 0);
      const args = { ...scope, preparation_run_id: quoted.preparation_run_id, quote_digest: quoted.quote_digest,
        idempotency_key: randomUUID(), hard_cap_micro_usd: 0, provider_available: false };
      const before = await countRuns(), requested = await request(args);
      assert.equal(await countRuns(), before + 1);
      assert.deepEqual(await request({ ...args, provider_available: true }), { ...requested, replayed: true });
      const job = (await query("SELECT worker_job_id FROM signal_workspace_embedding_runs WHERE id=$1::uuid", [requested.run_id])).rows[0]!;
      let attempts = 0, fetches = 0;
      const disabled = createWorkspaceVoyageEmbeddingProviderV1({ enabled: false, fetch: async () => {
        fetches++; throw new Error("A cache-only Worker must not reach transport");
      } });
      const provider = { async embedBatch(inputs: Parameters<typeof disabled.embedBatch>[0]) { attempts++; return disabled.embedBatch(inputs); } };
      const task = { id: job.worker_job_id, data: { run_id: requested.run_id }, updateProgress: async () => {} };
      const finished = await signalWorkspaceEmbeddingsJobV1(task, { database, provider });
      assert.equal("status" in finished && finished.status, "completed");
      assert.deepEqual(await signalWorkspaceEmbeddingsJobV1(task, { database, provider }), { run_id: requested.run_id, replayed: true });
      const row = (await query(`SELECT status,counts,hard_cap_micro_usd,estimated_upper_micro_usd,reserved_micro_usd,
        settled_micro_usd,unknown_reserved_micro_usd,observed_exception_micro_usd FROM signal_workspace_embedding_runs WHERE id=$1::uuid`, [requested.run_id])).rows[0]!;
      assert.equal(row.status, "completed");
      assert.equal(row.counts.completed_roots, quoted.eligible_roots);
      assert.equal(row.counts.processed_chunk_references, quoted.total_chunk_references);
      assert.equal(row.counts.processed_asset_chunks, quoted.total_asset_chunks);
      assert.equal(row.counts.embedded_unique_chunks, 0);
      for (const key of ["hard_cap_micro_usd", "estimated_upper_micro_usd", "reserved_micro_usd", "settled_micro_usd", "unknown_reserved_micro_usd", "observed_exception_micro_usd"])
        assert.equal(Number(row[key]), 0, key);
      assert.equal((await query("SELECT 1 FROM signal_workspace_embedding_calls WHERE run_id=$1::uuid", [requested.run_id])).rowCount, 0);
      assert.equal(attempts, 0); assert.equal(fetches, 0);
      assert.deepEqual(await historicalSeal(), saved);
      // An exact durable request is read-only even after its preparation is stale.
      await query("UPDATE signal_corpus_preparation_input_state SET input_revision=input_revision+1 WHERE workspace_id=$1::uuid", [workspace_id]);
      assert.deepEqual(await request(args), { ...requested, replayed: true });
      assert.equal(await countRuns(), before + 1);
      await assert.rejects(request({ ...args, hard_cap_micro_usd: 1 }), /workspace_embedding_idempotency_conflict/u);
    }));

    await t.test("a stale seal, positive cap or revoked actor cannot create a zero-cost intent", () => inSavepoint(async () => {
      const quoted = await quote(scope), before = await countRuns();
      const args = { ...scope, preparation_run_id: quoted.preparation_run_id, quote_digest: quoted.quote_digest,
        idempotency_key: randomUUID(), hard_cap_micro_usd: 0, provider_available: false };
      await assert.rejects(request({ ...args, quote_digest: `sha256:${"0".repeat(64)}` }), /workspace_embedding_quote_changed/u);
      await assert.rejects(request({ ...args, hard_cap_micro_usd: 1 }), /workspace_embedding_provider_unavailable/u);
      await query("UPDATE users SET status='suspended' WHERE id=$1::uuid", [actor_user_id]);
      await assert.rejects(request(args), /workspace_embedding_forbidden/u);
      assert.equal(await countRuns(), before);
    }));

    await t.test("unresolved embedding reserves and paid retries remain closed while historical settled caches remain reusable", async () => {
      for (const mode of ["reserved", "unknown", "exception", "paid_resume"] as const) await inSavepoint(async () => {
        const quoted = await quote(scope);
        const seed = await request({ ...scope, preparation_run_id: quoted.preparation_run_id, quote_digest: quoted.quote_digest,
          idempotency_key: randomUUID(), hard_cap_micro_usd: 1, provider_available: true });
        // Synthetic ledger balances are only negative test input, not a receipt or
        // evidence of provider usage. Existing paid run rows remain untouched.
        await query(`UPDATE signal_workspace_embedding_runs SET status='failed',error_code=$2,
          reserved_micro_usd=$3,unknown_reserved_micro_usd=$4,observed_exception_micro_usd=$5 WHERE id=$1::uuid`,
        [seed.run_id, mode === "paid_resume" ? "workspace_embedding_worker_failed" : "workspace_embedding_invalid_response",
          mode === "reserved" || mode === "unknown" ? 1 : 0, mode === "unknown" ? 1 : 0, mode === "exception" ? 1 : 0]);
        const fresh = await quote(scope), before = await countRuns();
        await assert.rejects(request({ ...scope, preparation_run_id: fresh.preparation_run_id, quote_digest: fresh.quote_digest,
          idempotency_key: randomUUID(), hard_cap_micro_usd: 0, provider_available: false }),
        mode === "paid_resume" ? /workspace_embedding_provider_unavailable/u : /workspace_embedding_cache_only_unavailable/u);
        assert.equal(await countRuns(), before);
        assert.deepEqual(await historicalSeal(), saved);
      });
    });
  } finally {
    await client.query("ROLLBACK"); client.release(); await pool.end();
  }
});

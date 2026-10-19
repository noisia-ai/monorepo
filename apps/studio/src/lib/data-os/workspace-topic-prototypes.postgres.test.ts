import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import test from "node:test";
import { loadWorkspaceTopicPrototypesForActorV1, quoteWorkspaceTopicPrototypesForActorV1,
  requestWorkspaceTopicPrototypesForActorV1 } from "./workspace-topic-prototypes";
import { loadSignalWorkspaceEmbeddingsStoreV1, loadSignalWorkspaceTopicPrototypesV1, requestSignalWorkspaceTopicPrototypesV1,
  claimSignalWorkspaceEmbeddingRunV1, readSignalWorkspaceEmbeddingBatchV1, reserveSignalWorkspaceEmbeddingCallV1,
  commitSignalWorkspaceEmbeddingBatchV1 } from "@noisia/db";
import { signalTopicDefinitionDigestV1, type SignalTopicDefinitionV1 } from "@noisia/query-engine";

const targetPath = process.env.NOISIA_TOPIC_PROTOTYPE_SERVICE_TARGET;
test("prototype API service isolates actors, hides private inputs, distinguishes corpus completion and reports an emptied catalog", { skip: !targetPath }, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.ok(url.pathname.startsWith("/noisia_national_import_test_"));
  const fixture = JSON.parse(await readFile(targetPath!, "utf8")) as { workspace_id: string; actor_id: string; mention: string };
  const { pool } = await import("@/lib/db");
  const client = await pool.connect(); const stack: string[] = []; let counter = 0;
  const query = async (sql: string, values?: unknown[]) => {
    if (/^BEGIN\b/u.test(sql)) { const name = `prototype_service_${++counter}`; stack.push(name); return client.query(`SAVEPOINT ${name}`); }
    if (sql === "COMMIT") return client.query(`RELEASE SAVEPOINT ${stack.pop()}`);
    if (sql === "ROLLBACK") { const name = stack.pop()!; await client.query(`ROLLBACK TO SAVEPOINT ${name}`); return client.query(`RELEASE SAVEPOINT ${name}`); }
    return client.query(sql, values);
  };
  const database = { query, connect: async () => ({ query, release() {} }) } as unknown as Pick<Pool, "query" | "connect">;
  const args = { database, workspaceId: fixture.workspace_id, actorUserId: fixture.actor_id };
  try {
    await client.query("BEGIN");
    const status = await loadWorkspaceTopicPrototypesForActorV1(args);
    assert.equal(status.is_current, true); assert.equal(status.availability, "available"); assert.equal(status.can_execute, true);
    assert.ok(status.latest_completed); assert.equal(status.provider_available, false);
    const quote = await quoteWorkspaceTopicPrototypesForActorV1(args);
    assert.equal(quote.requires_provider, false); assert.equal(quote.estimated_upper_micro_usd, 0);
    const key = (await client.query(`SELECT jsonb_object_keys(request_keys) request_key FROM signal_workspace_embedding_runs WHERE id=$1::uuid`,
      [status.latest_completed.id])).rows[0]!.request_key as string;
    const own = await loadWorkspaceTopicPrototypesForActorV1({ ...args, idempotencyKey: key });
    assert.equal(own.request_run?.id, status.latest_completed.id);
    for (const payload of [status, quote, own]) {
      const text = JSON.stringify(payload);
      assert.ok(!text.includes(fixture.mention)); assert.ok(!text.includes(fixture.actor_id)); assert.ok(!text.includes(key));
      for (const privateKey of ['"texts":', '"topic_input_snapshot":', '"request_keys":', '"response_body_private":', '"source_embedding_call_id":']) {
        assert.ok(!text.includes(privateKey), privateKey);
      }
    }
    const owner = (await client.query("SELECT organization_id,brand_id FROM signal_workspaces WHERE id=$1::uuid", [fixture.workspace_id])).rows[0]!;
    const viewer = randomUUID();
    await client.query(`INSERT INTO users(id,email,full_name,user_type,primary_role,status,organization_id)
      VALUES($1::uuid,$2,'Prototype service reviewer','client','client_viewer','active',$3::uuid)`,
    [viewer, `prototype-service-${viewer}@example.test`, owner.organization_id]);
    await client.query("INSERT INTO user_brand_access(user_id,brand_id,access_level,granted_by_user_id) VALUES($1::uuid,$2::uuid,'read',$3::uuid)",
      [viewer, owner.brand_id, fixture.actor_id]);
    const viewed = await loadWorkspaceTopicPrototypesForActorV1({ ...args, actorUserId: viewer, idempotencyKey: key });
    assert.equal(viewed.is_current, true); assert.equal(viewed.can_execute, false); assert.equal(viewed.request_run, null);
    assert.notEqual(viewed.request_scope, own.request_scope);
    const viewerQuote = await quoteWorkspaceTopicPrototypesForActorV1({ ...args, actorUserId: viewer });
    assert.equal(viewerQuote.can_execute, false);
    await assert.rejects(requestWorkspaceTopicPrototypesForActorV1({ ...args, actorUserId: viewer, idempotencyKey: randomUUID(),
      body: { plan_digest: quote.plan_digest, quote_digest: quote.quote_digest, hard_cap_micro_usd: 0 } }), /forbidden/u);
    await assert.rejects(loadWorkspaceTopicPrototypesForActorV1({ ...args, workspaceId: randomUUID(), actorUserId: viewer }), /forbidden/u);
    await assert.rejects(loadWorkspaceTopicPrototypesForActorV1({ ...args, actorUserId: randomUUID() }), /forbidden/u);
    await client.query("UPDATE user_brand_access SET revoked_at=clock_timestamp() WHERE user_id=$1::uuid", [viewer]);
    await assert.rejects(loadWorkspaceTopicPrototypesForActorV1({ ...args, actorUserId: viewer }), /forbidden/u);
    const corpus = await loadSignalWorkspaceEmbeddingsStoreV1({ queryable: client, workspace_id: fixture.workspace_id });
    assert.ok(corpus.latest_completed); assert.notEqual(corpus.latest_completed.id, status.latest_completed.id);
    assert.ok(corpus.latest_completed.counts.eligible_roots > 0);
    await client.query("SAVEPOINT known_pending_quote");
    const term = (await client.query(`SELECT term.id,term.metadata FROM taxonomy_terms term JOIN signal_taxonomy_profiles profile ON profile.taxonomy_id=term.taxonomy_id
      WHERE profile.workspace_id=$1::uuid AND profile.kind='topic' AND profile.status IN('draft','activating','active') ORDER BY profile.version DESC,term.id LIMIT 1`, [fixture.workspace_id])).rows[0]!;
    const changed = { ...term.metadata.topic as SignalTopicDefinitionV1, definition: `Known pending input ${randomUUID()}`,
      definition_revision: Number(term.metadata.topic.definition_revision) + 1 };
    changed.definition_digest = signalTopicDefinitionDigestV1(changed);
    await client.query("UPDATE taxonomy_terms SET metadata=jsonb_set(metadata,'{topic}',$2::jsonb) WHERE id=$1::uuid", [term.id, JSON.stringify(changed)]);
    const pendingQuote = await quoteWorkspaceTopicPrototypesForActorV1(args);
    const requested = await requestSignalWorkspaceTopicPrototypesV1({ database, workspace_id: fixture.workspace_id, actor_user_id: fixture.actor_id,
      idempotency_key: randomUUID(), plan_digest: pendingQuote.plan_digest, quote_digest: pendingQuote.quote_digest,
      hard_cap_micro_usd: pendingQuote.estimated_upper_micro_usd, provider_available: true, max_run_cost_micro_usd: 5_000_000 });
    const job = (await client.query("SELECT worker_job_id FROM signal_workspace_embedding_runs WHERE id=$1::uuid", [requested.run_id])).rows[0]!.worker_job_id;
    let lease = await claimSignalWorkspaceEmbeddingRunV1({ database, run_id: requested.run_id, worker_job_id: job });
    assert.ok(lease);
    // Cache-first pages may precede the changed input; choose it without external transport.
    let batch = await readSignalWorkspaceEmbeddingBatchV1({ database, lease });
    while (batch.inputs.length === 0 && batch.items.length > 0) {
      lease = await commitSignalWorkspaceEmbeddingBatchV1({ database, lease, batch, call_id: null });
      batch = await readSignalWorkspaceEmbeddingBatchV1({ database, lease });
    }
    assert.ok(batch.inputs.length > 0);
    await reserveSignalWorkspaceEmbeddingCallV1({ database, lease, batch });
    const activeQuote = await quoteWorkspaceTopicPrototypesForActorV1(args);
    assert.equal(activeQuote.blocking_run_kind, "topic_prototypes"); assert.equal(activeQuote.has_unknown_outcome, false);
    await client.query("UPDATE signal_workspace_embedding_runs SET status='failed',error_code='workspace_embedding_forbidden' WHERE id=$1::uuid", [requested.run_id]);
    const unresolved = await quoteWorkspaceTopicPrototypesForActorV1(args);
    assert.equal(unresolved.blocking_error_code, "workspace_embedding_prior_run_unresolved");
    assert.equal(unresolved.has_unknown_outcome, false, "A reserved but unsent request is not an unknown provider result.");
    await client.query("ROLLBACK TO SAVEPOINT known_pending_quote"); await client.query("RELEASE SAVEPOINT known_pending_quote");
    // Keep all evidence and restore this fixture transactionally after verifying the UI's empty state.
    await client.query(`UPDATE taxonomy_terms term SET metadata=jsonb_set(term.metadata,'{topic,lifecycle}','"archived"')
      FROM signal_taxonomy_profiles profile WHERE profile.workspace_id=$1::uuid AND profile.taxonomy_id=term.taxonomy_id AND profile.kind='topic'`, [fixture.workspace_id]);
    const empty = await loadWorkspaceTopicPrototypesForActorV1(args);
    assert.equal(empty.availability, "no_topics"); assert.equal(empty.current_plan_digest, null); assert.equal(empty.is_current, false);
    assert.equal(empty.latest_completed?.id, status.latest_completed.id);
    await assert.rejects(quoteWorkspaceTopicPrototypesForActorV1(args), /workspace_topic_catalog_empty/u);
    await client.query("ROLLBACK");
    // A fixes its snapshot before B, but finishes after B. Its timestamp must stay
    // older so the UI cannot accept it as newer progress merely because it was slow.
    let captured!: () => void; let release!: () => void;
    const snapshotCaptured = new Promise<void>(resolve => { captured = resolve; });
    const finishSlowRead = new Promise<void>(resolve => { release = resolve; });
    let delayed = false;
    const slowDatabase = { query: pool.query.bind(pool), connect: async () => {
      const connection = await pool.connect();
      return { release: () => connection.release(), query: async (sql: string, values?: unknown[]) => {
        const result = await connection.query(sql, values);
        if (!delayed && sql.includes("SELECT workspace.status workspace_status")) {
          delayed = true; captured(); await finishSlowRead;
        }
        return result;
      } };
    } } as unknown as Pick<Pool, "query" | "connect">;
    const slow = loadSignalWorkspaceTopicPrototypesV1({ database: slowDatabase, workspace_id: fixture.workspace_id, actor_user_id: fixture.actor_id });
    await snapshotCaptured;
    let fast;
    try { fast = await loadSignalWorkspaceTopicPrototypesV1({ database: pool, workspace_id: fixture.workspace_id, actor_user_id: fixture.actor_id }); }
    finally { release(); }
    const earlier = await slow;
    assert.ok(earlier.observed_at < fast.observed_at, "An older MVCC snapshot must not overtake a newer response.");
  } finally { await client.query("ROLLBACK").catch(() => undefined); client.release(); await pool.end(); }
});

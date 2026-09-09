import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { loadWorkspaceCorpusEmbeddingsForActorV1, quoteWorkspaceCorpusEmbeddingsForActorV1,
  requestWorkspaceCorpusEmbeddingsForActorV1, validateWorkspaceCorpusEmbeddingRequestV1,
  workspaceEmbeddingRuntimeSettingsV1, WorkspaceCorpusEmbeddingsError } from "./workspace-corpus-embeddings";
const granted = { workspace_status: "active", brand_status: "active", actor_status: "active", user_type: "client",
  primary_role: "client_admin", same_organization: true, brand_access_level: "admin" };
const body = { preparation_run_id: "10000000-0000-4000-8000-000000000001", quote_digest: `sha256:${"a".repeat(64)}`, hard_cap_micro_usd: 1_000_000 };
function authorityDatabase(authority: unknown) {
  let calls = 0;
  const database = { async query(_sql: string, params: unknown[]) {
    calls++; assert.equal(calls, 1, "Denied authority cannot read corpus, cache, receipts or write an outbox.");
    assert.deepEqual(params, ["workspace", "actor"]); return { rows: authority ? [authority] : [] };
  }, async connect() { throw new Error("No mutation transaction is allowed."); } } as unknown as Pick<Pool, "query" | "connect">;
  return database;
}
test("embedding status, quote and requests deny cross-tenant, revoked and inactive authority before private reads", async () => {
  for (const authority of [null, { ...granted, same_organization: false }, { ...granted, actor_status: "suspended" },
    { ...granted, brand_access_level: null }, { ...granted, workspace_status: "archived" }, { ...granted, brand_status: "archived" }]) {
    for (const operation of ["load", "quote", "request"]) {
      const args = { database: authorityDatabase(authority), workspaceId: "workspace", actorUserId: "actor" };
      await assert.rejects(operation === "load" ? loadWorkspaceCorpusEmbeddingsForActorV1(args)
        : operation === "quote" ? quoteWorkspaceCorpusEmbeddingsForActorV1(args)
          : requestWorkspaceCorpusEmbeddingsForActorV1({ ...args, idempotencyKey: "request-123", body }),
      (error: unknown) => error instanceof WorkspaceCorpusEmbeddingsError && error.status === 403);
    }
  }
});
test("client import authority never grants paid embedding execution", async () => {
  await assert.rejects(requestWorkspaceCorpusEmbeddingsForActorV1({ database: authorityDatabase(granted),
    workspaceId: "workspace", actorUserId: "actor", idempotencyKey: "request-123", body }),
  (error: unknown) => error instanceof WorkspaceCorpusEmbeddingsError && error.status === 403);
});
test("embedding runtime defaults disabled and refuses malformed, negative and unsafe monetary configuration", () => {
  assert.deepEqual(workspaceEmbeddingRuntimeSettingsV1({}), { provider_available: false, max_run_cost_micro_usd: 5_000_000 });
  assert.equal(workspaceEmbeddingRuntimeSettingsV1({ NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED: "true" }).provider_available, false);
  assert.equal(workspaceEmbeddingRuntimeSettingsV1({ NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED: "false", VOYAGE_API_KEY: "test-only" }).provider_available, false);
  assert.equal(workspaceEmbeddingRuntimeSettingsV1({ NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED: "true", VOYAGE_API_KEY: "test-only" }).provider_available, true);
  for (const raw of ["-1", "", "Infinity", "1e6", "1.5", "9007199254740992"]) {
    assert.throws(() => workspaceEmbeddingRuntimeSettingsV1({ NOISIA_WORKSPACE_EMBEDDINGS_MAX_COST_MICRO_USD: raw }), WorkspaceCorpusEmbeddingsError);
  }
});
test("paid request contains only a preparation identity, quote seal and integer budget", () => {
  assert.equal(validateWorkspaceCorpusEmbeddingRequestV1(body), true);
  for (const invalid of [null, [], {}, { ...body, hard_cap_micro_usd: "1000000" }, { ...body, hard_cap_micro_usd: NaN },
    { ...body, hard_cap_micro_usd: -1 }, { ...body, hard_cap_micro_usd: Number.MAX_SAFE_INTEGER + 1 },
    { ...body, quote_digest: "changed" }, { ...body, preparation_run_id: "bad" }, { ...body, model: "other" },
    { ...body, actor_user_id: "other" }, { ...body, texts: ["sample"] }, { ...body, publish: true }]) {
    assert.equal(validateWorkspaceCorpusEmbeddingRequestV1(invalid), false);
  }
});

test('server recomputes the cache-only plan while disabled and refuses stale, missing or financially unresolved inputs', async () => {
  const previous = process.env.NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED;
  process.env.NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED = 'false';
  const workspaceId = '20000000-0000-4000-8000-000000000001', actorUserId = '30000000-0000-4000-8000-000000000001';
  const internal = {...granted,user_type:'noisia_internal',primary_role:'analyst'};
  const observed = '2026-09-09T00:00:00.000000Z';
  try {
    for (const scenario of ['cache','stale','missing','unknown','reserved','resume_paid','wrong_cap'] as const) {
      let mutations = 0, writes = 0, quoting = 0;
      const query = async (sql: string) => {
        if (sql.includes('workspace.status workspace_status')) return {rows:[internal]};
        if (sql.includes('WITH prepared AS MATERIALIZED')) {
          const missing = scenario === 'missing' || scenario === 'stale' && quoting++ > 0;
          return {rows:[{preparation_run_id:body.preparation_run_id,input_revision:1,policy_valid_until:null,observed_at:observed,
            eligible_roots:'3',total_chunk_references:'12',total_asset_chunks:'8',cached_asset_chunks:missing?'7':'8',
            full_text_bytes:missing?'1400':'0',resume_run_id:scenario==='resume_paid'?body.preparation_run_id:null,
            required_cap_micro_usd:scenario==='resume_paid'?'1000000':null}]};
        }
        if (sql.startsWith('INSERT INTO') || sql.startsWith('UPDATE')) { writes++; return {rows:[],rowCount:1}; }
        if (sql.includes('SELECT 1 FROM signal_workspace_embedding_calls') && sql.includes("status IN('in_flight','outcome_unknown')"))
          return {rows:scenario==='unknown'?[{exists:1}]:[]};
        if (sql.includes('run.reserved_micro_usd>0')) return {rows:scenario==='reserved'?[{exists:1}]:[]};
        if (sql.startsWith('WITH recent AS MATERIALIZED')) return {rows:[{observed_at:observed,
          active_run:null,latest_run:null,latest_completed:null,request_run:null,is_current:false}]};
        return {rows:[],rowCount:0};
      };
      const database = {query,connect:async()=>{mutations++;return{query,release(){}};}} as unknown as Pick<Pool,'query'|'connect'>;
      const args = {database,workspaceId,actorUserId};
      const quoted = await quoteWorkspaceCorpusEmbeddingsForActorV1(args);
      const request = {...args,idempotencyKey:'cache-only-'+scenario,body:{preparation_run_id:quoted.preparation_run_id,
        quote_digest:quoted.quote_digest,hard_cap_micro_usd:scenario==='wrong_cap'?1:0}};
      if (scenario === 'cache') { await requestWorkspaceCorpusEmbeddingsForActorV1(request); assert.equal(writes,1); }
      else {
        await assert.rejects(requestWorkspaceCorpusEmbeddingsForActorV1(request),
          scenario==='stale'?/quote_changed/u:scenario==='unknown'?/outcome_unknown/u:scenario==='reserved'?/cache_only_unavailable/u:
            /provider_unavailable|budget_below_quote/u);
        assert.equal(writes,0,'rejected plan cannot create an intent or reservation');
      }
      assert.equal(mutations,1,'admission uses the real guarded store');
    }
  } finally {
    if (previous === undefined) delete process.env.NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED;
    else process.env.NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED = previous;
  }
});

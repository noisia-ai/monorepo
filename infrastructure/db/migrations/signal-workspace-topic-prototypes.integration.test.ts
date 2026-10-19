import {currentTopicDefinitionCasV1} from './signal-topic-definition-cas.fixture';
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import type { Pool, PoolClient } from "pg";
import { SIGNAL_WORKSPACE_EMBEDDING_PROFILE_V1 as profile } from "@noisia/query-engine";
import * as core from "../signal-workspace-embeddings";
import { createSignalTopicStoreV1, updateSignalTopicStoreV1 } from "../signal-topic-catalog";
import { loadSignalWorkspaceTopicPrototypePlanV1 } from "../signal-workspace-topic-prototype-inputs";
import { loadSignalWorkspaceTopicPrototypesV1 as status, quoteSignalWorkspaceTopicPrototypesV1 as quote,
 requestSignalWorkspaceTopicPrototypesV1 as request } from "../signal-workspace-topic-prototypes-management";
import { loadSignalWorkspaceEmbeddingsStoreV1 as corpusStatus } from "../signal-workspace-embeddings-management";

const enabled = process.env.NOISIA_WORKSPACE_TOPIC_PROTOTYPES_TEST_APPROVED === "true";
/** Every fixture owns a new pre-import brand inside an outer rollback. Store
 * transactions use real savepoints; all SQL guards and cache receipts are real. */
async function fixture() {
 const url = new URL(process.env.DATABASE_URL!); assert.equal(url.hostname, "127.0.0.1");
 assert.match(url.pathname, /^\/noisia_national_import_test_\d+$/u);
 const pool = new pg.Pool({ connectionString: url.href, ssl: false, max: 1 });
 const client = await pool.connect(); await client.query("BEGIN"); await client.query("SET LOCAL TIME ZONE 'UTC'");
 const stack: string[] = []; let serial = 0;
 const query = async (sql: string, params?: unknown[]) => {
  if (sql.startsWith("BEGIN")) { const name = `prototype_test_${++serial}`; stack.push(name); return client.query(`SAVEPOINT ${name}`); }
  if (sql === "COMMIT") return client.query(`RELEASE SAVEPOINT ${stack.pop()!}`);
  if (sql === "ROLLBACK") { const name = stack.pop()!; await client.query(`ROLLBACK TO SAVEPOINT ${name}`); return client.query(`RELEASE SAVEPOINT ${name}`); }
  return client.query(sql, params);
 };
 const scoped = Object.create(client) as PoolClient; scoped.query = query as PoolClient["query"]; scoped.release = () => {};
 const database = Object.assign(Object.create(pool) as Pool, { query: query as Pool["query"], connect: async () => scoped });
 const organization = randomUUID(), brand = randomUUID(), actor_user_id = randomUUID(), viewer = randomUUID();
 await query("INSERT INTO organizations(id,slug,legal_name,status) VALUES($1::uuid,$2,'Prototype fixture','active')", [organization, `prototype-${organization}`]);
 await query("INSERT INTO brands(id,organization_id,slug,name,description,status) VALUES($1::uuid,$2::uuid,$3,'Prototype fixture',$4,'active')",
  [brand, organization, `prototype-${brand}`, "Contexto completo á😀 ".repeat(500) + "FINAL_SIN_RECORTE"]);
 const workspace_id = (await query("SELECT id FROM signal_workspaces WHERE brand_id=$1::uuid", [brand])).rows[0].id as string;
 await query(`INSERT INTO users(id,email,user_type,primary_role,organization_id,status) VALUES
  ($1::uuid,$2,'noisia_internal','noisia_admin',$3::uuid,'active'),($4::uuid,$5,'client','client_admin',$3::uuid,'active')`,
 [actor_user_id, `${actor_user_id}@example.test`, organization, viewer, `${viewer}@example.test`]);
 await query("INSERT INTO user_brand_access(user_id,brand_id,access_level) VALUES($1::uuid,$2::uuid,'admin')", [viewer, brand]);
 const scope = { database, workspace_id, actor_user_id };
 const topics = [];
 for (const label of ["Entrega puntual", "Expectativas de entrega"]) topics.push(await createSignalTopicStoreV1({ pool: database,
  workspace_id, actor_user_id, idempotency_key: randomUUID(), input: { label, definition: "Conversaciones sobre demora de entrega documentada",
   scope: "primary_brand", inclusion: ["La entrega llegó después del plazo"], exclusion: ["Consultas de precio"], positive_examples: [], negative_examples: [] } }));
 const plan = () => loadSignalWorkspaceTopicPrototypePlanV1({ queryable: database, workspace_id, actor_user_id });
 const ask = async (provider_available = true) => { const current = await quote(scope); return request({ ...scope,
  idempotency_key: randomUUID(), plan_digest: current.plan_digest, quote_digest: current.quote_digest,
  hard_cap_micro_usd: current.required_cap_micro_usd ?? current.estimated_upper_micro_usd, provider_available, max_run_cost_micro_usd: 5_000_000 }); };
 const claim = async (run_id: string) => { const worker_job_id = (await query("SELECT worker_job_id FROM signal_workspace_embedding_runs WHERE id=$1::uuid", [run_id])).rows[0].worker_job_id;
  const lease = await core.claimSignalWorkspaceEmbeddingRunV1({ database, run_id, worker_job_id }); assert.ok(lease); return lease; };
 const begin = async () => { const intent = await ask(), lease = await claim(intent.run_id), batch = await core.readSignalWorkspaceEmbeddingBatchV1({ database, lease });
  const call = await core.reserveSignalWorkspaceEmbeddingCallV1({ database, lease, batch }); assert.ok(call); return { lease, batch, call }; };
 const cleanup = async () => { await client.query("ROLLBACK"); client.release(); await pool.end(); };
 const rejected = async (sql: string, params: unknown[], pattern: RegExp) => { await query("BEGIN");
  try { await assert.rejects(query(sql, params), pattern); } finally { await query("ROLLBACK"); } };
 return { database, query, scope, workspace_id, actor_user_id, organization, brand, viewer, topics, plan, ask, claim, begin, cleanup, rejected };
}
function response(batch: core.SignalWorkspaceEmbeddingBatchV1) {
 const vectors = batch.inputs.map(input => ({ chunk_sha256: input.chunk_sha256, embedding: Array.from({ length: 1024 }, (_, i) => i === 0 ? 1 : 0) }));
 return { validated: { vectors, total_tokens: vectors.length, provider_request_id: "local-prototypes" }, raw: {
  http_status: 200, provider_request_id: "local-prototypes", body: JSON.stringify({ model: profile.model,
   data: vectors.map((vector, index) => ({ index, embedding: vector.embedding })), usage: { total_tokens: vectors.length } }) } };
}
async function complete(f: Awaited<ReturnType<typeof fixture>>, lease: core.SignalWorkspaceEmbeddingLeaseV1) {
 let physicalInputs = 0, calls = 0;
 for (;;) { const batch = await core.readSignalWorkspaceEmbeddingBatchV1({ database: f.database, lease });
  if (!batch.items.length) { assert.equal(batch.done, true); break; }
  const call = await core.reserveSignalWorkspaceEmbeddingCallV1({ database: f.database, lease, batch });
  if (call) { assert.equal(call.state, "reserved"); const answer = response(batch); calls++; physicalInputs += batch.inputs.length;
   await core.markSignalWorkspaceEmbeddingCallSentV1({ database: f.database, lease, call_id: call.call_id, attempt_token: call.attempt_token });
   await core.persistSignalWorkspaceEmbeddingResponseV1({ database: f.database, call_id: call.call_id, attempt_token: call.attempt_token, response: answer.raw });
   lease = await core.commitSignalWorkspaceEmbeddingBatchV1({ database: f.database, lease, batch, call_id: call.call_id, attempt_token: call.attempt_token, validated: answer.validated });
  } else lease = await core.commitSignalWorkspaceEmbeddingBatchV1({ database: f.database, lease, batch, call_id: null });
  if (batch.done) break;
 }
 await core.finishSignalWorkspaceEmbeddingsV1({ database: f.database, lease }); return { lease, physicalInputs, calls };
}

test("prototypes prepare complete pre-import context with physical dedupe and receipt-backed aliases", { skip: !enabled, timeout: 60_000 }, async () => {
 const f = await fixture(); try {
  const plan = await f.plan(); assert.ok(Object.values(plan.texts).some(text => text.includes("FINAL_SIN_RECORTE")));
  assert.ok(plan.inputs.length > Object.keys(plan.texts).length, "roles and Topic identities share identical physical texts");
  const quoteBefore = await quote(f.scope); await assert.rejects(f.ask(false), /workspace_embedding_provider_unavailable/u);
  await assert.rejects(request({ ...f.scope, actor_user_id: f.viewer, idempotency_key: randomUUID(), plan_digest: quoteBefore.plan_digest,
   quote_digest: quoteBefore.quote_digest, hard_cap_micro_usd: quoteBefore.estimated_upper_micro_usd, provider_available: true, max_run_cost_micro_usd: 5_000_000 }), /workspace_embedding_forbidden/u);
  const requested = await f.ask(), result = await complete(f, await f.claim(requested.run_id));
  assert.equal(result.physicalInputs, Object.keys(plan.texts).length);
  const current = await status(f.scope); assert.equal(current.is_current, true); assert.equal(current.latest_completed?.counts.completed_topics, 2);
  assert.equal(current.latest_completed?.counts.processed_input_references, plan.topics.reduce((sum, topic) => sum + topic.input_digests.length, 0) + (plan.context_inputs?.length ?? 0));
  assert.equal(current.latest_completed?.counts.embedded_unique_inputs, result.physicalInputs);
  const row = (await f.query("SELECT preparation_run_id,input_revision,input_contract,cursor_asset_sha256 FROM signal_workspace_embedding_runs WHERE id=$1::uuid", [requested.run_id])).rows[0];
  assert.deepEqual(row, { preparation_run_id: null, input_revision: null, input_contract: "topic_prototypes", cursor_asset_sha256: null });
  assert.equal((await f.query("SELECT count(*)::int count FROM signal_topic_definition_embeddings WHERE workspace_id=$1::uuid AND source_embedding_call_id IS NOT NULL", [f.workspace_id])).rows[0].count, plan.inputs.length);
  for (const table of ["mentions", "signal_corpus_preparation_runs", "signal_corpus_preparation_items", "signal_topic_catalog_executions"]) {
   assert.equal((await f.query(`SELECT count(*)::int count FROM ${table} WHERE workspace_id=$1::uuid`, [f.workspace_id])).rows[0].count, 0, table);
  }
  const corpus = await corpusStatus({ queryable: f.database, workspace_id: f.workspace_id }); assert.equal(corpus.latest_completed, null);
  const cached = await quote(f.scope); assert.equal(cached.missing_unique_inputs, 0); assert.equal(cached.estimated_upper_micro_usd, 0);
  const reused = await f.ask(false), noTransport = await complete(f, await f.claim(reused.run_id));
  assert.equal(noTransport.calls, 0); assert.equal((await status(f.scope)).latest_completed?.counts.cache_hits, Object.keys(plan.texts).length);
 } finally { await f.cleanup(); }
});

test("prototype input and physical receipt seals reject fabricated authority and aliases", { skip: !enabled, timeout: 60_000 }, async () => {
 const f = await fixture(); try {
  const requested = await f.ask(), result = await complete(f, await f.claim(requested.run_id));
  await f.rejected("UPDATE signal_workspace_embedding_runs SET topic_input_digest=$2 WHERE id=$1::uuid", [requested.run_id, `sha256:${"0".repeat(64)}`], /immutable/u);
  await f.rejected("UPDATE signal_workspace_embedding_runs SET request_keys='{}' WHERE id=$1::uuid", [requested.run_id], /append-only/u);
  await f.rejected("UPDATE signal_workspace_embedding_runs SET input_contract='corpus' WHERE id=$1::uuid", [requested.run_id], /immutable/u);
  await f.rejected(`INSERT INTO signal_topic_definition_embeddings(workspace_id,definition_digest,embedding_model,provider,embedding,embedding_config_digest,input_text_sha256,source_embedding_call_id)
   SELECT workspace_id,$2,embedding_model,provider,$3::vector,embedding_config_digest,input_text_sha256,source_embedding_call_id
   FROM signal_topic_definition_embeddings WHERE workspace_id=$1::uuid LIMIT 1`, [f.workspace_id, `sha256:${"f".repeat(64)}`,
   `[${Array.from({ length: 1024 }, (_, i) => i === 1 ? 1 : 0).join(",")}]`], /settled physical embedding/u);
  await assert.rejects(core.readSignalWorkspaceEmbeddingBatchV1({ database: f.database, lease: { ...result.lease, input_contract: "corpus", cursor: null } }), /workspace_embedding_lease_lost/u);
 } finally { await f.cleanup(); }
});

test("prototype stale context retains sent cost but does not publish aliases or a checkpoint", { skip: !enabled, timeout: 60_000 }, async () => {
 for (const change of ["topic", "actor"] as const) { const f = await fixture(); try {
  const { lease, batch, call } = await f.begin(), answer = response(batch);
  await core.markSignalWorkspaceEmbeddingCallSentV1({ database: f.database, lease, call_id: call.call_id, attempt_token: call.attempt_token });
  if (change === "actor") await f.query("UPDATE users SET status='suspended' WHERE id=$1::uuid", [f.actor_user_id]);
  else await updateSignalTopicStoreV1({ pool: f.database, workspace_id: f.workspace_id, actor_user_id: f.actor_user_id,
   term_key: f.topics[0]!.term_key, idempotency_key: randomUUID(), input: { ...(await currentTopicDefinitionCasV1({pool: f.database,workspace_id: f.workspace_id,actor_user_id: f.actor_user_id,term_key: f.topics[0]!.term_key})), definition: "Nueva definición posterior al envío" } });
  await core.persistSignalWorkspaceEmbeddingResponseV1({ database: f.database, call_id: call.call_id, attempt_token: call.attempt_token, response: answer.raw });
  await assert.rejects(core.commitSignalWorkspaceEmbeddingBatchV1({ database: f.database, lease, batch, call_id: call.call_id, attempt_token: call.attempt_token, validated: answer.validated }),
   change === "actor" ? /workspace_embedding_forbidden/u : /workspace_embedding_inputs_changed/u);
  const receipt = (await f.query("SELECT status,settled_micro_usd FROM signal_workspace_embedding_calls WHERE id=$1::uuid", [call.call_id])).rows[0];
  assert.equal(receipt.status, "settled"); assert.ok(Number(receipt.settled_micro_usd) > 0);
  assert.equal((await f.query("SELECT count(*)::int count FROM signal_topic_definition_embeddings WHERE workspace_id=$1::uuid", [f.workspace_id])).rows[0].count, 0);
  assert.equal((await f.query("SELECT cursor_input_sha256 FROM signal_workspace_embedding_runs WHERE id=$1::uuid", [lease.run_id])).rows[0].cursor_input_sha256, null);
 } finally { await f.cleanup(); } }
});

test("full Topic context excludes wrong-owner, withdrawn, expired and future KB assertions", { skip: !enabled, timeout: 60_000 }, async () => {
 const f = await fixture(); try {
  const source = randomUUID(), foreignOrg = randomUUID();
  await f.query("INSERT INTO organizations(id,slug,legal_name,status) VALUES($1::uuid,$2,'Other fixture','active')", [foreignOrg, `other-${foreignOrg}`]);
  await f.query("INSERT INTO brand_knowledge_sources(id,brand_id,organization_id,source_kind,title,status) VALUES($1::uuid,$2::uuid,$3::uuid,'text','Local KB','processed')", [source, f.brand, f.organization]);
  const assertion = randomUUID();
  await f.query("INSERT INTO knowledge_assertions(id,knowledge_source_id,assertion_text,assertion_type,status) VALUES($1::uuid,$2::uuid,'KB_VIGENTE_ÍNTEGRA','fact','active')", [assertion, source]);
  const baseline = await f.plan(); assert.ok(Object.values(baseline.texts).some(text => text.includes("KB_VIGENTE_ÍNTEGRA")));
  for (const sql of ["UPDATE brand_knowledge_sources SET organization_id=$2::uuid WHERE id=$1::uuid",
   "UPDATE brand_knowledge_sources SET status='inactive' WHERE id=$1::uuid",
   "UPDATE knowledge_assertions SET valid_to=CURRENT_DATE-1 WHERE knowledge_source_id=$1::uuid",
   "UPDATE knowledge_assertions SET valid_from=CURRENT_DATE+1 WHERE knowledge_source_id=$1::uuid"]) {
   await f.query("BEGIN"); try { await f.query(sql, sql.includes("$2") ? [source, foreignOrg] : [source]);
    const changed = await f.plan(); assert.notEqual(changed.plan_digest, baseline.plan_digest);
    assert.ok(Object.values(changed.texts).every(text => !text.includes("KB_VIGENTE_ÍNTEGRA")));
   } finally { await f.query("ROLLBACK"); }
  }
  const { lease } = await f.begin();
  await f.query("UPDATE signal_corpus_preparation_input_state SET input_revision=input_revision+1 WHERE workspace_id=$1::uuid", [f.workspace_id]);
  assert.ok((await core.readSignalWorkspaceEmbeddingBatchV1({ database: f.database, lease })).items.length > 0, "corpus-only changes do not stale configured inputs");
  await f.query("UPDATE brand_knowledge_sources SET status='inactive' WHERE id=$1::uuid", [source]);
  await assert.rejects(core.readSignalWorkspaceEmbeddingBatchV1({ database: f.database, lease }), /workspace_embedding_inputs_changed/u);
 } finally { await f.cleanup(); }
});

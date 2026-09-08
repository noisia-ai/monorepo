import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";

import { createSignalTopicStoreV1, createSignalTopicCatalogExecutionStoreV1,
  loadSignalTopicCatalogStoreV1, updateSignalTopicStoreV1 } from "./signal-topic-catalog";
import { createSignalTopicInputSchemaV1 } from "@noisia/query-engine";

function catalogStore(corpora: Array<{ id: string; canonical_mentions: number; imported_mentions: number }>,
  hasProfile = false) {
  const queries: string[] = [];
  const queryable = { query: async (sql: string) => {
    queries.push(sql);
    if (sql.includes("SELECT membership.study_corpus_id::text id,")) return { rows: corpora };
    if (sql.includes("SELECT id::text,taxonomy_id::text,version,status")) return { rows: hasProfile
      ? [{ id: "profile", taxonomy_id: "taxonomy", version: 1, status: "draft" }] : [] };
    if (sql.includes("FROM signal_taxonomy_profiles") || sql.includes("FROM taxonomy_terms")
      || sql.includes("FROM signal_topic_catalog_executions")
      || sql.includes("FROM signal_topic_classification_suggestions")) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  } } as unknown as Pick<Pool, "query">;
  return { queries, queryable };
}

test("a brand without corpus loads a useful empty catalogue without embeddings or context queries", async () => {
  const store = catalogStore([]);
  const result = await loadSignalTopicCatalogStoreV1({ queryable: store.queryable, workspace_id: "workspace" });
  assert.deepEqual(result.readiness, { state: "awaiting_import", canonical_mentions: 0,
    operational_corpus_id: null, next_action: "import_mentions", reason_code: null });
  assert.deepEqual(result.topics, []);
  assert.equal(result.embedding_preflight.requires_paid_call, false);
  assert.equal(store.queries.some((sql) => /semantic_embeddings|brand_os_profiles/u.test(sql)), false);
});

test("having an empty operational corpus does not claim processing readiness", async () => {
  const store = catalogStore([{ id: "corpus", canonical_mentions: 0, imported_mentions: 0 }]);
  const result = await loadSignalTopicCatalogStoreV1({ queryable: store.queryable, workspace_id: "workspace" });
  assert.equal(result.readiness.state, "awaiting_import");
  assert.equal(result.readiness.operational_corpus_id, "corpus");
});

test("imported records awaiting canonicalization ask for preparation, never another upload", async () => {
  const store = catalogStore([{ id: "corpus", canonical_mentions: 0, imported_mentions: 4 }]);
  const result = await loadSignalTopicCatalogStoreV1({ queryable: store.queryable, workspace_id: "workspace" });
  assert.equal(result.readiness.state, "needs_preparation");
  assert.equal(result.readiness.next_action, "prepare_mentions");
});

test("ambiguous operational corpus mapping is not advertised as ready or guessed", async () => {
  const store = catalogStore([{ id: "a", canonical_mentions: 2, imported_mentions: 2 },
    { id: "b", canonical_mentions: 3, imported_mentions: 3 }]);
  const result = await loadSignalTopicCatalogStoreV1({ queryable: store.queryable, workspace_id: "workspace" });
  assert.equal(result.readiness.state, "needs_preparation");
  assert.equal(result.readiness.operational_corpus_id, null);
  assert.equal(result.readiness.canonical_mentions, 5);
});

test("catalogue writes and execution deny unauthorized DB actors before any mutation", async () => {
  for (const mode of ["create", "execute"] as const) {
    const queries: string[] = [];
    const query = async (sql: string) => { queries.push(sql); return { rows: [] }; };
    const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
    const args = { pool, workspace_id: "workspace", actor_user_id: "actor", idempotency_key: "request-key" };
    await assert.rejects(mode === "create"
      ? createSignalTopicStoreV1({ ...args, input: createSignalTopicInputSchemaV1.parse({ label: "Interest",
          definition: "A future monitoring interest" }) })
      : createSignalTopicCatalogExecutionStoreV1({ ...args, intent: "search" }),
    { code: "topic_catalog_forbidden", status: 403 });
    assert.equal(queries.some((sql) => /INSERT|UPDATE|DELETE/u.test(sql)), false);
    assert.equal(queries.at(-1), "ROLLBACK");
  }
});


function emptyBrandDraftStore() {
  const queries: string[] = [];
  const profiles: Array<Record<string, unknown>> = [];
  const terms: Array<Record<string, unknown>> = [];
  const operations: Array<Record<string, unknown>> = [];
  const query = async (sql: string, values: unknown[] = []) => {
    const q = sql.replace(/\s+/gu, " ").trim();
    queries.push(q);
    let rows: Array<Record<string, unknown>> = [];
    if (q.includes("workspace.status workspace_status")) rows = [{ workspace_status: "active",
      brand_status: "active", actor_status: "active", user_type: "client", primary_role: "client_admin",
      same_organization: true, brand_access_level: "comment" }];
    else if (q.startsWith("SELECT actor_user_id::text,action,request_digest")) rows = operations
      .filter((item) => item.key === values[1]);
    else if (q.startsWith("SELECT id::text,taxonomy_id::text,version,status")) rows = profiles.slice(-1);
    else if (q.startsWith("SELECT term.id::text,term.term_key")) rows = terms
      .filter((term) => term.taxonomy_id === profiles.find((p) => p.id === values[0])?.taxonomy_id);
    else if (q.startsWith("SELECT workspace.id::text AS workspace_id, brand.id::text")) rows = [{
      workspace_id: "workspace", brand_id: "brand", brand_name: "New brand", brand_slug: "new-brand",
      brand_handles: [], description: null, industry: null, industry_sub: null, countries: []
    }];
    else if (q.startsWith("SELECT COALESCE(MAX(version)")) rows = [{ version: profiles.length + 1 }];
    else if (q.startsWith("INSERT INTO taxonomies")) rows = [{ id: `taxonomy-${profiles.length + 1}` }];
    else if (q.startsWith("INSERT INTO taxonomy_terms")) terms.push({ id: `term-${terms.length + 1}`,
      taxonomy_id: values[0], term_key: values[1], label: values[2], description: values[3],
      metadata: JSON.parse(values[5] as string), status: values[6] });
    else if (q.startsWith("INSERT INTO tagging_rule_sets")) rows = [{ id: "rules" }];
    else if (q.startsWith("INSERT INTO tagging_model_versions")) rows = [{ id: "model" }];
    else if (q.startsWith("INSERT INTO signal_taxonomy_profiles")) {
      const profile = { id: `profile-${values[3]}`, taxonomy_id: values[1], version: values[3],
        status: "draft", context_hash: values[4] };
      profiles.push(profile); rows = [profile];
    } else if (q.startsWith("INSERT INTO signal_topic_catalog_operations")) operations.push({
      actor_user_id: values[1], action: values[2], key: values[3], request_digest: values[4],
      result_term_key: values[6], result_summary: JSON.parse(values[7] as string)
    });
    else if (/semantic_embeddings|signal_classification_watermark|INSERT INTO signal_topic_catalog_executions/u.test(q)) {
      throw new Error(`Draft preparation reached computation: ${q}`);
    } else if (!(q.startsWith("SELECT") || q.startsWith("WITH") || q.startsWith("UPDATE taxonomies")
      || q.startsWith("UPDATE signal_taxonomy_profiles") || q.startsWith("INSERT INTO lineage_edges")
      || ["BEGIN", "COMMIT", "ROLLBACK"].includes(q) || q.includes("SAVEPOINT"))) {
      throw new Error(`Unexpected query: ${q}`);
    }
    return { rows, rowCount: rows.length };
  };
  const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
  return { pool, profiles, terms, operations, queries };
}

test("a scoped client persists and edits an interest before any corpus exists, with replay safety", async () => {
  const store = emptyBrandDraftStore();
  const args = { pool: store.pool, workspace_id: "00000000-0000-4000-8000-000000000001", actor_user_id: "actor" };
  const input = createSignalTopicInputSchemaV1.parse({ label: "Delivery expectations",
    definition: "Conversations about expected delivery times", scope: "category" });
  const saved = await createSignalTopicStoreV1({ ...args, input, idempotency_key: "save-interest" });
  assert.equal(saved.topics.length, 1);
  assert.equal(saved.topics[0]!.scope, "category");
  assert.equal(saved.topics[0]!.status, "draft");
  assert.equal(saved.readiness.state, "awaiting_import");
  assert.equal(saved.embedding_preflight.requires_paid_call, false);
  assert.equal(saved.execution, null);
  const replay = await createSignalTopicStoreV1({ ...args, input, idempotency_key: "save-interest" });
  assert.equal(replay.replayed, true);
  assert.equal(store.profiles.length, 1);
  await assert.rejects(createSignalTopicStoreV1({ ...args, input: { ...input, label: "Different" },
    idempotency_key: "save-interest" }), { code: "topic_catalog_idempotency_conflict" });
  const edited = await updateSignalTopicStoreV1({ ...args, term_key: saved.term_key,
    idempotency_key: "edit-interest", input: { expected_definition_revision: 1,
      definition: "Conversations about deliveries arriving after the promised date" } });
  assert.equal(edited.topics[0]!.definition_revision, 2);
  assert.equal(edited.topics[0]!.scope, "category");
  assert.equal(edited.readiness.state, "awaiting_import");
  assert.equal(edited.embedding_preflight.requires_paid_call, false);
  const beforeConflict = store.profiles.length;
  await assert.rejects(updateSignalTopicStoreV1({ ...args, term_key: saved.term_key,
    idempotency_key: "stale-interest", input: { expected_definition_revision: 1, label: "Stale" } }),
  { code: "topic_revision_conflict" });
  assert.equal(store.profiles.length, beforeConflict);
  assert.equal(store.operations.length, 2);
});

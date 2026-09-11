import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";

import { createSignalTopicStoreV1, createSignalTopicCatalogExecutionStoreV1,
  loadSignalTopicCatalogStoreV1, updateSignalTopicStoreV1, setSignalTopicLifecycleStoreV1,
  adoptSignalTopicCandidateStoreV1 } from "./signal-topic-catalog";
import { createSignalTopicInputSchemaV1 } from "@noisia/query-engine";

function catalogStore(corpora: Array<{ id: string; canonical_mentions: number; imported_mentions: number }>,
  hasProfile = false, receivedRecords = 0) {
  const queries: string[] = [];
  const queryable = { query: async (sql: string) => {
    queries.push(sql);
    if (sql.includes("SELECT membership.study_corpus_id::text id,")) return { rows: corpora };
    if (sql.includes("FROM import_batches batch") && sql.includes("has_received_import")) return {
      rows: [{ has_received_import: receivedRecords > 0 }]
    };
    if (sql.includes("SELECT id::text,taxonomy_id::text,version,status")) return { rows: hasProfile
      ? [{ id: "profile", taxonomy_id: "taxonomy", version: 1, status: "draft" }] : [] };
    if (sql.includes("FROM signal_taxonomy_profiles") || sql.includes("FROM taxonomy_terms")
      || sql.includes("FROM signal_topic_catalog_executions")
      || sql.includes("FROM signal_classification_generations")
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

test("completed uploads without an operational corpus ask for preparation instead of another upload", async () => {
  for (const corpora of [[], [{ id: "corpus", canonical_mentions: 0, imported_mentions: 0 }]]) {
    const store = catalogStore(corpora, false, 904);
    const result = await loadSignalTopicCatalogStoreV1({ queryable: store.queryable, workspace_id: "workspace" });
    assert.equal(result.readiness.state, "needs_preparation");
    assert.equal(result.readiness.next_action, "prepare_mentions");
    assert.equal(result.readiness.canonical_mentions, 0);
    assert.equal(result.embedding_preflight.requires_paid_call, false);
  }
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
  const authority = { workspace_status: "active", brand_status: "active", actor_status: "active",
    user_type: "client", primary_role: "client_admin", same_organization: true, brand_access_level: "comment",
    organization_status: "active", brand_same_organization: true };
  const controls = { readySearch: false, busy: false, afterLock: () => {} };
  const referencedProfiles = new Set<string>();
  const query = async (sql: string, values: unknown[] = []) => {
    const q = sql.replace(/\s+/gu, " ").trim();
    queries.push(q);
    let rows: Array<Record<string, unknown>> = [];
    if (q.includes("workspace.status workspace_status")) rows = [{ ...authority }];
    else if (q.startsWith("SELECT pg_advisory_xact_lock")) controls.afterLock();
    else if (q.startsWith("SELECT actor_user_id::text,action,request_digest")) rows = operations
      .filter((item) => item.key === values[1]);
    else if (q.startsWith("SELECT id::text,taxonomy_id::text,version,status")) rows = values[1]
      ? profiles.filter(p => p.id === values[1]) : [...profiles].reverse();
    else if (q.startsWith("SELECT id::text,context_hash FROM signal_taxonomy_profiles")) rows = profiles.filter(p => p.status === "active").slice(-1);
    else if (q.startsWith("SELECT EXISTS(SELECT 1 FROM signal_topic_catalog_executions") && q.includes(" available")) rows = [{ available: controls.readySearch }];
    else if (q.startsWith("SELECT EXISTS(SELECT 1 FROM signal_topic_catalog_executions") && q.includes(" busy")) rows = [{ busy: controls.busy }];
    else if (q.startsWith("SELECT EXISTS(SELECT 1 FROM signal_taxonomy_profiles")) rows = [{ active: profiles.some(p => p.status === "active") }];
    else if (q.includes(" AS preserve_profile")) rows = [{ preserve_profile: referencedProfiles.has(String(values[1])) }];
    else if (q.startsWith("UPDATE signal_taxonomy_profiles SET status='retired'")) {
      const prior = profiles.find(p => p.id === values[0]); if (prior) prior.status = "retired";
    }
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
        status: "draft", context_hash: values[4],
        catalog_role: JSON.parse(values[7] as string).catalog_role ?? null,
        source_catalog_profile_id: JSON.parse(values[7] as string).source_catalog_profile_id ?? null };
      profiles.push(profile); rows = [profile];
    } else if (q.startsWith("INSERT INTO signal_topic_catalog_operations")) operations.push({
      actor_user_id: values[1], action: values[2], key: values[3], request_digest: values[4],
      result_profile_id: values[5], result_term_key: values[6], result_summary: JSON.parse(values[7] as string)
    });
    else if (q.startsWith("SELECT term.label title,")) rows = [{ title: "Candidate", description: "Evidence-based candidate",
      context_hash: "source-digest", metadata: { scope: "primary_brand" } }];
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
  return { pool, profiles, terms, operations, queries, authority, controls, referencedProfiles };
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
      expected_definition_digest: saved.topics[0]!.definition_digest,
      definition: "Conversations about deliveries arriving after the promised date" } });
  assert.equal(edited.topics[0]!.definition_revision, 2);
  assert.equal(edited.topics[0]!.scope, "category");
  assert.equal(edited.readiness.state, "awaiting_import");
  assert.equal(edited.embedding_preflight.requires_paid_call, false);
  const beforeConflict = store.profiles.length;
  await assert.rejects(updateSignalTopicStoreV1({ ...args, term_key: saved.term_key,
    idempotency_key: "stale-interest", input: { expected_definition_revision: 1,
      expected_definition_digest: saved.topics[0]!.definition_digest, label: "Stale" } }),
  { code: "topic_revision_conflict" });
  assert.equal(store.profiles.length, beforeConflict);
  assert.equal(store.operations.length, 2);
});

test("client edits an active catalog without executing, and replay returns its exact historical profile", async () => {
  const store = emptyBrandDraftStore();
  const args = { pool: store.pool, workspace_id: "00000000-0000-4000-8000-000000000001", actor_user_id: "actor" };
  const input = createSignalTopicInputSchemaV1.parse({ label: "Service", definition: "Service expectations" });
  const created = await createSignalTopicStoreV1({ ...args, input, idempotency_key: "initial-topic" });
  store.profiles[0]!.status = "active"; store.controls.readySearch = true; store.controls.busy = true;
  const first = created.topics[0]!;
  const cas = { expected_definition_revision: first.definition_revision, expected_definition_digest: first.definition_digest };
  const rename = { ...args, term_key: first.term_key, idempotency_key: "rename-topic", input: { ...cas, label: "Servicio" } };
  const renamed = await updateSignalTopicStoreV1(rename);
  assert.equal(renamed.semantic_changed, false);
  assert.equal(renamed.topics[0]!.definition_revision, first.definition_revision + 1);
  assert.equal(renamed.topics[0]!.definition_digest, first.definition_digest);
  const renamedCas = { expected_definition_revision: renamed.topics[0]!.definition_revision,
    expected_definition_digest: renamed.topics[0]!.definition_digest };
  await assert.rejects(updateSignalTopicStoreV1({ ...rename, idempotency_key: "concurrent-stale-rename",
    input: { ...cas, label: "A stale overwrite" } }), { code: "topic_revision_conflict" });
  assert.equal(renamed.reused_search_execution_id, null);
  assert.equal(renamed.serving_profile_id, created.profile!.id);
  assert.equal(renamed.working_profile_id, renamed.profile!.id);
  assert.equal(renamed.requires_recompute, true);
  await assert.rejects(updateSignalTopicStoreV1({ ...rename, idempotency_key: "wrong-digest",
    input: { ...rename.input, ...renamedCas, expected_definition_digest: `sha256:${"f".repeat(64)}` } }), { code: "topic_revision_conflict" });
  const archived = await setSignalTopicLifecycleStoreV1({ ...args, ...renamedCas, term_key: first.term_key,
    idempotency_key: "archive-topic", lifecycle: "archived" });
  assert.equal(archived.requires_recompute, true);
  assert.equal(archived.topics[0]!.status, "archived");
  const revision = archived.topics[0]!.definition_revision;
  const replay = await updateSignalTopicStoreV1(rename);
  assert.equal(replay.replayed, true); assert.equal(replay.profile!.id, renamed.profile!.id);
  assert.equal(replay.topics[0]!.lifecycle, "draft");
  const count = store.operations.length;
  await assert.rejects(setSignalTopicLifecycleStoreV1({ ...args, ...cas, term_key: first.term_key,
    idempotency_key: "stale-restore", lifecycle: "draft" }), { code: "topic_revision_conflict" });
  await assert.rejects(setSignalTopicLifecycleStoreV1({ ...args, ...cas, expected_definition_revision: revision,
    term_key: first.term_key, idempotency_key: "archive-topic", lifecycle: "archived" }),
  { code: "topic_catalog_idempotency_conflict" });
  const restored = await setSignalTopicLifecycleStoreV1({ ...args, term_key: first.term_key,
    idempotency_key: "restore-topic", lifecycle: "draft", expected_definition_revision: revision,
    expected_definition_digest: archived.topics[0]!.definition_digest });
  assert.equal(restored.topics[0]!.definition_revision, revision + 1);
  assert.equal(store.operations.length, count + 1);
  const another = await createSignalTopicStoreV1({ ...args, idempotency_key: "second-active-topic",
    input: { ...input, label: "Delivery", definition: "Delivery expectations" } });
  assert.equal(another.topics.length, 2);
  assert.equal(store.profiles[0]!.status, "active");
  assert.equal(store.queries.some(q => /(?:INSERT INTO|UPDATE|DELETE FROM) (?:signal_.*executions|.*outbox|.*cost|semantic_embeddings)|prepare_signal_topic_catalog_profile_v1/u.test(q)), false);
});

test("mutations and accepted replays revalidate live role, tenant and grant after the advisory lock", async () => {
  for (const revoked of ["grant", "actor", "role", "organization", "tenant"] as const) {
    const store = emptyBrandDraftStore();
    const args = { pool: store.pool, workspace_id: "00000000-0000-4000-8000-000000000001", actor_user_id: "actor", idempotency_key: "same-request",
      input: createSignalTopicInputSchemaV1.parse({ label: "Service", definition: "Service expectations" }) };
    await createSignalTopicStoreV1(args);
    store.controls.afterLock = () => {
      if (revoked === "grant") store.authority.brand_access_level = "read";
      if (revoked === "actor") store.authority.actor_status = "inactive";
      if (revoked === "role") store.authority.primary_role = "client_owner";
      if (revoked === "organization") store.authority.organization_status = "inactive";
      if (revoked === "tenant") store.authority.brand_same_organization = false;
    };
    const start = store.queries.length;
    await assert.rejects(createSignalTopicStoreV1(args), { code: "topic_catalog_forbidden", status: 403 });
    assert.equal(store.operations.length, 1);
    const attempted = store.queries.slice(start);
    assert.equal(attempted.some(q => q.includes("FROM signal_topic_catalog_operations")), false);
    assert.equal(attempted.some(q => q.includes("FOR SHARE OF actor,organization,brand,workspace")), true);
    assert.equal(attempted.some(q => q.includes("FOR SHARE OF access")), true);
    assert.equal(attempted.at(-1), "ROLLBACK");
  }
});

test("adoption rechecks its stronger capability after waiting for the taxonomy lock", async () => {
  const store = emptyBrandDraftStore();
  Object.assign(store.authority, { user_type: "noisia_internal", primary_role: "analyst" });
  store.controls.afterLock = () => Object.assign(store.authority, { user_type: "client", primary_role: "client_admin" });
  await assert.rejects(adoptSignalTopicCandidateStoreV1({ pool: store.pool, workspace_id: "00000000-0000-4000-8000-000000000001",
    actor_user_id: "actor", idempotency_key: "adopt-request",
    input: { run_key: "taxonomy-profile:legacy", candidate_key: "candidate" } }),
  { code: "topic_catalog_forbidden", status: 403 });
  assert.equal(store.operations.length, 0); assert.equal(store.profiles.length, 0);
});

test("working head follows exact materialization lineage and ignores an unrelated newer derived catalog", async () => {
  const store = emptyBrandDraftStore();
  const args = { pool: store.pool, workspace_id: "00000000-0000-4000-8000-000000000001", actor_user_id: "actor" };
  const a = await createSignalTopicStoreV1({ ...args, idempotency_key: "create-head-a",
    input: createSignalTopicInputSchemaV1.parse({ label: "A", definition: "Original meaning" }) });
  const b = await updateSignalTopicStoreV1({ ...args, term_key: a.term_key, idempotency_key: "create-head-b",
    input: { definition: "Pending meaning", expected_definition_revision: a.topics[0]!.definition_revision,
      expected_definition_digest: a.topics[0]!.definition_digest } });
  function derived(source: string, role = "incremental", id = `profile-${store.profiles.length + 1}`) {
    const profile = { ...store.profiles[0], id, taxonomy_id: id, version: store.profiles.length + 1,
      catalog_role: role, source_catalog_profile_id: source };
    store.profiles.push(profile); return id;
  }
  const c = derived(a.profile!.id);
  const read = () => loadSignalTopicCatalogStoreV1({ queryable: store.pool, workspace_id: args.workspace_id });
  assert.equal((await read()).working_profile_id, b.profile!.id);
  const d = derived(b.profile!.id, "analysis_materialized");
  assert.equal((await read()).working_profile_id, d);
  const e = derived(d);
  assert.equal((await read()).working_profile_id, e);
  derived("another-workspace-profile");
  derived(c); // The branch derived from A still cannot replace the human B chain.
  assert.equal((await read()).working_profile_id, e);
  // The same lineage can bootstrap from a pre-contract catalog without a role.
  store.profiles.splice(1);
  store.profiles[0]!.catalog_role = null;
  const legacyChild = derived(a.profile!.id);
  assert.equal((await read()).working_profile_id, legacyChild);
});

test("exact catalog replay fails closed if its profile is absent from the workspace", async () => {
  const store = emptyBrandDraftStore();
  await assert.rejects(loadSignalTopicCatalogStoreV1({ queryable: store.pool, workspace_id: "workspace",
    taxonomy_profile_id: "foreign-profile" }), { code: "topic_profile_not_found", status: 404 });
  assert.ok(store.queries.some(q => q.includes("workspace_id=$1::uuid AND id=$2::uuid")));
});

test("adoption duplicate and receipt replay both stay under the live capability lock", async () => {
  const store = emptyBrandDraftStore();
  Object.assign(store.authority, { user_type: "noisia_internal", primary_role: "analyst" });
  const args = { pool: store.pool, workspace_id: "00000000-0000-4000-8000-000000000001", actor_user_id: "actor",
    idempotency_key: "adopt-original", input: { run_key: "taxonomy-profile:legacy", candidate_key: "candidate" } };
  const first = await adoptSignalTopicCandidateStoreV1(args);
  const replayStart = store.queries.length;
  const replay = await adoptSignalTopicCandidateStoreV1(args);
  assert.equal(replay.replayed, true); assert.equal(replay.profile!.id, first.profile!.id);
  assert.equal(store.queries.slice(replayStart).some(q => q.startsWith("SELECT term.label title,")), false);
  store.controls.busy = true; store.controls.readySearch = true;
  const duplicate = await adoptSignalTopicCandidateStoreV1({ ...args, idempotency_key: "adopt-existing-topic" });
  assert.equal(duplicate.reused, true); assert.equal(duplicate.reused_search_execution_id, null);
  assert.equal(duplicate.topics.length, 1);
  assert.equal(store.queries.some(q => /INSERT INTO signal_topic_catalog_executions|prepare_signal_topic_catalog_profile_v1/u.test(q)), false);
  await assert.rejects(adoptSignalTopicCandidateStoreV1({ ...args,
    input: { ...args.input, candidate_key: "other-candidate" } }), { code: "topic_catalog_idempotency_conflict" });
  store.controls.afterLock = () => Object.assign(store.authority, { user_type: "client", primary_role: "client_admin" });
  const start = store.queries.length;
  await assert.rejects(adoptSignalTopicCandidateStoreV1({ ...args, idempotency_key: "adopt-duplicate" }),
    { code: "topic_catalog_forbidden", status: 403 });
  assert.equal(store.queries.slice(start).some(q => q.startsWith("SELECT term.label title,")), false);
  assert.equal(store.operations.length, 2);
});

test("native serving profile comes from its ready generation, not a newer working version", async () => {
  const store = emptyBrandDraftStore();
  const args = { pool: store.pool, workspace_id: "00000000-0000-4000-8000-000000000001", actor_user_id: "actor" };
  const saved = await createSignalTopicStoreV1({ ...args, idempotency_key: "native-working",
    input: createSignalTopicInputSchemaV1.parse({ label: "Interest", definition: "An edited interest" }) });
  const queryable = { query: async (sql: string, values?: unknown[]) => {
    if (sql.includes("FROM signal_classification_generations generation")) {
      assert.match(sql, /execution\.generation_id=generation\.id/u);
      assert.match(sql, /profile\.id=generation\.taxonomy_profile_id/u);
      assert.match(sql, /profile\.workspace_id=generation\.workspace_id/u);
      assert.match(sql, /execution\.status='ready'/u);
      assert.deepEqual(values, [args.workspace_id]);
      return { rows: [{ id: "native-serving-profile", context_hash: saved.profile!.context_hash }] };
    }
    return store.pool.query(sql, values);
  } } as unknown as Pick<Pool, "query">;
  const result = await loadSignalTopicCatalogStoreV1({ queryable, workspace_id: args.workspace_id });
  assert.equal(result.working_profile_id, saved.profile!.id);
  assert.equal(result.serving_profile_id, "native-serving-profile");
  assert.equal(result.requires_recompute, true);
  assert.equal(result.active_profile_id, null);
});

test("an editorial no-op records its receipt without creating a catalog version or pending recompute", async () => {
  const store = emptyBrandDraftStore();
  const args = { pool: store.pool, workspace_id: "00000000-0000-4000-8000-000000000001", actor_user_id: "actor" };
  const created = await createSignalTopicStoreV1({ ...args, idempotency_key: "noop-source",
    input: createSignalTopicInputSchemaV1.parse({ label: "Stable name", definition: "Stable definition" }) });
  store.profiles[0]!.status = "active";
  const topic = created.topics[0]!;
  const input = { label: topic.label, definition: topic.definition,
    expected_definition_revision: topic.definition_revision, expected_definition_digest: topic.definition_digest };
  const start = store.queries.length;
  const unchanged = await updateSignalTopicStoreV1({ ...args, term_key: topic.term_key, input, idempotency_key: "noop-update" });
  assert.equal(unchanged.profile!.id, created.profile!.id);
  assert.equal(unchanged.topics[0]!.definition_revision, topic.definition_revision);
  assert.equal(unchanged.topics[0]!.updated_at, topic.updated_at);
  assert.equal(unchanged.requires_recompute, false);
  assert.equal(unchanged.semantic_changed, false);
  const replay = await updateSignalTopicStoreV1({ ...args, term_key: topic.term_key, input, idempotency_key: "noop-update" });
  assert.equal(replay.replayed, true); assert.equal(replay.result_profile_id, unchanged.profile!.id);
  const lifecycle = await setSignalTopicLifecycleStoreV1({ ...args, term_key: topic.term_key, lifecycle: "draft",
    expected_definition_revision: topic.definition_revision, expected_definition_digest: topic.definition_digest,
    idempotency_key: "noop-restore" });
  assert.equal(lifecycle.result_profile_id, created.profile!.id);
  assert.equal(lifecycle.requires_recompute, false);
  assert.equal(store.profiles.length, 1); assert.equal(store.operations.length, 3);
  assert.equal(store.queries.slice(start).some(q => /INSERT INTO (?:taxonomies|taxonomy_terms|signal_taxonomy_profiles)|UPDATE (?:signal_taxonomy_profiles|taxonomies)/u.test(q)), false);
});

test("a draft profile retained by execution, serving generation or materialization is not retired by a new edit", async () => {
  for (const retained of [false, true]) {
    const store = emptyBrandDraftStore();
    const args = { pool: store.pool, workspace_id: "00000000-0000-4000-8000-000000000001", actor_user_id: "actor" };
    const a = await createSignalTopicStoreV1({ ...args, idempotency_key: "retained-a",
      input: createSignalTopicInputSchemaV1.parse({ label: "A", definition: "A still serves" }) });
    if (retained) store.referencedProfiles.add(a.profile!.id);
    const start = store.queries.length;
    const b = await updateSignalTopicStoreV1({ ...args, idempotency_key: "working-b", term_key: a.term_key,
      input: { label: "B is pending", expected_definition_revision: a.topics[0]!.definition_revision,
        expected_definition_digest: a.topics[0]!.definition_digest } });
    assert.notEqual(b.profile!.id, a.profile!.id);
    assert.equal(b.profile!.status, "draft");
    assert.equal(store.profiles[0]!.status, retained ? "draft" : "retired");
    const writes = store.queries.slice(start);
    assert.equal(writes.some(q => q.startsWith("UPDATE taxonomies SET status='retired'")), !retained);
    assert.equal(writes.some(q => /INSERT INTO signal_topic_catalog_executions|INSERT INTO .*outbox/u.test(q)), false);
    if (retained) {
      const guard = writes.find(q => q.includes(" AS preserve_profile"))!;
      assert.match(guard, /execution\.workspace_id=\$1::uuid AND execution\.taxonomy_profile_id=\$2::uuid/u);
      assert.match(guard, /generation\.workspace_id=\$1::uuid AND generation\.taxonomy_profile_id=\$2::uuid/u);
      assert.match(guard, /owner\.workspace_id=profile\.workspace_id/u);
      assert.match(guard, /source_engine_execution_id/u); assert.match(guard, /source_numeric_execution_id/u);
      assert.match(guard, /profile\.workspace_id=\$1::uuid AND profile\.id=\$2::uuid/u);
    }
  }
});

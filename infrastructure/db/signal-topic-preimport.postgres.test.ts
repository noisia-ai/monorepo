import {currentTopicDefinitionCasV1} from './migrations/signal-topic-definition-cas.fixture';
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import { createSignalTopicInputSchemaV1 } from "@noisia/query-engine";
import { createSignalTopicCatalogExecutionStoreV1, createSignalTopicStoreV1,
  loadSignalTopicCatalogStoreV1, setSignalTopicLifecycleStoreV1,
  updateSignalTopicStoreV1 } from "./signal-topic-catalog";
import { loadSignalWorkspaceCapabilitiesStoreV1 } from "./signal-workspace-capabilities";

test("PostgreSQL: a new brand saves interests before imports with scoped authority and no provider work", {
  skip: process.env.NOISIA_TOPICS_PREIMPORT_TEST_APPROVED !== "true", timeout: 60_000
}, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.ok(url.pathname.startsWith("/noisia_manual_import_test_"));
  const pool = new Pool({ connectionString: url.toString(), max: 4 });
  const organizationId = randomUUID(), otherOrganizationId = randomUUID();
  const brandId = randomUUID(), actorId = randomUUID(), viewerId = randomUUID(), foreignId = randomUUID();
  const suffix = randomUUID();
  try {
    await pool.query(`INSERT INTO organizations(id,slug,legal_name,status) VALUES
      ($1::uuid,$2,'Topics test','active'),($3::uuid,$4,'Other organization test','active')`,
    [organizationId, `topics-${suffix}`, otherOrganizationId, `other-topics-${suffix}`]);
    await pool.query(`INSERT INTO brands(id,organization_id,slug,name,status)
      VALUES($1::uuid,$2::uuid,$3,'Topics pre-import test','active')`, [brandId, organizationId, `topics-${suffix}`]);
    const workspaceId = (await pool.query<{ id: string }>(
      "SELECT id::text FROM signal_workspaces WHERE brand_id=$1::uuid AND organization_id=$2::uuid",
      [brandId, organizationId])).rows[0]!.id;
    await pool.query(`INSERT INTO users(id,email,user_type,primary_role,organization_id,status) VALUES
      ($1::uuid,$2,'client','client_admin',$3::uuid,'active'),
      ($4::uuid,$5,'client','client_viewer',$3::uuid,'active'),
      ($6::uuid,$7,'client','client_admin',$8::uuid,'active')`,
    [actorId, `editor-${suffix}@example.test`, organizationId, viewerId, `viewer-${suffix}@example.test`,
      foreignId, `foreign-${suffix}@example.test`, otherOrganizationId]);
    await pool.query(`INSERT INTO user_brand_access(user_id,brand_id,access_level) VALUES
      ($1::uuid,$2::uuid,'comment'),($3::uuid,$2::uuid,'admin'),($4::uuid,$2::uuid,'comment')`,
    [actorId, brandId, viewerId, foreignId]);
    const capabilities = await loadSignalWorkspaceCapabilitiesStoreV1({ queryable: pool,
      workspace_id: workspaceId, actor_user_id: actorId });
    assert.equal(capabilities.can_edit_topics, true);
    assert.equal(capabilities.can_execute_topics, false);
    const empty = await loadSignalTopicCatalogStoreV1({ queryable: pool, workspace_id: workspaceId });
    assert.equal(empty.readiness.operational_corpus_id, null);
    assert.equal(empty.readiness.state, "awaiting_import");
    const args = { pool, workspace_id: workspaceId, actor_user_id: actorId };
    const input = createSignalTopicInputSchemaV1.parse({ label: "Late delivery",
      definition: "Conversations about delivery after the promised date", scope: "category" });
    const created = await createSignalTopicStoreV1({ ...args, input, idempotency_key: "preimport-create" });
    assert.equal(created.topics.length, 1);
    assert.equal(created.topics[0]!.scope, "category");
    assert.equal(created.topics[0]!.origin, "manual");
    assert.equal(created.readiness.state, "awaiting_import");
    assert.equal(created.embedding_preflight.requires_paid_call, false);
    assert.equal((await createSignalTopicStoreV1({ ...args, input, idempotency_key: "preimport-create" })).replayed, true);
    const edited = await updateSignalTopicStoreV1({ ...args, term_key: created.term_key,
      idempotency_key: "preimport-edit", input: { ...(await currentTopicDefinitionCasV1({...args,term_key: created.term_key})),
        definition: "Packages that arrived after the promised delivery date", scope: "competitor" } });
    assert.equal(edited.topics[0]!.definition_revision, 2);
    assert.equal(edited.topics[0]!.scope, "competitor");
    assert.equal(edited.execution, null);
    const concurrent = await Promise.allSettled(["one", "two"].map((meaning) => updateSignalTopicStoreV1({
      ...args, term_key: created.term_key, idempotency_key: `preimport-concurrent-${meaning}`,
      input: { expected_definition_revision:edited.topics[0]!.definition_revision,expected_definition_digest:edited.topics[0]!.definition_digest, definition: `Delivery expectation ${meaning}` }
    })));
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = concurrent.find((result) => result.status === "rejected");
    assert.equal(rejected?.status === "rejected" && rejected.reason.code, "topic_revision_conflict");
    const archived = await setSignalTopicLifecycleStoreV1({ ...args, term_key: created.term_key,
      idempotency_key: "preimport-archive", lifecycle: "archived" ,...(await currentTopicDefinitionCasV1({...args,term_key: created.term_key}))});
    assert.equal(archived.topics[0]!.status, "archived");
    const restored = await setSignalTopicLifecycleStoreV1({ ...args, term_key: created.term_key,
      idempotency_key: "preimport-restore", lifecycle: "draft" ,...(await currentTopicDefinitionCasV1({...args,term_key: created.term_key}))});
    assert.equal(restored.topics[0]!.status, "draft");
    for (const actor_user_id of [viewerId, foreignId]) await assert.rejects(
      createSignalTopicStoreV1({ ...args, actor_user_id, input, idempotency_key: `denied-${actor_user_id}` }),
      { code: "topic_catalog_forbidden", status: 403 });
    await assert.rejects(createSignalTopicCatalogExecutionStoreV1({ ...args, intent: "search",
      idempotency_key: "client-cannot-execute" }), { code: "topic_catalog_forbidden", status: 403 });
    await pool.query("UPDATE user_brand_access SET revoked_at=now() WHERE user_id=$1::uuid AND brand_id=$2::uuid",
      [actorId, brandId]);
    await assert.rejects(createSignalTopicStoreV1({ ...args, input, idempotency_key: "revoked-create" }),
      { code: "topic_catalog_forbidden", status: 403 });
    await pool.query("UPDATE user_brand_access SET revoked_at=NULL WHERE user_id=$1::uuid AND brand_id=$2::uuid",
      [actorId, brandId]);
    await pool.query("UPDATE users SET status='suspended' WHERE id=$1::uuid", [actorId]);
    await assert.rejects(createSignalTopicStoreV1({ ...args, input, idempotency_key: "suspended-create" }),
      { code: "topic_catalog_forbidden", status: 403 });
    for (const table of ["mentions", "signal_topic_catalog_executions", "signal_topic_definition_embeddings",
      "signal_topic_embedding_calls", "signal_topic_classification_outbox"]) {
      const result = await pool.query<{ count: number }>(`SELECT count(*)::int count FROM ${table} WHERE workspace_id=$1::uuid`, [workspaceId]);
      assert.equal(result.rows[0]!.count, 0, table);
    }
  } finally { await pool.end(); }
});

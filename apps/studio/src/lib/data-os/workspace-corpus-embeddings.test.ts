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

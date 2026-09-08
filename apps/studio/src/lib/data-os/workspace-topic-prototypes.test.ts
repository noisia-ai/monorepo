import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { loadWorkspaceTopicPrototypesForActorV1, quoteWorkspaceTopicPrototypesForActorV1,
  requestWorkspaceTopicPrototypesForActorV1, validateWorkspaceTopicPrototypeRequestV1 } from "./workspace-topic-prototypes";
import { WorkspaceCorpusEmbeddingsError } from "./workspace-corpus-embeddings";
const granted = { workspace_status: "active", brand_status: "active", actor_status: "active", user_type: "client",
  primary_role: "client_admin", same_organization: true, brand_access_level: "admin" };
const body = { plan_digest: `sha256:${"a".repeat(64)}`, quote_digest: `sha256:${"b".repeat(64)}`, hard_cap_micro_usd: 0 };
function authorityDatabase(authority: unknown) {
  let calls = 0;
  return { async query(_sql: string, params: unknown[]) {
    calls++; assert.equal(calls, 1, "Denied actors cannot read private definitions/context, quote or enqueue.");
    assert.deepEqual(params, ["workspace", "actor"]); return { rows: authority ? [authority] : [] };
  }, async connect() { throw new Error("Denied before transaction"); } } as unknown as Pick<Pool, "query" | "connect">;
}
test("prototype status/quote/request enforce workspace and actor authority before any context or monetary read", async () => {
  for (const authority of [null, { ...granted, same_organization: false }, { ...granted, actor_status: "suspended" },
    { ...granted, brand_access_level: null }, { ...granted, workspace_status: "archived" }, { ...granted, brand_status: "archived" }]) {
    for (const operation of ["load", "quote", "request"]) {
      const args = { database: authorityDatabase(authority), workspaceId: "workspace", actorUserId: "actor" };
      await assert.rejects(operation === "load" ? loadWorkspaceTopicPrototypesForActorV1(args)
        : operation === "quote" ? quoteWorkspaceTopicPrototypesForActorV1(args)
          : requestWorkspaceTopicPrototypesForActorV1({ ...args, idempotencyKey: "prototype-request", body }),
      (error: unknown) => error instanceof WorkspaceCorpusEmbeddingsError && error.status === 403);
    }
  }
});
test("import-capable client cannot enable external preparation, including with a zero cap", async () => {
  await assert.rejects(requestWorkspaceTopicPrototypesForActorV1({ database: authorityDatabase(granted), workspaceId: "workspace",
    actorUserId: "actor", idempotencyKey: "prototype-request", body }),
  (error: unknown) => error instanceof WorkspaceCorpusEmbeddingsError && error.status === 403);
});
test("prototype request accepts only server quote/plan identity and an integer cap, never client transport or text", () => {
  assert.equal(validateWorkspaceTopicPrototypeRequestV1(body), true);
  for (const value of [null, [], {}, { ...body, provider_available: true }, { ...body, actor_user_id: "other" },
    { ...body, profile: "query" }, { ...body, texts: ["unscoped text"] }, { ...body, publish: true },
    { ...body, hard_cap_micro_usd: "0" }, { ...body, hard_cap_micro_usd: -1 }, { ...body, hard_cap_micro_usd: 0.1 },
    { ...body, hard_cap_micro_usd: NaN }, { ...body, hard_cap_micro_usd: Number.MAX_SAFE_INTEGER + 1 },
    { ...body, plan_digest: "bad" }, { ...body, quote_digest: "bad" }]) assert.equal(validateWorkspaceTopicPrototypeRequestV1(value), false);
});

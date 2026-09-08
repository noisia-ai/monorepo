import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";

import {
  loadWorkspaceCorpusPreparationForActorV1,
  requestWorkspaceCorpusPreparationForActorV1,
  validateCorpusPreparationRequestV1,
  WorkspaceCorpusPreparationError
} from "./workspace-corpus-preparation";

const granted = {
  workspace_status: "active", brand_status: "active", actor_status: "active",
  user_type: "client", primary_role: "client_admin", same_organization: true,
  brand_access_level: "comment"
};

function deniedDatabase(authority: unknown) {
  let calls = 0;
  const database = {
    async query(_sql: string, params: unknown[]) {
      calls++;
      assert.equal(calls, 1, "No private preparation data is read or mutated after denied access.");
      assert.deepEqual(params, ["requested-workspace", "current-actor"]);
      return { rows: authority ? [authority] : [] };
    },
    async connect() { throw new Error("A denied actor must not start a mutation transaction."); }
  } as unknown as Pick<Pool, "query" | "connect">;
  return { database, count: () => calls };
}

test("preparation reads and requests deny revoked, cross-tenant and inactive authorities before store access", async () => {
  for (const authority of [null, { ...granted, same_organization: false },
    { ...granted, actor_status: "suspended" }, { ...granted, brand_access_level: null },
    { ...granted, brand_status: "archived" }, { ...granted, workspace_status: "archived" }]) {
    for (const mutate of [false, true]) {
      const blocked = deniedDatabase(authority);
      const args = { database: blocked.database, workspaceId: "requested-workspace", actorUserId: "current-actor" };
      await assert.rejects(mutate
        ? requestWorkspaceCorpusPreparationForActorV1({ ...args, idempotencyKey: "request-1234" })
        : loadWorkspaceCorpusPreparationForActorV1(args),
      (error: unknown) => error instanceof WorkspaceCorpusPreparationError && error.status === 403);
      assert.equal(blocked.count(), 1);
    }
  }
});

test("read grants do not authorize preparation or queue writes", async () => {
  for (const authority of [{ ...granted, brand_access_level: "read" },
    { ...granted, primary_role: "client_viewer", brand_access_level: "admin" }]) {
    const blocked = deniedDatabase(authority);
    await assert.rejects(requestWorkspaceCorpusPreparationForActorV1({
      database: blocked.database, workspaceId: "requested-workspace", actorUserId: "current-actor",
      idempotencyKey: "request-1234"
    }), (error: unknown) => error instanceof WorkspaceCorpusPreparationError && error.status === 403);
    assert.equal(blocked.count(), 1);
  }
});

test("preparation requests cannot provide actor, population, provider, or publication authority", () => {
  assert.equal(validateCorpusPreparationRequestV1({}), true);
  for (const value of [null, [], "", 1, { actor_user_id: "other" }, { workspace_id: "other" },
    { root_ids: ["sample"] }, { model: "paid" }, { publish: true }]) {
    assert.equal(validateCorpusPreparationRequestV1(value), false);
  }
});

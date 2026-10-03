import assert from "node:assert/strict";
import test from "node:test";

import {
  loadWorkspaceCorpusReadinessForActorV1,
  WorkspaceCorpusReadinessError
} from "./workspace-corpus-readiness";

const granted = {
  workspace_status: "active", brand_status: "active", actor_status: "active",
  user_type: "client", primary_role: "client_viewer", same_organization: true,
  brand_access_level: "read"
};

test("corpus input counts are not queried without a live, scoped DB grant", async () => {
  for (const authority of [null, { ...granted, same_organization: false },
    { ...granted, actor_status: "suspended" }, { ...granted, brand_access_level: null },
    { ...granted, brand_status: "archived" }]) {
    let queries = 0;
    const queryable = {
      async query<Row extends Record<string, unknown>>(_sql: string, params?: unknown[]) {
        queries++;
        assert.deepEqual(params, ["requested-workspace", "current-actor"]);
        if (queries > 1) throw new Error("Private corpus counts must not be read.");
        return { rows: (authority ? [authority] : []) as unknown as Row[] };
      }
    };
    await assert.rejects(loadWorkspaceCorpusReadinessForActorV1({
      queryable, workspaceId: "requested-workspace", actorUserId: "current-actor"
    }), (error: unknown) => error instanceof WorkspaceCorpusReadinessError && error.status === 403);
    assert.equal(queries, 1);
  }
});

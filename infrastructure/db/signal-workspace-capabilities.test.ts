import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";

import { loadSignalWorkspaceCapabilitiesStoreV1, resolveSignalWorkspaceCapabilitiesV1,
  type SignalWorkspaceCapabilityAuthorityV1 } from "./signal-workspace-capabilities";

const client: SignalWorkspaceCapabilityAuthorityV1 = {
  workspace_status: "active", brand_status: "active", actor_status: "active", user_type: "client",
  primary_role: "client_admin", same_organization: true, brand_access_level: "comment"
};

test("a scoped client administrator can prepare interests and imports without processing authority", () => {
  assert.deepEqual(resolveSignalWorkspaceCapabilitiesV1(client), {
    can_view: true, can_edit_topics: true, can_import_mentions: true,
    can_execute_topics: false, can_adopt_topics: false
  });
  for (const alias of ["brand_manager", "client_owner"]) assert.equal(
    resolveSignalWorkspaceCapabilitiesV1({ ...client, primary_role: alias }).can_edit_topics, true);
});

test("viewer roles and read-only grants never become writers", () => {
  for (const overrides of [
    { primary_role: "client_viewer", brand_access_level: "admin" },
    { primary_role: "agency_insights", brand_access_level: "comment" },
    { primary_role: "client_admin", brand_access_level: "read" }
  ]) {
    const capabilities = resolveSignalWorkspaceCapabilitiesV1({ ...client, ...overrides });
    assert.equal(capabilities.can_view, true);
    assert.equal(capabilities.can_edit_topics, false);
    assert.equal(capabilities.can_import_mentions, false);
    assert.equal(capabilities.can_execute_topics, false);
  }
});

test("tenant, active identity, live brand grant and known role are all required", () => {
  for (const overrides of [
    { same_organization: false }, { brand_access_level: null }, { brand_access_level: "owner" },
    { actor_status: "suspended" }, { actor_status: "invited" }, { workspace_status: "archived" },
    { brand_status: "archived" }, { brand_status: null }, { primary_role: "unknown" },
    { user_type: "noisia_internal" }, { user_type: "unknown" }
  ]) assert.equal(Object.values(resolveSignalWorkspaceCapabilitiesV1({ ...client, ...overrides }))
    .some(Boolean), false, JSON.stringify(overrides));
  assert.equal(Object.values(resolveSignalWorkspaceCapabilitiesV1(null)).some(Boolean), false);
});

test("internal operator privilege needs a compatible internal role and active identity", () => {
  for (const primary_role of ["noisia_admin", "analyst"]) assert.equal(
    resolveSignalWorkspaceCapabilitiesV1({ ...client, primary_role, user_type: "noisia_internal",
      same_organization: false, brand_access_level: null }).can_execute_topics, true);
  assert.equal(resolveSignalWorkspaceCapabilitiesV1({ ...client, primary_role: "noisia_admin" })
    .can_execute_topics, false);
});

test("the store reads the actor and live grant from DB using the requested workspace boundary", async () => {
  let queried = false;
  const queryable = { query: async (sql: string, values: unknown[]) => {
    queried = true;
    assert.deepEqual(values, ["workspace-id", "actor-id"]);
    assert.match(sql, /actor\.id=\$2::uuid/u);
    assert.match(sql, /workspace\.id=\$1::uuid/u);
    assert.match(sql, /access\.brand_id=workspace\.brand_id/u);
    assert.match(sql, /access\.revoked_at IS NULL/u);
    return { rows: [client] };
  } } as unknown as Pick<Pool, "query">;
  assert.equal((await loadSignalWorkspaceCapabilitiesStoreV1({ queryable, workspace_id: "workspace-id",
    actor_user_id: "actor-id" })).can_import_mentions, true);
  assert.equal(queried, true);
});

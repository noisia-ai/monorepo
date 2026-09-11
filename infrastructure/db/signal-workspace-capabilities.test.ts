import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";

import { loadSignalWorkspaceCapabilitiesStoreV1, listSignalBrandWorkspaceEntriesStoreV1, resolveSignalWorkspaceCapabilitiesV1,
  type SignalWorkspaceCapabilityAuthorityV1 } from "./signal-workspace-capabilities";

const client: SignalWorkspaceCapabilityAuthorityV1 = {
  workspace_status: "active", brand_status: "active", actor_status: "active", user_type: "client",
  primary_role: "client_admin", same_organization: true, brand_access_level: "comment",
  organization_status: "active", brand_same_organization: true
};

test("a scoped client administrator can prepare interests and imports without processing authority", () => {
  assert.deepEqual(resolveSignalWorkspaceCapabilitiesV1(client), {
    can_view: true, can_edit_topics: true, can_import_mentions: true,
    can_execute_topics: false, can_adopt_topics: false, can_select_signal: true
  });
  for (const alias of ["brand_manager", "client_owner"]) assert.equal(
    resolveSignalWorkspaceCapabilitiesV1({ ...client, primary_role: alias }).can_edit_topics, false);
});

test("manual topic editing requires an active organization and exact brand-workspace tenant", () => {
  for (const overrides of [{ organization_status: "inactive" }, { organization_status: null },
    { organization_status: undefined }, { brand_same_organization: false }, { brand_same_organization: undefined }]) {
    assert.equal(resolveSignalWorkspaceCapabilitiesV1({ ...client, ...overrides }).can_edit_topics, false);
  }
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
    assert.equal(capabilities.can_adopt_topics, false);
    assert.equal(capabilities.can_select_signal, false);
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
    assert.match(sql, /organization\.status organization_status/u);
    assert.match(sql, /brand\.organization_id=workspace\.organization_id/u);
    return { rows: [client] };
  } } as unknown as Pick<Pool, "query">;
  assert.equal((await loadSignalWorkspaceCapabilitiesStoreV1({ queryable, workspace_id: "workspace-id",
    actor_user_id: "actor-id" })).can_import_mentions, true);
  assert.equal(queried, true);
});


test("selection needs administrator scope but does not grant execution or adoption", () => {
  for (const primary_role of ["client_admin", "brand_manager", "client_owner"])
    for (const brand_access_level of ["comment", "admin"]) {
      const caps = resolveSignalWorkspaceCapabilitiesV1({ ...client, primary_role, brand_access_level });
      assert.equal(caps.can_select_signal, true);
      assert.equal(caps.can_execute_topics, false);
      assert.equal(caps.can_adopt_topics, false);
    }
  const internal = resolveSignalWorkspaceCapabilitiesV1({ ...client, user_type: "noisia_internal", primary_role: "analyst" });
  assert.equal(internal.can_select_signal, true);
});

test("brand entry inventory makes one actor-scoped query without requiring reports or corpus", async () => {
  let queries = 0;
  const entry = { workspace_id: "workspace-a", workspace_slug: "brand-a", name: "Brand A",
    brand_id: "brand-a", organization_id: "org-a", timezone: "America/Mexico_City" };
  const rows = [{ ...entry, ...client }, { ...entry, ...client, workspace_id: "read", primary_role: "client_viewer" },
    { ...entry, ...client, workspace_id: "foreign", same_organization: false },
    { ...entry, ...client, workspace_id: "revoked", brand_access_level: null },
    { ...entry, ...client, workspace_id: "suspended", actor_status: "suspended" },
    { ...entry, ...client, workspace_id: "unknown", user_type: "noisia_internal", primary_role: "unknown" }];
  const queryable = { query: async (sql: string, values: unknown[]) => {
    queries++; assert.deepEqual(values, ["actor-id", null]);
    assert.match(sql, /actor\.id=\$1::uuid/u); assert.match(sql, /actor\.status='active'/u);
    assert.match(sql, /brand\.organization_id=workspace\.organization_id/u);
    assert.match(sql, /access\.revoked_at IS NULL/u); assert.match(sql, /workspace\.status='active' AND brand\.status='active'/u);
    assert.doesNotMatch(sql, /published_outputs|corpus_roots|signal_classification_assignments/u);
    return { rows };
  } } as unknown as Pick<Pool, "query">;
  const entries = await listSignalBrandWorkspaceEntriesStoreV1({ queryable, actor_user_id: "actor-id" });
  assert.equal(queries, 1); assert.deepEqual(entries.map(row => row.workspace_id), ["workspace-a", "read"]);
  assert.equal(entries[0]!.capabilities.can_select_signal, true); assert.equal(entries[1]!.capabilities.can_select_signal, false);
  assert.deepEqual(Object.keys(entries[0]!).sort(), [...Object.keys(entry), "capabilities"].sort());
});


test("a scoped entry lookup passes the canonical slug into the bulk query", async () => {
  let queries = 0;
  const queryable = { query: async (sql: string, values: unknown[]) => {
    queries++; assert.deepEqual(values, ["actor-id", "brand-a"]);
    assert.match(sql, /\$2::text IS NULL OR workspace\.slug=\$2/u); return { rows: [] };
  } } as unknown as Pick<Pool, "query">;
  assert.deepEqual(await listSignalBrandWorkspaceEntriesStoreV1({ queryable, actor_user_id: "actor-id", workspace_slug: "brand-a" }), []);
  assert.equal(queries, 1);
  assert.deepEqual(await listSignalBrandWorkspaceEntriesStoreV1({ queryable, actor_user_id: "actor-id", workspace_slug: "Brand A" }), []);
  assert.equal(queries, 1);
});

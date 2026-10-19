import assert from "node:assert/strict";
import test from "node:test";
import type { SignalBrandWorkspaceEntryV1 } from "@noisia/db";
import type { ResolvedSignalWorkspace } from "./signal-workspace";

// The production module shares the existing serving flag module, which owns a
// lazy-use Studio pool. These unit tests inject every data dependency and never
// connect, but module evaluation still requires a syntactically valid URL.
process.env.DATABASE_URL ??= "postgres://unit:test@localhost:5432/noisia_test";
const { listClientBrandWorkspaceEntriesV1, loadClientBrandWorkspaceEntryV1 } = await import("./workspace-management-entry");

const actor = { id: "actor-one", userType: "client", primaryRole: "client_admin", organizationId: "org-one", status: "active" };
const row: SignalBrandWorkspaceEntryV1 = { workspace_id: "workspace-one", workspace_slug: "new-brand",
  brand_id: "brand-one", organization_id: "org-one", name: "New brand", timezone: "UTC",
  capabilities: { can_view: true, can_edit_topics: true, can_import_mentions: true,
    can_select_signal: true, can_execute_topics: false, can_adopt_topics: false,
    can_request_processing: true } };
const workspace: ResolvedSignalWorkspace = { contractVersion: "signal-backend-v1", id: row.workspace_id,
  slug: row.workspace_slug, name: row.name, organizationId: row.organization_id, subject: { type: "brand", id: row.brand_id },
  timezone: row.timezone, status: "active", corpora: [] };

test("an assigned brand without corpus or published report has independent Topics and Data entry", async () => {
  const reads: unknown[] = [];
  const deps = { enabled: () => true, list: async (id: string, slug?: string) => { reads.push([id, slug]); return [row]; },
    resolve: async () => workspace };
  const items = await listClientBrandWorkspaceEntriesV1(actor, deps);
  const entry = await loadClientBrandWorkspaceEntryV1(actor, "new-brand", deps);
  assert.equal(items.length, 1); assert.ok(entry);
  assert.deepEqual(reads, [[actor.id, undefined], [actor.id, "new-brand"]]);
  assert.deepEqual(entry.navigation, { brandOsHref: "/signal/new-brand/manage/brand-os", topicsHref: "/signal/new-brand/manage/topics", dataHref: "/signal/new-brand/manage/data", signalHref: "/signal/new-brand" });
  assert.deepEqual(entry.workspace.corpora, []);
  assert.equal(entry.capabilities.can_select_signal, true); assert.equal(entry.capabilities.can_execute_topics, false);
  assert.equal(entry.canManageBrandContext, true);
  assert.equal("organization_id" in items[0]!, false);
  assert.equal("workspace" in items[0]!, false);
  const otherActor = await listClientBrandWorkspaceEntriesV1({ ...actor, id: "actor-two" }, deps);
  assert.notEqual(items[0]!.requestScope, otherActor[0]!.requestScope);
});

test("disabled serving and malformed management slugs cannot query or fall back to a report", async () => {
  const never = async (): Promise<never> => { throw new Error("must not query"); };
  const disabled = { enabled: () => false, list: never, resolve: never };
  assert.deepEqual(await listClientBrandWorkspaceEntriesV1(actor, disabled), []);
  assert.equal(await loadClientBrandWorkspaceEntryV1(actor, "new-brand", disabled), null);
  for (const slug of ["New-brand", "", "../studio", "new-brand?organization=foreign", "%2f", " new-brand "])
    assert.equal(await loadClientBrandWorkspaceEntryV1(actor, slug, { ...disabled, enabled: () => true }), null);
});

test("unassigned, revoked and ambiguous brand entries resolve no workspace or data", async () => {
  const never = async (): Promise<never> => { throw new Error("must not resolve"); };
  for (const rows of [[], [row, { ...row, organization_id: "org-two" }],
    [{ ...row, capabilities: { ...row.capabilities, can_view: false } }], [{ ...row, workspace_slug: "foreign" }]]) {
    assert.equal(await loadClientBrandWorkspaceEntryV1(actor, "new-brand", {
      enabled: () => true, list: async () => rows, resolve: never }), null);
  }
});

test("resolver identity must match the currently authorized brand, workspace and organization", async () => {
  for (const resolved of [null, { ...workspace, status: "archived" }, { ...workspace, id: "foreign" },
    { ...workspace, organizationId: "foreign" }, { ...workspace, slug: "foreign" },
    { ...workspace, subject: { type: "theme" as const, id: row.brand_id } },
    { ...workspace, subject: { type: "brand" as const, id: "foreign" } }]) {
    assert.equal(await loadClientBrandWorkspaceEntryV1(actor, "new-brand", {
      enabled: () => true, list: async () => [row], resolve: async () => resolved }), null);
  }
});

test("view-only inventory keeps operational capabilities denied and different workspaces isolated", async () => {
  const readonly = { ...row.capabilities, can_edit_topics: false, can_import_mentions: false, can_select_signal: false };
  const entries = await listClientBrandWorkspaceEntriesV1(actor, { enabled: () => true,
    list: async () => [{ ...row, capabilities: readonly }, { ...row, workspace_id: "workspace-two", workspace_slug: "brand-two" },
      { ...row, workspace_id: "revoked", capabilities: { ...readonly, can_view: false } }] });
  assert.equal(entries.length, 2); assert.equal(entries[0]!.capabilities.can_select_signal, false);
  assert.equal(entries[0]!.capabilities.can_execute_topics, false);
  assert.notEqual(entries[0]!.requestScope, entries[1]!.requestScope);
  const legacy = await listClientBrandWorkspaceEntriesV1({ ...actor, primaryRole: "brand_manager" }, {
    enabled: () => true, list: async () => [row]
  });
  assert.equal(legacy[0]!.canManageBrandContext, false);
});

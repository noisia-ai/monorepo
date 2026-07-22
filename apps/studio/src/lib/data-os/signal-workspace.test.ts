import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveSignalWorkspaceWithStore,
  type SignalWorkspaceResolverStore,
  type SignalWorkspaceStoreRow,
  type SignalWorkspaceUser
} from "./signal-workspace";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000002";
const WORKSPACE_ID = "20000000-0000-4000-8000-000000000001";
const BRAND_ID = "30000000-0000-4000-8000-000000000001";

const workspace: SignalWorkspaceStoreRow = {
  id: WORKSPACE_ID,
  organizationId: ORGANIZATION_ID,
  slug: "acme-signal",
  subject: { type: "brand", id: BRAND_ID },
  timezone: "America/Mexico_City",
  status: "active",
  hasBrandAccess: true,
  corpora: [{
    id: "40000000-0000-4000-8000-000000000001",
    name: "Acme listening",
    role: "operational",
    status: "corpus_approved",
    validFrom: "2026-07-22T00:00:00.000Z"
  }]
};

function storeWith(row: SignalWorkspaceStoreRow | null): SignalWorkspaceResolverStore {
  return { async loadWorkspace() { return row; } };
}

function user(overrides: Partial<SignalWorkspaceUser> = {}): SignalWorkspaceUser {
  return {
    id: "50000000-0000-4000-8000-000000000001",
    userType: "client",
    organizationId: ORGANIZATION_ID,
    ...overrides
  };
}

test("internal users resolve a workspace and its governed corpora", async () => {
  const result = await resolveSignalWorkspaceWithStore(
    storeWith({ ...workspace, hasBrandAccess: false }),
    user({ userType: "noisia_internal", organizationId: null }),
    { workspaceId: WORKSPACE_ID, organizationId: ORGANIZATION_ID }
  );
  assert.equal(result?.id, WORKSPACE_ID);
  assert.equal(result?.corpora[0]?.role, "operational");
});

test("authorized clients resolve brand workspaces through active brand access", async () => {
  const result = await resolveSignalWorkspaceWithStore(
    storeWith(workspace),
    user(),
    { workspaceSlug: "acme-signal" }
  );
  assert.equal(result?.subject.id, BRAND_ID);
});

test("clients from another organization or brand receive no workspace", async () => {
  const otherOrganization = await resolveSignalWorkspaceWithStore(
    storeWith(workspace),
    user({ organizationId: OTHER_ORGANIZATION_ID }),
    { workspaceId: WORKSPACE_ID }
  );
  const otherBrand = await resolveSignalWorkspaceWithStore(
    storeWith({ ...workspace, hasBrandAccess: false }),
    user(),
    { workspaceId: WORKSPACE_ID }
  );
  assert.equal(otherOrganization, null);
  assert.equal(otherBrand, null);
});

test("missing workspaces resolve to null without leaking scope", async () => {
  const result = await resolveSignalWorkspaceWithStore(
    storeWith(null),
    user(),
    { workspaceId: WORKSPACE_ID }
  );
  assert.equal(result, null);
});


import assert from "node:assert/strict";
import test from "node:test";

import {
  loadSignalModuleShadowRequesterV1,
  resolveSignalModuleShadowRequesterV1,
  type SignalModuleShadowRequesterRowV1
} from "./signal-module-shadow-requester";
import type { SignalModuleShadowRequesterAuthorityV1 } from "./signal-module-shadow-authority";

const internalAuthority: SignalModuleShadowRequesterAuthorityV1 = {
  contract_version: "signal-module-shadow-requester-v1",
  user_id: "75000000-0000-4000-8000-000000000010",
  organization_id: null,
  visibility_class: "internal"
};

const internalRow: SignalModuleShadowRequesterRowV1 = {
  id: internalAuthority.user_id,
  user_type: "noisia_internal",
  primary_role: "analyst",
  organization_id: null,
  status: "active"
};

test("background requester is re-derived from the current DB-owned role", async () => {
  const observed: unknown[][] = [];
  const resolved = await loadSignalModuleShadowRequesterV1(
    internalAuthority,
    {
      async query<Row extends Record<string, unknown>>(_sql: string, params?: unknown[]) {
        observed.push(params ?? []);
        return { rows: [internalRow as unknown as Row] };
      }
    }
  );
  assert.deepEqual(observed, [[internalAuthority.user_id]]);
  assert.deepEqual(resolved, {
    user: {
      id: internalAuthority.user_id,
      userType: "noisia_internal",
      organizationId: null
    },
    isInternalUser: true
  });
});

test("suspension, role drift and persisted visibility drift fail closed", () => {
  const rows: SignalModuleShadowRequesterRowV1[] = [
    { ...internalRow, status: "suspended" },
    { ...internalRow, primary_role: "client_viewer" },
    { ...internalRow, user_type: "client" },
    { ...internalRow, organization_id: "75000000-0000-4000-8000-000000000099" }
  ];
  for (const row of rows) {
    assert.equal(
      resolveSignalModuleShadowRequesterV1(row, internalAuthority),
      null
    );
  }
  assert.equal(
    resolveSignalModuleShadowRequesterV1(internalRow, {
      ...internalAuthority,
      visibility_class: "client"
    }),
    null
  );
});

test("client requester requires current organization identity", () => {
  const authority: SignalModuleShadowRequesterAuthorityV1 = {
    ...internalAuthority,
    organization_id: "75000000-0000-4000-8000-000000000099",
    visibility_class: "client"
  };
  const organizationId = "75000000-0000-4000-8000-000000000099";
  assert.deepEqual(
    resolveSignalModuleShadowRequesterV1({
      ...internalRow,
      user_type: "client",
      primary_role: "client_viewer",
      organization_id: organizationId
    }, authority),
    {
      user: {
        id: authority.user_id,
        userType: "client",
        organizationId
      },
      isInternalUser: false
    }
  );
  assert.equal(
    resolveSignalModuleShadowRequesterV1({
      ...internalRow,
      user_type: "client",
      primary_role: "client_viewer",
      organization_id: null
    }, authority),
    null
  );
  assert.equal(
    resolveSignalModuleShadowRequesterV1({
      ...internalRow,
      user_type: "client",
      primary_role: "client_viewer",
      organization_id: "75000000-0000-4000-8000-000000000098"
    }, authority),
    null
  );
});

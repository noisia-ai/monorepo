import assert from "node:assert/strict";
import test from "node:test";

import { resolveBrandDeleteDisposition } from "./brand-lifecycle";

test("workspace-owned brands fail closed for permanent deletion", () => {
  assert.equal(resolveBrandDeleteDisposition({
    permanent: false,
    status: "active",
    corporaCount: 0,
    workspaceCount: 1
  }), "archive");
  assert.equal(resolveBrandDeleteDisposition({
    permanent: true,
    status: "archived",
    corporaCount: 0,
    workspaceCount: 1
  }), "workspace_owned_blocked");
});

test("legacy brands retain archive-before-delete compatibility", () => {
  assert.equal(resolveBrandDeleteDisposition({
    permanent: false,
    status: "active",
    corporaCount: 1,
    workspaceCount: 0
  }), "archive");
  assert.equal(resolveBrandDeleteDisposition({
    permanent: true,
    status: "active",
    corporaCount: 0,
    workspaceCount: 0
  }), "archive_required");
  assert.equal(resolveBrandDeleteDisposition({
    permanent: true,
    status: "archived",
    corporaCount: 0,
    workspaceCount: 0
  }), "permanent");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  SIGNAL_MENTION_SCOPES,
  normalizeSignalMentionScopeV1,
  resolveSignalOperationalReadModeV1,
  validateSignalWorkspaceImportInputV1,
  validateSignalWorkspaceSourceInputV1
} from "./signal-workspace-data-plane-v1";

test("workspace data plane exposes the five governed attribution scopes", () => {
  assert.deepEqual(SIGNAL_MENTION_SCOPES, [
    "primary_brand",
    "competitor",
    "category",
    "reference",
    "unattributed"
  ]);
  assert.equal(normalizeSignalMentionScopeV1(" Primary_Brand "), "primary_brand");
  assert.throws(() => normalizeSignalMentionScopeV1("brand-ish"), /scope must be one of/u);
});

test("operational serving rollout is closed by default and accepts one explicit mode", () => {
  assert.equal(resolveSignalOperationalReadModeV1(undefined), "legacy");
  assert.equal(resolveSignalOperationalReadModeV1(""), "legacy");
  assert.equal(resolveSignalOperationalReadModeV1("unexpected"), "legacy");
  assert.equal(resolveSignalOperationalReadModeV1(" LEGACY "), "legacy");
  assert.equal(resolveSignalOperationalReadModeV1("shadow"), "shadow");
  assert.equal(resolveSignalOperationalReadModeV1("governed"), "governed");
});

test("workspace source and import inputs keep study provenance optional", () => {
  assert.deepEqual(validateSignalWorkspaceSourceInputV1({
    name: "SentiOne manual export",
    provider: "sentione",
    source_type: "social-listening",
    connection_method: "manual-csv",
    scope: "competitor",
    entity_id: "30000000-0000-4000-8000-000000000001"
  }), {
    name: "SentiOne manual export",
    provider: "sentione",
    source_type: "social-listening",
    connection_method: "manual-csv",
    scope: "competitor",
    entity_id: "30000000-0000-4000-8000-000000000001"
  });
  assert.deepEqual(validateSignalWorkspaceImportInputV1({ scope: "category" }), {
    scope: "category",
    contributed_by_study_corpus_id: null
  });
});

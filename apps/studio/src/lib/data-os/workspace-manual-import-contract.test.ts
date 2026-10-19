import assert from "node:assert/strict";
import test from "node:test";
import {
  WORKSPACE_MANUAL_IMPORT_SETUP_VERSION,
  manualImportUsageDecisionsV1,
  validateWorkspaceManualImportSetupInputV1
} from "./workspace-manual-import-contract";

const input = {
  contract_version: WORKSPACE_MANUAL_IMPORT_SETUP_VERSION, provider: "sentione",
  source_name: "Provider export", category_name: "Retail",
  rights: { storage_and_analysis: true, external_ai_processing: false, retention_until: null }
};

test("manual setup requires explicit rights and rejects unsupported authority fields", () => {
  assert.throws(() => validateWorkspaceManualImportSetupInputV1({ ...input, rights: {} }));
  assert.throws(() => validateWorkspaceManualImportSetupInputV1({ ...input,
    rights: { ...input.rights, storage_and_analysis: false } }));
  assert.throws(() => validateWorkspaceManualImportSetupInputV1({ ...input, access: "manual-import" }));
  assert.throws(() => validateWorkspaceManualImportSetupInputV1({ ...input, workspace_id: "other" }));
  assert.throws(() => validateWorkspaceManualImportSetupInputV1({ ...input,
    rights: { ...input.rights, retention_until: "2020-01-01T00:00:00Z" } }));
});

test("storage permission does not imply external AI or strategic use", () => {
  const validated = validateWorkspaceManualImportSetupInputV1(input);
  const decisions = new Map(manualImportUsageDecisionsV1(validated).map(item => [item.usage_purpose, item.decision]));
  assert.equal(decisions.get("client-derived-metrics"), "allowed");
  assert.equal(decisions.get("llm-processing"), "prohibited");
  assert.equal(decisions.get("strategic-analysis"), "not_available");
  const allowed = validateWorkspaceManualImportSetupInputV1({ ...input,
    rights: { ...input.rights, external_ai_processing: true } });
  assert.equal(manualImportUsageDecisionsV1(allowed).find(item => item.usage_purpose === "llm-processing")?.decision, "allowed");
});

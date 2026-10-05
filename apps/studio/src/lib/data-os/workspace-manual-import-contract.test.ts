import assert from "node:assert/strict";
import test from "node:test";
import {
  WORKSPACE_MANUAL_IMPORT_SETUP_VERSION,
  manualImportUsageDecisionsV1,
  validateWorkspaceManualImportSetupInputV1
} from "./workspace-manual-import-contract";
import {resolveWorkspaceImportRevisionModeV1} from "./workspace-import-revision-mode";

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

test("append-only import remains the same with MFP flags on or off",()=>{
  const manual={access:"manual-import" as const,acquisition:{slotKey:"synthetic"},supersedesImportBatchId:null};
  for(const flag of ["false","true"]){
    const env={NOISIA_MFP_ENABLED:flag,NOISIA_MENTION_FACETS_ENABLED:flag};
    assert.equal(resolveWorkspaceImportRevisionModeV1(manual,env),"append_only");
    assert.equal(resolveWorkspaceImportRevisionModeV1({...manual,contentRevisionMode:"append_only"},env),"append_only");
    if(flag==="true")assert.equal(resolveWorkspaceImportRevisionModeV1({...manual,contentRevisionMode:"revise_existing"},env),"revise_existing");
    else assert.throws(()=>resolveWorkspaceImportRevisionModeV1({...manual,contentRevisionMode:"revise_existing"},env),
      /content_revision_unavailable/u);
  }
});

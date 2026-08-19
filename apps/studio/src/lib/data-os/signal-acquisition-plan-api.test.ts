import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root=join(process.cwd(),"src/app/api/data-os/signal/[workspaceId]/acquisition-plan");
const routeFiles=[
  "route.ts","brief/route.ts","promote/route.ts","readiness/route.ts","reference-decisions/route.ts",
  "query-generation/route.ts",
  "slots/[slotKey]/query-versions/route.ts","slots/[slotKey]/retire/route.ts",
  "slots/[slotKey]/query-versions/[queryVersion]/route.ts",
  "imports/route.ts","imports/[importBatchId]/route.ts"
];

test("acquisition management routes are workspace-scoped and never own database authority",async()=>{
  for(const relative of routeFiles){
    const source=await readFile(join(root,relative),"utf8");
    assert.match(source,/loadSignalWorkspaceContextForManagement/u,relative);
    assert.doesNotMatch(source,/from\s+["']@\/lib\/db["']/u,relative);
    assert.doesNotMatch(source,/\bpool\.(?:query|connect)\b/u,relative);
    assert.match(source,/private, no-store/u,relative);
  }
});

test("every acquisition mutation requires an idempotency key and server-owned identifiers",async()=>{
  for(const relative of routeFiles.filter((value)=>!value.includes("readiness"))){
    const source=await readFile(join(root,relative),"utf8");
    if(!/export async function POST/u.test(source))continue;
    assert.match(source,/Idempotency-Key/u,relative);
  }
  const imports=await readFile(join(root,"imports/route.ts"),"utf8");
  assert.match(imports,/validateSignalAcquisitionImportInputV2/u);
  assert.match(imports,/resolveWorkspaceConnectorByKeyV1/u);
  assert.match(imports,/recovery_requires_existing_import/u);
  assert.doesNotMatch(imports,/provider_verified/u,
    "the browser transport cannot request provider-verified evidence");
  assert.doesNotMatch(imports,/acquisition_(?:plan|slot|query)_id/u);
  const query=await readFile(join(root,"slots/[slotKey]/query-versions/route.ts"),"utf8");
  assert.match(query,/validateSignalAcquisitionSlotKeyV1/u);
  assert.match(query,/validateSignalAcquisitionQueryVersionInputV1/u);
  const brief=await readFile(join(root,"brief/route.ts"),"utf8");
  assert.match(brief,/sealSignalAcquisitionBriefFromOperatorProductV1/u);
  assert.match(brief,/revision_token/u);
  assert.doesNotMatch(brief,/brand_os_(?:profile_)?(?:id|digest)|identity_catalog_digest|provider_(?:key|syntax_version|schema_version)/u);
});

test("legacy UUID import route rejects connector-only acquisition batches",async()=>{
  const legacy=await readFile(join(process.cwd(),
    "src/app/api/data-os/signal/[workspaceId]/sources/[sourceId]/imports/route.ts"),"utf8");
  assert.match(legacy,/acquisition_import_requires_source_key_route/u);
  assert.match(legacy,/SIGNAL_ACQUISITION_IMPORT_CONTRACT_VERSION/u);
});

test("Admin acquisition UI uses plan slots and typed import routes end to end",async()=>{
  const component=await readFile(join(process.cwd(),
    "src/components/admin/AcquisitionPlanManager.tsx"),"utf8");
  const service=await readFile(join(process.cwd(),
    "src/lib/data-os/signal-acquisition-plan.ts"),"utf8");
  const brandRoute=await readFile(join(process.cwd(),"src/app/api/brands/route.ts"),"utf8");
  const page=await readFile(join(process.cwd(),
    "src/app/studio/brands/[id]/data/page.tsx"),"utf8");
  const imports=await readFile(join(root,"imports/route.ts"),"utf8");

  assert.match(page,/AcquisitionPlanManager/u);
  assert.doesNotMatch(page,/WorkspaceSourcesManager/u);
  assert.match(component,/buildAdminWorkspaceConnectorInput/u);
  assert.match(component,/acquisition-plan\/slots\/\$\{encodeURIComponent\(slot\.slotKey\)\}\/query-versions/u);
  assert.match(component,/acquisition-plan\/imports/u);
  assert.match(component,/slot_key:slot\.slotKey/u);
  assert.match(component,/period:\{start,end,timezone\}/u);
  assert.match(component,/retry-from-storage/u);
  assert.match(component,/operator_attested/u);
  assert.match(component,/historical_export/u);
  assert.match(component,/registerExecutedQuery/u);
  const importForm=component.slice(component.indexOf("function ImportForm"),
    component.indexOf("function AcquisitionSkeleton"));
  assert.doesNotMatch(importForm,/provider_verified/u,
    "provider verification is intentionally absent from browser controls");
  assert.match(component,/readyForImport=\{plan\?\.readiness\.ready_for_import\?\?false\}/u);
  assert.match(importForm,/disabled=\{busy\|\|!readyForImport\}/u,
    "upload remains fail-closed while query evidence can be prepared");
  assert.match(component,/slot\.draft&&!draftQuery&&!isRetired/u);
  assert.match(component,/acquisition-plan\/brief/u);
  assert.match(component,/prepareBrief/u);
  const briefMutation=component.slice(component.indexOf("const saveBrief"),component.indexOf("const generateQueries"));
  assert.doesNotMatch(briefMutation,/brand_os_digest|identity_catalog_digest|provider_schema_version/u);
  assert.doesNotMatch(component,/sources\/\$\{source\.id\}\/imports/u);
  assert.match(service,/categories\.length===0\) blockers\.push\("category_identity_required"\)/u);
  assert.match(brandRoute,/status: "current",\s+effectiveFrom: new Date\(\),\s+updatedAt: new Date\(\)/u);
  assert.match(imports,/validateSignalAcquisitionSlotKeyV1/u);
  assert.match(imports,/slotKey/u);
});

test("workspace Query Composer is an application adapter, not a Study OS or provider runtime",async()=>{
  const service=await readFile(join(process.cwd(),
    "src/lib/data-os/signal-acquisition-query-composer.ts"),"utf8");
  assert.match(service,/composeQueryDraftWithProviderV1/u);
  assert.match(service,/createSignalAcquisitionQueryVersionFromEngineV1/u);
  assert.match(service,/provider:QueryComposerProviderV1/u);
  assert.match(service,/slot\.scope!=="reference"/u);
  assert.doesNotMatch(service,/\bquery_iterations\b/u);
  assert.doesNotMatch(service,/\bquery_packs\b/u);
  assert.doesNotMatch(service,/\bstudy_corpora\b/u);
  assert.doesNotMatch(service,/@ai-sdk|generateText\(/u);
  assert.doesNotMatch(service,/fetch\(|BullMQ|new Queue/u);
});

test("workspace Query Composer transport is server-owned, budgeted and explicitly reviewed",async()=>{
  const generation=await readFile(join(root,"query-generation/route.ts"),"utf8");
  const review=await readFile(join(root,
    "slots/[slotKey]/query-versions/[queryVersion]/route.ts"),"utf8");
  const component=await readFile(join(process.cwd(),
    "src/components/admin/AcquisitionPlanManager.tsx"),"utf8");

  assert.match(generation,/confirmation:z\.literal\(true\)/u);
  assert.match(generation,/hard_cap_usd/u);
  assert.match(generation,/createAnthropicSignalAcquisitionQueryProviderV1/u);
  assert.doesNotMatch(component,/api\.anthropic\.com|ANTHROPIC_API_KEY/u);
  assert.match(component,/query-generation/u);
  assert.match(component,/query-versions\/\$\{query\.version\}/u);
  assert.match(review,/reviewSignalAcquisitionQueryVersionV1/u);
  assert.match(review,/z\.enum\(\["approved","rejected"\]\)/u);
});

test("Acquisition Brief HTTP accepts only operator decisions and seals authority server-side",async()=>{
  const route=await readFile(join(root,"brief/route.ts"),"utf8");
  const service=await readFile(join(process.cwd(),
    "src/lib/data-os/signal-acquisition-brief-management.ts"),"utf8");
  assert.match(route,/\.strict\(\)/u);
  assert.match(route,/Idempotency-Key/u);
  assert.match(service,/loadSignalAcquisitionLiveAuthorityV1/u);
  assert.match(service,/loadSignalAcquisitionKnowledgeSelectionV1/u);
  assert.match(service,/timezone:args\.workspace\.timezone/u);
  assert.match(service,/provider_key:PROVIDER_CONTRACT\.key/u);
  assert.match(service,/acquisition_plan_authority_drift/u);
  assert.doesNotMatch(route,/ANTHROPIC|createAnthropic|provider_calls/u);
});

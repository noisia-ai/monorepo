import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  SIGNAL_SEMANTIC_CONTEXT_ELEMENT_KINDS,
  SIGNAL_SEMANTIC_CONTEXT_RECONCILIATION_REASONS,
  SIGNAL_SEMANTIC_CONTEXT_RELATION_KINDS,
  SIGNAL_SEMANTIC_CONTEXT_SOURCE_TYPES,
  signalSemanticContextProviderConfigurationFromEnvV1
} from "@/lib/data-os/signal-semantic-context-pack";

test("semantic context vocabulary is closed and keeps relation authority separate",()=>{
  assert.equal(SIGNAL_SEMANTIC_CONTEXT_ELEMENT_KINDS.length,20);
  assert.deepEqual(SIGNAL_SEMANTIC_CONTEXT_RELATION_KINDS,
    ["is_a","part_of","surface_of","competes_with","associated_with"]);
  assert.deepEqual(SIGNAL_SEMANTIC_CONTEXT_SOURCE_TYPES,["brand_os_profile","brand_os_product",
    "brand_os_competitor","brand_os_seed_term","knowledge_source","knowledge_chunk",
    "knowledge_assertion"]);
  assert.deepEqual(SIGNAL_SEMANTIC_CONTEXT_RECONCILIATION_REASONS,["brand_os_drift",
    "knowledge_drift","locale_market_drift","provider_lineage_missing",
    "provider_lineage_changed","operator_requested_reconciliation"]);
});

test("provider preflight configuration is server-owned and unavailable without pinned inputs",()=>{
  const unavailable=signalSemanticContextProviderConfigurationFromEnvV1({});
  assert.equal(unavailable.available,false);
  assert.equal(unavailable.hard_cap_usd,0);
  const configured=signalSemanticContextProviderConfigurationFromEnvV1({
    NOISIA_SEMANTIC_CONTEXT_PROVIDER:"fixture",NOISIA_SEMANTIC_CONTEXT_MODEL:"fixture-model",
    NOISIA_SEMANTIC_CONTEXT_MODEL_VERSION:"immutable-v1",
    NOISIA_SEMANTIC_CONTEXT_PRICING_VERSION:"pricing-v1",
    NOISIA_SEMANTIC_CONTEXT_PROMPT_DIGEST:`sha256:${"a".repeat(64)}`,
    NOISIA_SEMANTIC_CONTEXT_MAX_INPUT_TOKENS:"1000",
    NOISIA_SEMANTIC_CONTEXT_MAX_OUTPUT_TOKENS:"500",
    NOISIA_SEMANTIC_CONTEXT_INPUT_USD_PER_MILLION_TOKENS:"1",
    NOISIA_SEMANTIC_CONTEXT_OUTPUT_USD_PER_MILLION_TOKENS:"2",
    NOISIA_SEMANTIC_CONTEXT_HARD_CAP_USD:"1"
  });
  assert.equal(configured.available,true);
});

test("management routes keep authority fields and provider proposal writes off the browser surface",async()=>{
  const root=resolve(process.cwd(),"src/app/api/data-os/signal/[workspaceId]/semantic-context");
  const [base,decisions,preflight,reconcile,helper]=await Promise.all([
    readFile(resolve(root,"route.ts"),"utf8"),readFile(resolve(root,"decisions/route.ts"),"utf8"),
    readFile(resolve(root,"preflight/route.ts"),"utf8"),
    readFile(resolve(root,"reconcile/route.ts"),"utf8"),readFile(resolve(root,"_lib.ts"),"utf8")]);
  const routes=[base,decisions,preflight,reconcile,helper].join("\n");
  assert.match(routes,/loadSignalWorkspaceContextForManagement/u);
  assert.match(routes,/noisia_internal/u);
  assert.doesNotMatch(decisions,/workspace_id|brand_os_digest|knowledge_digest|prompt_template_digest|model_version/u);
  assert.doesNotMatch(routes,/appendSignalSemanticContextProposals/u,
    "provider/server projection proposals are not a browser write contract");
  assert.doesNotMatch(routes,/Anthropic|Voyage|generateText|messages\.create/u);
  assert.doesNotMatch(reconcile,/workspace_id|brand_os_digest|knowledge_digest|model_version|pricing_version/u);
  assert.match(reconcile,/Idempotency-Key/u);
});

test("Brand OS mounts the canonical semantic context review after Knowledge and keeps authority server-side",async()=>{
  const [page,manager,esMx,enUs]=await Promise.all([
    readFile(resolve(process.cwd(),"src/app/studio/brands/[id]/brand-os/page.tsx"),"utf8"),
    readFile(resolve(process.cwd(),"src/components/brands/SemanticContextPackManager.tsx"),"utf8"),
    readFile(resolve(process.cwd(),"messages/es-MX.json"),"utf8"),
    readFile(resolve(process.cwd(),"messages/en-US.json"),"utf8")
  ]);
  assert.ok(page.indexOf("<SemanticContextPackManager")>page.indexOf("<KnowledgeBaseManager"));
  assert.match(manager,/WorkspaceDrawer/u);
  assert.match(manager,/WorkspaceConfirmDialog/u);
  assert.match(manager,/GENERATE_PENDING_SEMANTIC_CONTEXT_PROPOSALS/u);
  assert.match(manager,/publish_reviewed_semantic_context/u);
  assert.match(manager,/Idempotency-Key/u);
  assert.match(manager,/\/reconcile/u);
  assert.match(manager,/actions\.reconcile/u);
  assert.match(manager,/noisia:semantic-context-run/u,
    "refresh recovery must retain the durable run key");
  assert.match(manager,/density="compact"/u,
    "Brand OS must use the canonical compact summary density");
  assert.match(manager,/run\.status === "failed" && run\.provider_call_count === 0/u,
    "safe retry is offered only before a provider call starts");
  assert.doesNotMatch(manager,/run\.error\?\.message/u,
    "operator UI must never expose raw provider validation messages");
  assert.doesNotMatch(manager,/confidence_authoritative|source_ref\}/u,
    "the operator UI must not present confidence or private source references as authority");
  assert.equal(typeof JSON.parse(esMx).AdminWorkspace.brandOs.semanticContext.title,"string");
  assert.equal(typeof JSON.parse(enUs).AdminWorkspace.brandOs.semanticContext.title,"string");
});

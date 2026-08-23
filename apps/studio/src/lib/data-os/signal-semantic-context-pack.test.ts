import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { createTranslator } from "next-intl";

import {
  SIGNAL_SEMANTIC_CONTEXT_ELEMENT_KINDS,
  SIGNAL_SEMANTIC_CONTEXT_RECONCILIATION_REASONS,
  SIGNAL_SEMANTIC_CONTEXT_RELATION_KINDS,
  SIGNAL_SEMANTIC_CONTEXT_SOURCE_TYPES,
  signalSemanticContextProviderConfigurationFromEnvV1
} from "@/lib/data-os/signal-semantic-context-pack";
import {
  canPrepareSignalSemanticContextTerminalSuccessorV1,
  canStartSignalSemanticContextProposalGenerationV1,
  isSignalSemanticContextRunSessionCurrentV1,
  parseSignalSemanticContextRunSessionReferenceV1,
  signalSemanticContextRejectedRevalidationCountValuesV1,
  serializeSignalSemanticContextRunSessionReferenceV1
} from "@/lib/data-os/signal-semantic-context-run-session";

test("proposal generation entry is gated by the server-discovered generation run", () => {
  assert.equal(canStartSignalSemanticContextProposalGenerationV1({
    lifecycleState: "draft", elementCount: 0, hasServerDiscoveredRun: false
  }), true, "an untouched draft remains actionable");
  assert.equal(canStartSignalSemanticContextProposalGenerationV1({
    lifecycleState: "draft", elementCount: 0, hasServerDiscoveredRun: true
  }), false, "terminal and nonterminal server-discovered runs both suppress generation");
  assert.equal(canStartSignalSemanticContextProposalGenerationV1({
    lifecycleState: "draft", elementCount: 1, hasServerDiscoveredRun: false
  }), false, "existing elements preserve the established review actions");
  assert.equal(canStartSignalSemanticContextProposalGenerationV1({
    lifecycleState: "published", elementCount: 0, hasServerDiscoveredRun: false
  }), false, "published generations cannot start proposal generation");
  assert.equal(canStartSignalSemanticContextProposalGenerationV1({
    lifecycleState: null, elementCount: 0, hasServerDiscoveredRun: false
  }), false, "missing generation state fails closed");
});

test("terminal successor preparation is non-paid and restricted to consumed empty drafts", () => {
  assert.equal(canPrepareSignalSemanticContextTerminalSuccessorV1({
    lifecycleState: "draft", elementCount: 0, runStatus: "failed", providerCallCount: 1
  }), true);
  assert.equal(canPrepareSignalSemanticContextTerminalSuccessorV1({
    lifecycleState: "draft", elementCount: 0, runStatus: "stale", providerCallCount: 0
  }), true);
  assert.equal(canPrepareSignalSemanticContextTerminalSuccessorV1({
    lifecycleState: "draft", elementCount: 0, runStatus: "dead_letter", providerCallCount: 0
  }), true, "a terminal no-call dead letter can advance without spending");
  assert.equal(canPrepareSignalSemanticContextTerminalSuccessorV1({
    lifecycleState: "draft", elementCount: 0, runStatus: "dead_letter", providerCallCount: 1
  }), false, "an ambiguous provider outcome is never offered as an eligible transition");
  assert.equal(canPrepareSignalSemanticContextTerminalSuccessorV1({
    lifecycleState: "draft", elementCount: 0, runStatus: "failed", providerCallCount: 0
  }), false, "a definitely-not-started run keeps the existing safe retry path");
  assert.equal(canPrepareSignalSemanticContextTerminalSuccessorV1({
    lifecycleState: "draft", elementCount: 1, runStatus: "failed", providerCallCount: 1
  }), false, "reviewable elements cannot be bypassed");
  assert.equal(canPrepareSignalSemanticContextTerminalSuccessorV1({
    lifecycleState: "published", elementCount: 0, runStatus: "failed", providerCallCount: 1
  }), false);
  assert.equal(canPrepareSignalSemanticContextTerminalSuccessorV1({
    lifecycleState: "draft", elementCount: 0, runStatus: "processing", providerCallCount: 0
  }), false);
});

test("rejected paid-response reconciliation preserves observed counts generically", () => {
  const fixture = {
    proposal_count_before: 41,
    normalized_proposal_count: 2,
    proposals_appended: 1
  };
  const first = signalSemanticContextRejectedRevalidationCountValuesV1(fixture);
  const reload = signalSemanticContextRejectedRevalidationCountValuesV1(fixture);
  assert.deepEqual(first, { received: 41, retained: 2, appended: 1 });
  assert.deepEqual(reload, first, "server reload renders the same persisted reconciliation");
  assert.deepEqual(signalSemanticContextRejectedRevalidationCountValuesV1({
    proposal_count_before: 77, normalized_proposal_count: 0, proposals_appended: 0
  }), { received: 77, retained: 0, appended: 0 },
  "observed zeroes must remain explicit instead of being omitted or marked unavailable");
});

test("semantic context run references are bound to their generation", () => {
  const stored = serializeSignalSemanticContextRunSessionReferenceV1(
    "semantic-context-v3",
    "semantic-context-proposal-run-3"
  );
  const parsed = parseSignalSemanticContextRunSessionReferenceV1(stored);

  assert.deepEqual(parsed, {
    version: 1,
    generation_key: "semantic-context-v3",
    run_key: "semantic-context-proposal-run-3"
  });
  assert.ok(parsed);
  assert.equal(isSignalSemanticContextRunSessionCurrentV1(parsed, "semantic-context-v3"), true);
  assert.equal(isSignalSemanticContextRunSessionCurrentV1(parsed, "semantic-context-v4"), false);
});

test("legacy and malformed run references fail closed", () => {
  assert.equal(parseSignalSemanticContextRunSessionReferenceV1("old-run-key"), null);
  assert.equal(parseSignalSemanticContextRunSessionReferenceV1("{"), null);
  assert.equal(parseSignalSemanticContextRunSessionReferenceV1(JSON.stringify({
    version: 1,
    generation_key: "semantic-context-v3",
    run_key: "../../../private"
  })), null);
});

test("semantic context vocabulary is closed and keeps relation authority separate",()=>{
  assert.equal(SIGNAL_SEMANTIC_CONTEXT_ELEMENT_KINDS.length,20);
  assert.deepEqual(SIGNAL_SEMANTIC_CONTEXT_RELATION_KINDS,
    ["is_a","part_of","surface_of","competes_with","associated_with"]);
  assert.deepEqual(SIGNAL_SEMANTIC_CONTEXT_SOURCE_TYPES,["brand_os_profile","brand_os_product",
    "brand_os_competitor","brand_os_seed_term","knowledge_source","knowledge_chunk",
    "knowledge_assertion"]);
  assert.deepEqual(SIGNAL_SEMANTIC_CONTEXT_RECONCILIATION_REASONS,["brand_os_drift",
    "knowledge_drift","locale_market_drift","provider_lineage_missing",
    "provider_lineage_changed","operator_requested_reconciliation","terminal_provider_run"]);
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
  const [base,decisions,preflight,reconcile,revalidate,helper]=await Promise.all([
    readFile(resolve(root,"route.ts"),"utf8"),readFile(resolve(root,"decisions/route.ts"),"utf8"),
    readFile(resolve(root,"preflight/route.ts"),"utf8"),
    readFile(resolve(root,"reconcile/route.ts"),"utf8"),
    readFile(resolve(root,"proposals/[runKey]/revalidate/route.ts"),"utf8"),
    readFile(resolve(root,"_lib.ts"),"utf8")]);
  const routes=[base,decisions,preflight,reconcile,revalidate,helper].join("\n");
  assert.match(routes,/loadSignalWorkspaceContextForManagement/u);
  assert.match(routes,/noisia_internal/u);
  assert.doesNotMatch(decisions,/workspace_id|brand_os_digest|knowledge_digest|prompt_template_digest|model_version/u);
  assert.doesNotMatch(routes,/appendSignalSemanticContextProposals/u,
    "provider/server projection proposals are not a browser write contract");
  assert.doesNotMatch(routes,/Anthropic|Voyage|generateText|messages\.create/u);
  assert.doesNotMatch(reconcile,/workspace_id|brand_os_digest|knowledge_digest|model_version|pricing_version/u);
  assert.match(reconcile,/Idempotency-Key/u);
  assert.match(revalidate,/Idempotency-Key/u);
  assert.doesNotMatch(revalidate,/response_digest|brand_os_digest|knowledge_digest|entity_type|provider:/u);
  assert.match(revalidate,/REVALIDATE_PAID_SEMANTIC_CONTEXT_RESPONSE|parseSignalSemanticContextProposalRevalidationRequestV1/u);
});

test("Brand OS mounts the canonical semantic context review after Knowledge and keeps authority server-side",async()=>{
  const [page,manager,service,dbWriter,esMx,enUs]=await Promise.all([
    readFile(resolve(process.cwd(),"src/app/studio/brands/[id]/brand-os/page.tsx"),"utf8"),
    readFile(resolve(process.cwd(),"src/components/brands/SemanticContextPackManager.tsx"),"utf8"),
    readFile(resolve(process.cwd(),"src/lib/data-os/signal-semantic-context-pack.ts"),"utf8"),
    readFile(resolve(process.cwd(),"../../infrastructure/db/signal-semantic-context-proposal.ts"),"utf8"),
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
  assert.match(manager,/terminal_provider_run/u);
  assert.match(manager,/actions\.prepareSuccessor/u);
  assert.match(manager,/terminalSuccessor\.message/u);
  assert.match(manager,/noisia:semantic-context-run/u,
    "same-tab polling may retain a bounded run hint");
  assert.match(manager,/isSignalSemanticContextRunSessionCurrentV1/u,
    "a remembered run hint must remain generation-bound");
  assert.match(manager,/serializeSignalSemanticContextRunSessionReferenceV1\(generation\.generation_key/u,
    "same-tab polling state retains the generation identity with the run key");
  assert.match(manager,/detail\.latest_proposal_run/u,
    "fresh loads must bind the server-discovered run without sessionStorage authority");
  assert.match(manager,/const canStartProposalGeneration = canStartSignalSemanticContextProposalGenerationV1\(\{/u,
    "all proposal entry points share one server-run-aware state guard");
  assert.equal(manager.match(/\{canStartProposalGeneration \?/gu)?.length,2,
    "the action bar and empty state must use the same proposal entry guard");
  assert.doesNotMatch(manager,/generation\?\.lifecycle_state === "draft" && elements\.length === 0 \?/u,
    "the action bar must not bypass a server-discovered terminal or active run");
  assert.match(manager,/saved\.run_key !== run\.run_key/u,
    "a browser hint cannot replace the server-selected run");
  assert.doesNotMatch(manager,/requestJson<ProposalRun>\([^\n]+saved\.run_key/u,
    "initial hydration must never load an arbitrary browser-supplied run key");
  assert.match(service,/loadLatestSignalSemanticContextProposalRunForGenerationV1/u);
  assert.match(dbWriter,/NOT EXISTS\([\s\S]+supersedes_generation_id=generation\.id/u,
    "superseded generation history must fail closed");
  assert.match(dbWriter,/signal_data_governance_actor_is_valid\(workspace\.id,\$5::uuid\)/u,
    "terminal discovery retains DB-owned actor authorization");
  assert.match(manager,/density="compact"/u,
    "Brand OS must use the canonical compact summary density");
  assert.match(manager,/run\.status === "failed" && run\.provider_call_count === 0/u,
    "safe retry is offered only before a provider call starts");
  assert.match(manager,/paid_response_revalidation/u,
    "refresh must render the operator-safe paid-response revalidation result");
  assert.match(manager,/revalidationRejectedDetail/u,
    "a rejected paid-response recovery must remain visible without exposing private output");
  assert.doesNotMatch(manager,/run\.error\?\.message/u,
    "operator UI must never expose raw provider validation messages");
  assert.doesNotMatch(manager,/provider_response_private|provider_request_identity|raw_provider_response|response_payload/u,
    "terminal run rendering must not expose private provider state");
  assert.doesNotMatch(manager,/confidence_authoritative|source_ref\}/u,
    "the operator UI must not present confidence or private source references as authority");
  const esMessages=JSON.parse(esMx).AdminWorkspace.brandOs.semanticContext;
  const enMessages=JSON.parse(enUs).AdminWorkspace.brandOs.semanticContext;
  const arbitraryCounts = signalSemanticContextRejectedRevalidationCountValuesV1({
    proposal_count_before: 41, normalized_proposal_count: 2, proposals_appended: 1
  });
  const observedZeroCounts = signalSemanticContextRejectedRevalidationCountValuesV1({
    proposal_count_before: 77, normalized_proposal_count: 0, proposals_appended: 0
  });
  const esT = createTranslator({ locale: "es-MX", messages: esMessages });
  const enT = createTranslator({ locale: "en-US", messages: enMessages });
  for (const [copy, counts] of [
    [esT("run.revalidationRejectedDetail", arbitraryCounts), arbitraryCounts],
    [enT("run.revalidationRejectedDetail", arbitraryCounts), arbitraryCounts],
    [esT("run.revalidationRejectedDetail", observedZeroCounts), observedZeroCounts],
    [enT("run.revalidationRejectedDetail", observedZeroCounts), observedZeroCounts]
  ] as const) {
    assert.match(copy, new RegExp(String(counts.received), "u"));
    assert.match(copy, new RegExp(String(counts.retained), "u"));
    assert.match(copy, new RegExp(String(counts.appended), "u"));
    assert.doesNotMatch(copy, /revalidationRejectedDetail|\{(?:received|retained|appended)\}|not_available/u);
  }
  assert.match(esT("run.revalidationRejectedDetail", observedZeroCounts), /segunda llamada/u);
  assert.match(enT("run.revalidationRejectedDetail", observedZeroCounts), /second provider call/u);
  assert.match(manager,/revalidationRejectedDetail", rejectedRevalidationCounts/u,
    "the rejected banner must bind all public reconciliation counts");
  assert.doesNotMatch(manager,/actions\.(?:recover|revalidate)/u,
    "terminal paid-response history must not add recovery actions");
  for(const blocker of ["semantic_context_capacity_contract_insufficient",
    "semantic_context_model_output_capacity_unsupported",
    "semantic_context_configured_output_capacity_insufficient",
    "semantic_context_generation_run_exists"]){
    assert.match(manager,new RegExp(blocker,"u"));
    assert.equal(typeof esMessages.blockers[blocker],"string");
    assert.equal(typeof enMessages.blockers[blocker],"string");
  }
  assert.equal(typeof esMessages.title,"string");
  assert.equal(typeof enMessages.title,"string");
});

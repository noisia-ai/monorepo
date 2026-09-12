import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React, { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import type { SignalBrandContextPreparationRuntimeV1, SignalBrandContextProcessingQuoteV1 } from "@noisia/db";
import { ClientBrandContextProcessingQuote } from "../../components/brands/ClientBrandContextProcessingQuote";
import { createClientBrandContextProcessingPostV1,
  createClientBrandContextProcessingQuoteGetV1 } from "./client-brand-context-processing-quote-route";
import {
  clientBrandContextReconciliationAwaitingSettlementV1,
  clientBrandContextReconciliationCycleV1,
  clientBrandContextReconciliationRetryDelayV1,
  clientBrandContextProcessingCanRetrySemanticV1,
  clientBrandContextProcessingCanConfirmV1,
  clientBrandContextProcessingConfirmationV1,
  clientBrandContextProcessingNeedsExplicitRenewalV1,
  clientBrandContextProcessingPollDelayV1,
  clientBrandContextProcessingPollingCheckpointV1,
  clientBrandContextProcessingQuoteForWorkspaceV1,
  clientBrandContextProcessingRequestV1,
  clientBrandContextProcessingViewForWorkspaceV1,
  clientBrandContextProcessingViewFromQuoteV1,
  latestClientBrandContextProcessingViewV1,
  toClientBrandContextProcessingQuoteViewV1,
  validClientBrandContextProcessingConfirmationV1,
  validClientBrandContextProcessingPollingCheckpointV1,
  validClientBrandContextProcessingQuoteViewV1,
  validClientBrandContextProcessingViewV1,
  type ClientBrandContextProcessingOperationStateV1,
  type ClientBrandContextProcessingPhaseV1,
  type ClientBrandContextProcessingViewV1
} from "./client-brand-context-processing-quote";
import { signalBrandContextProcessingActionAvailabilityV1,
  startClientBrandContextPrototypeProcessingForActorV1 } from "./signal-brand-context-processing-quote";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const digest = `sha256:${"a".repeat(64)}`;
const reference = `qv1_${"a".repeat(64)}`;
const internal = {
  contract_version: "brand-context-processing-quote-v1", workspace_id: workspaceId,
  can_request_processing: true, can_start: false, blocked_reason: "joint_admission_required",
  quote_status: "quoted", quote_digest: digest, quoted_at: "2026-09-11T12:00:00.000Z",
  quote_expires_at: "2026-09-11T12:05:00.000Z", budget_date: "2026-09-11",
  policy: { id: "private-policy", version: "1", digest, valid_from: "2026-09-11T00:00:00.000Z",
    valid_until: "2026-09-12T00:00:00.000Z", budget_timezone: "America/Mexico_City", daily_cap_micro_usd: "5000000" },
  exposure: { confirmed_micro_usd: "100", reserved_micro_usd: "200", ambiguous_micro_usd: "300", total_micro_usd: "600" },
  remaining_micro_usd: "4999400", maximum_total_micro_usd: "700000",
  actions: [{ action: "brand_context_proposal", kind: "provider", provider: "anthropic", model: "private-model",
    configuration_digest: digest, max_execution_micro_usd: "600000", automatic_allowed: false, available: true }],
  source: { authority_digest: digest, brand_os_digest: digest, knowledge_digest: digest,
    locale_context_digest: digest, primary_locale: "es-MX", locale_variants: ["es-MX"], markets: ["MX"] }
} as SignalBrandContextProcessingQuoteV1;

Object.assign(globalThis, { React });
const serverAdapter = await readFile(new URL("./signal-brand-context-processing-quote.ts", import.meta.url), "utf8");
const clientComponent = await readFile(new URL("../../components/brands/ClientBrandContextProcessingQuote.tsx",
  import.meta.url), "utf8");

const publicQuote = toClientBrandContextProcessingQuoteViewV1(internal);
const availableView: ClientBrandContextProcessingViewV1 = {
  ...clientBrandContextProcessingViewFromQuoteV1(publicQuote),
  observed_at: "2026-09-11T12:00:00.000Z",
  can_start: true,
  quote: { reference, maximum_micro_usd: "700000", available_today_micro_usd: "4999400",
    expires_at: "2999-09-11T12:05:00.000Z" }
};

const prototypeAuthorizationView: ClientBrandContextProcessingViewV1 = {
  ...availableView,
  operation: { state: "awaiting_authorization", phase: null, request_observed: true, next_action: null }
};

const renewalView: ClientBrandContextProcessingViewV1 = {
  ...availableView,
  operation: { state: "failed", phase: null, request_observed: true, next_action: "renew_semantic" }
};

const retryView: ClientBrandContextProcessingViewV1 = {
  ...availableView,
  operation: { state: "failed", phase: null, request_observed: true, next_action: "retry_semantic" }
};

function operationView(state: ClientBrandContextProcessingOperationStateV1,
  phase: ClientBrandContextProcessingPhaseV1 | null): ClientBrandContextProcessingViewV1 {
  return { ...availableView, can_start: false, operation: { state, phase, request_observed: true, next_action: null } };
}

test("public Brand Context quote is an exact allowlist and remains non-executable", () => {
  const view = publicQuote;
  assert.deepEqual(Object.keys(view).sort(), ["available_today_micro_usd", "can_start", "contract_version",
    "maximum_micro_usd", "observed_at", "quote_expires_at", "quote_reference", "status", "workspace_id"]);
  assert.equal(view.status, "quote_available");
  assert.equal(view.can_start, false);
  assert.equal(view.quote_reference, reference);
  const json = JSON.stringify(view);
  for (const privateValue of ["anthropic", "private-model", "private-policy", digest, "America/Mexico_City", "es-MX"])
    assert.doesNotMatch(json, new RegExp(privateValue.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.equal(validClientBrandContextProcessingQuoteViewV1(view), true);
  assert.equal(clientBrandContextProcessingQuoteForWorkspaceV1(view, workspaceId), view);
  assert.equal(clientBrandContextProcessingQuoteForWorkspaceV1(view,
    "00000000-0000-4000-8000-000000000099"), null);
  for (const invalid of [{ ...view, can_start: true }, { ...view, provider: "hidden" },
    { ...view, workspace_id: "not-a-workspace" }, { ...view, observed_at: "yesterday" },
    { ...view, quote_expires_at: null }, { ...view, maximum_micro_usd: "0.10" }]) {
    assert.equal(validClientBrandContextProcessingQuoteViewV1(invalid), false);
  }
});

test("aggregate Brand Context view accepts only the public state machine", () => {
  const converted = clientBrandContextProcessingViewFromQuoteV1(publicQuote);
  assert.equal(converted.can_start, false);
  assert.equal(converted.operation, null);
  assert.equal(validClientBrandContextProcessingViewV1(converted), true);
  assert.equal(validClientBrandContextProcessingViewV1(availableView), true);
  assert.equal(clientBrandContextProcessingViewForWorkspaceV1(availableView, workspaceId), availableView);
  assert.equal(clientBrandContextProcessingViewForWorkspaceV1(availableView,
    "00000000-0000-4000-8000-000000000099"), null);

  for (const invalid of [
    { ...availableView, provider: "hidden" },
    { ...availableView, quote: { ...availableView.quote!, model: "hidden" } },
    operationView("queued", "preparing_context"),
    operationView("running", "waiting"),
    operationView("awaiting_authorization", "preparing_interests"),
    operationView("awaiting_authorization", null),
    { ...operationView("running", "preparing_context"), can_start: true },
    { ...operationView("running", "preparing_context"), operation: {
      ...operationView("running", "preparing_context").operation!, next_action: "retry_semantic" } },
    { ...operationView("failed", null), operation: {
      ...operationView("failed", null).operation!, next_action: "renew_semantic" } },
    { ...renewalView, operation: { ...renewalView.operation!, next_action: null } },
    { ...renewalView, operation: { ...renewalView.operation!, next_action: "hidden_action" } },
    { ...availableView, status: "quote_available", quote: null },
    { ...availableView, workspace_id: "not-a-workspace" }
  ]) assert.equal(validClientBrandContextProcessingViewV1(invalid), false);

  for (const [state, phase] of [
    ["queued", "waiting"], ["running", "preparing_context"],
    ["running", "preparing_interests"], ["recovering", "finalizing"],
    ["completed", null], ["stale", null], ["failed", null]
  ] as const) assert.equal(validClientBrandContextProcessingViewV1(operationView(state, phase)), true, state);
  assert.equal(validClientBrandContextProcessingViewV1(prototypeAuthorizationView), true);
  assert.equal(validClientBrandContextProcessingViewV1(retryView), true);
  assert.equal(validClientBrandContextProcessingViewV1(renewalView), true);
});

test("confirmation helpers preserve one request key and the displayed quote", () => {
  assert.equal(clientBrandContextProcessingCanConfirmV1(availableView), true);
  assert.equal(clientBrandContextProcessingCanConfirmV1(availableView, true), false);
  assert.equal(clientBrandContextProcessingCanConfirmV1(operationView("running", "preparing_context")), false);
  assert.equal(clientBrandContextProcessingCanConfirmV1(prototypeAuthorizationView), true);
  assert.equal(clientBrandContextProcessingCanConfirmV1(renewalView), true);
  assert.equal(clientBrandContextProcessingCanConfirmV1(retryView), true);
  assert.equal(clientBrandContextProcessingCanConfirmV1(operationView("failed", null)), false);
  assert.throws(() => clientBrandContextProcessingRequestV1(null, operationView("failed", null),
    () => "must-not-run"), /brand_context_semantic_renewal_required/u);
  assert.equal(clientBrandContextProcessingCanConfirmV1({ ...availableView,
    quote: { ...availableView.quote!, expires_at: "2020-01-01T00:00:00.000Z" } }), false);

  const first = clientBrandContextProcessingRequestV1(null, availableView, () => "request-1");
  const repeated = clientBrandContextProcessingRequestV1(first, availableView, () => "must-not-run");
  assert.equal(repeated, first);
  const confirmation = clientBrandContextProcessingConfirmationV1(first);
  assert.deepEqual(confirmation, {
    contract_version: "client-brand-context-processing-request-v1",
    confirmation: "prepare_brand_context_within_shown_cap",
    expected_quote: { observed_at: availableView.observed_at, reference, maximum_micro_usd: "700000",
      available_today_micro_usd: "4999400", expires_at: "2999-09-11T12:05:00.000Z" }
  });
  assert.equal(validClientBrandContextProcessingConfirmationV1(confirmation), true);

  const prototypeRequest = clientBrandContextProcessingRequestV1(first, prototypeAuthorizationView,
    () => "request-prototypes");
  assert.equal(prototypeRequest.key, "request-prototypes");
  assert.notEqual(prototypeRequest, first);
  const prototypeConfirmation = clientBrandContextProcessingConfirmationV1(prototypeRequest);
  assert.deepEqual(prototypeConfirmation, {
    contract_version: "client-brand-context-processing-request-v1",
    confirmation: "prepare_brand_context_prototypes_within_shown_cap",
    expected_quote: { observed_at: prototypeAuthorizationView.observed_at, reference, maximum_micro_usd: "700000",
      available_today_micro_usd: "4999400", expires_at: "2999-09-11T12:05:00.000Z" }
  });
  assert.equal(validClientBrandContextProcessingConfirmationV1(prototypeConfirmation), true);
  assert.equal(clientBrandContextProcessingRequestV1(prototypeRequest, prototypeAuthorizationView,
    () => "must-not-run"), prototypeRequest);
  const renewalRequest = clientBrandContextProcessingRequestV1(prototypeRequest, renewalView,
    () => "request-renewal");
  assert.equal(renewalRequest.key, "request-renewal");
  const renewalConfirmation = clientBrandContextProcessingConfirmationV1(renewalRequest);
  assert.deepEqual(renewalConfirmation, {
    contract_version: "client-brand-context-processing-request-v1",
    confirmation: "renew_brand_context_semantic_within_shown_cap",
    expected_quote: { observed_at: renewalView.observed_at, reference, maximum_micro_usd: "700000",
      available_today_micro_usd: "4999400", expires_at: "2999-09-11T12:05:00.000Z" }
  });
  assert.equal(validClientBrandContextProcessingConfirmationV1(renewalConfirmation), true);
  assert.equal(clientBrandContextProcessingNeedsExplicitRenewalV1(renewalView), true);
  assert.equal(clientBrandContextProcessingCanRetrySemanticV1(retryView), true);
  assert.equal(clientBrandContextProcessingNeedsExplicitRenewalV1(retryView), false);
  assert.equal(clientBrandContextProcessingNeedsExplicitRenewalV1(prototypeAuthorizationView), false);
  const expiredRenewal = { ...renewalView,
    quote: { ...renewalView.quote!, expires_at: "2020-01-01T00:00:00.000Z" } };
  assert.equal(clientBrandContextProcessingNeedsExplicitRenewalV1(expiredRenewal), false);
  assert.equal(clientBrandContextProcessingCanConfirmV1(expiredRenewal), false);
  const retryRequest = clientBrandContextProcessingRequestV1(renewalRequest, retryView, () => "request-retry");
  assert.equal(retryRequest.key, "request-retry");
  assert.equal(clientBrandContextProcessingConfirmationV1(retryRequest).confirmation,
    "prepare_brand_context_within_shown_cap");
  for (const invalid of [{ ...confirmation, provider: "anthropic" },
    { ...confirmation, confirmation: "approve_everything" },
    { ...confirmation, expected_quote: { ...confirmation.expected_quote, maximum_micro_usd: "0.10" } },
    { ...confirmation, expected_quote: { ...confirmation.expected_quote, observed_at: "now" } }]) {
    assert.equal(validClientBrandContextProcessingConfirmationV1(invalid), false);
  }
  assert.doesNotMatch(JSON.stringify(clientBrandContextProcessingConfirmationV1(first)),
    /provider|model|digest|ledger|source/u);

  const refreshed = { ...availableView, observed_at: "2026-09-11T12:01:00.000Z" };
  assert.equal(clientBrandContextProcessingRequestV1(first, refreshed, () => "must-not-run").key, "request-1");
  const changedQuote = { ...refreshed, quote: { ...refreshed.quote!, reference: `qv1_${"b".repeat(64)}` } };
  assert.equal(clientBrandContextProcessingRequestV1(first, changedQuote, () => "request-new-quote").key,
    "request-new-quote");
  assert.equal(clientBrandContextProcessingRequestV1(null, refreshed, () => "request-2").key, "request-2");
  const otherWorkspace = { ...availableView, workspace_id: "00000000-0000-4000-8000-000000000099" };
  assert.equal(clientBrandContextProcessingRequestV1(first, otherWorkspace, () => "request-3").key, "request-3");
});

test("workspace-scoped POST accepts only allowlisted confirmations and returns public progress", async () => {
  const body = clientBrandContextProcessingConfirmationV1(
    clientBrandContextProcessingRequestV1(null, availableView, () => "request-key-001"));
  const calls: unknown[] = [];
  const post = createClientBrandContextProcessingPostV1({
    loadWorkspaceContext: async requested => {
      calls.push(requested);
      return { workspace: { id: workspaceId, organizationId: "00000000-0000-4000-8000-000000000002",
        subject: { type: "brand", id: "00000000-0000-4000-8000-000000000003" } },
      session: { appUser: { id: "00000000-0000-4000-8000-000000000004" } } };
    },
    start: async input => { calls.push(input); return operationView("queued", "waiting"); }
  });
  const response = await post(new Request("https://noisia.test", { method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "request-key-001" },
    body: JSON.stringify(body) }), { params: Promise.resolve({ workspaceId: "route-id" }) });
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await response.json(), operationView("queued", "waiting"));
  assert.equal(calls[0], "route-id");
  assert.deepEqual(calls[1], { workspace: { id: workspaceId,
    organizationId: "00000000-0000-4000-8000-000000000002",
    brandId: "00000000-0000-4000-8000-000000000003" },
  actorUserId: "00000000-0000-4000-8000-000000000004", idempotencyKey: "request-key-001", body });

  const prototypeBody = clientBrandContextProcessingConfirmationV1(
    clientBrandContextProcessingRequestV1(null, prototypeAuthorizationView, () => "request-key-002"));
  const prototypeResponse = await post(new Request("https://noisia.test", { method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "request-key-002" },
    body: JSON.stringify(prototypeBody) }), { params: Promise.resolve({ workspaceId: "route-id" }) });
  assert.equal(prototypeResponse.status, 202);
  assert.deepEqual((calls[3] as { body: unknown }).body, prototypeBody);

  for (const request of [
    new Request("https://noisia.test", { method: "POST", body: JSON.stringify(body) }),
    new Request("https://noisia.test", { method: "POST", headers: { "Idempotency-Key": "request-key-002" },
      body: JSON.stringify({ ...body, provider: "anthropic" }) })
  ]) {
    const rejected = await post(request, { params: Promise.resolve({ workspaceId }) });
    assert.ok([400, 422].includes(rejected.status));
  }
  assert.equal(calls.length, 4);
});

test("server authorizes Stage 2 only from its explicit confirmation and a fresh DB-owned quote", () => {
  const branch = serverAdapter.slice(serverAdapter.indexOf(
    "export async function startClientBrandContextPrototypeProcessingForActorV1"),
  serverAdapter.indexOf("export async function startClientBrandContextProcessingForActorV1"));
  for (const marker of ["loadLatestProcessingRowV1", "semantic_status!==\"completed\"",
    "generation_status!==\"published\"", "loadPrototypeRequestReceiptV1", "prior.parent_receipt_id", "prior.quote_digest",
    "args.runtime.prototype.available", "loadSignalBrandContextPrototypeQuoteV1", "expectedQuoteMatchesV1",
    "prototypeQuote.requires_confirmation", "startSignalBrandContextPrototypeProcessingV1",
    'confirmation:"prepare_brand_context_prototypes_within_shown_cap"'])
    assert.ok(branch.includes(marker), marker);
  assert.doesNotMatch(branch, /startSignalBrandContextComposedSemanticRunV1|prepare_brand_context_within_shown_cap/u);
});

test("lost Stage 2 HTTP acknowledgement replays only the same parent, actor and idempotency key",async()=>{
  const actor="00000000-0000-4000-8000-000000000004",receipt="00000000-0000-4000-8000-000000000005";
  const request=clientBrandContextProcessingConfirmationV1(
    clientBrandContextProcessingRequestV1(null,prototypeAuthorizationView,()=>"stage2-request-key"));
  let created=false;const starts:unknown[]=[];
  const runtime={queue_configured:true,worker_alive:true,recovery_alive:true,
    semantic:{available:true},prototype:{available:true}} as SignalBrandContextPreparationRuntimeV1;
  const dependencies={
    loadReceipt:async(_db:unknown,_workspace:string,_actor:string,key:string)=>created&&key==="stage2-request-key"?{
      parent_receipt_id:receipt,quote_digest:digest,confirmation:request.confirmation,
      maximum_micro_usd:request.expected_quote.maximum_micro_usd,available_today_micro_usd:request.expected_quote.available_today_micro_usd,
      expires_at:request.expected_quote.expires_at}:null,
    loadOperation:async()=>({observed_at:"2026-09-11T12:00:00.000Z",receipt_id:receipt,
      authorization_not_after:"2026-09-11T12:05:00.000Z",semantic_cap_micro_usd:"600000",
      prototype_cap_micro_usd:"100000",semantic_retry_maximum_micro_usd:"600000",
      semantic_renewal_idempotency_key:null,semantic_renewal_quote_expires_at:null,
      semantic_renewal_available_today_micro_usd:null,
      available_today_micro_usd:"4999400",authorization_current:false,
      source_current:true,generation_status:"published",semantic_status:"completed",
      child_receipt_id:created?"00000000-0000-4000-8000-000000000006":null,
      child_idempotency_key:created?"stage2-request-key":null,prototype_status:created?"queued":null}),
    loadQuote:async()=>{if(created)throw Object.assign(new Error("prior run unresolved"),{status:409});return({
      contract_version:"brand-context-prototype-quote-v1" as const,parent_receipt_id:receipt,
      workspace_id:workspaceId,quote_digest:digest,quoted_at:prototypeAuthorizationView.observed_at,
      quote_expires_at:prototypeAuthorizationView.quote!.expires_at,
      maximum_micro_usd:prototypeAuthorizationView.quote!.maximum_micro_usd,
      available_today_micro_usd:prototypeAuthorizationView.quote!.available_today_micro_usd,
      requires_provider:true,requires_confirmation:true,authorization_state:"awaiting_authorization" as const,
      supersedes_receipt_id:null});},
    start:async(input:unknown)=>{starts.push(input);created=true;return{} as never;},
    loadView:async()=>operationView("queued","waiting")
  };
  const args={workspaceId,actorUserId:actor,idempotencyKey:"stage2-request-key",body:request,
    database:{} as never,runtime};
  assert.deepEqual(await startClientBrandContextPrototypeProcessingForActorV1(args,dependencies),operationView("queued","waiting"));
  assert.deepEqual(await startClientBrandContextPrototypeProcessingForActorV1(args,dependencies),operationView("queued","waiting"));
  assert.equal(starts.length,2,"the adapter resolves first start and one DB replay with the same key");
  assert.deepEqual(starts.map(value=>(value as {idempotency_key:string}).idempotency_key),
    ["stage2-request-key","stage2-request-key"]);
  await assert.rejects(()=>startClientBrandContextPrototypeProcessingForActorV1({...args,idempotencyKey:"another-key"},dependencies),
    (error:unknown)=>error instanceof Error&&"status" in error&&error.status===409);
  assert.equal(starts.length,2,"a different key never reaches the DB replay adapter");

  created=false;
  const changedReference={...request,expected_quote:{...request.expected_quote,reference:`qv1_${"b".repeat(64)}`}};
  assert.equal(validClientBrandContextProcessingConfirmationV1(changedReference),true,
    "a quote reference is opaque syntax at the browser boundary");
  await assert.rejects(()=>startClientBrandContextPrototypeProcessingForActorV1({...args,body:changedReference},dependencies),
    (error:unknown)=>error instanceof Error&&"status" in error&&error.status===409);
  assert.equal(starts.length,2,"the server rejects a syntactically valid reference for another quote");
});

test("a new Stage 2 decision can replace only a server-quoted DNC leaf",async()=>{
  const receipt="00000000-0000-4000-8000-000000000005";
  const failedReceipt="00000000-0000-4000-8000-000000000006";
  const body=clientBrandContextProcessingConfirmationV1(
    clientBrandContextProcessingRequestV1(null,prototypeAuthorizationView,()=>"stage2-successor-key"));
  const starts:unknown[]=[];
  const result=await startClientBrandContextPrototypeProcessingForActorV1({workspaceId,
    actorUserId:"00000000-0000-4000-8000-000000000004",idempotencyKey:"stage2-successor-key",body,
    database:{} as never,runtime:{queue_configured:true,worker_alive:true,prototype:{available:true}} as SignalBrandContextPreparationRuntimeV1},{
    loadReceipt:async()=>null,
    loadOperation:async()=>({observed_at:"2026-09-11T12:00:00.000Z",receipt_id:receipt,
      authorization_not_after:"2026-09-11T12:05:00.000Z",semantic_cap_micro_usd:"600000",
      prototype_cap_micro_usd:"100000",semantic_retry_maximum_micro_usd:"600000",
      semantic_renewal_idempotency_key:null,semantic_renewal_quote_expires_at:null,
      semantic_renewal_available_today_micro_usd:null,
      available_today_micro_usd:"4999400",authorization_current:false,
      source_current:true,generation_status:"published",semantic_status:"completed",child_receipt_id:failedReceipt,
      child_idempotency_key:"stage2-old-key",prototype_status:"failed"}),
    loadQuote:async()=>({contract_version:"brand-context-prototype-quote-v1",parent_receipt_id:receipt,
      workspace_id:workspaceId,supersedes_receipt_id:failedReceipt,quote_digest:digest,
      quoted_at:prototypeAuthorizationView.observed_at,quote_expires_at:prototypeAuthorizationView.quote!.expires_at,
      maximum_micro_usd:prototypeAuthorizationView.quote!.maximum_micro_usd,
      available_today_micro_usd:prototypeAuthorizationView.quote!.available_today_micro_usd,
      requires_provider:true,requires_confirmation:true,authorization_state:"awaiting_authorization"}),
    start:async input=>{starts.push(input);return{} as never;},
    loadView:async()=>operationView("queued","waiting")
  });
  assert.deepEqual(result,operationView("queued","waiting"));
  assert.equal(starts.length,1);
  assert.equal((starts[0] as {expected_quote_digest:string}).expected_quote_digest,digest);
});

test("active operations poll while workspace scope and newest observation win", () => {
  for (const view of [operationView("queued", "waiting"), operationView("running", "preparing_interests"),
    operationView("recovering", "finalizing")]) assert.equal(clientBrandContextProcessingPollDelayV1(view), 4_000);
  assert.equal(clientBrandContextProcessingPollDelayV1(operationView("running", "preparing_context"), 1), 8_000);
  assert.equal(clientBrandContextProcessingPollDelayV1(operationView("running", "preparing_context"), 4), 60_000);
  assert.equal(clientBrandContextProcessingPollDelayV1(operationView("running", "preparing_context"), 5), 60_000);
  assert.equal(clientBrandContextProcessingPollDelayV1(operationView("running", "preparing_context"), 20), 60_000);
  for (const view of [null, operationView("completed", null), operationView("stale", null),
    operationView("failed", null), prototypeAuthorizationView])
    assert.equal(clientBrandContextProcessingPollDelayV1(view), null);

  const laterActualTime = { ...availableView, observed_at: "2026-09-11T15:00:00.000Z" };
  const earlierActualTime = { ...availableView, observed_at: "2026-09-11T14:00:00.000Z" };
  assert.equal(latestClientBrandContextProcessingViewV1(laterActualTime, earlierActualTime,
    workspaceId), laterActualTime);
  assert.equal(latestClientBrandContextProcessingViewV1(availableView,
    { ...availableView, workspace_id: "00000000-0000-4000-8000-000000000099" }, workspaceId), availableView);
  assert.equal(latestClientBrandContextProcessingViewV1(null, availableView, workspaceId), availableView);
});

test("durable polling checkpoints contain no authority and expire closed", () => {
  const active = operationView("running", "preparing_context");
  const checkpoint = clientBrandContextProcessingPollingCheckpointV1(active);
  assert.deepEqual(checkpoint, {
    contract_version: "client-brand-context-polling-checkpoint-v1",
    workspace_id: workspaceId,
    observed_at: active.observed_at
  });
  assert.deepEqual(Object.keys(checkpoint!).sort(), ["contract_version", "observed_at", "workspace_id"]);
  assert.doesNotMatch(JSON.stringify(checkpoint), /quote|reference|maximum|available|provider|confirmation/u);
  for (const state of ["completed", "stale", "failed"] as const)
    assert.equal(clientBrandContextProcessingPollingCheckpointV1(operationView(state, null)), null);
  assert.equal(clientBrandContextProcessingPollingCheckpointV1(prototypeAuthorizationView), null);
  assert.equal(clientBrandContextProcessingPollingCheckpointV1(null), null);

  const now = Date.parse(active.observed_at) + 60_000;
  assert.equal(validClientBrandContextProcessingPollingCheckpointV1(checkpoint, workspaceId, now), true);
  assert.equal(validClientBrandContextProcessingPollingCheckpointV1(checkpoint,
    "00000000-0000-4000-8000-000000000099", now), false);
  assert.equal(validClientBrandContextProcessingPollingCheckpointV1({ ...checkpoint, authority: "hidden" },
    workspaceId, now), false);
  assert.equal(validClientBrandContextProcessingPollingCheckpointV1({ ...checkpoint, observed_at: "now" },
    workspaceId, now), false);
  assert.equal(validClientBrandContextProcessingPollingCheckpointV1(checkpoint, workspaceId,
    Date.parse(active.observed_at) + 86_400_001), false);
  assert.equal(validClientBrandContextProcessingPollingCheckpointV1(checkpoint, workspaceId,
    Date.parse(active.observed_at) - 300_001), false);
});

test("reload and tab return resume long polling with GET only", () => {
  const start = clientComponent.indexOf("const resumePolling");
  const end = clientComponent.indexOf("useEffect(() => {\n    if (!current?.quote", start);
  assert.ok(start >= 0 && end > start);
  const branch = clientComponent.slice(start, end);
  for (const marker of ["visibilitychange", "sessionStorage.getItem", "pollingAttempts.current = 0", "void read()"])
    assert.ok(branch.includes(marker), marker);
  assert.doesNotMatch(branch, /method:\s*"POST"|confirm\(|reconciliationEndpoint|submitAuthorization/u);
  assert.match(clientComponent, /sessionStorage\.setItem\(pollingCheckpointKey\(workspaceId\)/u);
  assert.match(clientComponent, /sessionStorage\.removeItem\(pollingCheckpointKey\(previousWorkspaceId\)/u);
  assert.match(clientComponent, /if \(\[401, 403, 404\]\.includes\(response\.status\)\)[\s\S]{0,180}sessionStorage\.removeItem/u);
});

test("stale source reconciliation keeps transport identity and uses bounded timer backoff", t => {
  const keys = ["reconcile-one", "reconcile-two"];
  const first = clientBrandContextReconciliationCycleV1(null, workspaceId, () => keys.shift()!);
  assert.equal(first.idempotencyKey, "reconcile-one");
  assert.equal(clientBrandContextReconciliationCycleV1(first, workspaceId, () => "must-not-run"), first);
  const attempted = { ...first, attempts: 1 };
  const renewed = clientBrandContextReconciliationCycleV1(attempted, workspaceId, () => keys.shift()!, true);
  assert.equal(renewed.idempotencyKey, "reconcile-two");
  assert.equal(renewed.attempts, 1, "an acknowledged wait rotates identity without resetting the bounded cycle");
  assert.notEqual(clientBrandContextReconciliationCycleV1(renewed,
    "00000000-0000-4000-8000-000000000099", () => "other-workspace"), renewed);

  assert.equal(clientBrandContextReconciliationRetryDelayV1(-1), null);
  assert.equal(clientBrandContextReconciliationRetryDelayV1(3), null);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const fired: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const delay = clientBrandContextReconciliationRetryDelayV1(attempt);
      if (delay !== null) setTimeout(() => fired.push(attempt), delay);
    }
    t.mock.timers.tick(0); assert.deepEqual(fired, [0]);
    t.mock.timers.tick(1_999); assert.deepEqual(fired, [0]);
    t.mock.timers.tick(1); assert.deepEqual(fired, [0, 1]);
    t.mock.timers.tick(5_999); assert.deepEqual(fired, [0, 1]);
    t.mock.timers.tick(1); assert.deepEqual(fired, [0, 1, 2]);
  } finally { t.mock.timers.reset(); }
});

test("only an explicit reconciliation settlement response rotates the free retry", () => {
  for (const value of [
    { state: "awaiting_settlement" },
    { reconciliation: { state: "awaiting_settlement" } },
    { error: "brand_context_reconciliation_awaiting_settlement" },
    { error_code: "brand_context_reconciliation_awaiting_settlement" },
    { brand_context_preparation: { error_code: "brand_context_reconciliation_awaiting_settlement" } }
  ]) assert.equal(clientBrandContextReconciliationAwaitingSettlementV1(value), true);
  for (const value of [null, {}, { state: "stale" }, { error: "temporary_failure" }])
    assert.equal(clientBrandContextReconciliationAwaitingSettlementV1(value), false);
});

test("stale recovery calls only the free reconciliation contract and keeps Refresh as an escape", () => {
  const start = clientComponent.indexOf("const sourceStale");
  const end = clientComponent.indexOf("clientBrandContextProcessingPollDelayV1(current", start);
  assert.ok(start >= 0 && end > start);
  const branch = clientComponent.slice(start, end);
  assert.match(clientComponent, /semantic-context\/reconcile/u);
  assert.match(branch, /operation\?\.state === "stale" \|\| current\?\.status === "brand_context_outdated"/u);
  for (const marker of ["operator_requested_reconciliation",
    "Idempotency-Key", "clientBrandContextReconciliationRetryDelayV1", "attempts: cycle.attempts + 1"])
    assert.ok(branch.includes(marker), marker);
  assert.doesNotMatch(branch, /quoteReference|maximum_micro_usd|prepare_brand_context_within_shown_cap/u);
  assert.match(clientComponent, /function refresh\(\)[\s\S]{0,360}reconciliation\.current = null/u);
});

test("internal blockers collapse to stable client product states", () => {
  const expected = {
    processing_forbidden: "access_required", policy_missing: "configuration_required",
    policy_expired: "configuration_expired", policy_revoked: "processing_paused",
    action_missing: "configuration_required", action_incompatible: "configuration_required",
    action_unavailable: "processing_paused", daily_cap_insufficient: "daily_limit_reached",
    budget_date_changed: "temporarily_unavailable", source_required: "brand_context_required",
    source_stale: "brand_context_outdated", locale_required: "market_language_required",
    cache_coverage_required: "preparation_required"
  } as const;
  for (const [quote_status, status] of Object.entries(expected)) {
    const view = toClientBrandContextProcessingQuoteViewV1({ ...internal, quote_status } as SignalBrandContextProcessingQuoteV1);
    assert.equal(view.status, status);
  }
  const missing = toClientBrandContextProcessingQuoteViewV1({ ...internal, quote_status: "policy_missing",
    policy: null, remaining_micro_usd: "0" });
  assert.equal(missing.available_today_micro_usd, null);
  for (const quote_status of ["processing_forbidden", "policy_expired", "policy_revoked", "budget_date_changed"] as const) {
    const stale = toClientBrandContextProcessingQuoteViewV1({ ...internal, quote_status });
    assert.equal(stale.maximum_micro_usd, null, quote_status);
    assert.equal(stale.available_today_micro_usd, null, quote_status);
  }
});

test("server availability fails each action closed against its exact runtime dependencies", () => {
  const runtime = { queue_configured: true, worker_alive: true, recovery_alive: true,
    semantic: { available: true }, prototype: { available: true } } as SignalBrandContextPreparationRuntimeV1;
  assert.deepEqual(signalBrandContextProcessingActionAvailabilityV1(runtime), {
    brand_context_proposal: true, topic_prototype_embeddings: true
  });
  assert.deepEqual(signalBrandContextProcessingActionAvailabilityV1({ ...runtime, recovery_alive: false }), {
    brand_context_proposal: false, topic_prototype_embeddings: true
  });
  assert.deepEqual(signalBrandContextProcessingActionAvailabilityV1({ ...runtime, worker_alive: false }), {
    brand_context_proposal: false, topic_prototype_embeddings: false
  });
  assert.deepEqual(signalBrandContextProcessingActionAvailabilityV1({ ...runtime,
    semantic: { ...runtime.semantic, available: false }, prototype: { ...runtime.prototype, available: false } }), {
    brand_context_proposal: false, topic_prototype_embeddings: false
  });
});

test("workspace-scoped GET uses resolved authority, no-store and sanitized errors", async () => {
  const calls: unknown[] = [];
  const view = toClientBrandContextProcessingQuoteViewV1(internal);
  const get = createClientBrandContextProcessingQuoteGetV1({
    loadWorkspaceContext: async requested => {
      calls.push(requested);
      return { workspace: { id: workspaceId }, session: { appUser: { id: "actor" } } };
    },
    loadQuote: async args => { calls.push(args); return view; }
  });
  const response = await get(new Request("https://noisia.test"), { params: Promise.resolve({ workspaceId: "route-id" }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await response.json(), view);
  assert.deepEqual(calls, ["route-id", { workspaceId, actorUserId: "actor" }]);

  const denied = Response.json({ error: "private", message: "secret database detail" }, { status: 404 });
  const deniedGet = createClientBrandContextProcessingQuoteGetV1({
    loadWorkspaceContext: async () => ({ response: denied }), loadQuote: async () => { throw new Error("must not run"); }
  });
  const deniedResponse = await deniedGet(new Request("https://noisia.test"), { params: Promise.resolve({ workspaceId }) });
  assert.equal(deniedResponse.status, 404);
  assert.equal(deniedResponse.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await deniedResponse.json(), { error: "brand_context_processing_quote_not_found" });

  const thrownGet = createClientBrandContextProcessingQuoteGetV1({
    loadWorkspaceContext: async () => { throw new Error("secret resolver failure"); },
    loadQuote: async () => { throw new Error("must not run"); }
  });
  const thrown = await thrownGet(new Request("https://noisia.test"), { params: Promise.resolve({ workspaceId }) });
  assert.equal(thrown.status, 503);
  assert.deepEqual(await thrown.json(), { error: "brand_context_processing_quote_unavailable" });

  const failedGet = createClientBrandContextProcessingQuoteGetV1({
    loadWorkspaceContext: async () => ({ workspace: { id: workspaceId }, session: { appUser: { id: "actor" } } }),
    loadQuote: async () => { throw new Error("secret provider failure"); }
  });
  const failed = await failedGet(new Request("https://noisia.test"), { params: Promise.resolve({ workspaceId }) });
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: "brand_context_processing_quote_unavailable" });

  const wrongWorkspaceGet = createClientBrandContextProcessingQuoteGetV1({
    loadWorkspaceContext: async () => ({ workspace: { id: workspaceId }, session: { appUser: { id: "actor" } } }),
    loadQuote: async () => ({ ...view, workspace_id: "00000000-0000-4000-8000-000000000099" })
  });
  const wrongWorkspace = await wrongWorkspaceGet(new Request("https://noisia.test"), {
    params: Promise.resolve({ workspaceId })
  });
  assert.equal(wrongWorkspace.status, 503);
  assert.deepEqual(await wrongWorkspace.json(), { error: "brand_context_processing_quote_unavailable" });
});

for (const locale of ["es-MX", "en-US"] as const) {
  const messages = JSON.parse(await readFile(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
  const copy = messages.ClientBrandContextProcessing;
  const render = (variant: "full" | "compact", initial: ClientBrandContextProcessingViewV1
    | ReturnType<typeof toClientBrandContextProcessingQuoteViewV1> = publicQuote, authorize?: () => Promise<unknown>, extra: Partial<ComponentProps<typeof ClientBrandContextProcessingQuote>> = {}) =>
    renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, messages, timeZone: "UTC" } as ComponentProps<typeof NextIntlClientProvider>,
    createElement(ClientBrandContextProcessingQuote, {
      workspaceId, variant, initial, authorize, ...extra
    })));

  test(`${locale}: the Brand Context quote is read-only, sanitized and distinct from corpus vectors`, () => {
    for (const html of [render("full"), render("compact")]) {
      assert.ok(html.includes(copy.title));
      assert.ok(html.includes(copy.states.quote_available));
      assert.ok(html.includes(copy.informational));
      assert.match(html, /data-quote-can-start="false"/u);
      assert.doesNotMatch(html, /anthropic|private-model|private-policy|sha256:|qv1_|quote_reference|data-processing-stage=/u);
      assert.doesNotMatch(html, /<form|admin-button--primary/u);
    }
    assert.ok(render("full").includes(copy.body));
    assert.ok(render("compact").includes(copy.compactBody));
  });

  test(`${locale}: aggregated progress is explicit without exposing internals or another confirmation`, () => {
    const states = [
      ["queued", "waiting"], ["running", "preparing_context"], ["running", "preparing_interests"],
      ["recovering", "finalizing"], ["completed", null], ["stale", null], ["failed", null]
    ] as const;
    for (const [state, phase] of states) {
      const html = render("full", operationView(state, phase));
      assert.ok(html.includes(copy.states[state]));
      assert.ok(html.includes(copy.help[state]));
      if (phase) assert.ok(html.includes(copy.phases[phase]));
      assert.doesNotMatch(html, /admin-button--primary|provider|model|digest|ledger|sha256:|qv1_|quote_reference/u);
    }
  });

  test(`${locale}: Stage 2 reuses one accessible CTA with its current cap`, () => {
    const authorizer = async () => operationView("queued", "waiting");
    const enabled = render("full", prototypeAuthorizationView, authorizer);
    assert.equal(enabled.match(/admin-button--primary/gu)?.length, 1);
    assert.ok(enabled.includes(copy.states.awaiting_authorization));
    assert.ok(enabled.includes(copy.help.awaiting_authorization));
    assert.ok(enabled.includes(copy.authorizationPrototypes.split("{maximum}")[0]));
    assert.ok(enabled.includes(copy.confirm));
    assert.match(enabled, /aria-describedby="client-brand-context-confirmation-help"/u);
    assert.match(enabled, /data-processing-state="awaiting_authorization"/u);
    assert.doesNotMatch(render("compact", prototypeAuthorizationView, authorizer), /admin-button--primary/u);
  });

  test(`${locale}: changed guides show context ready and one explicit cached refresh`, () => {
    const pending={...prototypeAuthorizationView,operation:{state:"guides_pending" as const,phase:null,
      request_observed:true,next_action:null},quote:{...prototypeAuthorizationView.quote!,maximum_micro_usd:"0"}};
    const html=render("full",pending,async()=>operationView("queued","waiting"));
    assert.ok(html.includes(copy.states.guides_pending));assert.ok(html.includes(copy.help.guides_pending));
    assert.ok(html.includes(copy.authorizationRefresh.split("{maximum}")[0]));
    assert.equal(html.match(/admin-button--primary/gu)?.length,1);
    const blocked=render("full",{...pending,can_start:false,status:"processing_paused",quote:null},async()=>{throw new Error("no_authorization");});
    assert.ok(blocked.includes(copy.help.guides_pending));assert.doesNotMatch(blocked,/admin-button--primary/u);
    const unsaved=render("full",pending,async()=>operationView("queued","waiting"),{prototypeOnly:true,disabled:true});
    assert.match(unsaved,/class="admin-button admin-button--primary" disabled=""/u);
    assert.doesNotMatch(render("full",availableView,async()=>operationView("queued","waiting"),{prototypeOnly:true}),/admin-button--primary/u);

  });

  test(`${locale}: failed Stage 1 exposes only the server-selected retry or renewal`, () => {
    const authorizer = async () => operationView("queued", "waiting");
    const unavailable = render("full", operationView("failed", null), authorizer);
    assert.ok(unavailable.includes(copy.failureNoAction));
    assert.doesNotMatch(unavailable, /admin-button--primary/u);
    assert.doesNotMatch(unavailable, new RegExp(copy.maximum, "u"));
    assert.doesNotMatch(unavailable, /qv1_|quote_reference/u);

    const expired = render("full", { ...renewalView,
      quote: { ...renewalView.quote!, expires_at: "2020-01-01T00:00:00.000Z" } }, authorizer);
    assert.ok(expired.includes(copy.failureNoAction));
    assert.doesNotMatch(expired, /admin-button--primary|qv1_|quote_reference/u);

    const enabled = render("full", renewalView, authorizer);
    assert.equal(enabled.match(/admin-button--primary/gu)?.length, 1);
    assert.ok(enabled.includes(copy.renewal.available));
    assert.ok(enabled.includes(copy.authorizationRenewal.split("{maximum}")[0]));
    assert.ok(enabled.includes(copy.renew));
    assert.match(enabled, /aria-describedby="client-brand-context-confirmation-help"/u);
    assert.doesNotMatch(enabled, /qv1_|quote_reference/u);
    const compact = render("compact", renewalView, authorizer);
    assert.match(compact, /data-quote-can-start="true"/u);
    assert.doesNotMatch(compact, /admin-button--primary/u);

    const retry = render("full", retryView, authorizer);
    assert.equal(retry.match(/admin-button--primary/gu)?.length, 1);
    assert.ok(retry.includes(copy.semanticRetry.available));
    assert.ok(retry.includes(copy.authorizationRetry.split("{maximum}")[0]));
    assert.ok(retry.includes(copy.retry));
    assert.doesNotMatch(retry, new RegExp(copy.renew, "u"));
    assert.doesNotMatch(retry, /qv1_|quote_reference/u);
  });

  test(`${locale}: confirmation renders once only with server availability and an authorizer`, () => {
    const authorizer = async () => operationView("queued", "waiting");
    const blocked = render("full", { ...availableView, can_start: false }, authorizer);
    const missingAuthorizer = render("full", availableView);
    const compact = render("compact", availableView, authorizer);
    for (const html of [blocked, missingAuthorizer, compact]) {
      assert.doesNotMatch(html, /admin-button--primary/u);
      assert.doesNotMatch(html, new RegExp(copy.confirm, "u"));
    }

    const enabled = render("full", availableView, authorizer);
    assert.equal(enabled.match(/admin-button--primary/gu)?.length, 1);
    assert.ok(enabled.includes(copy.confirm));
    assert.ok(enabled.includes(copy.authorization.split("{maximum}")[0]));
    assert.match(enabled, /aria-describedby="client-brand-context-confirmation-help"/u);
  });
}

test("Brand Context progress and its single confirmation remain usable on narrow screens", async () => {
  const css = await readFile(new URL("../../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.client-brand-context-quote__head \{ flex-direction: column; \}/u);
  assert.match(css, /\.client-brand-context-quote__amounts \{ display: grid; grid-template-columns: 1fr; \}/u);
  assert.match(css, /\.client-brand-context-quote__confirmation, \.client-brand-context-quote__confirmation \.admin-button \{ width: 100%; \}/u);
});


test("changed interests are a separate explicit preparation, including a cached zero cap", async () => {
  const pending = { ...prototypeAuthorizationView, operation: {
    state: "guides_pending", phase: null, request_observed: true, next_action: null
  }, quote: { ...prototypeAuthorizationView.quote!, maximum_micro_usd: "0" } } as ClientBrandContextProcessingViewV1;
  assert.equal(validClientBrandContextProcessingViewV1(pending), true);
  assert.equal(clientBrandContextProcessingCanConfirmV1(pending), true);
  assert.equal(clientBrandContextProcessingPollDelayV1(pending), null);
  const request = clientBrandContextProcessingRequestV1(null, pending, () => "refresh-guides-key");
  assert.equal(clientBrandContextProcessingConfirmationV1(request).confirmation,
    "prepare_brand_context_prototypes_within_shown_cap");
  assert.equal(validClientBrandContextProcessingViewV1({ ...pending, can_start: false,
    status: "processing_paused", quote: null }), true);
  assert.equal(clientBrandContextProcessingCanConfirmV1({ ...pending, can_start: false }), false);
});

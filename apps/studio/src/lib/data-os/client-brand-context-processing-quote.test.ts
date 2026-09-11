import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React, { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import type { SignalBrandContextPreparationRuntimeV1, SignalBrandContextProcessingQuoteV1 } from "@noisia/db";
import { ClientBrandContextProcessingQuote } from "../../components/brands/ClientBrandContextProcessingQuote";
import { createClientBrandContextProcessingQuoteGetV1 } from "./client-brand-context-processing-quote-route";
import { clientBrandContextProcessingQuoteForWorkspaceV1, toClientBrandContextProcessingQuoteViewV1,
  validClientBrandContextProcessingQuoteViewV1 } from "./client-brand-context-processing-quote";
import { signalBrandContextProcessingActionAvailabilityV1 } from "./signal-brand-context-processing-quote";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const digest = `sha256:${"a".repeat(64)}`;
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

test("public Brand Context quote is an exact allowlist and remains non-executable", () => {
  const view = toClientBrandContextProcessingQuoteViewV1(internal);
  assert.deepEqual(Object.keys(view).sort(), ["available_today_micro_usd", "can_start", "contract_version",
    "maximum_micro_usd", "observed_at", "quote_expires_at", "status", "workspace_id"]);
  assert.equal(view.status, "quote_available");
  assert.equal(view.can_start, false);
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
  const render = (variant: "full" | "compact") => renderToStaticMarkup(createElement(NextIntlClientProvider,
    { locale, messages, timeZone: "UTC" } as ComponentProps<typeof NextIntlClientProvider>,
    createElement(ClientBrandContextProcessingQuote, {
      workspaceId, variant, initial: toClientBrandContextProcessingQuoteViewV1(internal)
    })));

  test(`${locale}: the Brand Context quote is read-only, sanitized and distinct from corpus vectors`, () => {
    for (const html of [render("full"), render("compact")]) {
      assert.ok(html.includes(copy.title));
      assert.ok(html.includes(copy.states.quote_available));
      assert.ok(html.includes(copy.informational));
      assert.match(html, /data-quote-can-start="false"/u);
      assert.doesNotMatch(html, /anthropic|private-model|private-policy|sha256:|data-processing-stage=/u);
      assert.doesNotMatch(html, /<form|admin-button--primary/u);
    }
    assert.ok(render("full").includes(copy.body));
    assert.ok(render("compact").includes(copy.compactBody));
  });
}
